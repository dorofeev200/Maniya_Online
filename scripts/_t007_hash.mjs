// Decisive: exact-full-hash propagation test on nl105 (SDR) vs werkecdn (HDR10+).
import fs from 'node:fs'; import path from 'node:path';
const REDACT = (u) => String(u || '').replace(/token=[^&]*/, 'token=***').replace(/(hash=)([A-Za-z0-9_\-]{0,8})[^&]*/g, '$1$2…');
async function g(url, { headers = {}, ms = 30000 } = {}) {
  const t0 = Date.now();
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers, redirect: 'follow' });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ms: Date.now() - t0, ctype: r.headers.get('content-type') || '', len: buf.length, body: buf };
  } catch (e) { return { status: 'ERR', error: String(e).slice(0, 70), body: Buffer.alloc(0) }; }
}
const b16 = (b, n = 8) => (b.length ? b.slice(0, n).toString('hex') : '(empty)');
const env = {};
for (const line of fs.readFileSync(path.resolve('server/.env'), 'utf8').split(/\r?\n/)) if (line && !line.startsWith('#') && line.includes('=')) { const i = line.indexOf('='); env[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
const PROD = 'https://plugin.maniya-kvn.online'; const TOKEN = 'mo-admin-test-2026';

(async () => {
  const q = new URLSearchParams({ token: TOKEN, provider: 'filmix', source: 'tmdb', title: 'История игрушек 5', original_title: 'Toy Story 5', year: '2026', serial: '0' });
  const j = JSON.parse((await g(`${PROD}/api/lampa/videos?${q}`)).body.toString('utf8'));

  for (const [label, item] of [['SDR-MovieDalen nl105', j.items[0]], ['HDR10+ werkecdn', j.items[2]]]) {
    const inner = new URL(item.url).searchParams.get('url');
    console.log(`== ${label} ==`);
    console.log('  inner m3u8:', REDACT(inner).slice(0, 150));
    const m = await g(inner, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    console.log(`  m3u8 direct → ${m.status} len=${m.len} ct=${m.ctype}`);
    if (m.status !== 200) continue;
    // extract exact full hash value from the m3u8 URL
    let hash = ''; try { hash = new URL(inner).searchParams.get('hash') || ''; } catch {}
    console.log(`  m3u8-url hash len=${hash.length}`);
    const segs = m.body.toString('utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
    const rawSeg0 = segs[0] || '';
    console.log('  raw seg0:', REDACT(rawSeg0).slice(0, 150));
    const rawHash0 = (() => { try { return new URL(rawSeg0).searchParams.get('hash') || '' } catch { return '' } })();
    console.log(`  seg0 own-hash len=${rawHash0.length} ${rawHash0 === hash ? '(== url-hash)' : rawHash0 ? '(DIFFERENT)' : '(none)'}`);
    // 1) seg as-is (with any own hash)
    const a = await g(rawSeg0, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    console.log(`  T1 seg0 as-playlisted → ${a.status} ct=${a.ctype} len=${a.len} b16=${b16(a.body)}`);
    // 2) seg + parent index hash appended
    const withH = new URL(rawSeg0); if (hash) withH.searchParams.set('hash', hash);
    const b = await g(withH.toString(), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    console.log(`  T2 seg0 + index-hash → ${b.status} ct=${b.ctype} len=${b.len} b16=${b16(b.body)}`);
    // 3) the progressive MP4 with hash
    const mp4 = new URL(rawSeg0); const p = mp4.pathname.replace(/\/seg-[^/]+$/, '');
    const m1 = await g(mp4.origin + p + (hash ? '?hash=' + encodeURIComponent(hash) : ''), { headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-1023' } });
    console.log(`  T3 MP4${hash ? '+hash' : ''} Range → ${m1.status} ct=${m1.ctype} len=${m1.len} b16=${b16(m1.body, 12)}`);
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });