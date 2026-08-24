// T018 Phase 3 — воронка источник-модели числом:
// SKAZ online[] (show) vs Maniya static /sources (реестр) vs per-card show vs /videos items.
// READ-ONLY GET; ничего не пишет в код/конфиг/PROD.
// env: DIFF_TOKEN, DIFF_BASE.
import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const BASE = process.env.DIFF_BASE || 'https://plugin.maniya-kvn.online';
const TOKEN = process.env.DIFF_TOKEN || '';
const OUTDIR = 'docs/t018';

const NATIVE = new Set(['filmix', 'kodik', 'rezka', 'alloha', 'rutubemovie', 'cdnvideohub', 'collaps', 'hdvb', 'kinotochka']);

async function get(path, ms = 120_000) {
  const t0 = Date.now();
  const c = new AbortController();
  const tm = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(`${BASE}${path}&token=${TOKEN}`, { signal: c.signal });
    const j = await r.json().catch(() => null);
    return { status: r.status, ms: Date.now() - t0, j };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, err: String(e).slice(0, 100) };
  } finally {
    clearTimeout(tm);
  }
}

function cardParams(t) {
  const p = new URLSearchParams({ source: 'tmdb', id: t.id, imdb_id: t.imdb_id, kinopoisk_id: t.kinopoisk_id, title: t.title, original_title: t.original_title, year: t.year, serial: t.serial });
  return p.toString();
}

const TITLES = {
  mutiny: { id: '1288445', imdb_id: 'tt32338669', kinopoisk_id: '1288445', title: 'Мятеж', original_title: 'Mutiny', year: '2026', serial: '0' },
  toystory5: { id: '1084244', imdb_id: 'tt29355505', kinopoisk_id: '1084244', title: 'История игрушек 5', original_title: 'Toy Story 5', year: '2026', serial: '0' },
  interst: { id: '157372', imdb_id: 'tt0816692', kinopoisk_id: '258687', title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0' }
};

const CARDS = {};
for (const k of Object.keys(TITLES)) {
  CARDS[k] = JSON.parse(readFileSync(`${OUTDIR}/${k}.json`, 'utf8'));
}

// Static /sources
const s = await get('/api/lampa/sources?t=1');
const staticIdOrder = (s.j?.sources || []).map((x) => x.id);
const staticMeta = {};
for (const x of (s.j?.sources || [])) staticMeta[x.id] = { name: x.name, icon: x.icon, quality_label: x.quality_label };
console.log('STATIC_SOURCES', s.status, JSON.stringify(staticIdOrder));
writeFileSync(`${OUTDIR}/static-sources.json`, JSON.stringify({ status: s.status, ms: s.ms, sources: s.j?.sources || [] }, null, 2), 'utf8');

const out = { static: { status: s.status, ms: s.ms, count: staticIdOrder.length, order: staticIdOrder }, cards: {} };

for (const k of Object.keys(TITLES)) {
  const card = CARDS[k];
  const skaz = (card.events?.online || []).filter((o) => o.show);
  const skazHidden = (card.events?.online || []).filter((o) => !o.show);
  const maniyaShown = card.maniya_card?.shown || [];
  const maniyaHidden = card.maniya_card?.hidden || [];
  console.log(`\n### ${k}  SKAZ_online=${(card.events.online||[]).length} shown=${skaz.length} hidden=${skazHidden.length} RCH=${skaz.filter(o=>o.rch).length} | MANIYA static=${staticIdOrder.length} shown=${maniyaShown.length} hidden=${maniyaHidden.length}`);

  const videos = [];
  for (const id of maniyaShown) {
    const provider = id.startsWith('skaz-') ? id : id;
    const isNative = NATIVE.has(id);
    const r = await get(`/api/lampa/videos?provider=${provider}&${cardParams(TITLES[k])}`, 150_000);
    const items = (r.j?.items || []).length;
    const seasons = (r.j?.seasons || []).length;
    const voices = (r.j?.voices || []).length;
    const perr = r.j?.provider_error?.code || null;
    videos.push({ id, kind: isNative ? 'native' : 'skaz-bridge', status: r.status, ms: r.ms, items, seasons, voices, perr });
    console.log(`   /videos ${provider} status=${r.status} ms=${r.ms} items=${items} seasons=${seasons} voices=${voices} perr=${perr}`);
  }
  out.cards[k] = {
    skaz_online: (card.events?.online || []).length,
    skaz_shown: skaz.map((o) => ({ index: o.index, id: o.balanser, rch: o.rch, voices: o.voices })),
    skaz_hidden: skazHidden.map((o) => o.balanser),
    maniya_static: staticIdOrder.length,
    maniya_shown: maniyaShown,
    maniya_hidden: maniyaHidden,
    videos
  };
}

writeFileSync(`${OUTDIR}/funnel.json`, JSON.stringify(out, null, 2), 'utf8');
console.log('\ndone');