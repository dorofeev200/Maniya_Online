import test from 'node:test';
import assert from 'node:assert/strict';

import { RezkaClient } from '../src/providers/rezka/RezkaClient.js';
import { anubisHtml, SEARCH_HTML, EPISODES_HTML } from './fixtures/rezka-fixtures.js';

/** Fake HttpClient с интерфейсом shared/http/HttpClient. */
class FakeHttpClient {
  constructor(routes = []) {
    this.headers = {};
    this.routes = routes; // [{ match, response: {ok,text} | fn(opts) }]
    this.requests = [];
  }

  /** Сырой ответ без проверки статуса — как реальный HttpClient.fetchOnce (302 не роняет). */
  async fetchOnce(path, options = {}) {
    this.requests.push({ path, options });
    const route = this.routes.find((r) => (typeof r.match === 'function' ? r.match(path, options) : r.match.test(path)));
    if (!route) throw new Error(`no route for ${path}`);

    const body = typeof route.response === 'function' ? route.response(options) : route.response;
    return fakeResponse(body);
  }

  async request(path, options = {}) {
    return this.fetchOnce(path, options);
  }

  get(path, options = {}) {
    return this.request(path, { ...options, method: 'GET' });
  }

  post(path, body, options = {}) {
    return this.request(path, { ...options, method: 'POST', body });
  }
}

function fakeResponse({ ok = true, status = 200, text = '', setCookie = [], redirected = false } = {}) {
  const headers = {
    get: (name) => (name.toLowerCase() === 'set-cookie' ? setCookie.join('; ') : null),
    getSetCookie: () => setCookie
  };
  return { ok, status, headers, url: 'https://rezka.ag/', redirected, text: async () => text };
}

test('RezkaClient.searchHtml: GET /search/?do=search… и возврат HTML', async () => {
  const http = new FakeHttpClient([
    { match: /\/search\//, response: { ok: true, text: SEARCH_HTML } }
  ]);
  const client = new RezkaClient({ httpClient: http, loggerImpl: nullLogger() });

  const html = await client.searchHtml({ query: 'Тестовый' });
  assert.equal(html, SEARCH_HTML);
  const req = http.requests[0];
  assert.match(req.path, /\/search\/\?do=search&subaction=search&q=/);
  assert.equal(req.options.headers.Referer, 'https://rezka.ag/');
  assert.equal(req.options.headers.Accept, 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8');
});

test('RezkaClient: Anubis-челлендж → PoW → pass-challenge(302+JWT) → повторный запрос без челленджа', async () => {
  const challenge = anubisHtml({ difficulty: 4 });
  let passCalled = false;
  const http = new FakeHttpClient([
    {
      match: (path) => path.includes('/ajax/get_cdn_series/'),
      response: () => {
        if (!passCalled) {
          passCalled = true;
          return { ok: true, text: challenge };
        }
        return { ok: true, text: JSON.stringify({ success: true, url: 'data' }) };
      }
    },
    {
      match: (path) => path.includes('pass-challenge'),
      response: (options) => {
        assert.equal(options.redirect, 'manual', 'pass-challenge идёт с redirect:manual (кука читается с 302)');
        return {
          ok: true,
          status: 302,
          redirected: false,
          text: '',
          setCookie: ['techaro.lol-anubis-auth=eyJhbGciOiJFZERTQSJ9.fake-jwt; Path=/']
        };
      }
    }
  ]);
  const client = new RezkaClient({ httpClient: http, loggerImpl: nullLogger() });

  const root = await client.getStreamMovie('12345', '7');
  assert.ok(root, 'после обхода Anubis возвращается JSON');
  assert.equal(root.success, true);
  assert.equal(passCalled, true, 'первый запрос был челленджем');
  assert.ok(client.cookies.has('techaro.lol-anubis-cookie-verification'));
  assert.ok(client.cookies.has('techaro.lol-anubis-auth'), 'JWT-доступ попал в jar');
  const passReq = http.requests.find((r) => r.path.includes('pass-challenge'));
  assert.ok(passReq, 'pass-challenge вызывался');
  assert.match(passReq.options.headers.Cookie, /anubis-cookie-verification/, 'тестовая кука уходит в pass-challenge');
  const retry = http.requests[2];
  assert.match(retry.options.headers.Cookie, /techaro\.lol-anubis-auth=eyJhbG/, 'JWT уходит в повторный запрос за контентом');
});

test('RezkaClient.getEpisodes: get_episodes → {seasons, episodes} из HTML', async () => {
  const http = new FakeHttpClient([
    {
      match: /\/ajax\/get_cdn_series\//,
      response: () => ({
        ok: true,
        text: JSON.stringify({
          success: true,
          seasons: EPISODES_HTML.seasons,
          episodes: EPISODES_HTML.episodes
        })
      })
    }
  ]);
  const client = new RezkaClient({ httpClient: http, loggerImpl: nullLogger() });

  const data = await client.getEpisodes('12345', '7');
  assert.ok(data, 'seasons/episodes получены');
  assert.deepEqual(data.seasons.map((s) => s.number), [1, 2]);
  assert.equal(data.episodes.length, 3);
  assert.equal(data.episodes[0].title, '1 серия');

  const req = http.requests[0];
  assert.match(req.path, /\/ajax\/get_cdn_series\/\?t=\d{13,}/);
  assert.match(String(req.options.body), /action=get_episodes/);
  assert.match(String(req.options.body), /translator_id=7/);
  assert.equal(req.options.headers['X-Requested-With'], 'XMLHttpRequest');
  assert.equal(req.options.headers.Origin, 'https://rezka.ag');
});

test('RezkaClient: get_movie body и результат', async () => {
  const http = new FakeHttpClient([
    {
      match: /\/ajax\/get_cdn_series\//,
      response: () => ({ ok: true, text: JSON.stringify({ success: true, url: '#hYmFzZTY0', premium: false }) })
    }
  ]);
  const client = new RezkaClient({ httpClient: http, loggerImpl: nullLogger() });

  const root = await client.getStreamMovie('42', '7', { director: 1 });
  assert.equal(root.success, true);
  const body = String(http.requests[0].options.body);
  assert.match(body, /action=get_movie/);
  assert.match(body, /is_camrip=0/);
  assert.match(body, /is_director=1/);
});

test('RezkaClient: гео-блок/HTTP-ошибка → searchHtml вернёт null (без throw)', async () => {
  const http = new FakeHttpClient([
    { match: /\/search\//, response: () => { throw new Error('HTTP 403'); } }
  ]);
  const client = new RezkaClient({ httpClient: http, loggerImpl: nullLogger() });
  const html = await client.searchHtml({ query: 'x' });
  assert.equal(html, null);
});

test('RezkaClient: premium выключен → login не вызывается вовсе', async () => {
  const http = new FakeHttpClient([
    { match: /\/ajax\/get_cdn_series\//, response: () => ({ ok: true, text: JSON.stringify({ success: true, url: '#h' }) }) }
  ]);
  const client = new RezkaClient({ httpClient: http, loggerImpl: nullLogger(), premium: false, login: 'u', password: 'p' });

  const root = await client.getStreamMovie('1', '7');
  assert.ok(root);
  assert.equal(http.requests.filter((r) => r.path.includes('/ajax/login/')).length, 0, 'без premium ни одного запроса /ajax/login/');
});

test('RezkaClient: premium → один ленивый логин перед стримом, cookie уходит в AJAX', async () => {
  const http = new FakeHttpClient([
    {
      match: /\/ajax\/login\//,
      response: () => ({ ok: true, text: 'ok', setCookie: ['dle_user_id=123; Path=/', 'dle_password=abc; Path=/'] })
    },
    { match: /\/ajax\/get_cdn_series\//, response: () => ({ ok: true, text: JSON.stringify({ success: true, url: '#h', premium: true }) }) }
  ]);
  const client = new RezkaClient({ httpClient: http, loggerImpl: nullLogger(), premium: true, login: 'user', password: 'pass' });

  const root = await client.getStreamMovie('42', '7');
  assert.equal(root.success, true);

  const logins = http.requests.filter((r) => r.path.includes('/ajax/login/'));
  assert.equal(logins.length, 1, 'логин ровно один');
  assert.match(String(logins[0].options.body), /login_name=user/);
  assert.match(String(logins[0].options.body), /login_password=pass/);

  const ajax = http.requests.find((r) => r.path.includes('get_cdn_series'));
  assert.match(ajax.options.headers.Cookie, /dle_user_id=123/, 'кука сессии уходит в get_cdn_series');
});

test('RezkaClient: одновременные стримы → один логин (in-flight promise)', async () => {
  let loginCount = 0;
  const http = new FakeHttpClient([
    {
      match: /\/ajax\/login\//,
      response: () => { loginCount += 1; return { ok: true, text: 'ok', setCookie: ['dle_user_id=1; Path=/', 'dle_password=x; Path=/'] }; }
    },
    { match: /\/ajax\/get_cdn_series\//, response: () => ({ ok: true, text: JSON.stringify({ success: true, url: '#h' }) }) }
  ]);
  const client = new RezkaClient({ httpClient: http, loggerImpl: nullLogger(), premium: true, login: 'u', password: 'p' });

  await Promise.all([
    client.getStreamMovie('1', '7'),
    client.getStreamMovie('2', '7'),
    client.getStreamMovie('3', '7')
  ]);
  assert.equal(loginCount, 1, 'несколько запросов делят один логин');
});

test('RezkaClient: переиспользование cookie — повторный стрим без логина', async () => {
  let loginCount = 0;
  const http = new FakeHttpClient([
    {
      match: /\/ajax\/login\//,
      response: () => { loginCount += 1; return { ok: true, text: 'ok', setCookie: ['dle_user_id=1; Path=/', 'dle_password=x; Path=/'] }; }
    },
    { match: /\/ajax\/get_cdn_series\//, response: () => ({ ok: true, text: JSON.stringify({ success: true, url: '#h' }) }) }
  ]);
  const client = new RezkaClient({ httpClient: http, loggerImpl: nullLogger(), premium: true, login: 'u', password: 'p' });

  await client.getStreamMovie('1', '7');
  await client.getStreamMovie('1', '7');
  assert.equal(loginCount, 1, 'живая сессия переиспользуется, без повторного POST');
});

test('RezkaClient: истёкшая сессия → повторный логин (не на каждый запрос)', async () => {
  let loginCount = 0;
  const http = new FakeHttpClient([
    {
      match: /\/ajax\/login\//,
      response: () => { loginCount += 1; return { ok: true, text: 'ok', setCookie: ['dle_user_id=1; Path=/', 'dle_password=x; Path=/'] }; }
    },
    { match: /\/ajax\/get_cdn_series\//, response: () => ({ ok: true, text: JSON.stringify({ success: true, url: '#h' }) }) }
  ]);
  const client = new RezkaClient({ httpClient: http, loggerImpl: nullLogger(), premium: true, login: 'u', password: 'p' });

  await client.getStreamMovie('1', '7');
  assert.equal(loginCount, 1);

  client.cookies.cookies.clear(); // сессия пропала → следующий стрим логинится заново
  await client.getStreamMovie('1', '7');
  assert.equal(loginCount, 2);
});

test('RezkaClient: сбой логина → cooldown без горячего ретрая, стрим идёт free-путь', async () => {
  let loginCount = 0;
  const http = new FakeHttpClient([
    {
      match: /\/ajax\/login\//,
      response: () => { loginCount += 1; return { ok: true, text: 'bad' }; } // нет Set-Cookie → логин не прошёл
    },
    { match: /\/ajax\/get_cdn_series\//, response: () => ({ ok: true, text: JSON.stringify({ success: true, url: '#h', premium: false }) }) }
  ]);
  const client = new RezkaClient({ httpClient: http, loggerImpl: nullLogger(), premium: true, login: 'u', password: 'wrong', loginCooldownMs: 60000 });

  await client.getStreamMovie('1', '7'); // первая попытка логина провалилась → cooldown
  await client.getStreamMovie('1', '7'); // внутри cooldown → без повторного логина
  assert.equal(loginCount, 1, 'провал не превращается в горячий цикл логинов');
});

function nullLogger() {
  return { warn: () => {}, info: () => {}, error: () => {} };
}