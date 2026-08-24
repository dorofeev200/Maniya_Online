// TASK-018 Phase 1 — REAL SKAZ source model for 3 control cards.
// READ-ONLY. Только GET. Код/конфиг/.env/PROD не меняются.
//
// Для каждой контрольной карточки захватывает:
//   A. lite/withsearch (статический реестр, пул хостов) → 29 slug + online-инфо
//   B. lite/events life=true → memkey → lifeevents poll → online[] (ПОЛНАЯ модель:
//      name/url/index/show/balanser/rch + voices/seasons если отдаются)
//   C. /sources/card + /videos/* на online3 (Lampac-app эндпоинты, если есть)
//   D. deep-link открытие каждого SHOWN балансера с полными card params
//      (id/imdb_id/kinopoisk_id/title/original_title/serial/year/source/clarification)
//   E. Maniya prod: /api/lampa/sources/card + /videos для тех же карточек
//
// env: DIFF_TOKEN (Maniya), DIFF_BASE (по умолчанию prod), DIFF_MANIYA=0 — пропустить.
import { mkdirSync, writeFileSync } from 'node:fs';
import { config } from '../server/src/config.js';
import { orderedSkazHosts } from '../server/src/providers/skaz/hostOrder.js';

const BASE = process.env.DIFF_BASE || 'https://plugin.maniya-kvn.online';
const TOKEN = process.env.DIFF_TOKEN || '';
const DO_MANIYA = process.env.DIFF_MANIYA !== '0';
const OUTDIR = 'docs/t018';
mkdirSync(OUTDIR, { recursive: true });

const HOSTS = orderedSkazHosts(config.skaz?.hosts || []);
const EMAIL = String(config.skaz?.accountEmail || '').trim();
const UID = String(config.skaz?.uid || '').trim();

const TITLES = [
  { key: 'mutiny',    id: '1288445', imdb_id: 'tt32338669', kinopoisk_id: '1288445', title: 'Мятеж',            original_title: 'Mutiny',       serial: '0', year: '2026' },
  { key: 'toystory5', id: '1084244', imdb_id: 'tt29355505', kinopoisk_id: '1084244', title: 'История игрушек 5', original_title: 'Toy Story 5',  serial: '0', year: '2026' },
  { key: 'interst',   id: '157372',  imdb_id: 'tt0816692',  kinopoisk_id: '258687',  title: 'Интерстеллар',      original_title: 'Interstellar', serial: '0', year: '2014' }
];

const fetchT = async (url, ms = 20_000, headers = {}) => {
  const t0 = Date.now();
  const c = new AbortController();
  const tm = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { headers: { accept: '*/*', ...headers }, signal: c.signal });
    const text = await r.text().catch(() => '');
    return { status: r.status, ms: Date.now() - t0, text };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, text: String(e).slice(0, 160) };
  } finally {
    clearTimeout(tm);
  }
};

/** Card params в формате Maniya buildPageParams + auth. */
function cardParams(t, extra = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ id: t.id, imdb_id: t.imdb_id, kinopoisk_id: t.kinopoisk_id, title: t.title, original_title: t.original_title, serial: t.serial, year: t.year, source: 'tmdb' })) {
    if (v !== '' && v != null) p.set(k, String(v));
  }
  for (const [k, v] of Object.entries(extra)) if (v !== '' && v != null) p.set(k, String(v));
  if (EMAIL) p.set('account_email', EMAIL);
  if (UID) p.set('uid', UID);
  return p;
}

function onlineFromBody(text) {
  const raw = String(text || '');
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* HTML */ }
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.online)) return { kind: 'json', online: parsed.online, ready: parsed.ready, tasks: parsed.tasks, accsdb: parsed.accsdb };
    if (Array.isArray(parsed)) return { kind: 'json-array', online: parsed };
  }
  return { kind: 'html', online: null };
}

function balancersFromSearch(text) {
  const slugs = [];
  const linkRe = /lite\/([a-z0-9]+)/gi;
  let m;
  while ((m = linkRe.exec(String(text || ''))) !== null) {
    const s = m[1].trim();
    if (s && !slugs.includes(s) && /^[a-z0-9]{2,24}$/.test(s)) slugs.push(s);
  }
  return slugs;
}

const MANIYA_CACHE = new Map();
async function maniya(q) {
  const url = `${BASE}${q}&token=${TOKEN}`;
  const t0 = Date.now();
  const c = new AbortController();
  const tm = setTimeout(() => c.abort(), 90_000);
  try {
    const r = await fetch(url, { signal: c.signal });
    const j = await r.json().catch(() => null);
    return { status: r.status, ms: Date.now() - t0, j };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, j: null, err: String(e).slice(0, 120) };
  } finally {
    clearTimeout(tm);
  }
}

function summaryOfOnline(online) {
  return (online || []).map((o) => ({
    index: o.index, name: o.name, show: o.show, balanser: o.balanser, rch: o.rch,
    voices: o.voices ?? null, seasons: o.seasons ?? null,
    url_host: String(o.url || '').replace(/^https?:\/\//, '').split('/')[0]
  }));
}

async function phaseBEvents(t) {
  // PRIMARY: lite/events БЕЗ life=true → online[] напрямую (JSON-массив source-объектов)
  for (const host of HOSTS) {
    const ev = await fetchT(`${host}/lite/events?${cardParams(t)}`, 20_000);
    const b = onlineFromBody(ev.text);
    if (b.kind === 'json' || b.kind === 'json-array') {
      return { host, mode: 'direct', status: ev.status, ms: ev.ms, ready: b.ready, tasks: b.tasks, online: b.online, accsdb: b.accsdb };
    }
  }
  // FALLBACK: life=true → memkey → poll lifeevents
  for (const host of HOSTS) {
    const ev = await fetchT(`${host}/lite/events?${cardParams(t, { life: 'true' })}`, 15_000);
    let parsed = null;
    try { parsed = JSON.parse(ev.text); } catch { /* continue */ }
    const memkey = parsed && String(parsed.memkey || '').trim();
    if (memkey) {
      for (let i = 0; i < 6; i += 1) {
        await new Promise((r) => setTimeout(r, 1200));
        const le = await fetchT(`${host}/lite/lifeevents?memkey=${encodeURIComponent(memkey)}`, 15_000);
        const b = onlineFromBody(le.text);
        if (b.online) return { host, mode: 'life', memkey, ready: b.ready, tasks: b.tasks, online: b.online, accsdb: b.accsdb };
      }
      return { host, mode: 'life-unresolved', memkey, online: null };
    }
  }
  return null;
}

async function phaseDDeepLinks(t, onlineList) {
  // Только SHOWN балансеры выбранного набора (limit 8 на карточку)
  const rows = [];
  const shown = (onlineList || []).filter((o) => o.show && o.balanser);
  for (const o of shown.slice(0, 8)) {
    const base = String(o.url || '').trim();
    const url = base.includes('?')
      ? `${base}&${cardParams(t, { clarification: '0', similar: 'false' })}`
      : `${base}?${cardParams(t, { clarification: '0', similar: 'false' })}`;
    const r = await fetchT(url, 20_000);
    const head = r.text.trim().split(/\r?\n/, 1)[0].slice(0, 80);
    rows.push({
      balanser: o.balanser, host: base.replace(/^https?:\/\//, '').split('/')[0],
      status: r.status, ms: r.ms, first: head,
      bytes: r.text.length, hasDataJson: r.text.includes('data-json'), hasAccsdb: r.text.includes('accsdb')
    });
  }
  return rows;
}

async function phaseCAppEndpoints(t) {
  // Lampac-app эндпоинты на online3 — существуют ли и что отдают
  const host = HOSTS[0];
  const out = {};
  const sc = await fetchT(`${host}/sources/card?${cardParams(t)}`, 20_000);
  out.sources_card = { status: sc.status, ms: sc.ms, body: sc.text.slice(0, 400) };
  const vd = await fetchT(`${host}/videos?${cardParams(t, { provider: 'filmix' })}`, 20_000);
  out.videos = { status: vd.status, ms: vd.ms, body: vd.text.slice(0, 400) };
  const ev0 = await fetchT(`${host}/lite/events?${cardParams(t)}`, 15_000);
  out.events_no_life = { status: ev0.status, ms: ev0.ms, body: ev0.text.slice(0, 400) };
  return out;
}

async function maniyaCard(t) {
  const q = `/api/lampa/sources/card?${new URLSearchParams({ source: 'tmdb', id: '', imdb_id: t.imdb_id, kinopoisk_id: t.kinopoisk_id, title: t.title, original_title: t.original_title, year: t.year, serial: t.serial })}`;
  const r = await maniya(q);
  const shown = (r.j?.sources || []).filter((s) => s.show).map((s) => s.id);
  const hidden = (r.j?.sources || []).filter((s) => !s.show).map((s) => s.id);
  return { status: r.status, ms: r.ms, elapsed_ms: r.j?.meta?.elapsed_ms, cached: r.j?.meta?.cached, count: r.j?.meta?.count, shown, hidden, total: (r.j?.sources || []).length };
}

async function maniyaVideos(t, provider) {
  const q = `/api/lampa/videos?${new URLSearchParams({ provider, source: 'tmdb', id: t.id, imdb_id: t.imdb_id, kinopoisk_id: t.kinopoisk_id, title: t.title, original_title: t.original_title, year: t.year, serial: t.serial })}`;
  const r = await maniya(q);
  return {
    provider, status: r.status, ms: r.ms,
    items: (r.j?.items || []).length, seasons: (r.j?.seasons || []).length, voices: (r.j?.voices || []).length,
    perr: r.j?.provider_error?.code || null,
    firstItems: (r.j?.items || []).slice(0, 5).map((i) => ({ method: i.method, title: String(i.title || '').slice(0, 26), translate: String(i.translate || '').slice(0, 20), q: Object.keys(i.quality || {}).length }))
  };
}

async function run() {
  console.log('diag', JSON.stringify({ base: BASE, hosts: HOSTS.length, email: Boolean(EMAIL), uid: Boolean(UID), token: Boolean(TOKEN) }));
  const all = {};
  for (const t of TITLES) {
    const rec = { card: t.key };
    // A: withsearch статический реестр
    const ws = [];
    for (const host of HOSTS) {
      const r = await fetchT(`${host}/lite/withsearch?account_email=${encodeURIComponent(EMAIL)}&uid=${encodeURIComponent(UID)}`, 15_000);
      const slugs = balancersFromSearch(r.text);
      if (slugs.length) { ws.push({ host, count: slugs.length, slugs }); break; }
    }
    rec.discovery = { withsearch: ws[0] || null };
    // B: lite/events life → online[]
    const ev = await phaseBEvents(t);
    rec.events = ev ? { ...ev, online: summaryOfOnline(ev.online) } : null;
    rec.events_raw = ev?.online || null;
    // C: Lampac-app endpoints
    rec.app = await phaseCAppEndpoints(t);
    // D: deep links показанных балансеров
    rec.deepLinks = await phaseDDeepLinks(t, ev?.online);
    // E: Maniya
    if (DO_MANIYA && TOKEN) {
      rec.maniya_card = await maniyaCard(t);
      const skazShown = (rec.maniya_card?.shown || []).filter((p) => p.startsWith('skaz-'));
      rec.maniya_videos = [];
      for (const p of skazShown.slice(0, 3)) {
        rec.maniya_videos.push(await maniyaVideos(t, p));
      }
    } else {
      rec.maniya = 'skipped';
    }
    all[t.key] = rec;
    const f = `${OUTDIR}/${t.key}.json`;
    writeFileSync(f, JSON.stringify(rec, null, 2), 'utf8');
    // консоль-сводка
    console.log(`\n===${t.key}===`);
    console.log('EVENTS', ev ? JSON.stringify({ host: ev.host, ready: ev.ready, tasks: ev.tasks, shown: (ev.online || []).filter((o) => o.show).length, total: (ev.online || []).length }) : 'null');
    console.log('DEEP', JSON.stringify(rec.deepLinks));
    if (rec.maniya_card) console.log('MANIYA_CARD', JSON.stringify({ ms: rec.maniya_card.ms, elapsed: rec.maniya_card.elapsed_ms, shown: rec.maniya_card.shown.length, hidden: rec.maniya_card.hidden.length }));
    if (rec.maniya_videos) for (const v of rec.maniya_videos) console.log('MANIYA_VID', JSON.stringify({ p: v.provider, ms: v.ms, items: v.items, seasons: v.seasons, voices: v.voices, perr: v.perr, first: v.firstItems }));
  }
  writeFileSync(`${OUTDIR}/_all.json`, JSON.stringify(all, null, 2), 'utf8');
  console.log('\ndone');
}

run().catch((e) => { console.error('FATAL', e && e.message || e); process.exit(1); });