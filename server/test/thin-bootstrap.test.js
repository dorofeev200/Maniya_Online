// SKAZ-MANIYA-052: bootstrap тонкого клиента — юнит buildThinBootstrap + маршрут
// GET /api/lampa/thin/bootstrap (Bearer-гейт). Env ставится ДО динамического
// import (config.js читает process.env при первом import).
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = '*';
process.env.RATE_LIMIT_MAX = '1000';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:3357';
process.env.USERS_FILE = new URL('./fixtures/users.json', import.meta.url).pathname;
process.env.VIDEOS_FILE = new URL('./fixtures/videos.json', import.meta.url).pathname;
process.env.SKAZ_ENABLED = '1';
process.env.SKAZ_HOSTS = 'http://online3.skaz.tv,http://online8.skaz.tv,http://94.249.239.63';
process.env.SKAZ_ACCOUNT_EMAIL = 'probe@maniya.test';
process.env.SKAZ_UID = 'probe-uid';
process.env.SKAZ_THIN_ENABLED = '1';
process.env.SKAZ_THIN_MODULES = 'alloha,lordfilm';

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { buildThinBootstrap } = await import('../src/providers/skaz/thin-bootstrap.js');
const { config } = await import('../src/config.js');
const { server } = await import('../src/index.js');

const base = 'http://127.0.0.1:3357';
const TOKEN = 'unit-test-token';
const IP_RE = /^https?:\/\/\d{1,3}(\.\d{1,3}){3}/;

before(async () => {
  await new Promise((resolve) => server.listen(3357, '127.0.0.1', resolve));
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('buildThinBootstrap (unit)', () => {
  it('on: полный ответ — enabled, modules, креды, клиентские хосты; НИКАКИХ секретов/прокси', () => {
    const bs = buildThinBootstrap();
    assert.ok(bs);
    assert.equal(bs.enabled, true);
    assert.deepEqual(bs.modules, ['alloha', 'lordfilm']);
    assert.equal(bs.ttl_s, 600);
    assert.equal(bs.skaz.account_email, 'probe@maniya.test');
    assert.equal(bs.skaz.uid, 'probe-uid');
    assert.deepEqual(bs.skaz.lite_hosts, ['http://online3.skaz.tv', 'http://online8.skaz.tv']);
    assert.deepEqual(bs.skaz.ws_hosts, ['ws://online3.skaz.tv', 'ws://online8.skaz.tv']);

    const raw = JSON.stringify(bs);
    assert.ok(!raw.includes('/proxy'), 'bootstrap не отдаёт /proxy');
    assert.ok(!raw.includes('94.249.239'), 'серверные IP не светятся клиенту');
    assert.ok(!raw.includes('token'), 'никаких токенов в bootstrap');
    for (const h of bs.skaz.lite_hosts) assert.ok(!IP_RE.test(h), `${h}: hostname, не IP`);
  });

  it('off (флаг выключен) → null', () => {
    config.skaz.thin.enabled = false;
    try {
      assert.equal(buildThinBootstrap(), null);
    } finally {
      config.skaz.thin.enabled = true;
    }
  });

  it('пустой allowlist → null', () => {
    config.skaz.thin.modules = [];
    try {
      assert.equal(buildThinBootstrap(), null);
    } finally {
      config.skaz.thin.modules = ['alloha', 'lordfilm'];
    }
  });
});

describe('GET /api/lampa/thin/bootstrap (route)', () => {
  it('валидный токен + флаг on → 200 enabled:true, ответ без /proxy и токенов', async () => {
    const r = await fetch(`${base}/api/lampa/thin/bootstrap?token=${TOKEN}`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.enabled, true);
    assert.ok(Array.isArray(body.modules) && body.modules.includes('lordfilm'));
    assert.ok(body.skaz && body.skaz.account_email === 'probe@maniya.test');
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes('/proxy'), 'маршрут не отдаёт /proxy');
    assert.ok(!raw.includes('token'), 'маршрут не отдаёт токены');
  });

  it('флаг off → 200 {enabled:false} БЕЗ полей skaz (PROD-вид)', async () => {
    config.skaz.thin.enabled = false;
    try {
      const r = await fetch(`${base}/api/lampa/thin/bootstrap?token=${TOKEN}`);
      assert.equal(r.status, 200);
      const body = await r.json();
      assert.equal(body.enabled, false);
      assert.equal(body.skaz, undefined, 'off: поля skaz отсутствуют');
    } finally {
      config.skaz.thin.enabled = true;
    }
  });

  it('нет/мёртвый токен → 403 subscription_required', async () => {
    await fetch(`${base}/api/lampa/thin/bootstrap`).then((r) => {
      assert.equal(r.status, 403);
      return r.json().then((b) => assert.equal(b.error, 'subscription_required'));
    });
    const r = await fetch(`${base}/api/lampa/thin/bootstrap?token=dead-token`);
    assert.equal(r.status, 403);
  });
});