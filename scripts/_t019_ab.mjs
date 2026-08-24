// TASK-019 A/B ПОСЛЕ реализации — per-title модель: кластер vs прод vs локальная модель.
// READ-ONLY GET. Код/конфиг/.env/PROD не меняются.
// Для каждой карточки (mutiny/toystory5/interst):
//   1. cluster lite/events  → online[] (SKAZ-истина, raw)
//   2. прод Maniya /sources/card → {id,show} (ТЕКУЩЕЕ поведение — probe-path)
//   3. ЛОКАЛЬНАЯ sourceModel (DIFF_LOCAL=1) → может items (полная per-title модель)
// Вывод: docs/t019/ab-*.json (для каждой карточки), docs/t019/_ab-all.json, console-сводка.
// env: DIFF_TOKEN (прод-токен), DIFF_MANIYA=0 — пропустить прод, DIFF_LOCAL=0 — без модели.
import { mkdirSync, writeFileSync } from 'node:fs';
import { config } from '../server/src/config.js';
import { orderedSkazHosts } from '../server/src/providers/skaz/hostOrder.js';
import { SkazClient } from '../server/src/providers/skaz/SkazClient.js';
import { buildEventsParams, buildModel } from '../server/src/sources/sourceModel.js';
import { registrySnapshot } from '../server/src/providers/registry.js';

const BASE = process.env.DIFF_BASE || 'https://plugin.maniya-kvn.online';
const TOKEN = process.env.DIFF_TOKEN || 'mo-6d7c07e49e511b105726d6de1c0fdce4';
const DO_MANIYA = process.env.DIFF_MANIYA !== '0';
const DO_MODEL = process.env.DIFF_LOCAL !== '0';
const OUTDIR = 'docs/t019';
mkdirSync(OUTDIR, { recursive: true });

const HOSTS = orderedSkazHosts([...new Set([String(config.skaz?.hosts?.[0] || ''), 'http://online8.skaz.tv', ...(config.skaz?.hosts || [])])].filter(Boolean));
const EMAIL = String(config.skaz?.accountEmail || '').trim();
const UID = String(config.skaz?.uid || '').trim();

const TITLES = [
  { key: 'mutiny',    id: '1288445', imdb_id: 'tt32338669', kinopoisk_id: '1288445', title: 'Мятеж',            original_title: 'Mutiny',       serial: '0', year: '2026' },
  { key: 'toystory5', id: '1084244', imdb_id: 'tt29355505', kinopoisk_id: '1084244', title: 'История игрушек 5', original_title: 'Toy Story 5',  serial: '0', year: '2026' },
  { key: 'interst',   id: '157372',  imdb_id: 'tt0816692',  kinopoisk_id: '258687',  title: 'Интерстеллар',      original_title: 'Interstellar', serial: '0', year: '2014' }
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
    return { status: 0, ms: Date.now() - t0, err: String(e).slice(0, 120) };
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
    const r = await fetchT(`${host}/lite/events?${cardParams(t)}`, 12_000);
    const p = parseEvents(r.text);
    if (p?.online) return { host, status: r.status, ms: r.ms, online: sanitize(p.online), rawCount: p.online.length, ready: p.ready, accsdb: p.accsdb };
  }
  return null;
}

async function maniyaCard(t) {
  const q = new URLSearchParams({ source: 'tmdb', id: t.id, imdb_id: t.imdb_id, kinopoisk_id: t.kinopoisk_id, title: t.title, original_title: t.original_title, year: t.year, serial: t.serial });
  const t0 = Date.now();
  const c = new AbortController();
  const tm = setTimeout(() => c.abort(), 60_000);
  try {
    const r = await fetch(`${BASE}/api/lampa/sources/card?${q}&token=${TOKEN}`, { signal: c.signal });
    const j = await r.json().catch(() => null);
    return { status: r.status, ms: Date.now() - t0, sources: (j?.sources || []).map((s) => ({ id: s.id, show: s.show === true })), meta: j?.meta || null };
  } catch { return { status: 0, ms: Date.now() - t0 }; } finally { clearTimeout(tm); }
}

/**
 * Локальная per-title модель (наша реализация). СВЕРКА ПО УПОТРЕБЛЁННОМУ ответу:
 * getOnline возвращает КОНКРЕТНУЮ кластерную online[] (первый валидный на пуле),
 * и buildModel строит модель ИЗ НЕЁ — поэтому rowDiff честный (трансформация),
 * а не артефакт разных нод кластера (online3 vs 94.249.* serwują разный состав
 * для одного тайтла: флаги-эмодзи в name, index, присутствие kinogo/fxapi).
 * host фиксируем через fetchImpl (последний 2xx-ответ по /lite/events).
 */
async function localModel(t) {
  let host = '?';
  const fetchImpl = async (url, opts = {}) => {
    if (String(url).includes('/lite/events')) host = new URL(String(url)).origin;
    return fetch(url, opts);
  };
  const client = new SkazClient({
    hosts: config.skaz.hosts,
    accountEmail: config.skaz.accountEmail,
    uid: config.skaz.uid,
    origin: config.skaz.origin,
    timeoutMs: config.skaz.checkTimeoutMs || 10_000,
    fetchImpl
  });
  const query = { id: t.id, imdb_id: t.imdb_id, kinopoisk_id: t.kinopoisk_id, title: t.title, original_title: t.original_title, serial: t.serial, year: t.year, source: 'tmdb' };
  const started = Date.now();
  const online = await client.getOnline(buildEventsParams(query), { timeoutMs: config.skaz.checkTimeoutMs || 10_000 });
  const ms = Date.now() - started;
  if (!Array.isArray(online)) return null;
  const items = buildModel(online, registrySnapshot());
  return { ms, wallMs: ms, host, online, items };
}

/** По-балансерная сверка: cluster-запись → строка модели — поля вербатим? */
function rowDiff(cluster, model) {
  const mismatches = [];
  const byBalanser = new Map(model?.filter((i) => i.balanser).map((i) => [i.balanser, i]));
  for (const o of cluster) {
    const row = byBalanser.get(o.balanser);
    if (!row) { mismatches.push(`${o.balanser}: НЕТ в модели`); continue; }
    const checks = [
      ['name', o.name, row.name], ['index', o.index, row.index],
      ['show', o.show, row.show], ['rch', o.rch, row.rch],
      ['voices', o.voices, row.voices], ['seasons', o.seasons, row.seasons]
    ];
    for (const [f, a, b] of checks) if (String(a) !== String(b)) mismatches.push(`${o.balanser}[${f}]: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
  }
  return mismatches;
}

function summary(label, data) {
  if (!data) return { label, ok: false };
  const shown = (data.online || data.items || []).filter((x) => x.show);
  const hidden = (data.online || data.items || []).filter((x) => !x.show);
  const first = (data.online || data.items || [])[0];
  return {
    label,
    ok: true,
    total: (data.online || data.items || []).length,
    shown: shown.length,
    hidden: hidden.length,
    first: first ? `${first.index ?? 'idx:' + first.index} ${first.name || first.balanser || first.id}` : null,
    host: data.host, ms: data.ms
  };
}

await run().catch((e) => { console.error('FATAL', e && e.message || e); process.exit(1); });

async function run() {
  console.log('diag', JSON.stringify({ hosts: HOSTS.length, creds: Boolean(EMAIL && UID), prod: DO_MANIYA && Boolean(TOKEN), model: DO_MODEL }));
  const all = {};
  for (const t of TITLES) {
    console.log(`\n=== ${t.key} ===`);
    const ev = await clusterEvents(t);
    const maniya = DO_MANIYA && TOKEN ? await maniyaCard(t) : null;
    const model = DO_MODEL ? await localModel(t) : null;

    if (ev) {
      const shown = ev.online.filter((o) => o.show);
      console.log('CLUSTER', JSON.stringify({ host: ev.host, ms: ev.ms, total: ev.online.length, shown: shown.length, hidden: ev.online.length - shown.length }));
      console.log('CLUSTER shown:', shown.map((o) => o.index + ' ' + o.name).join(' | '));
      if (model) {
        // rowDiff ВСЕГДА против УПОТРЕБЛЁННОГО ответа (model.online == тот же
        // online[], из которого buildModel строил модель) — это чистая сверка
        // трансформации; расхождение межнодовое кластера показано отдельно.
        const diff = rowDiff(model.online, model.items);
        console.log('MODEL   ', JSON.stringify({ host: model.host, ms: model.ms, total: model.items.length, shown: model.items.filter((i) => i.show).length, hidden: model.items.filter((i) => i.ghost).length, extras: model.items.filter((i) => i.index === null).map((i) => i.id) }));
        console.log('MODEL rowDiff:', diff.length ? diff : '0 расхождений (поля кластера вербатим)');
      } else {
        console.log('MODEL   skip (DIFF_LOCAL=0)');
      }
    } else {
      console.log('CLUSTER FAIL (null)');
    }
    if (maniya) console.log('PROD    ', JSON.stringify({ ms: maniya.ms, total: maniya.sources.length, shown: maniya.sources.filter((s) => s.show).length, hidden: maniya.sources.filter((s) => !s.show).length, meta: maniya.meta }));

    const consumed = model?.online || ev?.online || [];
    all[t.key] = {
      card: t.key,
      cluster: ev ? { host: ev.host, status: ev.status, ms: ev.ms, ready: ev.ready, accsdb: ev.accsdb, count: ev.online.length, online: ev.online } : null,
      maniya: maniya ? { status: maniya.status, ms: maniya.ms, meta: maniya.meta, sources: maniya.sources } : null,
      model: model ? { host: model.host, ms: model.ms, consumedCount: consumed.length, count: model.items.length, consumedNames: consumed.map((o) => `${o.index} ${o.name}`), rowDiff: rowDiff(consumed, model.items).length, items: model.items } : null
    };
    writeFileSync(`${OUTDIR}/ab-${t.key}.json`, JSON.stringify(all[t.key], null, 2), 'utf8');
  }
  writeFileSync(`${OUTDIR}/_ab-all.json`, JSON.stringify(all, null, 2), 'utf8');
  console.log('\ndone → docs/t019/{ab-mutiny,ab-toystory5,ab-interst,_ab-all}.json');
}