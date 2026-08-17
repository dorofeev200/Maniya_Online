// FILMIX-004 РЕГРЕССИЯ: сериал `provider=filmix&serial=1` обязан отдавать NATIVE
// payload (реальные названия серий episode.title + voice_name + quality-карта),
// а НЕ skaz-близнец, который в serialVideos хардкодит quality:{} и теряет
// названия («07 N серия»). Фильмы так же native-first (RUTUBE-HD-FIX-001):
// близнец — только фоллбэк при пустом native (см. store-movie-native-first.test.js).
//
// Каждый файл теста — отдельный процесс, поэтому env задаём до import'ов
// (динамические import'ы после установки env, как в registry-twin.test.js).
process.env.SKAZ_ENABLED = 'true';
process.env.SKAZ_ACCOUNT_EMAIL = 'probe@maniya.test';
process.env.SKAZ_UID = 'probe-uid';
process.env.SKAZ_BALANCERS = 'alloha,filmix,rezka';
process.env.FILMIX_ENABLED = 'true';
process.env.REZKA_ENABLED = 'true';
process.env.ALLOHA_ENABLED = 'true';
process.env.ALLOHA_TOKEN = '';

import test from 'node:test';
import assert from 'node:assert/strict';

// ВСЕ импорты локальных модулей — динамические (после установки env).
const { providerById, twinFor } = await import('../src/providers/registry.js');
const { getVideosForRequest } = await import('../src/store.js');

// Native filmix: реальные названия у s1e01/s1e02 (filmix api-fx их отдаёт),
// у ep7 title пустой → фолбэк «7 серия» (это легально по условию FILMIX-004).
const nativePayload = {
  items: [
    { method: 'play', title: 'Enter The House of the Dragon', season: 1, episode: 1, voice_name: 'Дубляж [Кравец-Рекордз]', quality: { '2160p': 'http://x/e1.m3u8', '1080p': 'http://x/e1_1080.m3u8' }, type: 'serial' },
    { method: 'play', title: 'House Of The Dragon Premiere Special', season: 1, episode: 2, voice_name: 'Дубляж [Кравец-Рекордз]', quality: { '2160p': 'http://x/e2.m3u8', '1080p': 'http://x/e2_1080.m3u8' }, type: 'serial' },
    { method: 'play', title: '7 серия', season: 1, episode: 7, voice_name: 'Дубляж [Кравец-Рекордз]', quality: { '2160p': 'http://x/e7.m3u8', '1080p': 'http://x/e7_1080.m3u8' }, type: 'serial' }
  ],
  seasons: [{ number: 1, title: '1 сезон' }],
  voices: [{ name: 'Дубляж [Кравец-Рекордз]', index: 0 }]
};

// Skaz-близнец: потерянные названия (все «N серия»), пустые voice_name и quality.
const twinPayload = {
  items: [
    { method: 'play', title: '1 серия', season: 1, episode: 1, voice_name: '', quality: {}, type: 'serial' },
    { method: 'play', title: '2 серия', season: 1, episode: 2, voice_name: '', quality: {}, type: 'serial' },
    { method: 'play', title: '7 серия', season: 1, episode: 7, voice_name: '', quality: {}, type: 'serial' }
  ],
  seasons: [{ number: 1, title: '1 сезон' }],
  voices: [{ name: 'Дубляж [Кравец-Рекордз]', index: 0 }]
};

const movieNative = {
  items: [{ method: 'play', title: 'Дубляж [4K, SDR, ru, Movie Dubbing]', quality: { '4K': 'http://x/4k.mp4' }, type: 'movie' }],
  seasons: [], voices: []
};
const movieTwin = {
  items: [{ method: 'play', title: 'movie twin 2160p', quality: { '2160p': 'http://twin/2160.m3u8' }, type: 'movie' }],
  seasons: [], voices: []
};

/** Подменяет videos() у native filmix и его близнеца; возвращает restore(). */
function setup({ native, twin }) {
  const filmix = providerById('filmix');
  const skaz = twinFor('filmix');
  assert.ok(filmix, 'native filmix должен быть включён');
  assert.ok(skaz, 'skaz-filmix близнец должен существовать');
  const calls = { native: 0, twin: 0 };
  const origNative = filmix.videos;
  const origTwin = skaz.videos;
  filmix.videos = async (ctx) => { calls.native += 1; return typeof native === 'function' ? native(ctx) : native; };
  skaz.videos = async (ctx) => { calls.twin += 1; return typeof twin === 'function' ? twin(ctx) : twin; };
  return { calls, restore: () => { filmix.videos = origNative; skaz.videos = origTwin; } };
}

// Реальное устройство (nginx-лог): id=94997 (TMDB id HOTD), source=tmdb, БЕЗ tmdb_id.
const serialQuery = {
  provider: 'filmix', id: '94997', title: 'Дом Дракона', original_title: 'House of the Dragon',
  serial: '1', year: '2022', original_language: 'en', source: 'tmdb', clarification: '0',
  similar: 'false', imdb_id: 'tt11198330'
};

test('FILMIX-004: сериал serial=1 → native первым, реальные названия доходят без «N серия»', async () => {
  const { calls, restore } = setup({ native: nativePayload, twin: twinPayload });
  try {
    const body = await getVideosForRequest({ query: serialQuery });
    assert.ok(body?.items?.length, 'должны прийти items');
    assert.equal(body.items[0].title, 'Enter The House of the Dragon',
      's1e01: реальное название из native, а не «1 серия» из близнеца');
    assert.equal(body.items[1].title, 'House Of The Dragon Premiere Special',
      's1e02: реальное название из native');
    assert.equal(body.items[2].title, '7 серия',
      'ep7: у filmix нет реального title → фолбэк «7 серия» допустим (без имени шоу)');
    assert.ok(body.items.every((i) => i.voice_name), 'voice_name из native не теряется');
    assert.ok(body.items.every((i) => i.quality && Object.keys(i.quality).length), 'quality-карта native на месте');
    assert.ok(body.items.every((i) => i.title && !i.title.includes('Дом Дракона')), 'имя сериала НЕ примешивается');
    assert.ok(calls.twin === 0, 'для сериала близнец не должен вызываться, когда native жив');
  } finally { restore(); }
});

test('фильм (без serial) → native первым (RUTUBE-HD-FIX-001), близнец — только фоллбэк', async () => {
  const { calls, restore } = setup({ native: movieNative, twin: movieTwin });
  try {
    const body = await getVideosForRequest({
      query: { provider: 'filmix', id: '1567', title: 'Форрест Гамп', original_title: 'Forrest Gump', serial: '0', year: '1994' }
    });
    assert.equal(body.items[0].title, 'Дубляж [4K, SDR, ru, Movie Dubbing]',
      'фильм берётся из native (native-first, RUTUBE-HD-FIX-001)');
    assert.ok(calls.twin === 0, 'при живом native близнец для фильма не вызывается');
  } finally { restore(); }
});

test('сериал: native пуст → фоллбэк на близнец (не ломаем покрытие)', async () => {
  const { calls, restore } = setup({ native: { items: [], seasons: [], voices: [] }, twin: twinPayload });
  try {
    const body = await getVideosForRequest({ query: serialQuery });
    assert.ok(body?.items?.length, 'близнец подхватывает пустой native');
    assert.equal(body.items[0].title, '1 серия');
    assert.ok(calls.twin >= 1, 'близнец вызван как фоллбэк');
  } finally { restore(); }
});

test('сериал: и native и близнец пусты → пустой payload (без исключений)', async () => {
  const { restore } = setup({ native: { items: [], seasons: [], voices: [] }, twin: { items: [], seasons: [], voices: [] } });
  try {
    const body = await getVideosForRequest({ query: serialQuery });
    assert.deepEqual(body, { items: [], seasons: [], voices: [] });
  } finally { restore(); }
});
