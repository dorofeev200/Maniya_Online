import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = '*';
process.env.RATE_LIMIT_MAX = '1000';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:3199';
process.env.USERS_FILE = new URL('./fixtures/users.json', import.meta.url).pathname;
process.env.VIDEOS_FILE = new URL('./fixtures/videos.json', import.meta.url).pathname;
// Не дёргать реальную сеть filmix.my в тестах API.
process.env.FILMIX_ENABLED = '0';

const { server } = await import('../src/index.js');

const base = 'http://127.0.0.1:3199';
// PLUGIN-INSTALL-002: статика/плагин отдаются как JS только с Lampa-UA
// (браузер получает stub-текст). Тесты на JS-тело шлют Lampa-UA.
const LAMPA_UA = 'Mozilla/5.0 (AppleTV; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Lampa/0.20.4';
const lampaFetch = (url) => fetch(url, { headers: { 'User-Agent': LAMPA_UA } });

before(async () => {
  await new Promise((resolve) => server.listen(3199, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('Maniya Online API', () => {
  it('returns health', async () => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: 'maniya-online-lampa' });
  });

  it('returns readiness', async () => {
    const response = await fetch(`${base}/ready`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ready, true);
  });



  it('serves plugin file without token', async () => {
    const response = await lampaFetch(`${base}/maniya-online.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.match(await response.text(), /MANIYA_API_BASE/);
  });

  it('serves plugin file as stub to browser (PLUGIN-INSTALL-002)', async () => {
    const response = await fetch(`${base}/maniya-online.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/plain/);
    assert.equal(await response.text(), 'Добавьте в плагины Lampa');
  });

  it('never rejects OPTIONS preflight with 403', async () => {
    const response = await fetch(`${base}/api/lampa/subscription/check`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://not-allowed.example',
        'Access-Control-Request-Method': 'GET'
      }
    });
    assert.equal(response.status, 204);
  });

  it('accepts fixture token', async () => {
    const response = await fetch(`${base}/api/lampa/subscription/check?token=unit-test-token`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.active, true);
    assert.equal(body.plan, 'test-fixture');
    // M-Online badge: данные из реальной подписки, не хардкод.
    assert.equal(body.authorized, true);
    assert.equal(typeof body.days_left, 'number');
    assert.match(body.subscription_text, /^Осталось \d+ дней$/);
  });

  it('subscription/check: tz=MSK сдвигает календарный день у полуночи (23:59Z=01:59 MSK)', async () => {
    const utc = await fetch(`${base}/api/lampa/subscription/check?token=unit-test-token`).then((r) => r.json());
    const msk = await fetch(`${base}/api/lampa/subscription/check?token=unit-test-token&tz=-180`).then((r) => r.json());
    // expires_at = 2099-12-31T23:59:59Z: в UTC-календаре это 31.12, в MSK — уже 01.01.2100.
    assert.equal(msk.days_left, utc.days_left + 1);
    assert.match(msk.subscription_text, /^Осталось \d+ дней$/);
  });

  it('subscription/check: неавторизованный → authorized=false без текста для badge', async () => {
    const response = await fetch(`${base}/api/lampa/subscription/check`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.authorized, false);
    assert.equal(body.active, false);
    assert.equal(body.subscription_text, null);
  });



  it('accepts bearer token header', async () => {
    const response = await fetch(`${base}/api/lampa/subscription/check`, {
      headers: { Authorization: 'Bearer unit-test-token' }
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.active, true);
  });

  it('rejects missing subscription for sources', async () => {
    const response = await fetch(`${base}/api/lampa/sources`);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, 'subscription_required');
  });

  it('returns sources and videos for fixture token', async () => {
    const sourcesResponse = await fetch(`${base}/api/lampa/sources?token=unit-test-token`);
    assert.equal(sourcesResponse.status, 200);
    const sources = await sourcesResponse.json();
    // Балансировщик «Maniya Online» убран — в списке только реальные провайдеры.
    assert.ok(sources.sources.length > 0);
    assert.ok(!sources.sources.some((s) => s.id === 'main'));
    assert.ok(sources.sources.every((s) => s.id && s.url));

    const videosResponse = await fetch(`${base}/api/lampa/videos?token=unit-test-token`);
    assert.equal(videosResponse.status, 200);
    const videos = await videosResponse.json();
    assert.ok(videos.items.length > 0);
  });

  it('lazy resolve /api/lampa/video: требует подписку (403 без токена)', async () => {
    const response = await fetch(`${base}/api/lampa/video?provider=skaz-alloha&voice=0&serial=0`);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, 'subscription_required');
  });

  it('lazy resolve /api/lampa/video: 404 для провайдера без resolveVideo/выключенного', async () => {
    // В тесте skaz-провайдеры выключены (SKAZ_* не заданы, enabled()=false) —
    // /video обязан отдать 404, а НЕ упасть 500.
    const response = await fetch(`${base}/api/lampa/video?token=unit-test-token&provider=skaz-alloha&voice=0&serial=0&title=X`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'video_not_found');
  });

  it('validates stream url', async () => {
    const response = await fetch(`${base}/api/lampa/stream?token=unit-test-token&url=ftp://bad`);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'invalid_url');
  });
});
