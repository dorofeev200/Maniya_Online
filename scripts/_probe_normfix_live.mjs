// RUTUBE-NORMALIZER-FIX-001 live-probe (temp /tmp/mo-normfix, новый код).
// Выборка native-карточек 7 фильмов + byte-level playback chain через наш proxy:
// master (200 m3u8) → variant (206) → segment (206 MP2T). Токен НЕ печатается.
import { readFile } from 'node:fs/promises';
import { config } from '../server/src/config.js';
import { providerById } from '../server/src/providers/registry.js';

const films = [
  { title: 'Матрица', original_title: 'The Matrix', year: 1999 },
  { title: 'Аватар', original_title: 'Avatar', year: 2009 },
  { title: 'Интерстеллар', original_title: 'Interstellar', year: 2014 },
  { title: 'Зеленая миля', original_title: 'The Green Mile', year: 1999 },
  { title: 'Дюна: Часть вторая', original_title: 'Dune: Part Two', year: 2024 },
  { title: 'Аннигиляция', original_title: 'Annihilation', year: 2018 },
  { title: 'Братство', original_title: 'Bratstvo', year: 2010 }
];

let token = '';
try {
  const users = JSON.parse(await readFile(config.usersFile, 'utf8'));
  const active = (users || []).find((u) => u && u.active && (!u.expires_at || new Date(u.expires_at).getTime() > Date.now()));
  token = (active && active.token) || '';
} catch { /* токен недоступен — только выборка, без playback */ }
console.log('token_available:', Boolean(token));

const provider = providerById('rutubemovie');
if (!provider) { console.log('PROVIDER NOT FOUND'); process.exit(1); }

async function walk(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'probe' } });
    const ct = res.headers.get('content-type') || '';
    const text = /m3u8|mpegurl/i.test(ct) ? (await res.text()) : '';
    return { status: res.status, ct, text };
  } catch (e) {
    return { status: 'ERR', ct: String(e).slice(0, 60) };
  }
}

function firstUri(playlist) {
  const m = /#EXT-X-STREAM-INF[^\n]*\n[ \t]*(\S+)/.exec(playlist || '');
  return m ? m[1] : null;
}

async function chain(itemUrl) {
  const master = await walk(itemUrl);
  if (master.status !== 200 || !master.text) return { master, variant: null, segment: null };
  const variantUrl = firstUri(master.text);
  if (!variantUrl) return { master, variant: { miss: 'no-variant' }, segment: null };
  const variant = await walk(variantUrl);
  const segUri = firstUri(variant.text || '');
  let segment = null;
  if (segUri) segment = await walk(segUri);
  return { master, variant, segment };
}

for (const film of films) {
  const query = {
    provider: 'rutubemovie', title: film.title, original_title: film.original_title,
    year: String(film.year), serial: '0', source: 'tmdb'
  };
  if (token) query.token = token;

  let payload;
  try { payload = await provider.videos({ query }); }
  catch (e) { console.log(`\n[${film.title} ${film.year}] videos ERROR: ${String(e).slice(0, 80)}`); continue; }

  const items = payload.items || [];
  const chosen = items.slice(0, 3).map((i) => i.title).join(' | ');
  console.log(`\n[${film.title} (${film.year})] native items=${items.length}`);
  console.log(`  top3: ${chosen || '(пусто — twin fallback в store)'}`);

  if (items[0] && token) {
    const r = await chain(items[0].url);
    console.log(`  master=${r.master.status}/${r.master.ct}`);
    if (r.variant) {
      const v = r.variant;
      console.log(`  variant=${v.miss ? v.miss : `${v.status}/${v.ct}`}`);
      if (r.segment) console.log(`  segment=${r.segment.status}/${r.segment.ct}`);
    }
  } else if (!items[0]) {
    console.log(`  (playback не проверялся: native пуст → фолбэк на twin)`);
  }
}