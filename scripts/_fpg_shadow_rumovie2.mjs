// FINAL-PLAYBACK-GAP-001: RUmovie-2 (provider=rutubemovie) реальный пользовательский flow.
// Shadow-сервер на :3999 (локальный), USERS_FILE=.fpg-shadow/users.json (активная подписка).
// Цепочка: /sources → /sources/card → /videos → (resolve) → proxy master → variant → segment.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:3999';
const TOKEN = JSON.parse(await readFile(path.join(__dirname, '..', '.fpg-shadow', 'users.json'), 'utf8'))[0].token;

const films = [
  { title: 'Матрица', original_title: 'The Matrix', year: 1999, imdb: 'tt0133093' },
  { title: 'Интерстеллар', original_title: 'Interstellar', year: 2014, imdb: 'tt0816692' },
  { title: 'Аватар', original_title: 'Avatar', year: 2009, imdb: 'tt0499549' },
  { title: 'Дюна: Часть вторая', original_title: 'Dune: Part Two', year: 2024, imdb: 'tt15239678' },
  { title: 'Зеленая миля', original_title: 'The Green Mile', year: 1999, imdb: 'tt0120689' }
];

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'fpg-probe' } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, ct: res.headers.get('content-type') || '', json, text };
}

// Манифестный GET (плейер так и просит m3u8 — без Range).
async function manifestProbe(proxyUrl) {
  try {
    const res = await fetch(proxyUrl, { headers: { 'User-Agent': 'fpg-probe' } });
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    return { status: res.status, ct, text, bytes: text.length };
  } catch (e) {
    return { status: 'ERR', err: String(e).slice(0, 80), text: '' };
  }
}

// Сегментный Range-запрос: только 512 байт, следим за 206/MP2T/байтами.
async function segmentRangeProbe(proxyUrl) {
  try {
    const res = await fetch(proxyUrl, {
      headers: { Range: 'bytes=0-511', 'User-Agent': 'fpg-probe' }
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      ct: res.headers.get('content-type') || '',
      bytes: buf.length,
      sig: buf.slice(0, 4).toString('hex'),
      contentRange: res.headers.get('content-range') || ''
    };
  } catch (e) {
    return { status: 'ERR', err: String(e).slice(0, 80) };
  }
}

function firstUri(playlist) {
  const m = /#EXT-X-STREAM-INF[^\n]*\n[ \t]*(\S+)/.exec(playlist || '');
  return m ? m[1] : null;
}
function firstSegmentUri(playlist) {
  const lines = String(playlist || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^#EXTINF/.test(lines[i].trim()) && lines[i + 1]) {
      const next = lines[i + 1].trim();
      if (next && !next.startsWith('#')) return next;
    }
  }
  return null;
}

async function proxyChain(proxyUrl) {
  const out = { master: null, variant: null, segment: null };
  out.master = await manifestProbe(proxyUrl);
  if (out.master.status !== 200 || !out.master.text) return out;
  const variantProxy = firstUri(out.master.text);
  if (!variantProxy) { out.variant = { status: 'NO-VARIANT' }; return out; }
  out.variant = await manifestProbe(variantProxy);
  if (out.variant.status !== 200 || !out.variant.text) return out;
  const seg = firstSegmentUri(out.variant.text);
  if (!seg) { out.segment = { status: 'NO-SEGMENT' }; return out; }
  out.segment = await segmentRangeProbe(seg);
  return out;
}

const shortHost = (u) => { try { return new URL(u).hostname; } catch { return '?'; } };

console.log('token_available:', Boolean(TOKEN));

const src = await getJSON(`${BASE}/api/lampa/sources?token=${TOKEN}`);
console.log('sources:', src.status, 'count=', (src.json?.sources || []).length);
const rutube = (src.json?.sources || []).find((s) => s.id === 'rutubemovie');
const vkmovie = (src.json?.sources || []).find((s) => s.id === 'vkmovie');
console.log('  rutubemovie:', JSON.stringify(rutube || 'ABSENT'));
console.log('  vkmovie:', JSON.stringify(vkmovie || 'ABSENT'));

try {
  const card = await getJSON(`${BASE}/api/lampa/sources/card?token=${TOKEN}`);
  const row = (card.json?.sources || []).find((s) => s.id === 'rutubemovie');
  console.log('sources/card:', card.status, 'count=', card.json?.meta?.count ?? '-', row ? JSON.stringify(row) : 'no rutubemovie row');
} catch (e) {
  console.log('sources/card ERR:', String(e).slice(0, 80));
}

for (const film of films) {
  const q = new URLSearchParams({
    token: TOKEN, provider: 'rutubemovie', source: 'tmdb',
    title: film.title, original_title: film.original_title,
    year: String(film.year), serial: '0', imdb_id: film.imdb
  });
  const v = await getJSON(`${BASE}/api/lampa/videos?${q}`);
  const items = v.json?.items || [];
  console.log(`\n== ${film.title} (${film.year}) ==`);
  console.log('  /videos:', v.status, 'items=', items.length);

  const seen = new Set();
  for (const [i, item] of items.entries()) {
    const url = item.url || '';
    const viaProxy = url.includes('/api/lampa/proxy');
    // Дуб-эхо: разные items с одинаковым URL (один и тот же поток) — помечаем.
    const dup = seen.has(url) ? ' DUP' : '';
    if (url) seen.add(url);
    console.log(`  [${i}]${dup} method=${item.method} title="${String(item.title).slice(0, 70)}" voice="${item.voice_name || item.voice || ''}"`);
    console.log(`      url=${viaProxy ? `proxy→${shortHost(url)}` : `raw→${shortHost(url)}`}`);

    if (item.method === 'play' && viaProxy) {
      const c = await proxyChain(url);
      console.log(`      master=${fmt(c.master)}`);
      if (c.variant) console.log(`      variant=${fmt(c.variant)}`);
      if (c.segment) console.log(`      segment=${fmt(c.segment)}`);
    }
  }
  if (!items.length) {
    // native пуст — проверяем provider_error и факт фолбэка
    const pe = v.json?.provider_error;
    console.log('  provider_error:', JSON.stringify(pe || 'нет'), '(native=пусто → twin fallback по store.js)');
  }
}

function fmt(r) {
  if (!r) return '(нет)';
  if (r.status === 'ERR') return `ERR ${r.err}`;
  if (r.status === 'NO-VARIANT') return '200 манифест без variant URI';
  if (r.status === 'NO-SEGMENT') return '200 манифест без сегментов';
  const extra = r.sig ? ` sig=${r.sig}` : '';
  return `${r.status}/${r.ct}${r.bytes != null ? ` bytes=${r.bytes}` : ''}${r.contentRange ? ` range=${r.contentRange.slice(0, 24)}` : ''}${extra}`;
}