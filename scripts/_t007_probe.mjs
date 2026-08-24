// SKAZ-MANIYA-007 §M-probe — READ-ONLY head er matrix on nl105.cdnsqu.com filmix item.
import fs from 'node:fs';
import path from 'node:path';
const REDACT = (u) => String(u || '').replace(/token=[^&]*/, 'token=***').replace(/account_email=[^&]*/, 'ae=***').replace(/uid=[^&]*/, 'uid=***');
async function g(url, { headers = {}, ms = 30000 } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers, redirect: 'follow' });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ms: Date.now() - t0, ctype: r.headers.get('content-type') || '', len: buf.length, hdrs: Object.fromEntries(r.headers.entries()), finalUrl: r.url || '', body: buf };
  } catch (e) { return { status: 'ERR', error: String(e).slice(0, 70), body: Buffer.alloc(0) }; }
}
const b16 = (b, n = 12) => b.length ? b.slice(0, n).toString('hex') : '(empty)';

// Read token/skaz, build base URLs
const env = {};
for (const line of fs.readFileSync(path.resolve('server/.env'), 'utf8').split(/\r?\n/)) if (line && !line.startsWith('#') && line.includes('=')) { const i = line.indexOf('='); env[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }

const PROD = 'https://plugin.maniya-kvn.online';
const TOKEN = 'mo-admin-test-2026';

(async () => {
  const q = new URLSearchParams({ token: TOKEN, provider: 'filmix', source: 'tmdb', title: 'История игрушек 5', original_title: 'Toy Story 5', year: '2026', serial: '0' });
  const v = await g(`${PROD}/api/lampa/videos?${q}`);
  const j = JSON.parse(v.body.toString('utf8'));
  const target = j.items[0];
  // underlying CDN m3u8 URL
  const inner = new URL(target.url).searchParams.get('url');
  console.log('ITEM voice:', target.voice_name);
  console.log('ITEM inner m3u8:', REDACT(inner).slice(0, 160));

  // 1) RAW upstream m3u8 direct (no proxy): headers/presence of tokens
  const raw = await g(inner, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  console.log(`R1 raw m3u8 direct → HTTP ${raw.status} (${raw.ms}ms) ctype=${raw.ctype} len=${raw.len}`);
  const rawText = raw.body.toString('utf8');
  console.log('R1 head:', rawText.replace(/\r?\n/g, '⏎').slice(0, 300));
  const rawSegs = rawText.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  console.log('R1 seg count:', rawSegs.length);
  console.log('R1 seg[0] RAW:', REDACT(rawSegs[0] || '').slice(0, 200));
  console.log('R1 seg[1] RAW:', REDACT(rawSegs[1] || '').slice(0, 200));
  // do original seg URLs carry query tokens?
  console.log('R1 seg[0] hasQuery:', rawSegs[0] ? /[?&]/.test(rawSegs[0]) : 'n/a');

  // 2) segment header matrix — same .ts path, variants
  const baseSeg = rawSegs[0] || '';
  const tryHeaders = [
    ['none', {}],
    ['UA only', { 'User-Agent': 'Mozilla/5.0' }],
    ['Referer self (https://nl105.cdnsqu.com/)', { 'User-Agent': 'Mozilla/5.0', Referer: 'https://nl105.cdnsqu.com/' }],
    ['Referer https://filmix.my/', { 'User-Agent': 'Mozilla/5.0', Referer: 'https://filmix.my/' }],
    ['Referer https://filmix.gg/', { 'User-Agent': 'Mozilla/5.0', Referer: 'https://filmix.gg/' }],
    ['Origin+Referer lampa.mx', { 'User-Agent': 'Mozilla/5.0', Referer: 'http://lampa.mx/', Origin: 'http://lampa.mx' }],
    ['UA Lampa/2.4.7', { 'User-Agent': 'Lampa/2.4.7' }],
    ['Range bytes=0-1023', { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-1023' }],
  ];
  for (const [label, h] of tryHeaders) {
    const d = await g(baseSeg, { headers: h });
    console.log(`S2 [${
      label}] → ${d.status} (${d.ms}ms) ct=${d.ctype} len=${d.len} body16=${b16(d.body, 8)}` + (d.status === 403 ? ` body=${d.body.toString('utf8').replace(/\s+/g, ' ').slice(0, 120)}` : ''));
  }

  // 3) The DIRECT MP4 progressive (same directory, no seg subpath) — how a Skaz player would play it
  const mp4 = baseSeg.replace(/\/seg-[^/]+$/, '');
  console.log('S3 candidate MP4:', REDACT(mp4).slice(0, 180));
  const p1 = await g(mp4, { headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-1023' } });
  console.log(`S3 MP4 Range → ${p1.status} (${p1.ms}ms) ct=${p1.ctype} len=${p1.len} b16=${b16(p1.body)} cr=${p1.hdrs['content-range'] || '-'}`);
  const p2 = await g(mp4, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  console.log(`S3 MP4 full-GET → ${p2.status} (${p2.ms}ms) ct=${p2.ctype} len=${p2.len}`);

  // 4) alternate node werkecdn for the same title (HDR10+ item) + its seg
  const target2 = j.items[2];
  const inner2 = new URL(target2.url).searchParams.get('url');
  console.log('S4 item2 inner(HDR10+ werkecdn):', REDACT(inner2).slice(0, 150));
  const raw2 = await g(inner2, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  console.log(`S4 item2 raw m3u8 → ${raw2.status} (${raw2.ms}ms) len=${raw2.len} ctype=${raw2.ctype}`);
  if (raw2.status === 200) {
    const t2 = raw2.body.toString('utf8');
    const segs2 = t2.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
    console.log('S4 item2 segs:', segs2.length, 'seg0:', REDACT(segs2[0] || '').slice(0, 160));
    if (segs2.length) {
      const r2 = await g(segs2[0], { headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`S4 item2 seg#1 direct → ${r2.status} (${r2.ms}ms) ct=${r2.ctype} len=${r2.len} b16=${b16(r2.body, 8)}`);
    }
  }

  // 5) node2 item1 (Ukr LeDoyen on nl105) — same CDN, different render
  const target1 = j.items[1];
  const inner1 = new URL(target1.url).searchParams.get('url');
  const raw3 = await g(inner1, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  console.log(`S5 item1 (Ukr nl105) raw m3u8 → ${raw3.status} (${raw3.ms}ms) len=${raw3.len}`);
  if (raw3.status === 200) {
    const segs3 = raw3.body.toString('utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
    console.log('S5 item1 segs:', segs3.length, 'seg0:', REDACT(segs3[0] || '').slice(0, 160));
    if (segs3.length) {
      const r3 = await g(segs3[0], { headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`S5 item1 seg#1 direct → ${r3.status} (${r3.ms}ms) ct=${r3.ctype} len=${r3.len} b16=${b16(r3.body, 8)}`);
    }
  }
})().catch((e) => { console.error('PROBE-FAIL', e); process.exit(1); });