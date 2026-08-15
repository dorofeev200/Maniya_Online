import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import { HttpError } from '../src/errors.js';
import { isHostAllowed, validateProxyTarget, proxyMedia, isManifestResponse } from '../src/proxy.js';

test('isHostAllowed: корень и поддомены, чужой хост отклонён', () => {
  assert.equal(isHostAllowed('vip.filmix.tv', ['filmix.tv']), true);
  assert.equal(isHostAllowed('filmix.tv', ['filmix.tv']), true);
  assert.equal(isHostAllowed('api.filmix.tv', ['filmix.tv']), true);
  assert.equal(isHostAllowed('evil.com', ['filmix.tv']), false);
  assert.equal(isHostAllowed('', ['filmix.tv']), false);
});

// GAP-012: veoveo-CDN — routing-нода api.rstprgapipt.com отвечает 307 на CDN-хост
// *.mvapspdmpg.com (vn50007/deovi/vn50006/old). Один суффикс корня покрывает все
// поддомены; без него наш прокси отвечает 403 proxy_host_forbidden на Play.
test('isHostAllowed: mvapspdmpg.com покрывает все поддомены veoveo-CDN (GAP-012)', () => {
  const allow = ['mvapspdmpg.com'];
  for (const host of ['vn50007.mvapspdmpg.com', 'deovi.mvapspdmpg.com', 'vn50003.mvapspdmpg.com', 'old.mvapspdmpg.com']) {
    assert.equal(isHostAllowed(host, allow), true, `${host} должен быть разрешён`);
  }
  assert.equal(isHostAllowed('mvapspdmpg.com', allow), true);
  assert.equal(isHostAllowed('evil.mvapspdmpg.com.evil.com', allow), false);
  assert.equal(isHostAllowed('mvapspdmpg.com.evil.com', allow), false);
  // Без суффикса в allowlist поддомены CDN блокируются — исходная причина 403.
  assert.equal(isHostAllowed('vn50007.mvapspdmpg.com', ['rstprgapipt.com']), false);
});

test('validateProxyTarget: SSRF-гард', () => {
  const allow = ['filmix.tv'];
  assert.ok(validateProxyTarget('https://vip.filmix.tv/s/x/y.mp4', allow));
  assert.throws(() => validateProxyTarget('https://evil.com/x.mp4', allow), (e) => e instanceof HttpError && e.statusCode === 403);
  assert.throws(() => validateProxyTarget('http://evil.com/x.mp4', allow), (e) => e instanceof HttpError && e.statusCode === 400);
  assert.throws(() => validateProxyTarget('ftp://filmix.tv/x', allow), (e) => e instanceof HttpError && e.statusCode === 400);
  // loopback http — только для локальных источников (тесты/dev)
  assert.ok(validateProxyTarget('http://127.0.0.1:9999/x.mp4', allow));
});

// GAP-012: veoveo-CDN — routing-нода api.rstprgapipt.com отвечает 307 на CDN-хост
// *.mvapspdmpg.com (vn50007/deovi/vn50006/old). validateProxyTarget валидирует
// redirect-цель по allowlist: без суффикса корня — 403 (исходная продакшн-проблема),
// с суффиксом — OK.
test('validateProxyTarget: veoveo redirect-цель *.mvapspdmpg.com (GAP-012)', () => {
  const allowWithCdn = ['rstprgapipt.com', 'mvapspdmpg.com'];
  const allowRoutingOnly = ['rstprgapipt.com'];
  const cdnUrls = [
    'https://vn50007.mvapspdmpg.com/1786781699/seg-1.ts',
    'https://deovi.mvapspdmpg.com/1786781699/index.m3u8',
    'https://old.mvapspdmpg.com/1786781699/seg-2.ts'
  ];
  // С фиксом (суффикс CDN-корня в allowlist) — все redirect-цели проходят.
  for (const url of cdnUrls) {
    assert.ok(validateProxyTarget(url, allowWithCdn), `${url} должен пройти с mvapspdmpg.com`);
  }
  // Без фикса (только routing-нода) — redirect-цель отклоняется 403: ТОЧНО исходный 403.
  for (const url of cdnUrls) {
    assert.throws(() => validateProxyTarget(url, allowRoutingOnly),
      (e) => e instanceof HttpError && e.statusCode === 403 && e.code === 'proxy_host_forbidden');
  }
});

test('validateProxyTarget: http только из явного httpAllowHosts', () => {
  const allow = ['filmix.tv'];
  const httpAllow = ['voidboost.one', '94.249.239.63'];

  // Наш CDN-манифест voidboost (http) — разрешён
  assert.ok(validateProxyTarget('http://magic.stream.voidboost.one/s/x/manifest.m3u8', allow, httpAllow));
  // Прямой хост E-Online (http) — разрешён
  assert.ok(validateProxyTarget('http://94.249.239.63/lite/rezka', allow, httpAllow));

  // Чужой http-хост даже с https-allowlist — запрещён
  assert.throws(() => validateProxyTarget('http://evil.com/x.m3u8', allow, httpAllow),
    (e) => e instanceof HttpError && e.statusCode === 400);

  // https-хосты не затронуты — по-прежнему через allowHosts
  assert.ok(validateProxyTarget('https://vip.filmix.tv/x.mp4', allow, httpAllow));

  // без httpAllowHosts http не проходит (кроме loopback)
  assert.throws(() => validateProxyTarget('http://94.249.239.63/x', allow, []),
    (e) => e instanceof HttpError && e.statusCode === 400);
});

function startTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/manifest.m3u8')) {
        const base = `http://127.0.0.1:${server.address().port}`;
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end([
          '#EXTM3U',
          '#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=1280x720',
          `${base}/video_720.m3u8`,
          '#EXT-X-STREAM-INF:BANDWIDTH=640000',
          '../low.m3u8',
          ''
        ].join('\n'));
        return;
      }
      if (req.url.startsWith('/render.m3u8')) {
        // Точная копия vkvideo render-плейлиста (VOD, X-MAP строка 7, относительные
        // сегменты) — регрессия 00:00: init-URI должен быть переписан на прокси,
        // иначе hls.js резолвит его против PROXIED URL → 404 JSON → нет MSE init.
        const base = `http://127.0.0.1:${server.address().port}`;
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end([
          '#EXTM3U',
          '#EXT-X-PLAYLIST-TYPE:VOD',
          '#EXT-X-VERSION:6',
          '#EXT-X-TARGETDURATION:6',
          '#EXT-X-MAP:URI="init-c1-f1-v1-a1.mp4"',
          '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin",IV=0x00000000000000000000000000000001',
          '#EXTINF:6.000,',
          'seg-1-f1-v1-a1.m4s',
          '#EXTINF:6.000,',
          'seg-2-f1-v1-a1.m4s',
          '#EXT-X-ENDLIST',
          ''
        ].join('\n'));
        return;
      }
      const body = Buffer.from('WXYZ');
      const range = req.headers.range;
      if (range) {
        const match = range.match(/bytes=(\d+)-(\d+)/);
        const start = Number(match[1]);
        const end = Number(match[2]);
        res.writeHead(206, {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${start}-${end}/${body.length}`,
          'Content-Length': String(end - start + 1)
        });
        res.end(body.subarray(start, end + 1));
      } else if (req.url.startsWith('/seg.ts')) {
        // TS-сегмент: бинарный payload с content-type video/mp2t.
        // НЕ должен трактоваться как манифест (регрессия «Не удалось декодировать»).
        const ts = Buffer.concat([Buffer.from([0x47]), Buffer.from('segdata-segdata-segdata')]);
        res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': String(ts.length) });
        res.end(ts);
      } else {
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(body.length) });
        res.end(body);
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

class MockResponse extends PassThrough {
  constructor() { super(); this.status = null; this.headers = null; }
  writeHead(status, headers) {
    this.status = status;
    // Node-сервер пишет заголовки в lower-case — имитируем это.
    this.headers = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return this;
  }
}

function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString()));
    stream.on('error', reject);
  });
}

test('proxyMedia: переписывает HLS-манифест на прокси-ссылки', async () => {
  const server = await startTestServer();
  try {
    const port = server.address().port;
    const makeProxyUrl = (url) => `https://maniya.test/proxy?url=${encodeURIComponent(url)}`;
    const response = new MockResponse();
    const request = { headers: {} };

    await proxyMedia(`http://127.0.0.1:${port}/manifest.m3u8`, request, response, {
      allowHosts: ['127.0.0.1'],
      makeProxyUrl,
      maxRedirects: 1,
      timeoutMs: 3000
    });

    const body = await collect(response);
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/vnd.apple.mpegurl');
    // loopback-источник http, поэтому прокси-адрес может быть http/https.
    assert.match(body, /https:\/\/maniya\.test\/proxy\?url=.+video_720\.m3u8/);
    assert.match(body, /https:\/\/maniya\.test\/proxy\?url=.+low\.m3u8/);
    assert.match(body, /#EXT-X-STREAM-INF:BANDWIDTH=1280000/);
  } finally {
    server.close();
  }
});

test('proxyMedia: #EXT-X-MAP init и #EXT-X-KEY URI переписываются на прокси (регрессия 00:00)', async () => {
  const server = await startTestServer();
  try {
    const port = server.address().port;
    const makeProxyUrl = (url) => `https://maniya.test/proxy?url=${encodeURIComponent(url)}`;
    const response = new MockResponse();
    const request = { headers: {} };

    await proxyMedia(`http://127.0.0.1:${port}/render.m3u8`, request, response, {
      allowHosts: ['127.0.0.1'],
      makeProxyUrl,
      maxRedirects: 1,
      timeoutMs: 3000
    });

    const body = await collect(response);
    assert.equal(response.status, 200);
    // X-MAP:init-c1-f1-v1-a1.mp4 (относительный) — резолв против render-базы → прокси.
    // Это именно та строка, что не переписывалась раньше и давала hls.js 404 → 00:00.
    assert.match(body, /#EXT-X-MAP:URI="https:\/\/maniya\.test\/proxy\?url=.+init-c1-f1-v1-a1\.mp4"/);
    // X-KEY:keys/key.bin (относительный, slash закодирован %2F) — тоже прокси, IV сохранён.
    assert.match(body, /#EXT-X-KEY:METHOD=AES-128,URI="https:\/\/maniya\.test\/proxy\?url=.+keys%2Fkey\.bin",IV=0x00000000000000000000000000000001/);
    // Директивы без URI не тронуты.
    assert.match(body, /#EXT-X-PLAYLIST-TYPE:VOD/);
    assert.match(body, /#EXTINF:6\.000,/);
    assert.match(body, /#EXT-X-ENDLIST/);
  } finally {
    server.close();
  }
});

test('proxyMedia: пробрасывает Range и отдаёт 206 с Content-Range', async () => {
  const server = await startTestServer();
  try {
    const port = server.address().port;
    const response = new MockResponse();
    const request = { headers: { range: 'bytes=0-2' } };

    await proxyMedia(`http://127.0.0.1:${port}/file.mp4`, request, response, {
      allowHosts: ['127.0.0.1'],
      maxRedirects: 1,
      timeoutMs: 3000
    });

    const body = await collect(response);
    assert.equal(response.status, 206);
    assert.equal(response.headers['content-range'], 'bytes 0-2/4');
    assert.equal(body, 'WXY');
    assert.equal(response.headers['access-control-allow-origin'], '*');
  } finally {
    server.close();
  }
});

test('proxyMedia: TS-сегмент (video/mp2t) проходит без переписывания (регрессия декода)', async () => {
  const server = await startTestServer();
  try {
    const port = server.address().port;
    const response = new MockResponse();
    const request = { headers: {} };
    const makeProxyUrl = (url) => `https://maniya.test/proxy?url=${encodeURIComponent(url)}`;

    await proxyMedia(`http://127.0.0.1:${port}/seg.ts`, request, response, {
      allowHosts: ['127.0.0.1'],
      makeProxyUrl,
      maxRedirects: 1,
      timeoutMs: 3000
    });

    const body = await collect(response);
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'video/mp2t');
    // Тело — бинарный TS (0x47 + данные), НЕ URL-каша прокси.
    assert.equal(body.charCodeAt(0), 0x47);
    assert.match(body, /segdata-segdata-segdata/);
    assert.ok(!body.includes('maniya.test/proxy'));
  } finally {
    server.close();
  }
});

test('isManifestResponse: video/mp2t — это сегмент, а не манифест', () => {
  assert.equal(isManifestResponse('video/mp2t', 'https://cdn.example/seg.ts'), false);
  assert.equal(isManifestResponse('application/vnd.apple.mpegurl', 'https://cdn.example/playlist.m3u8'), true);
  assert.equal(isManifestResponse('application/x-mpegurl', 'https://cdn.example/playlist.m3u8'), true);
  assert.equal(isManifestResponse('application/dash+xml', 'https://cdn.example/manifest.mpd'), true);
  assert.equal(isManifestResponse('application/octet-stream', 'https://cdn.example/stream.m3u8'), true);
  assert.equal(isManifestResponse('text/html', 'https://cdn.example/not-a-manifest'), false);
});

test('proxyMedia: отклоняет неразрешённый хост', async () => {
  const response = new MockResponse();
  await assert.rejects(
    () => proxyMedia('https://evil.com/video.mp4', { headers: {} }, response, { allowHosts: ['filmix.tv'] }),
    (e) => e instanceof HttpError && e.statusCode === 403
  );
});

// GAP-012: veoveo-механизм — routing-нода api.rstprgapipt.com отвечает 307 на
// CDN-хост *.mvapspdmpg.com. Прокси должен валидировать redirect-цель:
//   • 403-тест — сервер 307-ит на https://vn50007.mvapspdmpg.com (НЕ в allowlist) →
//     validateProxyTarget бросает 403 синхронно на redirect-цели, соединения нет —
//     это ТОЧНЫЙ продакшн-фейл до фикса;
//   • success-тест — сервер 307-ит на loopback-CDN (в allowlist) → манифест
//     переписывается. А вот allowlist-гейт на https-CDN-хосте (суффикс корня)
//     доказан юнит-тестами isHostAllowed/validateProxyTarget выше, т.к. в интеграции
//     реальный vn50007.mvapspdmpg.com недоступен локально.
function startRedirectTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // Routing-нода: два маршрута, оба 307.
      if (req.url.startsWith('/routing-real.m3u8')) {
        // Редирект на реальный CDN-хост (как в проде): до фикса → 403.
        res.writeHead(307, { location: 'https://vn50007.mvapspdmpg.com/cdn/manifest.m3u8' });
        res.end();
        return;
      }
      if (req.url.startsWith('/routing-loop.m3u8')) {
        // Редирект на локальный CDN — для проверки, что после валидации цели
        // контент реально проксируется и манифест переписывается.
        res.writeHead(307, { location: `http://127.0.0.1:${server.address().port}/cdn/manifest.m3u8` });
        res.end();
        return;
      }
      if (req.url.startsWith('/cdn/manifest.m3u8')) {
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end(['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1280000', 'seg-1.ts', ''].join('\n'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': '4' });
      res.end(Buffer.from('WXYZ'));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('proxyMedia: следует 307 и переписывает манифест, если redirect-цель разрешена (GAP-012 veoveo)', async () => {
  const server = await startRedirectTestServer();
  try {
    const port = server.address().port;
    const makeProxyUrl = (url) => `https://maniya.test/proxy?url=${encodeURIComponent(url)}`;
    const response = new MockResponse();

    // Начальный URL — loopback http (проходит scheme-чек), routing-нода 307-ит
    // на loopback-CDN, который тоже проходит валидацию → контент проксируется.
    await proxyMedia(`http://127.0.0.1:${port}/routing-loop.m3u8`, { headers: {} }, response, {
      allowHosts: ['127.0.0.1', 'mvapspdmpg.com'],
      makeProxyUrl, maxRedirects: 2, timeoutMs: 3000
    });
    const body = await collect(response);
    assert.equal(response.status, 200);
    assert.match(body, /#EXTM3U/);
    assert.match(body, /https:\/\/maniya\.test\/proxy\?url=.+seg-1\.ts/);
  } finally {
    server.close();
  }
});

test('proxyMedia: 403 на redirect-цель, которой нет в allowHosts (GAP-012 исходный 403)', async () => {
  const server = await startRedirectTestServer();
  try {
    const port = server.address().port;
    // allowlist содержит ТОЛЬКО локальный хост тест-сервера, БЕЗ суффикса CDN —
    // ровно продакшн-ситуация до фикса: routing-нода 307 → vn50007.mvapspdmpg.com
    // (не в allowlist) → validateProxyTarget бросает 403 на redirect-цели.
    const response = new MockResponse();
    await assert.rejects(
      () => proxyMedia(`http://127.0.0.1:${port}/routing-real.m3u8`, { headers: {} }, response, {
        allowHosts: ['127.0.0.1'], maxRedirects: 2, timeoutMs: 3000
      }),
      (e) => e instanceof HttpError && e.statusCode === 403 && e.code === 'proxy_host_forbidden'
    );
  } finally {
    server.close();
  }
});