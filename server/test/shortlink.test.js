import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.PORT = '3201';
process.env.CORS_ORIGINS = '*';
process.env.RATE_LIMIT_MAX = '1000';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:3201';
process.env.USERS_FILE = new URL('./fixtures/shortlink-users.json', import.meta.url).pathname;
// Не дёргать реальную сеть.
process.env.FILMIX_ENABLED = '0';
process.env.KODIK_ENABLED = '0';
process.env.REZKA_ENABLED = '0';
process.env.ALLOHA_ENABLED = '0';
process.env.RUTUBEMOVIE_ENABLED = '0';
process.env.CDNVIDEOHUB_ENABLED = '0';
process.env.COLLAPS_ENABLED = '0';
process.env.HDVB_ENABLED = '0';

const { server } = await import('../src/index.js');
const base = 'http://127.0.0.1:3201';

// PLUGIN-INSTALL-002: шортлинк отдаёт JS только Lampa; браузер — stub-текст.
const LAMPA_UA = 'Mozilla/5.0 (AppleTV; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Lampa/0.20.4';
const lampaFetch = (url) => fetch(url, { headers: { 'User-Agent': LAMPA_UA } });

// Пользователи в fixtures/shortlink-users.json.
const ACTIVE_OK = { short: '444444444444', token: 'mo-44444444444444444444444444444444' };
const INACTIVE = { short: '999999999999' };

before(async () => {
  await new Promise((resolve) => server.listen(3201, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('Короткая ссылка плагина /<prefix>_<short>.js', () => {
  it('активный пользователь: 200, плагин с вшитым токеном', async () => {
    const response = await lampaFetch(`${base}/dorofeev200_${ACTIVE_OK.short}.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const body = await response.text();
    assert.match(body, new RegExp(`window.MANIYA_ONLINE_TOKEN=${JSON.stringify(ACTIVE_OK.token)}`));
    assert.match(body, /MANIYA_API_BASE/);
  });

  it('префикс произвольный, главное правильно суффикс токена', async () => {
    const response = await lampaFetch(`${base}/whatever_${ACTIVE_OK.short}.js`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /MANIYA_ONLINE_TOKEN=./);
  });

  it('шортлинк в браузере — stub-текст, не JS (PLUGIN-INSTALL-002)', async () => {
    const response = await fetch(`${base}/dorofeev200_${ACTIVE_OK.short}.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/plain/);
    assert.equal(await response.text(), 'Добавьте плагин в Расширения Lampa.');
  });

  it('неактивный пользователь: 403 (подписка истекла)', async () => {
    const response = await fetch(`${base}/dorofeev200_${INACTIVE.short}.js`);
    assert.equal(response.status, 403);
  });

  it('несуществующий суффикс: 404', async () => {
    const response = await fetch(`${base}/dorofeev200_000000000000.js`);
    assert.equal(response.status, 404);
  });

  it('суффикс короче 8 hex не срабатывает (уходит в статику → 404)', async () => {
    const response = await fetch(`${base}/dorofeev200_123.js`);
    assert.equal(response.status, 404);
  });
});