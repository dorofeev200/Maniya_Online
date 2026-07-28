import { HttpError } from '../errors/HttpError.js';
import { TimeoutError } from '../errors/TimeoutError.js';
import { buildHeaders } from '../utils/Headers.js';
import { RetryPolicy } from './RetryPolicy.js';

export class HttpClient {
  constructor({ fetchImpl = globalThis.fetch, baseUrl = '', headers = {}, timeoutMs = 10000, retryPolicy = new RetryPolicy(), rateLimiter = null, provider = null } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
    this.headers = headers;
    this.timeoutMs = timeoutMs;
    this.retryPolicy = retryPolicy;
    this.rateLimiter = rateLimiter;
    this.provider = provider;
  }

  get(path, options = {}) {
    return this.request(path, { ...options, method: 'GET' });
  }

  post(path, body, options = {}) {
    return this.request(path, { ...options, method: 'POST', body });
  }

  async request(path, options = {}) {
    const run = () => this.executeWithRetry(path, options);
    return this.rateLimiter ? this.rateLimiter.schedule(run) : run();
  }

  async executeWithRetry(path, options) {
    let lastError = null;
    for (let attempt = 0; attempt <= this.retryPolicy.retries; attempt += 1) {
      try {
        const response = await this.fetchOnce(path, options);
        if (!response.ok && this.retryPolicy.shouldRetry({ attempt, response })) {
          await this.retryPolicy.wait(attempt);
          continue;
        }
        if (!response.ok) throw await this.toHttpError(response, options.method || 'GET');
        return response;
      } catch (error) {
        lastError = error;
        if (error instanceof HttpError) break;
        if (!this.retryPolicy.shouldRetry({ attempt, error })) break;
        await this.retryPolicy.wait(attempt);
      }
    }
    throw lastError;
  }

  async fetchOnce(path, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);
    const url = this.resolveUrl(path);

    try {
      return await this.fetchImpl(url, {
        ...options,
        headers: buildHeaders({ ...this.headers, ...(options.headers || {}) }),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new TimeoutError('Provider request timed out', { timeoutMs: options.timeoutMs || this.timeoutMs, url, provider: this.provider, cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  resolveUrl(path) {
    if (!this.baseUrl) return String(path);
    return new URL(path, this.baseUrl).toString();
  }

  async toHttpError(response, method) {
    let details = null;
    try {
      details = await response.text();
    } catch {
      details = null;
    }
    return new HttpError(`Provider HTTP ${response.status}`, { statusCode: response.status, url: response.url, method, provider: this.provider, details });
  }
}
