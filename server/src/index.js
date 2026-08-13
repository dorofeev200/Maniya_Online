import crypto from 'node:crypto';
import http from 'node:http';
import { config } from './config.js';
import { HttpError, toHttpError } from './errors.js';
import { sendJson, sendPluginForToken, sendStatic } from './http.js';
import { logger } from './logger.js';
import { assertCorsAllowed, assertRateLimit, clientIp } from './security.js';
import { findUserByRequest, findUserByShortToken, getVideoForRequest, getVideosForRequest, isSubscriptionActive, requireSubscription } from './store.js';
import { subscriptionStatus } from './status.js';
import { providerById, registeredProviders } from './providers/registry.js';
import { PROVIDER_FALLBACK_ICON, providerMeta } from './providers/meta.js';
import { buildProxyUrl, proxyMedia } from './proxy.js';
import { createTelegramRunner } from './telegram/runner.js';

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

function videosUrl(context, provider) {
  const url = new URL('/api/lampa/videos', config.publicBaseUrl);
  url.searchParams.set('provider', String(provider));
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

  // Короткая ссылка плагина /<prefix>_<short>.js → ищем пользователя по суффиксу токена.
  const shortLink = pathname.match(/^\/[^/]+_([0-9a-fA-F]{8,})\.js$/);
  if (shortLink) {
    const short = shortLink[1].toLowerCase();
    const user = await findUserByShortToken(short);
    if (!user) throw new HttpError(404, 'not_found', 'User not found');
    if (!isSubscriptionActive(user)) throw new HttpError(403, 'subscription_required', 'Подписка истекла');
    return sendPluginForToken(request, response, user.token);
  }

  if (!isApiPath(pathname)) {
    return sendStatic(request, response, pathname);
  }

  assertCorsAllowed(request);

  if (pathname === '/api/lampa/proxy') {
    // Медиа-прокси: проверяем подписку, но не лимит запросов — иначе нативные
    // запросы сегментов HLS мгновенно упрутся в rate-limit.
    await requireSubscription(context);
    return proxyMedia(context.query.url, request, response, {
      makeProxyUrl: (target) => buildProxyUrl(context, target),
      referer: context.query.ref || null,
      origin: context.query.origin || null
    });
  }

  assertRateLimit(request);

  if (pathname === '/api/lampa/subscription/check') {
    const user = await findUserByRequest(context);
    const active = isSubscriptionActive(user);
    // Часовой пояс клиента (минуты getTimezoneOffset), чтобы оставшиеся дни
    // считались по календарю пользователя, а не UTC. Опционально: без tz → UTC.
    const tzRaw = Number(context.query.tz);
    const offsetMinutes = Number.isInteger(tzRaw) ? tzRaw : undefined;
    const status = user
      ? subscriptionStatus({ active, expiresAt: user?.expires_at, offsetMinutes })
      : { label: null, days: null };

    return sendJson(request, response, 200, {
      authorized: Boolean(user),
      active,
      plan: user?.plan || null,
      expires_at: user?.expires_at || null,
      days_left: status.days,
      subscription_text: status.label,
      message: active ? 'Подписка Maniya Online активна' : 'Подписка Maniya Online не активна'
    });
  }

  if (pathname === '/api/lampa/sources') {
    await requireSubscription(context);

    const providers = registeredProviders().filter((provider) => provider.enabled());
    const sources = providers.map((provider) => {
      // Единый мета-реестр (meta.js): name + icon + quality_label — ОТДЕЛЬНО от
      // provider.id/логики. Префиксный id (skaz-*) сводится к слагу.
      const meta = providerMeta(provider.id) || {};
      return {
        id: provider.id,
        name: meta.name || withBrand(provider.title || provider.id),
        icon: meta.icon || PROVIDER_FALLBACK_ICON,
        quality_label: meta.qualityLabel || '',
        url: videosUrl(context, provider.id),
        show: provider.show !== false
      };
    });

    return sendJson(request, response, 200, { sources });
  }

  if (pathname === '/api/lampa/videos') {
    await requireSubscription(context);
    const payload = await getVideosForRequest(context);
    const body = { items: payload.items };
    if (Array.isArray(payload.seasons) && payload.seasons.length) body.seasons = payload.seasons;
    if (Array.isArray(payload.voices) && payload.voices.length) body.voices = payload.voices;
    if (payload.provider_error) body.provider_error = payload.provider_error;
    return sendJson(request, response, 200, body);
  }

  if (pathname === '/api/lampa/video') {
    // Ленивый резолв `method:"call"` item'а (голос/серия) → играбельный
    // дескриптор. Отдельно от /videos: НЕ резолвит все голоса заранее.
    await requireSubscription(context);
    const item = await getVideoForRequest(context);
    if (!item) throw new HttpError(404, 'video_not_found', 'Поток не найден');
    return sendJson(request, response, 200, item);
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

/**
 * Единый бренд источника: «Maniya · <name>». Уже имеющий префикс (напр. из
 * EO_TITLES) не трогаем — не задваиваем «Maniya · Maniya · …».
 */
function withBrand(name) {
  const clean = String(name || '').trim();
  return /^Maniya\s*[·|–—:]?\s?/i.test(clean) ? clean : `Maniya · ${clean}`;
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

const telegramRunner = config.telegram.enabled && config.telegram.botToken
  ? createTelegramRunner(config).start()
  : null;

if (process.env.NODE_ENV !== 'test') {
  server.listen(config.port, config.host, () => {
    logger.info('server_started', {
      host: config.host,
      port: config.port,
      publicBaseUrl: config.publicBaseUrl,
      corsOrigins: config.corsOrigins,
      telegram: telegramRunner ? 'enabled' : 'disabled'
    });
  });
}
