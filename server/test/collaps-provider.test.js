import test from 'node:test';
import assert from 'node:assert/strict';

import { HttpError } from '../src/errors.js';
import { config } from '../src/config.js';
import { twinFor } from '../src/providers/registry.js';
import { CollapsProvider } from '../src/providers/collaps/CollapsProvider.js';
import { CollapsNormalizer, isMovieType } from '../src/providers/collaps/CollapsNormalizer.js';

/** Fake CollapsClient: методы, которые зовёт провайдер. */
class FakeCollapsClient {
  constructor({ searchData = null, embedByText = '', embedByKey = {}, enabled = true, embedError = null } = {}) {
    this.calls = [];
    this.searchData = searchData;
    this.embedByKey = embedByKey;
    this.enabledFlag = enabled;
    this.embedError = embedError;
    this.apihost = 'https://api.bhcesh.me';
    this.embedHost = 'https://api.ortified.ws';
  }

  enabled() {
    return this.enabledFlag;
  }

  async search(title) {
    this.calls.push(['search', title]);
    return this.searchData;
  }

  async embed(options = {}) {
    this.calls.push(['embed', options]);
    if (this.embedError) throw this.embedError;
    const key = options.kinopoiskId || options.imdbId || options.orid || options.orId || '';
    const text = this.embedByKey[key] || '';
    return { text, embedHost: this.embedHost };
  }
}

// --- фикстуры embed-страниц ---

// Фильм: makePlayer с блоком source (hls + audio.names + cc).
const MOVIE_EMBED = `
<script>
  makePlayer({
    is_series: false,
    source: {
      hls: "https://rawhls.interkh.com/movie/master.m3u8",
      dasha: "https://rawdash.interkh.com/movie/manifest.mpd",
      audio: { names: ["Дубляж", "Оригинал"] },
      cc: [
        { name: "Русские", url: "https://subs.interkh.com/movie/ru.vtt" },
        { name: "English", url: "https://subs.interkh.com/movie/en.vtt" }
      ]
    }
  });
</script>`;

// Сериал: seasons-блок с сериями (hls/dash + audio.names + cc).
const SERIAL_EMBED = `
  var _s = {
    seasons: [
      {
        season: 1,
        episodes: [
          {
            episode: 1,
            title: "1 серия",
            hls: "https://rawhls.interkh.com/s1e1/master.m3u8",
            audio: { names: ["Дубляж"] },
            cc: [{ name: "Русские", url: "https://subs.interkh.com/s1e1/ru.vtt" }]
          },
          {
            episode: 2,
            title: "2 серия",
            dash: "https://rawdash.interkh.com/s1e2/manifest.mpd",
            audio: { names: ["Дубляж", "Оригинал"] },
            cc: []
          }
        ]
      },
      {
        season: 2,
        episodes: [
          {
            episode: 1,
            title: "1 серия",
            hls: "https://rawhls.interkh.com/s2e1/master.m3u8",
            audio: { names: ["Оригинал"] },
            cc: []
          }
        ]
      }
    ]
  };
`;

const SEARCH_ROOT = {
  total: 2,
  results: [
    { id: 101, name: 'Дюна', origin_name: 'Dune', year: 2021, type: 'film', kinopoisk_id: 999, imdb_id: 'tt1160419', poster: 'https://x/p.jpg', iframe_url: 'https://api.ortified.ws/embed/movie/101' },
    { id: 102, name: 'Острые козырьки', origin_name: 'Peaky Blinders', year: 2013, type: 'series', kinopoisk_id: 777, imdb_id: 'tt2442560', poster: 'https://x/s.jpg', iframe_url: 'https://api.ortified.ws/embed/movie/102' }
  ]
};

const QUERY = { title: 'Дюна', kp: 999, kinopoisk_id: 999, id: 101 };

// --- нормализатор ---

test('isMovieType: film/anime → movie, series/serial → false', () => {
  assert.equal(isMovieType('film'), true);
  assert.equal(isMovieType('cartoon'), true);
  assert.equal(isMovieType('anime'), true);
  assert.equal(isMovieType('russian-movie'), true);
  assert.equal(isMovieType('series'), false);
  assert.equal(isMovieType('serial'), false);
  assert.equal(isMovieType('tvseries'), false);
  // Неизвестный/пустой тип — не сериал по явному списку → трактуем как фильм.
  assert.equal(isMovieType(''), true);
  assert.equal(isMovieType('unknown'), true);
});

test('CollapsNormalizer.search: результаты → записи по типу', () => {
  const n = new CollapsNormalizer();
  const records = n.search(SEARCH_ROOT, QUERY);
  assert.equal(records.length, 2);
  assert.equal(records[0].provider, 'collaps');
  assert.equal(records[0].type, 'movie');
  assert.equal(records[0].kinopoisk_id, 999);
  assert.equal(records[0].id, '101');
  assert.equal(records[0].embedHost, 'https://api.ortified.ws');
  assert.equal(records[1].type, 'serial');
  assert.equal(records[1].title, 'Острые козырьки');
  assert.equal(records[1].imdb_id, 'tt2442560');
  assert.equal(n.search(null, QUERY).length, 0);
  assert.equal(n.search({ results: [] }, QUERY).length, 0);
});

test('CollapsNormalizer.parseEmbed: фильм — source с hls + names + cc', () => {
  const n = new CollapsNormalizer();
  const parsed = n.parseEmbed(MOVIE_EMBED, QUERY);
  assert.equal(parsed.isSerial, false);
  assert.ok(parsed.movie);
  assert.equal(parsed.movie.url, 'https://rawhls.interkh.com/movie/master.m3u8');
  assert.deepEqual(parsed.movie.audioNames, ['Дубляж', 'Оригинал']);
  assert.deepEqual(parsed.movie.cc.map((c) => c.name), ['Русские', 'English']);
  assert.ok(parsed.movie.voicename.includes('Дубляж'));
});

test('CollapsNormalizer.parseEmbed: сериал — seasons/episodes', () => {
  const n = new CollapsNormalizer();
  const parsed = n.parseEmbed(SERIAL_EMBED, QUERY);
  assert.equal(parsed.isSerial, true);
  assert.equal(parsed.seasons.length, 2);
  assert.equal(parsed.seasons[0].number, 1);
  assert.equal(parsed.seasons[0].episodes.length, 2);
  assert.equal(parsed.seasons[1].episodes.length, 1);
  const ep1 = parsed.seasons[0].episodes[0];
  assert.equal(ep1.number, 1);
  assert.equal(ep1.url, 'https://rawhls.interkh.com/s1e1/master.m3u8');
  assert.deepEqual(ep1.audioNames, ['Дубляж']);
  assert.equal(ep1.cc.length, 1);
});

test('parseEmbed: пустой/битый HTML → пусто', () => {
  const n = new CollapsNormalizer();
  assert.deepEqual(n.parseEmbed('', QUERY), { isSerial: false, movie: null, seasons: [] });
  assert.deepEqual(n.parseEmbed('<html>no source</html>', QUERY), { isSerial: false, movie: null, seasons: [] });
});

// --- провайдер ---

test('CollapsProvider: enabled зависит от client.enabled', () => {
  const on = new FakeCollapsClient({ enabled: true });
  const off = new FakeCollapsClient({ enabled: false });
  assert.equal(new CollapsProvider({ client: on }).enabled(), true);
  assert.equal(new CollapsProvider({ client: off }).enabled(), false);
  assert.equal(new CollapsProvider({ client: on, enabled: false }).enabled(), false);
});

test('CollapsProvider.search: по названию → записи, клиент получил title', async () => {
  const client = new FakeCollapsClient({ searchData: SEARCH_ROOT });
  const provider = new CollapsProvider({ client });
  const records = await provider.search(QUERY);
  assert.equal(records.length, 2);
  assert.deepEqual(client.calls, [['search', 'Дюна']]);
});

test('CollapsProvider.search: без названия → запись по каноническому orid (embed)', async () => {
  const client = new FakeCollapsClient({ embedByKey: { 101: MOVIE_EMBED } });
  const provider = new CollapsProvider({ client });
  const records = await provider.search({ orid: 101 });
  assert.equal(records.length, 1);
  assert.equal(records[0].provider, 'collaps');
  assert.equal(records[0].type, 'movie');
  assert.ok(records[0].parsed);
  // Канон identity: client получил orid, а не TMDB id.
  assert.equal(client.calls[0][1].orid, 101);
  assert.equal(Number(client.calls[0][1].kinopoiskId || 0), 0);
});

test('CollapsProvider.movie/serial: фильтр по типу из поиска', async () => {
  const client = new FakeCollapsClient({ searchData: SEARCH_ROOT });
  const provider = new CollapsProvider({ client });
  assert.equal((await provider.movie(QUERY)).length, 1);
  assert.equal((await provider.serial(QUERY)).length, 1);
});

test('CollapsProvider.videos: фильм → один play-item (auto, субтитры, озвучка)', async () => {
  const client = new FakeCollapsClient({ embedByKey: { 999: MOVIE_EMBED } });
  const provider = new CollapsProvider({ client });

  const payload = await provider.videos({ query: { ...QUERY, embedHost: 'https://api.ortified.ws' } });

  assert.equal(payload.items.length, 1);
  const item = payload.items[0];
  assert.equal(item.method, 'play');
  assert.equal(item.type, 'movie');
  assert.match(item.url, /\/api\/lampa\/proxy\?url=/);
  assert.equal(item.quality.auto, item.url);
  assert.equal(item.voice_name, 'Дубляж, Оригинал');
  assert.deepEqual(item.sound, ['Дубляж', 'Оригинал']);
  assert.equal(item.subtitles.length, 2);
  assert.match(item.subtitles[0].url, /\/api\/lampa\/proxy\?url=/);
  assert.equal(item.headers.Referer, 'https://kinokrad.my/');
  assert.equal(payload.seasons.length, 0);
  assert.equal(payload.voices.length, 1);
});

test('CollapsProvider.videos: сериал → play-items по сериям выбранного сезона', async () => {
  const client = new FakeCollapsClient({ embedByKey: { 102: SERIAL_EMBED } });
  const provider = new CollapsProvider({ client });

  const payload = await provider.videos({ query: { orid: 102, season: 1 } });

  assert.deepEqual(payload.seasons, [
    { number: 1, title: '1 сезон' },
    { number: 2, title: '2 сезон' }
  ]);
  // Сезон 1: 2 серии.
  assert.equal(payload.items.length, 2);
  for (const item of payload.items) {
    assert.equal(item.method, 'play');
    assert.equal(item.type, 'serial');
    assert.equal(item.season, 1);
    assert.match(item.url, /\/api\/lampa\/proxy\?url=/);
  }
  assert.deepEqual(payload.voices.map((v) => v.name), ['Дубляж', 'Дубляж, Оригинал', 'Оригинал']);
});

test('CollapsProvider.videos: без embed/пусто → пусто', async () => {
  const client = new FakeCollapsClient({ embedByKey: {} });
  const provider = new CollapsProvider({ client });
  assert.deepEqual(await provider.videos({ query: QUERY }), { items: [], seasons: [], voices: [] });
});

test('CollapsProvider.streams: url → StreamItem (auto, прокси, Referer kinokrad)', async () => {
  const client = new FakeCollapsClient();
  const provider = new CollapsProvider({ client });

  const items = await provider.streams({ url: 'https://rawhls.interkh.com/s1e1/master.m3u8', title: 'Серия', type: 'serial' });
  assert.equal(items.length, 1);
  const stream = items[0];
  assert.equal(stream.provider, 'collaps');
  assert.equal(stream.type, 'serial');
  assert.equal(stream.quality, 'auto');
  assert.equal(stream.voice, 'Оригинал');
  assert.match(stream.stream.url, /\/api\/lampa\/proxy\?url=/);
  assert.equal(stream.stream.headers.Referer, 'https://kinokrad.my/');
});

test('CollapsProvider: отключён → [] везде, клиент не трогается', async () => {
  const client = new FakeCollapsClient({ searchData: SEARCH_ROOT });
  const provider = new CollapsProvider({ client, enabled: false });
  assert.deepEqual(await provider.search(QUERY), []);
  assert.deepEqual(await provider.videos({ query: QUERY }), { items: [], seasons: [], voices: [] });
  assert.deepEqual(await provider.streams({ url: 'https://x/m.m3u8' }), []);
  assert.equal(client.calls.length, 0);
});

test('CollapsProvider: client/normalizer инъекции', () => {
  const client = new FakeCollapsClient();
  const normalizer = new CollapsNormalizer();
  const provider = new CollapsProvider({ client, normalizer });
  assert.equal(provider.client, client);
  assert.equal(provider.normalizer, normalizer);
});

// --- COLLAPS-FIX-001: единая identity / shape-консистентность / 422 ≠ EMPTY / Skaz не затронут ---
// Root causes (docs/balancer-architecture-audit-001-report.md §7.3):
//  SHAPE — show через title-only search, /videos заново угадывает фильм → пусто/422;
//  ID-ROUTE — query.id = TMDB id использовался как collaps-orid (`/embed/movie/{tmdb}` → 404),
//  + поле orId передавалось, а клиент читал orid → маршрут карточки ≠ маршруту videos.

test('COL-1 title-only карточка → search identity → playable item (COLLAPS-SHAPE)', async () => {
  // Карточка БЕЗ kp/imdb/orid: show:true обеспечен title-search; videos обязан
  // использовать ТУ ЖЕ запись (bestMatch) — /videos не пуст.
  const client = new FakeCollapsClient({ searchData: SEARCH_ROOT, embedByKey: { 999: MOVIE_EMBED } });
  const provider = new CollapsProvider({ client });

  const payload = await provider.videos({ query: { title: 'Дюна' } });

  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].method, 'play');
  assert.equal(payload.items[0].type, 'movie');
  // identity единая: клиент ушёл по kp 999 (найденной записи), а не пустым маршрутом.
  const embedCall = client.calls.find(([name]) => name === 'embed')[1];
  assert.equal(embedCall.kinopoiskId, 999);
  assert.equal(embedCall.orid, 101);
});

test('COL-2 query.id (TMDB) НЕ используется как collaps-orid — маршрут через search (COLLAPS-ID-ROUTE)', async () => {
  // id=101 в query — это TMDB id, не collaps-orid: прямой /embed/movie/101 был бы 404.
  // Провайдер игнорирует id как identity и находит запись по titre-поиску.
  const client = new FakeCollapsClient({ searchData: SEARCH_ROOT, embedByKey: { 999: MOVIE_EMBED } });
  const provider = new CollapsProvider({ client });

  const payload = await provider.videos({ query: { id: 101, title: 'Дюна' } });

  assert.equal(payload.items.length, 1);
  const embedCall = client.calls.find(([name]) => name === 'embed')[1];
  assert.equal(embedCall.kinopoiskId, 999); // найденный kp, НЕ id-маршрут
});

test('COL-3 канонический orid → прямой embed-маршрут (та же identity, что у карточки)', async () => {
  const client = new FakeCollapsClient({ embedByKey: { 101: MOVIE_EMBED } });
  const provider = new CollapsProvider({ client });

  const payload = await provider.videos({ query: { orid: 101, title: 'Дюна' } });

  assert.equal(payload.items.length, 1);
  const embedCall = client.calls.find(([name]) => name === 'embed')[1];
  assert.equal(embedCall.orid, 101);
  assert.equal(Number(embedCall.kinopoiskId || 0), 0); // orid — самостоятельный маршрут
});

test('COL-4 422 на рабочую identity — provider_error upstream-refusal, НЕ молчаливый EMPTY', async () => {
  const client = new FakeCollapsClient({
    embedByKey: { 101: MOVIE_EMBED },
    embedError: new HttpError(422, 'collaps_http_error', 'Collaps HTTP 422', { kind: 'upstream-refusal' })
  });
  const provider = new CollapsProvider({ client });

  const payload = await provider.videos({ query: { orid: 101, title: 'Дюна' } });

  assert.deepEqual(payload.items, []);
  assert.equal(payload.provider_error.status, 422);
  assert.equal(payload.provider_error.kind, 'upstream-refusal');
});

test('COL-5 404 — invalid-route (identity/маршрут неверный), тоже НЕ EMPTY', async () => {
  const client = new FakeCollapsClient({ embedError: new HttpError(404, 'collaps_http_error', 'Collaps HTTP 404', { kind: 'invalid-route' }) });
  const provider = new CollapsProvider({ client });

  const payload = await provider.videos({ query: { orid: 999999, title: 'Дюна' } });

  assert.deepEqual(payload.items, []);
  assert.equal(payload.provider_error.kind, 'invalid-route');
});

test('COL-6 подтверждённое отсутствие контента — EMPTY БЕЗ provider_error', async () => {
  const client = new FakeCollapsClient({ embedByKey: {} }); // embed 200, но нет source
  const provider = new CollapsProvider({ client });

  const payload = await provider.videos({ query: { orid: 101, title: 'Дюна' } });

  assert.deepEqual(payload, { items: [], seasons: [], voices: [] });
});

test('COL-7 Collaps НЕ входит в Skaz: ни балансером, ни twin (архитектурный инвариант)', () => {
  assert.equal(config.skaz.balancers.includes('collaps'), false);
  assert.equal(twinFor('collaps'), null);
  const provider = new CollapsProvider({ client: new FakeCollapsClient() });
  assert.equal(provider.id, 'collaps');
});