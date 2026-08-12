import test from 'node:test';
import assert from 'node:assert/strict';

import { RezkaProvider } from '../src/providers/rezka/RezkaProvider.js';
import {
  SEARCH_HTML,
  EMBED_MOVIE_HTML,
  EMBED_MOVIE_WITH_FAVS_HTML,
  EMBED_SERIAL_HTML,
  STREAM_ENCODED,
  SUBTITLE_HTML
} from './fixtures/rezka-fixtures.js';

/** Fake RezkaClient: только методы, которые зовёт провайдер. */
class FakeRezkaClient {
  constructor({ pageHtml = null, episodes = null, movieStream = null, episodeStream = null } = {}) {
    this.calls = [];
    this.pageHtml = pageHtml;
    this.episodes = episodes;
    this.movieStream = movieStream;
    this.episodeStream = episodeStream;
    this.baseUrl = 'https://rezka.ag';
  }

  async searchHtml({ query }) {
    this.calls.push(['searchHtml', query]);
    return SEARCH_HTML;
  }

  async page(href) {
    this.calls.push(['page', href]);
    return this.pageHtml;
  }

  async getEpisodes(id, translatorId) {
    this.calls.push(['getEpisodes', id, translatorId]);
    return this.episodes;
  }

  async getStreamMovie(id, translatorId) {
    this.calls.push(['getStreamMovie', id, translatorId]);
    return this.movieStream;
  }

  async getStreamEpisode(id, translatorId, season, episode) {
    this.calls.push(['getStreamEpisode', id, translatorId, season, episode]);
    return this.episodeStream;
  }
}

const EPISODES = {
  seasons: [{ number: 1, title: '1 сезон' }, { number: 2, title: '2 сезон' }],
  episodes: [
    { season: 1, episode: 1, title: '1 серия' },
    { season: 1, episode: 2, title: '2 серия' },
    { season: 2, episode: 1, title: '1 серия' }
  ]
};

const MOVIE_STREAM = { success: true, url: STREAM_ENCODED, subtitle: SUBTITLE_HTML, premium: false };
const EPISODE_STREAM = { success: true, url: STREAM_ENCODED, subtitle: '', premium: false };

test('RezkaProvider.search: HTML → записи поиска с provider', async () => {
  const client = new FakeRezkaClient();
  const provider = new RezkaProvider({ client });

  const records = await provider.search({ title: 'Тестовый' });
  assert.equal(records.length, 3);
  assert.equal(records[0].provider, 'rezka');
  assert.equal(records[0].id, '12345');
  assert.equal(records[0].title, 'Тестовый фильм');
  assert.equal(records[0].type, 'movie');
  assert.equal(records[1].type, 'serial');
  assert.equal(client.calls[0][0], 'searchHtml');
});

test('RezkaProvider.search: без названия или ошибка клиента → []', async () => {
  const client = new FakeRezkaClient();
  const provider = new RezkaProvider({ client });

  assert.deepEqual(await provider.search({}), []);
  assert.deepEqual(await provider.search({ title: '   ' }), []);

  const failing = new FakeRezkaClient();
  failing.searchHtml = async () => { throw new Error('network'); };
  const providerFailing = new RezkaProvider({ client: failing });
  assert.deepEqual(await providerFailing.search({ title: 'x' }), []);
});

test('RezkaProvider.streams: фильм → StreamItem[] с прокси-URL и Referer', async () => {
  const client = new FakeRezkaClient({ pageHtml: EMBED_MOVIE_HTML, movieStream: MOVIE_STREAM });
  const provider = new RezkaProvider({ client });

  const items = await provider.streams({ id: '12345', href: 'https://rezka.ag/films/12345-x.html', title: 'Тестовый фильм' });

  assert.ok(items.length >= 3, 'по потоку на каждое качество');
  const first = items[0];
  assert.equal(first.provider, 'rezka');
  assert.equal(first.id, '12345');
  assert.equal(first.type, 'movie');
  assert.equal(first.quality, '720p');
  assert.match(first.stream.url, /^https?:\/\/.+\/api\/lampa\/proxy\?url=/);
  assert.equal(first.stream.headers.Referer, 'https://rezka.ag/films/12345-x.html');
  assert.equal(first.subtitles.length, 2);
  assert.equal(client.calls[0][0], 'page');
});

test('RezkaProvider.streams: сериал → StreamItem[] по сериям выбранного сезона', async () => {
  const client = new FakeRezkaClient({
    pageHtml: EMBED_SERIAL_HTML,
    episodes: EPISODES,
    episodeStream: EPISODE_STREAM
  });
  const provider = new RezkaProvider({ client });

  const items = await provider.streams(
    { id: '99999', href: 'https://rezka.ag/cartoons/fantasy/99999-x.html', title: 'Тестовый сериал', type: 'serial' },
    { query: { season: '2' } }
  );

  // Сезон 2 → одна серия × 3 качества
  assert.equal(items.length, 3);
  assert.equal(items[0].type, 'serial');
  assert.equal(items[0].title, '1 серия');
  assert.match(items[0].stream.url, /proxy/);
});

test('RezkaProvider.streams: сериал по id/href без type → тип из embed (isSerial), не из запроса', async () => {
  const client = new FakeRezkaClient({
    pageHtml: EMBED_SERIAL_HTML,
    episodes: EPISODES,
    episodeStream: EPISODE_STREAM
  });
  const provider = new RezkaProvider({ client });

  const items = await provider.streams(
    { id: '99999', href: 'https://rezka.ag/cartoons/fantasy/99999-x.html', title: 'Тестовый сериал' }
  );

  assert.ok(items.length > 0, 'по сериям выбранного сезона');
  for (const item of items) {
    assert.equal(item.type, 'serial', 'не должен наследовать дефолтный movie из записи');
  }
});

test('RezkaProvider.streams: фильм с неверным type в запросе → embed (isSerial=false) побеждает', async () => {
  const client = new FakeRezkaClient({ pageHtml: EMBED_MOVIE_HTML, movieStream: MOVIE_STREAM });
  const provider = new RezkaProvider({ client });

  const items = await provider.streams(
    { id: '12345', href: 'https://rezka.ag/films/12345-x.html', title: 'Тестовый фильм', type: 'serial' }
  );

  assert.ok(items.length >= 1);
  for (const item of items) {
    assert.equal(item.type, 'movie', 'embed-метаданные важнее входящего type');
  }
});

test('RezkaProvider.videos: фильм → {items, seasons, voices} с мапой quality→proxy', async () => {
  const client = new FakeRezkaClient({ pageHtml: EMBED_MOVIE_HTML, movieStream: MOVIE_STREAM });
  const provider = new RezkaProvider({ client });

  const payload = await provider.videos({ query: { title: 'Тестовый', provider: 'rezka', token: 'abc' } });

  assert.equal(payload.items.length, 1);
  const item = payload.items[0];
  assert.equal(item.method, 'play');
  assert.equal(item.type, 'movie');
  assert.equal(item.voice_name, 'Дубляж');
  assert.match(item.url, /proxy/);
  assert.ok(Object.keys(item.quality).length >= 3);
  assert.match(item.quality['720p'], /proxy/);
  assert.deepEqual(payload.seasons, []);
  assert.equal(payload.voices.length, 0);
});

test('RezkaProvider.videos: сериал → items по сериям + seasons/voices фильтры', async () => {
  const client = new FakeRezkaClient({
    pageHtml: EMBED_SERIAL_HTML,
    episodes: EPISODES,
    episodeStream: EPISODE_STREAM
  });
  const provider = new RezkaProvider({ client });

  const payload = await provider.videos({ query: { title: 'Тестовый сериал', season: '1', token: 'abc' } });

  assert.equal(payload.items.length, 2);
  const first = payload.items[0];
  assert.equal(first.method, 'play');
  assert.equal(first.type, 'serial');
  assert.equal(first.season, 1);
  assert.equal(first.episode, 1);
  assert.equal(first.title, '1 серия');
  assert.equal(first.voice_name, 'Дубляж');
  assert.ok(Object.keys(first.quality).length >= 3);

  assert.deepEqual(payload.seasons.map((s) => s.number), [1, 2]);
  assert.deepEqual(payload.voices.map((v) => v.name), ['Дубляж', 'Оригинал']);
  assert.deepEqual(payload.voices[0], { name: 'Дубляж', index: 0 });
});

test('RezkaProvider.videos: пустой/ошибочный путь → пустой payload без throw', async () => {
  const client = new FakeRezkaClient();
  const provider = new RezkaProvider({ client });
  assert.deepEqual(await provider.videos({ query: {} }), { items: [], seasons: [], voices: [] });

  const failing = new FakeRezkaClient();
  failing.page = async () => { throw new Error('geo'); };
  const providerFailing = new RezkaProvider({ client: failing });
  const payload = await providerFailing.videos({ query: { title: 'Тестовый', token: 'abc' } });
  assert.deepEqual(payload, { items: [], seasons: [], voices: [] });
});

// --- favs передача (Rezka P0) ---

/** Fake-клиент, который записывает полный вызов getStreamMovie включая опции. */
class FavsRecordingClient extends FakeRezkaClient {
  constructor(opts = {}) {
    super(opts);
    this.lastMovieStreamOpts = null;
    this.lastMovieStreamReferer = null;
  }

  async getStreamMovie(id, translatorId, opts = {}, referer) {
    this.lastMovieStreamOpts = opts;
    this.lastMovieStreamReferer = referer;
    return super.getStreamMovie(id, translatorId);
  }
}

test('RezkaProvider.movieStreams: передаёт favs в getStreamMovie (Rezka P0)', async () => {
  const client = new FavsRecordingClient({ pageHtml: EMBED_MOVIE_WITH_FAVS_HTML, movieStream: MOVIE_STREAM });
  const provider = new RezkaProvider({ client });

  await provider.streams({ id: '12345', href: 'https://rezka.ag/films/12345-x.html', title: 'Тестовый фильм' });

  assert.equal(client.lastMovieStreamOpts.favs, 'abc123favs_token', 'favs из embed переданы в getStreamMovie');
  assert.equal(client.lastMovieStreamReferer, 'https://rezka.ag/films/12345-x.html');
});

test('RezkaProvider.movieVideos: передаёт favs в getStreamMovie (Rezka P0)', async () => {
  const client = new FavsRecordingClient({ pageHtml: EMBED_MOVIE_WITH_FAVS_HTML, movieStream: MOVIE_STREAM });
  const provider = new RezkaProvider({ client });

  await provider.videos({ query: { title: 'Тестовый', provider: 'rezka', token: 'abc' } });

  assert.equal(client.lastMovieStreamOpts.favs, 'abc123favs_token', 'favs из embed переданы в getStreamMovie через movieVideos');
});
