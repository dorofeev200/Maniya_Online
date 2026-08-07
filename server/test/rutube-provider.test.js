import test from 'node:test';
import assert from 'node:assert/strict';

import { RutubeProvider } from '../src/providers/rutube/RutubeProvider.js';
import { RutubeNormalizer } from '../src/providers/rutube/RutubeNormalizer.js';
import { searchNameTo } from '../src/providers/shared/normalize/searchNameTo.js';

/** Fake RutubeClient: только методы, которые зовёт провайдер. */
class FakeRutubeClient {
  constructor({ searchResults = [], m3u8 = '', enabled = true } = {}) {
    this.calls = [];
    this.searchResults = searchResults;
    this.m3u8 = m3u8;
    this.enabledFlag = enabled;
    this.host = 'https://rutube.ru';
  }

  enabled() {
    return this.enabledFlag;
  }

  async search({ title, year }) {
    this.calls.push(['search', title, year]);
    return this.searchResults;
  }

  async playOptions(linkid) {
    this.calls.push(['playOptions', linkid]);
    return this.m3u8;
  }
}

// Валидный результат поиска (категория «Фильмы»=4, длинный, без флагов).
const MATCH = {
  id: '8a1f2c3d',
  title: 'Начало (Inception, 2010) — фильм',
  duration: 7200000,
  category: { id: 4 },
  is_hidden: false,
  is_deleted: false,
  is_adult: false,
  is_locked: false,
  is_audio: false,
  is_paid: false,
  is_livestream: false,
  thumbnail_url: 'https://i.rutube.ru/thumb.jpg'
};

test('searchNameTo: нормализация как SearchNameTo.Convert', () => {
  assert.equal(searchNameTo('Начало (2010)'), 'начало2010');
  assert.equal(searchNameTo('Ёлка, "2:0"!'), 'елка20');
  assert.equal(searchNameTo('Щелкунчик'), 'шелкунчик'); // щ→ш
  assert.equal(searchNameTo('---!!!'), null);           // нет букв/цифр
  assert.equal(searchNameTo(''), null);
});

test('RutubeProvider.search: фильтры Lampac (название, год±1, duration, категория 4, флаги)', async () => {
  const client = new FakeRutubeClient({
    searchResults: [
      MATCH,
      { ...MATCH, id: 'trailer', title: 'Начало (Inception, 2010) трейлер' },                 // исключён словом
      { ...MATCH, id: 'short', duration: 2000 },                                               // короткий
      { ...MATCH, id: 'wrongcat', category: { id: 5 } },                                        // не категория фильмов
      { ...MATCH, id: 'paid', is_paid: true },                                                  // платный
      { ...MATCH, id: 'wrongyear', title: 'Начало (Inception, 2008)' },                         // год мимо ±1
      { ...MATCH, id: 'notitle', title: 'Совсем другое (2010)' }                                // название не совпало
    ]
  });
  const provider = new RutubeProvider({ client });

  const records = await provider.search({ title: 'Начало', year: '2010' });

  assert.equal(records.length, 1);
  const record = records[0];
  assert.equal(record.provider, 'rutubemovie');
  assert.equal(record.id, '8a1f2c3d');
  assert.equal(record.title, 'Начало (Inception, 2010) — фильм');
  assert.equal(record.year, 2010);
  assert.equal(record.type, 'movie');
  assert.equal(record.poster, 'https://i.rutube.ru/thumb.jpg');
  assert.equal(record.duration, 7200000);

  // Поисковый запрос ушёл клиенту как "{title} {year}".
  assert.deepEqual(client.calls, [['search', 'Начало', 2010]]);
});

test('RutubeProvider.search: пусто при отсутствии title/year (как OnError в Lampac)', async () => {
  const client = new FakeRutubeClient({ searchResults: [MATCH] });
  const provider = new RutubeProvider({ client });

  assert.deepEqual(await provider.search({}), []);
  assert.deepEqual(await provider.search({ title: '   ' }), []);
  assert.deepEqual(await provider.search({ title: 'Начало', year: '0' }), []);
  assert.equal(client.calls.length, 0);
});

test('RutubeProvider.movie/serial: только фильмы', async () => {
  const client = new FakeRutubeClient({ searchResults: [MATCH] });
  const provider = new RutubeProvider({ client });

  const movies = await provider.movie({ title: 'Начало', year: '2010' });
  assert.equal(movies.length, 1);
  assert.deepEqual(await provider.serial({ title: 'Начало', year: '2010' }), []);
});

test('RutubeProvider.videos: фильм → {method:play} с quality.auto через прокси', async () => {
  const m3u8 = 'https://rutube.ru/video/balancer/m3u8/8a1f2c3d';
  const client = new FakeRutubeClient({ searchResults: [MATCH], m3u8 });
  const provider = new RutubeProvider({ client });

  const payload = await provider.videos({ query: { title: 'Начало', year: '2010' } });

  assert.equal(payload.items.length, 1);
  const item = payload.items[0];
  assert.equal(item.method, 'play');
  assert.equal(item.type, 'movie');
  assert.equal(item.voice_name, 'Оригинал');
  assert.match(item.url, /\/api\/lampa\/proxy\?url=/);
  assert.match(item.url, /rutube\.ru/);
  assert.equal(item.quality.auto, item.url);
  assert.equal(item.headers.Referer, 'https://rutube.ru/');
  assert.deepEqual(payload.seasons, []);
  assert.deepEqual(payload.voices, []);
});

test('RutubeProvider.videos: нет записи/пустой m3u8/ошибка → пустой payload', async () => {
  const client = new FakeRutubeClient({ searchResults: [], m3u8: 'https://rutube.ru/x.m3u8' });
  const provider = new RutubeProvider({ client });
  assert.deepEqual(await provider.videos({ query: { title: 'Начало', year: '2010' } }), { items: [], seasons: [], voices: [] });

  const noStream = new FakeRutubeClient({ searchResults: [MATCH], m3u8: '' });
  const providerNoStream = new RutubeProvider({ client: noStream });
  assert.deepEqual(await providerNoStream.videos({ query: { title: 'Начало', year: '2010' } }), { items: [], seasons: [], voices: [] });

  const failing = new FakeRutubeClient({ searchResults: [MATCH], m3u8: 'https://rutube.ru/x.m3u8' });
  failing.playOptions = async () => { throw new Error('geo'); };
  const providerFailing = new RutubeProvider({ client: failing });
  assert.deepEqual(await providerFailing.videos({ query: { title: 'Начало', year: '2010' } }), { items: [], seasons: [], voices: [] });
});

test('RutubeProvider.streams: linkid → StreamItem[] (auto, прокси, Referer)', async () => {
  const m3u8 = 'https://rutube.ru/video/balancer/m3u8/8a1f2c3d';
  const client = new FakeRutubeClient({ searchResults: [MATCH], m3u8 });
  const provider = new RutubeProvider({ client });

  const items = await provider.streams({ id: '8a1f2c3d', title: 'Начало', type: 'movie' });

  assert.equal(items.length, 1);
  const stream = items[0];
  assert.equal(stream.provider, 'rutubemovie');
  assert.equal(stream.id, '8a1f2c3d');
  assert.equal(stream.type, 'movie');
  assert.equal(stream.quality, 'auto');
  assert.equal(stream.voice, 'Оригинал');
  assert.match(stream.stream.url, /\/api\/lampa\/proxy\?url=/);
  assert.equal(stream.stream.headers.Referer, 'https://rutube.ru/');
  assert.deepEqual(stream.subtitles, []);
});

test('RutubeProvider.streams: пустой linkid / ошибка → []', async () => {
  const client = new FakeRutubeClient();
  const provider = new RutubeProvider({ client });
  assert.deepEqual(await provider.streams({}), []);

  const failing = new FakeRutubeClient({ m3u8: 'https://rutube.ru/x.m3u8' });
  failing.playOptions = async () => { throw new Error('network'); };
  const providerFailing = new RutubeProvider({ client: failing });
  assert.deepEqual(await providerFailing.streams({ id: '8a1f2c3d' }), []);
});

test('RutubeProvider: отключён → [] везде, клиент не трогается', async () => {
  const client = new FakeRutubeClient({ searchResults: [MATCH], m3u8: 'https://rutube.ru/x.m3u8' });
  const provider = new RutubeProvider({ client, enabled: false });

  assert.deepEqual(await provider.search({ title: 'Начало', year: '2010' }), []);
  assert.deepEqual(await provider.videos({ query: { title: 'Начало', year: '2010' } }), { items: [], seasons: [], voices: [] });
  assert.deepEqual(await provider.streams({ id: '8a1f2c3d' }), []);
  assert.equal(client.calls.length, 0);
});

test('RutubeNormalizer: фильтры в изоляции (без сети)', () => {
  const normalizer = new RutubeNormalizer();
  const records = normalizer.with({ searchTitle: 'inception', year: 2010 }).searchResults([
    MATCH,
    { ...MATCH, id: 'adult', is_adult: true },
    { ...MATCH, id: 'locked', is_locked: true },
    { ...MATCH, id: 'live', is_livestream: true },
    { ...MATCH, id: 'ep', title: 'Начало (Inception, 2010) серия 1' }
  ]);

  assert.deepEqual(records.map((r) => r.id), ['8a1f2c3d']);
});
