/**
 * SkazRchClient — WebSocket-клиент канала RCH skaz/Lampac-кластера.
 *
 * Протокол (1:1 по эталону Lampac, `docs/skaz-rch-001-report.md` §C):
 *
 *   1. Кластер отвечает на REST-запрос к rhub-балансеру JSON
 *      `{"rch":true,"nws":"ws(s)://<host>/nws"}` — он требует RCH-подключения.
 *   2. Клиент открывает `ws(s)://<host>/nws?id=<nws_id>&ver=1`.
 *      `<nws_id>` — тот же id, что позже пойдёт в `nws_id=` повторного запроса
 *      (сервер хранит соединения по connectionId === id из URL, NativeWebSocket.cs).
 *   3. Сервер шлёт `{"method":"Connected","args":[connectionId]}`.
 *   4. Клиент шлёт `{"method":"RchRegistry","args":[{host,rchtype,apkVersion,player}]}`
 *      → сервер отвечает `{"method":"RchRegistry","args":[clientIp,connectionId,rchtype]}`.
 *   5. После Registry клиент ПОВТОРЯЕТ исходный запрос с `nws_id=` (тот же хост!) —
 *      контекст RCH найден, кластер обслуживает запрос как обычно.
 *   6. Если кластеру нужно выполнить HTTP из сети клиента — он шлёт
 *      `{"method":"RchClient","args":[rchId,url,data,headers,returnHeaders]}`;
 *      клиент выполняет url и ПОСТит тело результата на `{origin}/rch/result?id=rchId`
 *      (или `/rch/gzresult`, gzip при >1000 байт).
 *   7. Keep-alive: клиент шлёт текстовый "ping" каждые ~50с; сервер отвечает "pong".
 *
 * Это СЕРВЕРНЫЙ RCH-клиент (Variant A, §12 отчёта): роль «клиентского устройства»
 * выполняет сам процесс Maniya — WS и повторный HTTP идут с одного IP/VPS
 * (проверка `ip == client.ip` в RchClient.SocketClient() проходит), а выполнение
 * pushed-URL — обычный валидированный fetch. НЕ заменяем RCH на голый REST:
 * весь round-trip (подключение → registry → повтор → result) сохранён.
 *
 * Безопасность (§H отчёта): каждый pushed-URL проходит `validateRchTarget`
 * (https, allowList-суффиксы, http только httpAllowHosts, запрет private/loopback/
 * metadata-IP, DNS-rebinding по lookup). Никакой произвольный URL без проверки.
 *
 * Логирование: только host/rchtype/requestId/время/результат — НИКОГДА токены,
 * nws_id, заголовки с секретами, тела запросов/ответов.
 */
import dns from 'node:dns';
import zlib from 'node:zlib';
import { config } from '../../config.js';
import { isHostAllowed, MANIFEST_MAX_BYTES } from '../../proxy.js';
import { defaultUserAgent } from '../shared/utils/UserAgent.js';

const RCH_RESULT_MAX_BYTES = MANIFEST_MAX_BYTES; // сервер кластера: 10MB, у нас 4MB — безопаснее
const PING_INTERVAL_MS = 50_000;                  // парно с поведением Lampa (каждые 50с)
const PING_TEXT = 'ping';

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '0.0.0.0']);
const PRIVATE_PREFIXES = [
  '10.', '192.168.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
  '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
  '100.64.', '169.254.', '224.', '240.', '255.'
];

/** Private/loopback/metadata-IP? (анти-SSRF: pushed-URL не может целиться во внутренние хосты). */
function isPrivateIp(ip) {
  if (!ip) return true;
  const v = String(ip).toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (LOOPBACK_IPS.has(v)) return true;
  if (v.includes(':')) return false; // IPv6 без явного запрета — не private-class (RFC1918 покрыт IPv4)
  return PRIVATE_PREFIXES.some((p) => v.startsWith(p));
}

/**
 * SSRF-гард для pushed RCH-URL (строже validateProxyTarget: loopback и private
 * запрещены ВСЕГДА, даже для httpAllowHosts — RCH-клиент не должен превращать
 * Maniya в прокси во внутреннюю сеть).
 */
export async function validateRchTarget(value, allowHosts = config.proxy.allowHosts, httpAllowHosts = config.proxy.httpAllowHosts) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new Error('invalid_rch_url');
  }

  if (parsed.protocol === 'https:') {
    if (!isHostAllowed(parsed.hostname, allowHosts)) throw new Error('rch_host_forbidden');
  } else if (parsed.protocol === 'http:') {
    if (!isHostAllowed(parsed.hostname, httpAllowHosts)) throw new Error('rch_host_forbidden');
  } else {
    throw new Error('rch_scheme_forbidden');
  }

  // DNS-rebinding: резолвим фактический IP в момент выполнения и запрещаем private.
  let resolved;
  try {
    const results = await dns.promises.lookup(parsed.hostname, { family: 4, all: true });
    resolved = results.length ? results : null;
  } catch {
    resolved = null; // DNS-ошибка — не можем подтвердить публичность → отказ
  }
  if (!resolved || resolved.some((r) => isPrivateIp(String(r.address)))) {
    throw new Error('rch_private_target');
  }

  return parsed;
}

/** `host` без схемы (для RchRegistry args: server.host, как location.host у Lampa). */
const bareHost = (host) => String(host || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');

/** Генерация nws_id (32 hex), match Lampa.uid(32). */
export function randomNwsId() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Zero-dep fallback (старый Node): Math.random-зёрна достаточно для session id.
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class SkazRchClient {
  /**
   * @param {object} options
   *  - nwsUrl   {string}   WS URL из `{"rch":true,"nws":"…/nws"}`
   *  - host     {string}   кластер-хост (для RchRegistry args и result-пост)
   *  - rchtype  {string}   'apk' (дефолт, live-probe) | 'web' | 'cors'
   *  - nwsId    {string}   внутренний id (генерится, если не передан)
   *  - timeoutMs{number}   дедлайн открытия (registry-ack)
   *  - fetchImpl{Function} DI для тестов, дефолт — global fetch
   *  - validateUrl {Function} DI для тестов (strict по умолчанию)
   *  - onClose  {Function} уведомление о закрытии сокета
   */
  constructor(options = {}) {
    const cfg = config.skaz?.rch || {};
    this.nwsUrl = String(options.nwsUrl || '');
    this.host = String(options.host || '').trim();
    this.rchtype = String(options.rchtype || cfg.rchtype || 'apk').trim();
    this.nwsId = String(options.nwsId || '').trim() || randomNwsId();
    this.timeoutMs = Number(options.timeoutMs || cfg.timeoutMs || 12_000);
    // Keep-alive: кластер рвёт молчащие WS через ~110с — пинг раньше.
    this.keepaliveMs = Number(options.keepaliveMs || cfg.keepaliveMs || PING_INTERVAL_MS);
    this.fetchImpl = options.fetchImpl || fetch;
    this.validateUrl = options.validateUrl || validateRchTarget;
    this.onClose = typeof options.onClose === 'function' ? options.onClose : null;

    this.socket = null;
    this.connectionId = null;
    this._openPromise = null;
    this._pingTimer = null;
    this._closed = false;
    this._closeListeners = [];
    /** Последняя ошибка категории (для диагностики): rch_open_timeout | ws_closed | rch_repeated. */
    this.lastError = null;
  }

  get isOpen() {
    return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN);
  }

  get isReady() {
    return this.isOpen && Boolean(this.connectionId);
  }

  /** Отмонитор клиентских колбэков. */
  onCloseHandler(cb) {
    this._closeListeners.push(cb);
    return () => {
      const i = this._closeListeners.indexOf(cb);
      if (i !== -1) this._closeListeners.splice(i, 1);
    };
  }

  /**
   * Установить WS + дождаться Connected → RchRegistry-ack.
   * Resolve — когда соединение готово (registry подтверждён) к повтору запроса.
   * Reject — таймаут/закрытие/некорректное сообщение (lastError категоризирован).
   */
  open() {
    if (this.isReady) return Promise.resolve(this);
    if (this._openPromise) return this._openPromise;

    this._openPromise = new Promise((resolve, reject) => {
      const wsUrl = new URL(this.nwsUrl);
      wsUrl.searchParams.set('id', this.nwsId);
      wsUrl.searchParams.set('ver', '1');

      let socket;
      try {
        socket = new WebSocket(wsUrl.toString());
      } catch (error) {
        this.lastError = 'rch_open_failed';
        reject(new Error('rch_open_failed'));
        this._openPromise = null;
        return;
      }
      this.socket = socket;

      let settled = false;
      const failOpen = (reason) => {
        if (settled) return;
        settled = true;
        this.lastError = reason;
        this.close();
        reject(new Error(reason));
        this._openPromise = null; // allow future retry with new socket
      };

      const timer = setTimeout(() => {
        failOpen('rch_open_timeout');
      }, this.timeoutMs);

      const onMessage = (event) => {
        const data = typeof event.data === 'string' ? event.data : '';
        if (data.trim() === 'pong') return; // keepalive-потверждение, ignorируем
        let method = '';
        let args = [];
        try {
          const parsed = JSON.parse(data);
          method = String(parsed.method || '');
          args = Array.isArray(parsed.args) ? parsed.args : [];
        } catch {
          return; // не-JSON — игнорируем (кроме pong выше)
        }

        if (method === 'Connected') {
          this.connectionId = String(args[0] || '').trim() || this.nwsId;
          this._sendRegistry();
          return;
        }
        if (method === 'RchRegistry') {
          // args[1] = connectionId — подтверждение регистрации.
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(this);
          }
          return;
        }
        if (method === 'RchClient') {
          // fire-and-forget с собственным catch-контуром — не роняем сокет,
          // не порождаем unhandledRejection.
          this._handleRchClient(args).catch(() => {});
          return;
        }
      };

      const onClose = () => {
        clearTimeout(timer);
        this._stopPing();
        if (!settled) {
          failOpen('rch_ws_closed');
          return;
        }
        this._closed = true;
        const listeners = this._closeListeners.slice();
        this._closeListeners.length = 0;
        for (const cb of listeners) {
          try {
            cb();
          } catch { /* слушатель не должен ронять клиент */ }
        }
        if (this.onClose) {
          try {
            this.onClose();
          } catch { /* как выше */ }
        }
      };

      socket.addEventListener('message', onMessage);
      socket.addEventListener('close', onClose);
      socket.addEventListener('error', () => {
        if (!settled) failOpen('rch_ws_error');
      });
      socket.addEventListener('open', () => {
        this._startPing();
      });
    });
    return this._openPromise;
  }

  /** RchRegistry args (как Lampa: `{host,rchtype,apkVersion,player}`). */
  _registryArgs() {
    return [{
      host: bareHost(this.host),
      rchtype: this.rchtype,
      apkVersion: 0,
      player: null
    }];
  }

  _sendRegistry() {
    if (!this.isOpen) return;
    this._sendJson({ method: 'RchRegistry', args: this._registryArgs() });
  }

  _sendJson(obj) {
    if (!this.isOpen) return;
    try {
      this.socket.send(JSON.stringify(obj));
    } catch { /* сокет закрывается — следующее сообщение/close это поймает */ }
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this.isOpen) {
        try {
          this.socket.send(PING_TEXT);
        } catch { /* закрытие обработает close-listener */ }
      }
    }, this.keepaliveMs);
    if (this._pingTimer.unref) this._pingTimer.unref();
  }

  _stopPing() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  /** Закрыть сокет (идемпотентно), снять таймеры. */
  close() {
    this._stopPing();
    const socket = this.socket;
    this.socket = null;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      try {
        socket.close(1000, 'client_shutdown');
      } catch { /* уже закрыт */ }
    }
  }

  /**
   * Обработка RchClient-события: выполнить url (валидация→fetch→тело) и
   * ПОСТить результат на `{origin}/rch/result?id=rchId`.
   */
  async _handleRchClient(args) {
    const [rchId, url, data, headers, returnHeaders] = args;
    const id = String(rchId || '');
    if (!id || !url) return; // нет rchId/url — нечего подтверждать

    let body;
    let gz = false;

    if (url === 'ping') {
      body = 'pong';
    } else if (url === 'eval' || url === 'evalrun') {
      // eval-контекст = браузерный JS движок устройства. Серверному клиенту
      // недоступен — отдаём пустой результат (честный отказ, не падение).
      body = '';
      this.lastError = 'rch_eval_unsupported';
    } else {
      const executed = await this._executePushed(url, data, headers || null, Boolean(returnHeaders));
      body = executed.body;

      if (Boolean(returnHeaders) && typeof body === 'object') {
        body = JSON.stringify(body);
      }
    }

    const raw = typeof body === 'string' ? body : String(body || '');
    const payload = Buffer.from(raw, 'utf8');
    if (payload.byteLength > 1000) {
      gz = true;
    }

    await this._postResult(id, payload, gz);
    this.lastError = null;
  }

  /** Выполнение pushed-URL (GET/POST) с валидацией и лимитами. */
  async _executePushed(url, data, headers, returnHeaders) {
    // SSRF-гард: никогда не fetch(url) без проверки.
    let parsed;
    try {
      parsed = await this.validateUrl(url);
    } catch (error) {
      this.lastError = 'rch_fetch_denied';
      return { body: '', headers: {}, currentUrl: String(url) };
    }

    const isPost = Boolean(data && String(data).length);
    const requestHeaders = {};
    if (!headers || typeof headers !== 'object') {
      // apk-клиент: кластер ждёт «дефолтные» заголовки устройства (UA).
      if (this.rchtype === 'apk') requestHeaders['user-agent'] = defaultUserAgent();
    } else {
      // Кластер прислал own-заголовки (для не-apk отправка фильтруется).
      for (const [key, value] of Object.entries(headers)) {
        const lower = String(key).toLowerCase();
        if (value == null || lower === 'cookie' || lower === 'authorization') continue; // секретов не шлём и не логируем
        if (lower.startsWith('sec-')) continue;
        requestHeaders[key] = String(value);
      }
    }
    requestHeaders.accept = '*/*';
    if (isPost && !Object.keys(requestHeaders).some((k) => k.toLowerCase() === 'content-type')) {
      requestHeaders['content-type'] = 'application/x-www-form-urlencoded';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(parsed, {
        method: isPost ? 'POST' : 'GET',
        headers: requestHeaders,
        body: isPost ? String(data) : undefined,
        redirect: 'follow',
        signal: controller.signal
      });
      if (!response) return { body: '', headers: {}, currentUrl: '' };

      // Протокол передаёт результат строкой (server stringValue) — всегда текст,
      // с жёстким лимитом (внутренний буфер, не безлимит).
      const textBody = (await response.text()).slice(0, RCH_RESULT_MAX_BYTES);

      const outHeaders = {};
      for (const [key, value] of response.headers.entries()) {
        const lower = key.toLowerCase();
        if (lower === 'set-cookie' || lower === 'authorization') continue;
        outHeaders[key] = value;
      }

      return {
        body: textBody,
        headers: outHeaders,
        currentUrl: response.url || String(url)
      };
    } catch (error) {
      this.lastError = 'rch_fetch_failed';
      return { body: '', headers: {}, currentUrl: String(url) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Пост результата на кластерный `/rch/result` (или gzresult). */
  async _postResult(rchId, payload, gz) {
    // HTTP-origin хоста (nws ws(s):// → http(s)://): `/rch/result` — HTTP-эндпоинт,
    // посту в ws-схему fetch не сможет (протокол Lampac RchClient.ExecutePost).
    let origin = '';
    try {
      const u = new URL(this.nwsUrl);
      u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
      u.pathname = '';
      u.search = '';
      u.hash = '';
      origin = u.origin;
    } catch {
      return;
    }
    if (!origin) return;

    let finalPayload = payload;
    if (gz) {
      finalPayload = zlib.gzipSync(payload);
    }

    const target = `${origin}/rch/${gz ? 'gzresult' : 'result'}?id=${encodeURIComponent(rchId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      await this.fetchImpl(target, {
        method: 'POST',
        body: finalPayload,
        headers: { 'content-type': 'application/octet-stream' },
        signal: controller.signal
      });
    } catch {
      this.lastError = 'rch_result_post_failed';
    } finally {
      clearTimeout(timer);
    }
  }
}