// ===== SKAZ-MANIYA-002: Balancer parity (дифференциальная матрица, §Balancer) =====
//
// Детерминированный тест паритета балансировщика доступности Maniya против
// семантики reference Skaz: «показывать источник только если найден рабочий
// контент». Покрывает критерии матрицы:
//   • мульти-провайдерность (2+ источников видны одновременно);
//   • обработка отказа сервера (503/err → источник скрыт, остальные целы);
//   • movie и serial;
//   • без интермиттентности: идентичные запросы дают идентичный результат.
// Без сети (fetchImpl-инъекция), поэтому детерминировано.
//
// ВАЖНО: `card()` пробивает ВСЕ настроенные balancers (18). Чтобы не затягивать
// slow confirm-scan для INCONCLUSIVE-show рядов, каждый не-тестируемый балансер
// должен немедленно давать контент (data-json) ИЛИ авторитетное «нет» (503).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAvailabilityChecker } from '../src/availability.js';

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
  const m = String(url).match(/\/lite\/([a-z0-9]+)/);
  return m ? m[1] : '';
}
const QUERY = {
  id: '94997',
  imdb_id: 'tt11198330',
  title: 'Дом дракона',
  original_title: 'House of the Dragon',
  original_language: 'en',
  source: 'tmdb',
  year: 2022,
  serial: 1
};
const ALL_BALANCERS = ['alloha','videoseed','kinopub','kinoflix','veoveo','pidtor','solntse','filmix','rezka','hdvb','rutubemovie','vkmovie','kodik','geosaitebi','rhsprem','zetflixdb','zagonka','xvideocdnultra'];
function makeChecker(handler, options = {}) {
  return createAvailabilityChecker({
    hosts: ['http://h1', 'http://h2'],
    accountEmail: 'user@example.com',
    uid: 'abc123',
    fetchImpl: fakeFetch(handler),
    timeoutMs: 200,
    backoffMs: 0,
    deadlineMs: 500, // без жёсткого 10с-дедлайна — тест быстрый
    ...options
  });
}
function byId(result, id) {
  return result.sources.find((s) => s.id === id);
}
// skaz-балансеры в карточке имеют префикс `skaz-` (id: "skaz-videoseed").
function skazId(name) {
  return `skaz-${name}`;
}
// все балансеры, кроме специально поименованных, дают контент (быстро).
function contentHandler(custom = {}) {
  return (url) => {
    const host = String(url).startsWith('h1') ? 'h1' : 'h2';
    const b = balancerOf(url);
    if (custom[b] && custom[b](host)) return Promise.resolve(custom[b](host));
    // дефолт: контент (data-json) → show:true
    return Promise.resolve(response(200, '<html>data-json={"method":"call","s":1}</html>'));
  };
}

// 2+ провайдера с контентом видны одновременно; 3 идентичных запроса → идентичный результат.
test('мульти-провайдер: все с контентом → показаны, без интермиттентности', async () => {
  const checker = makeChecker(contentHandler());
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await checker.card(QUERY, 'uid-parity-1'));
  for (const r of results) {
    // skaz-балансеры БЕЗ native-близнеца видны как skaz-<name>
    for (const name of ['videoseed', 'hdvb', 'kinopub']) {
      const s = byId(r, skazId(name));
      assert.ok(s && s.show === true, `${skazId(name)} show:true (got ${s && s.show})`);
    }
    // rezka/filmix имеют native-близнеца → видна native-строка, show:true
    for (const id of ['rezka', 'filmix']) {
      const s = byId(r, id);
      assert.ok(s && s.show === true, `native ${id} show:true`);
    }
  }
  const key = (r) => r.sources.map((s) => `${s.id}:${s.show}`).join('|');
  assert.equal(key(results[0]), key(results[1]), 'прогон1==прогон2');
  assert.equal(key(results[1]), key(results[2]), 'прогон2==прогон3');
});

// Отказ сервера: 503 на одном провайдере → скрыт, остальные целы.
test('отказ сервера: 503 на одном провайдере → только он скрыт, остальные show:true', async () => {
  const h = contentHandler({ kinopub: () => response(503, 'disable') });
  const checker = makeChecker(h);
  const r = await checker.card(QUERY, 'uid-parity-2');
  assert.equal(byId(r, skazId('kinopub')).show, false, '503 → kinopub скрыт');
  assert.equal(byId(r, skazId('videoseed')).show, true, 'skaz-videoseed виден');
  assert.equal(byId(r, skazId('hdvb')).show, true, 'skaz-hdvb виден');
});

// Отказ h1: хост-лидер 503, h2 отвечает контентом → источник виден (ring-fallback).
test('отказ сервера: h1 503 на все балансеры, h2 контент → источники видны (ring-fallback)', async () => {
  const h = (url) => {
    if (String(url).startsWith('h1')) return Promise.resolve(response(503, 'disable'));
    return Promise.resolve(response(200, '<html>data-json={"method":"call","s":1}</html>'));
  };
  const checker = makeChecker(h);
  const r = await checker.card(QUERY, 'uid-parity-3');
  assert.equal(byId(r, skazId('videoseed')).show, true, 'skaz-videoseed виден через h2');
  assert.equal(byId(r, skazId('kinopub')).show, true, 'на h2 контент есть');
});

// Провайдер отдаёт авторитетное «нет» (503) → скрыт; контентный — виден (movie).
test('movie: провайдер «нет» (503) → скрыт; контентный виден', async () => {
  const h = contentHandler({ pidtor: () => response(503, 'disable') });
  const movieQuery = { ...QUERY, serial: 0, id: '13', imdb_id: 'tt0109830', title: 'Форрест Гамп', year: 1994 };
  const checker = makeChecker(h);
  const r = await checker.card(movieQuery, 'uid-parity-4');
  const pt = byId(r, skazId('pidtor'));
  assert.ok(pt, `skaz-pidtor присутствует в карточке`); // показывается, но show=false
  assert.equal(pt.show, false, '503 → skaz-pidtor show:false');
  assert.equal(byId(r, skazId('videoseed')).show, true, 'skaz-videoseed виден');
});
