// BALANCER-002: регистрация skaz-балансеров в registry.
// Дефолтный список балансеров — из config.js (НЕ переопределяем SKAZ_BALANCERS):
// тест проверяет ПРОДУКТОВЫЙ состав (что зарегистрировано по умолчанию и что
// зарезервировано/исключено). Каждый файл теста — отдельный процесс, env до import.
process.env.SKAZ_ENABLED = 'true';
process.env.SKAZ_ACCOUNT_EMAIL = 'probe@maniya.test';
process.env.SKAZ_UID = 'probe-uid';
process.env.FILMIX_ENABLED = 'true';
process.env.REZKA_ENABLED = 'true';
process.env.ALLOHA_ENABLED = 'true';
process.env.ALLOHA_TOKEN = '';
process.env.KODIK_ENABLED = 'true';

import test from 'node:test';
import assert from 'node:assert/strict';

const { config } = await import('../src/config.js');
const { registeredProviders, providerById, allProviders } = await import('../src/providers/registry.js');
const { SkazProvider } = await import('../src/providers/skaz/SkazProvider.js');

// Видимые skaz-балансеры (без native-дублей): реестр Maniya.
const VISIBLE_SKAZ = ['alloha', 'videoseed', 'kinopub', 'kinoflix', 'veoveo', 'pidtor', 'solntse', 'geosaitebi', 'rhsprem'];

// rch-reserved (WebSocket-only, Maniya REST не играет): НЕ в дефолтном списке.
const RCH_RESERVED = ['remux', 'kinotochka', 'ashdi', 'kinoukr', 'eneyida'];
// Мёртвые в live-универсуме lite/events (BALANCER-002 аудит): НЕ в дефолтном списке.
const DEAD_BALANCERS = ['kinobase', 'videocdn', 'lumex', 'zagonka'];

test('BALANCER-002: rch-reserved и мёртвые слаги НЕ в дефолтном списке балансеров', () => {
  const balancers = config.skaz.balancers;
  for (const slug of [...RCH_RESERVED, ...DEAD_BALANCERS]) {
    assert.ok(!balancers.includes(slug), `${slug} — зарезервирован/исключён, в дефолт НЕ входит`);
  }
  for (const slug of VISIBLE_SKAZ) {
    assert.ok(balancers.includes(slug), `${slug} — в дефолтном списке`);
  }
  assert.ok(balancers.includes('rhsprem'), 'rhsprem добавлен (BALANCER-002)');
});

test('BALANCER-002: каждый видимый skaz-балансер зарегистрирован как SkazProvider', () => {
  for (const slug of VISIBLE_SKAZ) {
    const provider = providerById(`skaz-${slug}`);
    assert.ok(provider, `skaz-${slug} — зарегистрирован`);
    assert.ok(provider instanceof SkazProvider, `skaz-${slug} — SkazProvider`);
    assert.equal(provider.show, true, `skaz-${slug} — видим (нет native-дубля)`);
    assert.ok(provider.enabled(), `skaz-${slug} — enabled`);
  }
});

test('BALANCER-002: remux/kinotochka не регистрируются (rch-reserved — не светятся в UI)', () => {
  for (const slug of RCH_RESERVED) {
    assert.equal(providerById(`skaz-${slug}`), null, `skaz-${slug} — НЕ зарегистрирован (rch-reserved)`);
  }
});

test('BALANCER-002: native-дубли скрыты (twin) — skaz-filmix/skaz-rezka только в allProviders', () => {
  assert.ok(providerById('skaz-alloha'), 'alloha на месте (native выключен по токену)');
  const registered = registeredProviders().map(p => p.id);
  const all = allProviders().map(p => p.id);
  assert.ok(!registered.includes('skaz-filmix'), 'skaz-filmix скрыт (native filmix включён)');
  assert.ok(!registered.includes('skaz-rezka'), 'skaz-rezka скрыт (native rezka включён)');
  assert.ok(all.includes('skaz-filmix'), 'skaz-filmix в allProviders (twin, ленивый резолв)');
  assert.ok(all.includes('skaz-rezka'), 'skaz-rezka в allProviders (twin)');
});

test('BALANCER-002: нет дублей id в registeredProviders', () => {
  const ids = registeredProviders().map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'все id уникальны');
});

test('BALANCER-002: rhsprem — правильный id/title/videos', () => {
  const provider = providerById('skaz-rhsprem');
  assert.equal(provider.id, 'skaz-rhsprem');
  assert.equal(provider.title, 'Maniya · HDRezka 4K');
  assert.equal(typeof provider.videos, 'function', 'videos — метод');
});
