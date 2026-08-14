#!/usr/bin/env node
// BALANCER-STABILITY-003 — live shadow: real config + real upstream, counting fetch.
// Runs the SAME script against either the NEW availability.js (single-flight) or the OLD
// one by pointing SHADOW_AVAIL at the module path. Faithful A/B: identical real config
// (prod .env), identical upstream, same account, reservePolicy:'abstain' (prod default).
//
// Usage (on VPS):
//   SHADOW_AVAIL=/tmp/maniya-shadow/server/src/availability.js node shadow-card.mjs concurrent 5
//   SHADOW_AVAIL=/opt/maniya-online/server/src/availability.js      node shadow-card.mjs concurrent 5
// Modes: baseline | concurrent N | multi-uid | force | matrix
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const availPath = process.env.SHADOW_AVAIL || '/tmp/maniya-shadow/server/src/availability.js';
const { createAvailabilityChecker } = await import(availPath);

const mode = process.argv[2] || 'baseline';
const N = Number.parseInt(process.argv[3] || '5', 10);

// ---------- counting fetch (каждый исходящий upstream-запрос к кластеру) ----------
let upstream = 0;
const upstreamLog = [];
const countingFetch = (url, options = {}) => {
  upstream += 1;
  const u = String(url);
  const m = u.match(/\/lite\/([a-z0-9]+)/);
  upstreamLog.push(m ? m[1] : u.slice(0, 80));
  return fetch(u, options);
};

// prod-дефолт: abstain (BALANCER-ONLINE8-002). Только он даёт вердикты = прод.
function makeChecker() {
  return createAvailabilityChecker({ fetchImpl: countingFetch, reservePolicy: 'abstain' });
}

// ---------- uid из прод users.json (cacheUid; только кэш, не auth) ----------
let UID = 'shadow-003';
try {
  const users = JSON.parse(readFileSync('/opt/maniya-online/server/data/users.json', 'utf8'));
  const arr = Array.isArray(users) ? users : [users];
  const user = arr.find((u) => u.token) || arr[0];
  if (user?.token) UID = createHash('sha256').update(user.token).digest('hex').slice(0, 16);
} catch { /* синтетический uid допустим */ }

// ---------- тайтлы (та же матрица, что readiness002-live.mjs) ----------
const TITLES = [
  { key: 'odyssey', id: '1368337', kp: '6385370', imdb: 'tt33764258', title: 'Одиссея', original_title: 'The Odyssey', year: '2026', serial: '0' },
  { key: 'last_house', id: '1284041', kp: '', imdb: 'tt32268156', title: 'Последний дом', original_title: 'The Last House', year: '2026', serial: '0' },
  { key: 'forrest', id: '14', kp: '448', imdb: 'tt0109830', title: 'Форрест Гамп', original_title: 'Forrest Gump', year: '1994', serial: '0' },
  { key: 'matrix', id: '603', kp: '301', imdb: 'tt0133093', title: 'Матрица', original_title: 'The Matrix', year: '1999', serial: '0' },
  { key: 'interstellar', id: '157336', kp: '437410', imdb: 'tt0816692', title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0' },
  { key: 'hotd', id: '94997', kp: '1316601', imdb: 'tt11198330', title: 'Дом Дракона', original_title: 'House of the Dragon', year: '2022', serial: '1' },
  { key: 'oa', id: '67180', kp: '1008365', imdb: 'tt4491250', title: 'The OA', original_title: 'The OA', year: '2016', serial: '1' },
  { key: 'silo', id: '125988', kp: '4541515', imdb: 'tt14688458', title: 'Укрытие', original_title: 'Silo', year: '2023', serial: '1' },
  { key: 'dune2', id: '693134', kp: '4605820', imdb: 'tt15239678', title: 'Дюна: Часть вторая', original_title: 'Dune: Part Two', year: '2024', serial: '0' },
  { key: 'tlou', id: '100088', kp: '4132429', imdb: 'tt3581920', title: 'Одни из нас', original_title: 'The Last of Us', year: '2023', serial: '1' }
];

function cardQuery(t) {
  const q = {
    id: t.id,
    title: t.title,
    original_title: t.original_title,
    year: Number(t.year),
    original_language: 'en',
    source: 'tmdb',
    serial: Number(t.serial)
  };
  if (t.imdb) q.imdb_id = t.imdb;
  if (t.kp) q.kinopoisk_id = t.kp;
  return q;
}

function fingerprint(result) {
  return result.sources.map((s) => `${s.id}:${s.show ? 1 : 0}`).sort().join('|');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- mode: baseline ----------
async function runBaseline() {
  const checker = makeChecker();
  const q = cardQuery(TITLES[2]); // forrest
  const r = await checker.card(q, UID);
  console.log(JSON.stringify({
    mode: 'baseline', avail: availPath, upstream, elapsedMs: r.elapsedMs,
    cached: r.cached, sources: r.sources.length, hasInconclusive: r.hasInconclusive,
    set: fingerprint(r),
    perSource: upstreamLog.slice(0, 40)
  }, null, 2));
}

// ---------- mode: concurrent ----------
async function runConcurrent() {
  const checker = makeChecker();
  const q = cardQuery(TITLES[2]); // forrest
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: N }, () => checker.card(q, UID)));
  const wall = Date.now() - t0;

  const sets = new Set(results.map(fingerprint));
  const elapseds = new Set(results.map((r) => r.elapsedMs));
  const caches = new Set(results.map((r) => r.cached));
  // пост-полёт: тот же ключ → кэш
  const after = await checker.card(q, UID);

  console.log(JSON.stringify({
    mode: 'concurrent', avail: availPath, N,
    upstreamTotal: upstream, upstreamPerCalcBaseline: null,
    wallMs: wall,
    identicalSets: sets.size === 1, distinctSets: sets.size,
    identicalElapsed: elapseds.size === 1, distinctElapsed: elapseds.size,
    caches: [...caches], hasInconclusive: results[0]?.hasInconclusive ?? null,
    set: [...sets][0] || '',
    afterCached: after.cached, upstreamAfter: upstream
  }, null, 2));
}

// ---------- mode: multi-uid ----------
async function runMultiUid() {
  const checker = makeChecker();
  const q = cardQuery(TITLES[2]);
  const uids = ['mu-1', 'mu-2', 'mu-3'];
  const t0 = Date.now();
  const results = await Promise.all(uids.map((u) => checker.card(q, u)));
  const wall = Date.now() - t0;
  console.log(JSON.stringify({
    mode: 'multi-uid', avail: availPath,
    upstreamTotal: upstream, wallMs: wall,
    distinctSets: new Set(results.map(fingerprint)).size,
    elapsedPerUid: results.map((r) => r.elapsedMs),
    cachedPerUid: results.map((r) => r.cached)
  }, null, 2));
}

// ---------- mode: force ----------
async function runForce() {
  const checker = makeChecker();
  const q = cardQuery(TITLES[2]);
  const t0 = Date.now();
  const [normal, forced] = await Promise.all([
    checker.card(q, UID, false),
    checker.card(q, UID, true)
  ]);
  const wall = Date.now() - t0;
  console.log(JSON.stringify({
    mode: 'force', avail: availPath,
    upstreamTotal: upstream, wallMs: wall,
    normalCached: normal.cached, forcedCached: forced.cached,
    sameSet: fingerprint(normal) === fingerprint(forced),
    elapsedNormal: normal.elapsedMs, elapsedForced: forced.elapsedMs
  }, null, 2));
}

// ---------- mode: matrix ----------
async function runMatrix() {
  const only = process.argv[3]; // необязательный фильтр: только один тайтл
  const rows = [];
  for (const t of TITLES) {
    if (only && t.key !== only) continue;
    upstream = 0; // отдельный счётчик на карточку
    const checker = makeChecker();
    const r = await checker.card(cardQuery(t), `${UID}:${t.key}`);
    rows.push({ t: t.key, upstream, elapsedMs: r.elapsedMs, hasInconclusive: r.hasInconclusive, set: fingerprint(r) });
    console.log(JSON.stringify(rows[rows.length - 1]));
    await sleep(200);
  }
  console.log('MATRIX_DONE');
}

// ---------- dispatch ----------
if (mode === 'baseline') await runBaseline();
else if (mode === 'concurrent') await runConcurrent();
else if (mode === 'multi-uid') await runMultiUid();
else if (mode === 'force') await runForce();
else if (mode === 'matrix') await runMatrix();
else { console.error(`unknown mode: ${mode}`); process.exit(2); }
console.log('DONE');
