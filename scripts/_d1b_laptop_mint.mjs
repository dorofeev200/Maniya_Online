// D1B read-only: mint SKAZ lite/lordfilm video.m3u8 from LAPTOP (residential, ~device).
// Then fetch the resulting primary URL from the laptop. Mirrors the user-captured device flow.
// NEVER prints full URLs; prints host/shape/status only.
const BASE = 'http://online5.skaz.tv/lite/lordfilm/video.m3u8';
const Q = 'vkId=15566040291925&title=%D0%9C%D1%8F%D1%82%D0%B5%D0%B6&account_email=dorofeevigor20%40gmail.com&uid=wnoralpp&nws_id=ivplxwmxtmmyee1roiizjjru5c7flset';
const URL = `${BASE}?${Q}`;
const ORIGIN_HDRS = { 'Origin': 'http://lampa.mx', 'Referer': 'http://lampa.mx/' };
const variants = [
  ['lap_lampa', { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Lampa) AppleWebKit/537.36 Lampa/0.16.2', ...ORIGIN_HDRS }],
  ['lap_bare', { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36' }],
];

async function get(url, headers = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    return { status: r.status, ms: Date.now() - t0, bytes: text.length, text, ct: String(r.headers.get('content-type') || '').split(';')[0] };
  } catch (e) { return { err: String(e.message || e).slice(0, 120), ms: Date.now() - t0 }; }
}

function shapeOf(j) {
  const u = String(j.url || '');
  const primary = u.split(/\s+or\s+/i)[0].trim();
  let host = '', shape = 'none';
  try { host = new URL(primary).host; } catch {}
  shape = primary.includes('/proxy') ? 'skaz.proxy' : primary.includes('vkvideo') ? 'vkvideo' : (u ? 'other' : 'none');
  return { primary, host, shape };
}

for (const [name, h] of variants) {
  const m = await get(URL, h);
  if (m.err) { console.log(`${name}: mint ERR ${m.err}`); continue; }
  let j = {};
  try { j = JSON.parse(m.text); } catch {}
  const { primary, host, shape } = shapeOf(j);
  console.log(`${name}: mint HTTP ${m.status} ${m.ms}ms bytes=${m.bytes} host=${host} shape=${shape}`);
  if (primary) {
    const p = await get(primary, { 'Accept': 'application/vnd.apple.mpegurl,*/*', ...ORIGIN_HDRS });
    if (p.err) { console.log(`   fetch-primary-from-laptop: ERR ${p.err}`); }
    else console.log(`   fetch-primary-from-laptop: HTTP ${p.status} ${p.ms}ms bytes=${p.bytes} ct=${p.ct} isHLS=${/#EXTM3U|#EXT-X-/.test(p.text)}`);
  }
}

// Optional: VPS-minted tokens already copied locally (control, cross-IP expectation).
for (const f of ['scripts/_d1b_vps_lampa.json', 'scripts/_d1b_vps_xff.json', 'scripts/_d1b_vps_bare.json']) {
  try {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(f, 'utf8');
    const j = JSON.parse(raw);
    const { primary, host, shape } = shapeOf(j);
    if (!primary) { console.log(`${f}: shape=${shape} (no url to fetch)`); continue; }
    const p = await get(primary, { 'Accept': 'application/vnd.apple.mpegurl,*/*', ...ORIGIN_HDRS });
    console.log(`${f}: VPS-minted host=${host} shape=${shape} fetch-from-laptop: HTTP ${p.status} ${p.ms}ms ct=${p.ct}`);
  } catch (e) { /* file missing = skipped */ }
}
console.log('DONE');