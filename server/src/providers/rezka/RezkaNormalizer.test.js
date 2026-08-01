import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { RezkaClient } from './RezkaClient.js';
import { RezkaNormalizer } from './RezkaNormalizer.js';
import { RezkaProvider } from './RezkaProvider.js';

describe('Rezka search', () => {
  it('forwards search parameters in the request URL', async () => {
    let requestedPath = null;
    const client = new RezkaClient({
      httpClient: {
        async get(path) {
          requestedPath = path;
          return { async json() { return { results: [] }; } };
        }
      }
    });

    await client.search({ title: 'Movie Name', year: 2024, type: 'serial' });

    assert.equal(requestedPath, '/api/search?query=Movie+Name&year=2024&type=series');
  });
});

describe('Rezka movies and serials', () => {
  it('resolves movie cards with metadata', async () => {
    const provider = new RezkaProvider({
      client: {
        async card(id) {
          return { id, title: 'Movie', year: '2024', type: 'movie', genres: 'drama, comedy', translations: [{ id: 'dub', title: 'Dub' }], qualities: ['1080'] };
        }
      }
    });

    assert.deepEqual(await provider.movie({ id: '10' }), {
      id: '10',
      title: 'Movie',
      original_title: null,
      year: 2024,
      type: 'movie',
      language: null,
      poster: null,
      translation: null,
      description: null,
      genres: ['drama', 'comedy'],
      runtime: null,
      seasons: [],
      translations: [{ id: 'dub', title: 'Dub', voice: 'Dub', language: null }],
      qualities: ['1080p']
    });
  });

  it('resolves serial cards with seasons', async () => {
    const provider = new RezkaProvider({
      client: {
        async card(id) {
          return { id, title: 'Show', type: 'serial', seasons: [{ number: 1, episodes: [{ number: 2, streams: [{ url: 'https://cdn.example/e2.mp4', quality: '720', voice: 'Dub' }] }] }] };
        }
      }
    });

    const serial = await provider.serial({ id: '20' });

    assert.equal(serial.type, 'serial');
    assert.equal(serial.seasons[0].number, 1);
    assert.equal(serial.seasons[0].episodes[0].number, 2);
    assert.equal(serial.seasons[0].episodes[0].streams[0].quality, '720p');
  });
});

describe('Rezka seasons and episodes', () => {
  it('normalizes seasons', () => {
    const [season] = new RezkaNormalizer().normalizeSeasons({ seasons: { 1: { title: 'Season 1', episodes: [] } } });

    assert.equal(season.number, 1);
    assert.equal(season.title, 'Season 1');
  });

  it('normalizes episodes', () => {
    const episode = new RezkaNormalizer().normalizeEpisode({ episode: '3', title: 'Episode 3', streams: [{ link: 'https://cdn.example/3.mp4', q: '480' }] });

    assert.equal(episode.number, 3);
    assert.equal(episode.streams[0].url, 'https://cdn.example/3.mp4');
    assert.equal(episode.streams[0].quality, '480p');
  });
});

describe('Rezka stream normalization', () => {
  it('normalizes stream variants with headers and subtitles', () => {
    const streams = new RezkaNormalizer().normalizeStreams({
      variants: [
        { src: 'https://cdn.example/movie-1080.mp4', label: '1080', translation: 'Dub', headers: { Origin: 'https://rezka.ag' }, subtitles: { url: 'https://cdn.example/en.vtt', lang: 'en', label: 'English' } }
      ]
    }, { cookies: { session: 'abc' } });

    assert.deepEqual(streams, [{
      url: 'https://cdn.example/movie-1080.mp4',
      title: 'Dub',
      quality: '1080p',
      voice: 'Dub',
      headers: { Referer: 'https://rezka.ag/', Origin: 'https://rezka.ag', Cookie: 'session=abc' },
      subtitles: [{ url: 'https://cdn.example/en.vtt', title: 'English', language: 'en' }]
    }]);
  });

  it('propagates payload cookies to every normalized stream header', () => {
    const streams = new RezkaNormalizer().normalizeStreams({
      cookies: { session: 'abc', uid: '42' },
      streams: [
        { url: 'https://cdn.example/movie-720.mp4', quality: '720' },
        { url: 'https://cdn.example/movie-1080.mp4', quality: '1080' }
      ]
    });

    assert.deepEqual(streams.map((stream) => stream.headers.Cookie), ['session=abc; uid=42', 'session=abc; uid=42']);
  });

  it('normalizes payload subtitles for streams without local subtitles', () => {
    const [stream] = new RezkaNormalizer().normalizeStreams({
      subtitles: [
        { link: 'https://cdn.example/subtitles/ru.vtt', lang: 'ru', label: 'Русский' },
        { src: 'https://cdn.example/subtitles/en.vtt', language: 'en', title: 'English' }
      ],
      streams: [{ url: 'https://cdn.example/movie.mp4', quality: '720' }]
    });

    assert.deepEqual(stream.subtitles, [
      { url: 'https://cdn.example/subtitles/ru.vtt', title: 'Русский', language: 'ru' },
      { url: 'https://cdn.example/subtitles/en.vtt', title: 'English', language: 'en' }
    ]);
  });
});

describe('Rezka safe error handling', () => {
  it('returns safe client fallbacks for failed HTTP requests and malformed JSON', async () => {
    const failedClient = new RezkaClient({
      httpClient: {
        async get() {
          throw new Error('network failed');
        }
      }
    });
    const malformedClient = new RezkaClient({
      httpClient: {
        async get() {
          return {
            async json() {
              throw new SyntaxError('bad json');
            }
          };
        }
      }
    });

    assert.deepEqual(await failedClient.search({ title: 'Movie' }), {
      query: { query: 'Movie', type: 'movie' },
      items: [],
      selected: null
    });
    assert.equal(await failedClient.card('1'), null);
    assert.equal(await failedClient.streams('1'), null);
    assert.deepEqual(await malformedClient.search({ title: 'Movie' }), {
      query: { query: 'Movie', type: 'movie' },
      items: [],
      selected: null
    });
    assert.equal(await malformedClient.card('1'), null);
    assert.equal(await malformedClient.streams('1'), null);
  });

  it('returns safe provider fallbacks when client methods fail', async () => {
    const provider = new RezkaProvider({
      client: {
        async search() {
          throw new Error('search failed');
        },
        async card() {
          throw new Error('card failed');
        },
        async streams() {
          throw new Error('streams failed');
        }
      }
    });

    assert.deepEqual(await provider.search({ title: 'Movie' }), []);
    assert.equal(await provider.movie({ id: '1' }), null);
    assert.equal(await provider.serial({ id: '1' }), null);
    assert.deepEqual(await provider.streams({ id: '1' }), []);
  });
});
