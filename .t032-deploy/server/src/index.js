import crypto from 'node:crypto';
import http from 'node:http';
import { config } from './config.js';
import { HttpError, toHttpError } from './errors.js';
import { isLampaRequest, sendJson, sendPluginForToken, sendPluginLoader, sendPluginStub, sendStatic } from './http.js';
import { logger } from './logger.js';
import { assertCorsAllowed, assertRateLimit, clientIp } from './security.js';
import { findUserByInstallToken, findUserByRequest, findUserByShortToken, getVideoForRequest, getVideosForRequest, isSubscriptionActive, requireSubscription } from './store.js';
import { subscriptionStatus } from './status.js';
import { providerById, registeredProviders } from './providers/registry.js';
import { PROVIDER_FALLBACK_ICON, providerMeta } from './providers/meta.js';
import { defaultChecker } from './availability.js';
import { sourceModel } from './sources/sourceModel.js';
import { buildProxyUrl, proxyMedia } from './proxy.js';
import { isTmdbApiPath, isTmdbImgPath, TMDB_API_ROUTE, TMDB_IMG_ROUTE, tmdbRelay } from './tmdbProxy.js';
import { createTelegramRunner } from './telegram/runner.js';

const startedAt = Date.now();
let ready = true;

/**
 * MANIYA-STAGING (TASK-032 Phase 17): build-информация диагностики `/version`.
 * Только non-secret метаданные: сборка (MANIYA_STAGING_BUILD), включённость
 * staging-контура, модель (per-title online[]). Токенов/кред/конфигов нет.
 */
function buildInfo() {
  return {
    ok: true,
    service: 'maniya-online-lampa',
    version: '1.0.1',
    env: config.env,
    staging: Boolean(config.staging.enabled),
    build: config.staging.enabled && config.staging.buildId ? config.staging.buildId : null,
    model: Boolean(config.skaz?.enabled && config.skaz?.checkEnabled)
  };
}

function requestContext(request) {
  const url = new URL(request.url, config.publicBaseUrl);
  return {
    request,
    url,
    query: Object.fromEntries(url.searchParams.entries()),
    requestId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  };
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
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

/**
 * PLUGIN-INSTALL-002: скрытый путь реального кода плагина `/x/<install>_<key>.js`.
 * key = HMAC-SHA256(PLUGIN_CODE_SECRET, 'plugin-code:'+install) → 24 hex.
 * Не выводится из публичного URL: лоадер отдаётся только Lampa и содержит ключ,
 * браузер скрытый путь не получает. Без секрета возвращает '' (на /p/ это 503,
 * fail-closed — см. маршрут).
 */
function hiddenPathFor(install) {
  const secret = config.pluginCodeSecret;
  if (!secret) return '';
  const key = crypto.createHmac('sha256', secret).update('plugin-code:' + install).digest('hex').slice(0, 24);
  return `${install}_${key}`;
}

/** Константное по времени сравнение ключа из URL с ожидаемым HMAC. */
function hiddenKeyMatches(install, providedKey) {
  const secret = config.pluginCodeSecret;
  if (!secret || !providedKey) return false;
  const expected = crypto.createHmac('sha256', secret).update('plugin-code:' + install).digest('hex').slice(0, 24);
  const a = Buffer.from(String(providedKey), 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
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

  // MANIYA-STAGING (TASK-032 Phase 17): диагностика сборки ТОЛЬКО на staging.
  // Вне MANIYA_STAGING_ENABLED — 404 (на PROD недоступен). Non-secret build-info.
  if (pathname === '/version') {
    if (!config.staging.enabled) throw new HttpError(404, 'not_found', 'Not found');
    return sendJson(request, response, 200, buildInfo());
  }

  // Короткая ссылка плагина /<prefix>_<short>.js → ищем пользователя по суффиксу токена.
  // PLUGIN-INSTALL-002: реальный код — только Lampa; браузеру — stub-текст.
  const shortLink = pathname.match(/^\/[^/]+_([0-9a-fA-F]{8,})\.js$/);
  if (shortLink) {
    const short = shortLink[1].toLowerCase();
    const user = await findUserByShortToken(short);
    if (!user) throw new HttpError(404, 'not_found', 'User not found');
    if (!isSubscriptionActive(user)) throw new HttpError(403, 'subscription_required', 'Подписка истекла');
    if (!isLampaRequest(request)) return sendPluginStub(request, response);
    return sendPluginForToken(request, response, user.token);
  }

  // MANIYA-STAGING (TASK-032 Phase 17): тестовый плагин `/staging/<short>.js`.
  // Та же схема, что PROD-короткая ссылка, но отдаёт СТАДЖИНГ-сборку из
  // server/staging-public (MANIYA_API_BASE → сам staging, build-id вшит в код).
  // Активен только при MANIYA_STAGING_ENABLED=true; иначе и вне staging — 404.
  // Сборка вне publicDir → sendStatic её никогда не раздаёт. Токен вшивается в
  // window.MANIYA_ONLINE_TOKEN как в PROD-флоу (клиент ходит в staging API).
  const stagingLink = pathname.match(/^\/staging\/([0-9a-fA-F]{8,})\.js$/);
  if (stagingLink) {
    if (!config.staging.enabled || !config.staging.pluginBase) throw new HttpError(404, 'not_found', 'Not found');
    const short = stagingLink[1].toLowerCase();
    const user = await findUserByShortToken(short);
    if (!user) throw new HttpError(404, 'not_found', 'User not found');
    if (!isSubscriptionActive(user)) throw new HttpError(403, 'subscription_required', 'Подписка истекла');
    if (!isLampaRequest(request)) return sendPluginStub(request, response);
    return sendPluginForToken(request, response, user.token, 'maniya-online-staging.js', config.staging.stagingPublicDir);
  }

  // PLUGIN-INSTALL-001/002: opaque install-ссылки. `/i/<opaque>` — устаревший
  // путь (HTML-страница удалена, единая ссылка — `/p/<opaque>.js`): теперь отдаёт
  // stub-текст, никогда JS. `/p/<opaque>.js` — лоадер для Lampa / stub для браузера;
  // реальный код — по скрытому `/x/<install>_<key>.js`. Opaque-токен → пользователь
  // → активная подписка; реальный subscription-токен в URL не попадает.
  // Невалидный/короткий opaque → 404 (информации о пользователе не раскрываем).
  if (/^\/i\/([0-9a-fA-F]{32,})$/.test(pathname)) {
    return sendPluginStub(request, response);
  }

  const installPlugin = pathname.match(/^\/p\/([0-9a-fA-F]{32,})\.js$/);
  if (installPlugin) {
    const install = installPlugin[1].toLowerCase();
    // PLUGIN-INSTALL-002 fail-closed: без PLUGIN_CODE_SECRET скрытый путь /x/ не
    // построить, а полный JS по /p/ НЕ отдаём (иначе мис-конфигурация снова
    // раскрывает код) — endpoint недоступен, 503 для любого клиента.
    if (!config.pluginCodeSecret) {
      throw new HttpError(503, 'plugin_code_not_configured', 'Плагин не сконфигурирован: PLUGIN_CODE_SECRET не задан');
    }
    const user = await findUserByInstallToken(install);
    if (!user) throw new HttpError(404, 'install_link_not_found', 'Install link not found');
    if (!isSubscriptionActive(user)) throw new HttpError(403, 'subscription_required', 'Подписка истекла');
    if (!isLampaRequest(request)) return sendPluginStub(request, response);
    return sendPluginLoader(request, response, `${config.publicBaseUrl}/x/${hiddenPathFor(install)}.js`);
  }

  // PLUGIN-INSTALL-002: скрытый путь реального кода `/x/<install>_<key>.js`.
  // key = HMAC(PLUGIN_CODE_SECRET, install) — неизвестен по публичному URL;
  // неверный/несуществующий ключ → 404. Реальный код (с токеном) — только Lampa.
  const hiddenCode = pathname.match(/^\/x\/([0-9a-fA-F]{32,})_([0-9a-fA-F]{16,})\.js$/);
  if (hiddenCode) {
    const install = hiddenCode[1].toLowerCase();
    const key = hiddenCode[2].toLowerCase();
    const user = await findUserByInstallToken(install);
    if (!user || !hiddenKeyMatches(install, key)) throw new HttpError(404, 'install_link_not_found', 'Install link not found');
    if (!isSubscriptionActive(user)) throw new HttpError(403, 'subscription_required', 'Подписка истекла');
    if (!isLampaRequest(request)) return sendPluginStub(request, response);
    return sendPluginForToken(request, response, user.token);
  }

  if (!isApiPath(pathname)) {
    return sendStatic(request, response, pathname);
  }

  assertCorsAllowed(request);

  // MANIYA-STAGING (TASK-032 Phase 17): зеркало /health для Lampa-клиента +
  // /api/lampa/version — build-info (только staging, как /version). Без секретов.
  if (pathname === '/api/lampa/health') {
    return sendJson(request, response, 200, { ok: true, service: 'maniya-online-lampa' });
  }

  if (pathname === '/api/lampa/version') {
    if (!config.staging.enabled) throw new HttpError(404, 'not_found', 'Not found');
    return sendJson(request, response, 200, buildInfo());
  }

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

  // TMDB-PROXY-FIX-001: типизированный TMDB relay — клиент без VPN может ходить
  // в TMDB (api/image) через Maniya. Апстрим-хост жёстко задан константой в
  // tmdbProxy.js (api.themoviedb.org / image.tmdb.org) и НЕ берётся из ввода —
  // SSRF невозможен даже при битом пути/query. Подписка — как у /proxy (плагин
  // добавляет token в query); rate-limit НЕ применяется: каталог постеров шлёт
  // десятки картинок разом, как HLS-сегменты.
  if (isTmdbApiPath(url.pathname)) {
    await requireSubscription(context);
    return tmdbRelay(TMDB_API_ROUTE, context, response);
  }

  if (isTmdbImgPath(url.pathname)) {
    await requireSubscription(context);
    return tmdbRelay(TMDB_IMG_ROUTE, context, response);
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

  // BALANCER-002: per-card availability. Статический /sources остаётся реестром;
  // этот эндпоинт (SHADOW-фаза, клиент НЕ вызывает пока не прошла live-сверка)
  // отдаёт динамический show:true/false по карточке (checksearch на кластер).
  // SKAZ-MANIYA-019: при config.skaz.enabled ПЕРВЫМ делом — per-title модель
  // (lite/events → online[]). Модель найдена → её и отдаём (meta.model=true);
  // события недоступны (timeout/invalid/accsdb) → старый probe-path ДОСЛОВНО.
  // Никакого частичного/смешанного результата (PREIMPLEMENT-AUDIT §8).
  if (pathname === '/api/lampa/sources/card') {
    const user = await requireSubscription(context);
    const userUid = sha256Hex(user.token).slice(0, 16);

    // Rollback-переключатель: без походов в кластер — все show:true (как /sources).
    if (!config.skaz.checkEnabled) {
      const staticSources = registeredProviders()
        .filter((provider) => provider.enabled())
        .map((provider) => ({ id: provider.id, show: provider.show !== false }));
      return sendJson(request, response, 200, {
        sources: staticSources,
        meta: { cached: false, elapsed_ms: 0, count: staticSources.length }
      });
    } else if (config.skaz.enabled) {
      const model = await sourceModel.card(context.query, userUid);
      if (model) {
        return sendJson(request, response, 200, {
          sources: model.items,
          meta: {
            cached: model.cached,
            elapsed_ms: model.elapsedMs,
            count: model.items.length,
            model: true
          }
        });
      }
    }

    const payload = await defaultChecker.card(context.query, userUid);
    return sendJson(request, response, 200, {
      sources: payload.sources.map(({ id, show }) => ({ id, show })),
      meta: {
        cached: payload.cached,
        elapsed_ms: payload.elapsedMs,
        count: payload.count
      }
    });
  }

  if (pathname === '/api/lampa/videos') {
    const user = await requireSubscription(context);
    // BALANCER-SEMANTICS-005-W1: пин availability keyed по userUid → прокидываем
    // тот же uid, на котором кэшируется карточка (STABILITY-003). store.js читает
    // per-provider пин (query.host) для preferred-first ноды /videos.
    context.userUid = sha256Hex(user.token).slice(0, 16);
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
    const user = await requireSubscription(context);
    context.userUid = sha256Hex(user.token).slice(0, 16);
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
