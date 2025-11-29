'use strict';

const sdk = require('microsoft-cognitiveservices-speech-sdk');
const { log } = require('./logger');

function normalizeLangs(input, fallback0 = 'en-US', fallback1 = 'lv-LV') {
  let langs = [];

  if (Array.isArray(input)) langs = input;
  else if (typeof input === 'string') langs = input.split(',');
  else langs = [fallback0, fallback1];

  langs = langs
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .map((s) => s.replace(/_/g, '-'));

  langs = [...new Set(langs)];

  const re = /^[A-Za-z]{2,3}-[A-Za-z]{2}$/;
  langs = langs.filter((l) => re.test(l));

  if (langs.length === 0) langs = [fallback0];
  return langs.slice(0, 10);
}

class RecognizerWrapper {
  constructor({ key, region, langs, rate, controller, endpointMode }) {
    this.key = key;
    this.region = region;

    this.langs = normalizeLangs(langs);
    this.rate = rate || 16000;
    this.controller = controller;

    this.endpointMode = endpointMode || 'conversation'; // conversation|dictation

    this.recognizer = null;
    this.pushStream = null;
    this.reconnects = 0;

    this.sessionStart = process.hrtime.bigint();
    this.currentUtteranceStart = null;
  }

  start() {
    const fmt = sdk.AudioStreamFormat.getWaveFormatPCM(this.rate, 16, 1);
    this.pushStream = sdk.AudioInputStream.createPushStream(fmt);

    this.controller.attachStream(this.pushStream);

    const endpointKind = this.endpointMode === 'dictation' ? 'dictation' : 'conversation';
    const endpoint = new URL(
      `wss://${this.region}.stt.speech.microsoft.com/speech/recognition/${endpointKind}/cognitiveservices/v1`
    );

    const speechConfig = sdk.SpeechConfig.fromEndpoint(endpoint, this.key);

    speechConfig.setProperty(
      sdk.PropertyId.SpeechServiceConnection_LanguageIdMode,
      'Continuous'
    );

    speechConfig.setProperty(
      sdk.PropertyId.SpeechServiceResponse_StablePartialResultThreshold,
      '2'
    );

    speechConfig.setProperty(
      sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs,
      '1200'
    );

    const audioConfig = sdk.AudioConfig.fromStreamInput(this.pushStream);
    const autoDetect = sdk.AutoDetectSourceLanguageConfig.fromLanguages(this.langs);

    this.recognizer = sdk.SpeechRecognizer.FromConfig(
      speechConfig,
      autoDetect,
      audioConfig
    );

    this._setupRecognizer();

    log(`[asr] started (langs=${this.langs.join(',')}, LID=Continuous, ep=${endpointKind})`);
  }

  _setupRecognizer() {
    this.recognizer.recognizing = (_, e) => {
      const text = e?.result?.text;
      if (!text) return;

      if (!this.currentUtteranceStart) this.currentUtteranceStart = process.hrtime.bigint();

      log(`[asr~] ${text}`);
    };

    this.recognizer.recognized = (_, e) => {
      const text = e?.result?.text;
      if (!text) return;
      if (e.result.reason !== sdk.ResultReason.RecognizedSpeech) return;

      let lang = 'unknown';
      try {
        const lid = sdk.AutoDetectSourceLanguageResult.fromResult(e.result);
        if (lid?.language) lang = lid.language;
      } catch {}

      const now = process.hrtime.bigint();
      const latencyMs = this.currentUtteranceStart
        ? Number(now - this.currentUtteranceStart) / 1e6
        : 0;

      this.currentUtteranceStart = null;

      log(`[asr-${lang}] ${text} (latency ${(latencyMs / 1000).toFixed(2)}s)`);
    };

    this.recognizer.canceled = (_, e) => {
      log(`[asr] canceled: ${e?.reason ?? ''} ${e?.errorDetails ?? ''}`.trim());
      this.reconnect();
    };

    this.recognizer.sessionStopped = () => {
      log('[asr] session stopped');
      this.reconnect();
    };

    this.recognizer.startContinuousRecognitionAsync(
      () => {
        const now = process.hrtime.bigint();
        const delayMs = Number(now - this.sessionStart) / 1e6;
        log(`[asr] recognition started (delay ${(delayMs / 1000).toFixed(2)}s)`);
      },
      (err) => {
        log(`[asr] start error: ${err?.message || err}`);
        this.reconnect();
      }
    );
  }

  reconnect() {
    this.stop();
    const delay = Math.min(15000, 1000 * Math.pow(2, this.reconnects++));
    log(`[asr] reconnecting in ${delay}ms`);
    setTimeout(() => this.start(), delay);
  }

  stop() {
    try { this.recognizer?.stopContinuousRecognitionAsync(() => {}, () => {}); } catch {}
    try { this.pushStream?.close(); } catch {}
    this.recognizer = null;
    this.pushStream = null;
    this.currentUtteranceStart = null;
  }
}

module.exports = { RecognizerWrapper };
