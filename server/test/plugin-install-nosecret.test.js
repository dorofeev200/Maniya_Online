import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.PORT = '3203';
process.env.CORS_ORIGINS = '*';
process.env.RATE_LIMIT_MAX = '1000';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:3203';
process.env.USERS_FILE = new URL('./fixtures/plugin-install-users.json', import.meta.url).pathname;
// PLUGIN-INSTALL-002 fail-closed: явно пустой секрет ('' уже в process.env →
// loadDotEnv не заполнит из .env). /p/ не должен отдавать полный JS.
process.env.PLUGIN_CODE_SECRET = '';
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
const base = 'http://127.0.0.1:3203';

const USER_A = {
  token: 'mo-aaaabbbbccccddddeeeeffff00001111',
  install: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234'
};
const STUB_TEXT = 'Добавьте плагин в Расширения Lampa';
const LAMPA_UA = 'Mozilla/5.0 (AppleTV; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Lampa/0.20.4';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const fetchAs = (ua, url) => fetch(url, { headers: { 'User-Agent': ua } });

before(async () => {
  await new Promise((resolve) => server.listen(3203, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('PLUGIN-INSTALL-002 fail-closed: без PLUGIN_CODE_SECRET /p/ не отдаёт код', () => {
  it('1. /p/<install>.js без секрета: 503 plugin_code_not_configured (Lampa, без JS/токена)', async () => {
    const response = await fetchAs(LAMPA_UA, `${base}/p/${USER_A.install}.js`);
    assert.equal(response.status, 503);
    assert.match(response.headers.get('content-type'), /^application\/json/);
    const body = await response.json();
    assert.equal(body.error, 'plugin_code_not_configured');
    assert.match(body.message, /PLUGIN_CODE_SECRET/);
    assert.ok(!JSON.stringify(body).includes(USER_A.token), 'без токена в ответе');
    assert.ok(!JSON.stringify(body).includes('MANIYA_API_BASE'), 'без кода плагина');
  });

  it('2. /p/<install>.js без секрета: 503 и для браузера (не stub, не JS)', async () => {
    const response = await fetchAs(BROWSER_UA, `${base}/p/${USER_A.install}.js`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, 'plugin_code_not_configured');
  });

  it('3. /x/<install>_<key>.js без секрета: 404 (ключ не матчится), не JS', async () => {
    // Даже с "правильным" на вид ключом: без секрета hiddenKeyMatches=false.
    const response = await fetchAs(LAMPA_UA, `${base}/x/${USER_A.install}_${'a'.repeat(24)}.js`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /^application\/json/);
    const body = await response.json();
    assert.ok(!JSON.stringify(body).includes(USER_A.token), 'без токена');
    assert.ok(!JSON.stringify(body).includes('MANIYA_API_BASE'), 'без кода');
  });

  it('4. /i/<install> без секрета: stub-текст (никогда JS, секрет не нужен)', async () => {
    const response = await fetchAs(BROWSER_UA, `${base}/i/${USER_A.install}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/plain/);
    assert.equal(await response.text(), STUB_TEXT);
  });
});
