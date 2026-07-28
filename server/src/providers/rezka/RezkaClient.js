import { HttpClient } from '../shared/http/HttpClient.js';
import { RateLimiter } from '../shared/http/RateLimiter.js';
import { RetryPolicy } from '../shared/http/RetryPolicy.js';
import { buildUrl } from '../shared/utils/Url.js';

const DEFAULT_BASE_URL = 'https://rezka.ag';

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

function normalizeQuery(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
}

export class RezkaClient {
  constructor({ baseUrl = DEFAULT_BASE_URL, httpClient = null, timeoutMs = 10000 } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.httpClient = httpClient || new HttpClient({
      baseUrl: this.baseUrl,
      provider: 'rezka',
      timeoutMs,
      retryPolicy: new RetryPolicy({ retries: 2, baseDelayMs: 300, maxDelayMs: 1500 }),
      rateLimiter: new RateLimiter({ intervalMs: 250, maxConcurrent: 2 })
    });
  }

  async search({ title, originalTitle, year, type } = {}) {
    const query = normalizeQuery({
      query: title || originalTitle || '',
      year,
      type: type === 'serial' ? 'series' : 'movie'
    });
    try {
      const response = await this.httpClient.get('/api/search', { headers: { accept: 'application/json' } });
      return this.parseSearchResponse(response, query);
    } catch {
      return { query, items: [], selected: null };
    }
  }

  async card(id) {
    const response = await this.httpClient.get(`/api/card/${encodeURIComponent(String(id))}`, { headers: { accept: 'application/json' } });
    return response.json();
  }

  async streams(id) {
    const response = await this.httpClient.get(`/api/streams/${encodeURIComponent(String(id))}`, { headers: { accept: 'application/json' } });
    return response.json();
  }

  async parseSearchResponse(response, query) {
    const payload = await response.json();
    const items = Array.isArray(payload?.results) ? payload.results : [];
    const normalized = items
      .map((item) => this.normalizeSearchItem(item))
      .filter(Boolean);
    return {
      query,
      items: normalized,
      selected: normalized.find((item) => this.matchesQuery(item, query)) || null
    };
  }

  normalizeSearchItem(item) {
    if (!item || typeof item !== 'object') return null;
    return {
      id: item.id || item.slug || item.url || null,
      title: item.title || item.name || null,
      original_title: item.original_title || item.originalName || null,
      year: item.year ? Number(item.year) : null,
      type: item.type || null,
      link: item.link || item.url || null,
      poster: item.poster || null,
      translation: item.translation || null,
      language: item.language || null
    };
  }

  matchesQuery(item, query) {
    if (!item || !query) return false;
    const title = String(item.title || '').toLowerCase();
    const original = String(item.original_title || '').toLowerCase();
    const queryTitle = String(query.query || '').toLowerCase();
    if (!queryTitle) return false;
    return title.includes(queryTitle) || original.includes(queryTitle);
  }
}
