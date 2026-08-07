import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import { HttpError } from '../src/errors.js';
import { isHostAllowed, validateProxyTarget, proxyMedia } from '../src/proxy.js';

test('isHostAllowed: корень и поддомены, чужой хост отклонён', () => {
  assert.equal(isHostAllowed('vip.filmix.tv', ['filmix.tv']), true);
  assert.equal(isHostAllowed('filmix.tv', ['filmix.tv']), true);
  assert.equal(isHostAllowed('api.filmix.tv', ['filmix.tv']), true);
  assert.equal(isHostAllowed('evil.com', ['filmix.tv']), false);
  assert.equal(isHostAllowed('', ['filmix.tv']), false);
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

test('proxyMedia: отклоняет неразрешённый хост', async () => {
  const response = new MockResponse();
  await assert.rejects(
    () => proxyMedia('https://evil.com/video.mp4', { headers: {} }, response, { allowHosts: ['filmix.tv'] }),
    (e) => e instanceof HttpError && e.statusCode === 403
  );
});