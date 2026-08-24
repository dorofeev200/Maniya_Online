// T014 A/B: identical requests to OLD PROD vs MOSCOW clone.
// BASE_OLD / BASE_MOS / TOKEN передаются env. Только GET.
const TITLES = [
  { key: 'toystory5',   title: 'История игрушек 5', on: 'Toy Story 5',         year: '2026', serial: '0' },
  { key: 'forrest',     title: 'Форрест Гамп',       on: 'Forrest Gump',        year: '1994', serial: '0' },
  { key: 'interstellar',title: 'Интерстеллар',       on: 'Interstellar',        year: '2014', serial: '0' },
  { key: 'drakon',      title: 'Дом дракона',        on: 'House of the Dragon', year: '2022', serial: '1' },
  { key: 'parasite',    title: 'Паразиты',           on: 'Parasite',            year: '2019', serial: '0' }
];
const cardParams = (t) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ id: '', imdb_id: '', kinopoisk_id: '', title: t.title, original_title: t.on, original_language: '', serial: t.serial, year: t.year, source: 'tmdb' }))
    if (v !== '' && v != null) p.set(k, v);
  return p;
};
const time = async (url) => {
  const s = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    const j = await r.json().catch(() => null);
    return { status: r.status, ms: Date.now() - s, cached: j?.meta?.cached ?? null, elapsed_ms: j?.meta?.elapsed_ms ?? null, count: j?.meta?.count ?? null,
      shown: (j?.sources || []).filter((s) => s.show).map((s) => s.id),
      hidden: (j?.sources || []).filter((s) => !s.show).map((s) => s.id) };
  } catch (e) { return { status: 0, ms: Date.now() - s, err: String(e).slice(0, 80) }; }
};
const main = async () => {
  const OLD = process.env.BASE_OLD, MOS = process.env.BASE_MOS, TOKEN = process.env.TOKEN;
  for (const t of TITLES) {
    const q = `/api/lampa/sources/card?token=${TOKEN}&${cardParams(t).toString()}`;
    const [old, mos] = await Promise.all([time(OLD + q), time(MOS + q)]);
    const shownEq = JSON.stringify(old.shown) === JSON.stringify(mos.shown);
    console.log(JSON.stringify({ title: t.key, old: { st: old.status, ms: old.ms, cache: old.cached, count: old.count, shown: old.shown?.length, hidden: old.hidden?.length }, mos: { st: mos.status, ms: mos.ms, cache: mos.cached, count: mos.count, shown: mos.shown?.length, hidden: mos.hidden?.length }, SHOWN_EQUAL: shownEq, div: old.shown?.filter((x) => !mos.shown?.includes(x)), div2: mos.shown?.filter((x) => !old.shown?.includes(x)) }));
  }
  const s0 = await time(`${OLD}/api/lampa/sources?token=${TOKEN}`);
  const s1 = await time(`${MOS}/api/lampa/sources?token=${TOKEN}`);
  console.log(JSON.stringify({ title: 'SOURCES_STATIC', old: { st: s0.status, ms: s0.ms, n: s0.shown?.length }, mos: { st: s1.status, ms: s1.ms, n: s1.shown?.length } }));
};
main();