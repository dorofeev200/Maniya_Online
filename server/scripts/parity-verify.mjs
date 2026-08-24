// Parity-009 verification against TEMP server (127.0.0.1:3211) — current local code.
// Run ON VPS: cd /opt/maniya-parity/server && node scripts/parity-verify.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:3211';
const TOKEN = process.env.TOKEN || 'mo-6d7c07e49e511b105726d6de1c0fdce4';

const TITLES = {
  Matrix: { id: '603', imdb_id: 'tt0133093', tmdb_id: '603', kinopoisk_id: '301', title: 'Матрица', original_title: 'The Matrix', year: '1999' },
  Inception: { id: '27205', imdb_id: 'tt1375666', tmdb_id: '27205', kinopoisk_id: '300', title: 'Inception', original_title: 'Inception', year: '2010' },
  Interstellar: { id: '157336', imdb_id: 'tt0816692', tmdb_id: '157336', kinopoisk_id: '437410', title: 'Интерстеллар', original_title: 'Interstellar', year: '2014' }
};

function movieQuery(t, mode) {
  const q = new URLSearchParams({ title: t.title, original_title: t.original_title, serial: '0', year: t.year, source: 'tmdb' });
  if (mode === 'imdb') {            // карточка с imdb-идентичностью (ломалась до PARITY-009)
    q.set('id', t.imdb_id);
    q.set('imdb_id', t.imdb_id);
    q.set('kinopoisk_id', t.kinopoisk_id);
  } else if (mode === 'kp') {       // KP-синхронизированный Lampa
    q.set('id', t.kinopoisk_id);
    q.set('kinopoisk_id', t.kinopoisk_id);
    q.set('imdb_id', t.imdb_id);
    q.set('tmdb_id', t.tmdb_id);
  } else {                          // TMDB-каталог Lampa (по умолчанию)
    q.set('id', t.id);
    q.set('imdb_id', t.imdb_id);
    q.set('tmdb_id', t.tmdb_id);
    q.set('kinopoisk_id', t.kinopoisk_id);
  }
  return q.toString();
}

// Fetch a URL and classify: HLS manifest (direct), JSON (video/videos response), or raw.
async function sniff(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'follow' });
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    if (/mpegurl|m3u8/i.test(ct) || String(text).startsWith('#EXTM3U')) return { kind: 'hls' };
    try { return { kind: 'json', json: JSON.parse(text) }; } catch { return { kind: 'raw', sample: text.slice(0, 80) }; }
  } catch (e) { return { kind: 'err', msg: e.message }; }
}

async function checkPlayback(url) {
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-1023' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000)
    });
    const ct = res.headers.get('content-type') || '';
    const range = res.headers.get('content-range') || '';
    const final = res.url || '';
    if (res.body) {
      const r = res.body.getReader();
      await r.read().catch(() => {});
      await r.cancel().catch(() => {});
    }
    return { ok: res.status >= 200 && res.status < 400, label: `${res.status} ${ct.split(';')[0]} [${range}] ${final.slice(0, 55)}` };
  } catch (e) { return { ok: false, label: `ERR ${e.message}` }; }
}

// Playback URL from an item: '{method,url}' items may carry the url already or need /video.
async function playbackFromItem(provider, t, qs, item) {
  if (item.method === 'call') {
    const s = await sniff(`${BASE}/api/lampa/video?provider=${provider}&${qs}&voice=0&token=${TOKEN}`);
    if (s.kind === 'json' && s.json.url) return checkPlayback(s.json.url);
    return { ok: false, label: `CALL-RESOLVE ${s.kind === 'err' ? s.msg : (s.kind === 'raw' ? s.sample : 'no url')}` };
  }
  if (item.url) return checkPlayback(item.url);
  return { ok: false, label: `no url/method=${item.method}` };
}

const suite = [
  // [source, title, mode]
  ['skaz-zetflixdb', 'Matrix', 'imdb'],
  ['skaz-zetflixdb', 'Matrix', 'tmdb'],
  ['skaz-zagonka', 'Inception', 'imdb'],
  ['skaz-xvideocdnultra', 'Matrix', 'tmdb'],
  ['skaz-xvideocdnultra', 'Interstellar', 'kp'],
  ['skaz-geosaitebi', 'Matrix', 'tmdb'],
  ['skaz-geosaitebi', 'Inception', 'imdb'],
  ['skaz-kinoflix', 'Inception', 'tmdb'],
  ['skaz-kinoflix', 'Inception', 'imdb']
];

console.log(`Temp server: ${BASE}\n`);
const results = [];
for (const [provider, titleName, mode] of suite) {
  const t = TITLES[titleName];
  const qs = movieQuery(t, mode);
  const vurl = `${BASE}/api/lampa/videos?provider=${provider}&${qs}&token=${TOKEN}`;
  const t0 = Date.now();
  const res = await fetch(vurl, { signal: AbortSignal.timeout(45000) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { results.push([provider, titleName, mode, 'FAIL', `RAW ${text.slice(0, 80)}`, Date.now() - t0]); continue; }
  const items = (data.items || []).filter(i => i && (i.method === 'play' || i.method === 'call'));
  if (!items.length) { results.push([provider, titleName, mode, 'EMPTY', `methods=${(data.items || []).map(i => i && i.method).join(',')}`, Date.now() - t0]); continue; }
  const pb = await playbackFromItem(provider, t, qs, items[0]);
  results.push([provider, titleName, mode, pb.ok ? 'OK' : 'FAIL', `${items.length} items | ${pb.label}`, Date.now() - t0]);
  console.log(`${provider} :: ${titleName} [${mode}] -> ${results[results.length - 1][3]} ${Date.now() - t0}ms`);
  console.log(`    ${pb.label}`);
}

console.log('\n=== SUMMARY ===');
let pass = 0, fail = 0;
for (const r of results) {
  const ok = r[3] === 'OK';
  if (ok) pass += 1; else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${r[0]} :: ${r[1]} [${r[2]}] | ${r[4]}`);
}
console.log(`\nRESULT: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);