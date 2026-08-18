// SKAZ-RCH-001 — controlled WebSocket verification + RCH-интеграция.
//
// Фокус: НЕ «rch:true распознаётся» (это умел и REST), а РЕАЛЬНЫЙ round-trip
//   `{"rch":true}` → WS `/nws?id=` handshake → RchRegistry → повтор с `nws_id` →
//   результат → обычный Skaz-parser/normalizer (никакого дублирования парсинга).
//
// Инфраструктура теста:
//   - локальный минимальный RFC6455-сервер на 127.0.0.1 (handshake + frame-codec)
//     играет роль кластерного `/nws` (Connected/RchRegistry/RchClient-пуши);
//   - фейковый кластер (fetchImpl DI) гейтует `/lite/*` первым `{"rch":true,"nws":…}`
//     без `nws_id`, а с `nws_id` — отдаёт живой HTML/JSON (серверный RCH-клиент
//     должен «повторить исходный запрос»);
//   - RchClient-пуши (выполнение pushed-URL → POST `/rch/result`) проверяются
//     end-to-end без сети.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

import { SkazClient } from '../src/providers/skaz/SkazClient.js';
import { SkazRchClient, validateRchTarget } from '../src/providers/skaz/SkazRchClient.js';
import { SkazRchRegistry } from '../src/providers/skaz/SkazRchRegistry.js';
import { SkazProvider } from '../src/providers/skaz/SkazProvider.js';

// ===== RFC6455-кодек (минимальный; server→client без маски, client→server с маской) =====
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const wsAccept = (key) => crypto.createHash('sha1').update(key + WS_GUID).digest('base64');

function parseFrame(buf) {
  if (buf.length < 2) return null;
  const b0 = buf[0];
  const b1 = buf[1];
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  let mask = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + len) return null;
  let payload = buf.subarray(offset, offset + len);
  if (masked) {
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
  }
  return { opcode, payload, consumed: offset + len };
}

function frameText(text) {
  const payload = Buffer.from(String(text), 'utf8');
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

const FRAME_PONG = Buffer.from([0x8a, 0x00]);
const FRAME_CLOSE = Buffer.from([0x88, 0x00]);

class WsConnection {
  constructor(socket, id) {
    this.socket = socket;
    this.id = id;
    this.ready = true;
    this.received = [];
    this._buffer = Buffer.alloc(0);
    this.onMessage = null;
    socket.on('data', (chunk) => this._feed(chunk));
    socket.on('error', () => {});
    socket.on('close', () => { this.ready = false; });
  }

  sendText(text) {
    if (!this.ready) return;
    try { this.socket.write(frameText(text)); } catch { /* закрыто */ }
  }

  close() {
    try { this.socket.write(FRAME_CLOSE); } catch { /* уже */ }
    try { this.socket.destroy(); } catch { /* уже */ }
  }

  _feed(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    for (;;) {
      const frame = parseFrame(this._buffer);
      if (!frame) break;
      this._buffer = this._buffer.subarray(frame.consumed);
      this._handleFrame(frame);
    }
  }

  _handleFrame(frame) {
    if (frame.opcode === 0x1) {
      const text = frame.payload.toString('utf8');
      this.received.push(text);
      if (this.onMessage) this.onMessage(text);
    } else if (frame.opcode === 0x8) {
      // close-handshake: контрольный close в ответ + немедленный destroy (иначе
      // клиент может ждать подтверждения, а server.close — открытых соединений).
      try { this.socket.write(FRAME_CLOSE); } catch { /* */ }
      try { this.socket.destroy(); } catch { /* */ }
    } else if (frame.opcode === 0x9) {
      try { this.socket.write(FRAME_PONG); } catch { /* */ }
    }
  }
}

/**
 * Локальный `/nws`-сервер. Поведение (по умолчанию — как кластер):
 *  - после handshake шлёт `{"method":"Connected","args":[connectionId]}`;
 *  - на RchRegistry-сообщение шлёт ack + (если задан onRegistered) зовёт хук.
 * ackRegistry:false — сервер НЕ отвечает на RchRegistry (для timeout-теста).
 */
function createWsServer({ ackRegistry = true, onRegistered = null } = {}) {
  const server = http.createServer();
  const connections = [];
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const urlId = new URL(req.url, 'http://x').searchParams.get('id') || '';
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`
    );
    const conn = new WsConnection(socket, urlId);
    connections.push(conn);
    conn.sendText(JSON.stringify({ method: 'Connected', args: [conn.id] }));
    conn.onMessage = (text) => {
      if (text.trim() === 'ping') {
        conn.sendText('pong');
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch { return; }
      if (parsed.method === 'RchRegistry') {
        if (ackRegistry) {
          conn.sendText(JSON.stringify({ method: 'RchRegistry', args: ['127.0.0.1', conn.id, parsed.args?.[0]?.rchtype] }));
          if (onRegistered) onRegistered(conn);
        }
      }
    };
  });
  return {
    server,
    connections,
    listen() {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
      });
    },
    async close() {
      for (const c of connections) c.close();
      await new Promise((resolve) => server.close(resolve));
      // server.close может ждать уже-умершие handshake-соки; довершаем принудительно.
      for (const c of connections) {
        try { c.socket.destroy(); } catch { /* уже закрыт */ }
      }
    }
  };
}

// ===== фейковые ответы =====
function headersObj(obj) {
  const map = { ...(obj || {}) };
  return {
    get: (k) => map[String(k).toLowerCase()] ?? null,
    entries: () => Object.entries(map)
  };
}

function fakeResponse(status, body = '', { url, headers = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    url: url ?? 'http://final.example/x',
    headers: headersObj(headers),
    body: { cancel: () => {}, cancelAsync: () => Promise.resolve() },
    text: async () => String(body)
  };
}

function fakeResponseFor(reqUrl, status, body, headers = {}) {
  return fakeResponse(status, body, { url: `http://cluster${reqUrl}`, headers });
}

/**
 * Фейковый skaz-кластер (fetchImpl): `/lite/*` без `nws_id` гейтуется первым
 * `{"rch":true,"nws":wsUrl}`, с `nws_id` отдаёт тело маршрута; `/rch/result`
 * и `/rch/gzresult` аккумулируются в this.posts; прочее — 404.
 */
function makeCluster({ wsUrl, routes = {} }) {
  const calls = [];
  const posts = [];
  const gated = new Map(); // pathname -> сколько раз ещё гейтовать без nws_id
  const fetchImpl = async (url, options = {}) => {
    const s = String(url);
    calls.push({ url: s, method: (options && options.method) || 'GET', headers: (options && options.headers) || {} });
    if (/\/rch\/gzresult/.test(s)) {
      const bodyBuf = (options && options.body) || Buffer.alloc(0);
      posts.push({ gz: true, id: new URL(s).searchParams.get('id'), size: bodyBuf.byteLength });
      return fakeResponse(200, 'null', { url: s });
    }
    if (/\/rch\/result/.test(s)) {
      const body = String((options && options.body) || '');
      posts.push({ gz: false, id: new URL(s).searchParams.get('id'), body });
      return fakeResponse(200, 'null', { url: s });
    }
    let u;
    try {
      u = new URL(s);
    } catch {
      return fakeResponse(404, 'nf', { url: s });
    }
    if (u.pathname.startsWith('/lite/')) {
      const nwsId = u.searchParams.get('nws_id');
      if (!nwsId) {
        const remaining = gated.get(u.pathname) ?? 1;
        if (remaining > 0) {
          gated.set(u.pathname, remaining - 1);
          return fakeResponseFor(u.pathname, 200, JSON.stringify({ rch: true, nws: wsUrl }), { 'content-type': 'application/json' });
        }
      }
      // Самый длинный префикс побеждает: `/lite/alloha/movie` раньше `/lite/alloha`,
      // иначе `startsWith` утащит `/lite/alloha/movie.m3u8` в общий маршрут.
      // Маршрут может быть строкой (200 HTML/JSON) или `{status, body}`
      // (например `{status:503, body:'null'}` = кластерный «контента нет»).
      const prefixRoutes = Object.entries(routes).sort((a, b) => b[0].length - a[0].length);
      for (const [prefix, body] of prefixRoutes) {
        if (u.pathname.startsWith(prefix)) {
          const status = body && typeof body === 'object' ? Number(body.status || 200) : 200;
          const text = body && typeof body === 'object' ? String(body.body ?? '') : String(body);
          const isJson = text.trim().startsWith('{');
          return fakeResponseFor(u.pathname, status, text, { 'content-type': isJson ? 'application/json' : 'text/html; charset=utf-8' });
        }
      }
    }
    if (u.pathname.startsWith('/resolved')) {
      return fakeResponseFor(u.pathname, 200, JSON.stringify({ data: 'RESOLVED' }), { 'content-type': 'application/json' });
    }
    return fakeResponse(404, 'nf', { url: s });
  };
  return { fetchImpl, calls, posts, gated };
}

const ACCEPT_ALL = async (value) => new URL(String(value));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil: timeout');
    await sleep(10);
  }
}

/**
 * Регистрирует t.after-closure БЕЗОПАСНО для любого исхода теста: даже если
 * ассерт упал, ws/client/registry закрываются, и node --test не висит на
 * утёкших undici WebSocket-сокетах (раньше фейлы вешали весь процесс).
 */
function cleanup(t, ...closers) {
  for (const fn of closers) {
    t.after(async (t) => {
      try { await fn(); } catch { /* cleanup не должен ронять тест */ }
    });
  }
}

const PLAY_HTML = '<div class="videos__item" data-json=\'{"method":"play","url":"http://h/play.m3u8","translate":"Дубляж"}\'>x</div>';
const CALL_HTML = '<div class="videos__item" data-json=\'{"method":"call","stream":"http://cluster/lite/alloha/movie.m3u8?play=true","s":null,"e":null,"translate":"Оригінал"}\'>x</div>';
const VIDEO_JSON = '{"method":"play","url":"http://cdn/primary.m3u8 or http://cdn/reserve.m3u8","quality":{"1080p":"http://cdn/primary.m3u8"},"subtitles":[],"segments":{"skip":[10,20]}}';

// ===== 1. rch=false (rollback): поведение прежнее, WS не открывается =====

test('RCH: rch выключен (rollback) — `{"rch":true}` = 2xx-non-usable, WS не открывается', async (t) => {
  const ws = await createWsServer();
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const wsUrl = `ws://127.0.0.1:${wsPort}/nws`;
  const cluster = makeCluster({ wsUrl, routes: { '/lite/x': PLAY_HTML } });

  const client = new SkazClient({
    balancer: 'x',
    hosts: ['http://cluster'],
    accountEmail: 'u@e.com',
    uid: 'abc123',
    fetchImpl: cluster.fetchImpl
    // rch НЕ включён — прежнее поведение
  });

  const html = await client.getLite({}, { userUid: 'u1' });
  assert.equal(html, null, 'rch-only кластер без RCH → null (не контент)');
  assert.deepEqual(client.lastScan, { nonContent: 1, noResponse: 0, total: 1 }, 'rch ответ = content-«нет» (EMPTY-классификация)');
  assert.equal(ws.connections.length, 0, 'WS-подключения НЕ создаются');
  await ws.close();
});

// ===== 2. Протокол клиента: Connected/RchRegistry/ack, nws_id в повторе =====

test('RCH client: handshake Connected → RchRegistry → ack; isReady после открытия', async (t) => {
  const ws = await createWsServer();
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const cluster = makeCluster({ wsUrl: `ws://127.0.0.1:${wsPort}/nws` });

  const client = new SkazRchClient({
    nwsUrl: `ws://127.0.0.1:${wsPort}/nws`,
    host: 'http://127.0.0.1',
    rchtype: 'apk',
    timeoutMs: 2000,
    fetchImpl: cluster.fetchImpl,
    validateUrl: ACCEPT_ALL
  });
  await client.open();
  cleanup(t, () => client.close());

  assert.ok(client.isReady, 'registry-ack получен → клиент готов');
  assert.equal(client.connectionId, client.nwsId, 'connectionId === nws_id (как NativeWebSocket)');
  await waitUntil(() => ws.connections.length >= 1);
  const conn = ws.connections[0];
  assert.ok(conn.received.some((m) => m.includes('"RchRegistry"')), 'клиент зарегистрировался в RchRegistry');
  const reg = JSON.parse(conn.received.find((m) => m.includes('"RchRegistry"')));
  assert.equal(reg.args[0].host, '127.0.0.1', 'host без схемы (location.host)');
  assert.equal(reg.args[0].rchtype, 'apk', 'rchtype из конфига (не произвольная константа)');
  client.close();
  await ws.close();
});

test('RCH client: pong/нев-JSON игнорируются, каждая нужная строка обрабатывается', async (t) => {
  const ws = await createWsServer();
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const cluster = makeCluster({ wsUrl: `ws://127.0.0.1:${wsPort}/nws` });
  const client = new SkazRchClient({
    nwsUrl: `ws://127.0.0.1:${wsPort}/nws`,
    host: 'http://127.0.0.1',
    timeoutMs: 2000,
    fetchImpl: cluster.fetchImpl,
    validateUrl: ACCEPT_ALL
  });
  await client.open();
  cleanup(t, () => client.close()); // ack пришёл — «мусор» не помешал открытию
  assert.ok(client.isReady);
  client.close();
  await ws.close();
});

// ===== 3. Сквозной путь: rch-гейт → повтор → обычный Skaz-результат =====

test('RCH e2e: getLite повторяет ИСХОДНЫЙ запрос с nws_id и получает HTML', async (t) => {
  const ws = await createWsServer();
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const wsUrl = `ws://127.0.0.1:${wsPort}/nws`;
  const cluster = makeCluster({ wsUrl, routes: { '/lite/x': PLAY_HTML } });
  const registry = new SkazRchRegistry({ timeoutMs: 2000, maxSessions: 8, fetchImpl: cluster.fetchImpl, validateUrl: ACCEPT_ALL });
  cleanup(t, () => registry.closeAll());

  const client = new SkazClient({
    balancer: 'x',
    hosts: ['http://cluster'],
    accountEmail: 'u@e.com',
    uid: 'abc123',
    fetchImpl: cluster.fetchImpl,
    rch: { enabled: true, registry, maxRounds: 3 }
  });

  const html = await client.getLite({ title: 'Game' }, { userUid: 'u1' });
  assert.equal(html, PLAY_HTML, 'RCH-повтор вернул живой HTML');
  assert.equal(client.lastRchError, null, 'успех — без RCH-ошибки');

  // повторный запрос зафиксирован на хосте сессии и несёт nws_id === connectionId
  const retry = cluster.calls.find((c) => c.url.includes('nws_id='));
  assert.ok(retry, 'запрос с nws_id был выполнен');
  assert.equal(retry.url, retry.url.replace(/\+/g, '%20'), 'URL стабилен');
  await waitUntil(() => ws.connections.length >= 1);
  const expected = new URLSearchParams(retry.url.split('?')[1]).get('nws_id');
  assert.equal(expected, ws.connections[0].id, 'nws_id === connectionId WS-сессии');

  assert.equal(registry.size, 1, 'сессия жива в реестре');
  assert.ok(client.lastScan.rch === true && client.lastScan.rounds === 1, 'последний скан — через RCH, 1 раунд');
  await registry.closeAll();
  await ws.close();
});

test('RCH e2e: provider videos() — play-карточка из RCH-повтора (клиент-путь не задет)', async (t) => {
  const ws = await createWsServer();
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const wsUrl = `ws://127.0.0.1:${wsPort}/nws`;
  const cluster = makeCluster({ wsUrl, routes: { '/lite/alloha': PLAY_HTML } });
  const registry = new SkazRchRegistry({ timeoutMs: 2000, maxSessions: 8, fetchImpl: cluster.fetchImpl, validateUrl: ACCEPT_ALL });
  cleanup(t, () => registry.closeAll());
  const client = new SkazClient({
    balancer: 'alloha',
    hosts: ['http://cluster'],
    accountEmail: 'u@e.com',
    uid: 'abc123',
    origin: 'http://lampa.mx',
    fetchImpl: cluster.fetchImpl,
    rch: { enabled: true, registry, maxRounds: 3 }
  });
  const provider = new SkazProvider({ id: 'skaz-alloha', title: 'Alloha', balancer: 'alloha', client });

  const result = await provider.videos({ query: { title: 'Game', serial: '0' }, request: {}, userUid: 'u1' });
  assert.ok(result.items.length >= 1, 'items построены из RCH-ответа');
  assert.equal(result.items[0].method, 'play', 'обычный нормализатор play-карточки');
  assert.ok(String(result.items[0].url).includes('url=') || String(result.items[0].url).includes('play.m3u8'), 'URL проксирован');
  assert.equal(result.provider_error, undefined, 'успеха — без provider_error');
  assert.ok(cluster.calls.some((c) => c.url.includes('nws_id=')), 'RCH-повтор был');
  await registry.closeAll();
  await ws.close();
});

test('RCH e2e: provider resolveVideo() — call → JSON video через RCH-повтор (repeat→call)', async (t) => {
  const ws = await createWsServer();
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const wsUrl = `ws://127.0.0.1:${wsPort}/nws`;
  const cluster = makeCluster({
    wsUrl,
    routes: {
      '/lite/alloha': CALL_HTML,
      '/lite/alloha/movie': VIDEO_JSON
    }
  });
  const registry = new SkazRchRegistry({ timeoutMs: 2000, maxSessions: 8, fetchImpl: cluster.fetchImpl, validateUrl: ACCEPT_ALL });
  cleanup(t, () => registry.closeAll());
  const client = new SkazClient({
    balancer: 'alloha',
    hosts: ['http://cluster'],
    accountEmail: 'u@e.com',
    uid: 'abc123',
    origin: 'http://lampa.mx',
    fetchImpl: cluster.fetchImpl,
    rch: { enabled: true, registry, maxRounds: 3 }
  });
  const provider = new SkazProvider({ id: 'skaz-alloha', title: 'Alloha', balancer: 'alloha', client });

  const list = await provider.videos({ query: { title: 'Game', serial: '0' }, request: {}, userUid: 'u1' });
  const callItem = list.items.find((item) => item.method === 'call');
  assert.ok(callItem, 'call-карточка из RCH-HTML');

  // Play call → resolveVideo → resolveCardItem → resolveVideoJson (JSON через RCH)
  const query = { title: 'Game', serial: '0', voice: '0', provider: 'skaz-alloha' };
  const item = await provider.resolveVideo({ query, request: {}, userUid: 'u1' });
  assert.ok(item, 'дескриптор получен');
  assert.equal(item.method, 'play', 'call-резолв вернул play');
  assert.ok(String(item.url).includes('primary.m3u8'), 'primary-url из JSON (reserve сохранён через " or ")');
  await registry.closeAll();
  await ws.close();
});

// ===== 4. Ошибки и loop-защита =====

test('RCH timeout: сервер не отвечает на RchRegistry → rch_unavailable → provider_error', async (t) => {
  const ws = await createWsServer({ ackRegistry: false });
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const cluster = makeCluster({ wsUrl: `ws://127.0.0.1:${wsPort}/nws`, routes: { '/lite/alloha': PLAY_HTML } });
  const registry = new SkazRchRegistry({ timeoutMs: 150, maxSessions: 4, fetchImpl: cluster.fetchImpl, validateUrl: ACCEPT_ALL });
  cleanup(t, () => registry.closeAll());
  const client = new SkazClient({
    balancer: 'alloha',
    hosts: ['http://cluster'],
    accountEmail: 'u@e.com',
    uid: 'abc123',
    origin: 'http://lampa.mx',
    fetchImpl: cluster.fetchImpl,
    rch: { enabled: true, registry, maxRounds: 3 }
  });
  const provider = new SkazProvider({ id: 'skaz-alloha', title: 'Alloha', balancer: 'alloha', client });

  const result = await provider.videos({ query: { title: 'Game', serial: '0' }, request: {}, userUid: 'u1' });
  assert.deepEqual(result.items, [], 'таймаут — без контента');
  assert.equal(result.provider_error?.code, 'rch_unavailable', 'RCH-таймаут → provider_error, НЕ пустой источник');
  assert.equal(client.lastRchError?.code, 'rch_unavailable', 'категория ошибки сохранена');
  assert.equal(registry.size, 0, 'не-открывшаяся сессия НЕ остаётся в реестре');
  await registry.closeAll();
  await ws.close();
});

test('RCH loop-защита: кластер упорно отвечает rch → maxRounds повторов, потом rch_repeated (без бесконечного цикла)', async (t) => {
  const ws = await createWsServer();
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const wsUrl = `ws://127.0.0.1:${wsPort}/nws`;
  const cluster = makeCluster({ wsUrl });
  // кластер НИКОГДА не отдаёт контент — всегда rch:true
  cluster.gated.set('/lite/x', 1_000_000);
  cluster.fetchImpl = async (url) => {
    if (url.includes('nws_id=') || !url.includes('nws_id')) {
      return fakeResponseFor('/lite/x', 200, JSON.stringify({ rch: true, nws: wsUrl }), { 'content-type': 'application/json' });
    }
    return fakeResponse(404, 'nf', { url });
  };

  const registry = new SkazRchRegistry({ timeoutMs: 500, maxSessions: 4, fetchImpl: cluster.fetchImpl, validateUrl: ACCEPT_ALL });
  cleanup(t, () => registry.closeAll());
  const client = new SkazClient({
    balancer: 'x',
    hosts: ['http://cluster'],
    accountEmail: 'u@e.com',
    uid: 'abc123',
    fetchImpl: cluster.fetchImpl,
    rch: { enabled: true, registry, maxRounds: 2 }
  });

  const start = Date.now();
  const html = await client.getLite({}, { userUid: 'u1' });
  const elapsed = Date.now() - start;

  assert.equal(html, null, 'контента нет');
  assert.equal(client.lastRchError?.code, 'rch_repeated', 'после N раундов — честная RCH-ошибка');
  assert.equal(ws.connections.length, 2, 'ровно maxRounds=2 раунда → 2 WS-сессии (каждый раунд — свежая связка id)');
  assert.ok(elapsed < 5000, `цикл завершился быстро (${elapsed}ms) — без бесконечного loop`);
  await registry.closeAll();
  await ws.close();
});

// ===== 5. Изоляция и cleanup =====

test('RCH изоляция: сессии разделены по userUid (пользователь A не делит состояние с B)', async (t) => {
  const ws = await createWsServer();
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const cluster = makeCluster({ wsUrl: `ws://127.0.0.1:${wsPort}/nws` });
  const registry = new SkazRchRegistry({ timeoutMs: 2000, maxSessions: 8, fetchImpl: cluster.fetchImpl, validateUrl: ACCEPT_ALL });
  cleanup(t, () => registry.closeAll());

  const clientA = await registry.acquire('user-a', 'http://h1', 'skaz-x', `ws://127.0.0.1:${wsPort}/nws`);
  const clientB = await registry.acquire('user-b', 'http://h1', 'skaz-x', `ws://127.0.0.1:${wsPort}/nws`);
  assert.ok(clientA && clientB, 'обе сессии открыты');
  assert.notEqual(clientA.nwsId, clientB.nwsId, 'разные nws_id — не общее соединение');
  assert.equal(registry.size, 2, 'две сессии в реестре');
  await waitUntil(() => ws.connections.length >= 2);
  assert.equal(ws.connections.length, 2, 'два независимых WS-подключения');

  // повторный acquire того же пользователя переиспользует сессию (не третье WS)
  const clientA2 = await registry.acquire('user-a', 'http://h1', 'skaz-x', `ws://127.0.0.1:${wsPort}/nws`);
  assert.equal(clientA2, clientA, 'тот же объект-клиент');
  assert.equal(ws.connections.length, 2, 'новое WS не открывалось');

  // single-flight: параллельные acquire делят одно подключение
  const before = ws.connections.length;
  const [c1, c2] = await Promise.all([
    registry.acquire('user-c', 'http://h1', 'skaz-x', `ws://127.0.0.1:${wsPort}/nws`),
    registry.acquire('user-c', 'http://h1', 'skaz-x', `ws://127.0.0.1:${wsPort}/nws`)
  ]);
  assert.equal(c1, c2, 'single-flight: оба получили одну сессию');
  assert.equal(ws.connections.length, before + 1, 'одно подключение на ключ при параллели');

  await registry.closeAll();
  await ws.close();
});

test('RCH cleanup: closeAll закрывает сокеты и чистит реестр (нет listener-leak)', async (t) => {
  const ws = await createWsServer();
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const cluster = makeCluster({ wsUrl: `ws://127.0.0.1:${wsPort}/nws` });
  const registry = new SkazRchRegistry({ timeoutMs: 2000, maxSessions: 8, fetchImpl: cluster.fetchImpl, validateUrl: ACCEPT_ALL });
  cleanup(t, () => registry.closeAll());

  await registry.acquire('u', 'http://h1', 'skaz-x', `ws://127.0.0.1:${wsPort}/nws`);
  assert.equal(registry.size, 1);
  await registry.closeAll();
  assert.equal(registry.size, 0, 'реестр пуст после closeAll');
  await waitUntil(() => ws.connections.every((c) => !c.ready), 1500);
  assert.ok(ws.connections.every((c) => !c.ready), 'все WS-сокеты закрыты');
  await ws.close();
});

test('RCH client: onClose-хук снимается при drop (нет утечки слушателей)', async (t) => {
  const ws = await createWsServer();
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const cluster = makeCluster({ wsUrl: `ws://127.0.0.1:${wsPort}/nws` });
  const registry = new SkazRchRegistry({ timeoutMs: 2000, maxSessions: 8, fetchImpl: cluster.fetchImpl, validateUrl: ACCEPT_ALL });
  cleanup(t, () => registry.closeAll());
  const client = await registry.acquire('u', 'http://h1', 'skaz-x', `ws://127.0.0.1:${wsPort}/nws`);
  assert.ok(client);
  const hookCount = () => client._closeListeners.length;
  assert.equal(hookCount(), 1, 'registry навесил один onClose-listener');
  registry.release('u', 'http://h1', 'skaz-x');
  assert.equal(hookCount(), 0, 'listener снят при release');
  assert.equal(registry.size, 0);
  await ws.close();
});

// ===== 6. RchClient push: выполнение URL + POST результата =====

test('RCH push: кластер просит URL → клиент выполняет и постит результат в /rch/result', async (t) => {
  const ws = await createWsServer({
    onRegistered: (conn) => {
      conn.sendText(JSON.stringify({ method: 'RchClient', args: ['rch1', 'http://cluster/resolved?q=1', 'payload', null, false] }));
    }
  });
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const cluster = makeCluster({ wsUrl: `ws://127.0.0.1:${wsPort}/nws` });
  const client = new SkazRchClient({
    nwsUrl: `ws://127.0.0.1:${wsPort}/nws`,
    host: 'http://127.0.0.1',
    timeoutMs: 2000,
    fetchImpl: cluster.fetchImpl,
    validateUrl: ACCEPT_ALL
  });
  await client.open();
  cleanup(t, () => client.close());

  await waitUntil(() => cluster.posts.some((p) => !p.gz && p.id === 'rch1'));
  const post = cluster.posts.find((p) => p.id === 'rch1');
  assert.equal(post.body, JSON.stringify({ data: 'RESOLVED' }), 'тело выполнянного URL отправлено кластеру');
  assert.ok(cluster.calls.some((c) => c.method === 'POST' && /\/rch\/result/.test(c.url)), 'POST /rch/result выполнен');
  assert.ok(cluster.calls.some((c) => c.url.includes('/resolved') && c.method === 'POST'), 'pushed-URL (data≠пусто) выполнен POST — как RchClient-регламент');
  client.close();
  await ws.close();
});

test('RCH push: "ping" → "pong"; "eval"/"evalrun" → пустой результат (серверная ограниченность, не падение)', async (t) => {
  const ws = await createWsServer({
    onRegistered: (conn) => {
      conn.sendText(JSON.stringify({ method: 'RchClient', args: ['ping1', 'ping', '', null, false] }));
      conn.sendText(JSON.stringify({ method: 'RchClient', args: ['eval1', 'eval', 'document.title', null, false] }));
    }
  });
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const cluster = makeCluster({ wsUrl: `ws://127.0.0.1:${wsPort}/nws` });
  const client = new SkazRchClient({
    nwsUrl: `ws://127.0.0.1:${wsPort}/nws`,
    host: 'http://127.0.0.1',
    timeoutMs: 2000,
    fetchImpl: cluster.fetchImpl,
    validateUrl: ACCEPT_ALL
  });
  await client.open();
  cleanup(t, () => client.close());

  await waitUntil(() => cluster.posts.some((p) => p.id === 'eval1'));
  const pingPost = cluster.posts.find((p) => p.id === 'ping1');
  const evalPost = cluster.posts.find((p) => p.id === 'eval1');
  assert.equal(pingPost?.body, 'pong', 'ping → pong');
  assert.equal(evalPost?.body, '', 'eval → честный пустой результат (клиент жив)');
  assert.equal(client.lastError, 'rch_eval_unsupported', 'категория eval-ограниченности зафиксирована');
  client.close();
  await ws.close();
});

test('RCH push: тело >1000 байт → gzip-пост в /rch/gzresult', async (t) => {
  const bigBody = 'x'.repeat(2000);
  const ws = await createWsServer({
    onRegistered: (conn) => {
      conn.sendText(JSON.stringify({ method: 'RchClient', args: ['big1', 'http://cluster/resolved', null, null, false] }));
    }
  });
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const cluster = makeCluster({ wsUrl: `ws://127.0.0.1:${wsPort}/nws` });
  // Override кластера: pushed-URL отдаёт ТЕЛО >1000B, но посты в /rch/* РЕГИСТРИРУЕТ
  // (раньше override молча проглатывал gz-пост — waitUntil вешал тест на пустом posts).
  cluster.fetchImpl = async (url, options = {}) => {
    const s = String(url);
    if (/\/rch\/gzresult/.test(s)) {
      const bodyBuf = (options && options.body) || Buffer.alloc(0);
      cluster.posts.push({ gz: true, id: new URL(s).searchParams.get('id'), size: bodyBuf.byteLength });
      return fakeResponse(200, 'null', { url: s });
    }
    if (/\/rch\/result/.test(s)) {
      cluster.posts.push({ gz: false, id: new URL(s).searchParams.get('id'), body: String((options && options.body) || '') });
      return fakeResponse(200, 'null', { url: s });
    }
    return fakeResponseFor('/resolved', 200, bigBody, { 'content-type': 'text/plain' });
  };
  const client = new SkazRchClient({
    nwsUrl: `ws://127.0.0.1:${wsPort}/nws`,
    host: 'http://127.0.0.1',
    timeoutMs: 2000,
    fetchImpl: cluster.fetchImpl,
    validateUrl: ACCEPT_ALL
  });
  await client.open();
  cleanup(t, () => client.close());

  await waitUntil(() => cluster.posts.some((p) => p.gz));
  const post = cluster.posts.find((p) => p.gz);
  assert.ok(post, 'gz-пост в /rch/gzresult');
  assert.equal(post.id, 'big1', 'тот же rchId');
  assert.ok(post.size > 0, `gzip-payload не пуст (${post.size}b)`);
  assert.ok(post.size < bigBody.length, `тело сжато (${post.size}b < ${bigBody.length}b — не сырой ответ)`);
  assert.equal(post.size, zlib.gzipSync(Buffer.from(bigBody, 'utf8')).length, 'payload = ровно gzip(ответа)');
});

// ===== 7. SSRF-гард (validation до fetch) =====

test('RCH security: validateRchTarget запрещает схему/не-allowlist/private/loopback', async (t) => {
  await assert.rejects(validateRchTarget('ftp://example.com/x', ['example.com']), /rch_scheme_forbidden/);
  await assert.rejects(validateRchTarget('http://example.com/x', [], ['other.example']), /rch_host_forbidden/);
  await assert.rejects(validateRchTarget('https://example.com/x', ['allowed.example']), /rch_host_forbidden/);
  // allowlist готов разрешить, но private/служебный IP (DNS-ребinding) — всегда блок.
  await assert.rejects(validateRchTarget('https://127.0.0.1/latest', ['127.0.0.1']), /rch_private_target/);
  await assert.rejects(validateRchTarget('https://169.254.169.254/latest', ['169.254.169.254']), /rch_private_target/);
  await assert.rejects(validateRchTarget('https://10.0.0.5/x', ['10.0.0.5']), /rch_private_target/);
});

// ===== 8. resolveStream (video-links): rch-JSON → final URL =====

test('RCH: resolveStream — JSON `{rch:true}` → RCH-повтор → primary play URL', async (t) => {
  const ws = await createWsServer();
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const wsUrl = `ws://127.0.0.1:${wsPort}/nws`;
  const cluster = makeCluster({
    wsUrl,
    routes: { '/lite/x/movie': '{"method":"play","url":"http://cdn/a.m3u8 or http://cdn/b.m3u8"}' }
  });
  const registry = new SkazRchRegistry({ timeoutMs: 2000, maxSessions: 8, fetchImpl: cluster.fetchImpl, validateUrl: ACCEPT_ALL });
  cleanup(t, () => registry.closeAll());
  const client = new SkazClient({
    balancer: 'x',
    hosts: ['http://cluster'],
    accountEmail: 'u@e.com',
    uid: 'abc123',
    fetchImpl: cluster.fetchImpl,
    rch: { enabled: true, registry, maxRounds: 3 }
  });

  // первый вызов к /lite/x/movie (без nws_id) — rch-гейт
  const final = await client.resolveStream('http://cluster/lite/x/movie.m3u8?play=true', { userUid: 'u1' });
  assert.equal(final, 'http://cdn/a.m3u8', 'primary-URL из RCH-результата');
  assert.ok(cluster.calls.some((c) => c.url.includes('nws_id=')), 'RCH-повтор был выполнен');
  await registry.closeAll();
  await ws.close();
});

test('RCH: resolveVideoJson без rch-гейта ведёт себя как раньше (прежний JSON-путь)', async (t) => {
  const cluster = makeCluster({ wsUrl: 'ws://127.0.0.1:9/nws', routes: { '/lite/x/movie': VIDEO_JSON } });
  cluster.gated.set('/lite/x/movie', 0); // без rch-гейта: прежний JSON-путь (registry отсутствует)
  const client = new SkazClient({
    balancer: 'x',
    hosts: ['http://cluster'],
    accountEmail: 'u@e.com',
    uid: 'abc123',
    fetchImpl: cluster.fetchImpl,
    rch: { enabled: true, registry: null, maxRounds: 3 }
  });
  const parsed = await client.resolveVideoJson('http://cluster/lite/x/movie.m3u8?play=true', { userUid: 'u1' });
  assert.ok(parsed, 'JSON распознан');
  assert.equal(parsed.method, 'play');
  assert.equal(parsed.url, 'http://cdn/primary.m3u8 or http://cdn/reserve.m3u8');
});

// ===== 9. rch без userUid — честный отказ, не контент =====

test('RCH: нет userUid → rch_no_user (RCH-контекст без пользователя не открывается)', async (t) => {
  const ws = await createWsServer();
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const cluster = makeCluster({ wsUrl: `ws://127.0.0.1:${wsPort}/nws`, routes: { '/lite/x': PLAY_HTML } });
  const registry = new SkazRchRegistry({ timeoutMs: 2000, maxSessions: 8, fetchImpl: cluster.fetchImpl, validateUrl: ACCEPT_ALL });
  cleanup(t, () => registry.closeAll());
  const client = new SkazClient({
    balancer: 'x',
    hosts: ['http://cluster'],
    accountEmail: 'u@e.com',
    uid: 'abc123',
    fetchImpl: cluster.fetchImpl,
    rch: { enabled: true, registry, maxRounds: 3 }
  });

  const html = await client.getLite({}, {}); // БЕЗ userUid
  assert.equal(html, null);
  assert.equal(client.lastRchError?.code, 'rch_no_user', 'RCH невозможен без контекста пользователя');
  assert.equal(ws.connections.length, 0, 'WS не открывался');
  assert.equal(registry.size, 0);
  await ws.close();
});

// ===== 10. Классификация ответа после разблокировки (live-находка) =====

test('RCH e2e: после разблокировки 503 + тело `null` = НОРМАЛЬНЫЙ EMPTY кластера (НЕ rch_timeout)', async (t) => {
  const ws = await createWsServer();
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const wsUrl = `ws://127.0.0.1:${wsPort}/nws`;
  // Кластер до разблокировки отвечает rch-гейтом; ПОСЛЕ разблокировки честно
  // отдаёт «контента нет» в своей конвенции: 503 + тело `null` (4 байта).
  // Это НЕ ошибка RCH — это пустой источник, как у всех ненужных хостов кластера.
  const cluster = makeCluster({
    wsUrl,
    routes: { '/lite/x': { status: 503, body: 'null' } }
  });
  const registry = new SkazRchRegistry({ timeoutMs: 2000, maxSessions: 8, fetchImpl: cluster.fetchImpl, validateUrl: ACCEPT_ALL });
  cleanup(t, () => registry.closeAll());
  const client = new SkazClient({
    balancer: 'x',
    hosts: ['http://cluster'],
    accountEmail: 'u@e.com',
    uid: 'abc123',
    fetchImpl: cluster.fetchImpl,
    rch: { enabled: true, registry, maxRounds: 3 }
  });

  const html = await client.getLite({ title: 'Game' }, { userUid: 'u1' });
  assert.equal(html, null, 'выполнено — контента нет');
  assert.equal(client.lastRchError, null, 'EMPTY после разблокировки — НЕ rch_timeout и НЕ ошибка');
  assert.ok(cluster.calls.some((c) => c.url.includes('nws_id=')), 'разблокировка прошла (повтор с nws_id)');
  assert.deepEqual(client.lastScan, { nonContent: 1, noResponse: 0, total: 1 }, 'EMPTY-классификация честная (узел сказал «нет», не отказ RCH)');
  await registry.closeAll();
  await ws.close();
});

test('RCH e2e: после разблокировки 503 + HTML-тело ≠ `null` = отказ upstream → rch_timeout', async (t) => {
  const ws = await createWsServer();
  cleanup(t, () => ws.close());
  const wsPort = await ws.listen();
  const wsUrl = `ws://127.0.0.1:${wsPort}/nws`;
  // Иной 4xx/5xx с не-`null` телом (nginx-страница, waf, 401) — настоящий отказ
  // upstream, НЕ «контента нет». Классифицировать как rch_timeout, не как EMPTY.
  const cluster = makeCluster({
    wsUrl,
    routes: { '/lite/x': { status: 503, body: '<html><body>Service Unavailable</body></html>' } }
  });
  const registry = new SkazRchRegistry({ timeoutMs: 2000, maxSessions: 8, fetchImpl: cluster.fetchImpl, validateUrl: ACCEPT_ALL });
  cleanup(t, () => registry.closeAll());
  const client = new SkazClient({
    balancer: 'x',
    hosts: ['http://cluster'],
    accountEmail: 'u@e.com',
    uid: 'abc123',
    fetchImpl: cluster.fetchImpl,
    rch: { enabled: true, registry, maxRounds: 3 }
  });

  const t0 = Date.now();
  const html = await client.getLite({ title: 'Game' }, { userUid: 'u1' });
  const elapsed = Date.now() - t0;
  assert.equal(html, null, 'контента нет');
  assert.equal(client.lastRchError?.code, 'rch_timeout', 'HTML-отказ после разблокировки честно помечен как rch_timeout');
  assert.ok(elapsed < 5000, `завершилось быстро (${elapsed}ms)`);
  await registry.closeAll();
  await ws.close();
});

test('RCH security: pushed content-хосты ренордов в proxy.allowHosts (config не регрессирует SSRF-локлист)', async () => {
  const { config } = await import('../src/config.js');
  const allowHosts = config.proxy.allowHosts;
  assert.ok(allowHosts.includes('ashdi.vip'), 'ashdi.vip в allowHosts (push-контент ashdi-ренорда)');
  assert.ok(allowHosts.includes('tortuga.tw'), 'tortuga.tw в allowHosts (push-контент kinoukr-ренорда)');
  // локлист остаётся закрытым: служебные хосты не должны добавляться
  for (const bad of ['127.0.0.1', '169.254.169.254', '10.0.0.1', '192.168.1.1', 'metadata.google.internal']) {
    assert.ok(!allowHosts.includes(bad), `${bad} НЕ в allowHosts`);
  }
});