// BALANCER-002 §9: availability учитывает native + видимые skaz + СКРЫТЫЕ твины.
// Включённый native filmix → skaz-filmix СКРЫТ (в /sources/card НЕ дублирует native),
// а видимый skaz-alloha проверяется. Env до динамического import (как registry-twin).
process.env.NODE_ENV = 'test';
process.env.SKAZ_ENABLED = '1';
process.env.SKAZ_ACCOUNT_EMAIL = 'user@example.com';
process.env.SKAZ_UID = 'abc123';
process.env.SKAZ_BALANCERS = 'alloha,filmix';
process.env.SKAZ_HOSTS = 'http://h1,http://h2';
process.env.SKAZ_CHECK_TIMEOUT_MS = '200';
process.env.FILMIX_ENABLED = '1'; // native filmix включён → skaz-filmix скрытый близнец
process.env.REZKA_ENABLED = '0';
process.env.KODIK_ENABLED = '0';
process.env.ALLOHA_ENABLED = '0';
process.env.RUTUBEMOVIE_ENABLED = '0';
process.env.CDNVIDEOHUB_ENABLED = '0';
process.env.COLLAPS_ENABLED = '0';
process.env.HDVB_ENABLED = '0';

import test from 'node:test';
import assert from 'node:assert/strict';

const { createAvailabilityChecker } = await import('../src/availability.js');

function fakeFetch(handler) {
  return async (url, options = {}) => handler(String(url), options);
}

function response(status, body = '') {
  return {
    status,
    ok: status >= 200 && status < 300,
    url: '',
    headers: {},
    body: { cancel: () => {} },
    text: async () => String(body)
  };
}

function balancerOf(url) {
  const match = String(url).match(/\/lite\/([a-z0-9]+)/);
  return match ? match[1] : '';
}

function byId(result, id) {
  return result.sources.find((s) => s.id === id);
}

test('card: скрытый skaz-filmix НЕ в ответе; native filmix show:true; lite/filmix не дёргается', async () => {
  const seen = [];
  const checker = createAvailabilityChecker({
    hosts: ['http://h1', 'http://h2'],
    accountEmail: 'user@example.com',
    uid: 'abc123',
    fetchImpl: fakeFetch((url) => {
      seen.push(String(url));
      return Promise.resolve(response(200, '<html>data-json={}</html>'));
    })
  });

  const result = await checker.card({ id: '13', serial: 0 }, 'uid-1');
  const ids = result.sources.map((s) => s.id);

  assert.ok(ids.includes('filmix'), 'native filmix виден');
  assert.equal(byId(result, 'filmix').show, true, 'native всегда show:true');
  assert.equal(byId(result, 'filmix').native, true);
  assert.ok(!ids.includes('skaz-filmix'), 'скрытый близнец НЕ дублирует native');
  assert.ok(ids.includes('skaz-alloha'), 'видимый skaz-alloha проверяется');
  assert.ok(byId(result, 'skaz-alloha').show, true);
  assert.ok(
    !seen.some((u) => balancerOf(u) === 'filmix'),
    'lite/filmix не запрашивается — дубль native скрыт'
  );
});
