// FINAL-PLAYBACK-GAP-001: точечная live-проверка реальных кандидатов на VPS shadow.
// НЕ пересчитывает полную матрицу (это было сделано до обрыва). Проверяет:
//   A) RUmovie-2 (rutubemovie) — 5 фильмов: show→items→method→chain proxy/m3u8/master;
//   B) HDVB fresh (voice-массив в POST playlist): Дэдпул и Росомаха / Гладиатор II / Супермен;
//   C) filmix Range через прокси (известный F-кандидат: MP4 без Range → таймаут);
//   D) rhsprem card-строка.
// FPG_BASE / FPG_TOKEN / FPG_REWRITE из env. Запуск снаружи: FPG_REWRITE=1 — loopback
// 127.0.0.1:{port} в ответах shadow переписывается на публичный хост.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.FPG_BASE || 'http://127.0.0.1:3210';
let TOKEN = process.env.FPG_TOKEN || '';
if (!TOKEN) {
  try { TOKEN = (await readFile(path.join(__dirname, '..', '.fpg-shadow', 'vps-token.txt'), 'utf8')).trim(); } catch {}
}
let rewrite = (u) => u;
if (process.env.FPG_REWRITE) {
  const up = new URL(BASE);
  const from = `http://127.0.0.1:${up.port}`;
  const to = `http://${up.hostname}:${up.port}`;
  rewrite = (u) => String(u).replaceAll(from, to);
}

async function getJSON(url, timeout = 15000) {
  const res = await fetch(rewrite(url), { headers: { 'User-Agent': 'fpg-verify' }, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, ct: res.headers.get('content-type') || '', json, text };
}
async function plainFetch(url, timeout = 12000) {
  try {
    const res = await fetch(rewrite(url), { headers: { 'User-Agent': 'fpg-verify' }, signal: AbortSignal.timeout(timeout) });
    const ct = res.headers.get('content-type') || '';
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, ct, bytes };
  } catch (e) { return { status: 'ERR', err: String(e).slice(0, 50), bytes: Buffer.alloc(0) }; }
}
async function rangeFetch(url, timeout = 12000) {
  try {
    const res = await fetch(rewrite(url), { headers: { Range: 'bytes=0-1023', 'User-Agent': 'fpg-verify' }, signal: AbortSignal.timeout(timeout) });
    const ct = res.headers.get('content-type') || '';
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, ct, bytes };
  } catch (e) { return { status: 'ERR', err: String(e).slice(0, 50), bytes: Buffer.alloc(0) }; }
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
  if (r.status === 'ERR') return `ERR:${r.err}`;
  if (r.status === 403) return `${label}=403`;
  if (r.status === 404) return `${label}=404`;
  if (r.status === 502) return `${label}=502`;
  if (isJson(r.ct, r.bytes)) return `${label}=JSON(${r.bytes.length}B)`;
  const head = r.bytes.slice(0, 24).toString('latin1');
  if (r.bytes.length >= 7 && /^#EXTM3U|^#EXTINF/.test(head)) return null; // m3u8 любой ct
  if (r.bytes.length >= 16 && /^<\?xml|<MPD/i.test(head)) return null;
  if (/video\/(mp4|webm|mkv)|application\/octet-stream/i.test(r.ct) || /^\s*(ftyp|moov|mdat)/.test(head)) {
    return `${label}=MP4 ${r.status}/${r.ct.split(';')[0]} ${r.bytes.length}B`;
  }
  if (isHtml(r.ct, r.bytes)) return `${label}=HTML(${r.bytes.length}B)`;
  if (/mpegurl|dash|xml|text\/plain/.test(r.ct) || /m3u8|mpd|\.ts\b/i.test(url)) return null;
  if (r.status !== 200 && r.status !== 206) return `${label}=${r.status}`;
  if (r.bytes[0] === 0x47) return `${label}=TS ${r.status} ${r.bytes.length}B(sig47✓)`;
  return `${label}=${r.status}/${r.ct.split(';')[0]} ${r.bytes.length}B`;
}

async function playChain(url) {
  let m = await plainFetch(url);
  if (m.status === 'ERR') {
    const r = await rangeFetch(url);
    if (r.status === 206 && (r.bytes[0] === 0x47 || /^\s*(ftyp|moov|mdat)/.test(r.bytes.slice(0, 24).toString('latin1')))) {
      return `MP4-RANGE 206 ${r.ct.split(';')[0]} ${r.bytes.length}B(sig✓)`;
    }
  }
  const mS = chainMedia(m, url, 'master');
  if (mS) return mS;
  const text = m.bytes.toString('utf8');
  if (/dash|xml/.test(m.ct) || /<MPD/i.test(text)) return `master=DASH ${m.bytes.length}B`;
  const varUri = firstUri(text);
  if (!varUri) {
    const seg = firstSegment(text);
    if (!seg) return `master=m3u8 без variant/сегментов`;
    const s = await rangeFetch(new URL(seg, m.url).toString());
    return chainMedia(s, seg, 'seg') || `seg=${s.status} MP2T ${s.bytes.length}B✓`;
  }
  const v = await plainFetch(new URL(varUri, m.url).toString());
  const vS = chainMedia(v, varUri, 'variant');
  if (vS) return vS;
  const segUri = firstSegment(v.bytes.toString('utf8'));
  if (!segUri) return `variant=m3u8 без сегментов`;
  const s = await rangeFetch(new URL(segUri, v.url).toString());
  return chainMedia(s, segUri, 'seg') || `seg=${s.status} MP2T ${s.bytes.length}B✓`;
}

async function videos(provider, film) {
  const q = new URLSearchParams({
    token: TOKEN, provider, source: 'tmdb', title: film.title,
    original_title: film.original_title, year: String(film.year), serial: '0',
    id: String(film.id || ''), imdb_id: film.imdb || '',
    ...(film.kp ? { kinopoisk_id: String(film.kp) } : {})
  });
  const v = await getJSON(`${BASE}/api/lampa/videos?${q}`, 30000);
  return v;
}

console.log(`BASE=${BASE} token=${Boolean(TOKEN)} rewrite=${Boolean(process.env.FPG_REWRITE)}`);

// ===== A) RUmovie-2 (rutubemovie) =====
console.log('\n========== A) RUmovie-2 (rutubemovie) ==========');
const films = [
  { title: 'Матрица', original_title: 'The Matrix', year: 1999, id: '603', imdb: 'tt0133093' },
  { title: 'Интерстеллар', original_title: 'Interstellar', year: 2014, id: '157336', imdb: 'tt0816692' },
  { title: 'Аватар', original_title: 'Avatar', year: 2009, id: '19995', imdb: 'tt0499549' },
  { title: 'Дюна: Часть вторая', original_title: 'Dune: Part Two', year: 2024, id: '693134', imdb: 'tt15239678' },
  { title: 'Зеленая миля', original_title: 'The Green Mile', year: 1999, id: '497', imdb: 'tt0120689' }
];
for (const film of films) {
  const v = await videos('rutubemovie', film);
  const items = v.json?.items || [];
  console.log(`\n## ${film.title} (${film.year}) → /videos ${v.status} items=${items.length}`);
  for (const [i, item] of items.slice(0, 2).entries()) {
    const url = item.url || '';
    console.log(`  [${i}] method=${item.method} title="${String(item.title || '').slice(0, 60)}" voice="${item.voice_name || item.voice || ''}"`);
    if (item.method === 'play' && url) {
      console.log(`      → ${await playChain(url)}`);
    } else if (item.method !== 'play') {
      console.log(`      → resolve: ${item.method}`);
    }
  }
}

// ===== B) HDVB fresh (voice-массив) =====
console.log('\n========== B) HDVB fresh films ==========');
const fresh = [
  { title: 'Дэдпул и Росомаха', original_title: 'Deadpool & Wolverine', year: 2024, id: '533535', imdb: 'tt6263850', kp: 1008444 },
  { title: 'Гладиатор II', original_title: 'Gladiator II', year: 2024, id: '475557', imdb: 'tt9218128', kp: 1207839 },
  { title: 'Супермен', original_title: 'Superman', year: 2025, id: '1022789', imdb: 'tt5950044', kp: 997647 }
];
for (const film of fresh) {
  const v = await videos('hdvb', film);
  const items = v.json?.items || [];
  console.log(`\n## ${film.title} (${film.year}) → /videos ${v.status} items=${items.length}`);
  for (const [i, item] of items.slice(0, 1).entries()) {
    const url = item.url || '';
    console.log(`  [${i}] method=${item.method} title="${String(item.title || '').slice(0, 60)}" voice="${item.voice_name || item.voice || ''}"`);
    if (url) console.log(`      → ${await playChain(url)}`);
  }
}

// ===== C) filmix Range =====
console.log('\n========== C) filmix (Range-поведение) ==========');
{
  const f = fresh[0];
  const v = await videos('filmix', f);
  const items = v.json?.items || [];
  console.log(`## ${f.title} → /videos ${v.status} items=${items.length}`);
  const it = items.find((x) => x.method === 'play');
  if (it?.url) {
    const target = decodeURIComponent(new URL(it.url).searchParams.get('url') || '');
    if (target) {
      const r = await rangeFetch(target);
      console.log(`  Range на upstream: ${r.status}/${r.ct.split(';')[0]} ${r.bytes.length}B ${r.bytes[0] === 0x47 ? 'sig47' : ''}`);
    } else {
      console.log(`  no upstream target in url (${it.url.slice(0, 80)})`);
    }
  }
}

// ===== D) rhsprem в sources/card =====
console.log('\n========== D) rhsprem ==========');
try {
  const card = await getJSON(`${BASE}/api/lampa/sources/card?token=${TOKEN}`, 60000);
  const rows = card.json?.sources || [];
  const rh = rows.find((s) => s.id.includes('rhsprem'));
  console.log(`sources/card: ${card.status} count=${card.json?.meta?.count ?? '-'} rhsprem=${JSON.stringify(rh || 'ABSENT')}`);
  const v = await videos('skaz-rhsprem', films[0]);
  console.log(`skaz-rhsprem videos: ${v.status} items=${(v.json?.items || []).length}`);
} catch (e) {
  console.log(`rhsprem ERR ${String(e).slice(0, 60)}`);
}

console.log('\nVERIFY DONE');