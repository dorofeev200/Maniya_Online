// D1 — Alloha «шипящий экран» + manifestloaderror на девайсе (2026-08-24).
// Диверсия: staging отдаёт direct vkvideo.cloud (DIRECT_PLAYBACK_ALLOW_HOSTS),
// но с residential сети CDN режет (IP-гейт, маркер T037). РЕПРО С НОУТБУКА.
// Read-only: /sources, /videos, /video, прямой fetch, /proxy. КОД НЕ МЕНЯЕТ.
import { readFileSync } from 'node:fs';

const BASE = 'http://95.85.241.121';
const UA = 'Mozilla/5.0 (Linux; Android 10; Lampa) AppleWebKit/537.36 Lampa/0.16.2';

// Токен staging-юзера из снапшота — не выводим, только используем в запросах.
const users = JSON.parse(readFileSync('backup/snapshots/20260824-180712/users.json', 'utf8'));
const arr = Array.isArray(users) ? users : (users.users || []);
const staging = arr.find((u) => u.plan === 'staging-test' && u.active) || arr.find((u) => u.active);
const TOKEN = (staging && staging.token) || '';
if (!TOKEN) { console.error('ERR: staging token not found'); process.exit(2); } else console.error(`token: ${TOKEN.slice(0, 7)}… (${TOKEN.length})`);

async function get(url, { headers = {}, readBody = true, redirect = 'follow', timeout = 20000 } = {}) {
  const t0 = Date.now();
  let r;
  try {
    r = await fetch(url, { redirect, signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': UA, ...headers } });
  } catch (e) { return { err: String(e).message || e, ms: Date.now() - t0, status: 0 }; }
  const ms = Date.now() - t0;
  const ct = String(r.headers.get('content-type') || '').split(';')[0];
  if (!readBody) { await r.body?.cancel?.().catch?.(() => {}); return { ms, status: r.status, ct }; }
  const buf = Buffer.from(await r.arrayBuffer().catch(() => new Uint8Array(0)));
  return { ms, status: r.status, ct, bytes: buf.length, text: buf.toString('utf8') };
}

function maskUrl(u) {
  try { const x = new URL(u); if (x.searchParams.has('token')) x.searchParams.set('token', '<TOKEN>'); return x.toString(); } catch { return '<bad url>'; }
}
function maskQuery(u) { return u.replace(/token=[^&]+/g, 'token=<TOKEN>'); }

const CARD = {
  source: 'tmdb', id: '157336', imdb_id: 'tt0816692', kinopoisk_id: '462682',
  title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0'
};

console.log('\n=== 1) SOURCES (пул) ===');
const src = await get(`${BASE}/api/lampa/sources?token=${TOKEN}`);
console.log(`sources: HTTP ${src.status} ${src.ms}ms`);
if (src.status === 200) {
  try {
    const list = JSON.parse(src.text);
    const names = (list.sources || list || []).map((s) => (typeof s === 'string' ? s : s?.id || s?.name)).filter(Boolean);
    console.log('sources:', names.join(', '));
  } catch { console.log('body:', src.text.slice(0, 300)); }
}

console.log('\n=== 2) VIDEOS: skaz-alloha (Интерстеллар) ===');
const q = new URLSearchParams({ token: TOKEN, provider: 'skaz-alloha', ...CARD });
const v = await get(`${BASE}/api/lampa/videos?${q}`);
console.log(`videos: HTTP ${v.status} ${v.ms}ms items=${(() => { try { return (JSON.parse(v.text).items || []).length; } catch { return '?'; } })()}`);
let items = [];
let pe = '';
try { items = JSON.parse(v.text).items || []; pe = JSON.parse(v.text).provider_error ? JSON.parse(v.text).provider_error.code : ''; } catch {}
if (pe) console.log('provider_error:', pe);
const call = items.find((i) => i.method === 'call') || items[0];
if (!call) { console.log('нет items — стоп'); process.exit(0); }
console.log(`item[0]: method=${call.method} title=${String(call.title || '').slice(0, 20)} url=${maskUrl(call.url || '').slice(0, 140)}`);
const qm = call.quality && typeof call.quality === 'object' ? Object.keys(call.quality).join(',') : call.quality || '';
console.log(`quality map: ${qm}`);

console.log('\n=== 3) РЕЗОЛВ play-дескриптора ===');
let play = call;
if (call.method === 'call' && call.url) {
  let target = call.url;
  if (target.startsWith(BASE) || target.includes('/api/lampa/video')) {
    target = target.includes('?') ? `${target}&token=${TOKEN}` : `${target}?token=${TOKEN}`;
  } else if (!target.includes('token=')) {
    target = `${target}${target.includes('?') ? '&' : '?'}token=${TOKEN}`;
  }
  const rd = await get(target);
  console.log(`resolve: HTTP ${rd.status} ${rd.ms}ms ct=${rd.ct}`);
  try { play = JSON.parse(rd.text || '{}'); } catch {}
  console.log(`play: method=${play.method} url=${maskUrl(play.url || '').slice(0, 160)}`);
}
const primary = String(play.url || '').split(/\s+or\s+/i)[0].trim() || '';
const isDirect = !primary.includes('/proxy');
const isVk = primary.includes('vkvideo.cloud');
console.log(`\nplay-kind: ${isDirect ? 'DIRECT' : '/proxy'} vkvideo.cloud=${isVk}`);
if (!primary) { console.log('нет primary URL — стоп'); process.exit(0); }

console.log('\n=== 4) ПРЯМОЙ fetch манифеста (с residential IP, как девайс) ===');
const m = await get(primary, { headers: { 'Accept': 'application/vnd.apple.mpegurl,*/*', 'Origin': 'http://lampa.mx', 'Referer': 'http://lampa.mx/' } });
console.log(`direct master: HTTP ${m.status} ${m.ms}ms ct=${m.ct} bytes=${m.bytes}`);
if (m.status !== 200 && m.status !== 206) {
  console.log('  → direct БЛОКИРУЕТСЯ с residential IP. Это и есть FIRST DIVERGENCE, если девайс получал URL вида:');
  console.log('  ', maskUrl(primary).slice(0, 160));
  console.log('\n=== 5) Тот же URL через /api/lampa/proxy (как до T049) ===');
  const p = await get(`${BASE}/api/lampa/proxy?url=${encodeURIComponent(primary)}&token=${TOKEN}&origin=${encodeURIComponent('http://lampa.mx')}&ref=${encodeURIComponent('http://lampa.mx/')}`, { headers: { 'Accept': 'application/vnd.apple.mpegurl,*/*' } });
  console.log(`proxy master: HTTP ${p.status} ${p.ms}ms ct=${p.ct} bytes=${p.bytes}`);
  const isHls = /#EXTM3U|#EXT-X-STREAM-INF/.test(p.text || '');
  console.log(`proxy is-HLS-manifest: ${isHls} (200/206+манифест = /proxy работает -> фикс = убрать vkvideo.cloud из direct)`);
} else {
  console.log('  → direct работает и с residential IP (гипотеза IP-гейта НЕ подтверждена, копаем дальше)');
}

console.log('\nDONE');