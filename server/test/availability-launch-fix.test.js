// BALANCER-LAUNCH-FIX-001: regression для pinnedHost в availability.js.
// Условия окружения задаём ДО динамического import (cm. availability.test.js).
process.env.NODE_ENV = 'test';
process.env.SKAZ_ENABLED = '1';
process.env.SKAZ_ACCOUNT_EMAIL = 'user@example.com';
process.env.SKAZ_UID = 'abc123';
process.env.SKAZ_BALANCERS = 'alloha,filmix,rezka,kinopub';
process.env.SKAZ_HOSTS = 'http://h1,http://h2';
process.env.SKAZ_CHECK_TIMEOUT_MS = '200';
process.env.FILMIX_ENABLED = '0';
process.env.REZKA_ENABLED = '0';
process.env.KODIK_ENABLED = '0';
process.env.ALLOHA_ENABLED = '0';
process.env.RUTUBEMOVIE_ENABLED = '0';
process.env.CDNVIDEOHUB_ENABLED = '0';
process.env.COLLAPS_ENABLED = '0';
process.env.HDVB_ENABLED = '0';
process.env.KINOTOCHKA_ENABLED = '0';

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

const QUERY = {
  id: '13',
  imdb_id: 'tt0109830',
  title: 'Форрест Гамп',
  original_title: 'Forrest Gump',
  original_language: 'en',
  source: 'tmdb',
  year: 1994,
  serial: 0
};

function makeChecker(handler, options = {}) {
  return createAvailabilityChecker({
    hosts: ['http://h1', 'http://h2'],
    accountEmail: 'user@example.com',
    uid: 'abc123',
    fetchImpl: fakeFetch(handler),
    timeoutMs: 200,
    backoffMs: 0,
    ...options
  });
}

function byId(result, id) {
  return result.sources.find((s) => s.id === id);
}

function withMockedNow(deltaMs, fn) {
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + deltaMs;
    return fn();
  } finally {
    Date.now = originalNow;
  }
}

// ===== Регрессия 1: пин FOUND-ряда НЕ укорачивается из-за скрытия чужого источника =====

test('pinnedHost TTL: FOUND-ряд живёт ttlMs даже когда другой источник скрыт (HIDE_TTL_MS больше не влияет)', async () => {
  const checker = makeChecker((url) => {
    const b = balancerOf(url);
    // alloha — контент только на h2 (FOUND-ряд)
    if (b === 'alloha') {
      return String(url).includes('h2')
        ? Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'))
        : Promise.resolve(response(503, 'disable'));
    }
    // kinopub — подтверждённый HIDE (двойной «нет»)
    if (b === 'kinopub') return Promise.resolve(response(503, 'disable'));
    // rezka — контент
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  }, { ttlMs: 300_000 });

  const first = await checker.card(QUERY, 'uid-1');
  assert.equal(byId(first, 'skaz-alloha').show, true, 'alloha найден на h2');
  assert.equal(byId(first, 'skaz-alloha').authoritative, true, 'alloha — авторитетный FOUND');
  assert.equal(byId(first, 'skaz-kinopub').show, false, 'kinopub скрыт — даёт hasConfirmedHide');

  assert.equal(checker.pinnedHost('skaz-alloha', 'uid-1'), 'http://h2', 'пин записан на h2');

  // Старая логика: pinTtl = HIDE_TTL_MS = 60с — пин умер бы через 60с.
  // Новая логика: pinTtl = ttlMs = 300с — пин жив через 90с.
  withMockedNow(90_000, () => {
    assert.equal(checker.pinnedHost('skaz-alloha', 'uid-1'), 'http://h2', 'pin жив через 90с (больше HIDE_TTL_MS)');
  });
});

// ===== Регрессия 2: cache-hit продлевает пин =====

test('pinnedHost refresh: cache-hit перезаписывает pinnedHost, иначе он устаревает до следующего запуска', async () => {
  let fetches = 0;
  const checker = makeChecker(() => {
    fetches += 1;
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  }, { ttlMs: 300_000 });

  await checker.card(QUERY, 'uid-1');
  assert.equal(checker.pinnedHost('skaz-alloha', 'uid-1'), 'http://h1', 'первый вызов записал pin на h1');

  // Проходим 290с: pin близок к истечению (оригинальный pin истекает через 300с).
  // Пользователь снова открывает карточку — cache-hit должен перезаписать pin.
  withMockedNow(290_000, async () => {
    const second = await checker.card(QUERY, 'uid-1');
    assert.equal(second.cached, true, '290с в пределах ttlMs=300с — cache-hit');
  });

  // Ещё 20с (всего 310с от исходного времени). Без cache-hit refresh pin бы уже истёк (тк. TTL=300с).
  // С refresh (перезапись на 290с) pin действителен до 590с — сейчас 310 < 590.
  withMockedNow(310_000, () => {
    assert.equal(checker.pinnedHost('skaz-alloha', 'uid-1'), 'http://h1', 'cache-hit продлил pin: на 310с он всё ещё валиден');
  });

  assert.equal(fetches, 3, 'только один upstream calc (3 fetch); cache-hit не делает upstream');
});

// ===== Регрессия 3: /videos получает preferred host и избегает полного скана =====

test('pinnedHost usage: после card() /videos получает ноду для первого запроса, а не делает полный 6-хостовой обход', async () => {
  const seen = [];
  const checker = makeChecker((url) => {
    seen.push(String(url));
    const b = balancerOf(url);
    // Первая нода — всегда «нет», вторая — контент
    if (b === 'alloha') {
      return String(url).includes('h2')
        ? Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'))
        : Promise.resolve(response(503, 'disable'));
    }
    if (b === 'kinopub') return Promise.resolve(response(503, 'disable'));
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  }, { ttlMs: 300_000 });

  await checker.card(QUERY, 'uid-1');
  const pin = checker.pinnedHost('skaz-alloha', 'uid-1');
  assert.equal(pin, 'http://h2', '/videos получит preferred host h2 и не пойдёт сначала на h1');

  // availability спрашивала h2 и нашла на нём контент — эта же нода должна быть первой для /videos
  assert.ok(seen.some((u) => balancerOf(u) === 'alloha' && u.includes('h2')), 'availability запрашивала alloha на h2');
});
