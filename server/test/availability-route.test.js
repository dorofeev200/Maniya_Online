// BALANCER-002: маршрут GET /api/lampa/sources/card (индекс.js).
// Подписка обязательна (403 без токена); с токеном — {sources:[{id,show}], meta}.
// Env: skaz ВЫКЛючен (SKAZ_ENABLED=0) → эндпоинт не ходит в кластер, отдаёт только
// native (show:true) — формат/авторизация проверяются без сети.
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = '*';
process.env.RATE_LIMIT_MAX = '1000';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:3299';
process.env.USERS_FILE = new URL('./fixtures/users.json', import.meta.url).pathname;
process.env.VIDEOS_FILE = new URL('./fixtures/videos.json', import.meta.url).pathname;
process.env.SKAZ_ENABLED = '0';
process.env.FILMIX_ENABLED = '0';
process.env.REZKA_ENABLED = '0';
process.env.KODIK_ENABLED = '0';
process.env.ALLOHA_ENABLED = '0';
process.env.COLLAPS_ENABLED = '0';
process.env.HDVB_ENABLED = '0';
process.env.KINOTOCHKA_ENABLED = '0'; // TASK-KINOTOCHKA-001: native без сети в route-тестах
process.env.RUTUBEMOVIE_ENABLED = '0'; // SKAZ-MANIYA-045: native rutubemovie при ЖИВОЙ сети честно даёт «нет» → show:false (флейк «сети нет»); выключаем как остальные мажоры

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { server } = await import('../src/index.js');
const base = 'http://127.0.0.1:3299';

before(async () => {
  await new Promise((resolve) => server.listen(3299, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('/api/lampa/sources/card', () => {
  it('403 без подписки', async () => {
    const r = await fetch(`${base}/api/lampa/sources/card?id=13&serial=0`);
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error, 'subscription_required');
  });

  it('200 с токеном: {sources:[{id,show}], meta} — только native, сети нет', async () => {
    const r = await fetch(`${base}/api/lampa/sources/card?token=unit-test-token&id=13&serial=0&source=tmdb`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body.sources), 'sources — массив');
    assert.ok(body.sources.length >= 1, 'есть видимые источники (natives)');
    assert.ok(body.sources.every((s) => s.id && typeof s.show === 'boolean'), 'у каждого источника id + boolean show');
    // RULE-3: cdnvideohub в реальном Lampa-запросе без kinopoisk_id → authoritative «нет»
    // (не вечный inconclusive-show). Прочие native без сети (таймаут = вердикта нет) — show:true.
    const cdn = body.sources.find((s) => s.id === 'cdnvideohub');
    assert.ok(cdn, 'cdnvideohub присутствует в карточке');
    assert.equal(cdn.show, false, 'cdnvideohub без kp → «нет» (RULE-3)');
    assert.ok(body.sources.filter((s) => s.id !== 'cdnvideohub').every((s) => s.show === true), 'прочие native — show:true');
    assert.equal(typeof body.meta.count, 'number');
    assert.equal(typeof body.meta.elapsed_ms, 'number');
    assert.equal(typeof body.meta.cached, 'boolean');
  });

  it('не ломает статический /api/lampa/sources (реестр без изменений)', async () => {
    const r = await fetch(`${base}/api/lampa/sources?token=unit-test-token`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body.sources));
    assert.ok(body.sources.every((s) => s.id && s.url), 'статический реестр: url у каждого');
  });
});
