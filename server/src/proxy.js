import http from 'node:http';
import https from 'node:https';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { defaultUserAgent } from './providers/shared/utils/UserAgent.js';

export const MANIFEST_MAX_BYTES = 4 * 1024 * 1024;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * SSRF-гард: переданный URL должен быть https и указывать на хост из allowlist
 * (корень или его поддомен). http разрешён только для loopback — это нужно,
 * чтобы интеграционные тесты могли поднять локальный источник.
 */
export function isHostAllowed(host, allowHosts = config.proxy.allowHosts) {
  const clean = String(host || '').toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!clean) return false;
  return allowHosts.some((entry) => {
    const root = String(entry).toLowerCase().replace(/^\.+|\.+$/g, '');
    if (!root) return false;
    return clean === root || clean.endsWith(`.${root}`);
  });
}

export function validateProxyTarget(value, allowHosts = config.proxy.allowHosts) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new HttpError(400, 'invalid_proxy_url', 'Некорректная ссылка');
  }

  if (parsed.protocol === 'https:') {
    if (!isHostAllowed(parsed.hostname, allowHosts)) {
      throw new HttpError(403, 'proxy_host_forbidden', 'Хост источника не разрешён');
    }
    return parsed;
  }

  if (parsed.protocol === 'http:') {
    if (parsed.hostname && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
      return parsed;
    }
  }

  throw new HttpError(400, 'proxy_scheme_forbidden', 'Допускается только https');
}

function requestOnce(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      { method: 'GET', headers, timeout: timeoutMs },
      (res) => resolve(res)
    );
    req.on('timeout', () => req.destroy(new Error('upstream_timeout')));
    req.on('error', reject);
    req.end();
  });
}

function collectBody(stream, limit = MANIFEST_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    stream.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooBig = true;
        stream.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => {
      if (tooBig) return;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    stream.on('error', reject);
  });
}

const LOOP_BUFFER = MANIFEST_MAX_BYTES;

function resolveSegmentUrl(baseUrl, ref) {
  try {
    return new URL(ref, baseUrl).toString();
  } catch {
    return null;
  }
}

function rewriteHlsManifest(manifest, baseUrl, makeProxy) {
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const resolved = resolveSegmentUrl(baseUrl, trimmed);
      if (!resolved) return line;
      return makeProxy(resolved);
    })
    .join('\n');
}

function rewriteMpdManifest(manifest, baseUrl, makeProxy) {
  const rewriteAttr = (pattern) => (input) =>
    input.replace(pattern, (match, prefix, ref, suffix) => {
      const resolved = ref && resolveSegmentUrl(baseUrl, ref);
      return resolved ? `${prefix}${makeProxy(resolved)}${suffix}` : match;
    });

  const baseUrlPattern = /(\bBaseURL\s*=\s*")([^"]*)(")/g;
  const mediaPattern = /(\b(?:media|initialization)\s*=\s*")([^"]*)(")/g;
  const locationPattern = /(\bLocation\s*>\s*)([^<\s]*)(\s*<)/g;

  let out = rewriteAttr(baseUrlPattern)(manifest);
  out = rewriteAttr(mediaPattern)(out);
  out = rewriteAttr(locationPattern)(out);
  return out;
}

export function isManifestResponse(contentType, url) {
  const type = String(contentType || '').toLowerCase();
  const pathname = String(url?.pathname || url || '');
  return (
    /application\/vnd\.apple\.mpegurl|application\/x-mpegurl|audio\/mpegurl|video\/mp2t|dash\+xml/i.test(type) ||
    /\.(m3u8|mpd)(?:$|\?)/i.test(pathname)
  );
}

/**
 * Проксирует медиа с внешнего хоста на client-состояние, обходя CORS.
 * Range/Content-Range пробрасываются, манифесты HLS/DASH переписываются на
 * ссылки через наш /api/lampa/proxy, чтобы сегменты тоже шли через нас.
 */
export async function proxyMedia(targetUrl, request, response, options = {}) {
  const {
    timeoutMs = config.proxy.timeoutMs,
    maxRedirects = config.proxy.maxRedirects,
    allowHosts = config.proxy.allowHosts,
    referer = request?.headers?.referer || null
  } = options;

  let current = validateProxyTarget(targetUrl, allowHosts);
  const range = request?.headers?.range || null;
  let redirects = 0;

  for (;;) {
    const headers = { 'User-Agent': defaultUserAgent(), 'Accept': '*/*' };
    if (range) headers.Range = range;
    if (referer) headers.Referer = referer;

    const upstream = await requestOnce(current, headers, timeoutMs);
    const status = upstream.statusCode || 502;
    const location = upstream.headers.location;

    if (status >= 300 && status < 400 && location && redirects < maxRedirects) {
      redirects += 1;
      upstream.resume();
      current = validateProxyTarget(new URL(location, current).toString(), allowHosts);
      continue;
    }

    if (isManifestResponse(upstream.headers['content-type'], current)) {
      const body = await collectBody(upstream, MANIFEST_MAX_BYTES);
      if (body == null) throw new HttpError(502, 'proxy_manifest_too_large', 'Манифест слишком большой');
      const contentType = upstream.headers['content-type'] || 'application/vnd.apple.mpegurl';
      const rewritten = rewriteManifest(body, current.toString(), options.makeProxyUrl);
      response.writeHead(status, corsStreamHeaders(contentType));
      response.end(rewritten);
      return;
    }

    response.writeHead(status, passthroughHeaders(upstream.headers));
    upstream.pipe(response);
    upstream.on('error', () => response.destroy());
    return;
  }
}

function rewriteManifest(body, baseUrl, makeProxy) {
  if (!makeProxy) return body;
  return /\.mpd(?:$|\?)/i.test(baseUrl)
    ? rewriteMpdManifest(body, baseUrl, makeProxy)
    : rewriteHlsManifest(body, baseUrl, makeProxy);
}

function passthroughHeaders(upstreamHeaders) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
    'Cache-Control': 'no-store'
  };
  for (const name of ['content-type', 'content-length', 'accept-ranges', 'content-range']) {
    if (upstreamHeaders[name]) headers[name] = upstreamHeaders[name];
  }
  return headers;
}

function corsStreamHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
    'Cache-Control': 'no-store'
  };
}

/**
 * Строит адрес прокси для медиа-ссылки. Токен подмешивается в query, чтобы
 * сегменты манифестов, которые запрашивает нативный плеер (без Authorization
 * заголовка), тоже проходили проверку подписки.
 */
export function buildProxyUrl(context, targetUrl) {
  const { query, request } = context || {};
  const url = new URL('/api/lampa/proxy', config.publicBaseUrl);
  url.searchParams.set('url', String(targetUrl));
  const token = tokenFromRequest(query, request);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

export function tokenFromRequest(query = {}, request) {
  const fromQuery = String(query?.token || '').trim();
  if (fromQuery) return fromQuery;
  const authorization = String(request?.headers?.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}