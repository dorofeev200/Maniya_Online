export class RetryPolicy {
  constructor({ retries = 2, baseDelayMs = 250, maxDelayMs = 2000, retryStatuses = [408, 429, 500, 502, 503, 504] } = {}) {
    this.retries = Math.max(0, retries);
    this.baseDelayMs = Math.max(0, baseDelayMs);
    this.maxDelayMs = Math.max(this.baseDelayMs, maxDelayMs);
    this.retryStatuses = new Set(retryStatuses);
  }

  shouldRetry({ attempt, error = null, response = null }) {
    if (attempt >= this.retries) return false;
    if (response) return this.retryStatuses.has(response.status);
    return Boolean(error);
  }

  delayFor(attempt) {
    const delay = this.baseDelayMs * (2 ** Math.max(0, attempt));
    return Math.min(this.maxDelayMs, delay);
  }

  async wait(attempt) {
    const delay = this.delayFor(attempt);
    if (delay <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
