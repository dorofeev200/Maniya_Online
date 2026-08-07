import test from 'node:test';
import assert from 'node:assert/strict';

import { HDVBProvider } from '../src/providers/hdvb/HDVBProvider.js';
import { HDVBClient } from '../src/providers/hdvb/HDVBClient.js';
import { HDVBNormalizer } from '../src/providers/hdvb/HDVBNormalizer.js';

/** Fake HDVBClient: методы, которые зовёт провайдер. */
class FakeHDVBClient {
  constructor({ data = null, iframeHtml = '', playlistByFile = {}, enabled = true } = {}) {
    this.calls = [];
    this.data = data;
    this.iframeHtml = iframeHtml;
    this.playlistByFile = playlistByFile;
    this.enabledFlag = enabled;
    this.apihost = 'https://apivb.com';
    this.frameHost = 'https://vid1733431681.entouaedon.com';
    this.referer = 'https://movielab.one/';
  }

  enabled() {
    return this.enabledFlag;
  }

  async videos(options) {
    this.calls.push(['videos', options]);
    return this.data;
  }

  async iframe(path) {
    this.calls.push(['iframe', path]);
    return this.iframeHtml;
  }

  async postPlaylist(options) {
    this.calls.push(['post', options.file]);
    return this.playlistByFile[options.file] || '';
  }
}

// --- фикстуры ---

const MOVIE_IFRAME = `
<script>
  var __ = {
    "key": "csrf-movie-token",
    "href": "sevstar933krop.com",
    "file": "/playlist/movie-file-xyz.txt"
  };
</script>`;

const MOVIE_M3U8 = 'https://b-401.sevstar933krop.com/stream2/movie/hash/index.m3u8?exp=1&ip=1.2.3.4';

const SERIAL_IFRAME = `
<script>
  var __ = {
    "key": "csrf-serial-token",
    "href": "sevstar933krop.com",
    "file": "/playlist/serial-top.txt"
  };
</script>`;

const SERIAL_FOLDERS = JSON.stringify([
  {
    id: 1,
    title: 'Сезон 1',
    folder: [
      { id: '1-0', episode: 0, title: '0 серия', folder: [{ file: '/playlist/ep0.txt', title: 'Дубляж', translator: 82, id: 'x-1-0' }] },
      { id: '1-1', episode: 1, title: '1 серия', folder: [{ file: '/playlist/ep1.txt', title: 'Дубляж', translator: 82, id: 'x-1-1' }] }
    ]
  },
  {
    id: 2,
    title: 'Сезон 2',
    folder: [
      { id: '2-0', episode: 0, title: '0 серия', folder: [{ file: '/playlist/ep2.txt', title: 'Оригинал', translator: 1, id: 'x-2-0' }] }
    ]
  }
]);

const EP0_M3U8 = 'https://b-401.sevstar933krop.com/stream2/serial/ep0/index.m3u8?exp=1&ip=1.2.3.4';
const EP1_M3U8 = 'https://b-401.sevstar933krop.com/stream2/serial/ep1/index.m3u8?exp=1&ip=1.2.3.4';
const EP2_M3U8 = 'https://b-401.sevstar933krop.com/stream2/serial/ep2/index.m3u8?exp=1&ip=1.2.3.4';

const MOVIE_DATA = [
  { type: 'movie', iframe_url: 'https://vid1.sevstar933krop.com/movie/abc/iframe', translator: 'Дубляж', title_ru: 'Дюна', title_en: 'Dune', year: 2024, kinopoisk_id: 409424 }
];

const SERIAL_DATA = [
  { type: 'serial', iframe_url: 'https://vid1.sevstar933krop.com/serial/xyz/iframe', translator: 'Дубляж', title_ru: 'Шерлок', serial_episodes: [{ season_number: 1, episodes: [0, 1] }, { season_number: 2, episodes: [0] }], kinopoisk_id: 888 },
  { type: 'serial', iframe_url: 'https://vid2.sevstar933krop.com/serial/xyz/iframe', translator: 'Оригинал', title_ru: 'Шерлок', serial_episodes: [{ season_number: 2, episodes: [0] }], kinopoisk_id: 888 }
];

// --- нормализатор ---

test('HDVBNormalizer.search: записи по типу + дедуп по kinopoisk_id', () => {
  const n = new HDVBNormalizer();
  const records = n.search(SERIAL_DATA);
  assert.equal(records.length, 1); // дедуп по kinopoisk_id
  assert.equal(records[0].provider, 'hdvb');
  assert.equal(records[0].type, 'serial');
  assert.equal(records[0].kinopoisk_id, 888);
  assert.equal(records[0].title, 'Шерлок');
  assert.equal(n.search(null).length, 0);
  assert.equal(n.search([]).length, 0);
});

test('HDVBNormalizer.record: movie vs serial по type', () => {
  const n = new HDVBNormalizer();
  const movie = n.record({ type: 'movie', title_ru: 'A', kinopoisk_id: 1 });
  const serial = n.record({ type: 'serial', title_ru: 'B', kinopoisk_id: 2 });
  assert.equal(movie.type, 'movie');
  assert.equal(serial.type, 'serial');
  assert.equal(n.record({}).type, 'movie');
});

test('HDVBNormalizer.extractEmbed: href/key/file + ready', () => {
  const n = new HDVBNormalizer();
  const embed = n.extractEmbed(MOVIE_IFRAME);
  assert.equal(embed.href, 'sevstar933krop.com');
  assert.equal(embed.key, 'csrf-movie-token');
  assert.equal(embed.file, '/playlist/movie-file-xyz.txt');
  assert.equal(embed.ready, true);
  assert.equal(n.extractEmbed('').ready, false);
  assert.equal(n.extractEmbed('no match').ready, false);
});

test('HDVBNormalizer.cleanFile: снимает /playlist/ и .txt (как Lampac)', () => {
  const n = new HDVBNormalizer();
  assert.equal(n.cleanFile('/playlist/abc.txt'), '/abc');
  assert.equal(n.cleanFile('abc.txt'), 'abc');
  assert.equal(n.cleanFile(''), '');
});

test('HDVBNormalizer.parsePlaylistResponse: m3u8 / folders / nextFile', () => {
  const n = new HDVBNormalizer();
  assert.equal(n.parsePlaylistResponse(MOVIE_M3U8).m3u8, MOVIE_M3U8);
  assert.deepEqual(n.parsePlaylistResponse('').m3u8, undefined);
  const folders = n.parsePlaylistResponse(SERIAL_FOLDERS);
  assert.ok(Array.isArray(folders.folders));
  assert.equal(folders.folders.length, 2);
  const twoStep = n.parsePlaylistResponse('{"file":"\\/playlist\\/second.txt"}');
  assert.equal(twoStep.nextFile, '/second');
});

test('HDVBNormalizer.episodeFile: по id сезона, episode и title перевода', () => {
  const n = new HDVBNormalizer();
  const folders = JSON.parse(SERIAL_FOLDERS);
  assert.equal(n.episodeFile(folders, 1, 0, 'Дубляж'), '/playlist/ep0.txt');
  assert.equal(n.episodeFile(folders, 1, 1, 'Дубляж'), '/playlist/ep1.txt');
  assert.equal(n.episodeFile(folders, 2, 0, 'Оригинал'), '/playlist/ep2.txt');
  assert.equal(n.episodeFile(folders, 2, 0, 'Дубляж'), ''); // не тот перевод
  assert.equal(n.episodeFile(folders, 1, 5, 'Дубляж'), ''); // нет серии
  assert.equal(n.episodeFile([], 1, 0, 'Дубляж'), '');
});

// --- провайдер ---

function movieClient() {
  return new FakeHDVBClient({
    data: MOVIE_DATA,
    iframeHtml: MOVIE_IFRAME,
    playlistByFile: { '/movie-file-xyz': MOVIE_M3U8 }
  });
}

function serialClient() {
  return new FakeHDVBClient({
    data: SERIAL_DATA,
    iframeHtml: SERIAL_IFRAME,
    playlistByFile: {
      '/serial-top': SERIAL_FOLDERS,
      '/ep0': EP0_M3U8,
      '/ep1': EP1_M3U8,
      '/ep2': EP2_M3U8
    }
  });
}

test('HDVBProvider: enabled зависит от client.enabled', () => {
  const on = new FakeHDVBClient({ enabled: true });
  const off = new FakeHDVBClient({ enabled: false });
  assert.equal(new HDVBProvider({ client: on }).enabled(), true);
  assert.equal(new HDVBProvider({ client: off }).enabled(), false);
  assert.equal(new HDVBProvider({ client: on, enabled: false }).enabled(), false);
});

test('HDVBProvider.search: по названию → записи, клиент получил title', async () => {
  const client = movieClient();
  const provider = new HDVBProvider({ client });
  const records = await provider.search({ title: 'Дюна' });
  assert.equal(records.length, 1);
  assert.deepEqual(client.calls[0], ['videos', { kinopoiskId: 0, title: 'Дюна' }]);
});

test('HDVBProvider.videos: фильм → один play-item (auto, прокси, озвучка)', async () => {
  const client = movieClient();
  const provider = new HDVBProvider({ client });
  const payload = await provider.videos({ query: { title: 'Дюна', kinopoisk_id: 409424, serial: 0 } });

  assert.equal(payload.items.length, 1);
  const item = payload.items[0];
  assert.equal(item.method, 'play');
  assert.equal(item.type, 'movie');
  assert.match(item.url, /\/api\/lampa\/proxy\?url=/);
  assert.equal(item.quality.auto, item.url);
  assert.equal(item.voice_name, 'Дубляж');
  assert.deepEqual(item.subtitles, []);
  assert.equal(payload.seasons.length, 0);
  assert.deepEqual(payload.voices, [{ name: 'Дубляж', index: 0 }]);
  // iframe ходит по fixframe-пути /movie/abc/iframe.
  assert.ok(client.calls.some(([m, p]) => m === 'iframe' && p === '/movie/abc/iframe'));
});

test('HDVBProvider.videos: сериал → сезоны, озвучки, серии с прокси-ссылками', async () => {
  const client = serialClient();
  const provider = new HDVBProvider({ client });
  const payload = await provider.videos({ query: { title: 'Шерлок', kinopoisk_id: 888, serial: 1 } });

  assert.deepEqual(payload.seasons, [
    { number: 1, title: '1 сезон' },
    { number: 2, title: '2 сезон' }
  ]);
  // Дефолт: сезон 1, озвучка 0 (Дубляж) → серии 0 и 1.
  assert.equal(payload.items.length, 2);
  assert.deepEqual(payload.items.map((i) => i.episode), [0, 1]);
  for (const item of payload.items) {
    assert.equal(item.method, 'play');
    assert.equal(item.type, 'serial');
    assert.equal(item.season, 1);
    assert.equal(item.voice_name, 'Дубляж');
    assert.match(item.url, /\/api\/lampa\/proxy\?url=/);
  }
  assert.deepEqual(payload.voices.map((v) => v.name), ['Дубляж']);
});

test('HDVBProvider.videos: сериал → выбор сезона и озвучки', async () => {
  const client = serialClient();
  const provider = new HDVBProvider({ client });
  const payload = await provider.videos({ query: { title: 'Шерлок', serial: 1, season: 2, voice: 1 } });

  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].episode, 0);
  assert.equal(payload.items[0].voice_name, 'Оригинал');
  assert.equal(payload.items[0].season, 2);
  // Озвучки для сезона 2: Дубляж и Оригинал.
  assert.deepEqual(payload.voices.map((v) => v.name), ['Дубляж', 'Оригинал']);
});

test('HDVBProvider.videos: пустой/битый iframe → пусто', async () => {
  const client = new FakeHDVBClient({ data: MOVIE_DATA, iframeHtml: '<html>nothing</html>' });
  const provider = new HDVBProvider({ client });
  assert.deepEqual(await provider.videos({ query: { title: 'X', serial: 0 } }), { items: [], seasons: [], voices: [] });
});

test('HDVBProvider.videos: playlist без m3u8 → пусто', async () => {
  const client = new FakeHDVBClient({ data: MOVIE_DATA, iframeHtml: MOVIE_IFRAME, playlistByFile: {} });
  const provider = new HDVBProvider({ client });
  assert.deepEqual(await provider.videos({ query: { title: 'X', serial: 0 } }), { items: [], seasons: [], voices: [] });
});

test('HDVBProvider.streams: url → StreamItem (auto, прокси)', async () => {
  const client = movieClient();
  const provider = new HDVBProvider({ client });
  const items = await provider.streams({ url: MOVIE_M3U8, title: 'Дюна', type: 'movie', voice_name: 'Дубляж' });
  assert.equal(items.length, 1);
  const stream = items[0];
  assert.equal(stream.provider, 'hdvb');
  assert.equal(stream.type, 'movie');
  assert.equal(stream.quality, 'auto');
  assert.equal(stream.voice, 'Дубляж');
  assert.match(stream.stream.url, /\/api\/lampa\/proxy\?url=/);
  assert.deepEqual(stream.subtitles, []);
});

test('HDVBProvider: отключён → [] везде, клиент не трогается', async () => {
  const client = movieClient();
  const provider = new HDVBProvider({ client, enabled: false });
  assert.deepEqual(await provider.search({ title: 'X' }), []);
  assert.deepEqual(await provider.videos({ query: { title: 'X' } }), { items: [], seasons: [], voices: [] });
  assert.deepEqual(await provider.streams({ url: MOVIE_M3U8 }), []);
  assert.equal(client.calls.length, 0);
});

test('HDVBProvider: client/normalizer инъекции', () => {
  const client = new FakeHDVBClient();
  const normalizer = new HDVBNormalizer();
  const provider = new HDVBProvider({ client, normalizer });
  assert.equal(provider.client, client);
  assert.equal(provider.normalizer, normalizer);
});
