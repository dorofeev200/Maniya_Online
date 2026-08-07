import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

import { KodikClient } from '../src/providers/kodik/KodikClient.js';

function fakeFetch(handler) {
  return async (url, options) => {
    handler(url, options);
    return {
      ok: true,
      json: async () => ({ results: [{ id: 'a', title: 'A', type: 'foreign-movie', link: 'l' }] }),
      text: async () => ''
    };
  };
}

test('KodikClient.enabled: только с токеном', () => {
  assert.equal(new KodikClient().enabled(), false);
  assert.equal(new KodikClient({ token: 't' }).enabled(), true);
});

test('KodikClient.searchByTitle: title = original_title, with_material_data=true', async () => {
  const urls = [];
  const client = new KodikClient({ token: 'tok', fetchImpl: fakeFetch((url) => urls.push(String(url))) });

  await client.searchByTitle({ title: 'Начало', originalTitle: 'Inception' });

  assert.equal(urls.length, 1);
  const parsed = new URL(urls[0]);
  assert.equal(parsed.searchParams.get('title'), 'Inception');
  assert.equal(parsed.searchParams.get('token'), 'tok');
  assert.equal(parsed.searchParams.get('limit'), '100');
  assert.equal(parsed.searchParams.get('with_episodes'), 'true');
  assert.equal(parsed.searchParams.get('with_material_data'), 'true');
});

test('KodikClient.searchByTitle: пустой запрос → [] без сети', async () => {
  let called = false;
  const client = new KodikClient({ token: 'tok', fetchImpl: fakeFetch(() => { called = true; }) });

  assert.deepEqual(await client.searchByTitle({}), []);
  assert.equal(called, false);
});

test('KodikClient.searchByIds: kp+imdb → два запроса, дедуп по id', async () => {
  const urls = [];
  const client = new KodikClient({ token: 'tok', fetchImpl: fakeFetch((url) => urls.push(String(url))) });

  const results = await client.searchByIds({ kinopoiskId: '111', imdbId: 'tt123' });

  // Оба запроса вернули один и тот же id — остаётся одна запись.
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'a');
  assert.equal(urls.length, 2);
  assert.ok(urls.some((u) => u.includes('kinopoisk_id=111')));
  assert.ok(urls.some((u) => u.includes('imdb_id=tt123')));
});

test('KodikClient.searchByIds: без id → [], season попадает в URL', async () => {
  const urls = [];
  const client = new KodikClient({ token: 'tok', fetchImpl: fakeFetch((url) => urls.push(String(url))) });

  assert.deepEqual(await client.searchByIds({}), []);
  assert.deepEqual(await client.searchByIds({ kinopoiskId: 0, imdbId: '' }), []);
  assert.equal(urls.length, 0);

  await client.searchByIds({ kinopoiskId: '1', season: 2 });
  const parsed = new URL(urls[0]);
  assert.equal(parsed.searchParams.get('season'), '2');
  assert.equal(parsed.searchParams.get('kinopoisk_id'), '1');
});

test('KodikClient: дефолтные хосты совпадают с Lampac (kodik-api.com/kodikres.com/kodikplayer.com)', () => {
  const client = new KodikClient({ token: 't' });
  // kodikapi.com не резолвится с 2026 — рабочий API-хост kodik-api.com.
  assert.equal(client.apiHost, 'https://kodik-api.com');
  assert.equal(client.linkHost, 'https://kodikres.com');
  assert.equal(client.playerHost, 'https://kodikplayer.com');
});

test('KodikClient.directStreams: d = yyyyMMddHH (+4ч), HMAC по link:ip:d', async () => {
  const urls = [];
  const secretToken = 'test-secret';
  const client = new KodikClient({ token: 'tok', secretToken, fetchImpl: fakeFetch((url) => urls.push(String(url))) });

  await client.directStreams('https://example.com/player/s1', '1.2.3.4');

  assert.equal(urls.length, 1);
  const parsed = new URL(urls[0]);
  const deadline = parsed.searchParams.get('d');
  assert.match(deadline, /^\d{10}$/, 'yyyyMMddHH');

  // d должен совпадать с +4 часа в том же формате.
  const pad = (n) => String(n).padStart(2, '0');
  const expected = new Date(Date.now() + 4 * 3600 * 1000);
  const expectedDeadline = `${expected.getFullYear()}${pad(expected.getMonth() + 1)}${pad(expected.getDate())}${pad(expected.getHours())}`;
  assert.equal(deadline, expectedDeadline);

  // HMAC-сообщение: link:ip:d, секрет = secret_token.
  const signature = parsed.searchParams.get('s');
  const expectedSignature = crypto.createHmac('sha256', secretToken)
    .update(`https://example.com/player/s1:1.2.3.4:${deadline}`)
    .digest('hex');
  assert.equal(signature, expectedSignature);

  assert.equal(parsed.searchParams.get('link'), 'https://example.com/player/s1');
  assert.equal(parsed.searchParams.get('p'), 'tok');
  assert.equal(parsed.searchParams.get('ip'), '1.2.3.4');
  assert.equal(parsed.searchParams.get('auto_proxy'), 'true');
  assert.equal(parsed.searchParams.get('skip_segments'), 'true');
});
