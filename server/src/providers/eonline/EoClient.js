import { HttpError } from '../../errors.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Прямые хосты E-Online (ротация при недоступности). */
export const DEFAULT_HOSTS = [
  'http://94.249.239.63',
  'http://94.249.239.37',
  'http://94.249.239.11',
  'http://77.90.33.109'
];

/** skaz-кластер — карточки сериалов ссылаются на него. */
export const SKAZ_HOSTS = [
  'http://online3.skaz.tv',
  'http://online8.skaz.tv'
];

const STATUS_REST = new Set([200, 201, 202, 203, 204, 206]);

/**
 * Клиент E-Online — работает чистым REST GET (E-ONLINE-REPORT §9):
 * авторизация = `account_email` + `uid` в URL каждого запроса, на потоки
 * skaz/voidboost обязателен заголовок `Origin: http://lampa.mx`.
 *
 * Методы:
 * - getLite(params) а   — HTML страницы `lite/<balancer>?<params>`;
 * - openLiteUrl(url)   — открыть абсолютный lite-URL из `method:"link"` карточки
 *                          (перевод/сезон), при необходимости дописывая auth;
 * - resolveStream(url) — серверный резолв `method:"call"` потока: GET m3u8 с
 *                          `Origin`, отдать финальный URL (voidboost/skaz);
 * - isDead(rch)        — детект `{"rch":true}`.
 *
 * «Мёртвые» ответы (rch, accsdb, disable, 5xx) возвращаются как null —
 * провайдер не отдаёт их клиенту и не светит источник.
 */
export class EoClient {
  constructor(options = {}) {
    this.balancer = String(options.balancer || '').trim();
    this.hosts = normalizeHosts(options.hosts);
    this.skazHosts = normalizeHosts(options.skazHosts);
    this.accountEmail = String(options.accountEmail || '').trim();
    this.uid = String(options.uid || '').trim();
    this.origin = String(options.origin || 'http://lampa.mx').trim();
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this._hostIndex = 0;
    this._skazIndex = 0;
  }

  enabled() {
    return Boolean(this.balancer && this.accountEmail && this.uid);
  }

  /**
   * GET `lite/<balancer>?…`. Возвращает HTML-строку (финальная страница),
   * или null если источник для тайтла недоступен (rch/503/disable).
   */
  async getLite(params = {}) {
    const url = this.buildLiteUrl(params);
    if (!url) return null;
    const response = await this.fetch(url);
    if (!response) return null;
    const text = await response.text().catch(() => null);
    if (text == null) return null;
    return isUsablePage(text) ? text : null;
  }

  /**
   * Открыть URL из карточки `method:"link"`. Абсолютный ltv URL (часто на
   * skaz-хосте). Дописываем auth-параметры, если их там нет.
   */
  async openLiteUrl(url) {
    if (!url) return null;
    const target = withAuth(url, this.accountEmail, this.uid);
    const { response, finalUrl } = await this.fetchResolved(target);
    if (!response) return null;
    const text = await response.text().catch(() => null);
    if (text == null) return null;
    return isUsablePage(text) ? text : null;
  }

  /**
   * Серверный резолв `method:"call"` потока: m3u8-URL с `play=true` →
   * GET с `Origin` → финальный манифест/mp4 (redirects). Auth-параметры
   * наружу не уходят.
   */
  async resolveStream(streamUrl) {
    if (!streamUrl) throw new HttpError(400, 'eonline_no_stream', 'E-Online: пустая ссылка потока');
    const target = withAuth(streamUrl, this.accountEmail, this.uid);
    const { response, finalUrl } = await this.fetchResolved(target, { Origin: this.origin });
    if (!response) return null;
    return finalUrl || String(target).trim();
  }

  /** Собрать URL `lite/<balancer>?…` (для тестов — проверить параметры). */
  buildLiteUrl(params = {}) {
    if (!this.balancer) return '';
    const host = this.hosts.length ? this.hosts[this._hostIndex % this.hosts.length] : DEFAULT_HOSTS[0];
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    }
    query.set('account_email', this.accountEmail);
    query.set('uid', this.uid);
    this._hostIndex += 1;
    return `${host}/lite/${this.balancer}?${query.toString()}`;
  }

  async fetch(url, options = {}) {
    if (!url) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(this.timeoutMs), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: { accept: '*/*', ...(options.headers || {}) },
        signal: controller.signal
      });
      if (!response) return null;
      if (STATUS_REST.has(response.status)) return response;
      // 5xx/redir-глоба — недоступен источник.
      response.body?.cancel?.().catch?.(() => {});
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Полная ссылка + redirect-follow, отдаёт финальный URL. */
  async fetchResolved(url, headers = {}) {
    if (!url) return { response: null, finalUrl: null };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: { accept: '*/*', ...headers },
        redirect: 'follow',
        signal: controller.signal
      });
      if (!response) return { response: null, finalUrl: null };
      return { response, finalUrl: response.url || '' };
    } catch {
      return { response: null, finalUrl: null };
    } finally {
      clearTimeout(timer);
    }
  }

  _pickHost() {
    const pool = this.hosts.length ? this.hosts : DEFAULT_HOSTS;
    return pool[this._hostIndex % pool.length];
  }
}

/** Отфильтровать не-HTML/null/rch ответы — вернуть текст либо null. */
export function isUsablePage(text) {
  const head = String(text || '').trim();
  if (!head) return false;
  if (head.startsWith('{') || head.startsWith('[')) return false; // JSON (rch/accsdb/disable)
  const firstLine = head.split(/\r?\n/, 1)[0].toLowerCase();
  if (['null', 'disable', 'false', 'not found'].includes(firstLine)) return false;
  return true;
}

/** Детект `{"rch":true}` — WebSocket-источник, REST недоступен. */
export function isRchPayload(text) {
  return /"rch"\s*:\s*true/i.test(String(text || ''));
}

function normalizeHosts(list) {
  if (!Array.isArray(list)) return [];
  return list.map((host) => String(host).trim().replace(/\/+$/, '')).filter(Boolean);
}

/** Дописать `account_email`/`uid` в URL, если их нет. */
function withAuth(url, accountEmail, uid) {
  const target = String(url || '').trim();
  if (!target) return '';
  try {
    const parsed = new URL(target);
    if (accountEmail && !parsed.searchParams.has('account_email')) parsed.searchParams.set('account_email', accountEmail);
    if (uid && !parsed.searchParams.has('uid')) parsed.searchParams.set('uid', uid);
    return parsed.toString();
  } catch {
    return target;
  }
}