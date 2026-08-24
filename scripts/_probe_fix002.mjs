// RUTUBE-NORMALIZER-FIX-002 live-probe (temp /tmp/mo-normfix, фикс в RutubeNormalizer).
// Для 4 фильмов: scored-кандидаты (годful+годless) с _score, итоговые native-карточки,
// playback-цепочка items[0] master→variant→segment. Токен НЕ печатается.
import { readFile } from 'node:fs/promises';
import { config } from '../server/src/config.js';
import { providerById } from '../server/src/providers/registry.js';
import { RutubeNormalizer } from '../server/src/providers/rutube/RutubeNormalizer.js';

const films = [
  { title: 'Матрица', original_title: 'The Matrix', year: 1999 },
  { title: 'Аватар', original_title: 'Avatar', year: 2009 },
  { title: 'Интерстеллар', original_title: 'Interstellar', year: 2014 },
  { title: 'Зеленая миля', original_title: 'The Green Mile', year: 1999 }
];

let token = '';
try {
  const users = JSON.parse(await readFile(config.usersFile, 'utf8'));
  const active = (users || []).find((u) => u && u.active && (!u.expires_at || new Date(u.expires_at).getTime() > Date.now()));
  token = (active && active.token) || '';
} catch { }
console.log('token_available:', Boolean(token));

const provider = providerById('rutubemovie');
if (!provider) { console.log('PROVIDER NOT FOUND'); process.exit(1); }
const client = provider.client;
const normalizer = new RutubeNormalizer();

async function walk(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'probe' } });
    const ct = res.headers.get('content-type') || '';
    const text = /m3u8|mpegurl/i.test(ct) ? (await res.text()) : '';
    return { status: res.status, ct, text };
  } catch (e) { return { status: 'ERR', ct: String(e).slice(0, 60) }; }
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
  const segment = segUri ? await walk(segUri) : null;
  return { master, variant, segment };
}

for (const film of films) {
  const title = film.title, originalTitle = film.original_title, year = film.year;
  const query = { provider: 'rutubemovie', title, original_title: originalTitle, year: String(year), serial: '0', source: 'tmdb' };
  if (token) query.token = token;

  // scored-кандидаты: годful и годless (как в provider.search)
  const n = normalizer.with({ searchKeys: [title, originalTitle], year });
  const yearfulRaw = await client.searchAll([`${title} ${year}`, `${originalTitle} ${year}`]);
  const yf = n.rankedCandidates(yearfulRaw).map((r) => ({ id: r.id, title: r.title, score: r._score, dur: r.duration }));
  const yl = year === 0 ? [] : await client.searchAll([title, originalTitle]);
  const ylRanked = yl ? n.rankedCandidates(yl).map((r) => ({ id: r.id, title: r.title, score: r._score, dur: r.duration })) : [];
  const bestYearful = n.bestScore(yearfulRaw);

  console.log(`\n[${title} (${year})] bestScore(yearful)=${bestYearful}`, bestYearful < RutubeNormalizer.STRONG_SCORE ? '→ trigger yearless' : '→ строго yearful');
  console.log(`  yearful: ${yf.length ? yf.map((r) => `${r.title} (s=${r.score})`).join(' | ') : '(пусто)'}`);
  if (bestYearful < RutubeNormalizer.STRONG_SCORE) {
    console.log(`  yearless: ${ylRanked.length ? ylRanked.map((r) => `${r.title} (s=${r.score})`).join(' | ') : '(пусто → native=[] → twin fallback)'}`);
  }

  // итоговые native-карточки (что реально отдаёт провайдер)
  let payload;
  try { payload = await provider.videos({ query }); }
  catch (e) { console.log(`  videos ERROR: ${String(e).slice(0, 80)}`); continue; }
  const items = payload.items || [];
  console.log(`  native items=${items.length}: ${items.slice(0, 3).map((i) => i.title).join(' | ') || '(пусто — twin fallback)'}`);

  // playback первого результата
  if (items[0] && token) {
    const r = await chain(items[0].url);
    console.log(`  playback ${items[0].title}: master=${r.master.status}/${r.master.ct}`);
    if (r.variant) { const v = r.variant; console.log(`    variant=${v.miss ? v.miss : `${v.status}/${v.ct}`}`); if (r.segment) console.log(`    segment=${r.segment.status}/${r.segment.ct}`); }
  } else if (!items[0]) {
    // twin fallback не в этом модуле (store.js) — показываем только факт пустого native
  }
}