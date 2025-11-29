#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { log, createFileLogger } = require('./modules/logger');
const { StreamController } = require('./modules/stream_controller');
const { RecognizerWrapper } = require('./modules/recognizer');

/* ─────────────────────────────
   CONFIG LOADING
───────────────────────────── */
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  log('[boot] Loaded config.json');
} catch (e) {
  console.error('[boot] Failed to load config.json:', e.message);
  process.exit(1);
}

/* ─────────────────────────────
   SESSION & PATHS
───────────────────────────── */
const EVENT_ID = process.env.EVENT_ID || process.argv[2];
if (!EVENT_ID) {
  console.error('Usage: EVENT_ID env or arg required');
  process.exit(1);
}
const SESSION_DIR = path.join('/var/session_logs', EVENT_ID);
try { fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o777 }); } catch {}
const LOG_FILE = path.join(SESSION_DIR, `transcribe_${EVENT_ID}.log`);
createFileLogger(LOG_FILE);

/* ─────────────────────────────
   CONFIG VALUES 
───────────────────────────── */
const REGION = cfg.azure?.region || 'eastus';
const LANG0 = process.env.LANG0 || cfg.azure?.lang || 'en-US';
const LANG1 = process.env.LANG1 || cfg.azure?.lang || 'lv-LV';
const RATE = Number(cfg.audio?.rate || cfg.rate || 16000);
const API_FILE = path.join(__dirname, 'data.json');
const POST_URL = cfg.post?.url || null;

const BUFFER_MS = Number(cfg.stream?.maxBufferMs ?? 750);
const BYTES_PER_SAMPLE = Number(cfg.stream?.bytesPerSample ?? 2);
const CHANNELS = Number(cfg.stream?.channels ?? 1);

const TARGET_BUFFER_BYTES = Math.round(RATE * BYTES_PER_SAMPLE * CHANNELS * (BUFFER_MS / 1000));
const MAX_BUFFER_BYTES = Math.round(cfg.stream?.maxBufferBytes || Math.max(TARGET_BUFFER_BYTES * 3, TARGET_BUFFER_BYTES + 16000));

log(`[boot] EVENT_ID=${EVENT_ID}`);
log(`[boot] REGION=${REGION} LANG0=${LANG0} LANG1=${LANG1} RATE=${RATE}Hz`);
log(`[boot] BUFFER=${BUFFER_MS}ms (target=${TARGET_BUFFER_BYTES} bytes) max=${MAX_BUFFER_BYTES}`);

/* ─────────────────────────────
   LOAD AZURE KEY
───────────────────────────── */
let key;
try {
  const raw = fs.readFileSync(API_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  key = parsed.AZURE_API_KEY;
  if (!key) throw new Error('Missing AZURE_API_KEY field in key file');
  log('[boot] Loaded Azure API key from data.json');
} catch (e) {
  log('[boot] Cannot read Azure key file:', e.message);
  process.exit(1);
}

/* ─────────────────────────────
   INIT STREAM CONTROLLER & RECOGNIZER
───────────────────────────── */
const controller = new StreamController(MAX_BUFFER_BYTES, {
  reportInterval: cfg.stream?.reportIntervalMs || 5000,
  batchBytes: cfg.stream?.batchBytes || (64 * 1024),
});

const recognizer = new RecognizerWrapper({
  key,
  region: REGION,
  lang0: LANG0,
  lang1: LANG1,
  rate: RATE,
  postUrl: POST_URL,
  eventId: EVENT_ID,
  controller, 
});

try {
  recognizer.start();
} catch (err) {
  log('[boot] recognizer.start() failed:', err && err.message);
  process.exit(1);
}

/* ─────────────────────────────
   Hook controller
───────────────────────────── */
if (typeof recognizer.getPushStream === 'function') {
  const pushStream = recognizer.getPushStream();
  if (pushStream) {
    controller.attachStream(pushStream);
    log('[boot] Attached controller to recognizer pushStream (getPushStream).');
  }
} else if (typeof recognizer.attachController === 'function') {
  try {
    recognizer.attachController(controller);
    log('[boot] Attached controller to recognizer (attachController).');
  } catch (e) {
    log('[boot] recognizer.attachController failed:', e && e.message);
  }
} else {
  if (recognizer.pushStream) {
    controller.attachStream(recognizer.pushStream);
    log('[boot] Attached controller to recognizer.pushStream property.');
  } else {
    log('[warn] recognizer did not expose pushStream/getPushStream/attachController — ensure the controller is wired to a writable.');
  }
}

/* ─────────────────────────────
   AUTO-DRAIN LOOP 
───────────────────────────── */
const drainIntervalMs = Number(cfg.stream?.drainIntervalMs || 20);
const drainTimer = setInterval(() => {
  try { if (typeof controller.drain === 'function') controller.drain(); } catch (e) {}
}, drainIntervalMs);
drainTimer.unref();

/* ─────────────────────────────
   stdin (parec) -> controller
───────────────────────────── */
process.stdin.on('data', (chunk) => {
  try {
    controller.push(Buffer.from(chunk));
  } catch (err) {
    log('[stdin] push error:', err && err.message);
  }
});

controller.on && controller.on('high', () => {
  log('[streamctl] HIGH watermark reached — pausing stdin to stop intake');
  try { if (process.stdin.pause) process.stdin.pause(); } catch (e) { log('[streamctl] pause failed', e && e.message); }
});

controller.on && controller.on('ok', () => {
  log('[streamctl] Buffer under resume threshold — resuming stdin');
  try { if (process.stdin.resume) process.stdin.resume(); } catch (e) { log('[streamctl] resume failed', e && e.message); }
});

/* ─────────────────────────────
   Graceful shutdown
───────────────────────────── */
let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('[shutdown] start');
  try {
    if (drainTimer) clearInterval(drainTimer);
    if (controller && typeof controller.stop === 'function') {
      try { controller.stop(); } catch (e) {}
    }
    if (recognizer && typeof recognizer.stop === 'function') {
      try { await recognizer.stop(); } catch (e) { log('[shutdown] recognizer.stop error', e && e.message); }
    }
  } catch (e) {
    log('[shutdown] error', e && e.message);
  } finally {
    log('[shutdown] done');
    process.exit(code);
  }
}

process.on('SIGINT', () => { log('[signal] SIGINT'); shutdown(0); });
process.on('SIGTERM', () => { log('[signal] SIGTERM'); shutdown(0); });
process.on('uncaughtException', (err) => { log('[uncaught] ' + (err && err.stack || err)); shutdown(1); });
process.on('unhandledRejection', (r) => { log('[unhandledRejection] ' + (r && r.stack || r)); });

/* ─────────────────────────────
   Keep-alive: log periodic stats
───────────────────────────── */
const statInterval = Number(cfg.stream?.statIntervalMs || 5000);
setInterval(() => {
  try {
    const queued = Number(controller.totalQueued || controller.queue?.reduce?.((s,c)=>s+(c?.length||0),0) || 0);
    const lost = Number(controller.lostBytes || 0);
    log(`[stats] queued=${queued} lost=${lost}`);
  } catch (e) {}
}, statInterval).unref();

log('[boot] ready');
