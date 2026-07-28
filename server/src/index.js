import crypto from 'node:crypto';
import http from 'node:http';
import { config } from './config.js';
import { HttpError, toHttpError } from './errors.js';
import { sendJson, sendStatic } from './http.js';
import { logger } from './logger.js';
import { assertCorsAllowed, assertRateLimit, clientIp } from './security.js';
import { findUserByRequest, getVideosForRequest, isSubscriptionActive, requireSubscription } from './store.js';
import { providerById } from './providers/registry.js';

const startedAt = Date.now();
let ready = true;

function requestContext(request) {
  const url = new URL(request.url, config.publicBaseUrl);
  return {
    request,
    url,
    query: Object.fromEntries(url.searchParams.entries()),
    requestId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  };
}

function sourceUrl(context) {
  const url = new URL('/api/lampa/videos', config.publicBaseUrl);
  url.searchParams.set('source', String(context.query.source || 'main'));
  return url.toString();
}

function isApiPath(pathname) {
  return pathname.startsWith('/api/');
}

async function route(context, response) {
  const { request, url } = context;
  const pathname = url.pathname;

  if (request.method === 'OPTIONS') return sendJson(request, response, 204, {});
  if (request.method !== 'GET') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');

  if (pathname === '/health') {
    return sendJson(request, response, 200, { ok: true, service: 'maniya-online-lampa' });
  }

  if (pathname === '/ready') {
    return sendJson(request, response, ready ? 200 : 503, {
      ready,
      service: 'maniya-online-lampa',
      uptime_ms: Date.now() - startedAt
    });
  }

  if (!isApiPath(pathname)) {
    return sendStatic(request, response, pathname);
  }

  assertCorsAllowed(request);
  assertRateLimit(request);

  if (pathname === '/api/lampa/subscription/check') {
    const user = await findUserByRequest(context);
    const active = isSubscriptionActive(user);

    return sendJson(request, response, 200, {
      active,
      plan: user?.plan || null,
      expires_at: user?.expires_at || null,
      message: active ? 'Подписка Maniya Online активна' : 'Подписка Maniya Online не активна'
    });
  }

  if (pathname === '/api/lampa/sources') {
    await requireSubscription(context);

    return sendJson(request, response, 200, {
      sources: [
        {
          id: 'main',
          name: 'Maniya Online',
          url: sourceUrl(context),
          show: true
        }
      ]
    });
  }

  if (pathname === '/api/lampa/videos') {
    await requireSubscription(context);
    return sendJson(request, response, 200, { items: await getVideosForRequest(context) });
  }

  if (pathname === '/api/lampa/stream') {
    await requireSubscription(context);
    const provider = providerById(String(context.query.provider || '').trim().toLowerCase());
    if (provider) return sendJson(request, response, 200, await provider.streams(context));

    const streamUrl = String(context.query.url || '').trim();

    if (!streamUrl) throw new HttpError(400, 'missing_url', 'Не передана ссылка потока');
    if (!/^https?:\/\//i.test(streamUrl)) throw new HttpError(400, 'invalid_url', 'Ссылка потока должна быть http или https');

    return sendJson(request, response, 200, { url: streamUrl, headers: {}, subtitles: [] });
  }

  throw new HttpError(404, 'not_found', 'Not found');
}

export const server = http.createServer((request, response) => {
  const started = Date.now();
  const context = requestContext(request);

  route(context, response).catch((error) => {
    const httpError = toHttpError(error);
    if (!(error instanceof HttpError)) logger.error('request_failed', { requestId: context.requestId, error: error.stack || error.message });
    sendJson(request, response, httpError.statusCode, {
      error: httpError.code,
      message: httpError.message,
      details: httpError.details
    });
  }).finally(() => {
    logger.info('request_completed', {
      requestId: context.requestId,
      method: request.method,
      path: context.url.pathname,
      statusCode: response.statusCode,
      durationMs: Date.now() - started,
      ip: clientIp(request)
    });
  });
});

function shutdown(signal) {
  ready = false;
  logger.warn('shutdown_started', { signal });

  const timeout = setTimeout(() => {
    logger.error('shutdown_timeout', { timeoutMs: config.shutdownTimeoutMs });
    process.exit(1);
  }, config.shutdownTimeoutMs);

  server.close((error) => {
    clearTimeout(timeout);
    if (error) {
      logger.error('shutdown_failed', { error: error.message });
      process.exit(1);
    }
    logger.info('shutdown_completed');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (process.env.NODE_ENV !== 'test') {
  server.listen(config.port, config.host, () => {
    logger.info('server_started', {
      host: config.host,
      port: config.port,
      publicBaseUrl: config.publicBaseUrl,
      corsOrigins: config.corsOrigins
    });
  });
}
