// I3: 5 новых SKAZ-balancer'ов — регистрация в registry без новой архитектуры.
// Каждый файл теста — отдельный процесс, поэтому env задаём до import.
process.env.SKAZ_ENABLED = 'true';
process.env.SKAZ_ACCOUNT_EMAIL = 'probe@maniya.test';
process.env.SKAZ_UID = 'probe-uid';
process.env.SKAZ_BALANCERS = 'alloha,filmix,rezka,kinobase,remux,videocdn,lumex,kinotochka';
process.env.FILMIX_ENABLED = 'true';
process.env.REZKA_ENABLED = 'true';
process.env.ALLOHA_ENABLED = 'true';
process.env.ALLOHA_TOKEN = '';
process.env.KODIK_ENABLED = 'false';

import test from 'node:test';
import assert from 'node:assert/strict';

const { registeredProviders, providerById, allProviders } = await import('../src/providers/registry.js');
const { SkazProvider } = await import('../src/providers/skaz/SkazProvider.js');

const NEW_BALANCERS = ['kinobase', 'remux', 'videocdn', 'lumex', 'kinotochka'];

test('I3: все 5 новых balancer\'ов регистрируются как SkazProvider', () => {
  for (const slug of NEW_BALANCERS) {
    const provider = providerById(`skaz-${slug}`);
    assert.ok(provider, `skaz-${slug} — зарегистрирован`);
    assert.ok(provider instanceof SkazProvider, `skaz-${slug} — SkazProvider`);
    assert.equal(provider.show, true, `skaz-${slug} — видим (нет native-дубля)`);
    assert.ok(provider.enabled(), `skaz-${slug} — enabled`);
  }
});

test('I3: новые balancer\'ы в registeredProviders', () => {
  const ids = registeredProviders().map(p => p.id);
  for (const slug of NEW_BALANCERS) {
    assert.ok(ids.includes(`skaz-${slug}`), `skaz-${slug} в registeredProviders()`);
  }
});

test('I3: новые balancer\'ы в allProviders (ленивый резолв)', () => {
  const ids = allProviders().map(p => p.id);
  for (const slug of NEW_BALANCERS) {
    assert.ok(ids.includes(`skaz-${slug}`), `skaz-${slug} в allProviders()`);
  }
});

test('I3: старые balancer\'ы не изменились', () => {
  assert.ok(providerById('skaz-alloha'), 'alloha на месте (видимый, native выключен)');
  // rezka — native включён → skaz-rezka скрыт (twin), только в allProviders
  const allIds = allProviders().map(p => p.id);
  assert.ok(allIds.includes('skaz-rezka'), 'skaz-rezka в allProviders (twin)');
  assert.ok(allIds.includes('skaz-filmix'), 'skaz-filmix в allProviders (twin)');
});

test('I3: нет дублей id', () => {
  const ids = registeredProviders().map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'все id уникальны');
});

test('I3: каждый новый balancer имеет правильный id и title', () => {
  for (const slug of NEW_BALANCERS) {
    const provider = providerById(`skaz-${slug}`);
    assert.equal(provider.id, `skaz-${slug}`);
    assert.ok(provider.title, `title не пуст для ${slug}`);
    assert.equal(typeof provider.videos, 'function', 'videos — метод');
  }
});
