import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FilmixProvider } from '../src/providers/filmix/FilmixProvider.js';
import { assertStreamItems } from '../src/providers/base.js';

const card = JSON.parse(readFileSync(new URL('./fixtures/filmix-card.json', import.meta.url), 'utf8'));
// Сериал-карточка без movie-части — так Filmix Morphology отдаёт именно сериал.
const serialCard = JSON.parse(JSON.stringify(card));
serialCard.player_links.movie = null;

const movieLinks = JSON.parse(readFileSync(new URL('./fixtures/filmix-video-links-movie.json', import.meta.url), 'utf8'));
const serialLinks = JSON.parse(readFileSync(new URL('./fixtures/filmix-video-links-serial.json', import.meta.url), 'utf8'));

class FakeFilmixClient {
  constructor() {
    this.cardCalls = [];
    this.videoLinksCalls = [];
    this.serialMode = false;
    this.cardNullMode = false;
    this.linksNullMode = false;
    this.searchItems = [
      { id: 59708, title: '6-ой раунд', original_title: 'Round 6', year: 2010, poster: 'x' }
    ];
  }

  async search() {
    return { items: this.searchItems, selected: this.searchItems[0] };
  }

  async card(postId) {
    this.cardCalls.push(postId);
    if (this.cardNullMode) return null;
    return this.serialMode ? serialCard : card;
  }

  async videoLinks(postId) {
    this.videoLinksCalls.push(postId);
    if (this.linksNullMode) return null;
    if (this.linksOverride) return this.linksOverride;
    return this.serialMode ? serialLinks : movieLinks;
  }

  normalizeSearchName(value) {
    return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
  }
}

function providerWith({ pro = true, token = 'dev-token', client = null } = {}) {
  return new FilmixProvider({ client: client || new FakeFilmixClient(), pro, token });
}

// Прокси оборачивает исходный медиа-URL в /api/lampa/proxy?url=<enc>. Здесь
// возвращаем раскодированный внутренний адрес для проверки качества.
function unproxy(url) {
  const encoded = String(url).split('/api/lampa/proxy?')[1] || '';
  return new URLSearchParams(encoded).get('url') || encoded;
}

const context = {
  query: { title: '6-ой раунд', original_title: 'Round 6', year: '2010' },
  request: { headers: { authorization: 'Bearer dev-token' } }
};

test('FilmixProvider.search возвращает плоский массив записей', async () => {
  const provider = providerWith();
  const records = await provider.search(context);
  assert.ok(Array.isArray(records));
  assert.equal(records.length, 1);
  assert.equal(records[0].provider, 'filmix');
  assert.equal(records[0].id, 59708);
  assert.equal(records[0].original_title, 'Round 6');
});

// ── PRIMARY: browser-API video-links (api.filmix.tv/api-fx) ─────────────

test('FilmixProvider.streams: video-links primary для фильма (api-fx)', async () => {
  const client = new FakeFilmixClient();
  const provider = providerWith({ client });

  const items = await provider.streams({ id: 59708, title: '6-ой раунд' }, context);
  const valid = assertStreamItems(items, 'filmix');
  assert.ok(valid.length >= 8, `должно быть >=8 потоков, получили ${valid.length}`);

  const dub = valid.filter((item) => item.voice === 'Дубляж [4K, SDR, ru, Movie Dubbing]');
  assert.deepEqual([...new Set(dub.map((item) => item.quality))], ['4K', '1440p', '1080p', '720p', '480p']);
  const best = dub.find((item) => item.quality === '4K');
  assert.match(unproxy(best.stream.url), /SDR_2160\.mp4$/);
  assert.deepEqual(best.stream.headers, { Referer: 'https://filmix.my/' });

  assert.equal(client.videoLinksCalls.length, 1, 'video-links должен быть первым');
  assert.equal(client.cardCalls.length, 0, 'card не вызывается при живом video-links');
});

test('FilmixProvider.streams: video-links primary для сериала с фильтром сезона', async () => {
  const client = new FakeFilmixClient();
  client.serialMode = true;
  const provider = providerWith({ client });

  const items = await provider.streams(
    { id: 59708, title: '6-ой раунд' },
    { ...context, query: { ...context.query, season: '2', voice: '0' } }
  );
  const valid = assertStreamItems(items, 'filmix');
  assert.ok(valid.length > 0);
  assert.ok(valid.every((item) => item.voice === 'Дубляж [RHS]'));
  assert.ok(valid.some((item) => item.stream.url.includes('s02e01_1080.mp4')));
  assert.ok(!valid.some((item) => item.stream.url.includes('s01e')));
});

test('FilmixProvider.videos: video-links primary для фильма — озвучки + мапа качеств', async () => {
  const client = new FakeFilmixClient();
  const provider = providerWith({ client });

  const payload = await provider.videos(context);
  assert.equal(payload.seasons.length, 0);
  assert.equal(payload.voices.length, 0);

  const titles = payload.items.map((item) => item.title);
  assert.ok(titles.includes('Дубляж [4K, SDR, ru, Movie Dubbing]'));
  assert.ok(titles.includes('Дубляж [1080+, Ukr, Postmodern]'));

  const movie = payload.items.find((item) => item.title === 'Дубляж [4K, SDR, ru, Movie Dubbing]');
  assert.equal(movie.method, 'play');
  assert.equal(movie.type, 'movie');
  assert.deepEqual(Object.keys(movie.quality), ['4K', '1440p', '1080p', '720p', '480p']);
  assert.match(unproxy(movie.url), /SDR_2160\.mp4$/);
  assert.match(movie.url, /\/api\/lampa\/proxy\?url=/);
  assert.match(movie.url, /token=dev-token/);
  assert.deepEqual(movie.headers, { Referer: 'https://filmix.my/' });

  assert.equal(client.videoLinksCalls.length, 1);
  assert.equal(client.cardCalls.length, 0);
});

test('FilmixProvider.videos: бесплатный путь из video-links ретранслирует все качества (T4: без изменений)', async () => {
  const client = new FakeFilmixClient();
  const provider = providerWith({ client, token: '', pro: false });

  const payload = await provider.videos(context);
  const movie = payload.items.find((item) => item.title === 'Дубляж [4K, SDR, ru, Movie Dubbing]');
  assert.deepEqual(Object.keys(movie.quality), ['4K', '1440p', '1080p', '720p', '480p']);
});

test('FilmixProvider.videos: video-links primary для сериала — сезоны/озвучки/серии', async () => {
  const client = new FakeFilmixClient();
  client.serialMode = true;
  const provider = providerWith({ client });

  const payload = await provider.videos({ ...context, query: { ...context.query, season: '1', voice: '0' } });
  assert.deepEqual(payload.seasons.map((s) => s.number), [1, 2]);
  assert.deepEqual(payload.voices.map((v) => v.name), ['Дубляж [RHS]', 'Оригинальный [Английский]']);

  assert.ok(payload.items.length >= 2);
  const episode = payload.items.find((item) => item.episode === 1);
  // Filmix api-fx отдаёт реальное название серии — оно должно дойти до UI без потери.
  assert.equal(episode.title, 'Refined Aggression');
  assert.equal(episode.season, 1);
  assert.equal(episode.voice_name, 'Дубляж [RHS]');
  assert.deepEqual(Object.keys(episode.quality), ['1080p', '720p', '480p']);
  assert.match(unproxy(episode.url), /s01e01_1080\.mp4$/);
});

test('FilmixProvider.videos: пустой/отсутствующий episode.title → фолбэк «N серия»', async () => {
  const client = new FakeFilmixClient();
  client.serialMode = true;
  const provider = providerWith({ client });

  // Клонируем фикстуру и полностью убираем title у всех серий (так бывает в API) —
  // фолбэк обязан вернуть «N серия», без «undefined»/имени шоу/выдуманных названий.
  const links = JSON.parse(JSON.stringify(serialLinks));
  for (const voiceKey of Object.keys(links)) {
    for (const seasonKey of Object.keys(links[voiceKey])) {
      const season = links[voiceKey][seasonKey];
      if (!season || !season.episodes) continue;
      for (const ep of Object.values(season.episodes)) delete ep.title;
    }
  }
  client.linksOverride = links;

  const payload = await provider.videos({ ...context, query: { ...context.query, season: '1', voice: '0' } });
  const episode = payload.items.find((item) => item.episode === 1);
  assert.equal(episode.title, '1 серия');
  const second = payload.items.find((item) => item.episode === 2);
  assert.equal(second.title, '2 серия');
});

// ── FALLBACK: карточный путь filmix.my/api/v2/post (video-links недоступен) ──

test('FilmixProvider.streams: фолбэк на card() при недоступном video-links (фильм)', async () => {
  const client = new FakeFilmixClient();
  client.linksNullMode = true;
  const provider = providerWith({ client });

  const items = await provider.streams({ id: 59708, title: '6-ой раунд' }, context);
  const valid = assertStreamItems(items, 'filmix');
  assert.ok(valid.length >= 2);

  const byVoice = new Map();
  for (const item of valid) byVoice.set(item.voice, (byVoice.get(item.voice) || 0) + 1);
  assert.ok(byVoice.get('Дублированный') >= 3);
  assert.ok(byVoice.get('Оригинальный') >= 3);

  const best = valid.find((item) => item.voice === 'Дублированный' && item.quality === '1080p');
  assert.ok(best, 'должна быть 1080p для про-пути');
  assert.match(unproxy(best.stream.url), /_1080\.mp4$/);
  assert.equal(best.stream.headers.Referer, 'https://filmix.my/');

  assert.equal(client.videoLinksCalls.length, 1);
  assert.equal(client.cardCalls.length, 1);
});

test('FilmixProvider.streams: карточный бесплатный путь отдаёт только 480p', async () => {
  const client = new FakeFilmixClient();
  client.linksNullMode = true;
  const provider = providerWith({ client, token: '', pro: false });

  const items = await provider.streams({ id: 59708, title: '6-ой раунд' }, context);
  const valid = assertStreamItems(items, 'filmix');
  const qualities = new Set(valid.map((item) => item.quality));
  assert.deepEqual([...qualities], ['480p']);
});

test('FilmixProvider.videos: фолбэк на card() при недоступном video-links (фильм)', async () => {
  const client = new FakeFilmixClient();
  client.linksNullMode = true;
  const provider = providerWith({ client });

  const payload = await provider.videos(context);
  assert.equal(payload.seasons.length, 0);
  assert.equal(payload.voices.length, 0);

  const titles = payload.items.map((item) => item.title);
  assert.ok(titles.includes('Дублированный'));
  assert.ok(titles.includes('Оригинальный'));

  const movie = payload.items.find((item) => item.title === 'Дублированный');
  assert.equal(movie.method, 'play');
  assert.equal(movie.type, 'movie');
  assert.deepEqual(Object.keys(movie.quality), ['1080p', '720p', '480p']);
  assert.match(unproxy(movie.url), /_1080\.mp4$/);
  assert.match(movie.url, /\/api\/lampa\/proxy\?url=/);
  assert.match(movie.url, /token=dev-token/);
});

test('FilmixProvider.videos: фолбэк на card() при недоступном video-links (сериал)', async () => {
  const client = new FakeFilmixClient();
  client.linksNullMode = true;
  client.serialMode = true;
  const provider = providerWith({ client });

  const payload = await provider.videos({ ...context, query: { ...context.query, season: '1', voice: '0' } });
  assert.deepEqual(payload.seasons.map((s) => s.number), [1, 2]);
  assert.deepEqual(payload.voices.map((v) => v.name), ['Дублированный', 'Оригинальный']);

  assert.ok(payload.items.length >= 2);
  const episode = payload.items.find((item) => item.episode === 1);
  assert.equal(episode.title, '1 серия');
  assert.equal(episode.season, 1);
  assert.equal(episode.voice_name, 'Дублированный');
  assert.deepEqual(Object.keys(episode.quality), ['720p', '480p']);
  assert.match(unproxy(episode.url), /serial_s1e1_720\.mp4$/);
});

test('FilmixProvider.videos: card и video-links оба недоступны → пусто', async () => {
  const client = new FakeFilmixClient();
  client.cardNullMode = true;
  client.linksNullMode = true;
  const provider = providerWith({ client });

  const payload = await provider.videos(context);
  assert.deepEqual(payload, { items: [], seasons: [], voices: [] });
});

test('FilmixProvider.streams: card и video-links оба недоступны → пусто', async () => {
  const client = new FakeFilmixClient();
  client.cardNullMode = true;
  client.linksNullMode = true;
  const provider = providerWith({ client });

  const items = await provider.streams({ id: 59708, title: '6-ой раунд' }, context);
  assert.deepEqual(items, []);
});

// ── card-хелперы (getSeasons/getVoices/getEpisodes) остаются карточными ──

test('FilmixProvider.getSeasons/getVoices/getEpisodes резолвят карточку', async () => {
  const client = new FakeFilmixClient();
  client.serialMode = true;
  const provider = new FilmixProvider({ client, pro: true, token: 'dev-token' });
  const seasons = await provider.getSeasons(59708, context);
  const voices = await provider.getVoices(59708, '1', context);
  const episodes = await provider.getEpisodes(59708, '1', 0, '6-ой раунд', context);

  assert.deepEqual(seasons.map((s) => s.number), [1, 2]);
  assert.deepEqual(voices, ['Дублированный', 'Оригинальный']);
  assert.deepEqual(episodes.map((e) => e.number), [1, 2]);
});
