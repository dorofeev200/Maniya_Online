import test from 'node:test';
import assert from 'node:assert/strict';

import { KodikProvider } from '../src/providers/kodik/KodikProvider.js';

/** Fake KodikClient: только методы, которые зовёт провайдер. */
class FakeKodikClient {
  constructor({ byQuery = {}, ids = [], streamRaw = {} } = {}) {
    this.calls = [];
    this.byQuery = byQuery;
    this.ids = ids;
    this.streamRaw = streamRaw;
    this.token = 'test-token';
  }

  enabled() {
    return Boolean(this.token);
  }

  async searchByTitle({ title = '', originalTitle = '' }) {
    const query = originalTitle || title;
    this.calls.push(['searchByTitle', query]);
    return this.byQuery[query] || [];
  }

  async searchByIds() {
    this.calls.push(['searchByIds']);
    return this.ids;
  }

  async streams(link, { ip } = {}) {
    this.calls.push(['streams', link, ip]);
    return this.streamRaw;
  }
}

const MOVIE_RAW = {
  id: 'm1',
  title: 'Начало',
  title_orig: 'Inception',
  type: 'foreign-movie',
  year: 2010,
  link: 'https://example.com/player/m1',
  kinopoisk_id: '111',
  imdb_id: 'tt1375666',
  translation: { title: 'Дубляж' },
  last_season: 0,
  seasons: {},
  material_data: { poster_url: 'https://cdn.kodik.com/p1.jpg' }
};

const SERIAL_RAW = {
  id: 's1',
  title: 'Во все тяжкие',
  title_orig: 'Breaking Bad',
  type: 'foreign-serial',
  year: 2008,
  link: 'https://example.com/player/s1',
  kinopoisk_id: '222',
  imdb_id: 'tt0903747',
  translation: { title: 'Дубляж' },
  last_season: 2,
  seasons: {
    '1': {
      link: 'https://example.com/player/s1/1',
      episodes: {
        '1': 'https://example.com/ep/1/1',
        '2': 'https://example.com/ep/1/2'
      }
    },
    '2': {
      link: 'https://example.com/player/s1/2',
      episodes: { '1': 'https://example.com/ep/2/1' }
    }
  },
  material_data: { poster_url: 'https://cdn.kodik.com/s1.jpg' }
};

const SERIAL_RAW_2 = {
  ...SERIAL_RAW,
  id: 's2',
  translation: { title: 'Оригинал' },
  last_season: 1
};

test('KodikProvider.search: по названию → записи с метаданными (постер, перевод, год)', async () => {
  const client = new FakeKodikClient({ byQuery: { Inception: [MOVIE_RAW] } });
  const provider = new KodikProvider({ client });

  const records = await provider.search({ title: 'Начало', original_title: 'Inception' });

  assert.equal(records.length, 1);
  const record = records[0];
  assert.equal(record.provider, 'kodik');
  assert.equal(record.id, 'm1');
  assert.equal(record.title, 'Начало');
  assert.equal(record.original_title, 'Inception');
  assert.equal(record.year, 2010);
  assert.equal(record.type, 'movie');
  assert.equal(record.poster, 'https://cdn.kodik.com/p1.jpg');
  assert.equal(record.translation.title, 'Дубляж');
  assert.equal(record.stream.link, 'https://example.com/player/m1');
  assert.equal(record.metadata.translation, 'Дубляж');
  assert.deepEqual(record.metadata.translations, ['Дубляж']);
  assert.deepEqual(record.metadata.seasons, []);

  // title-параметр берёт original_title первым (как Lampac Embed(title, original_title)).
  assert.deepEqual(client.calls, [['searchByTitle', 'Inception']]);
});

test('KodikProvider.search: фолбэк original_title → title при пустом результате', async () => {
  const client = new FakeKodikClient({ byQuery: { 'Во все тяжкие': [SERIAL_RAW] } });
  const provider = new KodikProvider({ client });

  const records = await provider.search({ title: 'Во все тяжкие', original_title: 'Breaking Bad' });

  assert.equal(records.length, 1);
  assert.equal(records[0].id, 's1');
  assert.equal(records[0].type, 'serial');
  assert.deepEqual(client.calls, [
    ['searchByTitle', 'Breaking Bad'],
    ['searchByTitle', 'Во все тяжкие']
  ]);
});

test('KodikProvider.search: по kinopoisk_id → id-путь через searchByIds', async () => {
  const client = new FakeKodikClient({ ids: [MOVIE_RAW] });
  const provider = new KodikProvider({ client });

  const records = await provider.search({ kinopoisk_id: '111' });

  assert.equal(records.length, 1);
  assert.equal(records[0].type, 'movie');
  assert.equal(records[0].kinopoisk_id, '111');
  assert.deepEqual(client.calls, [['searchByIds']]);
});

test('KodikProvider.search: пустой запрос / ошибка клиента → [] без throw', async () => {
  const client = new FakeKodikClient();
  const provider = new KodikProvider({ client });

  assert.deepEqual(await provider.search({}), []);
  assert.deepEqual(await provider.search({ title: '   ' }), []);

  const failing = new FakeKodikClient({ byQuery: {} });
  failing.searchByTitle = async () => { throw new Error('network'); };
  const providerFailing = new KodikProvider({ client: failing });
  assert.deepEqual(await providerFailing.search({ title: 'x' }), []);
});

test('KodikProvider.movie/serial: фильтрация по типу из выдачи', async () => {
  const client = new FakeKodikClient({ byQuery: { 'Во все тяжкие': [SERIAL_RAW, SERIAL_RAW_2] } });
  const provider = new KodikProvider({ client });

  const serials = await provider.serial({ title: 'Во все тяжкие' });
  assert.equal(serials.length, 2);
  assert.ok(serials.every((record) => record.type === 'serial'));

  assert.deepEqual(await provider.movie({ title: 'Во все тяжкие' }), []);
});

test('KodikProvider.serial: сезоны/серии/озвучки из метаданных записи', async () => {
  const client = new FakeKodikClient({ byQuery: { 'Во все тяжкие': [SERIAL_RAW, SERIAL_RAW_2] } });
  const provider = new KodikProvider({ client });

  const records = await provider.serial({ title: 'Во все тяжкие' });
  const record = records[0];

  // Агрегированные озвучки по всей выдаче (как цикл переводов в Lampac).
  assert.deepEqual((await provider.getTranslations(record)).map((t) => t.title), ['Дубляж', 'Оригинал']);

  // Список сезонов — по уникальным номерам выдачи.
  const seasons = await provider.getSeasons(record);
  assert.deepEqual(seasons.map((s) => s.number), [1, 2]);

  // Серии выбранного сезона: значение-строка = ссылка на серию.
  const episodes = await provider.getEpisodes(record, 1);
  assert.equal(episodes.length, 2);
  assert.deepEqual(episodes[0], {
    number: 1,
    title: '1 серия',
    link: 'https://example.com/ep/1/1'
  });
  assert.equal(episodes[1].link, 'https://example.com/ep/1/2');

  const seasonTwo = await provider.getEpisodes(record, 2);
  assert.equal(seasonTwo.length, 1);
  assert.equal(seasonTwo[0].number, 1);
});

test('KodikProvider.getSeasons/getEpisodes: пустая запись → [] без throw', async () => {
  const provider = new KodikProvider({ client: new FakeKodikClient() });

  assert.deepEqual(await provider.getSeasons({}), []);
  assert.deepEqual(await provider.getEpisodes({}), []);
  assert.deepEqual(await provider.getTranslations({}), []);
});

test('KodikProvider: тип по списку фильмов Lampac (anime/soviet-cartoon → movie, остальное → serial)', async () => {
  const animeRaw = { id: 'a1', title: 'Твоё имя', type: 'anime', link: 'l', translation: { title: 'Дубляж' }, material_data: { poster_url: 'https://cdn/a.jpg' } };
  const cartoonRaw = { id: 'c1', title: 'Ну, погоди!', type: 'soviet-cartoon', link: 'l', translation: { title: 'Оригинал' } };
  const unknownRaw = { id: 'u1', title: 'X', type: 'whatever', link: 'l', translation: { title: 'Оригинал' } };

  const client = new FakeKodikClient({
    byQuery: { anime: [animeRaw], cartoon: [cartoonRaw], x: [unknownRaw] }
  });
  const provider = new KodikProvider({ client });

  assert.equal((await provider.search({ title: 'anime' }))[0].type, 'movie');
  assert.equal((await provider.search({ title: 'cartoon' }))[0].type, 'movie');
  assert.equal((await provider.search({ title: 'x' }))[0].type, 'serial');
});

const STREAM_RAW = {
  links: {
    '480': { Src: '//cdn.kodik.com/480.m3u8' },
    '720': { Src: 'https://cdn.kodik.com/720.m3u8' },
    '1080': { Src: 'https://cdn.kodik.com/1080.m3u8' }
  }
};

test('KodikProvider.streams: video-links → StreamItem[] с прокси, Referer и сортировкой', async () => {
  const client = new FakeKodikClient({ streamRaw: STREAM_RAW });
  const provider = new KodikProvider({ client });

  const items = await provider.streams({
    id: 's1',
    title: 'Во все тяжкие',
    type: 'serial',
    link: 'https://example.com/player/s1'
  });

  assert.equal(items.length, 3);
  assert.deepEqual(items.map((item) => item.quality), ['1080p', '720p', '480p']);

  const first = items[0];
  assert.equal(first.provider, 'kodik');
  assert.equal(first.id, 's1');
  assert.equal(first.type, 'serial');
  assert.equal(first.title, 'Во все тяжкие');
  assert.equal(first.voice, 'Оригинал');
  assert.deepEqual(first.subtitles, []);

  // Src с // → https, всё завёрнуто в наш прокси.
  assert.match(first.stream.url, /\/api\/lampa\/proxy\?url=/);
  assert.match(first.stream.url, /cdn\.kodik\.com%2F1080\.m3u8/);
  assert.equal(first.stream.headers.Referer, 'https://anilib.me/');

  // ip по умолчанию, link передан клиенту.
  assert.deepEqual(client.calls[0], ['streams', 'https://example.com/player/s1', '127.0.0.1']);
});

test('KodikProvider.streams: пустой/ошибочный путь → [] без throw', async () => {
  const client = new FakeKodikClient();
  const provider = new KodikProvider({ client });
  assert.deepEqual(await provider.streams({}), []);

  const failing = new FakeKodikClient();
  failing.streams = async () => { throw new Error('network'); };
  const providerFailing = new KodikProvider({ client: failing });
  assert.deepEqual(await providerFailing.streams({ link: 'https://example.com/player/s1' }), []);
});

test('KodikProvider.videos: фильм → {method:play} с мапой качеств → прокси', async () => {
  const client = new FakeKodikClient({ byQuery: { Inception: [MOVIE_RAW] }, streamRaw: STREAM_RAW });
  const provider = new KodikProvider({ client });

  const payload = await provider.videos({ query: { title: 'Начало', original_title: 'Inception' } });

  assert.equal(payload.items.length, 1);
  const item = payload.items[0];
  assert.equal(item.method, 'play');
  assert.equal(item.type, 'movie');
  assert.equal(item.voice_name, 'Дубляж');
  assert.match(item.url, /proxy/);
  assert.match(item.quality['1080p'], /cdn\.kodik\.com%2F1080\.m3u8/);
  assert.ok(item.quality['720p'] && item.quality['480p']);
  assert.equal(item.headers.Referer, 'https://anilib.me/');
  assert.deepEqual(payload.seasons, []);
  assert.deepEqual(payload.voices, []);
});

test('KodikProvider.videos: сериал → items по сериям сезона + фильтры seasons/voices', async () => {
  const client = new FakeKodikClient({ byQuery: { 'Во все тяжкие': [SERIAL_RAW, SERIAL_RAW_2] }, streamRaw: STREAM_RAW });
  const provider = new KodikProvider({ client });

  const payload = await provider.videos({ query: { title: 'Во все тяжкие', season: '1' } });

  assert.equal(payload.items.length, 2);
  const first = payload.items[0];
  assert.equal(first.method, 'play');
  assert.equal(first.type, 'serial');
  assert.equal(first.season, 1);
  assert.equal(first.episode, 1);
  assert.equal(first.title, '1 серия');
  assert.equal(first.voice_name, 'Дубляж');
  assert.match(first.url, /proxy/);
  assert.ok(first.quality['1080p']);

  assert.deepEqual(payload.seasons.map((s) => s.number), [1, 2]);
  assert.deepEqual(payload.voices, [{ name: 'Дубляж', index: 0 }, { name: 'Оригинал', index: 1 }]);
});

test('KodikProvider.videos: пустой/ошибочный путь → пустой payload', async () => {
  const client = new FakeKodikClient();
  const provider = new KodikProvider({ client });
  assert.deepEqual(await provider.videos({ query: {} }), { items: [], seasons: [], voices: [] });

  const failing = new FakeKodikClient({ ids: [MOVIE_RAW] });
  failing.streams = async () => { throw new Error('geo'); };
  const providerFailing = new KodikProvider({ client: failing });
  assert.deepEqual(await providerFailing.videos({ query: { kinopoisk_id: '111' } }), { items: [], seasons: [], voices: [] });
});

test('KodikProvider.search: отключённый клиент → []', async () => {
  const client = new FakeKodikClient({ byQuery: { Inception: [MOVIE_RAW] } });
  client.token = '';
  const provider = new KodikProvider({ client });

  assert.deepEqual(await provider.search({ title: 'Начало' }), []);
});
