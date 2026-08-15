// BALANCER-SEMANTICS-005-W1 (CLUSTER CONSISTENCY) — availability-уровень:
// пин «карточка → /videos» (pinMap + pinnedHost), единый порядок пула
// (orderedSkazHosts) с карточкой и SkazClient. Обязательные тесты §6.2–§6.5.
// Env задаём ДО динамического import (паттерн availability.test.js).
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

import test from 'node:test';
import assert from 'node:assert/strict';

const { createAvailabilityChecker } = await import('../src/availability.js');
const { SkazClient } = await import('../src/providers/skaz/SkazClient.js');
const { orderedSkazHosts, isReserveHost } = await import('../src/providers/skaz/hostOrder.js');

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

function hostOf(url) {
  const match = String(url).match(/^(https?:\/\/[^/]+)/) || [];
  return match[1] || '';
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

const CONTENT_HTML = '<html><div>"type":"movie"</div></html>'; // предикат → work=true (content)

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

// ===== §6.2: порядок пула — online8 последний, карточка == клиент =====

test('W1 order-parity: orderedSkazHosts ставит online8 в КОНЕЦ (даже если он первым вводом)', () => {
  const raw = ['http://online8.skaz.tv', 'http://h1', 'http://h2', 'http://online3.skaz.tv', 'http://h3', 'http://h4'];
  const ordered = orderedSkazHosts(raw);
  assert.deepEqual(ordered, ['http://h1', 'http://h2', 'http://online3.skaz.tv', 'http://h3', 'http://h4', 'http://online8.skaz.tv']);
  assert.ok(isReserveHost(ordered[ordered.length - 1]), 'online8 — резервный, последний');
});

test('W1 order-parity: SkazClient.hosts == orderedSkazHosts(тот же список) — один порядок для /videos', () => {
  const raw = ['http://online8.skaz.tv', 'http://h1', 'http://h2', 'http://online3.skaz.tv', 'http://h3', 'http://h4'];
  const client = new SkazClient({ balancer: 'rezka', hosts: raw, accountEmail: 'e@x', uid: 'u' });
  assert.deepEqual(client.hosts, orderedSkazHosts(raw), 'клиент упорядочивает при конструировании');
  assert.ok(client.hosts[client.hosts.length - 1].includes('online8'), 'online8 — последний кандидат скана');
});

test('W1 order-parity: карточка обходит ноды в ТОМ ЖЕ порядке (online8 последним), host в FOUND-ряду = нода контента', async () => {
  const seen = []; // порядок обхода хостов для rezka
  const checker = makeChecker(
    (url) => {
      const b = balancerOf(url);
      if (b === 'rezka') {
        // контент отвечает ТОЛЬКО online8. При raw-порядке (online8 первый ввод)
        // первым был бы он; при правильном упорядочивании он приходит ПОСЛЕДНИМ.
        seen.push(hostOf(url));
        if (hostOf(url) === 'http://online8.skaz.tv') return Promise.resolve(response(200, CONTENT_HTML));
        return Promise.resolve(response(200, 'null'));
      }
      return Promise.resolve(response(503, 'disable'));
    },
    { hosts: ['http://online8.skaz.tv', 'http://h1', 'http://h2'] }
  );

  const result = await checker.card(QUERY, 'uid-a');
  const row = result.sources.find((s) => s.id === 'skaz-rezka');
  assert.ok(row, 'ряд skaz-rezka присутствует');
  assert.equal(row.show, true, 'резерв дал контент → FOUND');
  assert.equal(row.host, 'http://online8.skaz.tv', 'FOUND-ряд несёт хост ноды контента');
  assert.notEqual(row.trusted, true, 'не trusted-ряд');
  assert.notEqual(row.accsdb, true, 'не accsdb-ряд');
  // обход НЕ raw-порядок (online8 первый) → карточка упорядочила: h1 → h2 → online8.
  assert.deepEqual(seen, ['http://h1', 'http://h2', 'http://online8.skaz.tv'], 'порядок скана карточки = orderedSkazHosts');
});

// ===== §6.3: пин — запись =====

test('W1 pin: authoritative FOUND → pinnedHost возвращает host; другой uid — null', async () => {
  const checker = makeChecker((url) => {
    if (balancerOf(url) === 'rezka' && hostOf(url) === 'http://h1') return Promise.resolve(response(200, CONTENT_HTML));
    return Promise.resolve(response(503, 'disable'));
  });

  await checker.card(QUERY, 'uid-a');
  assert.equal(checker.pinnedHost('skaz-rezka', 'uid-a'), 'http://h1', 'пин = нода контента из authoritative FOUND');
  assert.equal(checker.pinnedHost('skaz-rezka', 'uid-b'), null, 'другой uid — пина нет (uid-скоуп)');
});

test('W1 pin: absent-рекомпут (force) чистит записанный пин', async () => {
  let content = true;
  const checker = makeChecker((url) => {
    const h = hostOf(url);
    if (balancerOf(url) === 'rezka' && content && h === 'http://h1') return Promise.resolve(response(200, CONTENT_HTML));
    return Promise.resolve(response(503, 'disable'));
  });

  await checker.card(QUERY, 'uid-a');
  assert.equal(checker.pinnedHost('skaz-rezka', 'uid-a'), 'http://h1', 'пин записан по FOUND');

  content = false; // контента больше нет → следующий рекомпут даст absent
  await checker.card(QUERY, 'uid-a', true);
  assert.equal(checker.pinnedHost('skaz-rezka', 'uid-a'), null, 'absent-рекомпут чистит пин');
});

test('W1 pin: trusted (filmix) → пина НЕТ (без пробы, host нетипично)', async () => {
  const checker = makeChecker(() => Promise.resolve(response(200, CONTENT_HTML)));
  await checker.card(QUERY, 'uid-a');
  assert.equal(checker.pinnedHost('skaz-filmix', 'uid-a'), null, 'trusted-ряд (без пробы) пина не имеет');
});

test('W1 pin: accsdb-ряд (show:true + accsdb) → пина НЕТ (отказ учётки ≠ нода контента)', async () => {
  const checker = makeChecker(() => Promise.resolve(response(200, '{"accsdb":true,"msg":"Войдите в аккаунт"}')));

  const result = await checker.card(QUERY, 'uid-a');
  const row = result.sources.find((s) => s.id === 'skaz-rezka');
  assert.equal(row.show, true, 'accsdb → optimistic show (вердикта нет)');
  assert.equal(row.accsdb, true, 'ряд помечен accsdb');
  assert.equal(checker.pinnedHost('skaz-rezka', 'uid-a'), null, 'accsdb-ряд не даёт пин');
});

// ===== §6.4: пин — uid-независимость =====

test('W1 pin: разные uid → независимые пины (разные ноды контента)', async () => {
  let contentHost = 'http://h1';
  const checker = makeChecker((url) => {
    const h = hostOf(url);
    if (balancerOf(url) !== 'rezka') return Promise.resolve(response(503, 'disable'));
    if (h === contentHost) return Promise.resolve(response(200, CONTENT_HTML));
    return Promise.resolve(response(200, 'null'));
  });

  await checker.card(QUERY, 'uid-a');
  assert.equal(checker.pinnedHost('skaz-rezka', 'uid-a'), 'http://h1');

  // uid-b «видит» контент на другой ноде (другой granted-устройство).
  contentHost = 'http://h2';
  await checker.card(QUERY, 'uid-b');
  assert.equal(checker.pinnedHost('skaz-rezka', 'uid-b'), 'http://h2');
  assert.equal(checker.pinnedHost('skaz-rezka', 'uid-a'), 'http://h1', 'пин uid-a не затёрт uid-b');
});