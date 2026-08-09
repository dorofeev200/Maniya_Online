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
    const response = await fetch(`${base}/maniya-online.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.match(await response.text(), /MANIYA_API_BASE/);
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

  it('validates stream url', async () => {
    const response = await fetch(`${base}/api/lampa/stream?token=unit-test-token&url=ftp://bad`);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'invalid_url');
  });
});
