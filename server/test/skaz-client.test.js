import test from 'node:test';
import assert from 'node:assert/strict';

import { SkazClient, isUsablePage, isRchPayload, isAccsdbPayload } from '../src/providers/skaz/SkazClient.js';
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
  assert.equal(new SkazClient({ balancer: 'filmix' }).enabled(), false);
  assert.equal(new SkazClient({ balancer: 'filmix', ...ACCOUNT }).enabled(), true);
});

test('buildLiteUrl: auth-параметры и ротация хостов', () => {
  const client = new SkazClient({ balancer: 'rezka', hosts: ['http://h1', 'http://h2'], ...ACCOUNT });
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
  const client = new SkazClient({
    balancer: 'x',
    ...ACCOUNT,
    fetchImpl: (url) => {
      if (url.includes('rch=1')) return Promise.resolve(response(200, '{"rch":true}'));
      if (url.includes('json=1')) return Promise.resolve(response(200, '[{"name":"x"}]'));
      if (url.includes('accsdb=1')) return Promise.resolve(response(200, '{"accsdb":true,"msg":"Аккаунт не найден"}'));
      if (url.includes('null=1')) return Promise.resolve(response(200, 'null'));
      if (url.includes('err=1')) return Promise.resolve(response(503, 'disable'));
      return Promise.resolve(response(200, '<div class="videos__item">ok</div>'));
    }
  });

  assert.ok(await client.getLite({}));
  assert.equal(await client.getLite({ rch: 1 }), null);
  assert.equal(await client.getLite({ json: 1 }), null);
  assert.equal(await client.getLite({ accsdb: 1 }), null, 'неверная пара email+uid → null');
  assert.equal(await client.getLite({ null: 1 }), null);
  assert.equal(await client.getLite({ err: 1 }), null);
});

test('discover: withsearch — парсит список балансеров', async () => {
  const client = new SkazClient({
    balancer: 'filmix',
    ...ACCOUNT,
    fetchImpl: (url) => {
      assert.ok(url.includes('/lite/withsearch'), 'discover должен идти на withsearch');
      return Promise.resolve(response(200, '<a href="/lite/filmix">filmix</a><a href="/lite/rezka">rezka</a>'));
    }
  });

  const list = await client.discover();
  assert.deepEqual(list, ['filmix', 'rezka']);
});

test('discover: JSON-массив и null при недоступности', async () => {
  const jsonClient = new SkazClient({
    balancer: 'filmix',
    ...ACCOUNT,
    fetchImpl: async () => response(200, '["filmix","rezka"]')
  });
  assert.deepEqual(await jsonClient.discover(), ['filmix', 'rezka']);

  const empty = new SkazClient({
    balancer: 'filmix',
    fetchImpl: async () => response(200, '<html>no list</html>')
  });
  empty.accountEmail = ACCOUNT.accountEmail;
  empty.uid = ACCOUNT.uid;
  assert.equal(await empty.discover(), null);
});

test('resolveStream: финальный URL после redirect', async () => {
  const client = new SkazClient({
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
  const client = new SkazClient({ balancer: 'x', ...ACCOUNT });
  await assert.rejects(
    () => client.resolveStream(''),
    (e) => e instanceof HttpError && e.code === 'skaz_no_stream'
  );
});

test('openLiteUrl: auth дописывается к URL карточки', async () => {
  const seen = [];
  const client = new SkazClient({
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
  const client = new SkazClient({
    balancer: 'x',
    ...ACCOUNT,
    fetchImpl: async () => response(503, 'disable')
  });
  assert.equal(await client.getLite({}), null);
});

test('ретрай по хостам: 5xx на одном хосте → карточки со следующего хоста', async () => {
  const seen = [];
  const client = new SkazClient({
    balancer: 'x',
    hosts: ['http://h1', 'http://h2', 'http://h3'],
    ...ACCOUNT,
    fetchImpl: (url) => {
      seen.push(url);
      if (url.includes('h1')) return Promise.resolve(response(503, 'disable'));
      return Promise.resolve(response(200, '<div class="videos__item">ok</div>'));
    }
  });

  const html = await client.getLite({ title: 'Game' });
  assert.ok(html, 'после 503 на h1 должен прийти HTML со следующего хоста');
  // первый кандидат — выбранный buildLiteUrl хост (h1), затем h2, h3 — по порядку.
  assert.ok(seen[0].startsWith('http://h1/lite/x?'));
  assert.ok(seen[1].startsWith('http://h2/lite/x?'));
  assert.equal(seen.length, 2, 'достаточно двух хостов: h1 503, h2 OK');
});

test('ретрай по хостам: весь пул мёртв → null', async () => {
  const seen = [];
  const client = new SkazClient({
    balancer: 'x',
    hosts: ['http://h1', 'http://h2'],
    ...ACCOUNT,
    fetchImpl: (url) => {
      seen.push(url);
      return Promise.resolve(response(503, 'disable'));
    }
  });

  assert.equal(await client.getLite({}), null);
  assert.equal(seen.length, 2, 'перебрали оба хоста пула');
});

test('ретрай по хостам: rch/JSON (200) НЕ перебирает хосты — это «нет источника»', async () => {
  const seen = [];
  const client = new SkazClient({
    balancer: 'x',
    hosts: ['http://h1', 'http://h2'],
    ...ACCOUNT,
    fetchImpl: (url) => {
      seen.push(url);
      return Promise.resolve(response(200, '{"rch":true}'));
    }
  });

  assert.equal(await client.getLite({}), null);
  assert.equal(seen.length, 1, '200-ответ не запускает перебор хостов');
});

test('openLiteUrl: 5xx на хосте карточки → страница с другого хоста пула', async () => {
  const seen = [];
  const client = new SkazClient({
    balancer: 'x',
    hosts: ['http://online3.skaz.tv', 'http://online8.skaz.tv'],
    ...ACCOUNT,
    fetchImpl: (url) => {
      seen.push(url);
      if (url.startsWith('http://online3.skaz.tv')) return Promise.resolve(response(503, 'disable'));
      return Promise.resolve(response(200, '<div class="videos__item">ok</div>'));
    }
  });

  const html = await client.openLiteUrl('http://online3.skaz.tv/lite/x/serial?s=1');
  assert.ok(html);
  assert.ok(seen[0].startsWith('http://online3.skaz.tv/lite/x/serial?s=1'));
  assert.ok(seen[0].includes('account_email=user%40example.com'));
  assert.ok(seen[1].startsWith('http://online8.skaz.tv/lite/x/serial?s=1'));
});

test('resolveStream: НЕ ротирует хосты (потоки CDN-токеновые)', async () => {
  const seen = [];
  const client = new SkazClient({
    balancer: 'x',
    hosts: ['http://h1', 'http://h2'],
    ...ACCOUNT,
    fetchImpl: async (url) => {
      seen.push(url);
      return {
        status: 200,
        ok: true,
        url: 'http://magic.stream/key/manifest.m3u8',
        headers: {},
        body: { cancel: () => {} },
        text: async () => 'm3u8'
      };
    }
  });

  const final = await client.resolveStream('http://h1/lite/x/movie.m3u8?play=true');
  assert.equal(seen.length, 1, 'резолв потока — один запрос, без перебора хостов');
  assert.ok(final.includes('magic.stream'));
});

test('isUsablePage / isRchPayload / isAccsdbPayload', () => {
  const html = '<div class="videos__item">x</div> <!DOCTYPE html>';
  assert.equal(isUsablePage(html), true);
  assert.equal(isUsablePage('{"rch": true}'), false);
  assert.equal(isUsablePage('{"accsdb":true}'), false);
  assert.equal(isUsablePage('null'), false);
  assert.equal(isUsablePage('disable'), false);
  assert.equal(isUsablePage(''), false);

  assert.equal(isRchPayload('{"rch":true}'), true);
  assert.equal(isRchPayload('<div>x</div>'), false);
  assert.equal(isAccsdbPayload('{"accsdb":true,"msg":"x"}'), true);
  assert.equal(isAccsdbPayload('<div>x</div>'), false);
});