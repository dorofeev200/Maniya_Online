// T014 concurrency: playback-aware workload on BASE (single), levels 10..400.
// Per worker: sources/card(control) -> videos -> fetch first play url (Range 0-64KB).
// Env: BASE, TOKEN, LEVELS="10,25,50,100,200,300,400", TITLE_KEY.
const T = { source: 'tmdb', title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0' };
const cardQ = new URLSearchParams({ token: process.env.TOKEN, id: '', imdb_id: '', kinopoisk_id: '', ...T });
const mkErr = (e) => ({ err: String(e).slice(0, 70) });
const worker = async (i, base, tToken) => {
  const o = { i };
  const xff = `10.${(i >> 8) & 255}.${i & 255}.${i % 250 + 1}`; // unique client IP per worker
  const h = { 'x-forwarded-for': xff };
  const t0 = Date.now();
  let r;
  try { r = await fetch(`${base}/api/lampa/sources/card?${cardQ}`, { headers: h, signal: AbortSignal.timeout(30000) }); o.card = { st: r.status, ms: Date.now() - t0 }; if (r.status !== 200) o.head = (await r.text().catch(() => '')).slice(0, 60); } catch (e) { o.card = mkErr(e); return o; }
  if (r.status !== 200) return o;
  const q = new URLSearchParams({ source: 'tmdb', provider: process.env.PROVIDER || 'filmix', ...T });
  const t1 = Date.now();
  try {
    const v = await fetch(`${base}/api/lampa/videos?token=${tToken}&${q}`, { headers: h, signal: AbortSignal.timeout(30000) });
    o.videos = { st: v.status, ms: Date.now() - t1 };
    if (v.status === 200) {
      const j = await v.json().catch(() => null);
      const u = ((j?.items || []).find((x) => /mp4|m3u8/i.test(String(x.url || ''))) || (j?.items || [])[0] || {})?.url;
      if (u) {
        const t2 = Date.now();
        const seg = await fetch(u, { headers: { Range: 'bytes=0-65535', ...h }, signal: AbortSignal.timeout(45000) });
        o.seg = { st: seg.status, ms: Date.now() - t2, ar: seg.headers.get('accept-ranges') || '' };
      } else o.seg = { skipped: 1 };
    }
  } catch (e) { o.videos = mkErr(e); }
  return o;
};
const main = async () => {
  const base = process.env.BASE, token = process.env.TOKEN;
  const levels = process.env.LEVELS.split(',').map(Number);
  for (const n of levels) {
    const jobs = Array.from({ length: n }, (_, i) => worker(i, base, token));
    const s = Date.now();
    const rs = await Promise.all(jobs);
    const wall = Date.now() - s;
    const ok = rs.filter((r) => !r.err && r.card && r.card.st === 200).length;
    const bad = rs.filter((r) => r.err || (r.card && r.card.st !== 200)).length;
    const errHist = {};
    for (const r of rs) if (r.card?.err) { const k = String(r.card.err).replace(/[0-9]+$/, 'N'); errHist[k] = (errHist[k] || 0) + 1; }
    const card5xx = rs.filter((r) => r.card && r.card.st >= 500).length;
    const segOK = rs.filter((r) => r.seg && (r.seg.st === 206 || r.seg.st === 200)).length;
    const segErr = rs.filter((r) => r.seg && r.seg.st !== 206 && r.seg.st !== 200).length;
    const cards = rs.map((r) => r.card?.ms || 0).filter(Boolean);
    const vids = rs.map((r) => r.videos?.ms || 0).filter(Boolean);
    console.log(JSON.stringify({ n, wall_ms: wall, ok, bad, card5xx, seg206: segOK, segNot206: segErr,
      card_ms: { avg: Math.round(cards.reduce((a, b) => a + b, 0) / (cards.length || 1)), p95: [...cards].sort((a, b) => a - b)[Math.floor(cards.length * 0.95)] || 0 }, err: errHist,
      videos_ms: { avg: Math.round(vids.reduce((a, b) => a + b, 0) / (vids.length || 1)), p95: [...vids].sort((a, b) => a - b)[Math.floor(vids.length * 0.95)] || 0 } }));
  }
};
main();