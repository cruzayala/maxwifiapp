'use strict';

function isMikrotikMutationCommand(command) {
  return /\/(?:add|set|remove|enable|disable|move|reset-counters)$/.test(String(command || '').toLowerCase());
}

class MikrotikCommandQueue {
  constructor({ maxPending = 40, recoveryTimeoutMs = 1500 } = {}) {
    this.maxPending = maxPending;
    this.recoveryTimeoutMs = recoveryTimeoutMs;
    this.pending = [];
    this.running = false;
    this.sequence = 0;
    this.metrics = {
      completed: 0, errors: 0, timeouts: 0, recoveryTimeouts: 0, rejectedReads: 0,
      maxDepth: 0, lastDurationMs: null, lastQueueWaitMs: null,
      lastError: null, lastErrorAt: null, lastTimeoutAt: null,
    };
  }

  enqueue(task, { timeoutMs, label = 'command', priority = 0, onTimeout = null } = {}) {
    if (priority <= 0 && this.pending.length >= this.maxPending) {
      this.metrics.rejectedReads += 1;
      const error = new Error(`MikroTik queue overloaded (${this.pending.length} pending)`);
      error.code = 'MIKROTIK_QUEUE_OVERLOADED';
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      this.pending.push({
        task, timeoutMs, label, priority, onTimeout, resolve, reject,
        sequence: ++this.sequence, enqueuedAt: Date.now(),
      });
      this.pending.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
      this.metrics.maxDepth = Math.max(this.metrics.maxDepth, this.pending.length);
      void this._drain();
    });
  }

  snapshot() {
    return {
      ...this.metrics,
      depth: this.pending.length + (this.running ? 1 : 0),
      pending: this.pending.length,
      running: this.running,
    };
  }

  async _drain() {
    if (this.running) return;
    this.running = true;
    while (this.pending.length) {
      const item = this.pending.shift();
      const startedAt = Date.now();
      this.metrics.lastQueueWaitMs = startedAt - item.enqueuedAt;
      let timer;
      try {
        const result = await Promise.race([
          Promise.resolve().then(item.task),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const error = new Error(`MikroTik timeout ${item.timeoutMs}ms: ${item.label}`);
              error.code = 'MIKROTIK_TIMEOUT';
              reject(error);
            }, item.timeoutMs);
          }),
        ]);
        this.metrics.completed += 1;
        item.resolve(result);
      } catch (error) {
        this.metrics.errors += 1;
        this.metrics.lastError = String(error.message || error).slice(0, 300);
        this.metrics.lastErrorAt = new Date().toISOString();
        if (error.code === 'MIKROTIK_TIMEOUT') {
          this.metrics.timeouts += 1;
          this.metrics.lastTimeoutAt = this.metrics.lastErrorAt;
          if (item.onTimeout) {
            let recoveryTimer;
            try {
              await Promise.race([
                Promise.resolve().then(() => item.onTimeout(error)),
                new Promise((resolve) => {
                  recoveryTimer = setTimeout(() => {
                    this.metrics.recoveryTimeouts += 1;
                    resolve();
                  }, this.recoveryTimeoutMs);
                }),
              ]);
            } catch {
              // Recovery is best effort. The queue must continue draining.
            } finally {
              if (recoveryTimer) clearTimeout(recoveryTimer);
            }
          }
        }
        item.reject(error);
      } finally {
        if (timer) clearTimeout(timer);
        this.metrics.lastDurationMs = Date.now() - startedAt;
      }
    }
    this.running = false;
  }
}

module.exports = { MikrotikCommandQueue, isMikrotikMutationCommand };
