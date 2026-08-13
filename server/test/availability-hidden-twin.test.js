// BALANCER-002 POST-DEPLOY + TRUSTED_ALWAYS_VISIBLE: ЕДИНЫЙ per-card availability для
// native + skaz + СКРЫТЫХ твинов (docs/balancer-002-postdeploy-report.md §7) с
// provider-specific исключением: filmix — TRUSTED_ALWAYS_VISIBLE (всегда show:true,
// docs/balancer-002-trusted-always-visible-report.md). «native всегда show:true»
// УБРАНО для всех остальных: native с hidden twin проверяется через twin-балансер
// (skaz-checksearch), native без твина — native search-level probe. Env до
// динамического import (как registry-twin).
process.env.NODE_ENV = 'test';
process.env.SKAZ_ENABLED = '1';
process.env.SKAZ_ACCOUNT_EMAIL = 'user@example.com';
process.env.SKAZ_UID = 'abc123';
process.env.SKAZ_BALANCERS = 'alloha,filmix,rezka';
process.env.SKAZ_HOSTS = 'http://h1,http://h2';
process.env.SKAZ_CHECK_TIMEOUT_MS = '200';
process.env.FILMIX_ENABLED = '1'; // native filmix включён → skaz-filmix скрытый близнец
process.env.REZKA_ENABLED = '1'; // native rezka включён → skaz-rezka скрытый близнец (не-trusted)
process.env.KODIK_ENABLED = '0';
process.env.ALLOHA_ENABLED = '0';
process.env.RUTUBEMOVIE_ENABLED = '0';
process.env.CDNVIDEOHUB_ENABLED = '0';
process.env.COLLAPS_ENABLED = '0';
process.env.HDVB_ENABLED = '0';

import test from 'node:test';
import assert from 'node:assert/strict';

const { createAvailabilityChecker, nativeProbe, isTrustedAlwaysVisible, TRUSTED_ALWAYS_VISIBLE } = await import('../src/availability.js');

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

const FUTURE_DEADLINE = Date.now() + 60_000;

// ===== TRUSTED_ALWAYS_VISIBLE: filmix всегда show:true (provider-specific policy) =====

test('TRUSTED_ALWAYS_VISIBLE: filmix всегда show:true при «нет» кластера; lite/filmix не дёргается', async () => {
  const seen = [];
  const checker = createAvailabilityChecker({
    hosts: ['http://h1', 'http://h2'],
    accountEmail: 'user@example.com',
    uid: 'abc123',
    backoffMs: 5,
    fetchImpl: fakeFetch((url) => {
      seen.push(String(url));
      return Promise.resolve(response(200, 'null')); // кластер отвечает «нет» всему
    })
  });

  const result = await checker.card({ id: '13', serial: 0 }, 'uid-1');
  const ids = result.sources.map((s) => s.id);
  const filmix = byId(result, 'filmix');

  assert.ok(ids.includes('filmix'), 'native filmix в списке');
  assert.equal(filmix.show, true, 'trusted → show:true даже когда probe вернул бы false');
  assert.equal(filmix.trusted, true, 'политика помечена trusted в ответе');
  assert.equal(filmix.native, true);
  assert.equal(filmix.authoritative, true);
  assert.ok(!ids.includes('skaz-filmix'), 'скрытый близнец НЕ дублирует native в ответе');
  assert.ok(
    !seen.some((u) => balancerOf(u) === 'filmix'),
    'lite/filmix НЕ запрашивается — trusted-источник не проходит per-card пробу'
  );
});

test('TRUSTED_ALWAYS_VISIBLE: filmix остаётся видимым при недостоверном сигнале (inconclusive/сеть)', async () => {
  const seen = [];
  const checker = createAvailabilityChecker({
    hosts: ['http://h1', 'http://h2'],
    accountEmail: 'user@example.com',
    uid: 'abc123',
    fetchImpl: fakeFetch((url) => {
      seen.push(String(url));
      return Promise.reject(new Error('ECONNRESET')); // ответа НЕТ → inconclusive для остальных
    })
  });

  const result = await checker.card({ id: '13', serial: 0 }, 'uid-1');
  const filmix = byId(result, 'filmix');
  assert.equal(filmix.show, true, 'trusted → show:true при inconclusive-сигнале');
  assert.equal(filmix.trusted, true);
  assert.ok(!seen.some((u) => balancerOf(u) === 'filmix'), 'filmix не пробируется');
});

test('TRUSTED_ALWAYS_VISIBLE: filmix в наборе, остальные провайдеры НЕ входят (нет исключений без доказательства)', () => {
  assert.equal(TRUSTED_ALWAYS_VISIBLE.size, 2, 'только filmix + его skaz-форма');
  assert.equal(isTrustedAlwaysVisible('filmix'), true);
  assert.equal(isTrustedAlwaysVisible('skaz-filmix'), true, 'та же политика для видимой skaz-формы');
  // Остальные провайдеры — НЕ trusted: каждому исключение нужно отдельное доказательство.
  for (const id of ['rezka', 'kodik', 'rutubemovie', 'cdnvideohub', 'collaps', 'hdvb', 'skaz-alloha', 'skaz-rezka', '']) {
    assert.equal(isTrustedAlwaysVisible(id), false, `${id} не подпадает под политику`);
  }
  assert.equal(isTrustedAlwaysVisible(undefined), false);
});

// ===== card: native-с-твином (НЕ-trusted) проверяется ЧЕРЕЗ твин =====

test('card: native rezka проверяется через скрытый твин skaz-rezka; твин не дублируется', async () => {
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

  assert.ok(ids.includes('rezka'), 'native rezka виден');
  const rezka = byId(result, 'rezka');
  assert.equal(rezka.show, true, 'твин-кластер нашёл карточку → native видим');
  assert.equal(rezka.native, true);
  assert.equal(rezka.twinBalancer, 'rezka', 'доступность решает twin skaz-rezka');
  assert.ok(!ids.includes('skaz-rezka'), 'скрытый близнец НЕ дублирует native в ответе');
  assert.ok(ids.includes('skaz-alloha'), 'видимый skaz-alloha проверяется');
  assert.ok(byId(result, 'skaz-alloha').show, true);
  // Ключевое отличие от старого «native всегда show:true»: lite/rezka ЗАПРАШИВАЕТСЯ
  // (checksearch твина) для не-trusted native.
  assert.ok(
    seen.some((u) => balancerOf(u) === 'rezka'),
    'lite/rezka дёргается как twin-проверка native rezka'
  );
});

// ===== card: twin «нет» → не-trusted native скрыт (подтверждённый absent) =====

test('card: native rezka скрывается, когда twin-кластер ОТВЕЧАЕТ «нет» (double signal)', async () => {
  const seen = [];
  const checker = createAvailabilityChecker({
    hosts: ['http://h1', 'http://h2'],
    accountEmail: 'user@example.com',
    uid: 'abc123',
    backoffMs: 5,
    fetchImpl: fakeFetch((url) => {
      seen.push(String(url));
      return Promise.resolve(response(200, 'null'));
    })
  });

  const result = await checker.card({ id: '999', serial: 0 }, 'uid-1');
  const rezka = byId(result, 'rezka');
  assert.equal(rezka.show, false, '«нет» от твин-checksearch + прямой lite-page → скрыт');
  assert.equal(rezka.confirmed, true, 'подтверждено вторым сигналом (confirmAbsence)');
  assert.equal(rezka.twinBalancer, 'rezka', 'доступность решает twin skaz-rezka');
  assert.ok(
    seen.some((u) => balancerOf(u) === 'rezka'),
    'lite/rezka дёргается как twin-проверка native rezka'
  );
});

// ===== native probe: cdnvideohub =====

function cdnStub(playlistImpl) {
  return { id: 'cdnvideohub', client: { playlist: playlistImpl } };
}

test('nativeProbe cdnvideohub: без kp → authoritative «нет» (RULE-3)', async () => {
  const probe = cdnStub(async () => { throw new Error('не должен дёргаться без kp'); });
  const v = await nativeProbe(probe, { title: 'Форрест Гамп' }, {}, FUTURE_DEADLINE);
  assert.equal(v.show, false);
  assert.equal(v.authoritative, true);
  assert.equal(v.reason, 'no-key');
});

test('nativeProbe cdnvideohub: kp + контент → show', async () => {
  const probe = cdnStub(async () => ({ titleName: 'X', isSerial: false, items: [{ vkId: '1' }] }));
  const v = await nativeProbe(probe, { kinopoisk_id: 448 }, {}, FUTURE_DEADLINE);
  assert.equal(v.show, true);
  assert.equal(v.authoritative, true);
  assert.equal(v.reason, 'found');
});

test('nativeProbe cdnvideohub: kp + пустой playlist → «нет» (show:false)', async () => {
  const probe = cdnStub(async () => ({ titleName: 'X', items: [] }));
  const v = await nativeProbe(probe, { kinopoisk_id: 448 }, {}, FUTURE_DEADLINE);
  assert.equal(v.show, false);
  assert.equal(v.authoritative, true);
  assert.equal(v.reason, 'absent');
});

test('nativeProbe cdnvideohub: сеть/HTTP-ошибка → inconclusive (show)', async () => {
  const probe = cdnStub(async () => { throw new Error('ECONNRESET'); });
  const v = await nativeProbe(probe, { kinopoisk_id: 448 }, {}, FUTURE_DEADLINE);
  assert.equal(v.show, true);
  assert.equal(v.inconclusive, true);
  assert.equal(v.reason, 'error');
});

// ===== native probe: collaps =====

function collapsStub({ record = null, searchResults = [] } = {}) {
  return {
    id: 'collaps',
    recordByKeys: async () => record,
    client: { search: async () => ({ results: searchResults }) }
  };
}

test('nativeProbe collaps: без ключей и без названия → inconclusive (show)', async () => {
  const probe = collapsStub({ record: null });
  const v = await nativeProbe(probe, {}, {}, FUTURE_DEADLINE);
  assert.equal(v.show, true);
  assert.equal(v.inconclusive, true);
  assert.equal(v.reason, 'no-key');
});

test('nativeProbe collaps: kp + запись есть → show', async () => {
  const probe = collapsStub({ record: { provider: 'collaps', type: 'movie' } });
  const v = await nativeProbe(probe, { kinopoisk_id: 448, imdb_id: 'tt0109830' }, {}, FUTURE_DEADLINE);
  assert.equal(v.show, true);
  assert.equal(v.reason, 'found');
});

test('nativeProbe collaps: kp + embed пуст → «нет» (show:false)', async () => {
  const probe = collapsStub({ record: null });
  const v = await nativeProbe(probe, { kinopoisk_id: 448, imdb_id: 'tt0109830' }, {}, FUTURE_DEADLINE);
  assert.equal(v.show, false);
  assert.equal(v.authoritative, true);
  assert.equal(v.reason, 'absent');
});

test('nativeProbe collaps: recordByKeys бросает (сеть) → inconclusive (show)', async () => {
  const probe = {
    id: 'collaps',
    recordByKeys: async () => { throw new Error('HTTP 403'); },
    client: { search: async () => [] }
  };
  const v = await nativeProbe(probe, { imdb_id: 'tt0109830' }, {}, FUTURE_DEADLINE);
  assert.equal(v.show, true);
  assert.equal(v.inconclusive, true);
  assert.equal(v.reason, 'error');
});

test('nativeProbe collaps: только название + результаты → show; пусто → «нет»', async () => {
  const found = collapsStub({ searchResults: [{ id: 1, name: 'X' }] });
  const v1 = await nativeProbe(found, { title: 'Форрест Гамп' }, {}, FUTURE_DEADLINE);
  assert.equal(v1.show, true);
  assert.equal(v1.reason, 'found');

  const empty = collapsStub({ searchResults: [] });
  const v2 = await nativeProbe(empty, { title: 'Форрест Гамп' }, {}, FUTURE_DEADLINE);
  assert.equal(v2.show, false);
  assert.equal(v2.reason, 'absent');
});

test('nativeProbe: таймаут по дедлайну → inconclusive (show)', async () => {
  const probe = cdnStub(() => new Promise((resolve) => setTimeout(() => resolve({ items: [{ vkId: '1' }] }), 500)));
  const v = await nativeProbe(probe, { kinopoisk_id: 448 }, {}, Date.now() + 50);
  assert.equal(v.show, true);
  assert.equal(v.inconclusive, true);
  assert.equal(v.reason, 'error');
});
