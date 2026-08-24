// TASK-SKAZ-MANIYA-021 PREIMPLEMENT BASELINE — standalone capture (не зависит от реализации).
// Fresh SKAZ lite/events → online[] для муви- и сериал-карточек + прод Maniya card (read-only).
// Запуск: node scripts/_t021_baseline.mjs   (из корня; config грузит server/.env — реальные creds)
import { writeFileSync, mkdirSync } from 'node:fs';

const { config } = await import('../server/src/config.js');

const OUTDIR = 'docs/t021';
mkdirSync(OUTDIR, { recursive: true });

const EMAIL = String(config.skaz?.accountEmail || '').trim();
const UID = String(config.skaz?.uid || '').trim();
const HOSTS = Array.isArray(config.skaz?.hosts) ? config.skaz.hosts : [];
const PROD_CARD = 'https://plugin.maniya-kvn.online/api/lampa/sources/card';

// Контрольные карточки (те же, что T018/T019): 3 фильма + сериал.
const TITLES = [
  { key: 'mutiny',    id: '1288445', imdb_id: 'tt32338669', kinopoisk_id: '1288445', title: 'Мятеж',            original_title: 'Mutiny',        serial: '0', year: '2026' },
  { key: 'toystory5', id: '1084244', imdb_id: 'tt29355505', kinopoisk_id: '1084244', title: 'История игрушек 5', original_title: 'Toy Story 5',   serial: '0', year: '2026' },
  { key: 'interst',   id: '157372',  imdb_id: 'tt0816692',  kinopoisk_id: '258687',  title: 'Интерстеллар',      original_title: 'Interstellar',  serial: '0', year: '2014' },
  { key: 'drake',     id: '94997',   imdb_id: '',           kinopoisk_id: '',        title: 'Дом Дракона',       original_title: 'House of the Dragon', serial: '1', year: '2022' }
];

const fetchT = async (url, ms = 15_000) => {
  const t0 = Date.now();
  const c = new AbortController();
  const tm = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal });
    const text = await r.text().catch(() => '');
    return { status: r.status, ms: Date.now() - t0, text };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, err: String(e).slice(0, 100) };
  } finally { clearTimeout(tm); }
};

function cardParams(t) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ id: t.id, imdb_id: t.imdb_id, kinopoisk_id: t.kinopoisk_id, title: t.title, original_title: t.original_title, serial: t.serial, year: t.year, source: 'tmdb' })) {
    if (v !== '' && v != null) p.set(k, String(v));
  }
  if (EMAIL) p.set('account_email', EMAIL);
  if (UID) p.set('uid', UID);
  return p;
}

function parseEvents(text) {
  if (!text) return null;
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.online)) return { online: parsed.online, ready: parsed.ready, tasks: parsed.tasks, accsdb: parsed.accsdb };
    if (Array.isArray(parsed)) return { online: parsed };
  }
  return null;
}

// Санитизация ТОЛЬКО от auth/секретов (query в url) и нормализация типов;
// name/index/show/balanser/rch/voices/seasons — вербатим как пришли наблюдением.
function sanitize(online) {
  return (online || []).map((o) => {
    const raw = String(o.url || '');
    return {
      name: String(o.name ?? (o.balanser || '')),
      url: raw.includes('?') ? raw.slice(0, raw.indexOf('?')) : raw,
      index: Number(o.index) || 0,
      show: o.show !== false,
      balanser: String(o.balanser || '').trim(),
      rch: o.rch === true,
      voices: Number(o.voices) || 0,
      seasons: Number(o.seasons) || 0
    };
  }).filter((o) => o.balanser);
}

async function clusterEvents(t) {
  for (const host of HOSTS.slice(0, 3)) {
    const r = await fetchT(`${host}/lite/events?${cardParams(t)}`, 15_000);
    const p = parseEvents(r.text);
    if (p?.online) return { host, status: r.status, ms: r.ms, online: sanitize(p.online), rawCount: p.online.length, ready: p.ready, accsdb: p.accsdb };
  }
  return null;
}

async function prodCard(t) {
  const q = new URLSearchParams({ source: 'tmdb', id: t.id, imdb_id: t.imdb_id, kinopoisk_id: t.kinopoisk_id, title: t.title, original_title: t.original_title, year: t.year, serial: t.serial });
  const t0 = Date.now();
  const c = new AbortController();
  const tm = setTimeout(() => c.abort(), 60_000);
  try {
    const r = await fetch(`${PROD_CARD}?${q}&token=unit-test-token`, { signal: c.signal });
    const j = await r.json().catch(() => null);
    return { status: r.status, ms: Date.now() - t0, sources: (j?.sources || []).map((s) => ({ id: s.id, show: s.show === true })), meta: j?.meta || null };
  } catch (e) { return { status: 0, ms: Date.now() - t0, err: String(e).slice(0, 80) }; } finally { clearTimeout(tm); }
}

function shown(o) { return o.filter((x) => x.show); }

console.log('diag:', JSON.stringify({ hosts: HOSTS.length, email: Boolean(EMAIL), uid: Boolean(UID) }));

const all = {};
for (const t of TITLES) {
  console.log(`\n=== ${t.key} (serial=${t.serial}) ===`);
  const ev = await clusterEvents(t);
  if (ev) {
    const sh = shown(ev.online);
    console.log('CLUSTER', JSON.stringify({ host: ev.host, ms: ev.ms, total: ev.online.length, shown: sh.length, ready: ev.ready, accsdb: ev.accsdb }));
    console.log(' shown:', sh.map((o) => `#${o.index} ${o.name}${o.rch ? ' [rch]' : ''} v${o.voices}/s${o.seasons}`).join(' | '));
  } else {
    console.log('CLUSTER FAIL (null)');
  }
  const prod = await prodCard(t);
  console.log('PROD   ', JSON.stringify({ ms: prod.ms, total: prod.sources.length, shown: prod.sources.filter((s) => s.show).length, meta: prod.meta }));
  all[t.key] = {
    card: t.key, serial: t.serial,
    cluster: ev ? { host: ev.host, status: ev.status, ms: ev.ms, ready: ev.ready, accsdb: ev.accsdb, count: ev.online.length, online: ev.online } : null,
    prod: { status: prod.status, ms: prod.ms, meta: prod.meta, count: prod.sources.length, sources: prod.sources }
  };
  writeFileSync(`${OUTDIR}/ab-${t.key}.json`, JSON.stringify(all[t.key], null, 2), 'utf8');
}
writeFileSync(`${OUTDIR}/_ab-all.json`, JSON.stringify(all, null, 2), 'utf8');
console.log('\ndone → docs/t021/{ab-*, _ab-all}.json');