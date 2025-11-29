'use strict';
const fs = require('fs');
const path = require('path');

const t0 = process.hrtime.bigint();
let last = t0;
let fileStream = null;
let colorEnabled = process.env.LOG_COLOR !== '0';

/* ─────────────────────────────
   Timestamp and logger helpers
───────────────────────────── */
function ts() {
  return new Date().toISOString();
}

function fmtDelta(ms) {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function log(...args) {
  const now = process.hrtime.bigint();
  const d = Number(now - last) / 1e6;
  const t = Number(now - t0) / 1e6;
  last = now;

  const prefix = `[${ts()} +${fmtDelta(d)} (${fmtDelta(t)})]`;

  if (colorEnabled) {
    const colored = prefix
      .replace(/^\[/, '\x1b[90m[') 
      .replace(/\]$/, ']\x1b[0m');
    console.error(colored, ...args, '\x1b[0m');
  } else {
    console.error(prefix, ...args);
  }
}

/* ─────────────────────────────
   File logger setup
───────────────────────────── */
function createFileLogger(logPath) {
  try {
    const dir = path.dirname(logPath);
    fs.mkdirSync(dir, { recursive: true });

    if (fileStream) {
      fileStream.end();
      fileStream = null;
    }

    fileStream = fs.createWriteStream(logPath, { flags: 'a' });
    const origErr = process.stderr.write.bind(process.stderr);

    process.stderr.write = (chunk, enc, cb) => {
      try {
        if (fileStream) fileStream.write(chunk);
      } catch (_) { /* ignore write errors */ }
      return origErr(chunk, enc, cb);
    };

    process.on('exit', () => {
      try { fileStream?.end(); } catch {}
    });

    log(`[filelog] Logging to: ${logPath}`);
  } catch (e) {
    console.error(`[filelog] failed to init log file ${logPath}:`, e.message);
  }
}

/* ─────────────────────────────
   Exports
───────────────────────────── */
module.exports = { log, createFileLogger };
