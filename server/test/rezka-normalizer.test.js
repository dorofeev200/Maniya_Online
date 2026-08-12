import test from 'node:test';
import assert from 'node:assert/strict';

import { RezkaNormalizer } from '../src/providers/rezka/RezkaNormalizer.js';
import { parseEpisodesHtml } from '../src/providers/rezka/RezkaCodec.js';
import {
  SEARCH_HTML,
  EMBED_SERIAL_HTML,
  EMBED_MOVIE_HTML,
  EMBED_MOVIE_WITH_FAVS_HTML,
  EPISODES_HTML,
  STREAM_ENCODED,
  STREAM_PREMIUM_ENCODED,
  SUBTITLE_HTML
} from './fixtures/rezka-fixtures.js';

const normalizer = new RezkaNormalizer();

test('normalizeSearch: HTML поиска → записи поиска (id, href, type)', () => {
  const items = normalizer.normalizeSearchItems(SEARCH_HTML);
  assert.equal(items.length, 3);

  assert.equal(items[0].id, '12345');
  assert.match(items[0].href, /\.html$/);
  assert.equal(items[0].title, 'Тестовый фильм');
  assert.equal(items[0].year, 2024);
  assert.match(items[0].poster, /\.jpg$/);
  assert.equal(items[0].type, 'movie');
  assert.equal(items[0].language, 'ru');

  assert.equal(items[1].id, '99999');
  assert.equal(items[1].title, 'Тестовый сериал');
  assert.equal(items[1].type, 'serial');

  // Живой DOM: title без атрибута title, cover-якорь c <img> не перебивает.
  assert.equal(items[2].id, '77777');
  assert.equal(items[2].title, 'Живой фильм');
  assert.equal(items[2].year, 2024);
  assert.equal(items[2].type, 'movie');
});

test('normalizeSearchItem: пустой/некорректный блок не падает', () => {
  assert.deepEqual(normalizer.normalizeSearchItem({}), {
    id: null,
    href: null,
    title: null,
    original_title: null,
    year: null,
    poster: null,
    type: 'movie',
    language: 'ru'
  });
  assert.equal(normalizer.normalizeSearchItem({ href: '/x/abc.html' }).id, null);
});

test('normalizeEmbed: сериал → isSerial + переводы', () => {
  const embed = normalizer.normalizeEmbed(EMBED_SERIAL_HTML);
  assert.equal(embed.isSerial, true);
  assert.deepEqual(embed.translators, [
    { name: 'Дубляж', id: '7' },
    { name: 'Оригинал', id: '13' }
  ]);
});

test('normalizeEmbed: фильм с cdnplayer → cdnStreams + переводы', () => {
  const embed = normalizer.normalizeEmbed(EMBED_MOVIE_HTML);
  assert.equal(embed.isSerial, false);
  assert.ok(embed.cdnStreams, 'cdnStreams присутствует');
  assert.ok(embed.cdnStreams.startsWith('#h'));
  assert.deepEqual(embed.translators, [{ name: 'Дубляж', id: '7' }]);
});

test('normalizeTranslations: пропускает пустые имена', () => {
  assert.deepEqual(normalizer.normalizeTranslations({}), []);
  assert.deepEqual(normalizer.normalizeTranslations({ ' ': '7', 'Озвучка': '9' }), [
    { name: 'Озвучка', id: '9' }
  ]);
});

test('normalizeSeasons: get_episodes → сезоны с сериями', () => {
  const data = parseEpisodesHtml(EPISODES_HTML.seasons, EPISODES_HTML.episodes);
  const seasons = normalizer.normalizeSeasons(data);

  assert.deepEqual(seasons.map((season) => season.number), [1, 2]);
  assert.equal(seasons[0].title, '1 сезон');

  assert.equal(seasons[0].episodes.length, 2);
  assert.deepEqual({ ...seasons[0].episodes[0] }, { number: 1, title: '1 серия', streams: [] });
  assert.deepEqual({ ...seasons[0].episodes[1] }, { number: 2, title: '2 серия', streams: [] });

  assert.equal(seasons[1].episodes.length, 1);
  assert.equal(seasons[1].episodes[0].number, 1);
});

test('resolveStreams: get_movie JSON → StreamModel[] (свободный путь, даунгрейд качества)', () => {
  const streams = normalizer.resolveStreams({
    success: true,
    url: STREAM_ENCODED,
    subtitle: SUBTITLE_HTML,
    premium: false
  }, { premium: false, hls: false, referer: 'https://rezka.ag/films/12345-testovyy-film-2024.html', voice: 'Дубляж' });

  assert.equal(streams.length, 3);
  assert.equal(streams[0].quality, '720p');
  assert.equal(streams[0].url, 'https://cdn.hdrezka.me/cdn/a/123/456.mp4');
  assert.equal(streams[0].voice, 'Дубляж');
  assert.deepEqual(streams[0].headers, { Referer: 'https://rezka.ag/films/12345-testovyy-film-2024.html' });
  assert.equal(streams[0].subtitles.length, 2);
  assert.equal(streams[0].subtitles[0].label, 'Русские');
  assert.match(streams[0].subtitles[0].url, /\.vtt$/);
});

test('resolveStreams: premium включает 2160p/1440p', () => {
  const streams = normalizer.resolveStreams({
    success: true,
    url: STREAM_PREMIUM_ENCODED,
    subtitle: '',
    premium: true
  }, { premium: true, hls: false, referer: '' });

  // StreamBuilder.quality() канонизирует через shared normalizeQuality (2160p → '4K')
  assert.equal(streams[0].quality, '4K');
  assert.match(streams[0].url, /\.4k\.mp4$/);
  assert.equal(streams[1].quality, '1440p');
  assert.deepEqual(streams[0].headers, {});
});

test('resolveStreams: success=false / пустой payload → []', () => {
  assert.deepEqual(normalizer.resolveStreams({ success: false, url: STREAM_ENCODED }), []);
  assert.deepEqual(normalizer.resolveStreams(null), []);
  assert.deepEqual(normalizer.resolveStreams({ success: true, url: '' }), []);
});

test('resolveQualities: get_movie JSON → {quality: url} (без дублей)', () => {
  const qualities = normalizer.resolveQualities({
    success: true,
    url: STREAM_ENCODED,
    premium: false
  }, { premium: false, hls: false });

  assert.deepEqual(qualities, {
    '720p': 'https://cdn.hdrezka.me/cdn/a/123/456.mp4',
    '480p': 'https://cdn.hdrezka.me/cdn/a/123/456.720p.mp4',
    '360p': 'https://cdn.hdrezka.me/cdn/a/123/456.480p.mp4'
  });
});

test('resolveQualities: успешный ответ без потока → {}', () => {
  assert.deepEqual(normalizer.resolveQualities(null), {});
  assert.deepEqual(normalizer.resolveQualities({ success: true }), {});
});

test('normalizeEmbed: favs передаётся из parseEmbedHtml (Rezka P0)', () => {
  const embed = normalizer.normalizeEmbed(EMBED_MOVIE_WITH_FAVS_HTML);
  assert.equal(embed.favs, 'abc123favs_token', 'favs проходят через normalizeEmbed');
  assert.equal(embed.translators.length, 3);
});

test('normalizeEmbed: favs пуст на старых страницах без ctrl_favs', () => {
  const embed = normalizer.normalizeEmbed(EMBED_MOVIE_HTML);
  assert.equal(embed.favs, '', 'favs пуст без ctrl_favs в HTML');
});
