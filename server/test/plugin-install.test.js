import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.PORT = '3202';
process.env.CORS_ORIGINS = '*';
process.env.RATE_LIMIT_MAX = '1000';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:3202';
process.env.USERS_FILE = new URL('./fixtures/plugin-install-users.json', import.meta.url).pathname;
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

// Пользователи в fixtures/plugin-install-users.json (PLUGIN-INSTALL-001).
const USER_A = {
  token: 'mo-aaaabbbbccccddddeeeeffff00001111',
  install: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234'
};
const USER_B = {
  token: 'mo-11112222333344445555666677778888',
  install: 'efef5678efef5678efef5678efef5678efef5678efef5678'
};
const USER_C = {
  install: '9999abcd9999abcd9999abcd9999abcd9999abcd9999abcd'
};

before(async () => {
  await new Promise((resolve) => server.listen(3202, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('PLUGIN-INSTALL-001: opaque install-ссылки /i/ + /p/', () => {
  it('1. валидный /i/<opaque>: HTML-страница установки (200, text/html, содержит ссылку на плагин)', async () => {
    const response = await fetch(`${base}/i/${USER_A.install}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    const body = await response.text();
    assert.match(body, /MANIYA ONLINE/);
    assert.match(body, /Расширения Lampa/i);
    assert.match(body, new RegExp(`/p/${USER_A.install}\\.js`));
    assert.ok(body.includes('Скопировать'), 'есть кнопка копирования');
  });

  it('2. /i/ НИКОГДА не отдаёт JS и не содержит subscription-токен', async () => {
    const response = await fetch(`${base}/i/${USER_A.install}`);
    const ctype = response.headers.get('content-type');
    assert.ok(!/javascript/.test(ctype), `content-type ${ctype} не JS`);
    const body = await response.text();
    assert.ok(!body.startsWith('window.MANIYA_ONLINE_TOKEN'), 'не начинается с подписи JS');
    assert.ok(!body.includes(USER_A.token), 'реальный токен не в HTML');
  });

  it('3. валидный /p/<opaque>.js: 200, JS с вшитым subscription-токеном пользователя', async () => {
    const response = await fetch(`${base}/p/${USER_A.install}.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    const body = await response.text();
    assert.match(body, /window\.MANIYA_ONLINE_TOKEN="[^"]+"/);
    assert.ok(body.includes(`window.MANIYA_ONLINE_TOKEN=${JSON.stringify(USER_A.token)}`));
    assert.match(body, /MANIYA_API_BASE/);
  });

  it('4. несуществующий /i/<opaque>: 404 (без раскрытия данных)', async () => {
    const response = await fetch(`${base}/i/${'f'.repeat(48)}`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.ok(!JSON.stringify(body).includes('mo-'), 'в ошибке нет следов токена');
  });

  it('5. несуществующий /p/<opaque>.js: 404', async () => {
    const response = await fetch(`${base}/p/${'f'.repeat(48)}.js`);
    assert.equal(response.status, 404);
  });

  it('6. opaque-токен: случайный hex, НЕ равен и НЕ содержит subscription-токен (не выводим)', () => {
    for (const u of [USER_A, USER_B]) {
      assert.match(u.install, /^[0-9a-f]{32,}$/, 'install_token — длинный hex');
      assert.ok(!u.install.startsWith('mo-'), 'не префиксный формат subscription-токена');
      assert.notEqual(u.install, u.token, 'не равен subscription-токену');
      assert.ok(!u.install.includes(u.token), 'subscription-токен не подстрока install');
      assert.ok(!u.install.includes(u.token.split('-').pop()), 'hex-часть токена не подстрока install');
    }
    assert.notEqual(USER_A.install, USER_B.install, 'install-токены пользователей уникальны');
  });

  it('7. A/B изоляция: /i/ и /p/ не смешивают данные пользователей', async () => {
    const htmlA = await (await fetch(`${base}/i/${USER_A.install}`)).text();
    const htmlB = await (await fetch(`${base}/i/${USER_B.install}`)).text();
    const jsA = await (await fetch(`${base}/p/${USER_A.install}.js`)).text();
    const jsB = await (await fetch(`${base}/p/${USER_B.install}.js`)).text();

    assert.ok(htmlA.includes(`/p/${USER_A.install}.js`));
    assert.ok(!htmlA.includes(USER_B.install), 'A-страница не содержит install B');
    assert.ok(!htmlA.includes(USER_B.token), 'A-страница не содержит токен B');
    assert.ok(htmlB.includes(`/p/${USER_B.install}.js`));
    assert.ok(!htmlB.includes(USER_A.install), 'B-страница не содержит install A');
    assert.ok(!htmlB.includes(USER_A.token), 'B-страница не содержит токен A');

    assert.ok(jsA.includes(USER_A.token), 'A-JS вшивает токен A');
    assert.ok(!jsA.includes(USER_B.token), 'A-JS не содержит токен B');
    assert.ok(jsB.includes(USER_B.token), 'B-JS вшивает токен B');
    assert.ok(!jsB.includes(USER_A.token), 'B-JS не содержит токен A');
  });

  it('8. HTML содержит инструкцию установки (Добавьте плагин в расширения Lampa)', async () => {
    const body = await (await fetch(`${base}/i/${USER_A.install}`)).text();
    assert.match(body, /Добавьте плагин в расширения Lampa/);
    assert.match(body, /Настройки → Расширения/);
  });

  it('9. JS Content-Type — application/javascript', async () => {
    const response = await fetch(`${base}/p/${USER_A.install}.js`);
    assert.match(response.headers.get('content-type'), /^application\/javascript/);
  });

  it('10. существующий Lampa-флоу не сломан: короткая ссылка /{slug}_{short}.js и статика /maniya-online.js', async () => {
    // A: mo-aaaabbbbccccddddeeeeffff00001111 → последние 12 hex: ffff00001111
    const short = await fetch(`${base}/user-a_ffff00001111.js`);
    assert.equal(short.status, 200);
    assert.match(short.headers.get('content-type'), /javascript/);
    assert.ok((await short.text()).includes(`window.MANIYA_ONLINE_TOKEN=${JSON.stringify(USER_A.token)}`));

    const staticJs = await fetch(`${base}/maniya-online.js`);
    assert.equal(staticJs.status, 200);
    assert.match(staticJs.headers.get('content-type'), /javascript/);
    assert.match(staticJs.headers.get('cache-control'), /max-age=300/);
  });

  it('11. существующие API-вызовы работают (subscription/check по реальному токену)', async () => {
    const response = await fetch(`${base}/api/lampa/subscription/check?token=${USER_A.token}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.authorized, true);
    assert.equal(body.active, true);
  });

  it('12. в HTML нет credentials (ни токена A, ни токена B)', async () => {
    const htmlA = await (await fetch(`${base}/i/${USER_A.install}`)).text();
    const htmlB = await (await fetch(`${base}/i/${USER_B.install}`)).text();
    assert.ok(!htmlA.includes(USER_A.token));
    assert.ok(!htmlA.includes(USER_B.token));
    assert.ok(!htmlB.includes(USER_A.token));
    assert.ok(!htmlB.includes(USER_B.token));
  });

  it('13. в URL нет subscription-токена — только opaque install', async () => {
    const installUrl = `${base}/i/${USER_A.install}`;
    const pluginUrl = `${base}/p/${USER_A.install}.js`;
    assert.ok(!installUrl.includes(USER_A.token), 'install-URL без реального токена');
    assert.ok(!pluginUrl.includes(USER_A.token), 'plugin-URL без реального токена');
    assert.match(installUrl, /\/i\/[0-9a-f]{32,}$/);
    assert.match(pluginUrl, /\/p\/[0-9a-f]{32,}\.js$/);
  });

  it('14. кэш-заголовки: HTML и JS no-store; повторные ответы юзера одинаковы, чужой — другой', async () => {
    const htmlA1 = await fetch(`${base}/i/${USER_A.install}`);
    const htmlA2 = await fetch(`${base}/i/${USER_A.install}`);
    const htmlB = await fetch(`${base}/i/${USER_B.install}`);
    const jsA = await fetch(`${base}/p/${USER_A.install}.js`);
    assert.match(htmlA1.headers.get('cache-control'), /no-store/);
    assert.match(htmlB.headers.get('cache-control'), /no-store/);
    assert.match(jsA.headers.get('cache-control'), /no-store/);

    const bodyA1 = await htmlA1.text();
    const bodyA2 = await htmlA2.text();
    const bodyB = await htmlB.text();
    assert.equal(bodyA1, bodyA2, 'тот же пользователь — идентичный HTML');
    assert.notEqual(bodyA1, bodyB, 'другой пользователь — другой HTML (нет переклейки)');
  });

  it('доп: неактивный пользователь — /i/ и /p/ → 403 (подписка)', async () => {
    const h = await fetch(`${base}/i/${USER_C.install}`);
    assert.equal(h.status, 403);
    const p = await fetch(`${base}/p/${USER_C.install}.js`);
    assert.equal(p.status, 403);
  });

  it('доп: короткий /i/<opaque> (< 32 hex) не валиден (анти-гадалка)', async () => {
    const response = await fetch(`${base}/i/abcd1234`);
    assert.equal(response.status, 404);
  });
});
