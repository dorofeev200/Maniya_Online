// SKAZ-MANIYA-009 P4: real-player check (hls.js 1.7.1 в headless Chrome на VPS).
// Запуск: NODE_CDP=1 P4_URL=<m3u8-url> node _t009_player.cjs
// Поднимает Chrome headless, навигирует на local file-плеер, который грузит
// <P4_URL> через hls.js и накапливает события. Через CDP читаем результат.
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';

const CHROME = process.env.P4_CHROME || '/usr/bin/google-chrome';
const HOST = process.env.P4_HOST || '127.0.0.1';
const PORT = process.env.P4_PORT || 9228;
const PAGE = process.env.P4_PAGE || 'file:///tmp/fpg-shadow/hlscheck/player.html';
const TARGET_URL = process.env.P4_URL || '';
const TIMEOUT = Number(process.env.P4_TIMEOUT || 90000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPort(port, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`http://${HOST}:${port}/json/version`);
      if (r.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error('chrome debug port not ready');
}

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ws, send };
}

(async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    `--remote-debugging-port=${PORT}`,
    '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required',
    '--mute-audio', 'about:blank'
  ], { detached: false, stdio: 'ignore' });

  let ws, conn;
  try {
    await waitPort(PORT);
    const tabs = await (await fetch(`http://${HOST}:${PORT}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' })).json();
    conn = await cdp(tabs.webSocketDebuggerUrl);
    ws = conn.ws;
    await conn.send('Runtime.enable');
    await conn.send('Page.enable');
    await sleep(1500);
    // передать цель в page-контекст
    await conn.send('Runtime.evaluate', { expression: `window.__P4_URL__ = ${JSON.stringify(TARGET_URL)}; "set"` });
    const t0 = Date.now();
    let lastJson = null;
    for (;;) {
      const out = await conn.send('Runtime.evaluate', {
        expression: 'window.__P4_RESULT__',
        returnByValue: true
      });
      const val = out && out.result && out.result.result ? out.result.result.value : null;
      if (val) { lastJson = val; break; }
      if (Date.now() - t0 > TIMEOUT) break;
      await sleep(1200);
    }
    if (!lastJson) {
      console.log(JSON.stringify({ ok: false, reason: 'no __P4_RESULT__ within timeout', timeoutMs: TIMEOUT }, null, 1));
      return;
    }
    console.log(JSON.stringify(lastJson, null, 1));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e).slice(0, 300) }, null, 1));
  } finally {
    try { if (ws) ws.close(); } catch {}
    chrome.kill();
  }
  process.exit(0);
})();