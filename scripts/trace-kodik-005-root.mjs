// BALANCER-KODIK-005 — ROOT-CAUSE READ-ONLY (только GET, ничего не меняет).
// Воспроизводит ТОЧНЫЙ вердикт ряда kodik из /api/lampa/sources/card против живого
// кластера:
//   1) Настоящий createAvailabilityChecker.card() с кредами VPS и abstain (код-путь
//      прода), с KODIK_TOKEN, чтобы kodik был в локальном реестре (native+скрытый
//      twin) — probe идёт через кластер /lite/kodik?checksearch=true.
//   2) Прямой fetch /lite/kodik по первым двум хостам (online3=primary, online8=
//      reserve) + checkSearchPredicate по полному телу → что видит сервер.
// Печатает ВНУТРЕННИЕ поля ряда kodik: show/authoritative/inconclusive/accsdb/
// mixed/confirmed/confirmInconclusive/retried/status/host/balancer/reason + состав
// всех rows. Вердикт — последними строками.
import { createHash } from 'node:crypto';
// SECURITY-001: creds только из env → temp (см. _creds.mjs)
import { loadUserA, loadClusterEmail, loadClusterUid } from './_creds.mjs';

process.env.KODIK_TOKEN = process.env.KODIK_TOKEN || 'repro'; // включает kodik в реестре; value не используется кластер-пробой

const { createAvailabilityChecker, checkSearchPredicate } = await import('../server/src/availability.js');

const userA = loadUserA();
if (!userA) { console.log('FATAL: нет токена'); process.exit(1); }
const EMAIL = loadClusterEmail();
const UID = loadClusterUid();
const USER_UID = createHash('sha256').update(userA.token).digest('hex').slice(0, 16);

const checker = createAvailabilityChecker({ reservePolicy: 'abstain', accountEmail: EMAIL, uid: UID });

const FILMS = [
  { label: 'Форрест Гамп (13)', movie: { id: '13', title: 'Форрест Гамп', original_title: 'Forrest Gump', release_date: '1994-06-23', original_language: 'en', source: 'tmdb', imdb_id: 'tt0109830', tmdb_id: '13' } },
  { label: 'Матрица (603)', movie: { id: '603', title: 'Матрица', original_title: 'The Matrix', release_date: '1999-03-30', original_language: 'en', source: 'tmdb', imdb_id: 'tt0133093', kinopoisk_id: '301', tmdb_id: '603' } },
  { label: 'Интерстеллар (157336)', movie: { id: '157336', title: 'Интерстеллар', original_title: 'Interstellar', release_date: '2014-11-05', original_language: 'en', source: 'tmdb', imdb_id: 'tt0816692', tmdb_id: '157336' } },
  { label: 'Дом Дракона serial (94997)', movie: { id: '94997', title: 'Дом Дракона', name: 'Дом Дракона', original_name: 'House of the Dragon', original_title: 'House of the Dragon', first_air_date: '2022-08-21', original_language: 'en', source: 'tmdb', imdb_id: 'tt11198330', tmdb_id: '94997' } },
  { label: 'Одиссея 2026 (1368337)', movie: { id: '1368337', title: 'Одиссея', original_title: 'The Odyssey', release_date: '2026-11-27', original_language: 'en', source: 'tmdb', imdb_id: 'tt33764258', tmdb_id: '1368337' } }
];

function uiQuery(movie) {
  return {
    id: movie.id || '',
    title: movie.title || '',
    original_title: movie.original_title || '',
    serial: movie.name ? 1 : 0,
    year: String(movie.release_date || movie.first_air_date || '0000').slice(0, 4),
    original_language: movie.original_language || '',
    source: movie.source || 'tmdb',
    clarification: 0,
    similar: false,
    ...(movie.imdb_id ? { imdb_id: movie.imdb_id } : {}),
    ...(movie.kinopoisk_id ? { kinopoisk_id: movie.kinopoisk_id } : {}),
    ...(movie.tmdb_id ? { tmdb_id: movie.tmdb_id } : {})
  };
}

function buildUrl(host, query) {
  const url = new URL(`http://${host}/lite/kodik`);
  const params = {
    id: String(query.id ?? query.tmdb_id ?? ''),
    imdb_id: String(query.imdb_id ?? ''),
    kinopoisk_id: String(query.kinopoisk_id ?? ''),
    title: String(query.title ?? ''),
    original_title: String(query.original_title ?? ''),
    original_language: String(query.original_language ?? ''),
    serial: query.serial ? 1 : 0,
    year: String(query.year ?? ''),
    source: String(query.source || 'tmdb'),
    checksearch: 'true'
  };
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  url.searchParams.set('account_email', EMAIL);
  url.searchParams.set('uid', UID);
  return url.toString();
}

async function fetchBody(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { accept: '*/*' }, signal: AbortSignal.timeout(12_000) });
    const body = await r.text().catch(() => null);
    return { status: r.status, ms: Date.now() - t0, body };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, body: null, err: String((e && e.name) || e) };
  }
}

function extractCards(html) {
  const cards = [];
  const re = /data-json=['"]({.*?})['"]/gs;
  let m;
  while ((m = re.exec(String(html))) !== null) {
    try { cards.push(JSON.parse(m[1].replace(/\\u0026/g, '&'))); } catch { /* skip */ }
  }
  return cards;
}

function cardBrief(c) {
  return { method: c.method, s: c.s, e: c.e, similar: c.similar ? true : undefined, url: String(c.url || '').slice(0, 90), title: String(c.title || '').slice(0, 24) };
}

async function rawProbe(query, label) {
  for (const host of ['online3.skaz.tv', 'online8.skaz.tv']) {
    const { status, ms, body, err } = await fetchBody(buildUrl(host, query));
    if (status === 0) { console.log(`    raw ${host} → НЕТ ОТВЕТА (${err})`); continue; }
    const pred = (status >= 200 && status < 300 && body) ? checkSearchPredicate(body, query) : null;
    const cards = (status >= 200 && status < 300 && body) ? extractCards(body) : [];
    const line = `    raw ${host} → status=${status} (${ms}ms)`;
    if (pred) {
      console.log(line + ` | predicate: work=${pred.work} verdict=${pred.verdict} rch=${pred.rch}`);
      for (const c of cards.slice(0, 4)) console.log('        card: ' + JSON.stringify(cardBrief(c)));
      if (cards.length > 4) console.log('        … ещё ' + (cards.length - 4) + ' карточек');
    } else {
      console.log(line + ' | body≈' + JSON.stringify(String(body || '').replace(/\s+/g, ' ').slice(0, 120)));
    }
  }
}

function rowDetail(row) {
  return {
    show: row.show, authoritative: row.authoritative, inconclusive: row.inconclusive,
    accsdb: row.accsdb, mixed: row.mixed, confirmed: row.confirmed,
    confirmInconclusive: row.confirmInconclusive, retried: row.retried, trusted: row.trusted,
    status: row.status, host: row.host, balancer: row.balancer, reason: row.reason
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('== trace kodik-005 ROOT == email_len=' + EMAIL.length + ' uid_len=' + UID.length + ' userUid=' + USER_UID + ' KODIK_TOKEN=set');
  const summary = [];
  for (const film of FILMS) {
    console.log('');
    console.log('═'.repeat(94));
    console.log('FILM ' + film.label + '  serial=' + (film.movie.name ? 1 : 0));
    const q = uiQuery(film.movie);

    const c1 = await checker.card(q, USER_UID);
    console.log('  FIRST card: cached=' + c1.cached + ' elapsed_ms=' + c1.elapsedMs + ' count=' + c1.count);
    const k1 = (c1.sources || []).find((r) => r.id === 'kodik');
    console.log('    kodik: ' + JSON.stringify(k1 ? rowDetail(k1) : null));
    console.log('    rows (' + c1.sources.length + '): ' + c1.sources.map((r) => (r.show ? r.id : r.id + '!')).join(', '));

    await rawProbe(q, film.label);

    await sleep(3500);

    const c2 = await checker.card(q, USER_UID);
    console.log('  SECOND card: cached=' + c2.cached + ' elapsed_ms=' + c2.elapsedMs);
    const k2 = (c2.sources || []).find((r) => r.id === 'kodik');
    console.log('    kodik: ' + JSON.stringify(k2 ? rowDetail(k2) : null));
    const flip = (k1 && k1.show) !== (k2 && k2.show);
    summary.push({ label: film.label, first: k1 && k1.show, second: k2 && k2.show, flip, firstDetail: k1 && rowDetail(k1), cached: c1.cached + '→' + c2.cached });
    if (flip) console.log('  ⚠ ФЛИП kodik: ' + (k1 && k1.show) + ' → ' + (k2 && k2.show));
    await sleep(3500);
  }

  console.log('');
  console.log('='.repeat(94));
  console.log('СВОДКА:');
  for (const s of summary) {
    console.log('  ' + s.label + ': kodik FIRST=' + s.first + ' SECOND=' + s.second + (s.flip ? '  ⚠ ФЛИП' : '') + ' cached=' + s.cached + (s.firstDetail ? ' | first=' + JSON.stringify(s.firstDetail) : ''));
  }
}

main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });
