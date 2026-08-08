// Реестр: E-Online близнецы native-провайдеров.
// - включённый native (filmix/rezka/hdvb/rutubemovie) → eonline-твин СКРЫТ
//   (в sources не светится, доступен только через twinFor для фолбэка);
// - native выключен (нет токена, напр. alloha) → eonline-источник видим.
// Каждый файл теста — отдельный процесс, поэтому env задаём до import.
process.env.EO_ENABLED = 'true';
process.env.EO_ACCOUNT_EMAIL = 'probe@maniya.test';
process.env.EO_UID = 'probe-uid';
process.env.EO_BALANCERS = 'alloha,filmix,rezka,videoseed';
process.env.FILMIX_ENABLED = 'true';
process.env.REZKA_ENABLED = 'true';
process.env.ALLOHA_ENABLED = 'true'; // но без токена → native выключен
process.env.ALLOHA_TOKEN = '';

import test from 'node:test';
import assert from 'node:assert/strict';
import { registeredProviders, providerById, twinFor } from '../src/providers/registry.js';

test('twinFor: скрытый eonline-близнец существует для включённого native', () => {
  const twin = twinFor('filmix');
  assert.ok(twin, 'твин filmix должен существовать');
  assert.equal(twin.id, 'eonline-filmix');
  assert.equal(twin.hiddenTwinNative, 'filmix');
  assert.equal(twin.show, false, 'твин не светится в sources');

  const rezkaTwin = twinFor('rezka');
  assert.ok(rezkaTwin);
  assert.equal(rezkaTwin.id, 'eonline-rezka');
});

test('в реестре НЕТ дублей: native-дубли не появляются как eonline', () => {
  const ids = registeredProviders().map((p) => p.id);
  assert.ok(ids.includes('filmix'), 'native filmix виден');
  assert.ok(ids.includes('rezka'), 'native rezka виден');
  assert.ok(!ids.includes('eonline-filmix'), 'eonline-filmix НЕ в списке (дубль)');
  assert.ok(!ids.includes('eonline-rezka'), 'eonline-rezka НЕ в списке (дубль)');
  assert.equal(new Set(ids).size, ids.length, 'все id уникальны');
});

test('native выключен (нет токена) → eonline-источник ВИДЕН', () => {
  const alloha = providerById('eonline-alloha');
  assert.ok(alloha, 'alloha без токена отдаётся через eonline');
  assert.equal(alloha.show, true);
  assert.equal(twinFor('alloha'), null, 'нативного alloha нет — твин не нужен');
});

test('twinFor неизвестного id → null', () => {
  assert.equal(twinFor('ne-so-suschestvuet'), null);
});