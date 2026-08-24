// BALANCER-KODIK-005 — ЧЕМПИОНСКИЙ READ-ONLY диагностический скрипт.
// Импортирует НАСТОЯЩИЙ createAvailabilityChecker из server/src/availability.js и
// вызывает .card(query, userUid) ПРЯМО (тот же код-путь, что /api/lampa/sources/card
// на проде) с кредами VPS и reservePolicy='abstain'. В отличие от API-ответа
// (только id+show), скрипт печатает ВНУТРЕННИЕ поля ряда kodik:
//   show / authoritative / inconclusive / accsdb / mixed / confirmed /
//   confirmInconclusive / retried / trusted / status / host / balancer / reason
// и сырые тела кластера /lite/kodik?checksearch=true по каждому хосту.
// Ничего не меняет. Только GET. Вердикт — последними строками.
import { createHash } from 'node:crypto';
// SECURITY-001: creds только из env → temp (см. _creds.mjs)
import { loadUserA, loadClusterEmail, loadClusterUid } from './_creds.mjs';
import { createAvailabilityChecker } from '../server/src/availability.js';

const userA = loadUserA();
if (!userA) { console.log('FATAL: нет токена'); process.exit(1); }
const EMAIL = loadClusterEmail();
const UID = loadClusterUid();

const USER_UID = createHash('sha256').update(userA.token).digest('hex').slice(0, 16);

const checker = createAvailabilityChecker({
  reservePolicy: 'abstain',
  accountEmail: EMAIL,
  uid: UID
});

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

function rowDetail(row) {
  return {
    show: row.show,
    authoritative: row.authoritative,
    inconclusive: row.inconclusive,
    accsdb: row.accsdb,
    mixed: row.mixed,
    confirmed: row.confirmed,
    confirmInconclusive: row.confirmInconclusive,
    retried: row.retried,
    trusted: row.trusted,
    status: row.status,
    host: row.host,
    balancer: row.balancer,
    reason: row.reason
  };
}

function printCard(title, result) {
  const kodik = (result.sources || []).find((r) => r.id === 'kodik');
  console.log('  ' + title + ': cached=' + result.cached + ' elapsed_ms=' + result.elapsedMs +
    ' count=' + result.count + ' hasInconclusive=' + result.hasInconclusive);
  if (kodik) {
    console.log('    kodik: ' + JSON.stringify(rowDetail(kodik)));
  } else {
    console.log('    kodik: АБСЕНТ в rows!');
  }
  const brief = result.sources.map((r) => (r.show ? r.id : r.id + '!')).join(', ');
  console.log('    rows (' + result.sources.length + '): ' + brief);
}

async function rawClusterBodies(query) {
  // buildUrl(balancer='kodik', query, checksearch=true) — точная копия серверной
  const url = new URL('http://online3.skaz.tv/lite/kodik');
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
  const hosts = ['online3.skaz.tv', 'online8.skaz.tv', '94.249.239.63', '94.249.239.37', '94.249.239.11', '77.90.33.109'];
  for (const host of hosts) {
    const target = host === hosts[0] ? url.toString() : url.toString().replace('online3.skaz.tv', host);
    const t0 = Date.now();
    let status = 0, body = '';
    try {
      const r = await fetch(target, { headers: { accept: '*/*' }, signal: AbortSignal.timeout(12_000) });
      status = r.status;
      body = (await r.text()).slice(0, 260).replace(/\s+/g, ' ');
    } catch (e) {
      status = 0;
      body = String((e && e.name) || e).slice(0, 30);
    }
    console.log('    GET /lite/kodik ' + host + ' → status=' + status + ' (' + (Date.now() - t0) + 'ms) body=' + JSON.stringify(body));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('== trace kodik-005 verdict == email_len=' + EMAIL.length + ' uid_len=' + UID.length + ' userUid=' + USER_UID);
  console.log('  checker: createAvailabilityChecker({ reservePolicy: "abstain", accountEmail, uid })');
  const summary = [];
  for (const film of FILMS) {
    console.log('');
    console.log('═'.repeat(92));
    console.log('FILM ' + film.label + '  serial=' + (film.movie.name ? 1 : 0));
    const q = uiQuery(film.movie);

    console.log('— FIRST open (cold) —');
    const c1 = await checker.card(q, USER_UID);
    printCard('FIRST', c1);
    const k1 = (c1.sources || []).find((r) => r.id === 'kodik');

    await sleep(3500);

    console.log('— SECOND open (3.5s later) —');
    const c2 = await checker.card(q, USER_UID);
    printCard('SECOND', c2);
    const k2 = (c2.sources || []).find((r) => r.id === 'kodik');

    console.log('— raw cluster /lite/kodik (checksearch=true) —');
    await rawClusterBodies(q);

    const flip = (k1 && k1.show) !== (k2 && k2.show);
    summary.push({ label: film.label, first: k1 && k1.show, second: k2 && k2.show, flip, cached: c1.cached + '→' + c2.cached, firstDetail: k1 ? rowDetail(k1) : null });
    if (flip) console.log('  ⚠ ФЛИП kodik: ' + k1 && k1.show + ' → ' + k2 && k2.show);
    await sleep(3500);
  }

  console.log('');
  console.log('='.repeat(92));
  console.log('СВОДКА:');
  for (const s of summary) {
    console.log('  ' + s.label + ': kodik FIRST=' + s.first + ' SECOND=' + s.second +
      (s.flip ? '  ⚠ ФЛИП' : '') + '  cached=' + s.cached);
  }
}

main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });
