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
  constructor({ host = 'https://filmix.my', tvHost = 'https://api.filmix.tv', token = '', userDeviceId = randomDeviceId(), tvUser = '', tvPassword = '', httpClient = null, primaryClient = null, apiFxClient = null, tvAuthClient = null } = {}) {
    this.host = host.replace(/\/$/, '');
    this.tvHost = tvHost.replace(/\/$/, '');
    this.token = token;
    this.userDeviceId = userDeviceId;
    this.tvUser = tvUser || '';
    this.tvPassword = tvPassword || '';
    // Кэш FilmixTV-токена: { hash, accessToken, expiresAt }.
    // Хэш живёт долго ( persist на диске в Lampac), accessToken — 5 мин.
    this._tvTokenCache = null;

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
    // Отдельный клиент для auth-эндпоинтов (request-token, auth, refresh) —
    // короткий таймаут, 1 ретрай, без rate-limit (шанс вызова 1 раз в 4+ мин).
    this.tvAuthClient = tvAuthClient || new HttpClient({
      provider: 'filmix',
      headers: buildHeaders({ Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' }),
      timeoutMs: 15000,
      retryPolicy: new RetryPolicy({ retries: 1, baseDelayMs: 500, maxDelayMs: 2000 }),
      rateLimiter: null
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

  // ── FilmixTV auth (api.filmix.tv Bearer) ──────────────────────────────

  /**
   * Повторяет auth-флоу Lampac FilmixTV.EnsureAccessToken():
   *   1. GET  /api-fx/request-token → hash
   *   2. POST /api-fx/auth  (user_name, user_passw, session:true, hash-заголовок) → accessToken
   * Кэширует в памяти на 4 мин (Lampac: 5 мин). При провале сбрасывает кэш.
   * Возвращает { hash, accessToken } или null.
   */
  async ensureTvAccessToken() {
    if (!this.tvUser || !this.tvPassword) return null;

    // Проверяем кэш (4 мин = 240 000 мс, Lampac использует 5 мин).
    if (this._tvTokenCache && Date.now() < this._tvTokenCache.expiresAt) {
      return this._tvTokenCache;
    }

    try {
      // Шаг 1: получаем hash-токен (нужен как заголовок при /api-fx/auth).
      const hashResp = await this.tvAuthClient.get(`${this.tvHost}/api-fx/request-token`);
      const hashData = await hashResp.json();
      const hash = hashData?.token;
      if (!hash || typeof hash !== 'string') {
        logger.warn('filmix_tv_request_token_empty', { tvHost: this.tvHost });
        return null;
      }

      // Шаг 2: авторизуемся, получаем accessToken.
      const authBody = JSON.stringify({
        user_name: this.tvUser,
        user_passw: this.tvPassword,
        session: true
      });
      const authResp = await this.tvAuthClient.post(
        `${this.tvHost}/api-fx/auth`,
        authBody,
        { headers: { hash } }
      );
      const authData = await authResp.json();
      const accessToken = authData?.accessToken;
      if (!accessToken || typeof accessToken !== 'string') {
        logger.warn('filmix_tv_auth_no_token', {
          tvHost: this.tvHost,
          hasMsg: !!authData?.msg,
          msg: String(authData?.msg || '').slice(0, 120)
        });
        return null;
      }

      this._tvTokenCache = {
        hash,
        accessToken,
        expiresAt: Date.now() + 4 * 60 * 1000
      };

      logger.info('filmix_tv_auth_ok', {
        tvHost: this.tvHost,
        tokenLen: accessToken.length
      });

      return this._tvTokenCache;
    } catch (error) {
      logger.warn('filmix_tv_auth_failed', {
        tvHost: this.tvHost,
        error: error instanceof Error ? error.message : String(error)
      });
      // Сбрасываем кэш при ошибке, чтобы следующий вызов перепробовал.
      this._tvTokenCache = null;
      return null;
    }
  }

  /**
   * Возвращает заголовки для авторизованного api-fx-запроса
   * (Authorization: Bearer + hash) или null, если учётки нет / auth провален.
   */
  async tvAuthHeaders() {
    const token = await this.ensureTvAccessToken();
    if (!token) return null;
    return {
      Authorization: `Bearer ${token.accessToken}`,
      hash: token.hash
    };
  }

  // ── Search ────────────────────────────────────────────────────────────

  async search({ title, originalTitle, clarification = 0, year, similar = false } = {}, context = null) {
    // PRIMARY: api.filmix.tv/api-fx/list — живой Filmix source (Lampac FilmixTV.Search;
    // live-аудит FILMIX-001: HTTP 200 ~0.3с). Один стори-запрос, как в Lampac.
    const story = clarification === 1 ? title : (originalTitle || title);
    let matches = await this.searchApiFx(story, context);

    // FALLBACK: filmix.my/api/v2/search (Lampac Filmix.Search/gosearch). Сейчас mirror
    // даёт 301→501, но оставлен на случай восстановления. Два стори-попа (как Search2).
    if (!matches.length) {
      matches = await this.searchApiV2(clarification === 1 ? originalTitle : title, context);
      if (!matches.length) matches = await this.searchApiV2(clarification === 1 ? title : originalTitle, context);
    }

    return { items: matches, selected: this.pickSearchMatch(matches, { title, originalTitle, year, similar }) };
  }

  async searchMovie(params = {}, context = null) {
    return this.search({ ...params, type: 'movie' }, context);
  }

  async searchSeries(params = {}, context = null) {
    return this.search({ ...params, type: 'serial' }, context);
  }

  /**
   * PRIMARY-поиск: api.filmix.tv/api-fx/list (Lampac FilmixTV.Search).
   * Параметры как у Lampac: search=<story>&limit=48. Bearer+hash добавляются только
   * если задана FilmixTV-учётка; без неё — анонимно (live: работает и без учётки).
   */
  async searchApiFx(story, context = null) {
    if (!story) return [];

    const authHeaders = await this.tvAuthHeaders();
    const opts = this.buildRequestOptions(context);
    if (authHeaders) opts.headers = { ...opts.headers, ...authHeaders };

    try {
      const response = await this.httpClient.get(
        buildUrl(`${this.tvHost}/api-fx/list`, { search: story, limit: 48 }),
        opts
      );
      const root = await response.json();
      return Array.isArray(root?.items) ? root.items : [];
    } catch (error) {
      logger.warn('filmix_api_fx_search_failed', {
        tvHost: this.tvHost,
        hasAuth: !!authHeaders,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * FALLBACK-поиск: filmix.my/api/v2/search (Lampac Filmix.Search). Быстрый клиент без
   * ретраев (3с): если mirror мёртв (301→501), fallback включается сразу, без long-hang.
   */
  async searchApiV2(story, context = null) {
    if (!story) return [];

    try {
      const response = await this.primaryClient.get(buildUrl(`${this.host}/api/v2/search`, { story, ...this.appArgs }), this.buildRequestOptions(context));
      const root = await response.json();
      return Array.isArray(root) ? root : [];
    } catch {
      // Mirror недоступен (geo/Cloudflare/301) — провайдер уже отдал primary api-fx.
      return [];
    }
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

  // ── Card ──────────────────────────────────────────────────────────────

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
   *
   * Если заданы FilmixTV-учётные данные (tvUser+tvPassword) — добавляет
   * Bearer-авторизацию (как Lampac FilmixTV), что защищает от Cloudflare.
   * Без учётки запрос идёт анонимно и может быть заблокирован.
   */
  async videoLinks(postId, context = null) {
    if (postId === undefined || postId === null || postId === '') return null;

    const opts = this.buildRequestOptions(context);
    const authHeaders = await this.tvAuthHeaders();
    if (authHeaders) opts.headers = { ...opts.headers, ...authHeaders };

    try {
      const response = await this.apiFxClient.get(
        `${this.tvHost}/api-fx/post/${encodeURIComponent(String(postId))}/video-links`,
        opts
      );
      const root = await response.json();
      return root == null ? null : root;
    } catch (error) {
      logger.warn('filmix_video_links_failed', {
        postId,
        tvHost: this.tvHost,
        hasAuth: !!authHeaders,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  // ── Utils ─────────────────────────────────────────────────────────────

  normalizeSearchName(value) {
    return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
  }
}
