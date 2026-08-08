// dump lampa DOM + localStorage on the VPS (clean one-off; zero deps)
const { spawn } = require("node:child_process");
const fs = require("fs");
const profile = "/tmp/lampa-dump-profile";
fs.mkdirSync(profile, { recursive: true });
const p = spawn("google-chrome", [
  "--remote-debugging-port=9333",
  "--remote-allow-origins=*",
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  `--user-data-dir=${profile}`,
  "http://lampa.mx",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let tgt = null;
  for (let i = 0; i < 45 && !tgt; i++) {
    try {
      const r = await fetch("http://127.0.0.1:9333/json/new?http%3A%2F%2Flampa.mx", { method: "PUT" });
      tgt = await r.json();
    } catch {}
    await sleep(700);
  }
  if (!tgt) { console.log("NO_TAB"); process.exit(1); }
  const ws = new WebSocket(tgt.webSocketDebuggerUrl);
  await new Promise((resolve) => (ws.onopen = resolve));
  let se = 0;
  const pend = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) { const h = pend.get(m.id); if (h) { pend.delete(m.id); h(m); } }
  };
  const call = (m, pa = {}) => new Promise((r) => { const id = ++se; pend.set(id, r); ws.send(JSON.stringify({ id, method: m, params: pa })); });
  await sleep(12000);
  const expr = `(()=>{const o={t:document.title,txt:document.body?(document.body.innerText||'').slice(0,1600):'<no body>',ls:{}};try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);o.ls[k]=(localStorage.getItem(k)||'').slice(0,140);}}catch(e){o.err=String(e)}return JSON.stringify(o)})()`;
  const r = await call("Runtime.evaluate", { expression: expr, returnByValue: true });
  console.log(r.result.value);
  try { fs.writeFileSync("/tmp/dump-ls.json", r.result.value, "utf-8"); } catch {}
  p.kill();
  process.exit(0);
}
main().catch((e) => { console.log("ERR " + e.message); process.exit(1); });