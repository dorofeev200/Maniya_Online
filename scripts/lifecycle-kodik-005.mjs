// BALANCER-KODIK-005 — READ-ONLY lifecycle-воспроизведение симптома
// «Kodik исчезает при повторном открытии карточки».
// Эмулирует ТОЧНО ту последовательность запросов, что делает UI (public/maniya-online.js):
//   open  → GET /sources → GET /sources/card
//   close (пауза)
//   open  → GET /sources → GET /sources/card
// и фиксирует для КАЖДОГО запроса: HTTP status, cached, elapsed_ms, count, kodik show,
// весь состав visible sources, порядок, а также вычислимый cache key (fnv1aKey) и userUid.
//
// Токен в query (как addAccountParams в UI), uid param (как ensureUid), параметры фильма
// как addMovieParams (id/title/original_title/serial/year/original_language/source/
// clarification/similar/imdb_id/kinopoisk_id).
// Ничего не меняет. Только GET. Вердикт — последней строкой.
import { createHash, createHmac } from 'node:crypto';
// SECURITY-001: creds только из env → temp (см. _creds.mjs)
import { loadUserA } from './_creds.mjs';

const BASE = process.env.PROD_BASE_URL || 'https://plugin.maniya-kvn.online';
const userA = loadUserA();
if (!userA) { console.log('FATAL: нет токена'); process.exit(1); }
const TOKEN = userA.token;

// userUid на сервере = sha256Hex(user.token).slice(0,16) (index.js:145)
const USER_UID = createHash('sha256').update(TOKEN).digest('hex').slice(0, 16);

// fnv1a-32 → base64url, как fnv1aKey в availability.js
function fnv1aKey(text) {
  let hash = 2166136261;
  const input = String(text || '');
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return Buffer.from(String(hash >>> 0)).toString('base64url');
}

// addMovieParams UI (maniya-online.js:141-162)
function addMovieParams(movie) {
  const q = {};
  q.id = movie.id || '';
  q.title = movie.title || '';
  q.original_title = movie.original_title || '';
  q.serial = movie.name ? 1 : 0;
  q.year = String(movie.release_date || movie.first_air_date || '0000').slice(0, 4);
  q.original_language = movie.original_language || '';
  q.source = movie.source || 'tmdb';
  q.clarification = 0;
  q.similar = false;
  if (movie.imdb_id) q.imdb_id = movie.imdb_id;
  if (movie.kinopoisk_id) q.kinopoisk_id = movie.kinopoisk_id;
  if (movie.tmdb_id) q.tmdb_id = movie.tmdb_id;
  return q;
}

// UI добавляет uid=ensureUid() (Lampa.Utils.uid(8), стабильный в Storage)
const UID = 'a1b2c3d4';

async function api(path, query) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('token', TOKEN);
  url.searchParams.set('uid', UID);
  const t0 = Date.now();
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(90_000) });
  const ms = Date.now() - t0;
  const text = await r.text().catch(() => '');
  let body = null; try { body = JSON.parse(text); } catch { body = null; }
  return { status: r.status, ms, body, raw: text.slice(0, 160) };
}

// Статический реестр /sources — порядок источников
function summarizeSources(body) {
  const srcs = Array.isArray(body) ? body : (body && (body.sources || body.online)) || [];
  return srcs.map((s) => ({
    id: String(s.id || s.source || '?'),
    show: s.show !== false,
    name: String(s.name || '').slice(0, 20)
  }));
}

// /sources/card — какие источники show:true/false + порядок + meta
function summarizeCard(body) {
  const srcs = (body && body.sources) || [];
  const meta = (body && body.meta) || {};
  return {
    cached: Boolean(meta.cached),
    elapsed_ms: meta.elapsed_ms,
    count: meta.count,
    rows: srcs.map((s) => ({ id: String(s.id || '?'), show: s.show !== false }))
  };
}

const FILMS = [
  { label: 'Форрест Гамп (tmdb 13)', movie: { id: '13', title: 'Форрест Гамп', original_title: 'Forrest Gump', release_date: '1994-06-23', original_language: 'en', source: 'tmdb', imdb_id: 'tt0109830', tmdb_id: '13' } },
  { label: 'Матрица (tmdb 603)', movie: { id: '603', title: 'Матрица', original_title: 'The Matrix', release_date: '1999-03-30', original_language: 'en', source: 'tmdb', imdb_id: 'tt0133093', kinopoisk_id: '301', tmdb_id: '603' } },
  { label: 'Интерстеллар (tmdb 157336)', movie: { id: '157336', title: 'Интерстеллар', original_title: 'Interstellar', release_date: '2014-11-05', original_language: 'en', source: 'tmdb', imdb_id: 'tt0816692', tmdb_id: '157336' } },
  { label: 'Дом Дракона serial (tmdb 94997)', movie: { id: '94997', title: 'Дом Дракона', name: 'Дом Дракона', original_name: 'House of the Dragon', original_title: 'House of the Dragon', first_air_date: '2022-08-21', original_language: 'en', source: 'tmdb', imdb_id: 'tt11198330', tmdb_id: '94997' } }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkFilm(film, gapMs) {
  const q = addMovieParams(film.movie);
  const cacheText = `${q.id}:${q.serial}:${q.source}:<count>:${USER_UID}`;

  console.log('');
  console.log('═'.repeat(86));
  console.log('FILM ' + film.label + '  serial=' + q.serial + ' id=' + q.id);
  console.log('  userUid=' + USER_UID + ' uid-param=' + UID);

  // ===== FIRST OPEN =====
  console.log('— FIRST open —');
  const s1 = await api('/api/lampa/sources', q);
  const c1 = await api('/api/lampa/sources/card', q);
  const src1 = summarizeSources(s1.body);
  const card1 = summarizeCard(c1.body);
  const kodik1 = card1.rows.find((r) => r.id === 'kodik');
  console.log('  /sources   status=' + s1.status + ' ms=' + s1.ms + ' sources=' + src1.length);
  console.log('  /sources/card status=' + c1.status + ' ms=' + c1.ms + ' cached=' + card1.cached + ' elapsed_ms=' + card1.elapsed_ms + ' count=' + card1.count);
  console.log('  kodik card: show=' + (kodik1 ? kodik1.show : 'АБСЕНТ в card-ответе!'));
  console.log('  card rows (' + card1.rows.length + '): ' + card1.rows.map((r) => (r.show ? r.id : r.id + '!')).join(', '));

  // ===== CLOSE (пауза = время «в карточке» до выхода и повторного входа) =====
  console.log('— close (пауза ' + gapMs + 'мс) —');
  await sleep(gapMs);

  // ===== SECOND OPEN =====
  console.log('— SECOND open —');
  const s2 = await api('/api/lampa/sources', q);
  const c2 = await api('/api/lampa/sources/card', q);
  const src2 = summarizeSources(s2.body);
  const card2 = summarizeCard(c2.body);
  const kodik2 = card2.rows.find((r) => r.id === 'kodik');
  console.log('  /sources   status=' + s2.status + ' ms=' + s2.ms + ' sources=' + src2.length);
  console.log('  /sources/card status=' + c2.status + ' ms=' + c2.ms + ' cached=' + card2.cached + ' elapsed_ms=' + card2.elapsed_ms + ' count=' + card2.count);
  console.log('  kodik card: show=' + (kodik2 ? kodik2.show : 'АБСЕНТ в card-ответе!'));

  // ===== СРАВНЕНИЕ =====
  const sameSourcesOrder = JSON.stringify(src1.map((s) => s.id)) === JSON.stringify(src2.map((s) => s.id));
  const kodikFlip = (kodik1 && kodik1.show) !== (kodik2 && kodik2.show);
  const cacheChanged = card1.cached !== card2.cached;
  console.log('  — сравнение —');
  console.log('  /sources идентичны (состав+порядок): ' + (sameSourcesOrder ? 'ДА' : 'НЕТ'));
  console.log('  kodik show: FIRST=' + (kodik1 && kodik1.show) + ' SECOND=' + (kodik2 && kodik2.show) + (kodikFlip ? ' ⚠ ФЛИП!' : ' (стабильно)'));
  console.log('  cached: FIRST=' + card1.cached + ' SECOND=' + card2.cached + (cacheChanged ? ' ⚠ сменился' : ''));
  console.log('  cache key шаблон: ' + cacheText + ' (count подставляется сервером)');

  return {
    film: film.label,
    kodikFlip,
    first: kodik1 ? kodik1.show : null,
    second: kodik2 ? kodik2.show : null,
    firstCached: card1.cached,
    secondCached: card2.cached,
    sameSourcesOrder,
    cardRowsSecond: card2.rows.map((r) => (r.show ? r.id : r.id + '!')).join(',')
  };
}

async function main() {
  console.log('== lifecycle kodik-005 == base=' + BASE + ' token_len=' + TOKEN.length + ' userUid=' + USER_UID);
  const results = [];
  // Быстрый повтор (3с — типичный «вышел и вернулся»): кэш 60с/5мин ещё жив.
  for (const film of FILMS) {
    results.push(await checkFilm(film, 3000));
    await sleep(4000);
  }

  console.log('');
  console.log('='.repeat(86));
  console.log('СВОДКА (быстрый повтор, gap 3с):');
  for (const r of results) {
    console.log('  ' + r.film + ': kodik FIRST=' + r.first + ' SECOND=' + r.second + (r.kodikFlip ? '  ⚠ ФЛИП' : '') + ' cached ' + r.firstCached + '→' + r.secondCached + (r.sameSourcesOrder ? ' | sources порядок тот же' : ' | sources порядок СМЕНЁН'));
  }
  const flips = results.filter((r) => r.kodikFlip);
  console.log('ФЛИПОВ: ' + flips.length + '/' + results.length);
  console.log('HINT: если kodik стабилен при быстром повторе — проверяем медленный повтор (>60с, TTL кэша 60с при наличии скрытых источников).');
}

main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });
