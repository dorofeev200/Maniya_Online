// BALANCER-KODIK-005 — READ-ONLY поллинг состояния кластера /lite/kodik для
// Фильмов, чтобы понять: кластер флапает 503↔200↔accsdb для ОДНОГО запроса или
// поведение стабильно per-film? В моменты переключения вызываем
// checker.card(force=true) и смотрим вердикт kodik (показ/скрытие следует).
// Только GET. Ничего не меняет.
import { createHash } from 'node:crypto';
// SECURITY-001: creds только из env → temp (см. _creds.mjs)
import { loadUserA, loadClusterEmail, loadClusterUid } from './_creds.mjs';

process.env.KODIK_TOKEN = process.env.KODIK_TOKEN || 'repro';
const { createAvailabilityChecker, checkSearchPredicate } = await import('../server/src/availability.js');

const userA = loadUserA();
const EMAIL = loadClusterEmail();
const UID = loadClusterUid();
const USER_UID = createHash('sha256').update(userA.token).digest('hex').slice(0, 16);

const checker = createAvailabilityChecker({ reservePolicy: 'abstain', accountEmail: EMAIL, uid: UID });

const FILMS = [
  { label: 'Форрест Гамп (13)', movie: { id: '13', title: 'Форрест Гамп', original_title: 'Forrest Gump', release_date: '1994-06-23', original_language: 'en', source: 'tmdb', imdb_id: 'tt0109830', tmdb_id: '13' } },
  { label: 'Матрица (603)', movie: { id: '603', title: 'Матрица', original_title: 'The Matrix', release_date: '1999-03-30', original_language: 'en', source: 'tmdb', imdb_id: 'tt0133093', kinopoisk_id: '301', tmdb_id: '603' } }
];

function uiQuery(movie) {
  return {
    id: movie.id || '', title: movie.title || '', original_title: movie.original_title || '',
    serial: movie.name ? 1 : 0, year: String(movie.release_date || movie.first_air_date || '0000').slice(0, 4),
    original_language: movie.original_language || '', source: movie.source || 'tmdb',
    ...(movie.imdb_id ? { imdb_id: movie.imdb_id } : {}),
    ...(movie.kinopoisk_id ? { kinopoisk_id: movie.kinopoisk_id } : {}),
    ...(movie.tmdb_id ? { tmdb_id: movie.tmdb_id } : {})
  };
}

function buildUrl(host, query) {
  const url = new URL(`http://${host}/lite/kodik`);
  const params = {
    id: String(query.id ?? query.tmdb_id ?? ''), imdb_id: String(query.imdb_id ?? ''),
    kinopoisk_id: String(query.kinopoisk_id ?? ''), title: String(query.title ?? ''),
    original_title: String(query.original_title ?? ''), original_language: String(query.original_language ?? ''),
    serial: query.serial ? 1 : 0, year: String(query.year ?? ''), source: String(query.source || 'tmdb'), checksearch: 'true'
  };
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  url.searchParams.set('account_email', EMAIL);
  url.searchParams.set('uid', UID);
  return url.toString();
}

async function rawStatus(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { accept: '*/*' }, signal: AbortSignal.timeout(12_000) });
    const body = await r.text().catch(() => null);
    let verdict = '';
    if (r.status >= 200 && r.status < 300 && body) {
      const p = checkSearchPredicate(body, {});
      verdict = ' content->' + p.verdict + ' work=' + p.work;
      if (body.trim().startsWith('{') && /"accsdb"\s*:\s*true/i.test(body)) verdict = ' accsdb';
    }
    return { status: r.status, ms: Date.now() - t0, verdict };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, verdict: ' no-response' };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(film, rounds = 6, gapMs = 8000) {
  const q = uiQuery(film.movie);
  const url = buildUrl('online3.skaz.tv', q);
  console.log('');
  console.log('════ poll ' + film.label + '  online3.skaz.tv/lite/kodik ════');
  for (let i = 1; i <= rounds; i += 1) {
    const s = await rawStatus(url);
    console.log('  [' + i + '] status=' + s.status + s.verdict + ' (' + s.ms + 'ms)');
    // В момент переключения (НЕ 503) — принудительный re-probe вердикта
    if (i > 1 && s.status >= 200 && s.status < 300) {
      const c = await checker.card(q, USER_UID, true);
      const k = (c.sources || []).find((r) => r.id === 'kodik');
      console.log('      → checker.card(force=true): kodik show=' + (k && k.show) + ' authoritative=' + (k && k.authoritative) + ' inconclusive=' + (k && k.inconclusive) + ' confirmed=' + (k && k.confirmed) + ' status=' + (k && k.status) + ' host=' + (k && k.host));
    }
    if (i < rounds) await sleep(gapMs);
  }
}

async function main() {
  console.log('== poll kodik-005 == email_len=' + EMAIL.length + ' uid_len=' + UID.length);
  for (const film of FILMS) {
    await poll(film, 6, 8000);
    await sleep(4000);
  }
  console.log('');
  console.log('DONE. Если для одного фильма состояния разные (503↔200↔accsdb) — кластер флапает, и kodik-вердикт следует за ним.');
}

main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });
