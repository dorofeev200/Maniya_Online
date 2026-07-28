import { Provider } from '../base.js';

const DEFAULT_TIMEOUT_MS = 5000;

function normalizeBaseUrl(baseUrl) {
  const url = String(baseUrl || '').trim();
  return url ? url.replace(/\/+$/, '') : '';
}

function normalizeTimeout(timeout) {
  const value = Number(timeout);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function queryFromContext(context) {
  if (!context || typeof context !== 'object') return {};
  if (context.query && typeof context.query === 'object') return { ...context.query };
  return { ...context };
}

export class LampacProvider extends Provider {
  static id = 'lampac';
  static title = 'Lampac';

  constructor(options = {}) {
    super(options);
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = String(options.apiKey || '').trim();
    this.timeout = normalizeTimeout(options.timeout);
    this.isEnabled = Boolean(options.enabled) && Boolean(this.baseUrl);
  }

  name() {
    return this.id;
  }

  enabled() {
    return this.isEnabled;
  }

  async search(context) {
    if (!this.enabled()) return [];
    return this.#request('/api/search', queryFromContext(context));
  }

  async movie(context) {
    if (!this.enabled()) return [];
    return this.#request('/api/movie', queryFromContext(context));
  }

  async serial(context) {
    if (!this.enabled()) return [];
    return this.#request('/api/serial', queryFromContext(context));
  }

  async streams(context) {
    if (!this.enabled()) return [];
    return this.#request('/api/streams', queryFromContext(context));
  }

  async #request(path, query = {}) {
    const url = new URL(path, `${this.baseUrl}/`);

    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });

    if (this.apiKey && !url.searchParams.has('apikey')) {
      url.searchParams.set('apikey', this.apiKey);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal
      });

      if (!response.ok) {
        const error = new Error(`Lampac request failed with HTTP ${response.status}`);
        error.statusCode = response.status;
        error.statusText = response.statusText;
        throw error;
      }

      return response.json();
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutError = new Error(`Lampac request timed out after ${this.timeout}ms`);
        timeoutError.code = 'lampac_timeout';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export default LampacProvider;
