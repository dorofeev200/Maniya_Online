import { HttpError } from '../../errors.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Бэкенд-пул skaz-кластера (только серверные хосты, НЕ CDN): ротация при
 * недоступности/503. ССЕСС 12: 94.249.* отдают 503/302, online3/8.skaz.tv
 * живы напрямую — поэтому первыми идут skaz.tv, IP — резерв.
 */
export const SKAZ_DEFAULT_HOSTS = [
  'http://online3.skaz.tv',
  'http://online8.skaz.tv',
  'http://94.249.239.63',
  'http://94.249.239.37',
  'http://94.249.239.11',
  'http://77.90.33.109'
];

const STATUS_REST = new Set([200, 201, 202, 203, 204, 206]);

/**
 * Клиент skaz-кластера (Lampac-протокол) — работает чистым REST GET:
 * авторизация = `account_email` + `uid` в URL каждого запроса; на потоки
 * ck_aсc/voidboost обязателен заголовок `Origin: http://lampa.mx`.
 * Это 1:1-перенос EoClient (`E-ONLINE-REPORT §9`) с расширениями:
 * - ротация ТОЛЬКО по бэкенд-пулу (CDN-хосты здесь не ротируются);
 * - `discover()` — список доступных балансеров через `lite/withsearch`
 *   (fallback на статический список, если discover недоступен);
 * - X-Kit-AesGcm/memkey НЕ блочём: lite/* живёт без них (доказано live).
 *
 * Методы:
 * - getLite(params)   — HTML страницы `lite/<balancer>?<params>`;
 * - openLiteUrl(url)  — открыть абсолютный lite-URL из `method:"link"` карточки
 *                        (перевод/сезон), при необходимости дописывая auth;
 * - resolveStream(url) — серверный резолв `method:"call"` потока: GET m3u8 с
 *                        `Origin`, отдать финальный URL (voidboost/skaz);
 * - discover()        — GET `lite/withsearch` → список балансеров или null;
 * - isDead(rch)       — детект `{"rch":true}`.
 *
 * «Мёртвые» ответы (rch, accsdb, disable, 5xx) возвращаются как null —
 * провайдер не отдаёт их клиенту и не светит источник.
 */
export class SkazClient {
  constructor(options = {}) {
    this.balancer = String(options.balancer || '').trim();
    this.hosts = normalizeHosts(options.hosts);
    this.accountEmail = String(options.accountEmail || '').trim();
    this.uid = String(options.uid || '').trim();
    this.origin = String(options.origin || 'http://lampa.mx').trim();
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this._hostIndex = 0;
  }

  enabled() {
    return Boolean(this.balancer && this.accountEmail && this.uid);
  }

  /**
   * GET `lite/<balancer>?…`. Возвращает HTML-строку (финальная страница),
   * или null если источник для тайтла недоступен (rch/accsdb/503/disable).
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
   * Открыть URL из карточки `method:"link"`. Абсолютный lite URL (часто на
   * skaz-хосте). Дописываем auth-параметры, если их там нет.
   */
  async openLiteUrl(url) {
    if (!url) return null;
    const target = withAuth(url, this.accountEmail, this.uid);
    const { response, finalUrl } = await this.fetchResolved(target);
    if (!response) return null;
    const finalURL = finalUrl || target;
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
    if (!streamUrl) throw new HttpError(400, 'skaz_no_stream', 'skaz: пустая ссылка потока');
    const target = withAuth(streamUrl, this.accountEmail, this.uid);
    const { response, finalUrl } = await this.fetchResolved(target, { Origin: this.origin });
    if (!response) return null;
    return finalUrl || String(target).trim();
  }

  /**
   * Discovery: GET `lite/withsearch` → список доступных балансеров.
   * Возвращает массив slug или null (недоступен/пусто). Не бросается —
   * вызов всегда «необязательный», конфиг покрывает статическим списком.
   */
  async discover() {
    if (!this.accountEmail || !this.uid) return null;
    const url = this.buildLiteUrl({}, { discovery: true });
    if (!url) return null;
    const response = await this.fetch(url);
    if (!response) return null;
    const text = await response.text().catch(() => null);
    if (!text) return null;
    const balancers = parseBalancersFromSearch(text);
    return balancers.length ? balancers : null;
  }

  /** Собрать URL `lite/<balancer>?…` (для тестов — проверить параметры). */
  buildLiteUrl(params = {}, extra = {}) {
    if (!this.balancer) return '';
    const host = this.hosts.length ? this.hosts[this._hostIndex % this.hosts.length] : SKAZ_DEFAULT_HOSTS[0];
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    }
    query.set('account_email', this.accountEmail);
    query.set('uid', this.uid);
    this._hostIndex += 1;
    return `${host}/lite/${this.discoverPath(extra) || this.balancer}?${query.toString()}`;
  }

  /** Путь для discover() — `lite/withsearch` вместо `lite/<balancer>`. */
  discoverPath(extra = {}) {
    return extra.discovery ? 'withsearch' : this.balancer;
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
    const pool = this.hosts.length ? this.hosts : SKAZ_DEFAULT_HOSTS;
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

/** Детект `{"accsdb":true}` — неверная пара email+uid (в JSON-теле). */
export function isAccsdbPayload(text) {
  return /"accsdb"\s*:\s*true/i.test(String(text || ''));
}

/**
 * Разобрать балансеры из ответа `lite/withsearch`. Форматы:
 * - HTML с ссылками `lite/<slug>` / кнопок с data-balancer;
 * - JSON-массив `["filmix","rezka",…]` или объект.
 * Ничего не валидирует снаружи — возвращает slug-строки.
 */
function parseBalancersFromSearch(text) {
  const raw = String(text || '');
  const slugs = [];

  // JSON: массив или объект с массивами значений
  const jsonMatch = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const values = Array.isArray(parsed) ? parsed : Object.values(parsed);
      for (const value of values) {
        if (typeof value === 'string') slugs.push(value.trim());
        else if (value && typeof value === 'object' && value.balancer) slugs.push(String(value.balancer));
      }
    } catch {
      /* не JSON — парсим HTML ниже */
    }
  }

  if (!slugs.length) {
    // data-атрибут/ссылки: ищем `lite/<slug>` и `data-balancer="<slug>"`
    const linkRe = /lite\/([a-z0-9]+)/gi;
    let match;
    while ((match = linkRe.exec(raw)) !== null) slugs.push(match[1]);
    const attrRe = /data-(?:balancer|slug)\s*=\s*["']([a-z0-9]+)["']/gi;
    while ((match = attrRe.exec(raw)) !== null) slugs.push(match[1]);
  }

  const seen = new Set();
  return slugs.filter((slug) => {
    if (!slug || seen.has(slug)) return false;
    seen.add(slug);
    return /^[a-z0-9]{2,24}$/.test(slug);
  });
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