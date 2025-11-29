'use strict';
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const fetch = require('node-fetch');
const { log } = require('./logger');

class RecognizerWrapper {
  constructor({ key, region, lang0, lang1, rate, postUrl, eventId, controller }) {
    this.key = key;
    this.region = region;
    this.lang0 = lang0 || 'en-US';
    this.lang1 = lang1 || 'lv-LV';
    this.rate = rate;
    this.postUrl = postUrl;
    this.eventId = eventId;
    this.controller = controller;

    this.pushStream = null;
    this.recognizer = null;
    this.reconnects = 0;
    this.lastResults = [];
  }

  start() {
    const fmt = sdk.AudioStreamFormat.getWaveFormatPCM(this.rate, 16, 1);
    this.pushStream = sdk.AudioInputStream.createPushStream(fmt);
    this.controller.attachStream(this.pushStream);

    const audioConfig = sdk.AudioConfig.fromStreamInput(this.pushStream);
    const speechConfig = sdk.SpeechConfig.fromSubscription(this.key, this.region);

    // Set up for multi-language detection
    speechConfig.outputFormat = sdk.OutputFormat.Detailed;
    speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, "500");
    
    // Create source language config with OPEN_RANGE for at-start detection
    // const autoDetectSourceLanguageConfig = sdk.AutoDetectSourceLanguageConfig.fromOpenRange();
    
    // Alternative: specify candidate languages explicitly
    const autoDetectSourceLanguageConfig = sdk.AutoDetectSourceLanguageConfig.fromLanguages([
      this.lang0,
      this.lang1
    ]);

    this.recognizer = sdk.SpeechRecognizer.FromConfig(
      speechConfig,
      autoDetectSourceLanguageConfig,
      audioConfig
    );

    this._setupRecognizer();

    log(`[asr] started recognizer with open-range language detection`);
  }

  _getConfidence(result) {
    try {
      const detailed = result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult);
      if (detailed) {
        const json = JSON.parse(detailed);
        return json.NBest?.[0]?.Confidence || 0;
      }
    } catch (e) {
      log('[asr] confidence parse error:', e.message);
    }
    return 0;
  }

  _getDetectedLanguage(result) {
    try {
      // Try to get language from auto-detect result
      const langProperty = result.properties.getProperty(sdk.PropertyId.SpeechServiceConnection_AutoDetectSourceLanguageResult);
      if (langProperty) {
        return langProperty;
      }
      
      // Fallback: parse from JSON result
      const detailed = result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult);
      if (detailed) {
        const json = JSON.parse(detailed);
        return json.Language || 'unknown';
      }
    } catch (e) {
      log('[asr] language detection parse error:', e.message);
    }
    return 'unknown';
  }

  _isDuplicate(text, lang, timestamp) {
    const now = timestamp || Date.now();
    this.lastResults = this.lastResults.filter(r => now - r.timestamp < 2000);
    
    const isDupe = this.lastResults.some(r => 
      r.text === text && Math.abs(now - r.timestamp) < 2000
    );
    
    if (!isDupe) {
      this.lastResults.push({ text, lang, timestamp: now });
    }
    
    return isDupe;
  }

  _setupRecognizer() {
    this.recognizer.recognizing = (_, e) => {
      if (e?.result?.text) {
        const detectedLang = this._getDetectedLanguage(e.result);
        log(`[asr-${detectedLang}] partial: "${e.result.text}"`);
      }
    };

    this.recognizer.recognized = async (_, e) => {
      if (e?.result?.text && e.result.reason === sdk.ResultReason.RecognizedSpeech) {
        const detectedLang = this._getDetectedLanguage(e.result);
        const confidence = this._getConfidence(e.result);
        const text = e.result.text;
        
        log(`[asr-${detectedLang}] recognized (conf: ${confidence.toFixed(2)}): "${text}"`);
        
        if (this._isDuplicate(text, detectedLang)) {
          log(`[asr-${detectedLang}] duplicate detected: "${text}"`);
        }
        
        await this.postToApp(text, detectedLang, confidence);
      } else if (e?.result?.reason === sdk.ResultReason.NoMatch) {
        log('[asr] no match - speech detected but not recognized');
      }
    };

    this.recognizer.canceled = (_, e) => {
      log('[asr] canceled:', e.reason, e.errorDetails);
      if (e.reason === sdk.CancellationReason.Error) {
        this.reconnect();
      }
    };

    this.recognizer.sessionStopped = () => {
      log('[asr] session stopped');
      this.reconnect();
    };

    this.recognizer.startContinuousRecognitionAsync(
      () => log('[asr] continuous recognition started'),
      (err) => {
        log('[asr] start error:', err);
        this.reconnect();
      }
    );
  }

  async postToApp(text, lang, confidence) {
    try {
      await fetch(this.postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          room_id: this.eventId, 
          text, 
          lang,
          confidence: confidence || 0
        })
      });
      log(`[post] sent to app: ${text.substring(0, 50)}... (${lang}, conf: ${(confidence || 0).toFixed(2)})`);
    } catch (e) {
      log('[post] error:', e.message);
    }
  }

  reconnect() {
    this.stop();
    const delay = Math.min(15000, 1000 * Math.pow(2, this.reconnects++));
    log(`[asr] reconnecting in ${delay}ms (attempt ${this.reconnects})`);
    setTimeout(() => this.start(), delay);
  }

  stop() {
    try {
      this.recognizer?.stopContinuousRecognitionAsync(() => {
        log('[asr] stopped successfully');
      }, (err) => {
        log('[asr] stop error:', err);
      });
    } catch (e) {
      log('[asr] exception during stop:', e.message);
    }
    try { this.pushStream?.close(); } catch {}
    this.recognizer = null;
    this.pushStream = null;
  }
}

module.exports = { RecognizerWrapper };