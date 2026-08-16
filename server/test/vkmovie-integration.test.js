// VKMOVIE-INTEGRATION-001: Skaz-балансер vkmovie в реестре Maniya.
// Дефолтный список balanceов — из config.js (НЕ переопределяем SKAZ_BALANCERS):
// тест проверяет ПРОДУКТОВЫЙ состав. Каждый файл теста — отдельный процесс, env до import.
process.env.SKAZ_ENABLED = 'true';
process.env.SKAZ_ACCOUNT_EMAIL = 'probe@maniya.test';
process.env.SKAZ_UID = 'probe-uid';

import test from 'node:test';
import assert from 'node:assert/strict';

const { config } = await import('../src/config.js');
const { registeredProviders, allProviders, providerById, twinFor } = await import('../src/providers/registry.js');
const { providerMeta } = await import('../src/providers/meta.js');
const { SkazProvider } = await import('../src/providers/skaz/SkazProvider.js');

test('VKMOVIE-001: vkmovie в дефолтном списке балансеров; rutubemovie без изменений; легаси vk/rutube НЕ identity', () => {
  const balancers = config.skaz.balancers;
  assert.ok(balancers.includes('vkmovie'), 'vkmovie — в дефолтном списке');
  assert.ok(balancers.includes('rutubemovie'), 'rutubemovie — остаётся в списке');
  assert.ok(!balancers.includes('vk'), '"vk" (легаси RUS-1) НЕ используется как identity');
  assert.ok(!balancers.includes('rutube'), '"rutube" (легаси RUS-2) НЕ используется как identity');
  assert.ok(!balancers.includes('RUmovie-1'), 'RUmovie-1 — только presentation, НЕ balancer-ID');
});

test('VKMOVIE-001: skaz-vkmovie зарегистрирован (id = vkmovie), видим, enabled', () => {
  const provider = providerById('skaz-vkmovie');
  assert.ok(provider, 'skaz-vkmovie — зарегистрирован');
  assert.ok(provider instanceof SkazProvider, 'skaz-vkmovie — SkazProvider');
  assert.equal(provider.id, 'skaz-vkmovie', 'identity = skaz-vkmovie (НЕ RUmovie-1)');
  assert.equal(provider.balancer, 'vkmovie', 'balancer = vkmovie');
  assert.equal(provider.show, true, 'skaz-vkmovie — видим (vkmovie НЕ имеет native-дубля)');
  assert.ok(provider.enabled(), 'skaz-vkmovie — enabled');
  assert.equal(provider.title, 'Maniya · RUmovie-1', 'display-титул = Maniya · RUmovie-1');
  assert.ok(registeredProviders().map((p) => p.id).includes('skaz-vkmovie'), 'skaz-vkmovie — в видимом реестре');
});

test('VKMOVIE-001: skaz-vkmovie не twin ни одного native; резолв-URL несёт provider=skaz-vkmovie', () => {
  assert.equal(twinFor('vkmovie'), null, '⟦vkmovie — без native-дубля (skaz-vkmovie видимый источник)');
  const provider = providerById('skaz-vkmovie');
  const url = provider.buildResolveUrl({ query: { title: 'Матрица', original_title: 'The Matrix', year: '1999', serial: '0', source: 'tmdb' } });
  assert.ok(url.includes('provider=skaz-vkmovie'), 'резолв-URL — provider=skaz-vkmovie');
  assert.ok(!url.includes('RUmovie-1'), 'RUmovie-1 не попадает во внутренний маршрут');
});

test('VKMOVIE-001: rutubemovie без изменений — остаётся скрытым twin native Rutube', () => {
  const all = allProviders().map((p) => p.id);
  assert.ok(all.includes('skaz-rutubemovie'), 'skaz-rutubemovie — в allProviders (twin)');
  assert.ok(!registeredProviders().map((p) => p.id).includes('skaz-rutubemovie'), 'skaz-rutubemovie — НЕ видим (native Rutube включён)');
  const twin = twinFor('rutubemovie');
  assert.ok(twin && twin.id === 'skaz-rutubemovie', 'twinFor(rutubemovie) = skaz-rutubemovie');
});

test('VKMOVIE-001: meta — display name vkmovie = RUmovie-1; rutubemovie/легаси не тронуты', () => {
  assert.equal(providerMeta('vkmovie').name, 'RUmovie-1', 'vkmovie → RUmovie-1');
  assert.equal(providerMeta('skaz-vkmovie').name, 'RUmovie-1', 'skaz-vkmovie → та же мета');
  assert.equal(providerMeta('vkmovie').icon, '▶️');
  assert.equal(providerMeta('rutubemovie').name, 'Rutube', 'rutubemovie — без изменений');
  assert.equal(providerMeta('vk').name, 'RUS-1', 'легаси vk/RUS-1 — без изменений');
  assert.equal(providerMeta('rutube').name, 'RUS-2', 'легаси rutube/RUS-2 — без изменений');
});