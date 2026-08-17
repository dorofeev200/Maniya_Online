// RUTUBE-HD-FIX-001 РЕГРЕССИЯ: фильм `provider=rutubemovie` обязан отдавать NATIVE
// payload (`method:"play"` с реальным потоком), а НЕ `method:"call"` карточки
// скрытого skaz-rutubemovie: резолв таких call на кластере возвращал
// `quality.auto:null` → фолбэк отдал сам lite-эндпоинт как play-URL → клиент
// получал JSON вместо медиа → «не удалось получить ссылку»
// (docs/rutube-hd-playback-audit-001-report.md §A).
//
// Главный баг: native playable + twin call/неиграбельные → выбирается native.
// Обратный сценарий: native пуст + twin playable → twin остаётся фоллбэком.
//
// Каждый файл теста — отдельный процесс, env задаём до динамических импортов.
process.env.SKAZ_ENABLED = 'true';
process.env.SKAZ_ACCOUNT_EMAIL = 'probe@maniya.test';
process.env.SKAZ_UID = 'probe-uid';
process.env.SKAZ_BALANCERS = 'rutubemovie';

import test from 'node:test';
import assert from 'node:assert/strict';

const { providerById, twinFor } = await import('../src/providers/registry.js');
const { getVideosForRequest } = await import('../src/store.js');

// Native Rutube: играбельный play item (прокси-путь на bl.rutube.ru m3u8,
// как в live-проверке аудита: master 200 / variant 206 / segment 206).
const nativePlay = (file) => ({
  method: 'play',
  title: 'Матрица [4K, SDR, ru]',
  quality: { '4K': `http://x/${file}.m3u8` },
  type: 'movie'
});
const nativePayload = { items: [nativePlay('mp4-1280-hd')], seasons: [], voices: [] };

// Близнец: `method:"call"` карточки, как кластер даёт через lite/rutubemovie
// (77.90.33.109 в аудите) — их резолв на кластере = JSON quality.auto:null.
const twinCallPayload = {
  items: [{ method: 'call', title: 'Матрица (расширенная версия 4K)', url: 'http://77.90.33.109/lite/rutubemovie/play?linkid=abc&account_email=p&uid=u', type: 'movie' }],
  seasons: [], voices: []
};
// Близнец в «честном» состоянии — тоже мог бы отдать play-карточку.
const twinPlayPayload = { items: [{ method: 'play', title: 'movie twin 4K', quality: { '4K': 'http://twin/4k.m3u8' }, type: 'movie' }], seasons: [], voices: [] };

/** Подменяет videos() у native rutubemovie и его близнеца; возвращает restore(). */
function setup({ native, twin }) {
  const rutube = providerById('rutubemovie');
  const skaz = twinFor('rutubemovie');
  assert.ok(rutube, 'native rutubemovie должен быть включён (default RUTUBEMOVIE_ENABLED)');
  assert.ok(skaz, 'skaz-rutubemovie близнец должен существовать при SKAZ_BALANCERS=rutubemovie');
  const calls = { native: 0, twin: 0 };
  const origNative = rutube.videos;
  const origTwin = skaz.videos;
  rutube.videos = async (ctx) => { calls.native += 1; return typeof native === 'function' ? native(ctx) : native; };
  skaz.videos = async (ctx) => { calls.twin += 1; return typeof twin === 'function' ? twin(ctx) : twin; };
  return { calls, restore: () => { rutube.videos = origNative; skaz.videos = origTwin; } };
}

const movieQuery = {
  provider: 'rutubemovie', id: '603', title: 'Матрица', original_title: 'The Matrix',
  serial: '0', year: '1999', source: 'tmdb'
};

test('RUTUBE-HD-FIX-001 [главный баг]: native playable + twin call-карточки → выбирается native', async () => {
  const { calls, restore } = setup({ native: nativePayload, twin: twinCallPayload });
  try {
    const body = await getVideosForRequest({ query: movieQuery });
    assert.ok(body?.items?.length, 'должны прийти items');
    assert.equal(body.items[0].method, 'play',
      'выбран play-дескриптор native, а НЕ call-карточка близнеца (иначе «не удалось получить ссылку»)');
    assert.equal(body.items[0].title, 'Матрица [4K, SDR, ru]', 'item из native');
    assert.ok(body.items[0].quality?.['4K'], 'реальный поток native на месте');
    assert.ok(calls.twin === 0, 'при живом native близнец не должен даже вызываться');
  } finally { restore(); }
});

test('RUTUBE-HD-FIX-001: native playable + twin тоже playable → всё равно native (native-first), без дублей', async () => {
  const { calls, restore } = setup({ native: nativePayload, twin: twinPlayPayload });
  try {
    const body = await getVideosForRequest({ query: movieQuery });
    assert.equal(body.items.length, 1, 'одна карточка, не объединяем native и близнеца');
    assert.equal(body.items[0].title, 'Матрица [4K, SDR, ru]', 'native-first даже когда близнец жив');
    assert.ok(calls.twin === 0, 'близнец не вызывается при живом native');
  } finally { restore(); }
});

test('RUTUBE-HD-FIX-001 [обратный сценарий]: native пуст + twin playable → twin остаётся фоллбэком', async () => {
  const { calls, restore } = setup({ native: { items: [], seasons: [], voices: [] }, twin: twinPlayPayload });
  try {
    const body = await getVideosForRequest({ query: movieQuery });
    assert.ok(body?.items?.length, 'близнец подхватывает пустой native');
    assert.equal(body.items[0].title, 'movie twin 4K', 'фоллбэк на twin даёт его карточку');
    assert.ok(calls.native >= 1 && calls.twin >= 1, 'native и близнец вызваны (fallback-путь)');
  } finally { restore(); }
});

test('RUTUBE-HD-FIX-001: и native и близнец пусты → пустой payload (без исключений)', async () => {
  const { restore } = setup({ native: { items: [], seasons: [], voices: [] }, twin: { items: [], seasons: [], voices: [] } });
  try {
    const body = await getVideosForRequest({ query: movieQuery });
    assert.deepEqual(body, { items: [], seasons: [], voices: [] });
  } finally { restore(); }
});