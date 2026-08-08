// cdp-ax-click.cjs — клик по UI-элементу Lampa через CDP Accessibility-дерево.
// Видит и ЗАКРЫТЫЕ shadow DOM (AX + DOM.getBoxModel работают по composed tree).
// Zero-dep, Node ≥ 22 (global WebSocket).
//
// Алгоритм:
//   1. Запуск Chrome на --remote-debugging-port, открыть url.
//   2. Accessibility.getFullAXTree → ищем node с именем = тексту '--ax'.
//   3. DOM.getBoxModel по backendDOMNodeId → центр элемента → Input.dispatchMouseEvent.
//   4. Дамп innerText после клика + сеть 4с (Authorization/Cookie/SET-COOKIE).
//
// Флаги:
//   --ax "Настройки"      текст для клика (точное совпадение по name)
//   --find "Настройки"    не кликать — только вывести найденные ноды с bbox
//   --url http://lampa.mx
//   --port 9333
//   --after-ms 5000        пауза после клика перед дампом
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CDP_HOST = "127.0.0.1";
const DEFAULT_PORT = 9333;

const A = (() => {
  const argv = process.argv.slice(2);
  const a = { ax: null, find: null, url: "http://lampa.mx", port: DEFAULT_PORT, afterMs: 5000 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--ax") a.ax = argv[++i];
    else if (argv[i] === "--find") a.find = argv[++i];
    else if (argv[i] === "--url") a.url = argv[++i];
    else if (argv[i] === "--port") a.port = Number(argv[++i]);
    else if (argv[i] === "--after-ms") a.afterMs = Number(argv[++i]);
  }
  return a;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(m);

function findChrome() {
  for (const name of [
    "google-chrome-stable", "google-chrome", "chromium-browser", "chromium", "chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/opt/google/chrome/chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ]) {
    if (name.includes("/") || name.includes("\\")) { if (fs.existsSync(name)) return name; continue; }
    const found = (process.env.PATH || "").split(path.delimiter)
      .map((d) => path.join(d, os.platform() === "win32" ? name + ".exe" : name))
      .find(fs.existsSync);
    if (found) return found;
  }
  return null;
}

function killOurChrome() {
  try {
    if (os.platform() === "win32") {
      const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ` +
        `Where-Object { $_.CommandLine -like '*cub-ax-profile*' } | ` +
        `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore", windowsHide: true });
    } else {
      execFileSync("pkill", ["-f", "cub-ax-profile"], { stdio: "ignore" });
    }
  } catch {}
}

async function endpointReady(port) {
  try { const r = await fetch(`http://${CDP_HOST}:${port}/json/version`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}

function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const events = [];
    let seq = 0;
    ws.onerror = () => reject(new Error("ws error"));
    ws.onopen = () => {
      const call = (method, params = {}) => new Promise((res, rej) => {
        const id = ++seq; pending.set(id, { res, rej });
        try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { pending.delete(id); rej(e); }
      });
      const drain = () => events.splice(0);
      resolve({ call, drain, close: () => { try { ws.close(); } catch {} } });
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id !== undefined) { const h = pending.get(m.id); if (h) { pending.delete(m.id); m.error ? h.rej(new Error(m.error.message)) : h.res(m.result); } }
      else if (m.method) events.push(m);
    };
  });
}

async function openTab(port, url) {
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://${CDP_HOST}:${port}/json/new?` + encodeURIComponent(url), { method: "PUT", signal: AbortSignal.timeout(3000) });
      if (r.ok) { const t = await r.json(); if (t.webSocketDebuggerUrl) return t.webSocketDebuggerUrl; }
    } catch {}
    await sleep(700);
  }
  const r = await fetch(`http://${CDP_HOST}:${port}/json`);
  const list = await r.json();
  for (const t of list) if (t.type === "page" && t.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
  throw new Error("no tab");
}

async function waitReady(cdp, urlPrefix) {
  const expr = `(()=>{try{return JSON.stringify({h:location.href,r:document.readyState})}catch(e){return JSON.stringify({h:'',r:'ERR'})}})()`;
  const deadline = Date.now() + 30000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const r = await cdp.call("Runtime.evaluate", { expression: expr, returnByValue: true });
      const o = JSON.parse(r?.result?.value || "{}");
      last = o.h + " r=" + o.r;
      if (o.h && o.h.startsWith(urlPrefix) && o.r === "complete") return;
    } catch {}
    await sleep(700);
  }
  log("  [ready] timeout, last: " + last);
}

function roleName(role) {
  if (!role || !role.value) return "";
  const v = String(role.value);
  if (/^\d+$/.test(v)) return v; // класс. числовые роли CSS-JS — просто вывести
  return v;
}
const nameOf = (n) => (n.name && n.name.value) || "";

async function findNodes(cdp, text) {
  const ax = await cdp.call("Accessibility.getFullAXTree");
  const nodes = ax.nodes || [];
  const out = [];
  for (const n of nodes) {
    const nm = String(nameOf(n)).trim();
    if (!n.ignored && n.backendDOMNodeId && (nm === text || nm.includes(text))) {
      out.push({ nm, role: roleName(n.role), backendNodeId: n.backendDOMNodeId, bbox: n.boundingBox });
    }
  }
  return out;
}

async function boxFor(cdp, backendNodeId) {
  try {
    const r = await cdp.call("DOM.getBoxModel", { backendNodeId });
    const q = r.model && r.model.content;
    if (q && q.length >= 8) {
      const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    }
  } catch {}
  return null;
}

async function clickAt(cdp, x, y) {
  for (const ty of ["mousePressed", "mouseReleased"])
    await cdp.call("Input.dispatchMouseEvent", { type: ty, x, y, button: "left", clickCount: 1 });
  log("  (мышь " + Math.round(x) + "," + Math.round(y) + ")");
}

// Клик по AX-узлу с привязкой к реальному viewport.
// getBoxModel даёт координаты в документе, которые выходят за окно браузера
// (блокер «Настройки» X=1518 при окне 1400). Решение — DOM.scrollIntoViewIfNeeded,
// затем свежий getBoxModel уже в viewport-координатах (работает и для текстовых узлов).
async function scrollIntoViewportClick(cdp, backendNodeId) {
  try {
    await cdp.call("DOM.scrollIntoViewIfNeeded", { backendNodeId });
  } catch (e) { return false; }
  await new Promise((r) => setTimeout(r, 250)); // дать браузеру отрисовать после скролла
  const box = await boxFor(cdp, backendNodeId);
  if (!box) return false;
  const vp = { w: 1400, h: 900 };
  try {
    const r = await cdp.call("Runtime.evaluate", { expression: "({w:innerWidth,h:innerHeight})", returnByValue: true });
    if (r?.result?.value) vp.w = r.result.value.w, vp.h = r.result.value.h;
  } catch {}
  if (box.x < 1 || box.y < 1 || box.x > vp.w - 1 || box.y > vp.h - 1) return false;
  await clickAt(cdp, box.x, box.y);
  return true;
}

async function dumpState(cdp) {
  const expr = `(()=>{const b=document.body;return JSON.stringify({txt:b?(b.innerText||'').slice(0,2600):'<no body>',inputs:b?Array.from(b.querySelectorAll('input')).map(i=>({pl:i.placeholder||'',tp:i.type})).slice(0,12):[],href:location.href})})()`;
  try {
    const r = await cdp.call("Runtime.evaluate", { expression: expr, returnByValue: true });
    const v = r.result?.value;
    log("\n=== STATE ===");
    log(typeof v === "string" ? v : JSON.stringify(v));
  } catch (e) { log("(state: " + e.message + ")"); }
}

async function listenNetwork(cdp, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    for (const msg of cdp.drain()) {
      const p = msg.params || {};
      if (msg.method === "Network.requestWillBeSent") {
        const hdrs = {};
        for (const [k, v] of Object.entries(p.request?.headers || {})) hdrs[k.toLowerCase()] = String(v);
        let a = "";
        if (hdrs.authorization) a += "auth=" + hdrs.authorization.slice(0, 140) + " ";
        if (hdrs.cookie && (p.request?.url || "").includes("cub")) a += "cookie=" + hdrs.cookie.slice(0, 200) + " ";
        if (a) log("REQ " + (p.request?.url || "") + " :: " + a);
      } else if (msg.method === "Network.responseReceived") {
        const sh = {};
        for (const [k, v] of Object.entries(p.response?.headers || {})) sh[k.toLowerCase()] = String(v);
        if (sh["set-cookie"]) log("SET-COOKIE " + (p.response?.url || "") + " -> " + sh["set-cookie"].slice(0, 200));
      }
    }
    await sleep(160);
  }
}

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.error("chrome not found"); process.exit(1); }
  const profile = path.join(os.tmpdir(), "cub-ax-profile");
  fs.mkdirSync(profile, { recursive: true });
  killOurChrome();

  let proc = null;
  if (!(await endpointReady(A.port))) {
    proc = spawn(chrome, [
      `--remote-debugging-port=${A.port}`, "--remote-allow-origins=*",
      "--headless=new", "--disable-gpu", "--no-sandbox",
      "--disable-dev-shm-usage", `--user-data-dir=${profile}`,
      "--window-size=1400,900", A.url,
    ], { stdio: "ignore" });
  }

  const wsUrl = await openTab(A.port, A.url);
  const cdp = await cdpConnect(wsUrl);
  log("tab: " + A.url);
  try { await cdp.call("Network.enable"); } catch {}
  try { await cdp.call("Runtime.enable"); } catch {}
  try { await cdp.call("DOM.enable"); } catch {}
  try { await cdp.call("Accessibility.enable"); } catch {}

  await sleep(3000);
  await waitReady(cdp, A.url.replace(/^https?:\/\//, "http"));

  const target = A.ax || A.find;
  log("\n--- ищу в AX: «" + target + "» ---");
  const found = await findNodes(cdp, target);
  if (!found.length) {
    log("AX NOT_FOUND. Свежий innerText:");
    await dumpState(cdp);
    try { cdp.close(); } catch {}
    if (proc) try { proc.kill(); } catch {}
    process.exit(1);
  }
  for (let i = 0; i < found.length; i++) {
    const f = found[i];
    const box = await boxFor(cdp, f.backendNodeId);
    log(`  [${i}] <${f.role}> "${f.nm}" bbox=${box ? Math.round(box.x) + "," + Math.round(box.y) : "null"} id=${f.backendNodeId}`);
  }

  if (A.ax) {
    let clicked = false;
    for (const f of found) {
      // 1) viewport-клик (scrollIntoView + rect) — надёжнее для элементов за пределами окна
      if (await scrollIntoViewportClick(cdp, f.backendNodeId)) { clicked = true; log("  (viewport-клик по «" + f.nm + "»)"); break; }
      // 2) фолбэк: документные координаты из getBoxModel
      const box = await boxFor(cdp, f.backendNodeId);
      if (box) { await clickAt(cdp, box.x, box.y); clicked = true; break; }
    }
    if (!clicked) log("  (нет координат — клик не выполнен)");
  }

  await sleep(A.afterMs);
  await dumpState(cdp);
  await listenNetwork(cdp, 4000);

  try { cdp.close(); } catch {}
  if (proc) try { proc.kill(); } catch {}
  process.exit(0);
}

main().catch((e) => { console.error("FATAL: " + e.message); try { process.exit(1); } catch {} });