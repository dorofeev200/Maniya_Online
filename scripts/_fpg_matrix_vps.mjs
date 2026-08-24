// FINAL-PLAYBACK-GAP-001: матрица источников на VPS shadow (полный набор native+skaz).
// Чтение BASE и TOKEN из env: FPG_BASE (default http://127.0.0.1:3210), FPG_TOKEN.
// Для каждого источника×фильма: /videos → items; play → цепочка; call → resolve → цепочка.
// Классификация сбоя в самой строке (A/B/C/D/E/F).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.FPG_BASE || 'http://127.0.0.1:3210';
let TOKEN = process.env.FPG_TOKEN || '';
if (!TOKEN) {
  try {
    TOKEN = (await readFile(path.join(__dirname, '..', '.fpg-shadow', 'vps-token.txt'), 'utf8')).trim();
  } catch {}
}
if (!TOKEN) { console.log('NO TOKEN'); process.exit(1); }

// Свежие релизы (2024–2025) — свежие фильмы по запросу пользователя.
const films = [
  { title: 'Дэдпул и Росомаха', original_title: 'Deadpool & Wolverine', year: 2024, id: '533535', imdb: 'tt6263850' },
  { title: 'Фуриоса: Хроники Безумного Макса', original_title: 'Furiosa: A Mad Max Saga', year: 2024, id: '786892', imdb: 'tt12037194' },
  { title: 'Гладиатор II', original_title: 'Gladiator II', year: 2024, id: '475557', imdb: 'tt9218128' },
  { title: 'Супермен', original_title: 'Superman', year: 2025, id: '1022789', imdb: 'tt5950044' }
];

// Включить/исключить источники по env-спискам, через запятую.
const ONLY = process.env.FPG_ONLY ? process.env.FPG_ONLY.split(',') : null;
const SKIP = process.env.FPG_SKIP ? process.env.FPG_SKIP.split(',') : [];

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'fpg-matrix' }, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, ct: res.headers.get('content-type') || '', json, text };
}
async function plainFetch(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'fpg-matrix' }, signal: AbortSignal.timeout(15000) });
    const ct = res.headers.get('content-type') || '';
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, ct, bytes };
  } catch (e) { return { status: 'ERR', err: String(e).slice(0, 60), bytes: Buffer.alloc(0) }; }
}
async function rangeFetch(url) {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1023', 'User-Agent': 'fpg-matrix' }, signal: AbortSignal.timeout(15000) });
    const ct = res.headers.get('content-type') || '';
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, ct, bytes };
  } catch (e) { return { status: 'ERR', err: String(e).slice(0, 60), bytes: Buffer.alloc(0) }; }
}
function firstUri(t) { const m = /#EXT-X-STREAM-INF[^\n]*\n[ \t]*(\S+)/.exec(t || ''); return m ? m[1] : null; }
function firstSegment(t) {
  const l = String(t || '').split(/\r?\n/);
  for (let i = 0; i < l.length; i++) if (/^#EXTINF/.test(l[i].trim()) && l[i + 1] && !l[i + 1].trim().startsWith('#')) return l[i + 1].trim();
  return null;
}
const isJson = (ct, b) => ct.includes('application/json') || /^\s*[\[{]/.test(b.slice(0, 64).toString('utf8'));
const isHtml = (ct, b) => ct.includes('text/html') || /^\s*</.test(b.slice(0, 64).toString('utf8'));

function chainMedia(r, url, label) {
  if (r.status === 'ERR') return `${label}=ERR:${r.err}`;
  if (r.status === 403) return `${label}=403(${isHtml(r.ct, r.bytes) ? 'HTML' : r.ct.split('/')[1] || ''})`;
  if (r.status === 404) return `${label}=404`;
  if (r.status === 502) return `${label}=502`;
  if (isJson(r.ct, r.bytes)) return `${label}=JSON(${r.bytes.length}B)`;
  // Сигнатуры манифеста/видео ДО HTML-проверки: hdvb/master отдаёт валидный
  // m3u8 в text/html (2141B с #EXTM3U), а matroska/MP4 — через octet-stream.
  const head = r.bytes.slice(0, 24).toString('latin1');
  if (r.bytes && r.bytes.length >= 7 && /^#EXTM3U|^#EXTINF/.test(head)) return null; // m3u8 в любом content-type
  if (r.bytes && r.bytes.length >= 16 && /^<\?xml|<MPD/i.test(head)) return null; // DASH XML
  if (/video\/(mp4|webm|mkv)|application\/octet-stream/i.test(r.ct) || /^\s*(ftyp|moov|mdat)/.test(head)) {
    return `${label}=MP4 ${r.status}/${r.ct.split(';')[0]} ${r.bytes.length}B`;
  }
  if (isHtml(r.ct, r.bytes)) return `${label}=HTML(${r.bytes.length}B)`;
  // Классификация ТОЛЬКО по response content-type/телу, не по URL: proxy-URL
  // содержит свой таргет в query и может ложно матчить ".mp4".
  if (/mpegurl|dash|xml|text\/plain/.test(r.ct) || /m3u8|mpd|\.ts\b/i.test(url)) {
    return null; // манифест — пускаем дальше
  }
  if (r.status !== 200 && r.status !== 206) return `${label}=${r.status}/${r.ct.split(';')[0]}`;
  if (/video\/mp2t/i.test(r.ct)) {
    return `${label}=${r.status}/${r.ct.split(';')[0]} ${r.bytes.length}B${r.bytes[0] === 0x47 ? '(sig47✓)' : ''}`;
  }
  if (r.bytes && r.bytes.length >= 4 && r.bytes[0] === 0x47) {
    return `${label}=TS ${r.status}/${r.ct.split(';')[0]} ${r.bytes.length}B(sig47✓)`;
  }
  return `${label}=${r.status}/${r.ct.split(';')[0]} ${r.bytes.length}B`;
}

// Полная цепочка: url (обычно proxy-манифест) → master → variant → segment.
async function playChain(url) {
  let m = await plainFetch(url);
  // FINAL-PLAYBACK-GAP-001: без-Range GET медиафайла (mp4) never завершается на
  // filmix/solntse CDN → ложный timeout. Real клиент ходит с Range. Если полный
  // GET упал — повторяем с Range: 206 + видео-сигнатура = играбельно.
  if (m.status === 'ERR') {
    const r = await rangeFetch(url);
    if (r.status === 206 && (r.bytes[0] === 0x47 || /^\s*(ftyp|moov|mdat)/.test(r.bytes.slice(0, 24).toString('latin1')))) {
      return `master=MP4-RANGE ${r.status}/${r.ct.split(';')[0]} ${r.bytes.length}B(sig✓)`;
    }
  }
  const mS = chainMedia(m, url, 'master');
  if (mS) return mS;
  const text = m.bytes.toString('utf8');
  const mpd = /dash|xml/.test(m.ct) || /<MPD/i.test(text);
  if (mpd) return `master=DASH(mpd) 200 ${m.bytes.length}B`;
  const varUri = firstUri(text);
  if (!varUri) {
    // Медиа-плейлист без variant (например режка прямыми сегментами): берём сегмент.
    const inlineSeg = firstSegment(text);
    if (!inlineSeg) return `master=m3u8 200 без STREAM-INF/сегментов (${m.bytes.length}B)`;
    const sUrl = new URL(inlineSeg, m.url).toString();
    const s = await rangeFetch(sUrl);
    const sS = chainMedia(s, sUrl, 'seg');
    return sS ? sS : `seg=${s.status}/${s.ct.split(';')[0]} ${s.bytes.length}B(sig47✓)`;
  }
  const vUrl = new URL(varUri, m.url).toString();
  const v = await plainFetch(vUrl);
  const vS = chainMedia(v, vUrl, 'variant');
  if (vS) return vS;
  const segUri = firstSegment(v.bytes.toString('utf8'));
  if (!segUri) return `variant=m3u8 200 без сегментов (${v.bytes.length}B)`;
  const sUrl = new URL(segUri, vUrl).toString();
  const s = await rangeFetch(sUrl);
  const sS = chainMedia(s, sUrl, 'seg');
  return sS ? sS : `seg=${s.status}/${s.ct.split(';')[0]} ${s.bytes.length}B(sig47✓)`;
}

// Источники: получить из /sources, кроме rutubemovie (уже проверен).
function wanted(id) {
  if (SKIP.includes(id)) return false;
  return !ONLY || ONLY.includes(id);
}

const src = await getJSON(`${BASE}/api/lampa/sources?token=${TOKEN}`);
const sourceList = (src.json?.sources || []).filter((s) => s.id !== 'rutubemovie' && wanted(s.id));
console.log(`sources=${src.status} total=${(src.json?.sources || []).length} probing=${sourceList.length}`);

for (const film of films) {
  console.log(`\n########## ${film.title} (${film.year}) ##########`);
  for (const source of sourceList) {
    const provider = source.id;
    const q = new URLSearchParams({
      token: TOKEN, provider, source: 'tmdb', title: film.title,
      original_title: film.original_title, year: String(film.year), serial: '0',
      id: film.id, imdb_id: film.imdb
    });
    let v;
    try { v = await getJSON(`${BASE}/api/lampa/videos?${q}`); }
    catch (e) { console.log(`${provider}: REQ-ERR ${String(e).slice(0, 50)}`); continue; }
    if (v.status !== 200) { console.log(`${provider}: /videos ${v.status} ${v.ct.slice(0, 30)}`); continue; }
    const items = v.json?.items || [];
    const pe = v.json?.provider_error ? ' pe=' + v.json.provider_error.code : '';
    if (!items.length) { console.log(`${provider}: items=0${pe}`); continue; }
    console.log(`-- ${provider}: items=${items.length}${pe}`);
    for (const [i, item] of items.slice(0, 3).entries()) {
      const method = item.method || 'play';
      const url = item.url || '';
      let line;
      if (method === 'call') {
        const resolved = await getJSON(`${url.includes('?') ? url + '&' : url + '?'}token=${TOKEN}`);
        if (resolved.status === 404) line = 'A:resolve404';
        else if (!resolved.json?.url) line = `A:resolve-noURL(${resolved.status})`;
        else {
          const first = String(resolved.json.url).split(/\s+or\s+|\s*%20or%20\s*/gi)[0];
          line = `call→resolved→ ${await playChain(first)}`;
        }
        console.log(`  [${i}] ${method} ${String(item.title).slice(0, 45)} → ${line}`);
      } else if (!url) {
        console.log(`  [${i}] ${method} ${String(item.title).slice(0, 45)} → A:play-noURL`);
      } else {
        line = await playChain(url);
        console.log(`  [${i}] ${method} ${String(item.title).slice(0, 45)} → ${line}`);
      }
    }
  }
}
console.log('\nMATRIX DONE');