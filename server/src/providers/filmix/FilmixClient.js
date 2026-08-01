import { HttpClient } from '../shared/http/HttpClient.js';
import { RateLimiter } from '../shared/http/RateLimiter.js';
import { RetryPolicy } from '../shared/http/RetryPolicy.js';
import { buildHeaders } from '../shared/utils/Headers.js';
import { buildUrl } from '../shared/utils/Url.js';

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function safeParseCard(text) {
  if (!text) return null;
  try {
    const payload = JSON.parse(text.replace('"playlist":[],', '"playlist":null,'));
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function randomDeviceId(length = 16) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

export class FilmixClient {
  constructor({ host = 'https://filmix.my', tvHost = 'https://api.filmix.tv', token = '', userDeviceId = randomDeviceId(), httpClient = null } = {}) {
    this.host = host.replace(/\/$/, '');
    this.tvHost = tvHost.replace(/\/$/, '');
    this.token = token;
    this.userDeviceId = userDeviceId;
    this.httpClient = httpClient || new HttpClient({
      provider: 'filmix',
      headers: buildHeaders({ Accept: 'application/json, text/plain, */*' }),
      retryPolicy: new RetryPolicy({ retries: 2, baseDelayMs: 300, maxDelayMs: 1500 }),
      rateLimiter: new RateLimiter({ intervalMs: 250, maxConcurrent: 2 })
    });
  }

  get appArgs() {
    return {
      app_lang: 'ru_RU',
      user_dev_apk: '2.2.13',
      user_dev_id: this.userDeviceId,
      user_dev_name: 'Xiaomi 24069PC21G',
      user_dev_os: '12',
      user_dev_token: this.token,
      user_dev_vendor: 'Xiaomi'
    };
  }

  async search({ title, originalTitle, clarification = 0, year, similar = false } = {}) {
    const story = clarification === 1 ? title : (originalTitle || title);
    const primary = await this.searchApi(story);
    const matches = primary.length ? primary : await this.searchFallback(clarification === 1 ? originalTitle : title, clarification === 1 ? title : originalTitle);
    return { items: matches, selected: this.pickSearchMatch(matches, { title, originalTitle, year, similar }) };
  }

  async searchMovie(params = {}) {
    return this.search({ ...params, type: 'movie' });
  }

  async searchSeries(params = {}) {
    return this.search({ ...params, type: 'serial' });
  }

  async searchByExternalIds({ kp, imdb, year } = {}) {
    const queries = [kp, imdb].filter(Boolean).map(String);
    const results = [];
    for (const query of queries) {
      const found = await this.searchApi(query);
      results.push(...found.filter((item) => !year || Number(item.year) === Number(year)));
    }
    return results;
  }

  async searchApi(story) {
    if (!story) return [];
    try {
      const response = await this.httpClient.get(buildUrl(`${this.host}/api/v2/search`, { story, ...this.appArgs }));
      const root = await safeJson(response);
      return Array.isArray(root) ? root.filter(isRecord) : [];
    } catch {
      return [];
    }
  }

  async searchFallback(primary, secondary) {
    for (const story of [primary, secondary]) {
      if (!story) continue;
      try {
        const response = await this.httpClient.get(buildUrl(`${this.tvHost}/api-fx/list`, { search: story, limit: 48 }));
        const root = await safeJson(response);
        if (Array.isArray(root?.items) && root.items.length) return root.items.filter(isRecord);
      } catch {
        continue;
      }
    }
    return [];
  }

  pickSearchMatch(items, { title, originalTitle, year, similar = false } = {}) {
    if (similar) return null;
    const normalizedTitle = this.normalizeSearchName(title);
    const normalizedOriginal = this.normalizeSearchName(originalTitle);
    const exact = items.filter((item) => {
      const names = [item.title, item.original_title, item.original_name].map((value) => this.normalizeSearchName(value));
      const sameName = names.includes(normalizedTitle) || names.includes(normalizedOriginal);
      return sameName && (!year || Number(item.year) === Number(year));
    });
    return exact.length === 1 ? exact[0] : null;
  }

  async card(postId) {
    try {
      const response = await this.httpClient.get(buildUrl(`${this.host}/api/v2/post/${postId}`, this.appArgs));
      const text = await response.text();
      return safeParseCard(text);
    } catch {
      return null;
    }
  }

  normalizeSearchName(value) {
    return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
  }
}
