import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.PORT = '3202';
process.env.CORS_ORIGINS = '*';
process.env.RATE_LIMIT_MAX = '1000';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:3202';
process.env.USERS_FILE = new URL('./fixtures/plugin-install-users.json', import.meta.url).pathname;
// PLUGIN-INSTALL-002: секрет скрытого ключа /x/<install>_<key>.js (тестовый).
process.env.PLUGIN_CODE_SECRET = 'test-secret-001';
// Не дёргать реальную сеть.
process.env.FILMIX_ENABLED = '0';
process.env.KODIK_ENABLED = '0';
process.env.REZKA_ENABLED = '0';
process.env.ALLOHA_ENABLED = '0';
process.env.RUTUBEMOVIE_ENABLED = '0';
process.env.CDNVIDEOHUB_ENABLED = '0';
process.env.COLLAPS_ENABLED = '0';
process.env.HDVB_ENABLED = '0';
process.env.SKAZ_ENABLED = '0';

const { server } = await import('../src/index.js');
const base = 'http://127.0.0.1:3202';

// Пользователи в fixtures/plugin-install-users.json (PLUGIN-INSTALL-002).
const USER_A = {
  token: 'mo-aaaabbbbccccddddeeeeffff00001111',
  install: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234'
};
const USER_B = {
  token: 'mo-11112222333344445555666677778888',
  install: 'efef5678efef5678efef5678efef5678efef5678efef5678'
};
const USER_C = {
  token: 'mo-99998888777766665555444433332222',
  install: '9999abcd9999abcd9999abcd9999abcd9999abcd9999abcd'
};

const STUB_TEXT = 'Добавьте плагин в Расширения Lampa';
// Lampa дописывает версию в UA; обычный браузер этого не делает.
const LAMPA_UA = 'Mozilla/5.0 (AppleTV; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Lampa/0.20.4';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function fetchAs(ua, url, init = {}) {
  return fetch(url, { ...init, headers: { 'User-Agent': ua, ...(init.headers || {}) } });
}
const lampaFetch = (url, init) => fetchAs(LAMPA_UA, url, init);
const browserFetch = (url, init) => fetchAs(BROWSER_UA, url, init);

// Тот же HMAC, что на сервере (config.pluginCodeSecret, 'plugin-code:'+install).
function hiddenKey(install) {
  return crypto.createHmac('sha256', 'test-secret-001').update('plugin-code:' + install).digest('hex').slice(0, 24);
}
const hiddenUrl = (install) => `${base}/x/${install}_${hiddenKey(install)}.js`;

// Из лоадера достать скрытый путь /x/<install>_<key>.js.
function extractHiddenPath(loaderBody) {
  const m = loaderBody.match(/\/x\/[0-9a-f]{32,}_[0-9a-f]{16,}\.js/);
  assert.ok(m, `в лоадере есть скрытый путь /x/: ${loaderBody}`);
  return m[0];
}

async function assertStub(response, label) {
  assert.equal(response.status, 200, `${label}: статус 200`);
  assert.match(response.headers.get('content-type'), /^text\/plain/, `${label}: content-type text/plain`);
  assert.match(response.headers.get('cache-control'), /no-store/, `${label}: no-store`);
  assert.match(response.headers.get('x-content-type-options'), /nosniff/, `${label}: nosniff`);
  const body = await response.text();
  assert.equal(body, STUB_TEXT, `${label}: тело — stub-текст`);
  assert.ok(!body.includes('MANIYA_ONLINE_TOKEN'), `${label}: без подписи токена`);
  assert.ok(!body.includes('MANIYA_API_BASE'), `${label}: без кода плагина`);
  return body;
}

before(async () => {
  await new Promise((resolve) => server.listen(3202, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('PLUGIN-INSTALL-002: UA-гейт — браузер видит stub, Lampa получает код', () => {
  it('1. /p/<install>.js в браузере: stub-текст (text/plain, no-store, nosniff), НЕ JS, без токена', async () => {
    const response = await browserFetch(`${base}/p/${USER_A.install}.js`);
    await assertStub(response, '/p/ browser');
  });

  it('2. /p/<install>.js для Lampa: лоадер (JS) со скрытым /x/, БЕЗ кода и токена', async () => {
    const response = await lampaFetch(`${base}/p/${USER_A.install}.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/javascript/, 'лоадер — JS');
    assert.match(response.headers.get('cache-control'), /no-store/, 'лоадер no-store');
    assert.match(response.headers.get('x-content-type-options'), /nosniff/, 'лоадер nosniff');
    const body = await response.text();
    assert.match(body, /\(function \(\)/, 'IIFE-лоадер');
    assert.ok(body.includes(`/x/${USER_A.install}_`), 'лоадер инжектит скрытый путь');
    assert.ok(!body.includes('MANIYA_ONLINE_TOKEN'), 'в лоадере нет токена');
    assert.ok(!body.includes(USER_A.token), 'в лоадере нет subscription-токена');
    assert.ok(!body.includes('MANIYA_API_BASE'), 'в лоадере нет полного кода плагина');
  });

  it('3. лоадер → скрытый /x/: Lampa получает полный JS с токеном, браузер — stub', async () => {
    const loader = await (await lampaFetch(`${base}/p/${USER_A.install}.js`)).text();
    const hiddenPath = extractHiddenPath(loader);

    const lampaResp = await lampaFetch(`${base}${hiddenPath}`);
    assert.equal(lampaResp.status, 200);
    assert.match(lampaResp.headers.get('content-type'), /^application\/javascript/);
    const full = await lampaResp.text();
    assert.match(full, /window\.MANIYA_ONLINE_TOKEN="[^"]+"/);
    assert.ok(full.includes(`window.MANIYA_ONLINE_TOKEN=${JSON.stringify(USER_A.token)}`), 'вшит токен A');
    assert.match(full, /MANIYA_API_BASE/);

    const browserResp = await browserFetch(`${base}${hiddenPath}`);
    await assertStub(browserResp, '/x/ browser');
  });

  it('4. скрытый путь детерминирован: два /p/ дают один и тот же /x/, у A и B разные', async () => {
    const loaderA1 = await (await lampaFetch(`${base}/p/${USER_A.install}.js`)).text();
    const loaderA2 = await (await lampaFetch(`${base}/p/${USER_A.install}.js`)).text();
    const loaderB = await (await lampaFetch(`${base}/p/${USER_B.install}.js`)).text();
    assert.equal(extractHiddenPath(loaderA1), extractHiddenPath(loaderA2), 'тот же пользователь — тот же ключ');
    assert.equal(extractHiddenPath(loaderA1), hiddenUrl(USER_A.install).slice(base.length), 'путь совпадает с HMAC');
    assert.notEqual(extractHiddenPath(loaderA1), extractHiddenPath(loaderB), 'разные пользователи — разные ключи');
    assert.notEqual(hiddenKey(USER_A.install), hiddenKey(USER_B.install), 'HMAC-ключи разные');
  });

  it('5. /x/ с неверным ключом: 404 (нет раскрытия данных)', async () => {
    const wrongKey = 'f'.repeat(24);
    const response = await lampaFetch(`${base}/x/${USER_A.install}_${wrongKey}.js`);
    assert.equal(response.status, 404);
  });

  it('6. /x/ несуществующего install: 404', async () => {
    const ghost = 'ab'.repeat(24);
    const response = await lampaFetch(`${base}/x/${ghost}_${hiddenKey(ghost)}.js`);
    assert.equal(response.status, 404);
  });

  it('7. /x/ неактивного пользователя (верный ключ): 403 (подписка)', async () => {
    const response = await lampaFetch(hiddenUrl(USER_C.install));
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.ok(!JSON.stringify(body).includes('mo-'), 'в ошибке нет токена');
  });

  it('8. /x/ неактивного пользователя (неверный ключ): 404 (ключ не угадан)', async () => {
    const response = await lampaFetch(`${base}/x/${USER_C.install}_${'f'.repeat(24)}.js`);
    assert.equal(response.status, 404);
  });
});

describe('PLUGIN-INSTALL-002: /i/ устаревший путь — всегда stub, никогда JS', () => {
  it('9. /i/<opaque> и для браузера, и для Lampa: stub-текст', async () => {
    await assertStub(await browserFetch(`${base}/i/${USER_A.install}`), '/i/ browser');
    await assertStub(await lampaFetch(`${base}/i/${USER_A.install}`), '/i/ lampa');
  });

  it('10. короткий /i/<opaque> (< 32 hex) не валиден (анти-гадалка)', async () => {
    const response = await fetch(`${base}/i/abcd1234`);
    assert.equal(response.status, 404);
  });
});

describe('PLUGIN-INSTALL-002: существующие флоу не сломаны', () => {
  it('11. короткая ссылка /{slug}_{short}.js: браузер — stub, Lampa — JS с токеном', async () => {
    // A: mo-aaaabbbbccccddddeeeeffff00001111 → последние 12 hex: ffff00001111
    const browserResp = await browserFetch(`${base}/user-a_ffff00001111.js`);
    await assertStub(browserResp, 'shortlink browser');

    const lampaResp = await lampaFetch(`${base}/user-a_ffff00001111.js`);
    assert.equal(lampaResp.status, 200);
    assert.match(lampaResp.headers.get('content-type'), /^application\/javascript/);
    assert.ok((await lampaResp.text()).includes(`window.MANIYA_ONLINE_TOKEN=${JSON.stringify(USER_A.token)}`));
  });

  it('12. статика /maniya-online.js: браузер — stub, Lampa — JS (cached)', async () => {
    const browserResp = await browserFetch(`${base}/maniya-online.js`);
    await assertStub(browserResp, 'static browser');

    const lampaResp = await lampaFetch(`${base}/maniya-online.js`);
    assert.equal(lampaResp.status, 200);
    assert.match(lampaResp.headers.get('content-type'), /^application\/javascript/);
    assert.match(lampaResp.headers.get('cache-control'), /max-age=300/);
    assert.match(await lampaResp.text(), /MANIYA_API_BASE/);
  });

  it('13. API-вызовы работают (subscription/check по реальному токену)', async () => {
    const response = await fetch(`${base}/api/lampa/subscription/check?token=${USER_A.token}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.authorized, true);
    assert.equal(body.active, true);
  });
});

describe('PLUGIN-INSTALL-002: изоляция и отсутствие секретов', () => {
  it('14. A/B изоляция: лоадер и полный код не смешивают пользователей', async () => {
    const loaderA = await (await lampaFetch(`${base}/p/${USER_A.install}.js`)).text();
    const loaderB = await (await lampaFetch(`${base}/p/${USER_B.install}.js`)).text();
    assert.ok(!loaderA.includes(USER_B.install), 'лоадер A не содержит install B');
    assert.ok(!loaderB.includes(USER_A.install), 'лоадер B не содержит install A');

    const fullA = await (await lampaFetch(hiddenUrl(USER_A.install))).text();
    const fullB = await (await lampaFetch(hiddenUrl(USER_B.install))).text();
    assert.ok(fullA.includes(USER_A.token), 'A-JS вшивает токен A');
    assert.ok(!fullA.includes(USER_B.token), 'A-JS не содержит токен B');
    assert.ok(fullB.includes(USER_B.token), 'B-JS вшивает токен B');
    assert.ok(!fullB.includes(USER_A.token), 'B-JS не содержит токен A');
  });

  it('15. в URL нет subscription-токена — только opaque install и HMAC-ключ', async () => {
    const pUrl = `${base}/p/${USER_A.install}.js`;
    const xUrl = hiddenUrl(USER_A.install);
    assert.ok(!pUrl.includes(USER_A.token), '/p/ без реального токена');
    assert.ok(!xUrl.includes(USER_A.token), '/x/ без реального токена');
    assert.match(pUrl, /\/p\/[0-9a-f]{32,}\.js$/);
    assert.match(xUrl, /\/x\/[0-9a-f]{32,}_[0-9a-f]{16,}\.js$/);
    assert.ok(!hiddenKey(USER_A.install).includes(USER_A.token.split('-').pop()), 'ключ не из hex токена');
  });

  it('16. кэш: stub, лоадер и полный код — no-store; повторные ответы идентичны', async () => {
    const s1 = await browserFetch(`${base}/p/${USER_A.install}.js`);
    const s2 = await browserFetch(`${base}/p/${USER_A.install}.js`);
    assert.match(s1.headers.get('cache-control'), /no-store/);
    assert.equal(await s1.text(), await s2.text(), 'тот же юзер — тот же stub');

    const f1 = await lampaFetch(hiddenUrl(USER_A.install));
    const f2 = await lampaFetch(hiddenUrl(USER_A.install));
    assert.match(f1.headers.get('cache-control'), /no-store/);
    assert.equal(await f1.text(), await f2.text(), 'тот же юзер — тот же полный код');
  });

  it('17. несуществующий /p/<opaque>.js: 404 (без раскрытия)', async () => {
    const response = await fetch(`${base}/p/${'f'.repeat(48)}.js`);
    assert.equal(response.status, 404);
  });

  it('18. секрет не попадает в ответы (stub/лоадер/код без PLUGIN_CODE_SECRET)', async () => {
    for (const [label, resp] of [
      ['stub', await browserFetch(`${base}/p/${USER_A.install}.js`)],
      ['loader', await lampaFetch(`${base}/p/${USER_A.install}.js`)],
      ['full', await lampaFetch(hiddenUrl(USER_A.install))]
    ]) {
      const body = await resp.text();
      assert.ok(!body.includes('test-secret-001'), `${label}: секрет не в теле`);
    }
  });
});

describe('PLUGIN-INSTALL-003: Media Station X (Lampa web UI) — origin-query гейт', () => {
  // MSX = Lampa web UI в WKWebView: UA БЕЗ «Lampa», но при загрузке плагина
  // дописывает ?logged=…&reset=…&origin=bylampa.online (дискриминатор из прод-логов).
  const MSX_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  const MSX_QUERY = 'logged=abc&reset=abc&origin=bylampa.online';
  const msxFetch = (url, init) => fetchAs(MSX_UA, url, init);

  it('19. MSX + origin-query на legacy-шортлинке: полный JS с токеном', async () => {
    const response = await msxFetch(`${base}/user-a_ffff00001111.js?${MSX_QUERY}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/javascript/);
    const body = await response.text();
    assert.ok(body.includes(`window.MANIYA_ONLINE_TOKEN=${JSON.stringify(USER_A.token)}`), 'вшит токен A');
  });

  it('20. MSX + origin-query на /p/<install>.js: лоадер со скрытым /x/ (обратная совместимость)', async () => {
    const response = await msxFetch(`${base}/p/${USER_A.install}.js?${MSX_QUERY}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/javascript/);
    const body = await response.text();
    assert.match(body, /\(function \(\)/, 'лоадер');
    assert.ok(body.includes(`/x/${USER_A.install}_`), 'скрытый путь');
  });

  it('21. MSX без origin-query (голая ссылка): stub — как браузер', async () => {
    await assertStub(await msxFetch(`${base}/user-a_ffff00001111.js`), 'MSX bare shortlink');
    await assertStub(await msxFetch(`${base}/p/${USER_A.install}.js`), 'MSX bare /p/');
  });

  it('22. только logged+reset (без origin): JS (запасной дискриминатор)', async () => {
    const response = await msxFetch(`${base}/user-a_ffff00001111.js?logged=1&reset=1`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/javascript/);
    assert.match(await response.text(), /MANIYA_ONLINE_TOKEN=/);
  });

  it('23. только origin=bylampa.online (без logged/reset): JS', async () => {
    const response = await msxFetch(`${base}/user-a_ffff00001111.js?origin=bylampa.online`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/javascript/);
  });
});
