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
 *
 * При accsdb=true (учётная запись не grant) ротация хостов останавливается
 * мгновенно — это ошибка credentials, а не конкретного хоста. Диагностика
 * доступна через `this.lastAccsdb`.
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
    /** @type {{message: string}|null} последний accsdb-ответ (учётная запись не grant). */
    this.lastAccsdb = null;
  }

  enabled() {
    return Boolean(this.balancer && this.accountEmail && this.uid);
  }

  /**
   * GET `lite/<balancer>?…`. Возвращает HTML-строку (финальная страница),
   * или null если источник для тайтла недоступен (rch/accsdb/503/disable).
   *
   * При 5xx/сетевой ошибке на одном хосте пула перебираем остальные хосты
   * (fetchHosts) — это и есть честный «балансер как в Е-Online»: кластерные
   * ноды флакают по одной (напр. online3.skaz.tv даёт 503 для kinoflix при
   * живых карточках на online8/94.249.*).
   */
  async getLite(params = {}) {
    const url = this.buildLiteUrl(params);
    if (!url) return null;
    this.lastAccsdb = null;
    const response = await this.fetchHosts(url);
    if (!response) return null;
    const text = await response.text().catch(() => null);
    if (text == null) return null;
    const accsdb = extractAccsdbMessage(text);
    if (accsdb) {
      this.lastAccsdb = accsdb;
      return null;
    }
    return isUsablePage(text) ? text : null;
  }

  /**
   * Открыть URL из карточки `method:"link"`. Абсолютный lite URL (часто на
   * skaz-хосте). Дописываем auth-параметры, если их там нет. 5xx на одном
   * хосте → следующий хост пула (fetchResolvedHosts).
   */
  async openLiteUrl(url) {
    if (!url) return null;
    this.lastAccsdb = null;
    const target = withAuth(url, this.accountEmail, this.uid);
    const { response, finalUrl } = await this.fetchResolvedHosts(target);
    if (!response) return null;
    const finalURL = finalUrl || target;
    const text = await response.text().catch(() => null);
    if (text == null) return null;
    const accsdb = extractAccsdbMessage(text);
    if (accsdb) {
      this.lastAccsdb = accsdb;
      return null;
    }
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
   * JSON-режим `call`-потока (как Lampac `/lite/<balancer>/video` без `play`):
   * убираем `.m3u8` и `play=true` → GET с `Origin` → JSON-дескриптор
   * `{method:'play', url:'primary or reserve', quality:{label:url},
   *   subtitles[], segments{skip[]}, hls_manifest_timeout}`.
   *
   * Это то, что видит E-Online/Lampac и чего НЕ хватает single-резолву
   * RedirectToPlay (нет мапы качеств, субтитров, reserve-фолбэка).
   * Возвращает распарсенный объект или null (не JSON/method!=play/url пуст/
   * сеть) — провайдер в этом случае уйдёт в resolveStream-фолбэк.
   */
  async resolveVideoJson(streamUrl) {
    const raw = String(streamUrl || '').trim();
    if (!raw) return null;
    let target;
    try {
      const video = new URL(withAuth(raw, this.accountEmail, this.uid));
      video.pathname = video.pathname.replace(/\.m3u8$/i, '');
      video.searchParams.delete('play');
      target = video.toString();
    } catch {
      return null;
    }
    const { response } = await this.fetchResolvedHosts(target, { Origin: this.origin });
    if (!response) return null;
    const text = await response.text().catch(() => null);
    if (!text) return null;
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || parsed.method !== 'play' || !String(parsed.url || '').trim()) return null;
    return parsed;
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
    const response = await this.fetchHosts(url);
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

  /**
   * GET `lite/…` с перебором хостов пула: первый кандидат — URL как есть
   * (уже на хосте ротации buildLiteUrl), при 5xx/network/reset пробуем
   * каждый следующий хост пула с тем же путём. Возвращает первый рабочий
   * Response (status 2xx) либо null, когда весь пул мёртв. FAIL-NOT-RETRY:
   * 200-ответы (в т.ч. rch/accsdb/JSON) НЕ перебираются — это «нет источника
   * для тайтла», а не сбой хоста.
   */
  async fetchHosts(url, options = {}) {
    for (const target of this._hostTargets(url)) {
      const response = await this.fetch(target, options);
      if (response) return response;
    }
    return null;
  }

  /**
   * fetchResolved с перебором хостов пула (для link-страниц карточек):
   * 5xx/redirect-glob на хосте → следующий хост. Используется только
   * openLiteUrl; resolveStream не ротирует хосты (потоки CDN-токеновые).
   */
  async fetchResolvedHosts(url, headers = {}) {
    for (const target of this._hostTargets(url)) {
      const { response, finalUrl } = await this.fetchResolved(target, headers);
      if (response && STATUS_REST.has(response.status)) return { response, finalUrl };
    }
    return { response: null, finalUrl: null };
  }

  /**
   * Порядок кандидатов-хостов для URL: (0) URL как есть — уже на выбранном
   * buildLiteUrl хосте ротации; (1..N) остальные хосты пула с тем же путём.
   * Start-индекс = где URL в пуле; если URL не из пула (резервный/CDN), идём
   * от текущей точки ротации `_hostIndex`. Каждый хост пула — ровно один раз.
   */
  _hostTargets(url) {
    const pool = this.hosts.length ? this.hosts : SKAZ_DEFAULT_HOSTS;
    const targets = [url];
    if (!pool.length) return targets;
    const origin = safeOrigin(url);
    const startIndex = pool.indexOf(origin) !== -1 ? pool.indexOf(origin) : this._hostIndex % pool.length;
    for (let step = 1; step < pool.length; step += 1) {
      targets.push(swapHost(url, pool[(startIndex + step) % pool.length]));
    }
    return targets;
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
 * Извлечь сообщение из accsdb-ответа `{"accsdb":true,"msg":"..."}`.
 * Возвращает `{message: string}` или null, если это не accsdb.
 */
export function extractAccsdbMessage(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('{')) return null;
  if (!isAccsdbPayload(raw)) return null;
  let msg = '';
  try {
    const parsed = JSON.parse(raw);
    msg = String(parsed.msg || '').trim();
  } catch {
    // JSON битый, но accsdb в тексте есть — возвращаем generic.
  }
  return { message: msg || 'Учётная запись не подтверждена (accsdb)' };
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

/** Origin URL-а (для поиска в пуле хостов), или '' при невалидном URL. */
function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * Переписать URL на другой хост пула (тот же путь/query — lite-страницы
 * кластера обслуживаются любым бэкендом). Протокол берём из исходного URL.
 */
function swapHost(url, nextHost) {
  try {
    const parsed = new URL(url);
    parsed.host = String(nextHost).replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return parsed.toString();
  } catch {
    return url;
  }
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