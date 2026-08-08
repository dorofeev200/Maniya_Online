#!/usr/bin/env node
// lampa-token-sniff.mjs — захват токенов/авторизации Lampa (CUB + провайдеры)
// со СВОЕГО Chrome через протокол DevTools (CDP). Zero-dep, Node ≥ 22 (global WebSocket).
//
// Что делает:
//   1. Сам запускает Chrome/Chromium с --remote-debugging-port и отдельным профилем.
//   2. Подключается к вкладке lampa.mx по CDP (WebSocket).
//   3. Читает localStorage (там живёт CUB-токен сессии) и метит значения-токены.
//   4. Включает Network и печатает authorization/cookie на запросах к cub.rip и провайдерам.
//   5. Пока идёт окно браузера — открываете любой фильм («Открыть») — заголовки в лог.
//
// Запуск:
//   node lampa-token-sniff.mjs                # интерактив (ручной вход в CUB возможен)
//   node lampa-token-sniff.mjs --headless --auto --seconds 30
//   node lampa-token-sniff.mjs --user-data-dir "C:\Users\Me\AppData\Local\ProfileX"
//
// Вывод: cub-localstorage.json (весь localStorage) в текущей папке. НЕ коммить его в git.

import { spawn, execFileSync } from "node:child_process";
import { URL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const CDP_HOST = "127.0.0.1";
const DEFAULT_PORT = 9222;

const TARGET_HOSTS = [
  "cub.rip", "lampa.mx", "tmdb", "kodik", "rezka", "filmix",
  "voidboost", "alloha", "hdvb", "cdnvideohub", "rutube", "kinopoisk",
];
const AUTH_HEADERS = ["authorization", "cookie", "x-token", "token",
                      "access-token", "api-key", "x-api-key", "apikey", "x-access-token"];

const log = (m) => console.log(m);

const CHROME_CANDIDATES = [
  "google-chrome-stable", "google-chrome", "chromium-browser", "chromium", "chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/opt/google/chrome/chrome",
  "/snap/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

function findChrome() {
  const pathEntries = (process.env.PATH || "").split(path.delimiter);
  for (const name of CHROME_CANDIDATES) {
    if (name.includes("/") || name.includes("\\")) {
      if (fs.existsSync(name)) return name;
      continue;
    }
    for (const dir of pathEntries) {
      const p = path.join(dir, os.platform() === "win32" ? name + ".exe" : name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Убить зависшие Chrome-инстансы со своим профилем (иначе лок профиля мешает старту). */
function killOurChrome(marker = "lampa-cub-sniff-profile") {
  try {
    if (os.platform() === "win32") {
      const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ` +
        `Where-Object { $_.CommandLine -like '*${marker}*' -and $_.CommandLine -like '*remote-debugging-port*' } | ` +
        `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps],
        { stdio: "ignore", windowsHide: true });
    } else {
      execFileSync("pkill", ["-f", marker + ".*remote-debugging-port"], { stdio: "ignore" });
    }
  } catch {}
}

async function endpointReady(port) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1200);
  try {
    const res = await fetch(`http://${CDP_HOST}:${port}/json/version`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

// ---------- CDP ----------
function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const events = [];
    let seq = 0;

    ws.onerror = (e) => reject(new Error("ws error: " + (e?.message || "?")));
    ws.onopen = () => {
      const call = (method, params = {}) =>
        new Promise((res, rej) => {
          const id = ++seq;
          pending.set(id, { res, rej });
          try {
            ws.send(JSON.stringify({ id, method, params }));
          } catch (err) {
            pending.delete(id);
            rej(err);
          }
        });
      const drain = () => { const out = events.splice(0); return out; };
      const close = () => { try { ws.close(); } catch {} };
      resolve({ call, drain, close, get ws() { return ws; } });
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : ""); }
      catch { return; }
      if (msg.id !== undefined) {
        const h = pending.get(msg.id);
        if (h) {
          pending.delete(msg.id);
          msg.error ? h.rej(new Error((msg.error.message || "CDP") + " [" + (msg.error.code ?? "") + "]"))
                    : h.res(msg.result);
        }
      } else if (msg.method) {
        events.push(msg);
      }
    };
  });
}

async function openTab(port, url) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const reqUrl = `http://${CDP_HOST}:${port}/json/new?` + encodeURIComponent(url);
      const res = await fetch(reqUrl, { method: "PUT", signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const tgt = await res.json();
        if (tgt.webSocketDebuggerUrl) return tgt.webSocketDebuggerUrl;
      }
    } catch {}
    await sleep(700);
  }
  // запасной вариант — первая попавшаяся вкладка
  try {
    const res = await fetch(`http://${CDP_HOST}:${port}/json`);
    const list = await res.json();
    for (const t of list) {
      if (t.type === "page" && t.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    }
  } catch {}
  throw new Error(`Не удалось открыть вкладку (порт ${port})`);
}

function looksLikeToken(v) {
  if (!v || typeof v !== "string" || v.length < 12) return false;
  v = v.trim();
  if (/\s/.test(v)) return false;
  if (v.startsWith("http") || v.startsWith("data:") || v.startsWith("{") || v.startsWith("<")) return false;
  if (v.includes(".") && v.length < 4000) return true; // JWT
  if (v.startsWith("mo-") || v.startsWith("eyJ") || /^[Bb]earer /.test(v)) return true;
  const body = v.replace(/[-_]/g, "");
  return /^[A-Za-z0-9]{16,128}$/.test(body);
}

function maskLong(v, limit = 120) {
  if (v == null) return "";
  v = String(v);
  return v.length <= limit ? v : v.slice(0, 60) + `…(…${v.length - 120}…)`;
}

async function readLocalstorage(cdp) {
  const expr = `(()=>{let err=null;const o={};try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);o[k]=localStorage.getItem(k);}}catch(e){err=String(e)}try{o["__cookie__"]=document.cookie}catch(e){}if(err)o["__err__"]=err;return o;})()`;
  const r = await cdp.call("Runtime.evaluate", { expression: expr, returnByValue: true });
  const v = r?.result?.value;
  return v && typeof v === "object" ? v : {};
}

/** Ждём, пока страница lampa.mx реально загрузится и localStorage станет доступен. */
async function waitPageReady(cdp, origins, timeoutMs = 30000) {
  const expr = `(()=>{const o={href:location.href,ready:document.readyState,lsErr:null};try{o.lsOk=localStorage.length;o.ls=0}catch(e){o.lsErr=String(e)}return JSON.stringify(o)})()`;
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const r = await cdp.call("Runtime.evaluate", { expression: expr, returnByValue: true });
      const txt = r?.result?.value;
      if (txt) {
        const o = JSON.parse(txt);
        last = o.href + " (ready=" + o.ready + ", lsErr=" + (o.lsErr ? "да" : "нет") + ")";
        if (!o.lsErr && origins.some((h) => o.href.startsWith(h)) && o.ready === "complete") return o;
      }
    } catch (e) {
      last = "err:" + e.message;
    }
    await sleep(750);
  }
  log("  [waitReady] НЕ дождался lampa.mx. Последнее: " + (last || "«пусто»"));
  return null;
}

function printLocalstorage(f) {
  log("\n=== localStorage lampa.mx ===");
  const keys = Object.keys(f).filter((k) => !k.startsWith("__"));
  if (!keys.length) {
    log("  (пусто или недоступен — откройте lampa.mx и залогиньтесь в CUB)");
    if (f.__err__) log("  error: " + f.__err__);
    return;
  }
  keys.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  for (const k of keys) {
    const v = f[k] || "";
    log("  " + k.padEnd(28) + " = " + maskLong(v)
        + (looksLikeToken(v) ? "   <-- ВОЗМОЖНЫЙ ТОКЕН" : ""));
  }
  if (f.__cookie__) log("  document.cookie: " + maskLong(f.__cookie__, 300));
  try {
    fs.writeFileSync("cub-localstorage.json", JSON.stringify(f, null, 2) + "\n", "utf-8");
    log("  (полный дамп: cub-localstorage.json)");
  } catch (e) {
    log("  (не сохранил файл: " + e.message + ")");
  }
}


async function watchNetwork(cdp, seconds) {
  const deadline = Date.now() + seconds * 1000;
  let printed = 0;
  while (Date.now() < deadline) {
    for (const msg of cdp.drain()) {
      const m = msg.method;
      const p = msg.params || {};
      if (m === "Network.requestWillBeSent") {
        const req = p.request || {};
        const url = req.url || "";
        const hdrs = {};
        for (const [k, v] of Object.entries(req.headers || {})) hdrs[String(k).toLowerCase()] = String(v);
        let auth = "";
        if (hdrs.authorization) auth += "authorization=" + maskLong(hdrs.authorization) + " ";
        if (hdrs.cookie && (url.includes("cub") || url.includes("lampa")))
          auth += "cookie=" + maskLong(hdrs.cookie, 300) + " ";
        for (const k of AUTH_HEADERS) {
          if (k === "authorization" || k === "cookie") continue;
          if (hdrs[k]) auth += `[${k}]=` + maskLong(hdrs[k]) + " ";
        }
        if (auth || TARGET_HOSTS.some((h) => url.includes(h))) {
          printed++;
          log("REQ " + (p.type || "") + " " + auth + url);
        }
      } else if (m === "Network.responseReceived") {
        const resp = p.response || {};
        const sh = {};
        for (const [k, v] of Object.entries(resp.headers || {})) sh[String(k).toLowerCase()] = String(v);
        for (const k of ["set-cookie", "set-cookie2"]) {
          if (sh[k]) { printed++; log(`SET-COOKIE ${p.url} -> ${maskLong(sh[k], 300)}`); }
        }
      }
    }
    await sleep(150);
  }
  log("  …обработано записей сети: " + printed);
}

async function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => { rl.close(); resolve(ans); });
  });
}

function parseArgs(argv) {
  const a = { port: DEFAULT_PORT, url: "https://lampa.mx", headless: false, auto: false, seconds: 45, chromePath: null, userDataDir: null };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    const nx = () => argv[++i];
    if (s === "--port") a.port = Number(nx());
    else if (s === "--url") a.url = nx();
    else if (s === "--headless") a.headless = true;
    else if (s === "--headless=false") a.headless = false;
    else if (s === "--auto") a.auto = true;
    else if (s === "--seconds") a.seconds = Number(nx());
    else if (s === "--chrome-path") a.chromePath = nx();
    else if (s === "--user-data-dir") a.userDataDir = nx();
    else if (s === "--dom") a.dom = true;
    else if (s === "--click") a.click = nx();
  }
  return a;
}

function startBrowser(chrome, port, headless, profileDir, url) {
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-session-crashed-bubble",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--user-data-dir=${profileDir}`,
    "--window-size=1280,860",
  ];
  if (headless) args.push("--headless=new");
  args.push(url);
  log(`[2] Запускаю браузер (порт ${port}, headless=${headless})…`);
  return spawn(chrome, args, { stdio: "ignore" });
}

async function main() {
  const A = parseArgs(process.argv.slice(2));
  const profileDir = A.userDataDir || path.join(os.homedir(), ".lampa-cub-sniff-profile");
  fs.mkdirSync(profileDir, { recursive: true });

  // убрать зомби с этим профилем, чтобы новый Chrome мог стартовать
  killOurChrome(path.basename(profileDir));

  const chrome = A.chromePath || findChrome();
  if (!chrome) {
    console.error("Chrome/Chromium не найден. Укажите --chrome-path /usr/bin/chromium");
    process.exit(1);
  }
  log("Браузер: " + chrome);

  let proc = null;
  if (await endpointReady(A.port)) {
    log(`[0] На порту ${A.port} уже Chrome (debug) — цепляюсь.`);
  } else {
    proc = startBrowser(chrome, A.port, A.headless, profileDir, A.url);
  }

  const wsUrl = await openTab(A.port, A.url);
  const cdp = await cdpConnect(wsUrl);
  log(`[1] Вкладка: ${A.url}`);

  try { await cdp.call("Network.enable"); } catch (e) { log("(Network.enable: " + e.message + ")"); }
  try { await cdp.call("Runtime.enable"); } catch {}

  // ждём, пока SPA lampa.mx реально загрузится (иначе localStorage недоступен)
  await waitPageReady(cdp, ["https://lampa.mx", "http://lampa.mx"]);
  await sleep(800);

  if (!A.auto) {
    log("\n[2] Браузер открыт. Если ещё не залогинен в CUB — залогинься.");
    log("    Затем ОТКРОЙ ЛЮБОЙ ФИЛЬМ (кнопка «Открыть») в окне браузера.\n");
    const ls1 = await readLocalstorage(cdp);
    printLocalstorage(ls1);
    try { await prompt("    <Enter> — далее… "); } catch {}
  } else {
    log(`[2] auto: слушаю ${A.seconds} c…`);
  }

  const ls = await readLocalstorage(cdp);
  printLocalstorage(ls);

  if (A.dom) {
    if (A.click) {
      const cj = `(()=>{const t=${JSON.stringify(A.click)};
const flat=(root)=>{const all=[...(root.querySelectorAll('*'))];for(const el of all){if(el.shadowRoot)all.push(...flat(el.shadowRoot))}return all};
const all=flat(document.body);
const el=all.find(e=>(e.textContent||'').trim()===t)||all.find(e=>(e.childElementCount===0&&(e.textContent||'').includes(t)&&(e.textContent||'').length<40));
if(!el){const dbg=flat(document.body).filter(e=>e.textContent&&e.textContent.includes(t)).map(e=>String(e.tagName)+'.'+String(e.className||'').slice(0,24)+' txt='+((e.childNodes[0]&&e.childNodes[0].nodeType===3)?(e.childNodes[0].textContent||'').trim().slice(0,16):'-')).slice(0,14);return 'NOT_FOUND '+JSON.stringify(dbg)}
try{el.scrollIntoView({block:'nearest'})}catch(e){}
const r=el.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;
el.click&&el.click();return JSON.stringify({x,y})})()`;
      try {
        const cr = await cdp.call("Runtime.evaluate", { expression: cj, returnByValue: true });
        const cv = cr?.result?.value;
        log("  [click '" + A.click + "'] -> " + cv);
        let p = null;
        if (cv !== "NOT_FOUND" && cv) { try { p = JSON.parse(cv); } catch {} }
        if (p && typeof p.x === "number") {
          for (const ty of ["mousePressed", "mouseReleased"])
            await cdp.call("Input.dispatchMouseEvent", { type: ty, x: p.x, y: p.y, button: "left", clickCount: 1 });
          log("  (мышь: " + Math.round(p.x) + "," + Math.round(p.y) + ")");
        }
        await sleep(6000);
      } catch (e) { log("(click: " + e.message + ")"); }
    }
    const domExpr = `(()=>{const b=document.body;
const flat=(root)=>{const all=[...(root.querySelectorAll('*'))];for(const el of all){if(el.shadowRoot)all.push(...flat(el.shadowRoot))}return all};
const fs=b?flat(b):[];
return JSON.stringify({txt:b?(b.innerText||'').slice(0,2200):'<no body>',inputs:fs.filter(e=>e.tagName==='INPUT').map(i=>({pl:i.placeholder||'',tp:i.type,cc:(i.className||'').slice(0,20)})).slice(0,12),buttons:fs.filter(e=>(e.tagName==='BUTTON'||e.tagName==='A')&&!(e.textContent||'').trim().startsWith('\n')).map(x=>String(x.textContent||'').trim().slice(0,28)).filter(Boolean).slice(0,24),href:location.href})})()`;
    try {
      const dr = await cdp.call("Runtime.evaluate", { expression: domExpr, returnByValue: true });
      const dv = dr?.result?.value;
      log("\n=== DOM lampa.mx ===");
      log(typeof dv === "string" ? dv : JSON.stringify(dv, null, 1));
    } catch (e) { log("(dom: " + e.message + ")"); }
  }

  log(`[3] Слушаю сеть ${A.seconds} сек (Authorization/Cookie/SET-COOKIE):`);
  await watchNetwork(cdp, A.seconds);
  log("[4] Готово.\n"
      + "   - Файл: cub-localstorage.json (полный localStorage, в текущей папке).\n"
      + "   - Токены — по строкам `authorization=`, `cookie=`, `SET-COOKIE=`.\n"
      + "   - НЕ коммить cub-localstorage.json в git.");
  try { cdp.close(); } catch {}
  if (proc) try { proc.kill(); } catch {}
}

main().catch((e) => { console.error("FATAL: " + e.message); process.exit(1); });