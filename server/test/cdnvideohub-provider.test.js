import test from 'node:test';
import assert from 'node:assert/strict';

import { CDNvideohubProvider } from '../src/providers/cdnvideohub/CDNvideohubProvider.js';
import { CDNvideohubNormalizer } from '../src/providers/cdnvideohub/CDNvideohubNormalizer.js';

/** Fake CDNvideohubClient: только методы, которые зовёт провайдер. */
class FakeCDNvideohubClient {
  constructor({ playlist = null, hlsByVkId = {}, enabled = true } = {}) {
    this.calls = [];
    this.playlistData = playlist;
    this.hlsByVkId = hlsByVkId;
    this.enabledFlag = enabled;
    this.host = 'https://plapi.cdnvideohub.com';
  }

  enabled() {
    return this.enabledFlag;
  }

  async playlist(kinopoiskId) {
    this.calls.push(['playlist', kinopoiskId]);
    return this.playlistData;
  }

  async videoHls(vkId) {
    this.calls.push(['videoHls', vkId]);
    return this.hlsByVkId[vkId] || '';
  }
}

// Корневой ответ playlist для фильма (kp=462682, одна озвучка).
const MOVIE_ROOT = {
  titleName: 'Интерстеллар',
  isSerial: false,
  items: [
    { season: 0, episode: 0, voiceStudio: 'LostFilm', voiceType: 'Дубляж', vkId: 'vk-movie-1', isView: false },
    { season: 0, episode: 0, voiceStudio: 'TVShows', voiceType: 'Оригинал', vkId: 'vk-movie-2', isView: false }
  ]
};

// Сериал: 2 сезона, в 1-м сезоне 2 серии × 2 озвучки.
const SERIAL_ROOT = {
  titleName: 'Острые козырьки',
  isSerial: true,
  items: [
    { season: 1, episode: 1, voiceType: 'Дубляж', vkId: 's1e1-dub', isView: false },
    { season: 1, episode: 1, voiceType: 'Оригинал', vkId: 's1e1-orig', isView: false },
    { season: 1, episode: 2, voiceType: 'Дубляж', vkId: 's1e2-dub', isView: false },
    { season: 2, episode: 1, voiceType: 'Дубляж', vkId: 's2e1-dub', isView: false }
  ]
};

const QUERY = { title: 'Интерстеллар', year: 2014, kinopoisk_id: 462, kp: 462 };

test('CDNvideohubNormalizer.records: movie → одна запись movie с items', () => {
  const normalizer = new CDNvideohubNormalizer();
  const records = normalizer.records(MOVIE_ROOT, QUERY);

  assert.equal(records.length, 1);
  const record = records[0];
  assert.equal(record.provider, 'cdnvideohub');
  assert.equal(record.type, 'movie');
  assert.equal(record.kinopoisk_id, 462);
  assert.equal(record.id, '462');
  assert.equal(record.isSerial, false);
  assert.equal(record.items.length, 2);
  assert.equal(record.metadata.year, 2014);
});

test('CDNvideohubNormalizer.records: пусто без items / без query', () => {
  const normalizer = new CDNvideohubNormalizer();
  assert.deepEqual(normalizer.records(null, QUERY), []);
  assert.deepEqual(normalizer.records({ isSerial: false, items: [] }, QUERY), []);
  assert.deepEqual(normalizer.records(MOVIE_ROOT, {}), []);
});

test('CDNvideohubNormalizer.seasons/episodes: сезоны и серии сериала', () => {
  const normalizer = new CDNvideohubNormalizer();
  assert.deepEqual(normalizer.seasons(SERIAL_ROOT), [
    { number: 1, title: '1 сезон' },
    { number: 2, title: '2 сезон' }
  ]);
  assert.deepEqual(normalizer.episodes(SERIAL_ROOT, 1), [
    { number: 1, title: '1 серия' },
    { number: 2, title: '2 серия' }
  ]);
  // Серии чужого сезона отфильтрованы.
  assert.deepEqual(normalizer.episodes(SERIAL_ROOT, 2), [{ number: 1, title: '1 серия' }]);
});

test('CDNvideohubNormalizer.voices: уникальные озвучки по items', () => {
  const normalizer = new CDNvideohubNormalizer();
  assert.deepEqual(normalizer.voices(SERIAL_ROOT), ['Дубляж', 'Оригинал']);
});

test('CDNvideohubProvider.search: без kp → [], клиент не трогается', async () => {
  const client = new FakeCDNvideohubClient({ playlist: MOVIE_ROOT });
  const provider = new CDNvideohubProvider({ client });

  assert.deepEqual(await provider.search({ title: 'Интерстеллар' }), []);
  assert.equal(client.calls.length, 0);
});

test('CDNvideohubProvider.search: с kp → запись, клиент получил kp', async () => {
  const client = new FakeCDNvideohubClient({ playlist: MOVIE_ROOT });
  const provider = new CDNvideohubProvider({ client });

  const records = await provider.search(QUERY);
  assert.equal(records.length, 1);
  assert.equal(records[0].type, 'movie');
  assert.deepEqual(client.calls, [['playlist', 462]]);
});

test('CDNvideohubProvider.movie/serial: фильтрация по типу', async () => {
  const client = new FakeCDNvideohubClient({ playlist: MOVIE_ROOT });
  const provider = new CDNvideohubProvider({ client });

  assert.equal((await provider.movie(QUERY)).length, 1);
  assert.deepEqual(await provider.serial(QUERY), []);
});

test('CDNvideohubProvider.videos: фильм → play-записи по озвучкам с quality.auto через прокси', async () => {
  const client = new FakeCDNvideohubClient({
    playlist: MOVIE_ROOT,
    hlsByVkId: {
      'vk-movie-1': 'https://ok1-1.vkuser.net/movie1.m3u8',
      'vk-movie-2': 'https://ok1-2.vkuser.net/movie2.m3u8'
    }
  });
  const provider = new CDNvideohubProvider({ client });

  const payload = await provider.videos({ query: QUERY });

  assert.equal(payload.items.length, 2);
  const voices = payload.items.map((item) => item.voice_name).sort();
  assert.deepEqual(voices, ['Дубляж', 'Оригинал']);
  for (const item of payload.items) {
    assert.equal(item.method, 'play');
    assert.equal(item.type, 'movie');
    assert.match(item.url, /\/api\/lampa\/proxy\?url=/);
    assert.equal(item.quality.auto, item.url);
    assert.equal(item.headers.Referer, 'https://player.cdnvideohub.com');
    assert.deepEqual(item.sound, []);
  }
  // По одной записи на озвучку.
  assert.equal(payload.seasons.length, 0);
  assert.deepEqual(payload.voices, [{ name: 'Дубляж', index: 0 }, { name: 'Оригинал', index: 1 }]);
});

test('CDNvideohubProvider.videos: сериал → play-записи по сериям × озвучкам выбранного сезона', async () => {
  const client = new FakeCDNvideohubClient({ playlist: SERIAL_ROOT });
  for (const vkId of ['s1e1-dub', 's1e1-orig', 's1e2-dub', 's2e1-dub']) {
    client.hlsByVkId[vkId] = `https://ok-${vkId}.vkuser.net/${vkId}.m3u8`;
  }
  const provider = new CDNvideohubProvider({ client });

  const payload = await provider.videos({ query: { ...QUERY, kp: 462, season: 1 } });

  // Сезон 1: e1 (дубляж+оригинал) + e2 (дубляж) = 3 play-записи.
  assert.equal(payload.items.length, 3);
  assert.equal(payload.seasons.length, 2);
  assert.deepEqual(payload.voices, [{ name: 'Дубляж', index: 0 }, { name: 'Оригинал', index: 1 }]);
  for (const item of payload.items) {
    assert.equal(item.method, 'play');
    assert.equal(item.type, 'serial');
    assert.equal(item.season, 1);
  }
});

test('CDNvideohubProvider.videos: пустой результат / засчет производства пусто', async () => {
  const client = new FakeCDNvideohubClient({ playlist: null });
  const provider = new CDNvideohubProvider({ client });
  assert.deepEqual(await provider.videos({ query: QUERY }), { items: [], seasons: [], voices: [] });

  // Plays n/a для фильма — нет hls ни для одного голоса.
  const noHls = new FakeCDNvideohubClient({ playlist: MOVIE_ROOT, hlsByVkId: {} });
  const providerNoHls = new CDNvideohubProvider({ client: noHls });
  const empty = await providerNoHls.videos({ query: QUERY });
  assert.equal(empty.items.length, 0);
});

test('CDNvideohubProvider.streams: vkId → StreamItem (auto, прокси, Referer player)', async () => {
  const client = new FakeCDNvideohubClient({
    hlsByVkId: { '758-movie-1': 'https://ok1-1.vkuser.net/movie.m3u8' }
  });
  const provider = new CDNvideohubProvider({ client });

  const items = await provider.streams({ vkId: '758-movie-1', title: 'Интерстеллар', type: 'movie' });

  assert.equal(items.length, 1);
  const stream = items[0];
  assert.equal(stream.provider, 'cdnvideohub');
  assert.equal(stream.id, '758-movie-1');
  assert.equal(stream.type, 'movie');
  assert.equal(stream.quality, 'auto');
  assert.equal(stream.voice, 'Оригинал');
  assert.match(stream.stream.url, /\/api\/lampa\/proxy\?url=/);
  assert.equal(stream.stream.headers.Referer, 'https://player.cdnvideohub.com');
  assert.deepEqual(stream.subtitles, []);
});

test('CDNvideohubProvider.streams: пустой vkId / нет hls / ошибка → []', async () => {
  const client = new FakeCDNvideohubClient();
  const provider = new CDNvideohubProvider({ client });
  assert.deepEqual(await provider.streams({}), []);

  const failing = new FakeCDNvideohubClient({ hlsByVkId: { x: 'url' } });
  failing.videoHls = async () => { throw new Error('network'); };
  const providerFailing = new CDNvideohubProvider({ client: failing });
  assert.deepEqual(await providerFailing.streams({ vkId: 'x' }), []);
});

test('CDNvideohubProvider: отключён → [] везде, клиент не трогается', async () => {
  const client = new FakeCDNvideohubClient({ playlist: MOVIE_ROOT, hlsByVkId: { '758-movie-1': 'url' } });
  const provider = new CDNvideohubProvider({ client, enabled: false });

  assert.deepEqual(await provider.search(QUERY), []);
  assert.deepEqual(await provider.videos({ query: QUERY }), { items: [], seasons: [], voices: [] });
  assert.deepEqual(await provider.streams({ vkId: '758-movie-1' }), []);
  assert.equal(client.calls.length, 0);
});