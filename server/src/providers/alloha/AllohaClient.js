import { HttpClient } from '../shared/http/HttpClient.js';
import { RateLimiter } from '../shared/http/RateLimiter.js';
import { RetryPolicy } from '../shared/http/RetryPolicy.js';
import { buildUrl } from '../shared/utils/Url.js';

const DEFAULT_BASE_URL = 'https://apbugall.org/v2';

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

function normalizeQuery(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
}

export class AllohaClient {
  constructor({ baseUrl = DEFAULT_BASE_URL, httpClient = null, timeoutMs = 10000, token = '' } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = String(token || '').trim();
    this.httpClient = httpClient || new HttpClient({
      baseUrl: this.baseUrl,
      provider: 'alloha',
      timeoutMs,
      retryPolicy: new RetryPolicy({ retries: 2, baseDelayMs: 300, maxDelayMs: 1500 }),
      rateLimiter: new RateLimiter({ intervalMs: 250, maxConcurrent: 2 })
    });
  }

  async search({ title, originalTitle, year, type, imdb, kp } = {}) {
    const query = normalizeQuery({
      name: title || originalTitle || '',
      imdb,
      kp,
      year,
      serial: type === 'serial' ? 1 : 0
    });

    const path = buildUrl('/movies/search', query);
    const response = await this.httpClient.get(path, {
      headers: {
        accept: 'application/json',
        authorization: this.token ? `Bearer ${this.token}` : undefined
      }
    });

    return this.parseSearchResponse(response, query);
  }

  async details(token) {
    const response = await this.httpClient.get(`/movies/token/${encodeURIComponent(String(token))}`, {
      headers: {
        accept: 'application/json',
        authorization: this.token ? `Bearer ${this.token}` : undefined
      }
    });

    const payload = await response.json();
    return payload || {};
  }

  async streams({ token, translationId, season, episode, directorsCut = false, ip = '127.0.0.1' } = {}) {
    const path = buildUrl('/direct', normalizeQuery({
      secret_token: this.token,
      token_movie: token,
      translation: translationId,
      season,
      episode,
      ip,
      directors_cut: directorsCut ? 'true' : undefined
    }));
    const response = await this.httpClient.get(path, {
      headers: {
        accept: 'application/json'
      }
    });

    return this.parseStreamsResponse(await response.json());
  }

  async parseSearchResponse(response, query) {
    const payload = await response.json();
    const items = Array.isArray(payload?.data) ? payload.data : [];
    return {
      query,
      items: items.map((item) => this.normalizeSearchItem(item)).filter(Boolean)
    };
  }

  normalizeSearchItem(item) {
    if (!item || typeof item !== 'object') return null;
    return {
      id: item.token || item.id || null,
      title: item.name || item.original_name || null,
      original_title: item.original_name || item.name || null,
      year: item.year ? Number(item.year) : null,
      type: item.category?.slug === 'serial' || item.category?.slug === 'series' ? 'serial' : 'movie',
      poster: item.poster || null,
      category: item.category || null,
      token: item.token || null,
      translations: Array.isArray(item.translations) ? item.translations : [],
      seasons: Array.isArray(item.seasons) ? item.seasons : []
    };
  }

  parseStreamsResponse(payload) {
    const data = payload?.data || payload;
    const file = data?.file || null;
    return {
      file,
      tracks: Array.isArray(file?.tracks) ? file.tracks : [],
      hlsSources: Array.isArray(file?.hlsSource) ? file.hlsSource : []
    };
  }
}
