import { config } from '../../config.js';
import { SKAZ_DEFAULT_HOSTS } from './SkazClient.js';

/**
 * SKAZ-MANIYA-052 — bootstrap тонкого клиента.
 *
 * Отдаётся плагину (public/maniya-online.js) через GET /api/lampa/thin/bootstrap
 * под Bearer-гейтом активной подписки. Это ровно те данные, что нужны клиенту,
 * чтобы самому пройти lite-цепочку с IP ДЕВАЙСА (минт direct CDN, как E-Online):
 *   - account_email/uid — авторизация кластера (идёт в каждый lite-URL);
 *   - lite_hosts/ws_hosts — пул клиентских хостов (hostname-first, без серверных IP).
 *
 * НЕ содержит: токенов, /proxy, полных URL, паролей — только память клиента (TTL).
 * Хосты из bootstrap — единственный источник для клиентских ws/fetch (SSRF-гигиена).
 */

function isIpHost(h) {
  try {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(new URL(h).hostname);
  } catch {
    return true;
  }
}

/** Пул хостов ДЛЯ КЛИЕНТА: hostname-first (online3/8.skaz.tv), серверные IP — резерв. */
export function clientLiteHosts() {
  const pool = (Array.isArray(config.skaz.hosts) && config.skaz.hosts.length ? config.skaz.hosts : SKAZ_DEFAULT_HOSTS)
    .map((h) => String(h).trim())
    .filter((h) => /^https?:\/\//i.test(h));
  const hostnames = pool.filter((h) => !isIpHost(h));
  const use = (hostnames.length ? hostnames : pool).slice(0, 2);
  return use.length ? use : SKAZ_DEFAULT_HOSTS.slice(0, 2);
}

/** http://… → ws://… (https → wss) для того же hostname. */
export function wsHostOf(httpUrl) {
  return String(httpUrl).replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
}

/**
 * Bootstrap-ответ (200 {enabled:false} при выключено). null — если тонкий клиент
 * выключен (флаг или пустой allowlist) — роут вернёт суррогат {enabled:false}.
 */
export function buildThinBootstrap() {
  const thin = config.skaz.thin;
  const modules = (thin?.modules || []).filter((m) => typeof m === 'string' && m.trim());
  if (!thin?.enabled || modules.length === 0) return null;
  const liteHosts = clientLiteHosts();
  return {
    enabled: true,
    modules,
    ttl_s: Math.max(60, Math.round((thin.ttlMs || 600_000) / 1000)),
    skaz: {
      account_email: config.skaz.accountEmail,
      uid: config.skaz.uid,
      lite_hosts: liteHosts,
      ws_hosts: liteHosts.map(wsHostOf)
    }
  };
}