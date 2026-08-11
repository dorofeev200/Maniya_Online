// HOST ROTATION STABILITY TEST (runs ON VPS)
// 20 sequential /videos requests to prod for a call-provider (skaz-alloha):
// latency + items + method per request. Then 20 raw SkazClient getLite calls
// to see per-host status/latency/result (rotation is per-buildLiteUrl).
import { readFileSync } from 'node:fs';
import { SkazClient } from '../server/src/providers/skaz/SkazClient.js';
import { SkazNormalizer } from '../server/src/providers/skaz/SkazNormalizer.js';

const BASE = 'http://127.0.0.1:3000';
const users = JSON.parse(readFileSync('/opt/maniya-online/server/data/users.json', 'utf8'));
const arr = Array.isArray(users) ? users : (users.users || []);
const token = (arr.find((x) => x && x.active && x.token) || arr[0])?.token || '';
const SPIDER = {
  id: '634649', tmdb_id: '634649', imdb_id: 'tt10872600', kinopoisk_id: '1309570',
  title: 'Человек-паук: Нет пути домой', original_title: 'Spider-Man: No Way Home',
  serial: '0', year: '2021', source: 'tmdb'
};

async function get(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'Mozilla/5.0 Chrome/126' } });
    return { ms: Date.now() - t0, status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  } catch (e) { return { ms: Date.now() - t0, status: 0, err: e.message }; }
}

console.log('=== A. 20 sequential /api/lampa/videos?provider=skaz-alloha (prod) ===');
let ok = 0, fail = 0, slow = 0, totalMs = 0;
for (let i = 0; i < 20; i++) {
  const q = new URLSearchParams({ token, provider: 'skaz-alloha', ...SPIDER });
  const r = await get(`${BASE}/api/lampa/videos?${q}`);
  let items = 0, method = '-';
  if (r.status === 200) {
    try { const j = JSON.parse(r.buf.toString('utf8')); items = (j.items || []).length; method = (j.items || [])[0]?.method || '-'; } catch {}
  }
  totalMs += r.ms;
  if (r.status === 200 && items > 0) ok++; else { fail++; if (r.ms > 2000) slow++; }
  console.log(`req[${String(i).padStart(2)}]: HTTP ${r.status} ${String(r.ms).padStart(5)}ms items=${String(items).padStart(2)} method=${method}`);
  if (i % 5 === 4) await new Promise((res) => setTimeout(res, 300));
}
console.log(`summary: ok=${ok} fail=${fail} slow(>2s)=${slow} avg=${(totalMs / 20).toFixed(0)}ms`);

// --- raw SkazClient rotation ---
const pid = await import('node:fs').then(async ({ readFileSync }) => {
  const first = String((await import('node:child_process')).execFileSync('pgrep', ['-f', 'node.*src/index.js']).toString().trim().split(/\s+/)[0]);
  const env = readFileSync('/proc/' + first + '/environ', 'utf8');
  return Object.fromEntries(env.split('\0').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
});
const client = new SkazClient({
  balancer: 'alloha',
  hosts: ['http://online3.skaz.tv', 'http://online8.skaz.tv', 'http://94.249.239.63', 'http://94.249.239.37', 'http://94.249.239.11', 'http://77.90.33.109'],
  accountEmail: pid.SKAZ_ACCOUNT_EMAIL || '',
  uid: pid.SKAZ_UID || '',
  origin: 'http://lampa.mx'
});
const normalizer = new SkazNormalizer();
console.log('\n=== B. 20 raw getLite (host rotation) ===');
for (let i = 0; i < 20; i++) {
  const url = client.buildLiteUrl({ ...SPIDER, serial: '0' });
  const host = new URL(url).host;
  const t0 = Date.now();
  let status = 0, bytes = 0, cards = 0, err = '';
  try {
    const r = await client.getLite({ ...SPIDER, serial: '0' });
    status = 200; cards = normalizer.cards(r || '').length; bytes = String(r || '').length;
  } catch (e) { err = e.message.slice(0, 40); }
  console.log(`req[${String(i).padStart(2)}]: host=${String(host).padEnd(24)} ${String(Date.now() - t0).padStart(5)}ms status=${status} cards=${String(cards).padStart(2)} ${err ? 'ERR=' + err : ''}`);
}
process.exit(0);
