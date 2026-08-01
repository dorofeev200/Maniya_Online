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
