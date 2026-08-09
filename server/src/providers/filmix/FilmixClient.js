import { logger } from '../../logger.js';
import { HttpClient } from '../shared/http/HttpClient.js';
import { RateLimiter } from '../shared/http/RateLimiter.js';
import { RetryPolicy } from '../shared/http/RetryPolicy.js';
import { buildHeaders } from '../shared/utils/Headers.js';
import { buildUrl } from '../shared/utils/Url.js';

function randomDeviceId(length = 16) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

export class FilmixClient {
  constructor({ host = 'https://filmix.my', tvHost = 'https://api.filmix.tv', token = '', userDeviceId = randomDeviceId(), httpClient = null, primaryClient = null, apiFxClient = null } = {}) {
    this.host = host.replace(/\/$/, '');
    this.tvHost = tvHost.replace(/\/$/, '');
    this.token = token;
    this.userDeviceId = userDeviceId;
    const headers = buildHeaders({ Accept: 'application/json, text/plain, */*' });
    const rateLimiter = new RateLimiter({ intervalMs: 250, maxConcurrent: 2 });
    this.httpClient = httpClient || new HttpClient({
      provider: 'filmix',
      headers,
      retryPolicy: new RetryPolicy({ retries: 2, baseDelayMs: 300, maxDelayMs: 1500 }),
      rateLimiter
    });
    // Primary API на filmix.my при geo-блоке висит до таймаута на каждом
    // ретрае. Для карточки/поиска заводим отдельный клиент без ретраев с
    // коротким таймаутом — фолбэк на api-fx должен включаться быстро.
    // Диагноз 2026-08-09 (§16.2): primary с VPS мёртв, интермиттентные
    // long-hang'и до 8с × 4 вызова давали worst-case 32с+ (30с-таймаут фильма
    // в матриксе). 3с хватает живому JSON-эндпоинту с запасом.
    this.primaryClient = primaryClient || new HttpClient({
      provider: 'filmix',
      headers,
      timeoutMs: 3000,
      retryPolicy: new RetryPolicy({ retries: 0 }),
      rateLimiter
    });
    // Клиент для browser-API api-fx на api.filmix.tv: работает анонимно, но
    // эндпоинт video-links тяжёлый (до ~40с на холодный кэш, бывает 502),
    // поэтому свой таймаут и более терпеливый ретрай.
    this.apiFxClient = apiFxClient || new HttpClient({
      provider: 'filmix',
      headers,
      timeoutMs: 45000,
      retryPolicy: new RetryPolicy({ retries: 2, baseDelayMs: 1200, maxDelayMs: 5000 }),
      rateLimiter
    });
  }

  buildRequestOptions(context = {}) {
    const headers = this.buildRequestHeaders(context);
    const cookie = this.buildCookieHeader(context);
    if (cookie) headers.Cookie = cookie;
    return { headers };
  }

  buildRequestHeaders(context = {}) {
    const request = context?.request || {};
    const headerSource = request.headers || context?.headers || {};
    const headers = {};

    for (const [key, value] of Object.entries(headerSource)) {
      if (value == null || value === '') continue;
      if (Array.isArray(value)) {
        headers[key] = value.join(', ');
        continue;
      }
      headers[key] = String(value);
    }

    if (!headers['X-Forwarded-For'] && context?.ip) headers['X-Forwarded-For'] = String(context.ip);
    if (!headers['X-Real-IP'] && context?.ip) headers['X-Real-IP'] = String(context.ip);

    return buildHeaders(headers);
  }

  buildCookieHeader(context = {}) {
    const request = context?.request || {};
    const headerSource = request.headers || context?.headers || {};
    const cookieHeader = headerSource.cookie || headerSource.Cookie || '';
    if (cookieHeader) return String(cookieHeader);

    const cookies = context?.cookies || request.cookies || {};
    if (!cookies || typeof cookies !== 'object') return '';

    return Object.entries(cookies)
      .filter(([, value]) => value != null && value !== '')
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
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

  async search({ title, originalTitle, clarification = 0, year, similar = false } = {}, context = null) {
    const story = clarification === 1 ? title : (originalTitle || title);
    const primary = await this.searchApi(story, context);
    const matches = primary.length ? primary : await this.searchFallback(clarification === 1 ? originalTitle : title, clarification === 1 ? title : originalTitle, context);
    return { items: matches, selected: this.pickSearchMatch(matches, { title, originalTitle, year, similar }) };
  }

  async searchMovie(params = {}, context = null) {
    return this.search({ ...params, type: 'movie' }, context);
  }

  async searchSeries(params = {}, context = null) {
    return this.search({ ...params, type: 'serial' }, context);
  }

  async searchByExternalIds({ kp, imdb, year } = {}, context = null) {
    // Параллельно, а не последовательно: два primary-вызова по 8с (теперь 3с)
    // складывались в worst-case по каждому id. Promise.all не ускоряет живой
    // ответ, но срезает сумму таймаутов при long-hang до максимума одного.
    const queries = [kp, imdb].filter(Boolean).map(String);
    const found = await Promise.all(queries.map((query) => this.searchApi(query, context).catch(() => [])));
    return found.flat().filter((item) => !year || Number(item.year) === Number(year));
  }

  async searchApi(story, context = null) {
    if (!story) return [];

    try {
      const response = await this.primaryClient.get(buildUrl(`${this.host}/api/v2/search`, { story, ...this.appArgs }), this.buildRequestOptions(context));
      const root = await response.json();
      return Array.isArray(root) ? root : [];
    } catch {
      // Primary API может отдавать 403/Cloudflare; в этом случае провайдер
      // должен бесшовно уйти на рабочий fallback `api-fx/list`.
      return [];
    }
  }

  async searchFallback(primary, secondary, context = null) {
    for (const story of [primary, secondary]) {
      if (!story) continue;
      const response = await this.httpClient.get(buildUrl(`${this.tvHost}/api-fx/list`, { search: story, limit: 48 }), this.buildRequestOptions(context));
      const root = await response.json();
      if (Array.isArray(root?.items) && root.items.length) return root.items;
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

  async card(postId, context = null) {
    try {
      const response = await this.primaryClient.get(buildUrl(`${this.host}/api/v2/post/${postId}`, this.appArgs), this.buildRequestOptions(context));
      const text = await response.text();
      if (!text) return null;
      return JSON.parse(text.replace('"playlist":[],', '"playlist":null,'));
    } catch (error) {
      // Primary API может быть закрыт Cloudflare (403/обрыв соединения) —
      // провайдер уходит на browser-API video-links, но провал логируем,
      // чтобы не прятать деградацию в тихом фолбэке.
      logger.warn('filmix_card_primary_failed', {
        postId,
        host: this.host,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Анонимный источник карточки через browser-API api.filmix.tv.
   * Возвращает финальные (уже разрешённые) ссылки:
   *   фильм  → [{ voiceover, files: [{ url, quality, proPlus }] }]
   *   сериал → { "Озвучка": { "season-1": { season, episodes: { e1: { episode, files } } } } }
   * Не требует токена в отличие от /api/v2/post. null при недоступности.
   */
  async videoLinks(postId, context = null) {
    if (postId === undefined || postId === null || postId === '') return null;
    try {
      const response = await this.apiFxClient.get(
        `${this.tvHost}/api-fx/post/${encodeURIComponent(String(postId))}/video-links`,
        this.buildRequestOptions(context)
      );
      const root = await response.json();
      return root == null ? null : root;
    } catch (error) {
      logger.warn('filmix_video_links_failed', {
        postId,
        tvHost: this.tvHost,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  normalizeSearchName(value) {
    return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
  }
}
