// SKAZ-MANIYA-004 §2-8: VERIFY-ON-VPS для rezka/filmix/kinotochka/collaps.
// Read-only диагностика против SHADOW-инстанса (port 3210, staging, НЕ prod).
// DEPLOY ЗАПРЕЩЁН — это только HTTP-проб клиентского пути (discovery→resolve→stream→playback).
// Без секретов в выводе: токен админ-тестовый, креды не логируются.
const BASE = 'http://95.85.241.121:3210';
const TOKEN = 'mo-admin-test-2026';

const TITLES = {
  // [title, original_title, year, id(tmdb), imdb_id, kinopoisk_id, serial]
  'rezka':      ['Дом дракона', 'House of the Dragon', '2022', '94997', 'tt11198330', '0', 1],
  'filmix':     ['Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 0],
  'kinotochka': ['Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682', 0],
  'collaps':    ['Паразиты', 'Parasite', '2019', '496243', 'tt6751668', '1023498', 0],
  'collaps-serial': ['Дом дракона', 'House of the Dragon', '2022', '94997', 'tt11198330', '0', 1],
};

async function getJSON(url, timeout = 40000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  } catch (e) { return { status: 'ERR', json: null, text: String(e).slice(0, 60) }; }
}
async function rangeFetch(url, timeout = 20000) {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(timeout) });
    const ct = r.headers.get('content-type') || '';
    const bytes = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ct, bytes };
  } catch (e) { return { status: 'ERR', ct: '', bytes: Buffer.alloc(0), err: String(e.message || e).slice(0, 50) }; }
}
async function fullFetch(url, timeout = 20000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    const ct = r.headers.get('content-type') || '';
    const bytes = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ct, bytes };
  } catch (e) { return { status: 'ERR', ct: '', bytes: Buffer.alloc(0), err: String(e.message || e).slice(0, 50) }; }
}
const RW = (u) => String(u || '').replace('http://127.0.0.1:3210', BASE);
function firstUri(t) { const m = /#EXT-X-STREAM-INF[^\n]*\n[ \t]*(\S+)/.exec(t || ''); return m ? m[1] : null; }
function firstSegment(t) {
  const l = String(t || '').split(/\r?\n/);
  for (let i = 0; i < l.length; i++) if (/^#EXTINF/.test(l[i].trim()) && l[i + 1] && !l[i + 1].trim().startsWith('#')) return l[i + 1].trim();
  return null;
}
const rwUrlSync = (u, base) => { try { return new URL(RW(String(u)), base).toString(); } catch { return RW(String(u)); } };
async function chain(url, label = 'master') {
  const retry = async (fn, n = 2) => { let r; for (let i = 0; i < n; i++) { r = await fn(); if (r.status !== 'ERR' && r.status !== 503 && r.status !== 502 && r.status !== 403) break; } return r; };
  let m = await retry(() => rangeFetch(url), 3);
  const mac = m.bytes.slice(0, 24).toString('latin1');
  const isM3u8 = /^#EXTM3U|^#EXTINF/.test(mac);
  if (m.status === 'ERR') return `${label}=ERR(${m.err})`;
  if (!isM3u8) {
    if (/video\/(mp4|webm|mkv)|octet-stream/i.test(m.ct) || /^(ftyp|moov|mdat)/.test(mac) || m.bytes[0] === 0x47) {
      return `${label}=MP4/TS-RANGE ${m.status}/${m.ct.split(';')[0]} ${m.bytes.length}B ${m.bytes[0] === 0x47 ? 'sig47✓' : (mac.startsWith('ftyp') || mac.startsWith('moov') ? 'ftyp✓' : '')}`;
    }
    if ([403, 404, 502, 503].includes(m.status)) return `${label}=${m.status}`;
    return `${label}=${m.status}/${m.ct.split(';')[0]} ${m.bytes.length}B «${mac.slice(0, 16)}»`;
  }
  if ([403, 404, 502, 503].includes(m.status)) return `${label}=${m.status}`;
  const text = RW(m.bytes.toString('utf8'));
  const v = firstUri(text);
  if (v) {
    const vv = await retry(() => fullFetch(rwUrlSync(v, url)), 3);
    if (vv.status === 'ERR') return `${label}=m3u8→variant ERR(${vv.err})`;
    const vs = vv.bytes.slice(0, 24).toString('latin1');
    if (/video\/(mp4|webm)|octet-stream/.test(vv.ct) || /^(ftyp|moov|mdat)/.test(vs)) return `${label}=m3u8→variant=MP4 ${vv.status}/${vv.ct.split(';')[0]} ${vv.bytes.length}B`;
    const seg = firstSegment(RW(vv.bytes.toString('utf8')));
    if (seg) {
      const so = await retry(() => rangeFetch(rwUrlSync(seg, rwUrlSync(v, url))), 3);
      const ss = so.bytes.slice(0, 24).toString('latin1');
      return `${label}=m3u8→variant ${vv.status}(${vv.bytes.length}B)→seg ${so.status} ${so.ct.split(';')[0]} ${so.bytes.length}B ${so.bytes[0] === 0x47 ? 'sig47✓' : (ss.startsWith('ftyp') ? 'mp4sig✓' : '')}`;
    }
    return `${label}=m3u8→variant ${vv.status} ${vv.bytes.length}B без-сегментов`;
  }
  const seg = firstSegment(text);
  if (seg) {
    let s = await retry(() => rangeFetch(rwUrlSync(seg, url)), 3);
    return `${label}=m3u8→seg ${s.status} ${s.ct.split(';')[0]} ${s.bytes.length}B ${s.bytes[0] === 0x47 ? 'sig47✓' : ''}${s.status === 'ERR' ? `(${s.err})` : ''}`;
  }
  return `${label}=m3u8(${m.bytes.length}B) без-variant`;
}

const summary = [];
for (const [key, [title, ot, year, id, imdb, kp, serial]] of Object.entries(TITLES)) {
  const provider = key === 'collaps-serial' ? 'collaps' : key;
  const q = new URLSearchParams({ token: TOKEN, provider, source: 'tmdb', title, original_title: ot, year, serial: String(serial), id, imdb_id: imdb, kinopoisk_id: kp });
  let v = null, items = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    v = await getJSON(`${BASE}/api/lampa/videos?${q}`, 50000);
    items = v.json?.items || [];
    if (items.length) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
  }
  const pe = v.json?.provider_error ? ` pe=${v.json.provider_error.code}` : '';
  const tag = `${key}(${provider})`;
  if (v.status !== 200) { console.log(`${tag}: HTTP ${v.status}${pe}`); summary.push(`${tag}: HTTP ${v.status}${pe}`); continue; }
  if (!items.length) { console.log(`${tag}: items=0${pe}`); summary.push(`${tag}: items=0${pe}`); continue; }
  const it = items[0];
  let line;
  if (it.method === 'call') {
    const rawUrl = RW(it.url);
    const rurl = rawUrl.startsWith('http') ? rawUrl + (rawUrl.includes('?') ? '&' : '?') + `token=${TOKEN}` : `${BASE}/api/lampa/video?provider=${provider}&voice=${encodeURIComponent(String(rawUrl || '0'))}&token=${TOKEN}`;
    const resolved = await getJSON(rurl);
    if (resolved.json?.provider_error) { line = `call→resolve provider_error=${resolved.json.provider_error.code}`; }
    else if (resolved.json?.url) { line = `call→resolve→ ${await chain(RW(String(resolved.json.url).split(/\s+or\s+/i)[0]), 'play')}`; }
    else if (resolved.status === 404 || resolved.status === 'ERR') { line = `call→resolve ${resolved.status} (${resolved.text.slice(0, 60)})`; }
    else { line = `call→resolve noURL ${resolved.status} ${resolved.text.slice(0, 80)}`; }
  } else if (it.method === 'play') {
    line = `play→ ${await chain(RW(it.url), 'play')}`;
  } else {
    line = `method=${it.method}`;
  }
  console.log(`${tag}: items=${items.length} [0] ${it.method} "${String(it.title).slice(0, 28)}" → ${line}${pe}`);
  summary.push(`${tag}: items=${items.length} ${line}${pe}`);
}

console.log('\n====== SUMMARY ======');
for (const s of summary) console.log(s);
console.log('DONE');
