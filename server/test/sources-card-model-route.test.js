// SKAZ-MANIYA-019: маршрут /api/lampa/sources/card — per-title модель.
// 1) config.skaz.enabled + успешные events → {sources:[ПОЛНЫЕ items], meta.model:true}.
// 2) события недоступны (fetch null/503 на пуле) → старый probe-path ДОСЛОВНО
//    (legacy {id,show}, meta БЕЗ model) — детерминизм, никакой частичной модели.
// Env и стаб ставятся ДО import: SkazClient захватывает `options.fetchImpl || fetch`
// в конструкторе (sourceModel — singleton, клиент создаётся при import).
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = '*';
process.env.RATE_LIMIT_MAX = '1000';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:3319';
process.env.USERS_FILE = new URL('./fixtures/users.json', import.meta.url).pathname;
process.env.VIDEOS_FILE = new URL('./fixtures/videos.json', import.meta.url).pathname;
process.env.SKAZ_ENABLED = '1';
process.env.SKAZ_CHECK_ENABLED = '1';
process.env.SKAZ_CHECK_TIMEOUT_MS = '300';
process.env.SKAZ_HOSTS = 'http://model.example';
// Native намеренно выключены: судим ТОЛЬКО про модель; probe-фолбэк без них дешёвый
// (проверка формы, не значений конкретных провайдеров).
process.env.FILMIX_ENABLED = '0';
process.env.REZKA_ENABLED = '0';
process.env.KODIK_ENABLED = '0';
process.env.ALLOHA_ENABLED = '0';
process.env.COLLAPS_ENABLED = '0';
process.env.HDVB_ENABLED = '0';
process.env.KINOTOCHKA_ENABLED = '0';
process.env.CDNVIDEOHUB_ENABLED = '0';
process.env.RUTUBEMOVIE_ENABLED = '0';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Свежая фикстура mutiny (32 записи online[]), санированная.
const MUTINY = JSON.parse(
  await readFile(new URL('./fixtures/t019-mutiny.json', import.meta.url), 'utf8')
);

const CLUSTER_PREFIX = 'http://model.example/';
const realFetch = globalThis.fetch;
let FETCH_MODE = 'events'; // events | empty | events-fail

function eventsResponse(online) {
  return {
    status: 200, ok: true, url: 'http://model.example/lite/events',
    headers: {},
    body: { cancel: () => {} },
    text: async () => JSON.stringify({ online })
  };
}

globalThis.fetch = async (url, opts = {}) => {
  const href = String(url);
  // Только кластерные запросы (SKAZ_HOSTS) — стабим; всё остальное (loopback
  // в in-process сервер, статусы, прокси) — реальный fetch без изменений.
  if (href.startsWith(CLUSTER_PREFIX)) {
    if (href.includes('/lite/events')) {
      if (FETCH_MODE === 'empty') return eventsResponse([]);
      if (FETCH_MODE === 'events-fail') return null;
      return eventsResponse(MUTINY);
    }
    // probe-запросы /lite/* в events-fail режиме — быстрый 503 (сети нет).
    return { status: 503, ok: false, url: href, headers: {}, body: { cancel: () => {} }, text: async () => 'null' };
  }
  return realFetch(url, opts);
};

// Все модули — через динамический import ПОСЛЕ env-присваиваний: статический
// import был бы хойстнут и оценил config.js (и .env) ДО сета env-переменных
// → сервер прочитал бы БОЕВОЙ USERS_FILE/creds и залогинил бы unit-test-token
// не нашёл (403 subscription_required). Динамический import фиксирует order.
const { server } = await import('../src/index.js');
const { sourceModel } = await import('../src/sources/sourceModel.js');
const base = 'http://127.0.0.1:3319';
const QUERY = 'id=1288445&title=%D0%9C%D1%8F%D1%82%D0%B5%D0%B6&serial=0&year=2026&source=tmdb';

before(async () => {
  await new Promise((resolve) => server.listen(3319, '127.0.0.1', resolve));
});

// Изоляция кэша: этот env читает server/.env (creds кластера), ключ кэша =
// card params + uid ОДИНАКОВ во всех тестах → обязателен сброс между тестами,
// иначе FETCH_MODE не доходит до getOnline (singleflight/cache-хит из test 1).
beforeEach(() => {
  sourceModel._cache.clear();
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('/api/lampa/sources/card (per-title model)', () => {
  it('жёсткая схема: каждый item — ПОЛНЫЙ (id+name+index+show+ghost+api_url), никаких {id,show}-строк', async () => {
    FETCH_MODE = 'events';
    const r = await fetch(`${base}/api/lampa/sources/card?token=unit-test-token&${QUERY}`);
    assert.equal(r.status, 200);
    const body = await r.json();

    assert.equal(body.meta.model, true, 'meta.model:true — маркер модели');
    assert.ok(Array.isArray(body.sources));
    // 32 кластерных (KinoPub, …) + 2 Maniya-only extras (skaz-kodik, skaz-rhsprem):
    // natives выключены (collaps отсутствует), kodik-слаг в cluster 32 закрыт сам.
    assert.equal(body.sources.length, 34);

    const required = ['id', 'name', 'index', 'show', 'ghost', 'balanser', 'rch', 'voices', 'seasons', 'api_url'];
    for (const row of body.sources) {
      for (const field of required) {
        assert.ok(field in row, `поле \`${field}\` присутствует у ${row.id}`);
      }
      assert.equal(typeof row.show, 'boolean', `show — boolean (${row.id})`);
    }

    const first = body.sources[0];
    assert.equal(first.index, 1);
    assert.equal(first.balanser, 'kinopub', 'первый (index 1) = KinoPub');
    assert.equal(first.name, 'KinoPub');
    assert.equal(first.api_url, '/api/lampa/videos?provider=skaz-kinopub');

    // Как в прод-карточке SKAZ: скрытые присутствуют (ghost), 3 rch-строки.
    assert.ok(body.sources.some((s) => s.ghost === true), 'ghost-ряд сохранён');
    assert.ok(body.sources.some((s) => s.rch === true), 'rch-ряд сохранён (ashdi/kinoukr/eneyida)');
    assert.ok(!body.sources.some((s) => s.balanser === 'filmixtv'), 'filmixtv отсутствует');
    assert.equal(body.meta.count, 34);
    assert.equal(typeof body.meta.elapsed_ms, 'number');
    assert.equal(typeof body.meta.cached, 'boolean');
  });

  it('детерминизм: пустой online[] — extras-only модель (все index=null, БЕЗ probe-волн)', async () => {
    FETCH_MODE = 'empty';
    const r = await fetch(`${base}/api/lampa/sources/card?token=unit-test-token&${QUERY}`);
    assert.equal(r.status, 200);
    const body = await r.json();

    assert.equal(body.meta.model, true, 'пустой online[] — по-прежнему детерминированная модель');
    // В этом env natives выключены → extras = все 18 видимых skaz-мостов, не покрытых
    // кластерным online[] (который пуст) → ровно 18 rows, каждая index:null,
    // оптимистичный show из реестра (без probe-волн — АУДИТ §8).
    assert.equal(body.sources.length, 18, 'extras = 18 skaz-мостов (все видимые, natives off)');
    assert.ok(body.sources.every((s) => s.index === null), 'кластер пуст → только extras (index=null)');
    assert.ok(body.sources.every((s) => s.show === true && s.ghost === false), 'extras: оптимистичный show');
    assert.ok(body.sources.every((s) => String(s.id).startsWith('skaz-')), 'extras: только skaz-мосты');
    assert.ok(body.sources.every((s) => s.api_url.startsWith('/api/lampa/videos?provider=')), 'extras: api_url');
  });

  it('fallback: события НЕДОСТУПНЫ → старый probe-path, legacy {id,show}, meta.model НЕ true', async () => {
    FETCH_MODE = 'events-fail';
    const r = await fetch(`${base}/api/lampa/sources/card?token=unit-test-token&${QUERY}`);
    assert.equal(r.status, 200);
    const body = await r.json();

    assert.notEqual(body.meta.model, true, 'не модель — старый путь');
    assert.ok(Array.isArray(body.sources));
    for (const row of body.sources) {
      assert.equal(typeof row.id, 'string', 'legacy: id-строка');
      assert.equal(typeof row.show, 'boolean', 'legacy: boolean show');
      assert.ok(!('index' in row), 'legacy: НЕТ index (никаких половинчатых полей)');
      assert.ok(!('name' in row), 'legacy: НЕТ name');
      assert.ok(!('api_url' in row), 'legacy: НЕТ api_url');
    }
    assert.equal(typeof body.meta.count, 'number');
    assert.equal(typeof body.meta.elapsed_ms, 'number');
    assert.equal(typeof body.meta.cached, 'boolean');
  });

  it('не ломает статические /api/lampa/sources (реестр без изменений)', async () => {
    FETCH_MODE = 'events';
    const r = await fetch(`${base}/api/lampa/sources?token=unit-test-token`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body.sources));
    assert.ok(body.sources.every((s) => s.id && s.url), 'статика: id+url у каждого');
  });
});