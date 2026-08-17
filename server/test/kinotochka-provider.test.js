// TASK-KINOTOCHKA-001: NATIVE Kinotochka (kinovibe.vip) — клиент + провайдер.
// Клиент тестируется через настоящие классы с фейковым fetchImpl (Response-like),
// чтобы покрыть регексы переноса Lampac Controller.cs (playerjshd, .txt-плейлист,
// DLE-поиск). Провайдер — на том же фейке + отдельно на fake-клиенте.
import test from 'node:test';
import assert from 'node:assert/strict';

import { KinotochkaClient, normalizeForSearch } from '../src/providers/kinotochka/KinotochkaClient.js';
import { KinotochkaNormalizer } from '../src/providers/kinotochka/KinotochkaNormalizer.js';
import { KinotochkaProvider } from '../src/providers/kinotochka/KinotochkaProvider.js';

// ── Fixtures (живые ответы kinovibe, сняты 2026-08-17) ──────────────────────
const KP_MATRIX = [
  { id: 169, url: 'https://kinovibe.cc/169-matrica-the-matrix-1999-bdrip-720p.html', embed: 'https://kinovibe.cc/embed/169' }
];

const MOVIE_PAGE = `<!doctype html>
<html><body>
<script>
var p = { id:"playerjshd", file:"https://svd13.kvb.cool/video_mp4/films/1999/TheMatrix/Y3xXZQF3QCAkPz5WHjs.JjoDHxUDOSc6JSo1A0QuKA::_YmVffAFpQkVDbA::/TheMatrix.mp4" };
</script>
</body></html>`;

// Список качеств через запятую — берём последний непустой (720p-хвост).
const MOVIE_PAGE_MULTI = `var p = { id:"playerjshd", file:"https://cdn.example.com/low.mp4, ,https://cdn.example.com/mid.mp4,https://cdn.example.com/high720.mp4" };`;

const KP_SERIAL = [
  { id: 1913, url: 'https://kinovibe.cc/1913-smotret-vo-vse-tyazhkie-5-sezon.html', embed: '' }
];

const SERIAL_PAGE = `<!doctype html>
<html><body>
file:"https://kinovibe.cc/player/plold/BreakingBad5.txt"
</body></html>`;

const SERIAL_PLAYLIST = JSON.stringify({
  playlist: [
    { comment: '1 Серия<br>LostFilm', file: 'https://svd2.kvb.cool/video_mp4/serials/BreakingBad/9fcabda70190bba9466af2f04737a764/s05e01.mp4' },
    { comment: '2 Серия<br>LostFilm', file: 'https://svd2.kvb.cool/video_mp4/serials/BreakingBad/9fcabda70190bba9466af2f04737a764/s05e02.mp4' },
    { comment: '3 Серия', file: 'https://svd2.kvb.cool/video_mp4/serials/BreakingBad/9fcabda70190bba9466af2f04737a764/[720,3].mp4' }
  ]
});

const DLE_PAGE = `<!doctype html>
<html><body>
<form id="searchform"><input name="do"><input name="subaction" value="search"></form>
<div>Поиск по сайту</div>
<div class="sres-wrap clearfix">
<h2>Во Все Тяжкие 5 Сезон (2013)</h2>
<a href="https://kinovibe.cc/1913-smotret-vo-vse-tyazhkie-5-sezon.html">открыть</a>
</div>
<div class="sres-wrap clearfix">
<h2>Другое Шоу 4 Сезон (2012)</h2>
<a href="https://kinovibe.cc/999.html">открыть</a>
</div>
</body></html>`;

const QUERY_MOVIE = { title: 'Матрица', original_title: 'The Matrix', year: 1999, kinopoisk_id: 301, kp: 301 };
const QUERY_SERIAL = { title: 'Во все тяжкие', original_title: 'Breaking Bad', kinopoisk_id: 404900, kp: 404900, serial: 1, type: 'serial' };

/** Фейковый fetchImpl маршрутами по подстроке URL (путь+query). */
function fakeFetch(routes) {
  return async function (url, options = {}) {
    const raw = String(url);
    const route = routes.find((r) => raw.includes(r.when));
    if (!route) return new Response('<!doctype html><html><body>mock 404</body></html>', { status: 404 });
    const body = typeof route.body === 'function' ? route.body(options) : route.body;
    return new Response(body, { status: route.status || 200, headers: { 'content-type': route.type || 'text/html; charset=utf-8' } });
  };
}

const MOVIE_ROUTES = [
  { when: '/api/find-by-kinopoisk.php?kinopoisk=301', type: 'application/json', body: JSON.stringify(KP_MATRIX) },
  { when: '/169-matrica', body: MOVIE_PAGE }
];

const SERIAL_ROUTES = [
  { when: '/api/find-by-kinopoisk.php?kinopoisk=404900', type: 'application/json', body: JSON.stringify(KP_SERIAL) },
  { when: '/1913-smotret-vo-vse-tyazhkie-5-sezon.html', body: SERIAL_PAGE },
  { when: '/player/plold/BreakingBad5.txt', type: 'application/json', body: SERIAL_PLAYLIST }
];

// ── Клиент ──────────────────────────────────────────────────────────────────
test('normalizeForSearch: как Lampac SearchNameTo (lowercase, ё→е, strip)', () => {
  assert.equal(normalizeForSearch('Во все тяжкие'), normalizeForSearch('ВО ВСЕ ТЯЖКИЕ'));
  assert.equal(normalizeForSearch('Ёлка и щука'), 'елкаишука');
  assert.equal(normalizeForSearch('Фильм: «Ёжик» (1999)!'), 'фильмежик1999');
});

test('KinotochkaClient.findByKinopoisk: маппит фильм (url/embed), пустое без kp/маппинга', async () => {
  const client = new KinotochkaClient({ fetchImpl: fakeFetch(MOVIE_ROUTES) });
  const urls = await client.findByKinopoisk(301);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].url, KP_MATRIX[0].url);

  assert.deepEqual(await client.findByKinopoisk(0), []);
  // 404 API-роута — HttpError (для availability), не тихий [].
  const busted = new KinotochkaClient({ fetchImpl: fakeFetch([]) });
  await assert.rejects(() => busted.findByKinopoisk(301), /Kinotochka HTTP 404/);
});

test('KinotochkaClient.movieFile: playerjshd → последний непустой segment', async () => {
  const client = new KinotochkaClient({ fetchImpl: fakeFetch(MOVIE_ROUTES) });
  const file = await client.movieFile(KP_MATRIX[0].url);
  assert.ok(file.startsWith('https://svd13.kvb.cool/'));
  assert.ok(file.endsWith('.mp4'));
  assert.ok(!file.includes(','), 'один URL после split(",")');

  // Список качеств — берём хвост (720p).
  const multi = new KinotochkaClient({ fetchImpl: fakeFetch([{ when: '/m', body: MOVIE_PAGE_MULTI }]) });
  assert.equal(await multi.movieFile('https://kinovibe.cc/m'), 'https://cdn.example.com/high720.mp4');

  // Нет playerjshd → пусто.
  const none = new KinotochkaClient({ fetchImpl: fakeFetch([{ when: '/n', body: '<html></html>' }]) });
  assert.equal(await none.movieFile('https://kinovibe.cc/n'), '');
});

test('KinotochkaClient.serialSeasons: все url с -N-sezon', () => {
  const client = new KinotochkaClient({ fetchImpl: fakeFetch([]) });
  assert.deepEqual(client.serialSeasons(KP_SERIAL), [{ season: 5, url: KP_SERIAL[0].url, name: '5 сезон' }]);
  assert.deepEqual(client.serialSeasons([]), []);
  assert.deepEqual(client.serialSeasons([{ url: 'https://kinovibe.cc/x-movie.html' }]), []);
});

test('KinotochkaClient.seasonPlaylist: .txt плейлист → чищенные серии', async () => {
  const client = new KinotochkaClient({ fetchImpl: fakeFetch(SERIAL_ROUTES) });
  const episodes = await client.seasonPlaylist(KP_SERIAL[0].url);
  assert.equal(episodes.length, 3);
  assert.equal(episodes[0].comment, '1 Серия'); // <br> отрезан
  assert.equal(episodes[0].file, 'https://svd2.kvb.cool/video_mp4/serials/BreakingBad/9fcabda70190bba9466af2f04737a764/s05e01.mp4');
  assert.equal(episodes[2].file, 'https://svd2.kvb.cool/video_mp4/serials/BreakingBad/9fcabda70190bba9466af2f04737a764/3.mp4'); // [720,3] снят
});

test('KinotochkaClient.searchByTitle: DLE-поиск с проверкой reqOk и SearchNameTo', async () => {
  const client = new KinotochkaClient({ fetchImpl: fakeFetch([{ when: 'index.php?do=search', body: DLE_PAGE }]) });
  const found = await client.searchByTitle('Во все тяжкие');
  assert.equal(found.length, 1);
  assert.equal(found[0].season, 5);
  assert.equal(found[0].name, '5 сезон');

  // Без маркера «Поиск по сайту» → пусто.
  const noMarker = new KinotochkaClient({ fetchImpl: fakeFetch([{ when: 'index.php?do=search', body: '<html>ничего</html>' }]) });
  assert.deepEqual(await noMarker.searchByTitle('Во все тяжкие'), []);
  assert.deepEqual(await client.searchByTitle(''), []);
});

// ── Нормализатор ────────────────────────────────────────────────────────────
test('KinotochkaNormalizer: movieRecord/serialRecord/seasons/episodes', () => {
  const n = new KinotochkaNormalizer();
  const movie = n.movieRecord(KP_MATRIX, QUERY_MOVIE);
  assert.equal(movie.provider, 'kinotochka');
  assert.equal(movie.type, 'movie');
  assert.equal(movie.kinopoisk_id, 301);
  assert.equal(movie.url, KP_MATRIX[0].url);

  const serial = n.serialRecord([{ season: 5, url: KP_SERIAL[0].url }], QUERY_SERIAL);
  assert.equal(serial.type, 'serial');

  assert.deepEqual(n.seasons([{ season: 5, url: 'x' }, { season: 2, url: 'y' }]), [
    { number: 2, title: '2 сезон' }, { number: 5, title: '5 сезон' }
  ]);
  const episodes = n.episodes([{ comment: '1 Серия', file: 'a.mp4' }, { comment: 'без номера', file: 'b.mp4' }, { comment: '2 Серия', file: '' }]);
  assert.deepEqual(episodes, [{ number: 1, title: '1 Серия', url: 'a.mp4' }]);
});

// ── Провайдер ───────────────────────────────────────────────────────────────
test('KinotochkaProvider: id/title/enabled (title «Kinotochka ~ 720p»)', () => {
  const provider = new KinotochkaProvider();
  assert.equal(provider.id, 'kinotochka');
  assert.equal(provider.title, 'Kinotochka ~ 720p');
  assert.equal(provider.name(), 'kinotochka');
  assert.equal(provider.enabled(), true);
});

test('KinotochkaProvider.search: фильм с kp → запись; без kp → []', async () => {
  const client = new KinotochkaClient({ fetchImpl: fakeFetch(MOVIE_ROUTES) });
  const provider = new KinotochkaProvider({ client });

  const records = await provider.search(QUERY_MOVIE);
  assert.equal(records.length, 1);
  assert.equal(records[0].type, 'movie');

  assert.deepEqual(await provider.search({ title: 'Матрица' }), []);
});

test('KinotochkaProvider.search: сериал с kp и через DLE по названию', async () => {
  const client = new KinotochkaClient({ fetchImpl: fakeFetch([...SERIAL_ROUTES, { when: 'index.php?do=search', body: DLE_PAGE }]) });
  const provider = new KinotochkaProvider({ client });

  const byKp = await provider.search(QUERY_SERIAL);
  assert.equal(byKp.length, 1);
  assert.equal(byKp[0].type, 'serial');

  const byTitle = await provider.serial({ title: 'Во все тяжкие', serial: 1, type: 'serial' });
  assert.equal(byTitle.length, 1);
});

test('KinotochkaProvider.videos: фильм → один play-item «По умолчанию» через прокси', async () => {
  const client = new KinotochkaClient({ fetchImpl: fakeFetch(MOVIE_ROUTES) });
  const provider = new KinotochkaProvider({ client });

  const payload = await provider.videos({ query: QUERY_MOVIE });
  assert.equal(payload.items.length, 1);
  const item = payload.items[0];
  assert.equal(item.method, 'play');
  assert.equal(item.type, 'movie');
  assert.equal(item.title, 'По умолчанию');
  assert.equal(item.quality['720p'], item.url);
  assert.match(item.url, /\/api\/lampa\/proxy\?url=/);
  assert.equal(item.url.split('url=')[1].startsWith(encodeURIComponent('https://svd13.kvb.cool')), true);
  assert.deepEqual(payload.seasons, []);
  assert.deepEqual(payload.voices, []);
});

test('KinotochkaProvider.videos: сериал → seasons из url + play-серии выбранного сезона', async () => {
  const client = new KinotochkaClient({ fetchImpl: fakeFetch(SERIAL_ROUTES) });
  const provider = new KinotochkaProvider({ client });

  // Без season — дефолтный (первый) сезон.
  const defaultPayload = await provider.videos({ query: { ...QUERY_SERIAL } });
  assert.deepEqual(defaultPayload.seasons, [{ number: 5, title: '5 сезон' }]);
  assert.equal(defaultPayload.items.length, 3);
  for (const item of defaultPayload.items) {
    assert.equal(item.method, 'play');
    assert.equal(item.type, 'serial');
    assert.equal(item.season, 5);
    assert.ok(item.episode > 0);
    assert.match(item.url, /\/api\/lampa\/proxy\?url=/);
  }
  assert.equal(defaultPayload.items[0].title, '1 Серия');
  assert.equal(defaultPayload.items[0].episode, 1);
  assert.equal(defaultPayload.items[2].url.split('url=')[1].includes('%2F3.mp4'), true, '[720,3].mp4 → 3.mp4');

  // Явный season=N.
  const seasonPayload = await provider.videos({ query: { ...QUERY_SERIAL, season: 5 } });
  assert.equal(seasonPayload.items.length, 3);
});

test('KinotochkaProvider.videos: пусто (нет kp / нет файла / ошибка) → пустой payload', async () => {
  const client = new KinotochkaClient({ fetchImpl: fakeFetch(MOVIE_ROUTES) });
  const provider = new KinotochkaProvider({ client });

  assert.deepEqual(await provider.videos({ query: { title: 'Х' } }), { items: [], seasons: [], voices: [] });

  const busted = new KinotochkaProvider({ client: new KinotochkaClient({ fetchImpl: async () => { throw new Error('network'); } }) });
  assert.deepEqual(await busted.videos({ query: QUERY_MOVIE }), { items: [], seasons: [], voices: [] });
});

test('KinotochkaProvider.streams: файл-URL → StreamItem 720p через прокси', async () => {
  const provider = new KinotochkaProvider({ client: new KinotochkaClient({ fetchImpl: fakeFetch([]) }) });
  const items = await provider.streams({ file: 'https://svd13.kvb.cool/x.mp4', title: 'Матрица', type: 'movie' });
  assert.equal(items.length, 1);
  assert.equal(items[0].provider, 'kinotochka');
  assert.equal(items[0].type, 'movie');
  assert.equal(items[0].quality, '720p');
  assert.match(items[0].stream.url, /\/api\/lampa\/proxy\?url=/);
  assert.deepEqual(items[0].subtitles, []);

  assert.deepEqual(await provider.streams({}), []);
  assert.deepEqual(await provider.streams({ file: 'not-a-url' }), []);
});

test('KinotochkaProvider: отключён → [] везде, клиент не трогается', async () => {
  let called = false;
  const client = new KinotochkaClient({ fetchImpl: async () => { called = true; return new Response('{}'); } });
  const provider = new KinotochkaProvider({ client, enabled: false });

  assert.deepEqual(await provider.search(QUERY_MOVIE), []);
  assert.deepEqual(await provider.videos({ query: QUERY_MOVIE }), { items: [], seasons: [], voices: [] });
  assert.deepEqual(await provider.streams({ file: 'https://x/y.mp4' }), []);
  assert.equal(called, false);
});

test('isSerialRequest: query формы Lampa', async () => {
  const { isSerialRequest } = await import('../src/providers/kinotochka/KinotochkaProvider.js');
  assert.equal(isSerialRequest({ serial: '1' }), true);
  assert.equal(isSerialRequest({ type: 'serial' }), true);
  assert.equal(isSerialRequest({ serial_type: 'serial' }), true);
  assert.equal(isSerialRequest({ serial: '0' }), false);
  assert.equal(isSerialRequest({}), false);
});

test('Registry: kinotochka — видимый native, подпись «Kinotochka - 720p», без skaz-twin', async () => {
  const { registeredProviders, providerById, twinFor } = await import('../src/providers/registry.js');
  const { providerMeta } = await import('../src/providers/meta.js');

  const ids = registeredProviders().map((p) => p.id);
  assert.ok(ids.includes('kinotochka'), 'kinotochka — в видимом реестре (/sources)');
  const provider = providerById('kinotochka');
  assert.ok(provider, 'providerById(kinotochka)');
  assert.equal(provider.show !== false, true, 'видим');
  assert.ok(provider.enabled(), 'enabled без токена');
  assert.equal(twinFor('kinotochka'), null, 'skaz-близнеца нет (не в skaz.balancers)');
  // Клиент клеит «name - qualityLabel» (как «Allo-XA - 4K») → подпись
  // «Kinotochka - 720p» (Lampac-аналог «Kinotochka ~ 720p»).
  assert.equal(providerMeta('kinotochka').name, 'Kinotochka');
  assert.equal(providerMeta('kinotochka').qualityLabel, '720p');
});