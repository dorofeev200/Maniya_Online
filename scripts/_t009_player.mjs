// SKAZ-MANIYA-009 P4 v3: real-player (hls.js) в headless Chrome на VPS.
// Статик-сервер раздаёт player.html + hls.min.js. m3u8-url передаётся query.
// Драйвер: ждёт loadEventFired, копит console-сообщения страницы, поллит
// __P4_RESULT__ (финальный) и __P4_PULSE__ (диагностика каждые 5s).
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFileSync } from 'node:fs';

const CHROME = process.env.P4_CHROME || '/usr/bin/google-chrome';
const PORT = Number(process.env.P4_PORT || 9228);
const STATIC_PORT = Number(process.env.P4_STATIC_PORT || 8777);
const STATIC_ROOT = process.env.P4_ROOT || '/tmp/fpg-shadow/hlscheck';
const TARGET_URL = process.env.P4_URL || '';
const TIMEOUT = Number(process.env.P4_TIMEOUT || 160000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startStatic(root, port) {
  const mime = { '.html': 'text/html', '.js': 'application/javascript' };
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/player.html';
      const file = root + p;
      if (!file.startsWith(root) || (!file.endsWith('.html') && !file.endsWith('.js'))) { res.writeHead(403); res.end(); return; }
      try {
        const body = readFileSync(file);
        const ext = p.slice(p.lastIndexOf('.')) || !p.includes('.') && '/';
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
      } catch { res.writeHead(404); res.end(); }
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

async function waitPort(port, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return; } catch {}
    await sleep(300);
  }
  throw new Error('chrome debug port not ready');
}

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws error')); });
  let id = 0;
  const pending = new Map();
  const events = { console: [], network: [] };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.consoleAPICalled') {
      events.console.push((msg.params.args || []).map((a) => a.value !== undefined ? JSON.stringify(a.value) : a.description || String(a.value)).join(' '));
    }
    if (msg.method === 'Network.responseReceived') {
      events.network.push({ url: String(msg.params.response.url).slice(0, 140), status: msg.params.response.status, ctype: (msg.params.response.mimeType || '').slice(0, 30) });
    }
    if (msg.method === 'Network.loadingFailed') {
      events.network.push({ url: String(msg.params.requestId).slice(0, 10) + 'FAILED', error: msg.params.errorText });
    }
  };
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  return { ws, send, events };
}

async function evalJson(conn, expression) {
  const out = await conn.send('Runtime.evaluate', { expression, returnByValue: true }).catch(() => null);
  return out && out.result && out.result.result ? out.result.result.value : undefined;
}

(async () => {
  await startStatic(STATIC_ROOT, STATIC_PORT);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=/tmp/chrome-t009-${process.pid}`,
    '--remote-allow-origins=*',
    '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required',
    '--mute-audio', '--no-first-run', 'about:blank'
  ], { stdio: 'ignore' });
  let conn;
  try {
    await waitPort(PORT);
    const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about%3Ablank`, { method: 'PUT' })).json();
    conn = await cdp(tabs.webSocketDebuggerUrl);
    await conn.send('Runtime.enable');
    await conn.send('Page.enable');
    await conn.send('Network.enable');
    const pageUrl = `http://127.0.0.1:${STATIC_PORT}/_t009_player.html?url=${encodeURIComponent(TARGET_URL)}`;
    const nav = await conn.send('Page.navigate', { url: pageUrl });
    const t0 = Date.now();
    const diag = async () => {
      const loc = await evalJson(conn, 'location.href').then(String);
      const scripts = await evalJson(conn, 'document.scripts ? document.scripts.length : -1');
      const hasHls = await evalJson(conn, 'typeof Hls');
      const rb = await evalJson(conn, 'document.readyState');
      const pulse = await evalJson(conn, '(window.__P4_PULSE__ && {t:window.__P4_PULSE__.t, parsed:window.__P4_PULSE__.parsed, fragLoaded:window.__P4_PULSE__.fragLoaded})') || null;
      const errTxt = (nav && nav.result && nav.result.errorText) ? nav.result.errorText : null;
      return { loc, scripts, hasHls, rb, pulse, navError: errTxt };
    };
    for (;;) {
      const val = await evalJson(conn, 'window.__P4_RESULT__');
      if (val) { console.log(JSON.stringify({ loaded: true, ver: 'v4', ...val, ...(await diag()), net: conn.events.network.slice(-30), pageConsole: conn.events.console.slice(-40) }, null, 1)); return; }
      const stale = Date.now() - t0 > TIMEOUT;
      if (stale) {
        console.log(JSON.stringify({ ok: false, reason: 'timeout-no-result', pageUrl, ...(await diag()), net: conn.events.network.slice(-30), pageConsole: conn.events.console.slice(-40) }, null, 1));
        return;
      }
      await sleep(1500);
    }
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e).slice(0, 400), pageConsole: conn ? conn.events.console.slice(-40) : null }, null, 1));
  } finally {
    try { if (conn) conn.ws.close(); } catch {}
    chrome.kill();
  }
})();