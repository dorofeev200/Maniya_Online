import test from 'node:test';
import assert from 'node:assert/strict';

import { HDVBProvider } from '../src/providers/hdvb/HDVBProvider.js';
import { HDVBClient } from '../src/providers/hdvb/HDVBClient.js';
import { HDVBNormalizer } from '../src/providers/hdvb/HDVBNormalizer.js';

/** Fake HDVBClient: методы, которые зовёт провайдер. */
class FakeHDVBClient {
  constructor({ data = null, dataByTitle = {}, iframeHtml = '', playlistByFile = {}, enabled = true } = {}) {
    this.calls = [];
    this.data = data;
    this.dataByTitle = dataByTitle;
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
    if (Object.prototype.hasOwnProperty.call(this.dataByTitle, options.title)) return this.dataByTitle[options.title];
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

// --- FINAL-PLAYBACK-GAP-001: kp=0 title-поиск выбирает правильный фильм по году ---
// Свежие релизы: «Дэдпул и Росомаха» (2024) — целевой; в API первым идёт decoy «Дэдпул 2».
// Копирует реальный кейс: hdvb по названию возвращает первые записи не по хронологии,
// без учёта года из запроса плеер ставит не тот фильм.

const TITLE_SEARCH_MATRIX = [
  { type: 'movie', iframe_url: 'https://vid1.sevstar933krop.com/movie/dp2/iframe', title_ru: 'Дэдпул 2', title_en: 'Deadpool 2', year: 2018, kinopoisk_id: 1046126, translator: 'Дубляж' },
  { type: 'movie', iframe_url: 'https://vid1.sevstar933krop.com/movie/dp/iframe', title_ru: 'Дэдпул', title_en: 'Deadpool', year: 2016, kinopoisk_id: 530064, translator: 'Дубляж' },
  { type: 'movie', iframe_url: 'https://vid1.sevstar933krop.com/movie/dpr/iframe', title_ru: 'Дэдпул и Росомаха', title_en: 'Deadpool & Wolverine', year: 2024, kinopoisk_id: 1008444, translator: 'Дубляж' }
];

test('HDVBProvider.videos: kp=0 поиск по названию → год запроса выбирает нужный свежий фильм, а не первое совпадение', async () => {
  const client = new FakeHDVBClient({
    data: TITLE_SEARCH_MATRIX,
    iframeHtml: MOVIE_IFRAME,
    playlistByFile: { '/movie-file-xyz': MOVIE_M3U8 }
  });
  const provider = new HDVBProvider({ client });
  // Первая запись API — «Дэдпул 2» (2018), год из запроса (2024) должен
  // вывести вперёд «Дэдпул и Росомаха» kp=1008444.
  const payload = await provider.videos({ query: { title: 'Дэдпул и Росомаха', year: '2024', serial: 0 } });
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].voice_name, 'Дубляж');
  const iframePath = client.calls.filter(([method]) => method === 'iframe').map(([, p]) => p);
  assert.deepEqual(iframePath, ['/movie/dpr/iframe']); // правильный фильм, не /movie/dp2/
});

test('HDVBProvider.preferYear: без года — прежний порядок; с годом — совпадения вперёд, стабильный хвост', () => {
  const provider = new HDVBProvider({ client: new FakeHDVBClient() });
  const list = TITLE_SEARCH_MATRIX;
  assert.deepEqual(provider.preferYear(list, {}).map((v) => v.kinopoisk_id), [1046126, 530064, 1008444]);
  assert.deepEqual(provider.preferYear(list, { year: '0' }).map((v) => v.kinopoisk_id), [1046126, 530064, 1008444]);
  assert.deepEqual(provider.preferYear(list, { year: '2024' }).map((v) => v.kinopoisk_id), [1008444, 1046126, 530064]);
  assert.deepEqual(provider.preferYear(list, { year: '2018' }).map((v) => v.kinopoisk_id), [1046126, 530064, 1008444]);
  assert.deepEqual(provider.preferYear(list, { year: '1970' }).map((v) => v.kinopoisk_id), [1046126, 530064, 1008444]); // нет совпадений — без изменений
  assert.deepEqual(provider.preferYear([], { year: '2024' }), []);
});

// --- FINAL-PLAYBACK-GAP-001: свежие фильмы отдают voice-массив вместо m3u8 ---

const VOICE_IFRAME = `
<script>
  var __ = {
    "key": "csrf-voice",
    "href": "sevstar933krop.com",
    "file": "/playlist/gladiator2.txt"
  };
</script>`;

const VOICE_LIST = JSON.stringify([
  { title: 'Қазақша', id: 'kaz', translator: '213', file: '~kaz-file' },
  { title: 'Дубляж [Чистый звук]', id: 'dub', translator: '109', file: '~dub-file' }
]);

const VOICE_M3U8 = 'https://b-401.sevstar933krop.com/stream2/b-401/gladiator2/index.m3u8?exp=1&ip=1.2.3.4';

const VOICE_MOVIE_DATA = [
  { type: 'movie', iframe_url: 'https://vid1.sevstar933krop.com/movie/gl2/iframe', translator: 'Дубляж [Чистый звук]', title_ru: 'Гладиатор 2', title_en: 'Gladiator II', year: 2024, kinopoisk_id: 1207839 }
];

test('HDVBNormalizer.voiceFile: выбирает Дубляж; фолбэк — первой; сериал — пусто', () => {
  const n = new HDVBNormalizer();
  assert.equal(n.voiceFile(JSON.parse(VOICE_LIST)), '~dub-file'); // Дубляж, не Қазақша
  assert.equal(n.voiceFile([]), '');
  assert.equal(n.voiceFile(null), '');
  // Без Дубляжа — первая озвучка.
  assert.equal(n.voiceFile([{ title: 'Оригинал', file: '~or' }, { title: 'Дубляж', file: '~du' }]), '~du');
  // Сериальные Folder[] (элементы с `folder`, без `file`) — не voice-массив.
  assert.equal(n.voiceFile([{ id: 1, title: 'Сезон 1', folder: [] }]), '');
});

// --- HDVB-TITLE-ONLY-001: title-only пусто → ретрай с original_title ---
// «Гладиатор II» (2024, kp 1207839): upstream по title=«Гладиатор II» → [],
// при этом тот же фильм есть под title=«Gladiator II». Реальный клиент шлёт
// title + original_title + year (maniya-online.js addMovieParams).

test('HDVBProvider.videos: title-only пуст → ретрай с original_title → обычная цепочка (Гладиатор II)', async () => {
  const client = new FakeHDVBClient({
    dataByTitle: {
      'Гладиатор II': [],
      'Gladiator II': VOICE_MOVIE_DATA
    },
    iframeHtml: VOICE_IFRAME,
    playlistByFile: { '/gladiator2': VOICE_LIST, '~dub-file': VOICE_M3U8 }
  });
  const provider = new HDVBProvider({ client });
  const payload = await provider.videos({
    query: { title: 'Гладиатор II', original_title: 'Gladiator II', year: '2024', serial: 0 }
  });

  assert.equal(payload.items.length, 1);
  const item = payload.items[0];
  assert.equal(item.method, 'play');
  assert.match(item.url, /\/api\/lampa\/proxy\?url=/);
  assert.equal(item.voice_name, 'Дубляж [Чистый звук]');
  // Два запроса videos: первичный title (пусто) + ретрай original_title (нужные записи).
  const videoTitles = client.calls.filter(([method]) => method === 'videos').map(([, o]) => o.title);
  assert.deepEqual(videoTitles, ['Гладиатор II', 'Gladiator II']);
  const posts = client.calls.filter(([method]) => method === 'post').map(([, file]) => file);
  assert.deepEqual(posts, ['/gladiator2', '~dub-file']);
});

test('HDVBProvider.fetchData: kp=0 title-only пуст И пуст empty original_title → без ретрая', async () => {
  const client = new FakeHDVBClient({
    dataByTitle: { 'Нечто': [] },
    iframeHtml: MOVIE_IFRAME,
    playlistByFile: { '/movie-file-xyz': MOVIE_M3U8 }
  });
  const provider = new HDVBProvider({ client });
  const records = await provider.fetchData({ title: 'Нечто', original_title: '', year: '2024' });
  assert.equal(records.length, 0);
  const videoTitles = client.calls.filter(([method]) => method === 'videos').map(([, o]) => o.title);
  assert.deepEqual(videoTitles, ['Нечто']); // ретрая не было
});

test('HDVBProvider.videos: voice-массив → Дубляж → финальный POST → m3u8 (не items=0)', async () => {
  const client = new FakeHDVBClient({
    data: VOICE_MOVIE_DATA,
    iframeHtml: VOICE_IFRAME,
    playlistByFile: { '/gladiator2': VOICE_LIST, '~dub-file': VOICE_M3U8 }
  });
  const provider = new HDVBProvider({ client });
  const payload = await provider.videos({ query: { title: 'Гладиатор 2', year: '2024', serial: 0 } });
  assert.equal(payload.items.length, 1);
  const item = payload.items[0];
  assert.equal(item.method, 'play');
  assert.match(item.url, /\/api\/lampa\/proxy\?url=/);
  assert.equal(item.voice_name, 'Дубляж [Чистый звук]');
  // Два POST: первый — vozмассив, второй — file озвучки Дубляж.
  const posts = client.calls.filter(([method]) => method === 'post').map(([, file]) => file);
  assert.deepEqual(posts, ['/gladiator2', '~dub-file']);
});
