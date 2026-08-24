// FINAL-PLAYBACK-GAP-001: точечный повтор «Зеленая миля» rutubemovie — [0] реальный фильм.
// Отличие от матричного прогона: печатаем URL item, длинный таймаут (45s), 3 попытки GET+Range.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.FPG_BASE || 'http://127.0.0.1:3210';
let TOKEN = process.env.FPG_TOKEN || '';
try { TOKEN = (await readFile(path.join(__dirname, '..', '.fpg-shadow', 'vps-token.txt'), 'utf8')).trim(); } catch {}
let rewrite = (u) => u;
if (process.env.FPG_REWRITE) {
  const up = new URL(BASE);
  rewrite = (u) => String(u).replaceAll(`http://127.0.0.1:${up.port}`, `http://${up.hostname}:${up.port}`);
}
async function getJSON(url, timeout = 30000) {
  const res = await fetch(rewrite(url), { headers: { 'User-Agent': 'fpg-retry' }, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, ct: res.headers.get('content-type') || '', json };
}
async function tryFetch(url, headers, timeout) {
  try {
    const res = await fetch(rewrite(url), { headers, signal: AbortSignal.timeout(timeout) });
    const ct = res.headers.get('content-type') || '';
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, ct, bytes };
  } catch (e) { return { status: 'ERR', err: String(e).slice(0, 45), bytes: Buffer.alloc(0) }; }
}
function firstUri(t) { const m = /#EXT-X-STREAM-INF[^\n]*\n[ \t]*(\S+)/.exec(t || ''); return m ? m[1] : null; }
function firstSegment(t) {
  const l = String(t || '').split(/\r?\n/);
  for (let i = 0; i < l.length; i++) if (/^#EXTINF/.test(l[i].trim()) && l[i + 1] && !l[i + 1].trim().startsWith('#')) return l[i + 1].trim();
  return null;
}

// 1) /videos — взять URL реального фильма
const q = new URLSearchParams({ token: TOKEN, provider: 'rutubemovie', source: 'tmdb', title: 'Зеленая миля', original_title: 'The Green Mile', year: '1999', serial: '0', id: '497', imdb_id: 'tt0120689', kinopoisk_id: '448' });
const v = await getJSON(`${BASE}/api/lampa/videos?${q}`, 30000);
const items = v.json?.items || [];
console.log(`/videos ${v.status} items=${items.length}`);
items.forEach((it, i) => console.log(`  [${i}] "${it.title}" voice="${it.voice_name || it.voice || ''}" method=${it.method} url=${(it.url || '').slice(0, 120)}`));

const target = items[0]?.url;
if (!target) { console.log('NO URL'), process.exit(0); }

for (let attempt = 1; attempt <= 3; attempt++) {
  console.log(`\n-- попытка ${attempt}: master GET 45s`);
  const m = await tryFetch(target, { 'User-Agent': 'fpg-retry' }, 45000);
  if (m.status === 'ERR') {
    console.log(`  GET ERR: ${m.err}`);
    const r = await tryFetch(target, { Range: 'bytes=0-1023', 'User-Agent': 'fpg-retry' }, 45000);
    console.log(`  Range: ${r.status} ${r.ct} ${r.bytes.length}B${Number.isInteger(r.bytes[0]) ? ' sig=' + r.bytes.slice(0, 4).toString('hex') : ''}`);
    if (r.status === 206 && /^\s*(ftyp|moov|mdat|#EX)/.test(r.bytes.slice(0, 24).toString('latin1'))) { console.log('  → ИГРАБЕЛЬНО (Range 206 + сигнатура)'); continue; }
    continue;
  }
  const text = m.bytes.toString('utf8');
  console.log(`  master: ${m.status} ${m.ct} ${m.bytes.length}B head=${text.slice(0, 60).replace(/\n/g, '\\n')}`);
  const varUri = firstUri(text);
  if (!varUri) { console.log('  нет variant → конец'); continue; }
  const varUrl = new URL(varUri, target).toString();
  const vr = await tryFetch(varUrl, { 'User-Agent': 'fpg-retry' }, 45000);
  if (vr.status === 'ERR') { console.log(`  variant GET ERR: ${vr.err}`); continue; }
  const vtxt = vr.bytes.toString('utf8');
  console.log(`  variant: ${vr.status} ${vr.ct} ${vr.bytes.length}B firstSeg=${firstSegment(vtxt) || 'без сегментов'}`);
  const seg = firstSegment(vtxt);
  if (seg) {
    const s = await tryFetch(new URL(seg, varUrl).toString(), { Range: 'bytes=0-1023', 'User-Agent': 'fpg-retry' }, 45000);
    console.log(`  seg Range: ${s.status} ${s.ct} ${s.bytes.length}B${Number.isInteger(s.bytes[0]) ? ' sig=' + s.bytes.slice(0, 4).toString('hex') : ''}`);
    if (s.status === 206 && s.bytes[0] === 0x47) { console.log('  → ИГРАБЕЛЬНО (сегмент MP2T 206)'); break; }
  }
}
console.log('\nDONE');