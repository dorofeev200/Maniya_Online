export class RateLimiter {
  constructor({ intervalMs = 1000, maxConcurrent = 4 } = {}) {
    this.intervalMs = Math.max(0, intervalMs);
    this.maxConcurrent = Math.max(1, maxConcurrent);
    this.active = 0;
    this.lastStartedAt = 0;
    this.queue = [];
  }

  async schedule(task) {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  acquire() {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.drain();
    });
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    this.drain();
  }

  drain() {
    if (this.active >= this.maxConcurrent || this.queue.length === 0) return;
    const waitMs = Math.max(0, this.intervalMs - (Date.now() - this.lastStartedAt));
    setTimeout(() => {
      if (this.active >= this.maxConcurrent || this.queue.length === 0) return;
      this.active += 1;
      this.lastStartedAt = Date.now();
      const resolve = this.queue.shift();
      resolve();
      this.drain();
    }, waitMs);
  }
}
