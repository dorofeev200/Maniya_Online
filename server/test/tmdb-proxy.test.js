import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from '../src/errors.js';
import {
  TMDB_API_ROUTE, TMDB_IMG_ROUTE, TMDB_API_HOST, TMDB_IMG_HOST,
  isTmdbApiPath, isTmdbImgPath,
  buildTmdbUpstream, validateTmdbTarget, tmdbRelay
} from '../src/tmdbProxy.js';

const PLUGIN_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/tmdbproxy.js');

// ─────────────────────────────────────────────────────────────────────────────
// SSRF-гейт (validateTmdbTarget): https строго, хост ТОЧНО равен константе,
// НЕТ исключения для http-loopback (в отличие от generic validateProxyTarget).
// ─────────────────────────────────────────────────────────────────────────────

test('validateTmdbTarget: принимает ТОЛЬКО https и точный константный хост', () => {
  assert.equal(validateTmdbTarget(`https://${TMDB_API_HOST}/3/configuration`, TMDB_API_HOST).hostname, TMDB_API_HOST);
  assert.equal(validateTmdbTarget(`https://${TMDB_IMG_HOST}/t/p/original/x.jpg`, TMDB_IMG_HOST).hostname, TMDB_IMG_HOST);
  // Регистр хоста не имеет значения.
  assert.ok(validateTmdbTarget('https://API.THEMOVIEDB.ORG/3/x', TMDB_API_HOST));
});

test('validateTmdbTarget: чужие хосты / схема / loopback — 400/403 (SSRF)', () => {
  // https-чужой хост → 403
  assert.throws(() => validateTmdbTarget('https://evil.com/x', TMDB_API_HOST),
    (e) => e instanceof HttpError && e.statusCode === 403 && e.code === 'proxy_host_forbidden');
  // http (в т.ч. loopback) → 400 — здесь НЕТ loopback-исключения generic-прокси.
  assert.throws(() => validateTmdbTarget('http://127.0.0.1:9999/x', TMDB_API_HOST),
    (e) => e instanceof HttpError && e.statusCode === 400 && e.code === 'tmdb_scheme_forbidden');
  assert.throws(() => validateTmdbTarget('http://api.themoviedb.org/x', TMDB_API_HOST),
    (e) => e instanceof HttpError && e.statusCode === 400);
  assert.throws(() => validateTmdbTarget('ftp://api.themoviedb.org/x', TMDB_API_HOST),
    (e) => e instanceof HttpError && e.statusCode === 400);
  // Стриддл-суффиксы и под-доменные подмены — НЕ «api.themoviedb.org».
  for (const value of [
    'https://api.themoviedb.org.evil.com/x',
    'https://themoviedb.org/x',
    'https://something.api.themoviedb.org/x',
    'https://api.themoviedb.org.evil/x',
    'https://169.254.169.254/latest/meta-data'
  ]) {
    assert.throws(() => validateTmdbTarget(value, TMDB_API_HOST),
      (e) => e instanceof HttpError && e.statusCode === 403, `${value} отклонён`);
  }
  // Пустая строка → invalid_tmdb_url.
  assert.throws(() => validateTmdbTarget('', TMDB_API_HOST),
    (e) => e instanceof HttpError && e.statusCode === 400 && e.code === 'invalid_tmdb_url');
});

// ─────────────────────────────────────────────────────────────────────────────
// buildTmdbUpstream: маппинг типизированных маршрутов на константный хост.
// ─────────────────────────────────────────────────────────────────────────────

test('buildTmdbUpstream: api/3 и img маппятся на константные хосты', () => {
  const ctxUrl = (pathname) => new URL(pathname, 'http://maniya.test');
  const p = ctxUrl('/api/lampa/tmdb/api/3/configuration');
  assert.equal(buildTmdbUpstream(TMDB_API_ROUTE, p.pathname, p.searchParams).toString(),
    `https://${TMDB_API_HOST}/3/configuration`);
  // Маршрут без суффикса → корень /3/.
  const root = ctxUrl('/api/lampa/tmdb/api/3');
  assert.equal(buildTmdbUpstream(TMDB_API_ROUTE, root.pathname, root.searchParams).toString(),
    `https://${TMDB_API_HOST}/3/`);

  const img = ctxUrl('/api/lampa/tmdb/img/t/p/w300/abc.jpg');
  assert.equal(buildTmdbUpstream(TMDB_IMG_ROUTE, img.pathname, img.searchParams).toString(),
    `https://${TMDB_IMG_HOST}/t/p/w300/abc.jpg`);
});

test('buildTmdbUpstream: query пробрасывается как есть, КРОМЕ служебных ключей', () => {
  const ctxUrl = '/api/lampa/tmdb/api/3/search/movie';
  const p = ctxUrl && new URL(ctxUrl + '?api_key=KEY&query=Interstellar&language=ru-RU&include_adult=false', 'http://x');
  const built = buildTmdbUpstream(TMDB_API_ROUTE, p.pathname, p.searchParams);
  assert.equal(built.searchParams.get('api_key'), 'KEY');
  assert.equal(built.searchParams.get('query'), 'Interstellar');
  assert.equal(built.searchParams.get('language'), 'ru-RU');
  assert.equal(built.searchParams.get('include_adult'), 'false');

  // Служебные Maniya/Lampa-параметры апстриму НЕ уходят.
  const q = new URL('/api/lampa/tmdb/api/3/configuration?api_key=K&token=tk123&uid=u1&account_email=a@b.c&origin=bylampa.online&logged=1&reset=1&cub_id=9', 'http://x');
  const stripped = buildTmdbUpstream(TMDB_API_ROUTE, q.pathname, q.searchParams);
  assert.equal(stripped.searchParams.get('api_key'), 'K');
  for (const key of ['token', 'uid', 'account_email', 'origin', 'logged', 'reset', 'cub_id']) {
    assert.equal(stripped.searchParams.has(key), false, `${key} не пробрасывается`);
  }
});

test('buildTmdbUpstream: traversal/`..` никогда не меняют authority (SSRF)', () => {
  // WHATWG URL резолвит dot-сегменты в pathname; authority после пробела строки
  // завершён → `..`/`%2e%2e` не могут выйти на другой хост.
  const p = new URL('%2e%2e/%2e%2e/api/lampa/tmdb/api/3/etc/passwd', 'http://x');
  const built = buildTmdbUpstream(TMDB_API_ROUTE, p.pathname, p.searchParams);
  assert.equal(built.hostname, TMDB_API_HOST, 'hostname остаётся константой');
  assert.match(built.pathname, /^\/3\//, 'суффикс остаётся под /3/');

  // `../../..` внутри ПРЕФИКСА резолвится нормально (всегда тот же константный хост).
  const safe = new URL('/api/lampa/tmdb/img/t/../t/p/w92/x.jpg', 'http://x');
  const builtSafe = buildTmdbUpstream(TMDB_IMG_ROUTE, safe.pathname, safe.searchParams);
  assert.equal(builtSafe.hostname, TMDB_IMG_HOST);

  // traversal, ВЫХОДЯЩИЙ за пределы типизированного префикса → контролируемый 404
  // (не /etc/passwd на чужом хосте, а фиксированный ответ маршрута).
  const escape = new URL('/api/lampa/tmdb/img/t/p/../../../etc/passwd', 'http://x');
  assert.throws(() => buildTmdbUpstream(TMDB_IMG_ROUTE, escape.pathname, escape.searchParams),
    (e) => e instanceof HttpError && e.statusCode === 404 && e.code === 'tmdb_route_not_found',
    'escape из префикса → 404, хост не покидается');
});

test('buildTmdbUpstream: hostname-инъекция в суффикс невозможна (//evil.com и кодировки)', () => {
  // `//evil.com` в пути → после `/api/lampa/tmdb/api/3` уже есть разделитель:
  // строковый суффикс «evil.com» может попасть ТОЛЬКО в pathname, а не authority.
  for (const raw of [
    '/api/lampa/tmdb/api/3//evil.com/x',
    '/api/lampa/tmdb/api/3/https://evil.com/x',
    '/api/lampa/tmdb/api/3/%2f%2fevil.com/x',
    '/api/lampa/tmdb/api/3/%72eplica.tmdb.org/x'
  ]) {
    const p = new URL(raw, 'http://x');
    const built = buildTmdbUpstream(TMDB_API_ROUTE, p.pathname, p.searchParams);
    assert.equal(built.hostname, TMDB_API_HOST, `${raw} → хост константа`);
    assert.ok(!/evil\.com/.test(built.hostname), 'no attacker authority');
  }
  // Неизвестный маршрут → 404 (не проксируем arbitrary-путь).
  assert.throws(() => buildTmdbUpstream('/api/lampa/other', '/api/lampa/other', new URLSearchParams()),
    (e) => e instanceof HttpError && e.statusCode === 404 && e.code === 'tmdb_route_not_found');
});

// ─────────────────────────────────────────────────────────────────────────────
// tmdbRelay: потоковый passthrough + redirect-ревалидация + ошибки апстрима.
// requestOnce инжектится без сети (как MockResponse в proxy.test.js).
// ─────────────────────────────────────────────────────────────────────────────

class MockResponse extends PassThrough {
  constructor() { super(); this.status = null; this.headers = null; }
  writeHead(status, headers) {
    this.status = status;
    this.headers = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return this;
  }
}

function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString()));
    stream.on('error', reject);
  });
}

function fakeUpstream({ statusCode = 200, headers = {}, body = '', location } = {}) {
  const stream = new PassThrough();
  stream.statusCode = statusCode;
  stream.headers = { ...headers };
  if (location) stream.headers.location = location;
  if (body) stream.end(Buffer.from(body));
  return stream;
}

function relayContext(routePath, query = '') {
  return { url: new URL(routePath + query, 'http://maniya.test') };
}

test('relay: 200 passthrough — статус, content-type, cache-заголовки, ACAO, тело стримится', async () => {
  const response = new MockResponse();
  let seenHost = null;
  const requestOnce = (url) => {
    seenHost = url.hostname;
    return fakeUpstream({
      statusCode: 200,
      headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'public, max-age=86400', etag: '"abc"' },
      body: '{"success":true}'
    });
  };

  await tmdbRelay(TMDB_API_ROUTE, relayContext('/api/lampa/tmdb/api/3/configuration', '?api_key=K'), response, { requestOnce, timeoutMs: 3000, maxRedirects: 2 });

  assert.equal(seenHost, TMDB_API_HOST, 'хост апстрима — константа api.themoviedb.org');
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'application/json;charset=utf-8');
  assert.equal(response.headers['cache-control'], 'public, max-age=86400');
  assert.equal(response.headers.etag, '"abc"');
  assert.equal(response.headers['access-control-allow-origin'], '*');
  assert.equal(await collect(response), '{"success":true}', 'тело перетекает клиенту');
});

test('relay: hop-by-hop заголовки НЕ relay-ятся (connection/transfer-encoding/upgrade)', async () => {
  const response = new MockResponse();
  const requestOnce = () => fakeUpstream({
    statusCode: 200,
    headers: {
      'content-type': 'application/json',
      connection: 'keep-alive',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
      upgrade: 'h2c',
      'content-length': '4'
    },
    body: 'data'
  });

  await tmdbRelay(TMDB_IMG_ROUTE, relayContext('/api/lampa/tmdb/img/t/p/w92/x.jpg'), response, { requestOnce, timeoutMs: 3000, maxRedirects: 2 });

  for (const forbidden of ['connection', 'keep-alive', 'transfer-encoding', 'upgrade']) {
    assert.equal(response.headers[forbidden], undefined, `${forbidden} не пробрасывается`);
  }
  assert.equal(response.headers['content-type'], 'application/json');
});

test('relay: 302 на тот же константный хост — редирект идёт, тело из финального ответа', async () => {
  const response = new MockResponse();
  const hostsSeen = [];
  const requestOnce = (url) => {
    hostsSeen.push(url.hostname);
    if (hostsSeen.length === 1) {
      return fakeUpstream({ statusCode: 302, location: '/3/search/movie?v=1', headers: { 'content-type': 'text/plain' } });
    }
    return fakeUpstream({ statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' });
  };

  await tmdbRelay(TMDB_API_ROUTE, relayContext('/api/lampa/tmdb/api/3/configuration'), response, { requestOnce, timeoutMs: 3000, maxRedirects: 2 });

  assert.deepEqual(hostsSeen, [TMDB_API_HOST, TMDB_API_HOST], 'оба хопа — api.themoviedb.org');
  assert.equal(response.status, 200);
  assert.equal(await collect(response), '{"ok":true}');
});

test('relay: redirect на чужой/https-loopback хост — 403/400, до атакованного хоста не доходит', async () => {
  const response = new MockResponse();
  const seen = [];
  const requestOnce = (url) => {
    seen.push(url.hostname);
    return fakeUpstream({ statusCode: 302, location: 'https://evil.com/phish' });
  };

  await assert.rejects(
    tmdbRelay(TMDB_API_ROUTE, relayContext('/api/lampa/tmdb/api/3/configuration'), response, { requestOnce, timeoutMs: 3000, maxRedirects: 2 }),
    (e) => e instanceof HttpError && e.statusCode === 403 && e.code === 'proxy_host_forbidden'
  );
  assert.deepEqual(seen, [TMDB_API_HOST], 'второй хоп (evil.com) не запрошен');

  // http://127.0.0.1 (loopback) → 400 (в tmdb-релее loopback не разрешён).
  const response2 = new MockResponse();
  const requestOnce2 = () => fakeUpstream({ statusCode: 302, location: 'http://127.0.0.1:9999/secret' });
  await assert.rejects(
    tmdbRelay(TMDB_API_ROUTE, relayContext('/api/lampa/tmdb/api/3/x'), response2, { requestOnce: requestOnce2, timeoutMs: 3000, maxRedirects: 2 }),
    (e) => e instanceof HttpError && e.statusCode === 400 && e.code === 'tmdb_scheme_forbidden'
  );
});

test('relay: статусы апстрима 404/429/503 пробрасываются клиенту (не маскируются)', async () => {
  for (const [code, body] of [[404, '{"status_code":34}'], [429, '{"status_code":29}'], [503, 'unavailable']]) {
    const response = new MockResponse();
    const requestOnce = () => fakeUpstream({ statusCode: code, headers: { 'content-type': 'application/json' }, body });
    await tmdbRelay(TMDB_API_ROUTE, relayContext('/api/lampa/tmdb/api/3/unknown'), response, { requestOnce, timeoutMs: 3000, maxRedirects: 2 });
    assert.equal(response.status, code, `status ${code} проброшен`);
    assert.equal(await collect(response), body);
  }
});

test('relay: timeout апстрима → 504 tmdb_upstream_timeout; ошибка соединения → 502 tmdb_upstream_error', async () => {
  await assert.rejects(
    tmdbRelay(TMDB_API_ROUTE, relayContext('/api/lampa/tmdb/api/3/configuration'), new MockResponse(),
      { requestOnce: () => Promise.reject(new Error('tmdb_upstream_timeout')), timeoutMs: 3000, maxRedirects: 2 }),
    (e) => e instanceof HttpError && e.statusCode === 504 && e.code === 'tmdb_upstream_timeout'
  );

  await assert.rejects(
    tmdbRelay(TMDB_API_ROUTE, relayContext('/api/lampa/tmdb/api/3/configuration'), new MockResponse(),
      { requestOnce: () => Promise.reject(new Error('ECONNREFUSED ::1:443')), timeoutMs: 3000, maxRedirects: 2 }),
    (e) => e instanceof HttpError && e.statusCode === 502 && e.code === 'tmdb_upstream_error'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Плагин public/tmdbproxy.js — vm-sandbox (модель plugin-contract.test.js).
// TMDB PROXY COMPATIBILITY: 5 сценариев совместимости + guard/marker.
// ─────────────────────────────────────────────────────────────────────────────

/** Загружает НАСТОЯЩИЙ public/tmdbproxy.js. opts: { proxyOn, token, email, userApi, userImage }. */
async function loadTmdbSandbox(opts = {}) {
  const source = await readFile(PLUGIN_PATH, 'utf8');
  let proxyField = opts.proxyOn ? '1' : '';
  const storage = {
    get: (key, fallback) => {
      if (key === 'maniya_token') return opts.token || 'm1234';
      if (key === 'lampac_token') return '';
      if (key === 'account_email') return opts.email || 'me@example.com';
      return fallback;
    },
    set: (k, v) => { if (k === 'proxy_tmdb') proxyField = String(v); },
    field: (key) => (key === 'proxy_tmdb' ? proxyField : '')
  };

  let userApi = null; let userImage = null;
  if (opts.userApi) { userApi = opts.userApi; }
  if (opts.userImage) { userImage = opts.userImage; }

  const nativeApi = (url) => 'NATIVE-API:' + url;
  const nativeImage = (url) => 'NATIVE-IMG:' + url;
  const userApiCalls = [];
  const nativeApiCalls = [];

  const lampa = {
    Storage: storage,
    Utils: { addUrlComponent: (u, p) => u + (u.indexOf('?') >= 0 ? '&' : '?') + p },
    TMDB: {
      api: userApi || ((url) => { nativeApiCalls.push(url); return nativeApi(url); }),
      image: userImage || ((url) => nativeImage(url))
    }
  };

  const context = { console, Lampa: lampa };
  context.window = context;

  vm.runInNewContext(source, context, { filename: 'tmdbproxy.js' });

  return { lampa, storage, setProxy: (on) => storage.set('proxy_tmdb', on ? '1' : ''), nativeApiCalls, userApiCalls, context };
}

test('плагин (1): без пользовательского прокси — Maniya работает; выкл→вкл без поломки', async () => {
  const s = await loadTmdbSandbox({ proxyOn: true });
  const apiOut = s.lampa.TMDB.api('configuration?api_key=K&language=ru');
  assert.match(apiOut, /^https:\/\/plugin\.maniya-kvn\.online\/api\/lampa\/tmdb\/api\/3\/configuration\?api_key=K&language=ru&token=m1234&account_email=me%40example\.com$/,
    'api переписан на Maniya relay + token + percent-encoded account_email (URLSearchParams на сервере декодирует)');
  assert.ok(s.nativeApiCalls.length === 0, 'нативный Lampa.TMDB.api НЕ вызван (прямо в Maniya, без цепочки)');

  const imgOut = s.lampa.TMDB.image('t/p/w300/abc.jpg');
  assert.match(imgOut, /^https:\/\/plugin\.maniya-kvn\.online\/api\/lampa\/tmdb\/img\/t\/p\/w300\/abc\.jpg\?token=m1234/,
    'poster переписан на Maniya img-relay');

  // Выключаем → делегируем сохранённому нативному (не ломает Lampa.TMDB.image).
  s.setProxy(false);
  assert.equal(s.lampa.TMDB.api('configuration?api_key=K'), 'NATIVE-API:configuration?api_key=K', 'выкл → нативный Lampa.TMDB.api');
  assert.equal(s.lampa.TMDB.image('t/p/x.jpg'), 'NATIVE-IMG:t/p/x.jpg');
  // Включаем обратно → Maniya снова работает (Maniya продолжает работать).
  s.setProxy(true);
  assert.match(s.lampa.TMDB.api('search/movie?api_key=K'), /^https:\/\/plugin\.maniya-kvn\.online\/api\/lampa\/tmdb\/api\/3\//);
});

test('плагин (2): пользовательский прокси включён — Maniya НЕ строит двойную цепочку', async () => {
  const userApiCalls = [];
  const userProxy = (url) => { userApiCalls.push(url); return 'https://user.tmdb.proxy/' + url; };
  const s = await loadTmdbSandbox({ proxyOn: true, userApi: userProxy });

  const out = s.lampa.TMDB.api('configuration?api_key=K');
  assert.match(out, /^https:\/\/plugin\.maniya-kvn\.online\/api\/lampa\/tmdb\/api\/3\/configuration/, 'рулит Maniya, а НЕ пользовательский прокси');
  assert.deepEqual(userApiCalls, [], 'пользовательский TMDB-прокси НЕ обёрнут Maniya → НЕ вызывается (никакой двойной цепочки)');

  // Выключенный пользовательский прокси (switch off) → делегируем ЕМУ: он сам решает
  // (со своей логикой) — Maniya не ломает Lampa.TMDB.api.
  s.setProxy(false);
  const off = s.lampa.TMDB.api('configuration?api_key=K');
  assert.deepEqual(userApiCalls, ['configuration?api_key=K'], 'при выключенном Maniya вызывается пользовательский прокси');
  assert.equal(off, 'https://user.tmdb.proxy/configuration?api_key=K');
});

test('плагин (4): повторная загрузка — guard/marker, обёртка НЕ накапливается', async () => {
  const s = await loadTmdbSandbox({ proxyOn: true });
  const first = s.lampa.TMDB.api;
  assert.equal(first.__maniya_tmdb, true, 'метка на обёртке установлена');

  // Повторная инсталляция плагина = повторный run ТОГО ЖЕ realm (window===context):
  // guard window.MANIYA_TMDB_PROXY уже стоит → модуль выходит до оборачивания.
  const source = await readFile(PLUGIN_PATH, 'utf8');
  vm.runInNewContext(source, s.context, { filename: 'tmdbproxy.js' });

  assert.equal(s.lampa.TMDB.api, first, 'метод не переобёрнут вторым слоем (guard)');
  const out = s.lampa.TMDB.api('configuration?api_key=K');
  assert.match(out, /^https:\/\/plugin\.maniya-kvn\.online\/api\/lampa\/tmdb\/api\/3\/configuration/, 'всё ещё один хоп до Maniya');
});

test('плагин (5): перехватываются ТОЛЬКО Lampa.TMDB.api/image — произвольный HTTP Lampa не тронут', async () => {
  await loadTmdbSandbox({ proxyOn: true });
  const source = await readFile(PLUGIN_PATH, 'utf8');
  // Статическая проверка: в коде нет сетевых intercept'ов (нет Reguest/XMLHttpRequest/fetch-обёрток).
  assert.ok(!/Lampa\.Reguest/.test(source), 'Lampa.Reguest не упоминается');
  assert.ok(!/XMLHttpRequest/.test(source), 'нет XHR-перехвата');
  assert.ok(!/fetch\s*=/.test(source), 'fetch не переопределяется');
  assert.match(source, /Lampa\.TMDB\.api\s*=|Lampa\.TMDB\.image\s*=/, 'трогаются только TMDB api/image методы');
});