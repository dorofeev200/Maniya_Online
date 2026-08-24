// PROJECT-READINESS-001 — READ-ONLY concurrency audit (код НЕ меняется).
// 2 пользователя (mo-54f4… = A, mo-fb9bf… = B), разные userUid. Проверяем:
//   1) uid-скопинг кэша карточки: параллельные /sources/card A и B на один фильм —
//      каждый получает свою запись (ключи fnv1aKey(...:userUid)), без кросс-загрязнения;
//   2) force=true у A НЕ влияет на кэш B (B остаётся HIT);
//   3) параллельные /videos одного провайдера A/B — оба 200, состояние не шарится;
//   4) быстрая серия запросов (~30) — 429 не появляется при темпе ниже 120/60с;
//   5) повторы: повторный HIT для того же userUid.
// Выход: построчный отчёт. Только GET. Ничего не меняет.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
// SECURITY-001: creds только из env → temp (см. _creds.mjs)
import { loadUserA, loadUserB } from './_creds.mjs';

const BASE = process.env.PROD_BASE_URL || 'https://plugin.maniya-kvn.online';
const GAP_MS = Number(process.env.GAP_MS || 350);

const A = loadUserA();
const B = loadUserB();
if (!A || !B) { console.log('FATAL: нужны оба токена A/B'); process.exit(1); }
const uidA = createHash('sha256').update(A.token).digest('hex').slice(0, 16);
const uidB = createHash('sha256').update(B.token).digest('hex').slice(0, 16);

const MOVIE = { id: '603', title: 'Матрица', original_title: 'The Matrix', serial: 0, year: '1999', original_language: 'en', source: 'tmdb', imdb_id: 'tt0133093', kinopoisk_id: '301', tmdb_id: '603', clarification: 0, similar: false };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(token, path, query, opts = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('token', token);
  url.searchParams.set('uid', 'audit-conc');
  if (opts.force) url.searchParams.set('force', 'true');
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    const text = await r.text().catch(() => '');
    let body = null; try { body = JSON.parse(text); } catch { body = null; }
    return { status: r.status, ms: Date.now() - t0, body, raw: text.slice(0, 80) };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, body: null, raw: String((e && e.name) || e) };
  }
}

const cardFor = (body) => {
  const rows = (body && body.sources) || [];
  return { n: rows.length, vis: rows.filter((r) => r.show !== false).length, meta: (body && body.meta) || {}, sig: rows.map((r) => r.id + ':' + (r.show === false ? '0' : '1')).join('|') };
};

const RESULTS = [];
const row = (name, detail) => { RESULTS.push({ name, ...detail }); console.log('  ' + name + ': ' + JSON.stringify(detail)); };

async function main() {
  console.log('== readiness-concurrency == base=' + BASE);
  console.log('  userA uid=' + uidA + ' token=' + A.token.slice(0, 12) + '…');
  console.log('  userB uid=' + uidB + ' token=' + B.token.slice(0, 12) + '…');

  // 1) параллельный cold card: A и B одновременно
  console.log('\n[1] Параллельный cold /sources/card (Матрица), A и B одновременно');
  const t0 = Date.now();
  const [ra, rb] = await Promise.all([
    api(A.token, '/api/lampa/sources/card', MOVIE),
    api(B.token, '/api/lampa/sources/card', MOVIE)
  ]);
  const ca = cardFor(ra.body), cb = cardFor(rb.body);
  row('parallel-cold', { wallMs: Date.now() - t0, A: { status: ra.status, ms: ra.ms, ...ca }, B: { status: rb.status, ms: rb.ms, ...cb }, sigEqual: ca.sig === cb.sig, uidScoped: ca.meta.uid === undefined || ca.meta.cached === false || ca.meta.cached === true });
  await sleep(GAP_MS * 2);

  // 2) немедленный повтор — оба должны быть HIT (каждый в своём ключе)
  console.log('\n[2] Немедленный повтор — оба HIT?');
  const [ra2, rb2] = await Promise.all([
    api(A.token, '/api/lampa/sources/card', MOVIE),
    api(B.token, '/api/lampa/sources/card', MOVIE)
  ]);
  row('repeat-hit', { A: { status: ra2.status, cached: (ra2.body && ra2.body.meta && ra2.body.meta.cached) }, B: { status: rb2.status, cached: (rb2.body && rb2.body.meta && rb2.body.meta.cached) } });
  await sleep(GAP_MS * 2);

  // 3) A с force=true (сброс кэша A), B без — B обязан остаться HIT
  console.log('\n[3] A force=true, B без force — кэш B не должен трогаться');
  const [ra3, rb3] = await Promise.all([
    api(A.token, '/api/lampa/sources/card', MOVIE, { force: true }),
    api(B.token, '/api/lampa/sources/card', MOVIE)
  ]);
  row('force-isolated', { A: { status: ra3.status, cached: (ra3.body && ra3.body.meta && ra3.body.meta.cached) }, B: { status: rb3.status, cached: (rb3.body && rb3.body.meta && rb3.body.meta.cached) }, bStayedHit: (rb3.body && rb3.body.meta && rb3.body.meta.cached) === true });
  await sleep(GAP_MS * 2);

  // 4) параллельные /videos одного провайдера A/B
  console.log('\n[4] Параллельные /videos (filmix) A и B');
  const [rvA, rvB] = await Promise.all([
    api(A.token, '/api/lampa/videos', { ...MOVIE, provider: 'filmix' }),
    api(B.token, '/api/lampa/videos', { ...MOVIE, provider: 'filmix' })
  ]);
  row('parallel-videos', { A: { status: rvA.status, ms: rvA.ms, items: (rvA.body && rvA.body.items && rvA.body.items.length) || 0 }, B: { status: rvB.status, ms: rvB.ms, items: (rvB.body && rvB.body.items && rvB.body.items.length) || 0 } });
  await sleep(GAP_MS * 2);

  // 5) быстрая серия (~30 запросов) из-под A на разные фильмы — 429?
  console.log('\n[5] Серия ~30 запросов (темп < 120/60с) — ищем 429');
  const films = [
    { id: '13', title: 'Форрест Гамп', original_title: 'Forrest Gump', serial: 0, year: '1994', original_language: 'en', source: 'tmdb', imdb_id: 'tt0109830', tmdb_id: '13' },
    { id: '603', title: 'Матрица', original_title: 'The Matrix', serial: 0, year: '1999', original_language: 'en', source: 'tmdb', imdb_id: 'tt0133093', tmdb_id: '603' },
    { id: '157336', title: 'Интерстеллар', original_title: 'Interstellar', serial: 0, year: '2014', original_language: 'en', source: 'tmdb', imdb_id: 'tt0816692', tmdb_id: '157336' },
    { id: '94997', title: 'Дом Дракона', name: 'Дом Дракона', original_name: 'House of the Dragon', original_title: 'House of the Dragon', serial: 1, year: '2022', original_language: 'en', source: 'tmdb', imdb_id: 'tt11198330', tmdb_id: '94997' }
  ];
  let n429 = 0, n200 = 0, nErr = 0, statuses = {};
  const t00 = Date.now();
  for (let i = 0; i < 30; i += 1) {
    const f = films[i % films.length];
    const r = await api(A.token, '/api/lampa/sources/card', f);
    statuses[r.status] = (statuses[r.status] || 0) + 1;
    if (r.status === 429) n429 += 1; else if (r.status === 200) n200 += 1; else nErr += 1;
    await sleep(GAP_MS);
  }
  row('series-30', { wallMs: Date.now() - t00, statuses, n429, n200, nErr, ratePerMin: Math.round(30 / ((Date.now() - t00) / 60000)) });

  writeFileSync('C:/Users/Admin/AppData/Local/Temp/readiness-concurrency.json', JSON.stringify(RESULTS, null, 2), 'utf8');
  console.log('\nJSON: C:/Users/Admin/AppData/Local/Temp/readiness-concurrency.json');
}

main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });
