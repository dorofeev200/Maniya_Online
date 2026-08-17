// COLLAPS-FIX-001 ПРОД-ФИНДИНГ: provider_error формируется в CollapsProvider.videos()
// (422 → upstream-refusal, COL-4), но store.js при `selected` + пустом native делал
// `chosen = twinForPayload(selected)`; у Collaps близнеца НЕТ (COL-7) → twin=null →
// chosen=null → диагностика выбрасывалась, клиент получал глухое «нет контента»
// (availability скрывала источник — collaps-flap, GAP-002). Тест: при отсутствии
// близнеца store обязан сохранить native с provider_error; честная пустота (COL-6)
// остаётся пустой. Приоритет близнеца-фоллбэка не менялся — покрыт в
// store-movie-native-first.test.js («native пуст + twin playable → twin»).
//
// Каждый файл теста — отдельный процесс, env задаём до динамических импортов.
process.env.COLLAPS_TOKEN = 'probe-collaps-token';

import test from 'node:test';
import assert from 'node:assert/strict';

const { providerById, twinFor } = await import('../src/providers/registry.js');
const { getVideosForRequest } = await import('../src/store.js');

const refusal = { kind: 'upstream-refusal', status: 422, code: 'collaps_http_error', message: 'Collaps HTTP 422' };
const emptyNative = { items: [], seasons: [], voices: [] };
const nativeWithError = { ...emptyNative, provider_error: refusal };

const collapsQuery = {
  provider: 'collaps', id: '603', imdb_id: 'tt0133093', title: 'Матрица',
  original_title: 'The Matrix', serial: '0', year: '1999', source: 'tmdb'
};

test('COLLAPS-PROD-FIND: native пуст + provider_error (422), близнеца нет → диагностика сохраняется', async () => {
  const collaps = providerById('collaps');
  assert.ok(collaps, 'collaps должен быть зарегистрирован (COLLAPS_TOKEN задан)');
  assert.equal(twinFor('collaps'), null, 'COLLAPS-FIX-001 COL-7: у collaps нет skaz-близнеца');
  const orig = collaps.videos;
  collaps.videos = async () => nativeWithError;
  try {
    const body = await getVideosForRequest({ query: collapsQuery });
    assert.deepEqual(body.items, [], 'items пуст');
    assert.equal(body.provider_error?.kind, 'upstream-refusal',
      'классификация 422 не должна выбрасываться store.js (прод-финдинг)');
    assert.equal(body.provider_error?.status, 422);
  } finally { collaps.videos = orig; }
});

test('COLLAPS-PROD-FIND: native 200-EMPTY без provider_error (COL-6) → честный пустой payload', async () => {
  const collaps = providerById('collaps');
  const orig = collaps.videos;
  collaps.videos = async () => emptyNative;
  try {
    const body = await getVideosForRequest({ query: collapsQuery });
    assert.deepEqual(body, { items: [], seasons: [], voices: [] },
      'пустота без ошибки остаётся пустотой без provider_error');
  } finally { collaps.videos = orig; }
});