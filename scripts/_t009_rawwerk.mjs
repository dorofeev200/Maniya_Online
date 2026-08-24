// Прямой оригинальный werkecdn m3u8 (мимо Maniya): были ли hash на seg-ах исходно?
// Если да — идемпотентность inheritBaseQuery тривиальна (missing-check не сработал).
const BASE = process.env.B || 'http://127.0.0.1:3210';
const TOKEN = process.env.T || '';
const qs = (o) => new URLSearchParams(o).toString();
async function g(u) { const r = await fetch(u, { signal: AbortSignal.timeout(60000) }); return { s: r.status, b: Buffer.from(await r.arrayBuffer()) }; }
(async () => {
  const v = await g(`${BASE}/api/lampa/videos?${qs({ token: TOKEN, provider: 'filmix', source: 'tmdb', title: 'История игрушек 5', original_title: 'Toy Story 5', year: '2026', serial: '0' })}`);
  const items = JSON.parse(v.b.toString()).items || [];
  const werk = items.find((i) => i.url && i.url.includes('werkecdn'));
  if (!werk) { console.log('NO_WERKECDN_ITEM'); process.exit(0); }
  const rawInner = new URL(werk.url).searchParams.get('url') || '';
  const m = await g(rawInner);
  const lines = m.b.toString().split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const withHash = lines.filter((l) => /[?&]hash=/.test(String(l))).length;
  console.log(JSON.stringify({
    rawStatus: m.s,
    contentLen: m.b.length,
    segs: lines.length,
    segWithOwnHashOriginal: withHash,
    sample: lines.slice(0, 3)
  }, null, 1));
})();