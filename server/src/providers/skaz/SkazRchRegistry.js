/**
 * SkazRchRegistry — реестр/жизненный цикл RCH-сессий SkazRchClient.
 *
 * Изоляция (§«host/identity» отчёта): ключ сессии =
 *   `${userUid}|${host}|${providerId}` — пользователь A НИКОГДА не делит
 *   RCH-состояние с пользователем B (нет общих глобалов, нет кросс-юзерских
 *   подключений). nws_id сессии внутренний и не покидает процесс.
 *
 * Гарантии:
 *  - single-flight: параллельные acquire одного ключа разделяют одно подключение;
 *  - TTL: сессия живёт sessionTtlMs с последнего использования, потом close+drop;
 *  - maxSessions: лимит одновременных подключений (эвикция по LRU при переполнении);
 *  - cleanup: закрытый сокет (ws close) → сессия удаляется сама по onClose-хуке;
 *  - нет прослушивающих корок: каждый client.onCloseHandler — закрывается при
 *    drop, никакого listener leak; повторный acquire после close создаёт новую.
 */
import { SkazRchClient } from './SkazRchClient.js';

export class SkazRchRegistry {
  constructor(options = {}) {
    const cfg = options || {};
    this.maxSessions = Number(cfg.maxSessions || 24);
    this.sessionTtlMs = Number(cfg.sessionTtlMs || 10 * 60 * 1000);
    this.timeoutMs = Number(cfg.timeoutMs || 12_000);
    this.rchtype = String(cfg.rchtype || 'apk').trim();
    this.fetchImpl = cfg.fetchImpl;
    this.validateUrl = cfg.validateUrl;
    this._sessions = new Map(); // key -> {client, lastUsed, created}
    this._inflight = new Map(); // key -> Promise (single-flight)
  }

  /** Ключ сессии: изолирован по user + host + provider. */
  static keyOf(userUid, host, providerId) {
    return `${String(userUid || '')}|${String(host || '')}|${String(providerId || '')}`;
  }

  _now() {
    return Date.now();
  }

  _sweep() {
    if (this._sessions.size === 0) return;
    const now = this._now();
    for (const [key, entry] of this._sessions) {
      if (now - entry.lastUsed >= this.sessionTtlMs || !entry.client.isReady) {
        this._drop(key);
      }
    }
  }

  _evictOldest() {
    if (this._sessions.size < this.maxSessions) return;
    let oldestKey = null;
    let oldest = Infinity;
    for (const [key, entry] of this._sessions) {
      if (entry.lastUsed < oldest) {
        oldest = entry.lastUsed;
        oldestKey = key;
      }
    }
    if (oldestKey) this._drop(oldestKey);
  }

  _drop(key) {
    const entry = this._sessions.get(key);
    if (!entry) return;
    this._sessions.delete(key);
    entry._closeHook?.(); // снимает onClose-listener (нет leak)
    try {
      entry.client.close();
    } catch { /* close идемпотентен */ }
  }

  /**
   * Получить готовую (registry-ack) сессию для (userUid, host, providerId).
   * Создаёт новую при отсутствии/закрытии, разделяет при параллельном вызове.
   * @returns {Promise<SkazRchClient|null>} null — только при сетевом отказе открытия.
   */
  async acquire(userUid, host, providerId, nwsUrl) {
    this._sweep();
    const key = SkazRchRegistry.keyOf(userUid, host, providerId);
    const live = this._sessions.get(key);
    if (live && live.client.isReady) {
      live.lastUsed = this._now();
      return live.client;
    }
    if (live) this._drop(key);

    // single-flight: тот же ключ, параллельный вызов ждёт ту же сессию.
    if (this._inflight.has(key)) {
      try {
        return await this._inflight.get(key);
      } catch {
        return null;
      }
    }

    const pending = this._open(key, userUid, host, providerId, nwsUrl)
      .then((client) => {
        this._inflight.delete(key);
        return client;
      })
      .catch((error) => {
        this._inflight.delete(key);
        return null;
      });
    this._inflight.set(key, pending);
    return pending;
  }

  async _open(key, userUid, host, providerId, nwsUrl) {
    this._evictOldest();
    const client = new SkazRchClient({
      nwsUrl,
      host,
      providerId,
      rchtype: this.rchtype,
      timeoutMs: this.timeoutMs,
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      ...(this.validateUrl ? { validateUrl: this.validateUrl } : {})
    });

    const entry = {
      client,
      lastUsed: this._now(),
      created: this._now(),
      _closeHook: null
    };

    // onClose-хук: закрытый сокет мгновенно чистит сессию из реестра.
    entry._closeHook = client.onCloseHandler(() => {
      const current = this._sessions.get(key);
      if (current && current.client === client) this._drop(key);
    });

    try {
      await client.open();
    } catch (error) {
      entry._closeHook();
      try {
        client.close();
      } catch { /* уже закрыт */ }
      throw error;
    }

    this._sessions.set(key, entry);
    return client;
  }

  /** Явное закрытие сессии (после стойкого отказа/при смене окружения). */
  release(userUid, host, providerId) {
    const key = SkazRchRegistry.keyOf(userUid, host, providerId);
    this._drop(key);
  }

  get size() {
    return this._sessions.size;
  }

  has(key) {
    return this._sessions.has(key);
  }

  /** Полная уборка (graceful shutdown / тесты). */
  async closeAll() {
    const keys = [...this._sessions.keys()];
    for (const key of keys) this._drop(key);
  }
}