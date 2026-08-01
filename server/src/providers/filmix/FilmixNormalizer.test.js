import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FilmixClient } from './FilmixClient.js';
import { FilmixNormalizer } from './FilmixNormalizer.js';
import { FilmixProvider } from './FilmixProvider.js';

const movieLink = 'https://cdn.example/s/hash/movie_[1080,720].mp4';

describe('FilmixNormalizer subtitles', () => {
  it('normalizes a single subtitle', () => {
    const [stream] = new FilmixNormalizer({ pro: true }).normalizeMovie({
      link: movieLink,
      translation: 'Dub',
      subtitles: { url: 'https://cdn.example/subtitles/en.vtt', language: 'en', title: 'English' }
    });

    assert.deepEqual(stream.subtitles, [
      { url: 'https://cdn.example/subtitles/en.vtt', title: 'English', language: 'en' }
    ]);
  });

  it('preserves multiple subtitle tracks', () => {
    const [stream] = new FilmixNormalizer({ pro: true }).normalizeMovie({
      link: movieLink,
      translation: 'Dub',
      subtitles: [
        { url: 'https://cdn.example/subtitles/en.vtt', language: 'en', title: 'English' },
        { link: 'https://cdn.example/subtitles/ru.vtt', lang: 'ru', label: 'Русский' }
      ]
    });

    assert.deepEqual(stream.subtitles, [
      { url: 'https://cdn.example/subtitles/en.vtt', title: 'English', language: 'en' },
      { url: 'https://cdn.example/subtitles/ru.vtt', title: 'Русский', language: 'ru' }
    ]);
  });

  it('ignores an empty subtitle list', () => {
    const [stream] = new FilmixNormalizer({ pro: true }).normalizeMovie({
      link: movieLink,
      translation: 'Dub',
      subtitles: []
    });

    assert.deepEqual(stream.subtitles, []);
  });
});

describe('Filmix malformed responses', () => {
  it('returns an empty search result for malformed JSON search payloads', async () => {
    const client = new FilmixClient({
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

    assert.deepEqual(await client.searchApi('movie'), []);
  });

  it('returns null for malformed card payloads', async () => {
    const client = new FilmixClient({
      httpClient: {
        async get() {
          return {
            async text() {
              return '{bad json';
            }
          };
        }
      }
    });

    assert.equal(await client.card('1'), null);
  });

  it('filters invalid search payload entries', async () => {
    const provider = new FilmixProvider({
      client: {
        async search() {
          return { items: [null, 'bad', { id: '1', title: 'Movie' }], selected: 'bad' };
        },
        async searchByExternalIds() {
          return [{ id: '2', title: 'Movie 2' }, null];
        }
      }
    });

    assert.deepEqual(await provider.search({ title: 'Movie' }), {
      selected: null,
      items: [
        {
          id: '1',
          title: 'Movie',
          original_title: null,
          year: null,
          poster: null,
          language: 'ru',
          genres: [],
          runtime: null
        },
        {
          id: '2',
          title: 'Movie 2',
          original_title: null,
          year: null,
          poster: null,
          language: 'ru',
          genres: [],
          runtime: null
        }
      ]
    });
  });

  it('returns empty streams when card loading fails', async () => {
    const provider = new FilmixProvider({
      client: {
        async card() {
          throw new Error('upstream failed');
        }
      }
    });

    assert.deepEqual(await provider.getStreams('1'), []);
  });
});

describe('FilmixNormalizer stream parity', () => {
  it('normalizes backup streams', () => {
    const streams = new FilmixNormalizer({ pro: true }).normalizeMovie({
      link: movieLink,
      translation: 'Dub',
      backup: [{ link: 'https://backup.example/s/hash/movie_backup_[480].mp4', translation: 'Backup Dub' }]
    });

    assert.ok(streams.some((stream) => stream.url === 'https://backup.example/s/hash/movie_backup_480.mp4'));
    assert.ok(streams.some((stream) => stream.voice === 'Backup Dub'));
  });

  it('normalizes reserve streams', () => {
    const streams = new FilmixNormalizer({ pro: true }).normalizeMovie({
      link: movieLink,
      translation: 'Dub',
      reserve: {
        ru: { url: 'https://reserve.example/video.mp4', quality: '720p', voice: 'Reserve Dub' }
      }
    });

    assert.ok(streams.some((stream) => stream.url === 'https://reserve.example/video.mp4'));
    assert.ok(streams.some((stream) => stream.quality === '720p'));
    assert.ok(streams.some((stream) => stream.voice === 'Reserve Dub'));
  });

  it('normalizes DASH streams', () => {
    const streams = new FilmixNormalizer({ pro: true }).normalizeMovie({
      link: movieLink,
      translation: 'Dub',
      dash: 'https://dash.example/manifest.mpd'
    });

    assert.ok(streams.some((stream) => stream.url === 'https://dash.example/manifest.mpd'));
    assert.ok(streams.some((stream) => stream.quality === 'DASH'));
  });
});

describe('FilmixNormalizer acceptance coverage', () => {
  it('normalizes search metadata', () => {
    const item = new FilmixNormalizer().normalizeSearchItem({
      id: '42',
      title: 'Заголовок',
      original_name: 'Original',
      year: '2024',
      poster: 'https://image.example/poster.jpg',
      genre: 'драма, комедия',
      duration: '1 ч 35 мин'
    });

    assert.deepEqual(item, {
      id: '42',
      title: 'Заголовок',
      original_title: 'Original',
      year: 2024,
      poster: 'https://image.example/poster.jpg',
      language: 'ru',
      genres: ['драма', 'комедия'],
      runtime: 95
    });
  });

  it('normalizes movie streams', () => {
    const streams = new FilmixNormalizer({ pro: true }).normalizeMovie({
      link: movieLink,
      translation: 'Dub'
    });

    assert.deepEqual(streams.map((stream) => stream.quality), ['1080p', '720p']);
    assert.ok(streams.every((stream) => stream.headers.Referer === 'https://filmix.my/'));
  });

  it('normalizes serial streams', () => {
    const [season] = new FilmixNormalizer({ pro: true }).toStreamItems({
      player_links: {
        playlist: {
          1: {
            Dub: {
              1: { link: 'https://cdn.example/s/hash/episode_%s.mp4', qualities: [720], translation: 'Dub' }
            }
          }
        }
      }
    });

    assert.equal(season.number, 1);
    assert.equal(season.episodes[0].number, 1);
    assert.equal(season.episodes[0].streams[0].url, 'https://cdn.example/s/hash/episode_720.mp4');
    assert.equal(season.episodes[0].streams[0].quality, '720p');
  });

  it('propagates cookies to Filmix stream headers', () => {
    const [stream] = new FilmixNormalizer({ pro: true }).normalizeMovie({
      link: movieLink,
      translation: 'Dub',
      cookies: { session: 'abc', uid: '42' }
    });

    assert.equal(stream.headers.Cookie, 'session=abc; uid=42');
  });

  it('returns safe client results for HTTP failures', async () => {
    const client = new FilmixClient({
      httpClient: {
        async get() {
          throw new Error('network failed');
        }
      }
    });

    assert.deepEqual(await client.searchApi('movie'), []);
    assert.deepEqual(await client.searchFallback('movie'), []);
    assert.equal(await client.card('1'), null);
  });
});
