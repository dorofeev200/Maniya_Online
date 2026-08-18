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

// ===== TASK-KODIK-002: AMS-плеер (2026+) без secret_token =====
// Upstream перешёл на AMS-подпись: HTML больше не содержит inline-{links} и
// video-links/get-video. Рабочий без-секрета путь — Lampac VideoParse:
// POST {linkHost}{uri} (uri = atob из app.player_*.js) с var-глобалами страницы,
// src шифруется shift+18 → URL-base64.

const AMS_HTML = `
<!doctype html><html><head><title>Kodik Player</title></head><body>
<script type="text/javascript">
var advertDebug = true; var domain = "kodikplayer.com"; var d_sign = "sig-d";
var pd = "kodikplayer.com"; var pd_sign = "sig-pd";
var ref = "https://kodikplayer.com/"; var ref_sign = "sig-ref";
var user_ip = "1.2.3.4";
</script>
<script>var vInfo = {}; vInfo.type = 'video'; var videoId = "39523";
vInfo.hash = '3e3c091400ff81435c1ac207f9ddbe8f'; vInfo.id = '39523';</script>
<script src="/assets/js/app.player_single.deadbeef.js"></script>
</body></html>`;

// Известная пара «зашифрованный src → m3u8» (захвачена с upstream 17.08.2026,
// 480p фильма 39523). Сдвиг +18 НЕ применён — это сырой src из AMS-ответа.
const AMS_SRC_ENCRYPTED = 'iPZ0kPU6Tg9hi3sck29aj2ZrHO4cG29bT21dluttkg84GEM3WEUeWLCeHuVtVrUgVOCeULHuHBptVOHqU2Y3UhI2Vro3UBHtThs2Uhs3GuM0UhZsWLJtVOM5G2RtGBY1WLQhHBVsG2Y3WrQeUrGeWLM4ULodVLoeTu1eVLxwjPU6jENciEHtk3YcjBV1WI';
const AMS_SRC_DECODED = 'https://sky.solodcdn.com/movies/8aa79c0850fce6324e006fe8e4fb3d730668716e/96397ba434d80e4a9cbea45823e3dcd7:2026081808/480.mp4:hls:manifest.m3u8';

function amsFetch(handler) {
  return async (url, options) => {
    handler(url, options);
    if (String(url).includes('/video/')) {
      return { ok: true, json: async () => ({ results: [] }), text: async () => AMS_HTML };
    }
    if (String(url).includes('app.player')) {
      return { ok: true, json: async () => ({}), text: async () => 'type:"POST",url:atob("L2Z0b3I=")' }; // base64('/ftor')
    }
    if (String(url).includes('/ftor')) {
      return {
        ok: true,
        json: async () => ({
          default: 360,
          links: { '480': [{ src: AMS_SRC_ENCRYPTED, type: 'application/x-mpegURL' }] }
        }),
        text: async () => ''
      };
    }
    return { ok: true, json: async () => ({ results: [] }), text: async () => '' };
  };
}

test('KodikClient.parsePlayer: AMS-плеер — POST {linkHost}{postUri} с глобалами', async () => {
  const urls = [];
  const calls = [];
  const client = new KodikClient({ token: 'tok', linkHost: 'https://kodikres.com', fetchImpl: amsFetch((url, options) => { urls.push(String(url)); calls.push({ url: String(url), options }); }) });

  const result = await client.parsePlayer('//kodikplayer.com/video/39523/3e3c091400ff81435c1ac207f9ddbe8f/720p');

  // fetch порядка: страница плеера, app.player js, POST /ftor
  const post = calls.find((c) => c.url.endsWith('/ftor'));
  assert.ok(post, 'POST к {linkHost}{postUri} выполнен');
  assert.equal(post.options.method, 'POST');
  const body = new URLSearchParams(post.options.body);
  assert.equal(body.get('d'), 'kodikplayer.com');
  assert.equal(body.get('d_sign'), 'sig-d');
  assert.equal(body.get('pd'), 'kodikplayer.com');
  assert.equal(body.get('pd_sign'), 'sig-pd');
  assert.equal(body.get('ref'), 'https://kodikplayer.com/');
  assert.equal(body.get('ref_sign'), 'sig-ref');
  assert.equal(body.get('type'), 'video');
  assert.equal(body.get('hash'), '3e3c091400ff81435c1ac207f9ddbe8f');
  assert.equal(body.get('id'), '39523');
  assert.equal(body.get('bad_user'), 'false');
  assert.equal(body.get('cdn_is_working'), 'true');

  // src расшифрован через shift+18 → URL-base64
  const src = result.links['480'][0].Src;
  assert.equal(src, AMS_SRC_DECODED);
});

test('KodikClient.parsePlayer: AMS-ответ сохраняет формат {links:{q:[{src}]}}', async () => {
  const client = new KodikClient({ token: 'tok', linkHost: 'https://kodikres.com', fetchImpl: amsFetch(() => {}) });

  const result = await client.parsePlayer('//kodikplayer.com/video/39523/3e3c091400ff81435c1ac207f9ddbe8f/720p');

  assert.deepEqual(Object.keys(result.links), ['480']);
  assert.ok(Array.isArray(result.links['480']));
  assert.ok(result.links['480'][0].Src.startsWith('https://'));
});

test('KodikClient.parsePlayer: без AMS-глобалов — 502 (провайдер ловит → streams()); не падает', async () => {
  const client = new KodikClient({
    token: 'tok',
    linkHost: 'https://kodikres.com',
    fetchImpl: async () => ({ ok: true, json: async () => ({ results: [] }), text: async () => '<html><body>no page vars</body></html>' })
  });

  await assert.rejects(
    () => client.parsePlayer('//kodikplayer.com/video/39523/3e3c091400ff81435c1ac207f9ddbe8f/720p'),
    (err) => err.code === 'kodik_player_parse_failed' && err.statusCode === 502
  );
});
