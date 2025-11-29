'use strict';
const { EventEmitter } = require('events');
const { log } = require('./logger');

class StreamController extends EventEmitter {
  constructor(opts = {}) {
    super();
    const rate = opts.rate || 16000;
    this.maxBufferBytes = opts.maxBufferBytes || (rate * 2 /* 2s */ * 2 /* bytes per sample */) || 64000;
    this.highWaterBytes = opts.highWaterBytes || Math.floor(this.maxBufferBytes * 0.9);
    this.resumeWaterBytes = opts.resumeWaterBytes || Math.floor(this.maxBufferBytes * 0.3);
    this.batchBytes = opts.batchBytes || 64 * 1024;
    this.reportInterval = opts.reportInterval || 5000;

    this.pushStream = null;
    this.queue = [];
    this.totalQueued = 0;
    this.lostBytes = 0;
    this.sentBytes = 0;
    this.lastReport = Date.now();

    this._writing = false;
    this._pausedByBackpressure = false;
    this._drainHandlerBound = this._onDrain.bind(this);
    this._drainTimer = setInterval(() => this._tryDrain(), 50);
  }

  attachStream(stream) {
    if (this.pushStream && this.pushStream.removeListener) {
      this.pushStream.removeListener('drain', this._drainHandlerBound);
    }
    this.pushStream = stream;
    if (this.pushStream && this.pushStream.on) {
      this.pushStream.on('drain', this._drainHandlerBound);
    }
  }

  _onDrain() {
    this._pausedByBackpressure = false;
    this._tryDrain();
  }

  push(chunk) {
    if (!chunk || !Buffer.isBuffer(chunk)) return;
    if (this.queue.length === 0 && this.pushStream && !this._pausedByBackpressure) {
      try {
        const ok = this.pushStream.write(chunk);
        this.sentBytes += chunk.length;
        if (!ok) {
          this._pausedByBackpressure = true;
        }
        this._reportIfNeeded();
        return;
      } catch (err) {
      }
    }

    this.queue.push(chunk);
    this.totalQueued += chunk.length;

    if (this.totalQueued > this.maxBufferBytes) {
      while (this.queue.length && this.totalQueued > this.maxBufferBytes) {
        const dropped = this.queue.shift();
        this.totalQueued -= dropped.length;
        this.lostBytes += dropped.length;
      }
      log(`[stream] buffer ${((this.totalQueued / this.maxBufferBytes) * 100).toFixed(1)}% full → dropped ${this.lostBytes}B total (queue=${this.totalQueued}B)`);
    }

    if (this.totalQueued >= this.highWaterBytes) {
      if (!this._highEmitted) {
        this._highEmitted = true;
        this.emit('high');
      }
    }

    this._tryDrain();
    this._reportIfNeeded();
  }

  _tryDrain() {
    if (this._writing) return;
    if (!this.pushStream) return;
    if (this.queue.length === 0) {
      if (this._highEmitted && this.totalQueued <= this.resumeWaterBytes) {
        this._highEmitted = false;
        this.emit('ok');
      }
      return;
    }

    this._writing = true;
    let bytesThisTick = 0;
    while (this.queue.length && bytesThisTick < this.batchBytes) {
      const buf = this.queue[0];
      const take = Math.min(buf.length, this.batchBytes - bytesThisTick);
      const chunk = take === buf.length ? buf : buf.slice(0, take);
      try {
        const ok = this.pushStream.write(chunk);
        this.sentBytes += chunk.length;
        bytesThisTick += chunk.length;

        if (take === buf.length) this.queue.shift();
        else this.queue[0] = buf.slice(take);
        this.totalQueued -= chunk.length;

        if (!ok) {
          this._pausedByBackpressure = true;
          break;
        }
      } catch (err) {
        break;
      }
    }
    this._writing = false;

    if (this._highEmitted && this.totalQueued <= this.resumeWaterBytes) {
      this._highEmitted = false;
      this.emit('ok');
    }

    this._reportIfNeeded();
  }

  _reportIfNeeded() {
    const now = Date.now();
    if (now - this.lastReport < this.reportInterval) return;
    const elapsed = now - this.lastReport;
    const kbps = ((this.sentBytes / elapsed) * 1000) / 1024;
    const util = (this.totalQueued / this.maxBufferBytes) * 100;
    log(`[stream] sent ${this.sentBytes}B | lost ${this.lostBytes}B | rate ${kbps.toFixed(1)}KB/s | queue ${util.toFixed(1)}%`);
    this.lastReport = now;
    this.sentBytes = 0;
  }

  stop() {
    clearInterval(this._drainTimer);
  }
}

module.exports = { StreamController };
