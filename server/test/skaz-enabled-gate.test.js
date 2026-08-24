// SKAZ-MANIYA-004 P0: мастера-выключатель SKAZ_ENABLED.
// Регрессия: раньше SkazClient.enabled() гейтил только creds (balancer +
// accountEmail + uid), поэтому SKAZ_ENABLED=0 НЕ отключал skaz-провайдеров —
// они оставались enabled() и светились в /sources даже при выключенном кластере.
// Фикс: SkazProvider.enabled() уважает config.skaz.enabled.
process.env.SKAZ_ENABLED = '0';
process.env.SKAZ_ACCOUNT_EMAIL = 'probe@maniya.test';
process.env.SKAZ_UID = 'probe-uid';
process.env.SKAZ_BALANCERS = 'alloha,videoseed,kinopub,hdvb,kodik,rezka,filmix';

import test from 'node:test';
import assert from 'node:assert/strict';

// Динамический import после установки env (как registry-twin.test.js): статический
// import хостит config.js ДО process.env, и enabled() не увидел бы SKAZ_ENABLED=0.
const { registeredProviders, allProviders, providerById } = await import('../src/providers/registry.js');

test('SKAZ_ENABLED=0 → все skaz-провайдеры disabled (даже при заданных creds)', () => {
  const skaz = allProviders().filter((p) => String(p.id).startsWith('skaz-'));
  assert.ok(skaz.length > 0, 'в тестовом наборе есть skaz-провайдеры');
  for (const provider of skaz) {
    assert.equal(provider.enabled(), false, `${provider.id} должен быть disabled при SKAZ_ENABLED=0`);
  }
});

test('SKAZ_ENABLED=0 → availability/маршруты исключают skaz через enabled() (гейт на call-site)', () => {
  // registeredProviders() = сырой реестр (фильтр по show), а enabled()-фильтр
  // применяется В НАШИХ call-site'ах: availability.resolveSources() и
  // /api/lampa/videos делают .filter(p => p.enabled()). Поэтому реестр может
  // содержать skaz-строки, НО все они enabled()=false → не светятся в /sources
  // и не пробиваются в карточку availability.
  const skaz = registeredProviders().filter((p) => String(p.id).startsWith('skaz-'));
  for (const provider of skaz) {
    assert.equal(provider.enabled(), false, `${provider.id} disabled при SKAZ_ENABLED=0 (гейт на call-site)`);
  }
});

test('SKAZ_ENABLED=0 → native-источники (без токена) не подменяются skaz и disabled', () => {
  // alloha без токена: и native, и skaz должны быть недоступны при выключенном кластере
  const allohaNative = providerById('alloha');
  const allohaSkaz = providerById('skaz-alloha');
  if (allohaNative) assert.equal(allohaNative.enabled(), false, 'native alloha disabled (кластер выключен)');
  if (allohaSkaz) assert.equal(allohaSkaz.enabled(), false, 'skaz-alloha disabled при SKAZ_ENABLED=0');
});
