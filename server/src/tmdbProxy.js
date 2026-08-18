import https from 'node:https';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { logger } from './logger.js';
import { defaultUserAgent } from './providers/shared/utils/UserAgent.js';

/**
 * TMDB-PROXY-FIX-001: серверный TMDB relay для Maniya.
 *
 * Два типизированных маршрута, у которых апстрим-хост ЖЁСТКО ЗАШИТ константой
 * (как tmdbApiHost/tmdbImgHost в эталоне Lampac TmdbProxy/Controller.cs):
 *
 *   GET /api/lampa/tmdb/api/3/{path}  → https://api.themoviedb.org/3/{path}
 *   GET /api/lampa/tmdb/img/{path}    → https://image.tmdb.org/{path}
 *
 * SSRF-модель (задача §10/§11): хост не берётся из ввода вообще — только из
 * константы. Валидация цели отдельная от generic-прокси (в отличие от
 * validateProxyTarget здесь НЕТ исключения для http-loopback и только ТОЧНОЕ
 * равенство хоста — «api.themoviedb.org» не покрывает «themoviedb.org» или
 * «evil.com»). Каждый redirect проходит ту же проверку. НИКАКОЙ произвольной
 * передачи hostname.
 */

export const TMDB_API_HOST = 'api.themoviedb.org';
export const TMDB_IMG_HOST = 'image.tmdb.org';

export const TMDB_API_ROUTE = '/api/lampa/tmdb/api/3';
export const TMDB_IMG_ROUTE = '/api/lampa/tmdb/img';

// Служебные query-параметры Maniya/Lampa (token/uid/account/сервисные) —
// апстриму TMDB НЕ пробрасываются. api_key/language/query  передаются как есть.
export const TMDB_SKIP_QUERY_KEYS = new Set([
  'token', 'uid', 'account_email', 'cub_id',
  'origin', 'ref', 'logged', 'reset'
]);

// Старый UA для изображений: гарантирует image/jpeg вместо image/webp
// (эталон Lampac TmdbProxy headersImg, Controller.cs:32-37).
const OLD_IMG_USER_AGENT = 'Mozilla/5.0 (Windows NT 6.2; WOW64) AppleWebKit/534.57.2 (KHTML, like Gecko) Version/5.1.7 Safari/534.57.2';
const IMG_ACCEPT = 'image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5';

// Заголовки апстрима, которые перекладываем клиенту. Никаких hop-by-hop
// (connection/keep-alive/transfer-encoding/upgrade и пр.) — их Node не копирует.
const RELAY_HEADERS = [
  'content-type',
  'content-length',
  'content-encoding',
  'cache-control',
  'etag',
  'last-modified',
  'age',
  'expires'
];

export function isTmdbApiPath(pathname) {
  return pathname === TMDB_API_ROUTE || pathname.startsWith(`${TMDB_API_ROUTE}/`);
}

export function isTmdbImgPath(pathname) {
  return pathname === TMDB_IMG_ROUTE || pathname.startsWith(`${TMDB_IMG_ROUTE}/`);
}

/**
 * Строгая SSRF-валидация ТОЛЬКО для TMDB relay.
 * НЕ переиспользует validateProxyTarget: у него http-loopback разрешён всегда
 * (нужно E-Online), а здесь TMDB-маршруту достаточно единственного https-хоста.
 * Точное равенство хоста: `themoviedb.org`/`evil.com` не матчатся.
 */
export function validateTmdbTarget(value, allowHost) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new HttpError(400, 'invalid_tmdb_url', 'Некорректная ссылка');
  }
  if (parsed.protocol !== 'https:') {
    throw new HttpError(400, 'tmdb_scheme_forbidden', 'Допускается только https');
  }
  if (String(parsed.hostname).toLowerCase() !== String(allowHost).toLowerCase()) {
    throw new HttpError(403, 'proxy_host_forbidden', 'Хост источника не разрешён');
  }
  return parsed;
}

/**
 * Строит и валидирует апстрим-URL. pathname уже нормализован WHATWG URL
 * (dot-сегменты resolved), поэтому сырые `..`/`%2e%2e` в запрошенном пути
 * не протаскиваются. query копируется как есть, КРОМЕ служебных ключей
 * (token/uid/...). Возвращает провалидированный URL (https + точный хост).
 */
export function buildTmdbUpstream(route, pathname, searchParams) {
  const isApi = route === TMDB_API_ROUTE;
  const host = isApi ? TMDB_API_HOST : TMDB_IMG_HOST;
  const prefix = isApi ? TMDB_API_ROUTE : TMDB_IMG_ROUTE;

  let suffix = pathname;
  if (suffix === prefix) suffix = '';
  else if (suffix.startsWith(`${prefix}/`)) suffix = suffix.slice(prefix.length + 1);
  else throw new HttpError(404, 'tmdb_route_not_found', 'Неизвестный TMDB-маршрут');

  suffix = String(suffix).replace(/^\/+/, '');

  // Хост вставляется константой — у суффикса нет шанса сменить authority (в
  // строке уже есть `/` после хоста, authority завершён). Итог всё равно
  // прогоняем через validateTmdbTarget — двойная страховка.
  const url = new URL(`https://${host}/${isApi ? '3/' : ''}${suffix}`);

  for (const [key, value] of searchParams.entries()) {
    if (TMDB_SKIP_QUERY_KEYS.has(key)) continue;
    url.searchParams.append(key, value);
  }

  return validateTmdbTarget(url.toString(), host);
}

function requestOnce(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: 'GET', headers, timeout: timeoutMs },
      (res) => resolve(res)
    );
    req.on('timeout', () => req.destroy(new Error('tmdb_upstream_timeout')));
    req.on('error', reject);
    req.end();
  });
}

function relayHeaders(upstreamHeaders) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Type'
  };
  for (const name of RELAY_HEADERS) {
    if (upstreamHeaders[name] !== undefined) headers[name] = upstreamHeaders[name];
  }
  return headers;
}

/**
 * Проксирует TMDB-маршрут на фиксированный апстрим.
 * options: { requestOnce, timeoutMs, maxRedirects } — requestOnce инжектится в
 * тестах (без сети), в проде — реальный https.request.
 */
export async function tmdbRelay(route, context, response, options = {}) {
  const isApi = route === TMDB_API_ROUTE;
  const host = isApi ? TMDB_API_HOST : TMDB_IMG_HOST;
  const timeoutMs = options.timeoutMs ?? config.proxy.timeoutMs;
  const maxRedirects = options.maxRedirects ?? config.proxy.maxRedirects;
  const fetchOnce = options.requestOnce || requestOnce;

  let current = buildTmdbUpstream(route, context.url.pathname, context.url.searchParams);
  const headers = {
    'User-Agent': isApi ? defaultUserAgent() : OLD_IMG_USER_AGENT,
    'Accept': isApi ? 'application/json' : IMG_ACCEPT
  };

  const started = Date.now();
  let redirects = 0;
  let status = 502;

  for (;;) {
    let upstream;
    try {
      upstream = await fetchOnce(current, headers, timeoutMs);
    } catch (error) {
      const timeout = error && error.message === 'tmdb_upstream_timeout';
      logger.warn('tmdb_proxy_upstream_error', { route, timeout: Boolean(timeout), error: timeout ? '' : String(error && error.message || error) });
      throw new HttpError(timeout ? 504 : 502, timeout ? 'tmdb_upstream_timeout' : 'tmdb_upstream_error',
        timeout ? 'TMDB upstream timeout' : 'TMDB upstream error');
    }

    status = upstream.statusCode || 502;
    const location = upstream.headers.location;

    if (status >= 300 && status < 400 && location && redirects < maxRedirects) {
      redirects += 1;
      upstream.resume();
      // Каждый redirect — через ту же строгую валидацию (https + тот же хост).
      current = validateTmdbTarget(new URL(location, current).toString(), host);
      continue;
    }

    try {
      response.writeHead(status, relayHeaders(upstream.headers));
      upstream.pipe(response);
      upstream.on('error', () => response.destroy());
    } catch (error) {
      throw new HttpError(502, 'tmdb_relay_io', 'TMDB relay write failed');
    }
    // Логируем ТОЛЬКО route/status/duration — никаких URL, query, api_key.
    logger.info('tmdb_proxy_request', { route, status, redirects, durationMs: Date.now() - started });
    return;
  }
}