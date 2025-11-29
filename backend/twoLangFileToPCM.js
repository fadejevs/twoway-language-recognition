'use strict';

const path = require('path');
const { spawn } = require('child_process');

const { log } = require('./logger');
const { StreamController } = require('./stream_controller');
const { RecognizerWrapper } = require('./recognizer');

const DATA_JSON = path.resolve(__dirname, '..', 'data.json');
const MP3_FILE = path.resolve(__dirname, 'Trim_EN_UKR.mp3');

function loadConfig() {
  const cfg = require(DATA_JSON);
  const key = cfg.AZURE_API_KEY;
  const region = "eastus";
  if (!key || !region) throw new Error('Missing speech key/region in data.json');
  return { key, region };
}

async function main() {
  const { key, region } = loadConfig();

  const rate = 16000;
  const controller = new StreamController({ rate });
  const asr = new RecognizerWrapper({
    key,
    region,
    lang0: 'en-US',
    lang1: 'uk-UA',
    rate,
    controller,
  });

  asr.start();

  const ff = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-i', MP3_FILE,
    '-f', 's16le',
    '-acodec', 'pcm_s16le',
    '-ac', '1',
    '-ar', String(rate),
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  ff.stderr.on('data', (d) => log(`[ffmpeg] ${String(d).trim()}`));

  const bytesPerSecond = rate * 2;
  const tickMs = 50;
  const bytesPerTick = Math.floor((bytesPerSecond * tickMs) / 1000);

  let buf = Buffer.alloc(0);
  let ended = false;

  ff.stdout.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
  });

  ff.on('close', (code) => {
    ended = true;
    log(`[ffmpeg] exited rc=${code}`);
  });

  const timer = setInterval(() => {
    if (buf.length >= bytesPerTick) {
      const out = buf.subarray(0, bytesPerTick);
      buf = buf.subarray(bytesPerTick);
      controller.push(out);
      return;
    }

    if (ended && buf.length > 0) {
      controller.push(buf);
      buf = Buffer.alloc(0);
      return;
    }

    if (ended && buf.length === 0) {
      clearInterval(timer);
      asr.stop();
      controller.stop();
      log('[done]');
    }
  }, tickMs);
}

main().catch((e) => {
  log(`[err] ${e?.stack || e}`);
  process.exit(1);
});
