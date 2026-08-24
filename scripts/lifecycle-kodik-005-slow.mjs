// Медленный повтор: gap 70с (TTL кэша 60с при наличии скрытых источников истёк)
// → SECOND = новый полный probe (cached=false) → вердикт может флипнуться.
import { createHash } from 'node:crypto';
// SECURITY-001: creds только из env → temp (см. _creds.mjs)
import { loadUserA } from './_creds.mjs';
const BASE = process.env.PROD_BASE_URL || 'https://plugin.maniya-kvn.online';
const userA = loadUserA();
const TOKEN = userA.token;
const USER_UID = createHash('sha256').update(TOKEN).digest('hex').slice(0, 16);
async function api(path, query) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '' && v !== false) url.searchParams.set(k, String(v));
  url.searchParams.set('token', TOKEN); url.searchParams.set('uid', 'a1b2c3d4');
  const t0 = Date.now();
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(90000) });
  const text = await r.text().catch(() => '');
  let body = null; try { body = JSON.parse(text); } catch {}
  return { status: r.status, ms: Date.now() - t0, body };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function cardInfo(body) {
  const rows = (body && body.sources) || [];
  const meta = (body && body.meta) || {};
  const kodik = rows.find((r) => r.id === 'kodik');
  return { cached: Boolean(meta.cached), elapsed_ms: meta.elapsed_ms, count: meta.count, kodik: kodik ? kodik.show : null };
}
const FILM = { label: 'Форрест Гамп (tmdb 13)', movie: { id: '13', title: 'Форрест Гамп', original_title: 'Forrest Gump', release_date: '1994-06-23', original_language: 'en', source: 'tmdb', imdb_id: 'tt0109830', tmdb_id: '13' } };
function addMovieParams(movie) {
  const q = { id: movie.id, title: movie.title, original_title: movie.original_title, serial: movie.name ? 1 : 0,
    year: String(movie.release_date || movie.first_air_date || '0000').slice(0,4), original_language: movie.original_language, source: movie.source, clarification: 0, similar: false };
  if (movie.imdb_id) q.imdb_id = movie.imdb_id;
  if (movie.kinopoisk_id) q.kinopoisk_id = movie.kinopoisk_id;
  if (movie.tmdb_id) q.tmdb_id = movie.tmdb_id;
  return q;
}
async function main() {
  console.log('== kodik-005 SLOW repeat (gap 70с > TTL 60с) == token_len=' + TOKEN.length + ' userUid=' + USER_UID);
  const q = addMovieParams(FILM.movie);
  for (let cycle = 1; cycle <= 3; cycle++) {
    console.log('');
    console.log('═══ CYCLE ' + cycle + ' (start ' + new Date().toISOString().slice(11,19) + ') ═══');
    const c1 = await api('/api/lampa/sources/card', q);
    const i1 = cardInfo(c1.body);
    console.log('  FIRST  card: cached=' + i1.cached + ' elapsed=' + i1.elapsed_ms + ' kodik=' + i1.kodik + ' status=' + c1.status);
    // «выход из карточки» + возврат через 70с (кэш истёк)
    await sleep(70_000);
    const c2 = await api('/api/lampa/sources/card', q);
    const i2 = cardInfo(c2.body);
    console.log('  SECOND card: cached=' + i2.cached + ' elapsed=' + i2.elapsed_ms + ' kodik=' + i2.kodik + ' status=' + c2.status);
    console.log('  → ' + (i1.kodik !== i2.kodik ? '⚠ ФЛИП: FIRST=' + i1.kodik + ' SECOND=' + i2.kodik : 'стабильно (' + i1.kodik + ')') + (i1.cached !== i2.cached ? ' cached ' + i1.cached + '→' + i2.cached : ''));
    await sleep(5000);
  }
  console.log('');
  console.log('DONE');
}
main().catch((e) => { console.error('FATAL ' + (e.stack || e.message)); process.exitCode = 1; });
