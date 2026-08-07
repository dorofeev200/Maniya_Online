import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  decodeBase64,
  getStreamLink,
  parseSearchHtml,
  parseEmbedHtml,
  parseEpisodesHtml,
  parseSubtitleHtml,
  solveAnubisChallenge,
  buildPassChallengeUrl,
  hasAnubisChallenge
} from '../src/providers/rezka/RezkaCodec.js';

import {
  b64,
  STREAM_DECODED,
  STREAM_ENCODED,
  STREAM_PREMIUM_DECODED,
  STREAM_PREMIUM_ENCODED,
  SEARCH_HTML,
  EMBED_SERIAL_HTML,
  EMBED_MOVIE_HTML,
  EPISODES_HTML,
  SUBTITLE_HTML,
  anubisHtml
} from './fixtures/rezka-fixtures.js';

test('decodeBase64: снимает trash и возвращает [quality]url', () => {
  assert.equal(decodeBase64(STREAM_ENCODED), STREAM_DECODED);
});

test('decodeBase64: не-буквальная строка (# префикс только у потоков) возвращается как есть', () => {
  assert.equal(decodeBase64('plain text'), 'plain text');
  // как в Lampac: нераскодировавшийся поток возвращается без изменений
  assert.equal(decodeBase64('#h'), '#h');
});

test('decodeBase64: чистая base64 без мусора (# префикса нет) не трогаем', () => {
  const plain = b64('hello');
  assert.equal(decodeBase64(plain), plain);
});

test('getStreamLink: бесплатный путь → 1080p..360p с даунгрейдом качества', () => {
  const links = getStreamLink(STREAM_ENCODED, { premium: false, hls: false });
  assert.deepEqual(links, [
    { quality: '720p', url: 'https://cdn.hdrezka.me/cdn/a/123/456.mp4' },
    { quality: '480p', url: 'https://cdn.hdrezka.me/cdn/a/123/456.720p.mp4' },
    { quality: '360p', url: 'https://cdn.hdrezka.me/cdn/a/123/456.480p.mp4' }
  ]);
});

test('getStreamLink: резерв ` or ` — берём первую (основную) ссылку', () => {
  const links = getStreamLink(STREAM_ENCODED, { premium: false, hls: false });
  assert.ok(!links[0].url.includes(' or '));
  assert.equal(links[0].url, 'https://cdn.hdrezka.me/cdn/a/123/456.mp4');
});

test('getStreamLink: hls=true дописывает :hls:manifest.m3u8, .m3u8 не трогает', () => {
  const links = getStreamLink(STREAM_ENCODED, { premium: false, hls: true });
  assert.equal(links[0].url, 'https://cdn.hdrezka.me/cdn/a/123/456.mp4:hls:manifest.m3u8');
});

test('getStreamLink: premium включает 4K/1440p/1080p Ultra (в порядке приоритета)', () => {
  const links = getStreamLink(STREAM_PREMIUM_ENCODED, { premium: true, hls: false });
  const qualities = links.map((l) => l.quality);
  assert.deepEqual(qualities.slice(0, 3), ['2160p', '1440p', '1080p']);
  assert.equal(links[0].quality, '2160p');
  assert.equal(links[0].url, 'https://cdn.hdrezka.me/cdn/a/123/456.4k.mp4');
});

test('parseSearchHtml: извлекает card-блоки (href, title, year, poster)', () => {
  const items = parseSearchHtml(SEARCH_HTML);
  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'Тестовый фильм');
  assert.equal(items[0].year, '2024');
  assert.match(items[0].poster, /\.jpg$/);
  assert.match(items[0].href, /\.html$/);
  assert.equal(items[1].serial, true, 'сериал помечается по папке /cartoons/');
  assert.equal(items[2].title, 'Живой фильм', 'title из text-контента якоря (реальный DOM)');
});

test('parseEmbedHtml: сериал → translators + isSerial', () => {
  const embed = parseEmbedHtml(EMBED_SERIAL_HTML);
  assert.equal(embed.isSerial, true);
  assert.equal(embed.translators['Дубляж'], '7');
  assert.equal(embed.translators['Оригинал'], '13');
});

test('parseEmbedHtml: фильм с cdnplayer → cdnStreams', () => {
  const embed = parseEmbedHtml(EMBED_MOVIE_HTML);
  assert.equal(embed.isSerial, false);
  assert.equal(embed.translators['Дубляж'], '7');
  assert.ok(embed.cdnStreams, 'cdnStreams присутствует');
  assert.ok(embed.cdnStreams.startsWith('#h'));
});

test('parseEpisodesHtml: сезоны и серии', () => {
  const { seasons, episodes } = parseEpisodesHtml(EPISODES_HTML.seasons, EPISODES_HTML.episodes);
  assert.deepEqual(seasons.map((s) => s.number), [1, 2]);
  assert.equal(episodes.length, 3);
  assert.deepEqual({ ...episodes[0] }, { season: 1, episode: 1, title: '1 серия' });
});

test('parseSubtitleHtml: формат [label]url.vtt', () => {
  const subs = parseSubtitleHtml(SUBTITLE_HTML);
  assert.equal(subs.length, 2);
  assert.equal(subs[0].label, 'Русские');
  assert.match(subs[0].url, /\.vtt$/);
});

test('hasAnubisChallenge / solveAnubisChallenge: PoW даёт хэш с требуемым числом нулевых бит', () => {
  const html = anubisHtml({ difficulty: 4 });
  assert.equal(hasAnubisChallenge(html), true);

  const solution = solveAnubisChallenge(html);
  assert.ok(solution, 'решение найдено');
  assert.equal(solution.id, 'challenge-test-id');
  assert.ok(solution.nonce !== undefined);

  // валидация: SHA256(randomData+nonce) имеет 4 старших нулевых бита (2 нулевых байта)
  const json = JSON.parse(html.match(/anubis_challenge">(.*?)<\/div>/)[1]);
  const hash = createHash('sha256')
    .update(json.challenge.randomData + solution.nonce)
    .digest();
  assert.equal(hash[0], 0);
  assert.equal(hash[1], 0);
  assert.equal(solution.response, hash.toString('hex'));
});

test('buildPassChallengeUrl: машина pass-challenge с id/response/nonce/redir', () => {
  const url = buildPassChallengeUrl('https://rezka.ag', { id: 'cid', response: 'ff', nonce: '5', elapsedTime: '1' }, 'https://rezka.ag/films/1-x.html');
  assert.match(url, /^https:\/\/rezka\.ag\/\.within\.website\/x\/cmd\/anubis\/api\/pass-challenge\?/);
  assert.match(url, /id=cid/);
  assert.match(url, /response=ff/);
  assert.match(url, /nonce=5/);
  assert.match(url, /redir=/);
});

test('solveAnubisChallenge: невалидный челлендж → null', () => {
  assert.equal(solveAnubisChallenge('<html>без челленджа</html>'), null);
  assert.equal(solveAnubisChallenge(''), null);
  assert.equal(solveAnubisChallenge(anubisHtml({ difficulty: 'not-a-number' })), null);
  assert.equal(solveAnubisChallenge(anubisHtml({ difficulty: 200 })), null);
});