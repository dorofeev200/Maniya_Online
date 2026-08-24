import test from 'node:test';
import assert from 'node:assert/strict';

import { SkazClient, parseEventsOnline } from '../src/providers/skaz/SkazClient.js';

function response(status, body = '') {
  return {
    status,
    ok: status >= 200 && status < 300,
    url: 'http://final.example/x',
    headers: {},
    body: { cancel: () => {} },
    text: async () => String(body)
  };
}

const ACCOUNT = { accountEmail: 'user@example.com', uid: 'abc123' };
const HOSTS = ['http://h1', 'http://h2', 'http://h3'];

// Пример онлайн[] из свежего baseline (docs/t019), санированный.
const ONLINE = [
  { name: 'KinoPub', url: 'http://online8.skaz.tv/lite/kinopub', index: 1, show: true, balanser: 'kinopub', rch: false, voices: 4, seasons: 0 },
  { name: 'Filmix ~ 4K', url: 'http://online3.skaz.tv/lite/filmix?account_email=secret@x&uid=abc', index: 2, show: true, balanser: 'filmix', rch: false, voices: 0, seasons: 0 },
  { name: 'Ashdi', url: 'http://online3.skaz.tv/lite/ashdi', index: 13, show: true, balanser: 'ashdi', rch: true, voices: 2, seasons: 0 },
  { name: 'LordFilm', url: 'http://online3.skaz.tv/lite/lordfilm', index: 30, show: false, balanser: 'lordfilm', rch: false, voices: 0, seasons: 0 }
];

test('parseEventsOnline: объект-форма {"online":[…]}; поля preserved, url-query срезается', () => {
  const out = parseEventsOnline(JSON.stringify({ online: ONLINE, ready: true }));
  assert.equal(out.length, 4);
  assert.equal(out[0].name, 'KinoPub');
  assert.equal(out[0].index, 1);
  assert.equal(out[0].show, true);
  assert.equal(out[0].balanser, 'kinopub');
  assert.equal(out[0].rch, false);
  assert.equal(out[0].voices, 4);
  assert.equal(out[1].url, 'http://online3.skaz.tv/lite/filmix', 'auth-query из url срезается');
  assert.equal(out[2].rch, true, 'rch:true preserved');
  assert.equal(out[3].show, false, 'show:false preserved (ghost)');
});

test('parseEventsOnline: голая JSON-массив-форма', () => {
  const out = parseEventsOnline(JSON.stringify(ONLINE));
  assert.equal(out.length, 4);
  assert.equal(out[0].balanser, 'kinopub');
});

test('parseEventsOnline: запись без balanser отбрасывается; пустой [] валиден', () => {
  const mixed = [...ONLINE, { name: 'Ghost', url: '', index: 0, show: true, rch: false }];
  const out = parseEventsOnline(JSON.stringify({ online: mixed }));
  assert.equal(out.length, 4, 'запись без balanser не попадает в модель');
  assert.deepEqual(parseEventsOnline(JSON.stringify({ online: [] })), [], 'пустой online[] — валидный «источников нет»');
  assert.deepEqual(parseEventsOnline(JSON.stringify([])), [], 'голый пустой массив — валиден');
});

test('parseEventsOnline: невалидное → null', () => {
  assert.equal(parseEventsOnline(''), null);
  assert.equal(parseEventsOnline('not json'), null);
  assert.equal(parseEventsOnline('null'), null);
  assert.equal(parseEventsOnline('{"accsdb":true,"msg":"x"}'), null, 'accsdb → null (нет online)');
  assert.equal(parseEventsOnline('{"foo":1}'), null, 'нет поля online');
  assert.equal(parseEventsOnline('42'), null);
});

test('buildEventsUrl: lite/events с auth; НЕ сдвигает ротацию (стабилен)', () => {
  const client = new SkazClient({ balancer: 'filmix', hosts: HOSTS, ...ACCOUNT });
  const url1 = client.buildEventsUrl({ id: '1288445', title: 'Мятеж' });
  const url2 = client.buildEventsUrl({});
  assert.ok(url1.startsWith('http://h1/lite/events?'));
  assert.ok(url1.includes('id=1288445'));
  assert.ok(url1.includes('account_email=user%40example.com'));
  assert.ok(url1.includes('uid=abc123'));
  assert.equal(url1.slice(0, url1.indexOf('?')), url2.slice(0, url2.indexOf('?')), 'ротация не сдвигается');
});

test('getOnline: первый валидный online[] → стоп (даже после не-2xx ноды)', async () => {
  let calls = 0;
  const client = new SkazClient({
    balancer: 'filmix',
    hosts: HOSTS,
    ...ACCOUNT,
    fetchImpl: (url) => {
      calls += 1;
      if (url.startsWith('http://h1')) return Promise.resolve(response(503, 'disable'));
      if (url.startsWith('http://h2')) return Promise.resolve(response(200, JSON.stringify({ online: ONLINE })));
      throw new Error('не должен дойти до h3');
    }
  });
  const out = await client.getOnline({ id: 'x' }, { timeoutMs: 500 });
  assert.equal(out.length, 4);
  assert.equal(calls, 2, 'первая нода 503 → вторая валидная → стоп');
  assert.equal(out[0].balanser, 'kinopub');
});

test('getOnline: невалидный JSON на всех нодах → null (не частичная модель)', async () => {
  const client = new SkazClient({
    balancer: 'filmix',
    hosts: HOSTS,
    ...ACCOUNT,
    fetchImpl: () => Promise.resolve(response(200, 'garbage'))
  });
  assert.equal(await client.getOnline({}, { timeoutMs: 200 }), null);
});

test('getOnline: accsdb на ноде → следующая нода → null при пуле', async () => {
  const client = new SkazClient({
    balancer: 'filmix',
    hosts: HOSTS,
    ...ACCOUNT,
    fetchImpl: () => Promise.resolve(response(200, '{"accsdb":true,"msg":"Аккаунт не найден"}'))
  });
  assert.equal(await client.getOnline({}, { timeoutMs: 200 }), null);
});

test('getOnline: резолв fetch 0 (timeout/сеть) → following нода; пул исчерпан → null', async () => {
  const client = new SkazClient({
    balancer: 'filmix',
    hosts: HOSTS,
    ...ACCOUNT,
    fetchImpl: (url) => {
      if (url.startsWith('http://h3')) return Promise.resolve(response(200, JSON.stringify(ONLINE)));
      return Promise.resolve(null);
    }
  });
  const out = await client.getOnline({}, { timeoutMs: 200 });
  assert.equal(out.length, 4);
});

test('getOnline: пустой online[] — валиден и останавливает обход', async () => {
  let calls = 0;
  const client = new SkazClient({
    balancer: 'filmix',
    hosts: HOSTS,
    ...ACCOUNT,
    fetchImpl: () => {
      calls += 1;
      return Promise.resolve(response(200, JSON.stringify({ online: [] })));
    }
  });
  const out = await client.getOnline({}, { timeoutMs: 200 });
  assert.deepEqual(out, []);
  assert.equal(calls, 1, 'пустой online[] — валидный ответ → стоп на первой ноде');
});

test('getOnline: buildEventsUrl без хостов → null', async () => {
  const client = new SkazClient({ balancer: 'filmix', hosts: [], ...ACCOUNT });
  assert.equal(await client.getOnline({}), null);
});