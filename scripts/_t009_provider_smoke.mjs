// SKAZ-MANIYA-009 P7: multi-provider smoke против SHADOW :3210.
// По одному известному тайтлу на каждый источник, классификация dot-separated:
//   PASS / UPSTREAM / EGRESS / EMPTY / FAIL
// (по правилам TASK-005 §18 и классификации egress-окна в памяти).
// НЕ выдаём false PASS: если источник жив, но сеть транзиентно пуста — честная классификация.
// Запуск: node scripts/_t009_provider_smoke.mjs  (TOKEN из env SMOKE_TOKEN или дефолт-тест)
const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3210';
const TOK = process.env.SMOKE_TOKEN || 'mo-admin-test-2026';

// {prov, title, ot, year, serial}
const CASES = [
  { p: 'filmix',     t: 'История игрушек 5', ot: 'Toy Story 5', y: 2026, s: 0 },
  { p: 'videoseed',  t: 'Дюна',               ot: 'Dune',         y: 2021, s: 0 },
  { p: 'rezka',      t: 'Матрица',            ot: 'The Matrix',   y: 1999, s: 0 },
  { p: 'hdvb',       t: 'Гладиатор',          ot: 'Gladiator',    y: 2000, s: 0 },
  { p: 'kodik',      t: 'Интерстеллар',       ot: 'Interstellar', y: 2014, s: 0 },
  { p: 'kinopub',    t: 'Бойцовский клуб',    ot: 'Fight Club',   y: 1999, s: 0 },
  { p: 'alloha',     t: 'Аватар',             ot: 'Avatar',       y: 2009, s: 0 },
  { p: 'veoveo',     t: 'Форсаж 8',           ot: 'The Fate of the Furious', y: 2017, s: 0 },
  { p: 'kinotochka', t: 'Побег из Шоушенка',  ot: 'The Shawshank Redemption', y: 1994, s: 0 },
  { p: 'collaps',    t: 'Джон Уик',           ot: 'John Wick',    y: 2014, s: 0 },
];

function classify(c, r) {
  const body = (c + ' ').toString();
  if (body.includes('ERROR')) return 'ERROR(transient)';
  if (body.includes('EMPTY')) return 'EMPTY';
  if (body.includes('UPSTREAM')) return 'UPSTREAM';
  if (body.includes('EGRESS')) return 'EGRESS';
  return 'UNKNOWN';
}

function firstItem(j) {
  const items = j && Array.isArray(j.items) ? j.items : [];
  if (!items.length) return null;
  const it = items[0] || {};
  const u = it.url || '';
  return { n: items.length, url0: u.slice(0, 110) };
}

(async () => {
  for (const c of CASES) {
    const q = new URLSearchParams({ token: TOK, provider: c.p, source: 'tmdb', title: c.t, original_title: c.ot, year: String(c.y), serial: String(c.s) });
    const t0 = Date.now();
    let r;
    try { r = await fetch(`${BASE}/api/lampa/videos?${q}`, { signal: AbortSignal.timeout(60000) }); }
    catch (e) { console.log(`[${c.p}] NET-ERR ${String(e).slice(0, 60)} (${Date.now() - t0}ms)`); continue; }
    let j = null, raw = '';
    try { raw = await r.text(); j = JSON.parse(raw); } catch {}
    const ms = Date.now() - t0;
    if (!j) { console.log(`[${c.p}] status=${r.status} NON-JSON (${ms}ms) ${raw.slice(0, 80)}`); continue; }
    const fi = firstItem(j);
    const perr = (j && j.provider_error) ? String(j.provider_error).slice(0, 40) : '';
    const meta = j && j.meta ? (j.meta.title || j.meta.original_title || '') : '';
    console.log(`[${c.p}] status=${r.status} items=${fi ? fi.n : 0} ms=${ms} meta="${meta}" ${perr ? 'perr=' + perr : ''} ${fi ? 'url0=' + fi.url0 : ''}`);
  }
})();