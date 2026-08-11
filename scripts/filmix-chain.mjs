// Filmix + CDNvideo playback chain test (runs ON VPS, targets prod)
// 1) /videos?provider=filmix -> first play item -> master -> variant -> init -> segment
// 2) Filmix: 10 sequential segments (status/size/TTFB/download-ms) — buffering check
// 3) cdnvideohub: /videos -> first item url -> chain
import { readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3000';
const users = JSON.parse(readFileSync('/opt/maniya-online/server/data/users.json', 'utf8'));
const arr = Array.isArray(users) ? users : (users.users || []);
const token = (arr.find((x) => x && x.active && x.token) || arr[0])?.token || '';

const SPIDER = {
  id: '634649', tmdb_id: '634649', imdb_id: 'tt10872600', kinopoisk_id: '1309570',
  title: 'Человек-паук: Нет пути домой', original_title: 'Spider-Man: No Way Home',
  serial: '0', year: '2021', source: 'tmdb'
};
const M = { 'Accept': 'application/vnd.apple.mpegurl,*/*', 'User-Agent': 'Mozilla/5.0 Chrome/126' };
const UA = 'Mozilla/5.0 Chrome/126';

async function get(url, headers = {}, readBody = true, timeoutMs = 30000) {
  const t0 = Date.now();
  let r;
  try {
    r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': UA, ...headers } });
  } catch (e) { return { err: e.message, ms: Date.now() - t0, status: 0 }; }
  const ms = Date.now() - t0;
  const ct = String(r.headers.get('content-type') || '').split(';')[0];
  if (!readBody) { await r.body?.cancel?.().catch?.(() => {}); return { ms, status: r.status, ct }; }
  const buf = Buffer.from(await r.arrayBuffer().catch(() => new Uint8Array(0)));
  return { ms, status: r.status, ct, bytes: buf.length, text: buf.toString('utf8') };
}
function resolveUrl(ref, baseUrl) {
  try { return ref == null ? null : new URL(String(ref), baseUrl).toString(); } catch { return null; }
}
function pickVariant(masterText, masterUrl) {
  const lines = String(masterText || '').split(/\r?\n/);
  const variants = []; let block = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) { if (block.length) variants.push([...block]); block = []; continue; }
    block.push(t);
    if (!t.startsWith('#')) { variants.push([...block]); block = []; }
  }
  if (block.length) variants.push([...block]);
  let picked = variants[0] || null;
  for (const v of variants) if (/#EXT-X-STREAM-INF[^\n]*RESOLUTION=1920x1080/i.test(v.join('\n'))) { picked = v; break; }
  if (!picked) return null;
  const urlLine = picked.filter((l) => !l.startsWith('#')).pop() || '';
  return { url: resolveUrl(urlLine, masterUrl), attr: picked.find((l) => l.startsWith('#EXT-X-STREAM-INF')) || '' };
}

async function firstItem(provider) {
  const q = new URLSearchParams({ token, provider, ...SPIDER });
  const r = await get(`${BASE}/api/lampa/videos?${q}`);
  if (r.status !== 200) return { err: `HTTP ${r.status}` };
  const items = (JSON.parse(r.text || '{}').items || []);
  return { item: items[0] || null, count: items.length, status: r.status };
}

async function playChain(provider, label) {
  const { item, count, status, err } = await firstItem(provider);
  if (err || !item) { console.log(`${label}: /videos ${err || '0 items'}`); return; }
  const isCall = item.method === 'call';
  let url = item.url;
  let descr = item;
  if (isCall) {
    const rd = await get(url.replace(/^https:\/\/plugin\.maniya-kvn\.online/, BASE));
    try { descr = JSON.parse(rd.text || '{}'); } catch {}
    if (rd.status !== 200 || descr.method !== 'play' || !descr.url) {
      console.log(`${label}: lazy FAIL HTTP ${rd.status} method=${descr?.method} url=${Boolean(descr?.url)}`);
      return;
    }
    url = descr.url;
  }
  const qm = descr.quality && typeof descr.quality === 'object' ? Object.keys(descr.quality).join(',') : (descr.quality || '-');
  console.log(`${label}: items=${count} method=${item.method} voice="${item.voice_name || '-'}" q=[${qm}]`);
  const primary = String(url).split(/\s+or\s+/i)[0].trim();
  const m = await get(primary, M);
  console.log(`  master: HTTP ${m.status} ${m.ms}ms ct=${m.ct} ${m.err ? 'ERR=' + m.err : ''}`);
  if (m.status !== 200) return;
  if (!/#EXT-X-STREAM-INF/i.test(m.text || '')) {
    const seg = (m.text || '').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).pop();
    if (seg) {
      const s = await get(resolveUrl(seg, primary), { Range: 'bytes=0-1048575' });
      console.log(`  segment(low): HTTP ${s.status} ${s.ms}ms ct=${s.ct}`);
    }
    return;
  }
  const v = pickVariant(m.text, primary);
  if (!v?.url) { console.log('  variant: не найден'); return; }
  const vr = await get(v.url, M);
  console.log(`  variant: HTTP ${vr.status} ${vr.ms}ms ct=${vr.ct} [${(v.attr || '').slice(0, 60)}]`);
  if (vr.status !== 200 || !vr.text) return;
  const xmap = (vr.text.match(/#EXT-X-MAP:[^\n]*URI="([^"]+)"/) || [])[1] || null;
  if (xmap) {
    const ir = await get(resolveUrl(xmap, v.url), { Range: 'bytes=0-1048575' });
    console.log(`  init: HTTP ${ir.status} ${ir.ms}ms ct=${ir.ct}`);
  }
  const segLines = vr.text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const firstSeg = segLines[0];
  if (!firstSeg) { console.log('  segment: нет сегментов в варианте'); return; }
  const s = await get(resolveUrl(firstSeg, v.url), { Range: 'bytes=0-1048575' });
  console.log(`  segment[0]: HTTP ${s.status} ${s.ms}ms ct=${s.ct} bytes=${s.bytes}`);

  // 10 sequential segments (only for filmix)
  if (provider === 'filmix') {
    console.log('  --- 10 sequential segments ---');
    let ok = 0, fail = 0;
    for (let i = 0; i < 10 && i < segLines.length; i++) {
      const su = resolveUrl(segLines[i], v.url);
      if (!su) continue;
      const t0 = Date.now();
      const r = await get(su, { Range: 'bytes=0-1048575' }, true, 20000);
      const ms = Date.now() - t0;
      const s200 = r.status === 206 || r.status === 200;
      if (s200) ok++; else fail++;
      console.log(`  seg[${i}]: HTTP ${r.status} ${ms}ms ${r.bytes}B ${r.err ? 'ERR=' + r.err.slice(0, 60) : ''}`);
      if (fail > 3) { console.log('  СТОП: слишком много ошибок'); break; }
    }
    console.log(`  filmix segments: ok=${ok} fail=${fail} (${segLines.length} всего)`);
  }
}

console.log('=== FILMIX CHAIN ===');
await playChain('filmix', 'filmix');
console.log('\n=== CDNVIDEOHUB CHAIN ===');
await playChain('cdnvideohub', 'cdnvideohub');
process.exit(0);
