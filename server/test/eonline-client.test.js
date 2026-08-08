import test from 'node:test';
import assert from 'node:assert/strict';

import { EoClient, isUsablePage } from '../src/providers/eonline/EoClient.js';
import { HttpError } from '../src/errors.js';

function fakeFetch(handler) {
  return async (url, options = {}) => handler(String(url), options);
}

function response(status, body = '', url = 'http://final.example/x') {
  return {
    status,
    ok: status >= 200 && status < 300,
    url,
    headers: {},
    body: { cancel: () => {} },
    text: async () => String(body)
  };
}

const ACCOUNT = { accountEmail: 'user@example.com', uid: 'abc123' };

test('enabled(): нужны балансер+аккаунт+uid', () => {
  assert.equal(new EoClient({ balancer: 'filmix' }).enabled(), false);
  assert.equal(new EoClient({ balancer: 'filmix', ...ACCOUNT }).enabled(), true);
});

test('buildLiteUrl: auth-параметры и ротация хостов', () => {
  const client = new EoClient({ balancer: 'rezka', hosts: ['http://h1', 'http://h2'], ...ACCOUNT });
  const url = client.buildLiteUrl({ title: 'Game' });

  assert.ok(url.startsWith('http://h1/lite/rezka?'));
  assert.ok(url.includes('title=Game'));
  assert.ok(url.includes('account_email=user%40example.com'));
  assert.ok(url.includes('uid=abc123'));

  // следующий вызов — следующий хост
  const url2 = client.buildLiteUrl({});
  assert.ok(url2.startsWith('http://h2/lite/rezka?'));
});

test('getLite: HTML проходит, rch/JSON/null/503 → null', async () => {
  const client = new EoClient({
    balancer: 'x',
    ...ACCOUNT,
    fetchImpl: (url) => {
      if (url.includes('rch=1')) return Promise.resolve(response(200, '{"rch":true}'));
      if (url.includes('json=1')) return Promise.resolve(response(200, '[{"name":"x"}]'));
      if (url.includes('null=1')) return Promise.resolve(response(200, 'null'));
      if (url.includes('err=1')) return Promise.resolve(response(503, 'disable'));
      return Promise.resolve(response(200, '<div class="videos__item">ok</div>'));
    }
  });

  assert.ok(await client.getLite({}));
  assert.equal(await client.getLite({ rch: 1 }), null);
  assert.equal(await client.getLite({ json: 1 }), null);
  assert.equal(await client.getLite({ null: 1 }), null);
  assert.equal(await client.getLite({ err: 1 }), null);
});

test('resolveStream: финальный URL после redirect', async () => {
  const client = new EoClient({
    balancer: 'x',
    ...ACCOUNT,
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      url: 'http://magic.stream.voidboost.one/s/key/manifest.m3u8',
      headers: {},
      body: { cancel: () => {} },
      text: async () => ''
    })
  });

  const final = await client.resolveStream('http://online3.skaz.tv/lite/x/movie.m3u8?play=true&uid=SECRET');
  assert.equal(final, 'http://magic.stream.voidboost.one/s/key/manifest.m3u8');

  // auth-параметры не утекли наружу (финальный url без них)
  assert.ok(!final.includes('SECRET'));
  assert.ok(!final.includes('account_email'));
});

test('resolveStream: пустая ссылка → ошибка', async () => {
  const client = new EoClient({ balancer: 'x', ...ACCOUNT });
  await assert.rejects(
    () => client.resolveStream(''),
    (e) => e instanceof HttpError && e.code === 'eonline_no_stream'
  );
});

test('openLiteUrl: auth дописывается к URL карточки', async () => {
  const seen = [];
  const client = new EoClient({
    balancer: 'x',
    ...ACCOUNT,
    fetchImpl: (url) => {
      seen.push(url);
      return Promise.resolve(response(200, '<div class="videos__item">ok</div>'));
    }
  });

  await client.openLiteUrl('http://online3.skaz.tv/lite/x/serial?s=1');
  assert.ok(seen[0].includes('account_email=user%40example.com'));
  assert.ok(seen[0].includes('uid=abc123'));
});

test('HTTP 5xx — источник недоступен (null)', async () => {
  const client = new EoClient({
    balancer: 'x',
    ...ACCOUNT,
    fetchImpl: async () => response(503, 'disable')
  });
  assert.equal(await client.getLite({}), null);
});

test('isUsablePage: html ок, json/null/disable — нет', () => {
  const html = '<div class="videos__item">x</div> <!DOCTYPE html>';
  assert.equal(isUsablePage(html), true);
  assert.equal(isUsablePage('{"rch": true}'), false);
  assert.equal(isUsablePage('null'), false);
  assert.equal(isUsablePage('disable'), false);
  assert.equal(isUsablePage(''), false);
});