// TASK-011 READ-ONLY differential harness: SKAZ-cluster ground truth vs Production Maniya.
// НЕ меняет код/конфиг/.env/VPS/PROD. Только GET-запросы.
//
// Phase A: Maniya /api/lampa/sources/card (availability+show+elapsed) для контрольного набора.
// Phase B: прямой кластерный probe каждого видимого skaz-балансера на всех хостах
//          (те же query-params, что Maniya buildUrl) — грунд-трут «есть/нет» по хост/балансер.
// Phase C (по ключам): Maniya /api/lampa/videos для выбранного провайдера + /video резолв.
//
// Использование: node scripts/_t011_diff.mjs   (env: DIFF_BASE, DIFF_TOKEN, DIFF_TITLE=<key>)
import { config } from '../server/src/config.js';
import { orderedSkazHosts } from '../server/src/providers/skaz/hostOrder.js';
import { checkSearchPredicate } from '../server/src/availability.js';

const BASE = process.env.DIFF_BASE || 'https://plugin.maniya-kvn.online';
const TOKEN = process.env.DIFF_TOKEN || '';
const ONLY = process.env.DIFF_TITLE || '';
const DEEP = process.env.DIFF_DEEP || '';
const SKIP_CLUSTER = process.env.DIFF_SKIP_CLUSTER === '1';

const HOSTS = orderedSkazHosts(config.skaz.hosts || []);
const EMAIL = String(config.skaz.accountEmail || '').trim();
const UID = String(config.skaz.uid || '').trim();
const NO = new Set(['null', 'disable', 'false', 'not found']);

const TITLES = [
  { key: 'toystory5',   title: 'История игрушек 5', on: 'Toy Story 5',        year: '2026', serial: '0' },
  { key: 'forrest',     title: 'Форрест Гамп',       on: 'Forrest Gump',       year: '1994', serial: '0' },
  { key: 'interstellar',title: 'Интерстеллар',       on: 'Interstellar',       year: '2014', serial: '0' },
  { key: 'drakon',      title: 'Дом дракона',        on: 'House of the Dragon',year: '2022', serial: '1' },
  { key: 'parasite',    title: 'Паразиты',           on: 'Parasite',           year: '2019', serial: '0' },
  { key: 'odyssey',     title: 'Одиссея',            on: 'Odyssey',            year: '2026', serial: '0' }
];

function cardParams(t) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ id: '', imdb_id: '', kinopoisk_id: '', title: t.title, original_title: t.on, original_language: '', serial: t.serial, year: t.year, source: 'tmdb' })) {
    if (v !== '' && v != null) p.set(k, v);
  }
  return p;
}

async function maniyaCard(t) {
  const url = `${BASE}/api/lampa/sources/card?token=${TOKEN}&${cardParams(t).toString()}`;
  const s = Date.now();
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  const ms = Date.now() - s;
  const j = await r.json().catch(() => null);
  return { status: r.status, ms, cached: j?.meta?.cached, elapsed_ms: j?.meta?.elapsed_ms, count: j?.meta?.count, sources: j?.sources || [] };
}

function clusterUrl(balancer, t, host, checksearch) {
  const u = new URL(`${host}/lite/${balancer}`);
  for (const [k, v] of Object.entries({ id: '', imdb_id: '', kinopoisk_id: '', title: t.title, original_title: t.on, original_language: '', serial: t.serial, year: t.year, source: 'tmdb' })) {
    if (v !== '' && v != null) u.searchParams.set(k, String(v));
  }
  if (checksearch) u.searchParams.set('checksearch', 'true');
  if (EMAIL) u.searchParams.set('account_email', EMAIL);
  if (UID) u.searchParams.set('uid', UID);
  return u.toString();
}

async function fetchOne(url) {
  const c = new AbortController();
  const tm = setTimeout(() => c.abort(), 12_000);
  try {
    const r = await fetch(url, { headers: { accept: '*/*' }, signal: c.signal });
    return r;
  } catch {
    return null;
  } finally {
    clearTimeout(tm);
  }
}

function classify(res, text, t) {
  if (!res) return { kind: 'noResponse' };
  if (!(res.status >= 200 && res.status < 300)) return { kind: 'non2xx', status: res.status };
  if (text == null || text === '') return { kind: 'noResponse', status: res.status };
  if (text.trim().startsWith('{')) {
    if (/\"accsdb\"\s*:\s*true/i.test(text)) return /ожидаем\s+фильм\s+в\s+хорошем\s+качестве/i.test(text)
      ? { kind: 'awaiting', status: res.status } : { kind: 'accsdb', status: res.status };
    if (/\"rch\"\s*:\s*true/i.test(text)) return { kind: 'rch', status: res.status };
  }
  const first = text.trim().split(/\r?\n/, 1)[0].toLowerCase();
  if (NO.has(first)) return { kind: 'noncontent', status: res.status };
  const p = checkSearchPredicate(text, { title: t.title, original_title: t.on, year: t.year });
  if (p.verdict === 'content') return { kind: 'content', status: res.status, quality: p.quality, rch: p.rch };
  if (p.verdict === 'inconclusive') return { kind: 'inconclusive', status: res.status };
  return { kind: 'absent', status: res.status };
}

async function clusterProbe(balancer, t, checksearch = true) {
  const rows = [];
  for (const host of HOSTS) {
    const url = clusterUrl(balancer, t, host, checksearch);
    const s = Date.now();
    const res = await fetchOne(url);
    const ms = Date.now() - s;
    let text = null;
    if (res) text = await res.text().catch(() => null);
    rows.push({ host: host.replace(/^https?:\/\//, ''), ms, ...classify(res, text, t) });
    // content на ноде — авторитетно, дальше не ходим (как Maniya probe)
    if (res && res.status >= 200 && res.status < 300 && ['content', 'inconclusive'].includes(rows[rows.length - 1].kind)) break;
  }
  return rows;
}

async function maniyaVideos(t, provider) {
  const q = new URLSearchParams({ token: TOKEN, provider, source: 'tmdb', title: t.title, original_title: t.on, year: t.year, serial: t.serial });
  const s = Date.now();
  const r = await fetch(`${BASE}/api/lampa/videos?${q.toString()}`, { signal: AbortSignal.timeout(60_000) });
  const ms = Date.now() - s;
  const j = await r.json().catch(() => null);
  return { status: r.status, ms, nitems: (j?.items || []).length, seasons: (j?.seasons || []).length, voices: (j?.voices || []).length, perr: j?.provider_error?.code || null, items: (j?.items || []).map((i) => ({
    method: i.method, ti: String(i.title || '').slice(0, 22), ep: i.episode != null ? `s${i.season}e${i.episode}` : 'f'
  })).slice(0, 6) };
}

async function maniyaVideo(t, provider, extra = {}) {
  const q = new URLSearchParams({ token: TOKEN, provider, source: 'tmdb', title: t.title, original_title: t.on, year: t.year, serial: t.serial });
  for (const [k, v] of Object.entries(extra)) if (v != null) q.set(k, String(v));
  const s = Date.now();
  const r = await fetch(`${BASE}/api/lampa/video?${q.toString()}`, { signal: AbortSignal.timeout(60_000) });
  const ms = Date.now() - s;
  const j = await r.json().catch(() => null);
  return { status: r.status, ms, method: j?.method, type: j?.type, perr: j?.provider_error?.code || null, url: String(j?.url || '').slice(0, 90) };
}

const PROV_CACHE = new Map();
async function provList() {
  if (PROV_CACHE.has('x')) return PROV_CACHE.get('x');
  const r = await fetch(`${BASE}/api/lampa/sources?token=${TOKEN}`, { signal: AbortSignal.timeout(20_000) });
  const j = await r.json().catch(() => ({}));
  const lst = (j.sources || []).map((s) => s.id);
  PROV_CACHE.set('x', lst);
  return lst;
}

/** Discovery: lite/withsearch на пуле хостов → slug-список (как SkazClient.discover). */
async function discoverBalancers() {
  if (!EMAIL || !UID) return null;
  for (const host of HOSTS) {
    const url = `${host}/lite/withsearch?account_email=${encodeURIComponent(EMAIL)}&uid=${encodeURIComponent(UID)}`;
    const res = await fetchOne(url);
    if (!res) continue;
    const text = await res.text().catch(() => null);
    if (!text) continue;
    const slugs = [];
    try {
      const parsed = JSON.parse(text);
      const values = Array.isArray(parsed) ? parsed : Object.values(parsed);
      for (const v of values) {
        if (typeof v === 'string') slugs.push(v.trim());
        else if (v && typeof v === 'object' && v.balancer) slugs.push(String(v.balancer));
      }
    } catch { /* не JSON — ссылки ниже */ }
    if (!slugs.length) {
      const linkRe = /lite\/([a-z0-9]+)/gi;
      let m;
      while ((m = linkRe.exec(text)) !== null) slugs.push(m[1]);
    }
    const seen = new Set();
    const uniq = slugs.filter((s) => { if (!s || seen.has(s)) return false; seen.add(s); return /^[a-z0-9]{2,24}$/.test(s); });
    if (uniq.length) return uniq;
  }
  return null;
}

async function run() {
  if (!TOKEN) { console.log('diag', JSON.stringify({ err: 'DIFF_TOKEN empty', email: Boolean(EMAIL), uid: Boolean(UID), hosts: HOSTS.length })); return; }
  console.log('diag', JSON.stringify({ base: BASE, hosts: HOSTS.length, host0: HOSTS[0], email_cfg: Boolean(EMAIL), uid_cfg: Boolean(UID) }));
  const allProv = await provList();
  console.log('sources_static_order', JSON.stringify(allProv));

  // Phase D: discovery — полный набор балансеров кластера lite/withsearch
  const disc = await discoverBalancers();
  console.log('  CLUSTER_DISCOVER', JSON.stringify({ ok: Boolean(disc), count: disc?.length || 0, list: disc || [] }));

  for (const t of TITLES) {
    if (ONLY && t.key !== ONLY) continue;
    const card = await maniyaCard(t);
    console.log(`CARD ${t.key}`, JSON.stringify({ status: card.status, ms: card.ms, cached: card.cached, avail_ms: card.elapsed_ms, count: card.count, shown: card.sources.filter((s) => s.show).map((s) => s.id), hidden: card.sources.filter((s) => !s.show).map((s) => s.id) }));
    if (SKIP_CLUSTER) continue;
    // Phase B: кластерный грунд-трут для ВСЕХ skaz-балансеров (shown + hidden)
    const skazRows = card.sources.filter((s) => String(s.id).startsWith('skaz-'));
    for (const row of skazRows) {
      const balancer = String(row.id).replace(/^skaz-/, '');
      const probe = await clusterProbe(balancer, t, true);
      const verdicts = probe.map((p) => p.kind);
      const served = verdicts.includes('content') || verdicts.includes('inconclusive');
      console.log(`  CL ${t.key}`, JSON.stringify({ b: balancer, mShow: row.show, served, hosts: probe.map((p) => `${p.host}:${p.kind}${p.status ? '/' + p.status : ''}${p.ms ? ':' + p.ms + 'ms' : ''}`) }));
    }
    // Phase E: неподключённые балансеры кластера (отсутствуют в Maniya sources)
    if (disc && disc.length) {
      const connected = new Set(allProv.filter((id) => id.startsWith('skaz-')).map((id) => id.replace(/^skaz-/, '')));
      connected.add('filmix'); connected.add('rezka'); connected.add('hdvb'); connected.add('kodik'); connected.add('rutubemovie');
      const unknown = disc.filter((b) => !connected.has(b));
      if (unknown.length) {
        const rows = [];
        for (const b of unknown) {
          const probe = await clusterProbe(b, t, true);
          const served = probe.some((p) => p.kind === 'content' || p.kind === 'inconclusive');
          if (served) rows.push({ b, hosts: probe.filter((p) => p.kind === 'content' || p.kind === 'inconclusive').map((p) => `${p.host}:${p.kind}${p.quality ? '/' + p.quality : ''}`) });
        }
        if (rows.length) console.log(`  UKNWN ${t.key}`, JSON.stringify(rows));
      }
    }
    // Phase C (deep): /videos+/video для показанных skaz-источников выбранного тайтла
    if (DEEP && DEEP === t.key) {
      if (t.serial === '1') {
        const vd = await maniyaVideos(t, 'skaz-alloha');
        console.log(`  VID ${t.key}`, JSON.stringify({ p: 'skaz-alloha', ...vd }));
        if (vd.nitems > 0) {
          const vr = await maniyaVideo(t, 'skaz-alloha', { voice: 0, season: 1, episode: 1 });
          console.log(`  RESOLVE ${t.key}`, JSON.stringify({ p: 'skaz-alloha', s1e1: vr }));
        }
      } else {
        for (const p of ['skaz-alloha', 'skaz-veoveo', 'skaz-pidtor']) {
          const vd = await maniyaVideos(t, p);
          console.log(`  VID ${t.key}`, JSON.stringify({ p, ...vd }));
          if (vd.nitems > 0) {
            const vr = await maniyaVideo(t, p);
            console.log(`  RESOLVE ${t.key}`, JSON.stringify({ p, voice0: vr }));
          }
        }
      }
    }
  }
  console.log('done');
}

run().catch((e) => { console.error('FATAL', e && e.message || e); process.exit(1); });