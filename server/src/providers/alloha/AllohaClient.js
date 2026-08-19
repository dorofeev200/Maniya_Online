import { HttpClient } from '../shared/http/HttpClient.js';
import { RateLimiter } from '../shared/http/RateLimiter.js';
import { RetryPolicy } from '../shared/http/RetryPolicy.js';
import { buildUrl } from '../shared/utils/Url.js';

// API-хост Alloha (поиск/детали). То же значение, что жёстко зашито в Lampac
// (Modules/OnlinePaid/Alloha/ModInit.cs). Оставаться актуальным: может меняться.
const DEFAULT_API_HOST = 'https://apbugall.org/v2';

// Linkhost Alloha — отдельный хост для /direct (стримы). На api-хосте /direct
// отсутствует (404); реальный эндпоинт живёт на linkhost (401 без secret_token).
const DEFAULT_LINK_HOST = 'https://torso-as.stloadi.live';

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeQuery(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
}

export class AllohaClient {
  constructor({ baseUrl, apiHost, linkHost, token = '', secretToken = '', httpClient = null, timeoutMs = 10000 } = {}) {
    const resolvedApi = normalizeBaseUrl(apiHost || baseUrl) || DEFAULT_API_HOST;
    const resolvedLink = normalizeBaseUrl(linkHost) || DEFAULT_LINK_HOST;

    // HttpClient резолвит относительный путь через new URL(): абсолютный путь
    // (/movies/…) съедает базовый pathname (/v2). Чтобы префикс пути сохранился,
    // baseUrl-ом делаем чистый origin, а pathname хоста добавляем к пути сами.
    const apiUrl = new URL(resolvedApi);
    const linkUrl = new URL(resolvedLink);
    this.apiPathBase = apiUrl.pathname.replace(/\/+$/, '');
    this.linkPathBase = linkUrl.pathname.replace(/\/+$/, '');

    // Bearer-токен для API (поиск/детали). Требуется, иначе TOKEN_REQUIRED 401.
    this.token = String(token || '').trim();
    // secret_token для /direct; если не задан отдельно — считаем его тем же токеном.
    this.secretToken = String(secretToken || this.token || '').trim();

    const retryPolicy = new RetryPolicy({ retries: 2, baseDelayMs: 300, maxDelayMs: 1500 });
    const rateLimiter = new RateLimiter({ intervalMs: 250, maxConcurrent: 2 });

    this.httpClient = httpClient || new HttpClient({
      baseUrl: apiUrl.origin,
      provider: 'alloha',
      timeoutMs,
      retryPolicy,
      rateLimiter
    });
    // Отдельный пул на linkhost: /direct идёт с другого хоста.
    this.linkClient = new HttpClient({
      baseUrl: linkUrl.origin,
      provider: 'alloha',
      timeoutMs,
      retryPolicy,
      rateLimiter
    });
  }

  apiPath(subpath, params) {
    return `${this.apiPathBase}${buildUrl(subpath, params)}`;
  }

  linkPath(subpath, params) {
    return `${this.linkPathBase}${buildUrl(subpath, params)}`;
  }

  apiHeaders() {
    return {
      accept: 'application/json',
      authorization: this.token ? `Bearer ${this.token}` : undefined
    };
  }

  async search({ title, originalTitle, year, type, imdb, kp, id, fallback = false } = {}) {
    const query = { year, type };

    let items = [];
    if (imdb || kp || id) {
      items = await this.searchByIds({ imdb, kp, year });
    } else {
      items = await this.searchByName(title || originalTitle, year);
      // Фолбэк original_title → title при пустой выдаче (как в Lampac Controller).
      if (fallback && !items.length && originalTitle && title && originalTitle !== title) {
        items = await this.searchByName(originalTitle, year);
      }
    }

    return { query, items };
  }

  async searchByName(name, year) {
    if (!name) return [];
    const path = this.apiPath('/movies/name/list', normalizeQuery({ name, ...(year ? { year } : {}) }));
    const response = await this.httpClient.get(path, { headers: this.apiHeaders() });
    return this.parseSearchResponse(await response.json());
  }

  async searchByIds({ imdb, kp, year }) {
    const path = this.apiPath('/movies/search', normalizeQuery({ imdb, kp, year }));
    const response = await this.httpClient.get(path, { headers: this.apiHeaders() });
    return this.parseSearchResponse(await response.json());
  }

  async details(token) {
    const path = this.apiPath(`/movies/token/${encodeURIComponent(String(token))}`);
    const response = await this.httpClient.get(path, { headers: this.apiHeaders() });
    return (await response.json()) || {};
  }

  async streams({ token, token_movie: tokenMovie, translation, translationId, season, episode, directorsCut = false, ip = '127.0.0.1' } = {}) {
    const movieToken = token || tokenMovie;
    if (!movieToken || !this.secretToken) return { file: null, tracks: [], hlsSources: [] };

    const params = normalizeQuery({
      secret_token: this.secretToken,
      token_movie: movieToken,
      ip,
      translation: translationId || translation,
      season: Number(season) > 0 ? season : undefined,
      episode: Number(episode) > 0 ? episode : undefined,
      directors_cut: directorsCut ? 'true' : undefined
    });

    const path = this.linkPath('/direct', params);
    const response = await this.linkClient.get(path, { headers: { accept: 'application/json' } });
    return this.parseStreamsResponse(await response.json());
  }

  async parseSearchResponse(response) {
    const payload = response && typeof response === 'object' && !Array.isArray(response) ? response : await response.json();
    // /movies/name/list → data: MediaItem[]; /movies/search?id= → data: MediaItem (один).
    const data = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : [];
    return data.map((item) => this.normalizeSearchItem(item)).filter(Boolean);
  }

  normalizeSearchItem(item) {
    if (!item || typeof item !== 'object') return null;
    return {
      id: item.token || item.id || null,
      title: item.name || item.original_name || null,
      original_title: item.original_name || item.name || null,
      year: item.year ? Number(item.year) : null,
      type: item.category?.slug === 'serial' || item.category?.slug === 'series' || item.category?.slug === 'anime' ? 'serial' : 'movie',
      poster: item.poster || null,
      category: item.category || null,
      token: item.token || null,
      translations: Array.isArray(item.translations) ? item.translations : [],
      seasons: Array.isArray(item.seasons) ? item.seasons : []
    };
  }

  parseStreamsResponse(payload) {
    const data = payload && payload.data && typeof payload.data === 'object' ? payload.data : payload || {};
    const file = data?.file || null;
    return {
      file,
      tracks: Array.isArray(file?.tracks) ? file.tracks : [],
      hlsSources: Array.isArray(file?.hlsSource) ? file.hlsSource : []
    };
  }
}