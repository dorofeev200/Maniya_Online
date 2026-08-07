import test from 'node:test';
import assert from 'node:assert/strict';
import { AllohaProvider } from '../src/providers/alloha/AllohaProvider.js';

class FakeAllohaClient {
  constructor() {
    this.calls = [];
    this.searchResponses = [
      { items: [{ id: 'movie-1', title: 'Test Movie', original_title: 'Test Movie', type: 'movie', poster: 'x' }] },
      { items: [{ id: 'serial-1', title: 'Test Serial', original_title: 'Test Serial', type: 'serial', poster: 'x' }] }
    ];
  }

  async search(payload) {
    this.calls.push(['search', payload]);
    return this.searchResponses.shift() || { items: [] };
  }

  async details(token) {
    this.calls.push(['details', token]);
    return {
      item: {
        token,
        name: 'Test Movie',
        original_name: 'Test Movie',
        year: 2024,
        category: { slug: 'movie' },
        translations: [{ id: 11, name: 'Original', quality: '1080', uhd: false }],
        seasons: [{ season: 1, episodes: [{ episode: 1, translations: [{ id: 11 }] }] }]
      }
    };
  }

  async streams(payload) {
    this.calls.push(['streams', payload]);
    return {
      file: {
        hlsSource: [
          {
            default: true,
            quality: { 1080: 'https://cdn.example/stream.m3u8' },
            reserve: { 1080: 'https://cdn.example/stream-reserve.m3u8' }
          }
        ],
        tracks: [{ label: 'English', src: 'https://cdn.example/subs.vtt' }]
      }
    };
  }
}

test('AllohaProvider searches movies and serials through the client', async () => {
  const client = new FakeAllohaClient();
  const provider = new AllohaProvider({ client });

  const movies = await provider.movie({ title: 'Test Movie' });
  const serials = await provider.serial({ title: 'Test Serial' });

  assert.equal(movies.length, 1);
  assert.equal(serials.length, 1);
  assert.equal(client.calls[0][0], 'search');
  assert.equal(client.calls[1][0], 'search');
});

test('AllohaProvider exposes seasons, episodes, translations, qualities, and streams', async () => {
  const client = new FakeAllohaClient();
  const provider = new AllohaProvider({ client });

  const seasons = await provider.getSeasons({ id: 'movie-1' });
  const episodes = await provider.getEpisodes({ id: 'movie-1' }, 1);
  const translations = await provider.getTranslations({ id: 'movie-1' });
  const qualities = await provider.getQualities({ id: 'movie-1' });
  const streams = await provider.streams({ id: 'movie-1', token: 'movie-1', translationId: 11 });

  assert.ok(Array.isArray(seasons));
  assert.ok(Array.isArray(episodes));
  assert.ok(Array.isArray(translations));
  assert.ok(Array.isArray(qualities));
  assert.ok(Array.isArray(streams));
  assert.ok(streams.length > 0);
});

class FakeVideosAllohaClient {
  constructor() {
    this.calls = [];
    this.searchResponses = [];
  }

  async search(payload) {
    this.calls.push(['search', payload]);
    return this.searchResponses.shift() || { items: [] };
  }

  async details(token) {
    this.calls.push(['details', token]);
    return makeFakeDetails(token);
  }

  async streams(payload) {
    this.calls.push(['streams', payload]);
    return {
      file: {
        hlsSource: [{ quality: { 1080: 'https://cdn.example/stream.m3u8' } }],
        tracks: []
      }
    };
  }
}

function makeFakeDetails(token) {
  return {
    item: {
      token,
      name: 'Test Serial',
      original_name: 'Test Serial',
      year: 2024,
      category: { slug: 'serial' },
      translations: [
        { id: 11, name: 'Original', quality: '1080', uhd: false }
      ],
      seasons: [{ season: 1, episodes: [{ episode: 1, translations: [{ id: 11 }] }] }]
    }
  };
}

test('AllohaProvider.videos: фильм → {method:play} с мапой качеств → прокси', async () => {
  const client = new FakeVideosAllohaClient();
  client.searchResponses.push({ items: [{ id: 'movie-1', token: 'movie-1', title: 'Test Movie', type: 'movie' }] });
  const provider = new AllohaProvider({ client });

  const payload = await provider.videos({ query: { title: 'Test Movie' } });

  assert.equal(payload.items.length, 1);
  const item = payload.items[0];
  assert.equal(item.method, 'play');
  assert.equal(item.type, 'movie');
  assert.equal(item.voice_name, 'Original');
  assert.match(item.url, /\/api\/lampa\/proxy\?url=/);
  assert.match(item.quality['1080p'], /cdn\.example%2Fstream\.m3u8/);
  assert.deepEqual(payload.seasons, []);
  assert.deepEqual(payload.voices, []);

  // streams для фильма без season/episode.
  assert.ok(client.calls.some(([op, args]) => op === 'streams' && args.season == null && args.episode == null));
});

test('AllohaProvider.videos: сериал → items по сериям сезона + фильтры seasons/voices', async () => {
  const client = new FakeVideosAllohaClient();
  client.searchResponses.push({ items: [{ id: 'serial-1', token: 'serial-1', title: 'Test Serial', type: 'serial' }] });
  client.details = async (token) => makeFakeDetails(token);
  const provider = new AllohaProvider({ client });

  const payload = await provider.videos({ query: { title: 'Test Serial', season: '1', voice: '0' } });

  assert.equal(payload.items.length, 1);
  const item = payload.items[0];
  assert.equal(item.method, 'play');
  assert.equal(item.type, 'serial');
  assert.equal(item.season, 1);
  assert.equal(item.episode, 1);
  assert.equal(item.voice_name, 'Original');
  assert.match(item.url, /proxy/);
  assert.ok(item.quality['1080p']);

  assert.deepEqual(payload.seasons.map((s) => s.number), [1]);
  assert.deepEqual(payload.voices, [{ name: 'Original', index: 0 }]);

  // streams для сериала передаёт season/episode.
  assert.ok(client.calls.some(([op, args]) => op === 'streams' && args.season === 1 && args.episode === 1));
});

test('AllohaProvider.videos: пустой/ошибочный путь → пустой payload без throw', async () => {
  const client = new FakeVideosAllohaClient();
  const provider = new AllohaProvider({ client });
  assert.deepEqual(await provider.videos({ query: {} }), { items: [], seasons: [], voices: [] });

  client.searchResponses.push({ items: [{ id: 'movie-1', token: 'movie-1', title: 'Test Movie', type: 'movie' }] });
  client.streams = async () => { throw new Error('geo'); };
  assert.deepEqual(await provider.videos({ query: { title: 'Test Movie' } }), { items: [], seasons: [], voices: [] });
});
