// TASK-SKAZ-MANIYA-023 probe: balancer discovery (lite/withsearch) + search (lite/fsearch).
// READ-ONLY GET к публичному кластеру с auth-парами из config (секретов в вывод НЕ пишем).
// Run from server/ CWD:  node scripts/_t023_probe.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
const { config } = await import('../server/src/config.js');

const HOST = config.skaz.hosts[0]; // http://online3.skaz.tv
const email = String(config.skaz.accountEmail || '').trim();
const uid = String(config.skaz.uid || '').trim();
const auth = `account_email=${encodeURIComponent(email)}&uid=${encodeURIComponent(uid)}`;
mkdirSync('docs/t023', { recursive: true });

async function get(u, label) {
  const start = Date.now();
  let status, bodyRaw, err;
  try {
    const r = await fetch(u, { headers: { Origin: config.skaz.origin } });
    status = r.status; bodyRaw = await r.text();
  } catch (e) { err = String(e); }
  return { label, url: u.replace(/account_email=[^&]*&uid=[^&]*/, 'account_email=REDACTED&uid=REDACTED'), status, ms: Date.now() - start, len: bodyRaw?.length ?? 0, body: bodyRaw?.slice(0, 600) ?? '', err };
}

const out = {};
// 1) Discovery: список доступных balancers
out.withsearch = await get(`${HOST}/lite/withsearch?${auth}`, 'lite/withsearch');
// 2) Search сериала (дом дракон) — есть ли id/kinopoisk/season в ответе
out.fsearch = await get(`${HOST}/lite/fsearch?q=${encodeURIComponent('Дом Дракона')}&${auth}`, 'lite/fsearch');
writeFileSync('docs/t023/probe.json', JSON.stringify(out, null, 2), 'utf8');
for (const k of Object.keys(out)) {
  const r = out[k];
  console.log(`\n== ${k} == ${r.status} ${r.ms}ms len=${r.len} err=${r.err ?? '-'}`);
  console.log(r.body || '(empty)');
}
console.log('\n→ docs/t023/probe.json');