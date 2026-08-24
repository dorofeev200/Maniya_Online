// RELEASE-PLAYBACK-GAP-001: production verification (после деплоя 7013097).
// BASE=https://plugin.maniya-kvn.online  TOKEN=/tmp/prod_token.txt
// Проверка §8: HDVB × 3 full chain; Kodik AMS реальный title; smoke остальных.
import { readFile } from 'node:fs/promises';

const BASE = 'https://plugin.maniya-kvn.online';
let TOKEN = process.env.FPG_TOKEN || '';
if (!TOKEN) { console.log('NO TOKEN'); process.exit(1); }

const films = {
  hdvb: 'Дэдпул и Росомаха|Deadpool & Wolverine|2024|533535|tt6263850',
  rutubemovie: 'Интерстеллар|Interstellar|2014|157336|tt0816692',
  vkmovie: 'Интерстеллар|Interstellar|2014|157336|tt0816692',
  alloha: 'Интерстеллар|Interstellar|2014|157336|tt0816692',
  veoveo: 'Интерстеллар|Interstellar|2014|157336|tt0816692',
  kinopub: 'Интерстеллар|Interstellar|2014|157336|tt0816692',
  collaps: 'Интерстеллар|Interstellar|2014|157336|tt0816692',
  filmix: 'Дэдпул и Росомаха|Deadpool & Wolverine|2024|533535|tt6263850',
  kodik: 'Паразиты|Parasite|2019|496243|tt6751668', // kp id 496243 (tmdb)
  'skaz-kinopub': 'Интерстеллар|Interstellar|2014|157336|tt0816692'
};

async function getJSON(url, timeout = 30000) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'prod-verify' }, signal: AbortSignal.timeout(timeout) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, ct: res.headers.get('content-type') || '', json, text };
  } catch (e) { return { status: 'ERR', ct: '', json: null, text: String(e).slice(0, 60) }; }
}
async function plainFetch(url, timeout = 15000) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'prod-verify' }, signal: AbortSignal.timeout(timeout) });
    const ct = res.headers.get('content-type') || '';
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, ct, bytes };
  } catch (e) { return { status: 'ERR', err: String(e).slice(0, 45), bytes: Buffer.alloc(0) }; }
}
async function rangeFetch(url, timeout = 15000) {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1023', 'User-Agent': 'prod-verify' }, signal: AbortSignal.timeout(timeout) });
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, ct: res.headers.get('content-type') || '', bytes };
  } catch (e) { return { status: 'ERR', err: String(e).slice(0, 45), bytes: Buffer.alloc(0) }; }
}
function firstUri(t) { const m = /#EXT-X-STREAM-INF[^\n]*\n[ \t]*(\S+)/.exec(t || ''); return m ? m[1] : null; }
function firstSegment(t) {
  const l = String(t || '').split(/\r?\n/);
  for (let i = 0; i < l.length; i++) if (/^#EXTINF/.test(l[i].trim()) && l[i + 1] && !l[i + 1].trim().startsWith('#')) return l[i + 1].trim();
  return null;
}
const isJson = (ct, b) => ct.includes('application/json') || /^\s*[\[{]/.test(b.slice(0, 100).toString('utf8'));
const isHtml = (ct, b) => ct.includes('text/html') || /^\s*</.test(b.slice(0, 100).toString('utf8'));

function chainMedia(r, url, label) {
  if (r.status === 'ERR') return `${label}=ERR(${r.err})`;
  if ([403, 404, 502, 503].includes(r.status)) return `${label}=${r.status}`;
  if (isJson(r.ct, r.bytes)) return `${label}=JSON(${r.bytes.length}B)`;
  const head = r.bytes.slice(0, 24).toString('latin1');
  if (r.bytes.length >= 7 && /^#EXTM3U|^#EXTINF/.test(head)) return null; // m3u8 любой ct
  if (r.bytes.length >= 16 && /^<\?xml|<MPD/i.test(head)) return null; // DASH
  if (/video\/(mp4|webm|mkv)|application\/octet-stream/i.test(r.ct) || /^\s*(ftyp|moov|mdat)/.test(head)) {
    return `${label}=MP4 ${r.status}/${r.ct.split(';')[0]} ${r.bytes.length}B`;
  }
  if (isHtml(r.ct, r.bytes)) return `${label}=HTML(${r.bytes.length}B)`;
  if (/mpegurl|dash|xml|text\/plain/.test(r.ct) || /m3u8|mpd|\.ts\b/i.test(url)) return null;
  if (r.status !== 200 && r.status !== 206) return `${label}=${r.status}`;
  if (r.bytes[0] === 0x47) return `${label}=TS ${r.status} ${r.bytes.length}B(sig47)`;
  return `${label}=${r.status}/${r.ct.split(';')[0]} ${r.bytes.length}B`;
}

async function playChain(url) {
  let m = await plainFetch(url);
  if (m.status === 'ERR') {
    const r = await rangeFetch(url);
    if (r.status === 206 && (r.bytes[0] === 0x47 || /^\s*(ftyp|moov|mdat)/.test(r.bytes.slice(0, 24).toString('latin1')))) {
      return `MP4-RANGE 206 ${r.ct.split(';')[0]} ${r.bytes.length}B(sig)`;
    }
  }
  const mS = chainMedia(m, url, 'master');
  if (mS) return mS;
  const text = m.bytes.toString('utf8');
  const mpd = /dash|xml/.test(m.ct) || /<MPD/i.test(text);
  if (mpd) return `master=DASH ${m.bytes.length}B`;
  const varUri = firstUri(text);
  if (!varUri) {
    const seg = firstSegment(text);
    if (!seg) return `master=m3u8(без variant/сегментов) ${m.bytes.length}B`;
    const s = await rangeFetch(new URL(seg, m.url).toString());
    return chainMedia(s, seg, 'seg') || `seg=${s.status}/${s.ct.split(';')[0]} ${s.bytes.length}B(sig47✓)`;
  }
  const v = await plainFetch(new URL(varUri, m.url).toString());
  const vS = chainMedia(v, varUri, 'variant');
  if (vS) return vS;
  const segUri = firstSegment(v.bytes.toString('utf8'));
  if (!segUri) return `variant=m3u8(без сегментов) ${v.bytes.length}B`;
  const s = await rangeFetch(new URL(segUri, v.url).toString());
  return chainMedia(s, segUri, 'seg') || `seg=${s.status}/${s.ct.split(';')[0]} ${s.bytes.length}B(sig47✓)`;
}

const summary = [];
for (const [provider, spec] of Object.entries(films)) {
  const [title, ot, year, id, imdb] = spec.split('|');
  const q = new URLSearchParams({ token: TOKEN, provider, source: 'tmdb', title, original_title: ot, year, serial: '0', id, imdb_id: imdb });
  const v = await getJSON(`${BASE}/api/lampa/videos?${q}`, 45000);
  const items = v.json?.items || [];
  const pe = v.json?.provider_error ? ` pe=${v.json.provider_error.code}` : '';
  if (v.status !== 200) { summary.push(`${provider}: /videos ${v.status}${pe}`); console.log(`${provider}: HTTP ${v.status}${pe}`); continue; }
  if (!items.length) { summary.push(`${provider}: items=0${pe}`); console.log(`${provider}: items=0${pe}`); continue; }
  let line = '';
  const it = items[0];
  const m = (it.method || 'play');
  const titleStr = String(it.title || '').slice(0, 40);
  if (m === 'call') {
    const resolved = await getJSON(`${it.url.includes('?') ? it.url + '&' : it.url + '?'}token=${TOKEN}`);
    if (resolved.status === 404) line = 'A:resolve404';
    else if (!resolved.json?.url) line = `A:resolve-noURL(${resolved.status})`;
    else line = `resolve→ ${await playChain(String(resolved.json.url).split(/\s+or\s+/i)[0])}`;
  } else if (!it.url) {
    line = 'A:play-noURL';
  } else {
    line = await playChain(it.url);
  }
  console.log(`${provider}: items=${items.length} [0] ${m} "${titleStr}" → ${line}${pe}`);
  summary.push(`${provider}: ${items.length} items | ${line}${pe}`);
}

// Deep re-probe: filmix/kodik item (Range 35s, прямой upstream, URL формы)
{ const deep = await (async () => {
    const out = [];
    for (const provider of ['filmix', 'kodik']) {
      const spec = films[provider];
      const [title, ot, year, id, imdb] = spec.split('|');
      const q = new URLSearchParams({ token: TOKEN, provider, source: 'tmdb', title, original_title: ot, year, serial: '0', id, imdb_id: imdb });
      const v = await getJSON(`${BASE}/api/lampa/videos?${q}`, 60000);
      const it = (v.json?.items || [])[0];
      if (!it?.url) { out.push(`${provider}: no item url`); continue; }
      out.push(`${provider}: item[0] url=${it.url.slice(0, 150)}`);
      const rg = await rangeFetch(it.url, 35000);
      out.push(`${provider}: proxy Range=${rg.status}/${rg.ct} ${rg.bytes.length}B${rg.bytes[0] === 0x47 ? ' sig47' : ''}${rg.status === 'ERR' ? '(' + rg.err + ')' : ''}`);
      const target = (new URL(it.url).searchParams.get('url') || '');
      if (target) {
        const up = await rangeFetch(target, 35000);
        out.push(`${provider}: upstream Range=${up.status}/${up.ct} ${up.bytes.length}B${up.bytes[0] === 0x47 ? ' sig47' : ''}${up.status === 'ERR' ? '(' + up.err + ')' : ''}  target=${target.slice(0, 100)}`);
      }
    }
    return out.join('\n');
  })();
  console.log('\n--- filmix/kodik deep ---'); console.log(deep);
}

// TMDB relay smoke (+ probe headers)
console.log('\n--- TMDB relay ---');
const hdrs = { 'User-Agent': 'Lampa/1.0', Origin: 'http://lampa.mx', Referer: 'http://lampa.mx/' };
for (const [name, u] of [
  ['img', `${BASE}/api/lampa/tmdb/img/p/w92/wwemzKWzjKYJFfCeiB57q3r4Bcm.jpg`],
  ['img-https', `https://image.tmdb.org/t/p/w92/wwemzKWzjKYJFfCeiB57q3r4Bcm.jpg`],
  ['api', `${BASE}/api/lampa/tmdb/api/3/configuration?api_key=INVALIDKEY4TEST`]
]) {
  try {
    const res = await fetch(u, { headers: hdrs, signal: AbortSignal.timeout(20000) });
    console.log(`relay ${name}: ${res.status} ${res.headers.get('content-type')}`);
  } catch (e) { console.log(`relay ${name}: ERR ${String(e).slice(0, 40)}`); }
}

console.log('\n====== PROD-VERIFY RESULT ======');
for (const s of summary) console.log(s);
console.log('DONE');