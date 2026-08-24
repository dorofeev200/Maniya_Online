// FINAL-PLAYBACK-GAP-001: матрица источников — items>0 → playback для реальных фильмов.
// Классификация: A=resolve не даёт URL, B=proxy блокирует, C=master не открывается,
// D=variant плохой, E=segment плохой, F=клиент не сможет проиграть (JSON/HTML/0 байт).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:3999';
const TOKEN = JSON.parse(await readFile(path.join(__dirname, '..', '.fpg-shadow', 'users.json'), 'utf8'))[0].token;

const films = [
  { title: 'Матрица', original_title: 'The Matrix', year: 1999, id: '603', imdb: 'tt0133093' },
  { title: 'Интерстеллар', original_title: 'Interstellar', year: 2014, id: '157336', imdb: 'tt0816692' },
  { title: 'Аватар', original_title: 'Avatar', year: 2009, id: '19995', imdb: 'tt0499549' },
  { title: 'Дюна: Часть вторая', original_title: 'Dune: Part Two', year: 2024, id: '693134', imdb: 'tt15239678' }
];
const providers = ['filmix', 'rezka', 'cdnvideohub', 'kinotochka'];

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'fpg-matrix' } });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, ct: res.headers.get('content-type') || '', json, text, httpStatus: res.status };
}

async function plainFetch(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'fpg-matrix' } });
    const ct = res.headers.get('content-type') || '';
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, ct, bytes, ok: res.ok };
  } catch (e) { return { status: 'ERR', err: String(e).slice(0, 70), bytes: Buffer.alloc(0) }; }
}
async function rangeFetch(url) {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1023', 'User-Agent': 'fpg-matrix' } });
    const ct = res.headers.get('content-type') || '';
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, ct, bytes };
  } catch (e) { return { status: 'ERR', err: String(e).slice(0, 70), bytes: Buffer.alloc(0) }; }
}

function firstUri(t) { const m = /#EXT-X-STREAM-INF[^\n]*\n[ \t]*(\S+)/.exec(t || ''); return m ? m[1] : null; }
function firstSegment(t) {
  const l = String(t || '').split(/\r?\n/);
  for (let i = 0; i < l.length; i++) if (/^#EXTINF/.test(l[i].trim()) && l[i + 1] && !l[i + 1].trim().startsWith('#')) return l[i + 1].trim();
  return null;
}
function isJsonLike(ct, bytes) {
  return (ct.includes('application/json') || /^\s*[\[{]/.test(bytes.slice(0, 64).toString('utf8')));
}
function isHtmlLike(ct, bytes) {
  return ct.includes('text/html') || /^\s*</.test(bytes.slice(0, 64).toString('utf8'));
}
const tsSig = (b) => b.length >= 4 && b[0] === 0x47;

// Проверка одного media-URL (манифест → 200, но посмотрим тип/байты; сегмент → 206+MP2T).
async function chainMedia(url, isSegment) {
  const r = isSegment ? await rangeFetch(url) : await plainFetch(url);
  if (r.status === 'ERR') return `ERR:${r.err}`;
  if (r.status === 403) return 'B:403 (proxy/SSRF или upstream блок)';
  if (r.status === 502) return 'B/C:502 (upstream или прокси)';
  if (r.status !== 200 && r.status !== 206) return `${r.status}`;
  const kind = isSegment ? 'seg' : 'manif';
  if (isJsonLike(r.ct, r.bytes)) return `${kind}:JSON(${r.bytes.length}B)`;   // F: не медиа
  if (isHtmlLike(r.ct, r.bytes)) return `${kind}:HTML(${r.bytes.length}B)`;    // F: error page
  if (isSegment) {
    if (r.ct.includes('mp2t') && r.status === 206 && tsSig(r.bytes)) return 'E2:seg=206/MP2T(sig47)✓';
    if (r.status === 206 && r.bytes.length) return `E?:seg=206/${r.ct.split(';')[0]} ${r.bytes.length}B`;
    return `E?:seg=${r.status}/${r.ct.split(';')[0]} ${r.bytes.length}B`;
  }
  return `${r.status}/${r.ct.split(';')[0]} ${r.bytes.length}B`;
}

// Полная цепочка: item url (может быть прокси) → master → variant → segment.
async function playChain(url) {
  const m = await plainFetch(url);
  const what = (r, label) => {
    if (r.status === 'ERR') return `${label}=ERR:${r.err}`;
    if (isJsonLike(r.ct, r.bytes)) return `${label}=JSON(${r.bytes.length}B,status${r.status})`;
    if (isHtmlLike(r.ct, r.bytes)) return `${label}=HTML(${r.bytes.length}B,status${r.status})`;
    if (r.status !== 200) return `${label}=${r.status}/${r.ct.split(';')[0]}`;
    if (!/m3u8|mpegurl|dash|mpd/i.test(r.ct) && !/\.(m3u8|mpd)/i.test(url)) {
      // прямой медиа (mp4/mp2t), не манифест
      if (/mp4|mp2t|mpeg/i.test(r.ct)) {
        const rg = r.bytes.length ? 'range?' : '';
        return `${label}=DIRECT-${r.ct.split(';')[0]} ${r.bytes.length}B${rg}`;
      }
      return `${label}=${r.status}/${r.ct.split(';')[0]} ${r.bytes.length}B`;
    }
    return null; // манифест — продолжаем
  };
  const mS = what(m, 'master');
  if (mS) return mS;
  const text = m.bytes.toString('utf8');
  if (/\.mpd/i.test(url)) return `master=DASH(mpd) ${m.bytes.length}B — без перепроверки вариаций`;
  const varUri = firstUri(text);
  if (!varUri) return `master=m3u8 без variant URI (${m.bytes.length}B)`;
  const vUrl = new URL(varUri, m.url).toString(); // может быть proxied (абс.) или относительный
  const v = await plainFetch(vUrl);
  const vS = what(v, 'variant');
  if (vS) return vS;
  const segUri = firstSegment(v.bytes.toString('utf8'));
  if (!segUri) return `variant=m3u8 без сегментов (${v.bytes.length}B)`;
  const sUrl = new URL(segUri, vUrl).toString();
  const s = await rangeFetch(sUrl);
  const sigOk = tsSig(s.bytes);
  return `master=200✓ variant=200✓ seg=${s.status}/${s.ct.split(';')[0]} ${s.bytes.length}B${sigOk ? ' (sig47✓)' : (s.status === 206 ? ' (NOT-TS!)' : '')}`;
}

for (const film of films) {
  console.log(`\n########## ${film.title} (${film.year}) ##########`);
  for (const provider of providers) {
    const q = new URLSearchParams({
      token: TOKEN, provider, source: 'tmdb', title: film.title,
      original_title: film.original_title, year: String(film.year), serial: '0',
      id: film.id, imdb_id: film.imdb
    });
    let v;
    try { v = await getJSON(`${BASE}/api/lampa/videos?${q}`); }
    catch (e) { console.log(`${provider}: REQ-ERR ${String(e).slice(0, 60)}`); continue; }
    if (v.status !== 200) { console.log(`${provider}: /videos ${v.status} ${v.ct} (нет payload — не эта категория)`); continue; }
    const items = v.json?.items || [];
    if (!items.length) { console.log(`${provider}: items=0 — вне скоупа (выяснение CONTENT-loss отдельно)`); continue; }
    console.log(`\n-- ${provider}: items=${items.length} (${v.json?.provider_error ? 'provider_error=' + JSON.stringify(v.json.provider_error) : ''})`);
    for (const [i, item] of items.slice(0, 6).entries()) {
      const method = item.method || 'play';
      const url = item.url || '';
      let line;
      if (method === 'call') {
        // ленивый резолв через /api/lampa/video
        const resolved = await getJSON(`${url.includes('?') ? url + '&' : url + '?'}token=${TOKEN}`);
        if (resolved.status === 404) { line = 'A:resolve 404 video_not_found'; }
        else if (!resolved.json?.url) { line = `A:resolve no URL (${resolved.status}/${JSON.stringify(resolved.json).slice(0, 90)})`; }
        else {
          const first = String(resolved.json.url).split(/\s+or\s+|\s*%20or%20\s*/gi)[0];
          line = `call→resolve OK → ${await playChain(first)}`;
        }
        console.log(`  [${i}] ${method} "${String(item.title).slice(0, 50)}" → ${line}`);
      } else {
        const type = url.includes('/api/lampa/proxy') ? 'proxy' : (url.startsWith('http') ? 'raw' : 'none');
        if (!url) { line = 'play:URL пустой (A)'; }
        else if (type === 'none') { line = 'play:none-url'; }
        else { line = await playChain(url); }
        console.log(`  [${i}] ${method} "${String(item.title).slice(0, 50)}" ${type} → ${line}`);
      }
    }
  }
}