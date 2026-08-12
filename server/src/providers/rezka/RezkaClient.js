import { HttpClient } from '../shared/http/HttpClient.js';
import { RateLimiter } from '../shared/http/RateLimiter.js';
import { RetryPolicy } from '../shared/http/RetryPolicy.js';
import { buildHeaders } from '../shared/utils/Headers.js';
import { logger } from '../../logger.js';

import {
  hasAnubisChallenge,
  solveAnubisChallenge,
  buildPassChallengeUrl,
  parseEpisodesHtml
} from './RezkaCodec.js';

const DEFAULT_BASE_URL = 'https://rezka.ag';

// Именованные Anubis-куки (живая инсталляция Rezka, Anubis 1.25):
//   - cookie-verification: тестовая, ставит страница челленджа (= challenge id),
//     обязана присутствовать при запросе pass-challenge;
//   - auth: JWT-доступ, выдаётся ответом 302 на pass-challenge, должен уезжать
//     в повторный запрос, чтобы контент отдали без нового челленджа.
const ANUBIS_VERIFY_COOKIE = 'techaro.lol-anubis-cookie-verification';
const ANUBIS_AUTH_COOKIE = 'techaro.lol-anubis-auth';

// Кэш get_episodes: сезоны/серии Rezka per-translator и не меняются между
// переключениями голоса/сезона в UI. Непустой результат живёт 10 минут,
// иначе объединение сезонов по 20+ переводам (как у «Дом Дракона») каждый раз
// гоняло бы столько же AJAX-запросов.
const EPISODES_CACHE_TTL_MS = 10 * 60 * 1000;

// Навигационные заголовки (поиск/embed) — как в Lampac Service.cs Search/Embed.
const DEFAULT_NAV_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Cache-Control': 'no-cache',
  DNT: '1',
  Pragma: 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

// AJAX-заголовки к get_cdn_series — как в Lampac Service.cs (origin, x-requested-with).
const DEFAULT_AJAX_HEADERS = {
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Cache-Control': 'no-cache',
  DNT: '1',
  Origin: '',
  Pragma: 'no-cache',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'X-Requested-With': 'XMLHttpRequest'
};

function normalizeBaseUrl(value) {
  const base = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(base) ? base : `https://${base}`;
}

/** Минимальный cookie-джар: Set-Cookie → name=value; header(). */
class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  setFromHeaders(setCookieValues) {
    const values = Array.isArray(setCookieValues) ? setCookieValues : setCookieValues ? [setCookieValues] : [];
    for (const raw of values) {
      if (!raw) continue;
      const pair = String(raw).split(';')[0].trim();
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name || value.toLowerCase() === 'deleted') continue;
      this.cookies.set(name, value);
    }
  }

  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  set(name, value) {
    this.cookies.set(name, value);
  }

  has(name) {
    return this.cookies.has(name);
  }
}

/** `{ts}` из Lampac: unix + случайный суффикс 101..999. */
function ajaxTimestamp() {
  return `${Math.floor(Date.now() / 1000)}${Math.floor(Math.random() * 900) + 100}`;
}

function mergeHeaders(base, extra) {
  const out = { ...base, ...(extra || {}) };
  for (const [key, value] of Object.entries(out)) {
    if (value === undefined || value === null) delete out[key];
  }
  return out;
}

export class RezkaClient {
  constructor({ baseUrl = DEFAULT_BASE_URL, login = '', password = '', premium = false, timeoutMs = 12000, loginCooldownMs = 30000, httpClient = null, loggerImpl = null } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.siteOrigin = this.baseUrl;
    this.login = String(login || '');
    this.password = String(password || '');
    this.premium = Boolean(premium);
    this.loginCooldownMs = loginCooldownMs;
    this._loginPromise = null;
    this._loginFailedAt = 0;
    this.cookies = new CookieJar();
    this.referer = `${this.baseUrl}/`;
    this.httpClient = httpClient || new HttpClient({
      baseUrl: this.baseUrl,
      provider: 'rezka',
      timeoutMs,
      retryPolicy: new RetryPolicy({ retries: 1, baseDelayMs: 400, maxDelayMs: 1200 }),
      rateLimiter: new RateLimiter({ intervalMs: 300, maxConcurrent: 2 })
    });
    this.log = loggerImpl || logger;
    this._episodesCache = new Map();
  }

  get isReady() {
    return this.cookies.has('dle_user_id') && this.cookies.has('dle_password');
  }

  /**
   * Ленивая авторизация premium. Логин только когда:
   * - premium включён (иначе no-op, false);
   * - активной сессии нет (isReady === false — куки истекли/пропали);
   * - нет незавершённого логина (in-flight promise — одновременные запросы
   *   делят один POST, а не делают свой);
   * - прошла пауза после последней неудачи (loginCooldownMs, без горячего ретрая).
   * При успехе куки кладутся в jar и переиспользуются следующими запросами.
   * Провайдеру это прозрачно: методы стримов сами ждут сессию.
   */
  async ensurePremium() {
    if (!this.premium) return false;
    if (this.isReady) return true;
    if (this._loginPromise) return this._loginPromise;
    if (this._loginFailedAt && Date.now() - this._loginFailedAt < this.loginCooldownMs) return false;

    this._loginPromise = this._login();
    try {
      return await this._loginPromise;
    } finally {
      this._loginPromise = null;
    }
  }

  async _login() {
    const ok = await this.loginAsync(this.login, this.password);
    if (!ok) this._loginFailedAt = Date.now();
    return ok;
  }

  /** Авторизация premium: POST /ajax/login/ → Set-Cookie → jar. */
  async loginAsync(login = this.login, password = this.password) {
    if (!login || !password) return false;
    try {
      const body = new URLSearchParams({
        login_name: login,
        login_password: password,
        login_not_save: '0'
      });
      const result = await this.fetchWithAnubis(
        '/ajax/login/',
        {
          method: 'POST',
          headers: { ...DEFAULT_AJAX_HEADERS, Origin: this.baseUrl, Referer: `${this.baseUrl}/` },
          body
        }
      );
      this.cookies.setFromHeaders(result.response.headers.getSetCookie?.() || result.response.headers.get('set-cookie'));
      return this.cookies.has('dle_user_id') && this.cookies.has('dle_password');
    } catch (error) {
      this.log.warn('rezka_login_failed', {
        baseUrl: this.baseUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /** Поиск → HTML-строка (null при ошибке/блокировке). */
  async searchHtml({ query = '', clarification = 0 } = {}) {
    const term = clarification === 1 ? query : query;
    const path = `/search/?do=search&subaction=search&q=${encodeURIComponent(term || '')}`;
    try {
      const result = await this.fetchWithAnubis(path, { headers: this.navHeaders() });
      return result.text || null;
    } catch (error) {
      this.log.warn('rezka_search_failed', {
        baseUrl: this.baseUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /** Embed/card → HTML-строка страницы (null при ошибке/блокировке). */
  async page(href) {
    const path = String(href || '').startsWith('http')
      ? href
      : `${this.baseUrl}/${String(href).replace(/^\/+/, '')}`;
    try {
      const result = await this.fetchWithAnubis(path, { headers: this.navHeaders() });
      return result.text || null;
    } catch (error) {
      this.log.warn('rezka_page_failed', {
        baseUrl: this.baseUrl,
        href,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  navHeaders() {
    return mergeHeaders({ ...DEFAULT_NAV_HEADERS, Referer: `${this.baseUrl}/` }, this.cookieHeader());
  }

  cookieHeader() {
    const cookie = this.cookies.header();
    return cookie ? { Cookie: cookie } : {};
  }

  /** Сырой AJAX-запрос get_cdn_series (с Anubis-обходом). Возвращает JSON или null. */
  async ajax(body, referer) {
    const headers = mergeHeaders(
      { ...DEFAULT_AJAX_HEADERS, Origin: this.baseUrl, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      { ...(referer ? { Referer: referer } : {}), ...this.cookieHeader() }
    );
    try {
      const result = await this.fetchWithAnubis(
        `/ajax/get_cdn_series/?t=${ajaxTimestamp()}`,
        { method: 'POST', headers, body: String(body) }
      );
      if (!result.text) return null;
      return JSON.parse(result.text);
    } catch (error) {
      this.log.warn('rezka_ajax_failed', {
        baseUrl: this.baseUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /** Сезоны/серии выбранного перевода: `{ seasons, episodes }` или null. */
  async getEpisodes(id, translatorId, referer) {
    const key = `${id}:${translatorId}`;
    const hit = this._episodesCache.get(key);
    if (hit && Date.now() - hit.ts < EPISODES_CACHE_TTL_MS) return hit.value;

    const body = new URLSearchParams({ id, translator_id: String(translatorId), action: 'get_episodes' });
    const root = await this.ajax(body, referer);
    if (!root || root.success !== true) return null;

    const parsed = parseEpisodesHtml(root.seasons, root.episodes);
    // Кэшируем только непустой результат: пустой/ошибочный = транзиент → ретрай.
    if (parsed && (parsed.seasons.length || parsed.episodes.length)) {
      this._episodesCache.set(key, { ts: Date.now(), value: parsed });
    }
    return parsed;
  }

  /** Поток фильма: `{ success, url(base64), subtitle, premium }` или null. */
  async getStreamMovie(id, translatorId, { director = 0, favs = '' } = {}, referer) {
    await this.ensurePremium();
    const body = new URLSearchParams({
      id,
      translator_id: String(translatorId),
      is_camrip: '0',
      is_ads: '0',
      is_director: String(director || 0),
      favs: favs || '',
      action: 'get_movie'
    });
    return this.ajax(body, referer);
  }

  /** Поток серии: `{ success, url(base64), subtitle, premium }` или null. */
  async getStreamEpisode(id, translatorId, season, episode, { favs = '' } = {}, referer) {
    await this.ensurePremium();
    const body = new URLSearchParams({
      id,
      translator_id: String(translatorId),
      season: String(season),
      episode: String(episode),
      favs: favs || '',
      action: 'get_stream'
    });
    return this.ajax(body, referer);
  }

  /**
   * Единый запрос с авто-обходом Anubis: первый ответ может содержать
   * `anubis_challenge` → решаем PoW, ставим cookie, повторяем запрос.
   * Возвращает `{ response, text }`.
   */
  async fetchWithAnubis(path, options = {}) {
    const headers = mergeHeaders(this.httpClient.headers, options.headers);

    let response = await this.httpClient.request(path, { ...options, headers });
    let text = await this.safeText(response);

    if (text && hasAnubisChallenge(text)) {
      const passed = await this.passAnubis(text, String(response.url || path), { ...options, headers });
      if (passed) {
        // Пересобираем Cookie: заголовки из вызова собраны ДО решения челленджа
        // и не содержат свежую JWT-куку доступа. Без этого повторный запрос
        // снова получит челлендж.
        const retryHeaders = mergeHeaders(options.headers, this.cookieHeader());
        response = await this.httpClient.request(path, { ...options, headers: retryHeaders });
        text = await this.safeText(response);
      }
    }

    return { response, text };
  }

  /** Решение Anubis: PoW nonce → pass-challenge → cookie verification. */
  async passAnubis(html, redir, options) {
    try {
      const solution = solveAnubisChallenge(html);
      if (!solution) return false;

      const referer = options?.headers?.Referer || this.referer;
      const siteOrigin = new URL(this.baseUrl).origin;
      this.cookies.set(ANUBIS_VERIFY_COOKIE, solution.id);

      const passUrl = buildPassChallengeUrl(siteOrigin, solution, redir);
      // fetchOnce (а не .get): pass-challenge возвращает 302, а для HttpClient
      // response.ok ложно → request() кинул бы HttpError до чтения Set-Cookie.
      // Сырой ответ нужен именно чтобы вытащить JWT-куку с 302.
      const response = await this.httpClient.fetchOnce(passUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: mergeHeaders(
          {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            Referer: referer,
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin'
          },
          this.cookieHeader()
        )
      });
      this.cookies.setFromHeaders(response.headers.getSetCookie?.() || response.headers.get('set-cookie'));
      // Успех — только когда Anubis выдал JWT-доступ (302 → Set-Cookie auth).
      // redirect:'manual' не даёт undici проглотить куку при следовании 302.
      const passed = this.cookies.has(ANUBIS_AUTH_COOKIE) || response.redirected || response.status === 302;
      if (!passed) {
        this.log.warn('rezka_anubis_unverified', {
          baseUrl: this.baseUrl,
          status: response.status,
          url: String(response.url || '')
        });
      }
      return passed;
    } catch (error) {
      this.log.warn('rezka_anubis_failed', {
        baseUrl: this.baseUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  async safeText(response) {
    try {
      return await response.text();
    } catch {
      return '';
    }
  }
}

export default RezkaClient;
