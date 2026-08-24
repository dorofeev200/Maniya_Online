// Proof through Maniya PROD proxy: seg-no-hash (player path → 403) vs seg+index-hash (200 playable).
// Also record the exact Maniya-facing URLs for the report.
import fs from 'node:fs'; import path from 'node:path';
const REDACT = (u) => String(u || '').replace(/token=[^&]*/, 'token=***').replace(/(hash=)([A-Za-z0-9_\-]{0,6})[^&]*/g, '$1$2…');
async function g(url, { headers = {}, ms = 40000 } = {}) {
  const t0 = Date.now();
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers, redirect: 'follow' });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ms: Date.now() - t0, ctype: r.headers.get('content-type') || '', len: buf.length, body: buf, finalUrl: r.url || '' };
  } catch (e) { return { status: 'ERR', error: String(e).slice(0, 70), body: Buffer.alloc(0) }; }
}
const b16 = (b, n = 8) => (b.length ? b.slice(0, n).toString('hex') : '(empty)');
const PROD = 'https://plugin.maniya-kvn.online'; const TOKEN = 'mo-admin-test-2026';
(async () => {
  const q = new URLSearchParams({ token: TOKEN, provider: 'filmix', source: 'tmdb', title: 'История игрушек 5', original_title: 'Toy Story 5', year: '2026', serial: '0' });
  const j = JSON.parse((await g(`${PROD}/api/lampa/videos?${q}`)).body.toString('utf8'));
  const item = j.items[0]; // SDR MovieDalen nl105
  const inner = new URL(item.url).searchParams.get('url');
  const hash = new URL(inner).searchParams.get('hash') || '';
  console.log('innear  m3u8 hash len:', hash.length);
  const seg = `https://nl105.cdnsqu.com/hls/UHD_1313/Toy.Story.5.2026.D.ru.MovieDalen.4K.SDR.WEBDL.2160pp_2160.mp4/seg-1-v1-a1.ts`;
  const mk = (u) => `${PROD}/api/lampa/proxy?url=${encodeURIComponent(u)}&token=${TOKEN}`;
  const P1 = mk(seg);
  const P2 = mk(seg + '?hash=' + encodeURIComponent(hash));
  console.log('P1 (player path, no hash):', REDACT(P1).slice(0, 140));
  console.log('P2 (+ index hash):      ', REDACT(P2).slice(0, 140));
  const r1 = await g(P1, { headers: { 'User-Agent': 'Lampa/2.4.7' } });
  console.log(`THROUGH-PROXY seg no-hash  → ${r1.status} ct=${r1.ctype} len=${r1.len} b16=${b16(r1.body)}`);
  const r2 = await g(P2, { headers: { 'User-Agent': 'Lampa/2.4.7' } });
  console.log(`THROUGH-PROXY seg +hash    → ${r2.status} ct=${r2.ctype} len=${r2.len} b16=${b16(r2.body, 12)}`);
  // range on proxy for +hash (player uses Range)
  const r3 = await g(P2, { headers: { 'User-Agent': 'Lampa/2.4.7', Range: 'bytes=0-1023' } });
  console.log(`THROUGH-PROXY seg +hash Range → ${r3.status} ct=${r3.ctype} len=${r3.len} cr=${r3.response?.headers?.get?.('content-range') || 'n/a'}`);
  // second fragment +hash
  const seg2 = `https://nl105.cdnsqu.com/hls/UHD_1313/Toy.Story.5.2026.D.ru.MovieDalen.4K.SDR.WEBDL.2160pp_2160.mp4/seg-2-v1-a1.ts?hash=${encodeURIComponent(hash)}`;
  const r4 = await g(mk(seg2), { headers: { 'User-Agent': 'Lampa/2.4.7' } });
  console.log(`THROUGH-PROXY seg#2 +hash   → ${r4.status} ct=${r4.ctype} len=${r4.len} b16=${b16(r4.body, 8)}`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });