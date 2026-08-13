// FILMIX LIVE DIAG — запускается НА VPS (node /tmp/filmix-live-diag.mjs)
// Цель: реальные замеры цепочки Filmix на проде:
//  1) api-fx/list (search) — тёплый и холодный тайтлы
//  2) api-fx/post/{id}/video-links — холодный/тёплый кэш (это главный кандидат на «долгий старт»)
//  3) прокси-стриминг: sustained throughput 24MB на 1080p (кандидат на «ребуферинг»)
//  4) все качества одного фильма через прокси (доступность)
// Никаких секретов в выводе.
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const API = 'https://api.filmix.tv';
const PROD = 'http://127.0.0.1:3000';

import { readFileSync } from 'node:fs';
const users = JSON.parse(readFileSync('/opt/maniya-online/server/data/users.json', 'utf8'));
const arr = Array.isArray(users) ? users : (users.users || []);
const token = (arr.find((x) => x && x.active && x.token) || arr[0])?.token || '';

async function timed(url, { timeout = 90000, headers = {}, rangeBytes = null } = {}) {
  const t0 = Date.now();
  const h = { 'User-Agent': UA, ...headers };
  if (rangeBytes) h.Range = `bytes=0-${rangeBytes - 1}`;
  try {
    const res = await fetch(url, { headers: h, signal: AbortSignal.timeout(timeout) });
    const ttfb = Date.now() - t0;
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, ttfb, total: Date.now() - t0, bytes: buf.length, buf, ct: res.headers.get('content-type') || '' };
  } catch (e) {
    return { status: 0, ttfb: null, total: Date.now() - t0, bytes: 0, err: String(e.message || e).slice(0, 80) };
  }
}

const fmt = (r) => `HTTP ${r.status} ttfb=${r.ttfb ?? '-'}ms total=${r.total}ms bytes=${r.bytes}${r.err ? ' ERR=' + r.err : ''}`;

// ── 1) search list: warm vs cold ─────────────────────────────────────
console.log('=== 1) api-fx/list search latency ===');
for (const q of ['Человек-паук', 'Zgfntybz vfrcbvfkmyjt']) {
  const r = await timed(`${API}/api-fx/list?search=${encodeURIComponent(q)}&limit=5`);
  let ids = [];
  try { ids = (JSON.parse(r.buf.toString('utf8')).items || []).slice(0, 3).map((i) => `${i.id}:${String(i.title || '').slice(0, 30)}`); } catch {}
  console.log(`  "${q.slice(0, 24)}" ${fmt(r)} ids=[${ids.join(' | ')}]`);
}

// ── 2) video-links latency: several post ids (свежие = холодный кэш) ──
console.log('=== 2) api-fx video-links latency (тёплые и холодные посты) ===');
// Тёплый: уже запрашивали (Spider-Man 634649 → filmix post через search)
const warmSearch = await timed(`${API}/api-fx/list?search=${encodeURIComponent('Игра престолов')}&limit=2`);
let warmId = null;
try { warmId = JSON.parse(warmSearch.buf.toString('utf8')).items?.[0]?.id; } catch {}
// Холодные: берём id из поиска менее популярных тайтлов
const coldCandidates = [];
for (const q of ['Пятая печать', 'Кин-дза-дза', 'Авария дочь мента']) {
  const r = await timed(`${API}/api-fx/list?search=${encodeURIComponent(q)}&limit=2`);
  try {
    const items = JSON.parse(r.buf.toString('utf8')).items || [];
    if (items[0]?.id) coldCandidates.push({ q, id: items[0].id, title: items[0].title });
  } catch {}
}
const probes = [...(warmId ? [{ q: 'GoT(warm)', id: warmId }] : []), ...coldCandidates];
for (const p of probes) {
  const r = await timed(`${API}/api-fx/post/${p.id}/video-links`);
  let shape = '?';
  try {
    const j = JSON.parse(r.buf.toString('utf8'));
    shape = Array.isArray(j) ? `movie tracks=${j.length}` : `serial voices=${Object.keys(j || {}).length}`;
  } catch { shape = 'non-json'; }
  console.log(`  post ${p.id} (${String(p.q).slice(0, 18)}) ${fmt(r)} → ${shape}`);
}

// ── 3) full /videos через прод + sustained throughput через прокси ────
console.log('=== 3) /api/lampa/videos (прод) + sustained 24MB через прокси (1080p) ===');
const vq = new URLSearchParams({
  token, provider: 'filmix', id: '634649', tmdb_id: '634649', imdb_id: 'tt10872600',
  kinopoisk_id: '1309570', title: 'Человек-паук: Нет пути домой',
  original_title: 'Spider-Man: No Way Home', serial: '0', year: '2021', source: 'tmdb'
});
const vr = await timed(`${PROD}/api/lampa/videos?${vq}`);
console.log(`  /videos ${fmt(vr)}`);
let items = [];
try { items = JSON.parse(vr.buf.toString('utf8')).items || []; } catch {}
const movie = items[0];
if (movie) {
  console.log(`  items=${items.length} voice0="${movie.voice_name}" q=[${Object.keys(movie.quality || {}).join(',')}]`);
  const u1080 = movie.quality?.['1080p'] || movie.url;
  // sustained: качаем 24MB через прокси, меряем скорость
  const t0 = Date.now();
  const res = await fetch(u1080, { headers: { 'User-Agent': UA, Range: 'bytes=0-25165823' }, signal: AbortSignal.timeout(120000) });
  const ttfb = Date.now() - t0;
  const buf = Buffer.from(await res.arrayBuffer());
  const total = Date.now() - t0;
  const mbps = buf.length ? (buf.length * 8 / 1e6 / (total / 1000)).toFixed(1) : '0';
  console.log(`  sustained 24MB @1080p: HTTP ${res.status} ttfb=${ttfb}ms total=${total}ms → ${mbps} Mbps (ct=${res.headers.get('content-type')})`);

  // ── 4) все качества через прокси ──
  console.log('=== 4) все качества через прокси (1MB range) ===');
  for (const [q, url] of Object.entries(movie.quality || {})) {
    const r = await timed(url, { rangeBytes: 1048576, timeout: 30000 });
    console.log(`  ${q.padEnd(6)} ${fmt(r)}`);
  }
}
process.exit(0);
