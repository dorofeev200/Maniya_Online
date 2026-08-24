// MANIYA-STAGING (TASK-032 Phase 17): /staging/<short>.js + диагностика.
// MANIYA_STAGING_ENABLED=true — все роуты активны, staging-сборка отдаётся
// ТОЛЬКО Lampa (браузеру stub), сборка не утекает через sendStatic, версия
// несёт build-id и не секреты.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = '*';
process.env.RATE_LIMIT_MAX = '1000';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:3333';
process.env.USERS_FILE = new URL('./fixtures/users.json', import.meta.url).pathname;
process.env.VIDEOS_FILE = new URL('./fixtures/videos.json', import.meta.url).pathname;
process.env.FILMIX_ENABLED = '0';
process.env.MANIYA_STAGING_ENABLED = '1';
process.env.MANIYA_STAGING_PLUGIN_BASE = 'http://127.0.0.1:3333';
process.env.MANIYA_STAGING_BUILD = 'testing123';
// Реальная сгенерированная сборка (scripts/generate-staging-plugin.mjs) —
// end-to-end: генератор + роут + токен. Вне publicDir, sendStatic её не отдаёт.
process.env.MANIYA_STAGING_PUBLIC_DIR = fileURLToPath(new URL('../staging-public', import.meta.url));

const { server } = await import('../src/index.js');

const base = 'http://127.0.0.1:3333';
const STAGING_SHORT = '4f3a9c21e7b64d08a5c2f1e9';
const LAMPA_UA = 'Mozilla/5.0 (AppleTV; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Lampa/0.20.4';
const lampaFetch = (url) => fetch(url, { headers: { 'User-Agent': LAMPA_UA } });

before(async () => {
  await new Promise((resolve) => server.listen(3333, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('Phase 17 — staging plugin route (enabled)', () => {
  it('serves staging build to Lampa with embedded token + build-id', async () => {
    const response = await lampaFetch(`${base}/staging/${STAGING_SHORT}.js`);
    const body = await response.text();
    assert.match(body, /window\.MANIYA_ONLINE_TOKEN_STAGING="staging-test-4f3a9c21e7b64d08a5c2f1e9"/, 'полный токен вшит сервером в СВОЙ глобал (TASK-034 M1)');
    const buildMatch = body.match(/window\.MANIYA_STAGING_BUILD = '([^']+)'/);
    assert.ok(buildMatch && buildMatch[1], 'build-id вшит в сборку (window.MANIYA_STAGING_BUILD)');
    assert.match(body, /COMPONENT = 'maniya_online_staging'/, 'компонент staging');
    assert.match(body, /PLUGIN_FLAG = 'maniya_online_staging_plugin_started'/, 'флаг staging');
    assert.match(body, /name: 'Maniya Online — STAGING'/, 'идентичность STAGING в манифесте');
  });

  it('build не ссылается на prod-домен; API base — валидный http(s)', async () => {
    const response = await lampaFetch(`${base}/staging/${STAGING_SHORT}.js`);
    const body = await response.text();
    assert.doesNotMatch(body, /plugin\.maniya-kvn\.online/, 'ни одного запроса на prod-домен');
    const baseMatch = body.match(/MANIYA_API_BASE = '([^']+)'/);
    assert.ok(baseMatch, 'MANIYA_API_BASE присутствует');
    assert.match(baseMatch[1], /^https?:\/\/[^/]+\/api\/lampa$/, 'API base — валидный http(s) URL');
  });

  it('gives browser stub, not JS (PLUGIN-INSTALL-002 semantics)', async () => {
    const response = await fetch(`${base}/staging/${STAGING_SHORT}.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/plain/);
    assert.match(await response.text(), /Добавьте плагин/);
  });

  it('unknown short → 404', async () => {
    const response = await lampaFetch(`${base}/staging/deadbeefdeadbeef.js`);
    assert.equal(response.status, 404);
  });

  it('staging build not leaked via sendStatic (outside publicDir)', async () => {
    const response = await lampaFetch(`${base}/maniya-online-staging.js`);
    assert.equal(response.status, 404, 'файл вне publicDir — sendStatic 404');
  });
});

describe('Phase 17 — TASK-034 auth isolation (M1 global + M2 Storage)', () => {
  const getBuild = async () => {
    const response = await lampaFetch(`${base}/staging/${STAGING_SHORT}.js`);
    return response.text();
  };

  it('global isolation: staging читает ТОЛЬКО MANIYA_ONLINE_TOKEN_STAGING, не общий глобал', async () => {
    const body = await getBuild();
    // M1: сервер вшивает токен в staging-глобал, а НЕ в общий.
    assert.match(body, /window\.MANIYA_ONLINE_TOKEN_STAGING=/, 'инжект в staging-глобал');
    // Общий прод-глобал НЕ вшивается и НЕ читается staging-сборкой.
    assert.doesNotMatch(body, /window\.MANIYA_ONLINE_TOKEN=/,
      'общий window.MANIYA_ONLINE_TOKEN не должен ни вшиваться, ни читаться staging-сборкой');
    // Старые легаси-глобала тоже не должны остаться (T033 shared-window leak).
    assert.doesNotMatch(body, /window\.maniya_online_token|window\.maniyaOnlineToken/,
      'легаси-глобала maniya_online_token/maniyaOnlineToken в staging-сборке не должны читаться');
  });

  it('storage isolation: staging использует КОМПОНЕНТНЫЕ ключи maniya_token_staging/maniya_unic_id_staging', async () => {
    const body = await getBuild();
    // M2: все записи/чтения — только staging-ключи.
    assert.match(body, /Lampa\.Storage\.get\('maniya_token_staging'/, 'чтение токена из staging-ключа');
    assert.match(body, /Lampa\.Storage\.set\('maniya_token_staging'/, 'запись токена в staging-ключ');
    assert.match(body, /localStorage\.setItem\('maniya_token_staging'/, 'localStorage-запись staging-ключа');
    assert.match(body, /Lampa\.Storage\.get\('maniya_unic_id_staging'/, 'чтение uid из staging-ключа');
    assert.match(body, /Lampa\.Storage\.set\('maniya_unic_id_staging'/, 'запись uid в staging-ключ');
    // Прод-ключей в staging-сборке быть НЕ должно (только не-производные литералы).
    assert.doesNotMatch(body, /Lampa\.Storage\.(get|set)\('maniya_token'/,
      'прод-ключ maniya_token не должен фигурировать в staging-сборке');
    assert.doesNotMatch(body, /Lampa\.Storage\.(get|set)\('maniya_unic_id'/,
      'прод-ключ maniya_unic_id не должен фигурировать в staging-сборке');
    assert.doesNotMatch(body, /localStorage\.(get|set)Item\('maniya_token'\)/,
      'прод-localStorage-ключ maniya_token не должен фигурировать в staging-сборке');
  });

  it('subscription flow: staging /subscription/check с staging-токеном → active:true', async () => {
    const response = await fetch(`${base}/api/lampa/subscription/check?token=staging-test-${STAGING_SHORT}&uid=ptest-uid-1&tz=0`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.authorized, true, 'staging-токен авторизует пользователя');
    assert.equal(body.active, true, 'статус подписки активна на staging');
    assert.match(body.message, /активна/, 'текст статуса — «активна» (не «не активна»)');
  });

  it('sources flow: staging /api/lampa/sources вызывается со staging-токеном и отдаёт источники без prod-домена', async () => {
    const response = await fetch(`${base}/api/lampa/sources?token=staging-test-${STAGING_SHORT}&uid=ptest-uid-1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.sources), 'sources — массив');
    // Каждый источник ссылается на ЭТОТ (staging) API, никогда на prod-домен.
    for (const source of body.sources) {
      assert.match(source.url, /^http:\/\/127\.0\.0\.1:3333\/api\/lampa\/videos/, `url источника ${source.id} идёт на staging API`);
      assert.doesNotMatch(source.url, /plugin\.maniya-kvn\.online/, `ни одного url prod-домена (${source.id})`);
    }
  });
});

describe('Phase 17 — diagnostic endpoints (enabled)', () => {
  it('/version → build-info без секретов', async () => {
    const response = await fetch(`${base}/version`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, 'maniya-online-lampa');
    assert.equal(body.staging, true);
    assert.equal(body.build, 'testing123');
    assert.equal(body.model, true);
    assert.equal(body.env, 'test');
    assert.deepEqual(Object.keys(body).sort(), ['build', 'env', 'model', 'ok', 'service', 'staging', 'version'].sort());
  });

  it('/api/lampa/version → то же build-info', async () => {
    const response = await fetch(`${base}/api/lampa/version`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.build, 'testing123');
    assert.equal(body.staging, true);
  });

  it('/api/lampa/health → зеркало /health', async () => {
    const response = await fetch(`${base}/api/lampa/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: 'maniya-online-lampa' });
  });
});