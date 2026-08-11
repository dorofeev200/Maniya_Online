// Реестр: skaz-близнецы native-провайдеров (SkazProvider, docs/skaz-architecture.md).
// - включённый native (filmix/rezka/hdvb/rutubemovie) → skaz-твин СКРЫТ
//   (в sources не светится, доступен только через twinFor для фоллбэка);
// - native выключен (нет токена, напр. alloha) → skaz-источник видим.
// Каждый файл теста — отдельный процесс, поэтому env задаём до import.
// Важно: статические import'ы хостируются (не запускаются до process.env),
// поэтому registry загружается ДИНАМИЧЕСКИ после установки env.
process.env.SKAZ_ENABLED = 'true';
process.env.SKAZ_ACCOUNT_EMAIL = 'probe@maniya.test';
process.env.SKAZ_UID = 'probe-uid';
process.env.SKAZ_BALANCERS = 'alloha,filmix,rezka,videoseed,hdvb';
process.env.FILMIX_ENABLED = 'true';
process.env.REZKA_ENABLED = 'true';
process.env.ALLOHA_ENABLED = 'true'; // но без токена → native выключен
process.env.ALLOHA_TOKEN = '';
process.env.HDVB_ENABLED = 'true';
process.env.HDVB_TOKEN = 'probe-token'; // токен → native hdvb включён (как в prod)

import test from 'node:test';
import assert from 'node:assert/strict';

// ВСЕ импорты локальных модулей — ДИНАМИЧЕСКИЕ (после установки env): статический
// import SkazProvider hoists config.js до строк env → account пустой → enabled()=false.
const { registeredProviders, providerById, twinFor, allProviders } = await import('../src/providers/registry.js');
const { getVideoForRequest } = await import('../src/store.js');
const { SkazProvider } = await import('../src/providers/skaz/SkazProvider.js');

test('twinFor: скрытый skaz-близнец существует для включённого native', () => {
  const twin = twinFor('filmix');
  assert.ok(twin, 'твин filmix должен существовать');
  assert.equal(twin.id, 'skaz-filmix');
  assert.equal(twin.hiddenTwinNative, 'filmix');
  assert.equal(twin.show, false, 'твин не светится в sources');
  assert.ok(twin instanceof SkazProvider, 'твин — SkazProvider');

  const rezkaTwin = twinFor('rezka');
  assert.ok(rezkaTwin);
  assert.equal(rezkaTwin.id, 'skaz-rezka');

  const hdvbTwin = twinFor('hdvb');
  assert.ok(hdvbTwin, 'твин hdvb должен существовать (native с токеном)');
  assert.equal(hdvbTwin.id, 'skaz-hdvb');
  assert.equal(hdvbTwin.show, false);
});

test('в реестре НЕТ дублей: native-дубли не появляются как skaz', () => {
  const ids = registeredProviders().map((p) => p.id);
  assert.ok(ids.includes('filmix'), 'native filmix виден');
  assert.ok(ids.includes('rezka'), 'native rezka виден');
  assert.ok(!ids.includes('skaz-filmix'), 'skaz-filmix НЕ в списке (дубль)');
  assert.ok(!ids.includes('skaz-rezka'), 'skaz-rezka НЕ в списке (дубль)');
  assert.equal(new Set(ids).size, ids.length, 'все id уникальны');
});

test('native выключен (нет токена) → skaz-источник ВИДЕН', () => {
  const alloha = providerById('skaz-alloha');
  assert.ok(alloha, 'alloha без токена отдаётся через skaz');
  assert.equal(alloha.show, true);
  assert.equal(twinFor('alloha'), null, 'нативного alloha нет — твин не нужен');
});

test('twinFor неизвестного id → null', () => {
  assert.equal(twinFor('ne-so-suschestvuet'), null);
});

// РЕГРЕССИЯ (2026-08-11): lazy movieVideos отдаёт call items от СКРЫТОГО близнеца
// (url → /api/lampa/video?provider=skaz-<balancer>), но getVideoForRequest искал
// только по registeredProviders() (видимые) → Play падал 404 video_not_found.
test('allProviders: включает скрытые skaz-близнецы (ленивый резолв call items)', () => {
  const ids = allProviders().map((p) => p.id);
  assert.ok(ids.includes('skaz-rezka'), 'скрытый skaz-rezka доступен для резолва');
  assert.ok(ids.includes('skaz-filmix'), 'скрытый skaz-filmix доступен');
  assert.ok(ids.includes('skaz-hdvb'), 'скрытый skaz-hdvb доступен');
  assert.ok(ids.includes('skaz-alloha'), 'видимый skaz-alloha тоже в списке');
  assert.ok(ids.includes('rezka'), 'native rezka на месте');
});

test('getVideoForRequest: находит СКРЫТЫЙ близнец по provider=skaz-rezka (не 404)', async () => {
  const twin = allProviders().find((p) => p.id === 'skaz-rezka');
  assert.ok(twin, 'скрытый skaz-rezka должен существовать');
  assert.equal(twin.show, false, 'в sources не светится, но резолвится');
  twin.resolveVideo = async () => ({ method: 'play', url: 'http://stub/play.m3u8', quality: {} });
  const item = await getVideoForRequest({ query: { provider: 'skaz-rezka', title: 'Spider-Man' } });
  assert.ok(item, 'call-карточка скрытого близнеца резолвится (до фикса — null → 404)');
  assert.equal(item.method, 'play');
});

test('getVideoForRequest: provider без resolveVideo → null (поведение не изменилось)', async () => {
  const item = await getVideoForRequest({ query: { provider: 'cdnvideohub' } });
  assert.equal(item, null);
});