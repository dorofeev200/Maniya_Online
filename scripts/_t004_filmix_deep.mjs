// SKAZ-MANIYA-004 §17: filmix 404 — точечно. Read-only диагностика против SHADOW (3210).
// Перебираем ВСЕ item'ы filmix для Дюна-2 и Интерстеллар, резолвим каждый play/call URL.
const BASE = 'http://95.85.241.121:3210';
const TOKEN = 'mo-admin-test-2026';

const CASES = {
  'dune2': ['Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 0],
  'interstellar': ['Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682', 0],
};

async function getJSON(url, timeout = 45000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  } catch (e) { return { status: 'ERR', json: null, text: String(e).slice(0, 60) }; }
}
async function rangeFetch(url, timeout = 15000) {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(timeout) });
    const ct = r.headers.get('content-type') || '';
    const bytes = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ct, bytes };
  } catch (e) { return { status: 'ERR', ct: '', bytes: Buffer.alloc(0), err: String(e.message || e).slice(0, 40) }; }
}
const RW = (u) => String(u || '').replace('http://127.0.0.1:3210', BASE);
async function probe(url) {
  const m = await rangeFetch(RW(url));
  if (m.status === 'ERR') return `ERR(${m.err})`;
  const mac = m.bytes.slice(0, 16).toString('latin1');
  if ([403, 404, 502, 503].includes(m.status)) return `${m.status}`;
  if (/video\/(mp4|webm)|octet-stream/.test(m.ct) || /^(ftyp|moov|mdat)/.test(mac) || m.bytes[0] === 0x47) {
    return `${m.status}/${m.ct.split(';')[0]} ${m.bytes.length}B ${m.bytes[0] === 0x47 ? 'sig47✓' : (mac.startsWith('ftyp') || mac.startsWith('moov') ? 'ftyp✓' : '')}`;
  }
  if (/^#EXTM3U|#EXTINF/.test(mac)) return `${m.status}/m3u8 ${m.bytes.length}B`;
  if (/^\s*[\[{]/.test(mac) || /application\/json/.test(m.ct)) return `${m.status}/JSON ${m.bytes.length}B`;
  return `${m.status}/${m.ct.split(';')[0]} ${m.bytes.length}B «${mac.slice(0, 12)}»`;
}

for (const [name, [title, ot, year, id, imdb, kp, serial]] of Object.entries(CASES)) {
  const q = new URLSearchParams({ token: TOKEN, provider: 'filmix', source: 'tmdb', title, original_title: ot, year, serial: String(serial), id, imdb_id: imdb, kinopoisk_id: kp });
  const v = await getJSON(`${BASE}/api/lampa/videos?${q}`, 50000);
  const items = v.json?.items || [];
  console.log(`\n===== filmix ${name}: HTTP ${v.status}, items=${items.length}${v.json?.provider_error ? ` pe=${v.json.provider_error.code}` : ''} =====`);
  items.forEach((it, i) => {
    const ql = it.quality ? JSON.stringify(it.quality) : '';
    console.log(`[${i}] ${it.method} q=${ql} title="${String(it.title).slice(0, 40)}" url=${String(it.url).slice(0, 70)}`);
  });
  // последовательные async-проб play-элементов
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.method !== 'play') continue;
    const r = await probe(it.url);
    console.log(`RESOLVE[$i=${i}] q=${JSON.stringify(it.quality)} "${String(it.title).slice(0, 34)}" → ${r}`);
  }
}
console.log('\nDONE');
