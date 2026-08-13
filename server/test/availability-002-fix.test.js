// NATIVE-AVAILABILITY-002: точечные правки RULE-2/RULE-3/RULE-4.
//   RULE-2  accsdb «Ожидаем фильм в хорошем качестве...» → authoritative «нет»;
//           прочие accsdb («Войдите в аккаунт») — вердикта нет → показ.
//   RULE-3  native без карточного ключа (cdnvideohub: key только kinopoisk_id, которого в
//           реальном Lampa-запросе нет) → authoritative «нет», не вечный inconclusive-show.
//   RULE-4  (на уровне card() покрыто в availability.test.js: инконклюзивное подтверждение
//           не переворачивает первичное «нет»; смешанный вердикт → показ — там же).
// Env до import (паттерн availability.test.js): skaz ВКЛ (alloha), cdnvideohub native ВКЛ
// (без твина — проба через nativeProbe), остальные выключены.
process.env.NODE_ENV = 'test';
process.env.SKAZ_ENABLED = '1';
process.env.SKAZ_ACCOUNT_EMAIL = 'user@example.com';
process.env.SKAZ_UID = 'abc123';
process.env.SKAZ_BALANCERS = 'alloha';
process.env.SKAZ_HOSTS = 'http://h1,http://h2';
process.env.SKAZ_CHECK_TIMEOUT_MS = '200';
process.env.FILMIX_ENABLED = '0';
process.env.REZKA_ENABLED = '0';
process.env.KODIK_ENABLED = '0';
process.env.ALLOHA_ENABLED = '0';
process.env.RUTUBEMOVIE_ENABLED = '0';
process.env.CDNVIDEOHUB_ENABLED = '1';
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

function byId(result, id) {
  return result.sources.find((s) => s.id === id);
}

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

// ===== RULE-2: accsdb-шаблон «Ожидаем фильм» = «контента пока нет» =====

test('checkBalancer (RULE-2): «Ожидаем фильм в хорошем качестве...» → authoritative «нет»', async () => {
  const checker = makeChecker(() => Promise.resolve(response(200, '{"accsdb":true,"msg":"Ожидаем фильм в хорошем качестве..."}')));
  const row = await checker.checkBalancer('alloha', QUERY, Date.now() + 10_000);
  assert.equal(row.show, false, 'шаблон = кластер честно сообщил «контента пока нет»');
  assert.equal(row.authoritative, true, 'authoritative «нет», не inconclusive');
});

test('checkBalancer (RULE-2): шаблон в escaped-unicode (uXXXX-escape) → hide (реальные тела кластера)', async () => {
  // Кластер (online3/94.249.239.*) отдаёт msg в JSON-escape: "Ожидаем фильм..." =
  // Ожидаем ... Regex по сырому телу их не видит —
  // декодируем msg из JSON перед проверкой. Иначе rezka/rhsprem «Одиссея» не скрылись бы.
  const body = '{"accsdb":true,"msg":"\\u041E\\u0436\\u0438\\u0434\\u0430\\u0435\\u043C \\u0444\\u0438\\u043B\\u044C\\u043C \\u0432 \\u0445\\u043E\\u0440\\u043E\\u0448\\u0435\\u043C \\u043A\\u0430\\u0447\\u0435\\u0441\\u0442\\u0432\\u0435..."}';
  const checker = makeChecker(() => Promise.resolve(response(200, body)));
  const row = await checker.checkBalancer('alloha', QUERY, Date.now() + 10_000);
  assert.equal(row.show, false, 'escaped-unicode шаблон = «контента пока нет»');
  assert.equal(row.authoritative, true);
});

test('checkBalancer (RULE-2): прочие accsdb («Войдите в аккаунт») — вердикта нет → show', async () => {
  const checker = makeChecker(() => Promise.resolve(response(200, '{"accsdb":true,"msg":"Войдите в аккаунт Настройки - Синхронизация"}')));
  const row = await checker.checkBalancer('alloha', QUERY, Date.now() + 10_000);
  assert.equal(row.show, true, 'отказ учётной записи не доказывает отсутствия контента');
  assert.equal(row.inconclusive, true);
  assert.equal(row.accsdb, true);
});

test('card (RULE-2): все хосты «Ожидаем фильм» → hide (двойное подтверждение)', async () => {
  const checker = makeChecker(() => Promise.resolve(response(200, '{"accsdb":true,"msg":"Ожидаем фильм в хорошем качестве..."}')));
  const result = await checker.card(QUERY, 'uid-1');
  const row = byId(result, 'skaz-alloha');
  assert.ok(row, 'skaz-alloha в карточке');
  assert.equal(row.show, false, 'шаблон на всех хостах → hide');
  assert.equal(row.confirmed, true, 'прошёл подтверждение');
});

// ===== RULE-3: cdnvideohub без kinopoisk_id = authoritative «нет» =====

test('card (RULE-3): cdnvideohub без kinopoisk_id (реальный Lampa-запрос) → authoritative «нет»', async () => {
  const checker = makeChecker(() => Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>')));
  const result = await checker.card(QUERY, 'uid-1');
  const row = byId(result, 'cdnvideohub');
  assert.ok(row, 'cdnvideohub в карточке (native без твина → nativeProbe)');
  assert.equal(row.show, false, 'без kp провайдер не может дать контент → «нет» (не вечный show:true)');
  assert.equal(row.authoritative, true, 'authoritative, не inconclusive');
  assert.equal(row.confirmed, true, 'двойная native-проба (нет + повтор нет)');
});

test('card (RULE-3): cdnvideohub БЕЗ kp не маскирует наличие контента у других источников', async () => {
  const seen = [];
  const checker = makeChecker((url) => {
    seen.push(String(url));
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  });
  const result = await checker.card(QUERY, 'uid-1');
  assert.equal(byId(result, 'skaz-alloha').show, true, 'skaz-источник виден');
  assert.equal(byId(result, 'cdnvideohub').show, false, 'cdnvideohub — «нет» без kp');
});
