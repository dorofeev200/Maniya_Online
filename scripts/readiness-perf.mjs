// PROJECT-READINESS-001 — READ-ONLY performance audit (код НЕ меняется).
// Замеряем p50/p95 латентности прод-API по фазам карточки (Матрица + Дом Дракона):
//   /sources              — статический реестр (cold);
//   /sources/card         — per-card availability (cold, потом cached);
//   /videos               — первый вызов (cold) vs повтор (cached nav);
//   /api/lampa/video      — резолв call-item (playback resolve).
// Серия короткая (5 замеров на фазу) — под лимитом 120/60с. Только GET.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
// SECURITY-001: creds только из env → temp (см. _creds.mjs)
import { loadUserA } from './_creds.mjs';

const BASE = process.env.PROD_BASE_URL || 'https://plugin.maniya-kvn.online';
const GAP_MS = Number(process.env.GAP_MS || 400);
const SAMPLES = Number(process.env.SAMPLES || 5);

const A = loadUserA();
if (!A) { console.log('FATAL: токен A'); process.exit(1); }
const uidA = createHash('sha256').update(A.token).digest('hex').slice(0, 16);

const TARGETS = [
  { label: 'Матрица (фильм)', movie: { id: '603', title: 'Матрица', original_title: 'The Matrix', serial: 0, year: '1999', original_language: 'en', source: 'tmdb', imdb_id: 'tt0133093', tmdb_id: '603', clarification: 0, similar: false } },
  { label: 'Дом Дракона (сериал)', movie: { id: '94997', title: 'Дом Дракона', name: 'Дом Дракона', original_name: 'House of the Dragon', original_title: 'House of the Dragon', serial: 1, year: '2022', original_language: 'en', source: 'tmdb', imdb_id: 'tt11198330', tmdb_id: '94997', clarification: 0, similar: false } }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(token, path, query, opts = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('token', token);
  url.searchParams.set('uid', 'audit-perf');
  if (opts.force) url.searchParams.set('force', 'true');
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    const text = await r.text().catch(() => '');
    let body = null; try { body = JSON.parse(text); } catch { body = null; }
    return { status: r.status, ms: Date.now() - t0, body };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, body: null, err: String((e && e.name) || e) };
  }
}

function pct(arr, p) {
  const s = arr.slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, idx)];
}

function stat(label, arr) {
  const line = `  ${label.padEnd(26)}: n=${arr.length} p50=${String(pct(arr, 50)).padStart(5)}ms p95=${String(pct(arr, 95)).padStart(5)}ms min=${String(Math.min(...arr)).padStart(4)}ms max=${String(Math.max(...arr)).padStart(5)}ms`;
  console.log(line);
  return { label, n: arr.length, p50: pct(arr, 50), p95: pct(arr, 95), min: Math.min(...arr), max: Math.max(...arr) };
}

const RESULTS = [];

async function main() {
  console.log('== readiness-perf == base=' + BASE + ' samples=' + SAMPLES + ' userA uid=' + uidA);
  for (const t of TARGETS) {
    const q = t.movie;
    console.log('\n' + '═'.repeat(90));
    console.log(t.label + '  serial=' + q.serial);
    const row = { label: t.label, phases: {} };

    // /sources cold
    const src = [];
    for (let i = 0; i < SAMPLES; i += 1) { const r = await api(A.token, '/api/lampa/sources', q); src.push(r.ms); await sleep(GAP_MS); }
    row.phases.sources = stat('sources', src);

    // /sources/card cold (первый force) потом cached
    const cardCold = [], cardHit = [];
    const first = await api(A.token, '/api/lampa/sources/card', q, { force: true });
    cardCold.push(first.ms);
    for (let i = 1; i < SAMPLES; i += 1) { const r = await api(A.token, '/api/lampa/sources/card', q, { force: true }); cardCold.push(r.ms); await sleep(GAP_MS); }
    row.phases.cardCold = stat('card cold', cardCold);
    for (let i = 0; i < SAMPLES; i += 1) { const r = await api(A.token, '/api/lampa/sources/card', q); cardHit.push(r.ms); await sleep(GAP_MS); }
    row.phases.cardHit = stat('card cached', cardHit);

    // /videos: filmix (movie) и skaz-kinopub (serial/movie) — первый (cold nav) и повтор (cached nav)
    const prov = q.serial ? 'skaz-kinopub' : 'filmix';
    const vCold = [], vHit = [];
    for (let i = 0; i < SAMPLES; i += 1) { const r = await api(A.token, '/api/lampa/videos', { ...q, provider: prov }); vCold.push(r.ms); await sleep(GAP_MS * 2); }
    row.phases.videosCold = stat('videos ' + prov + ' cold', vCold);
    for (let i = 0; i < SAMPLES; i += 1) { const r = await api(A.token, '/api/lampa/videos', { ...q, provider: prov }); vHit.push(r.ms); await sleep(GAP_MS * 2); }
    row.phases.videosHit = stat('videos ' + prov + ' cached-nav', vHit);

    // /api/lampa/video резолв первого call-item kinopub (playback resolve)
    const v = await api(A.token, '/api/lampa/videos', { ...q, provider: 'skaz-kinopub' });
    const items = (v.body && v.body.items) || [];
    if (items.length) {
      const call = items[0];
      const rq = {};
      try { const u = new URL(call.url); for (const [k, val] of u.searchParams.entries()) if (k !== 'token' && k !== 'uid') rq[k] = val; } catch {}
      const res = [];
      for (let i = 0; i < Math.min(SAMPLES, 3); i += 1) { const r = await api(A.token, '/api/lampa/video', rq); res.push(r.ms); await sleep(GAP_MS * 2); }
      row.phases.videoResolve = stat('video resolve (' + (call.title || '?') + ')', res);
    }

    RESULTS.push(row);
    await sleep(GAP_MS * 4);
  }
  writeFileSync('C:/Users/Admin/AppData/Local/Temp/readiness-perf.json', JSON.stringify(RESULTS, null, 2), 'utf8');
  console.log('\nJSON: C:/Users/Admin/AppData/Local/Temp/readiness-perf.json');
}

main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });
