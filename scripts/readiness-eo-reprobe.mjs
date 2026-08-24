// PROJECT-READINESS-001 — READ-ONLY re-probe EO lite/events для карточек, где в
// основной матрице проба не добрала ready=true (Матрица: ready=false total=0) или
// вернула частичный набор (ready=false total=27/29). Только GET. Ничего не меняет.
import { writeFileSync } from 'node:fs';
// SECURITY-001: creds только из env → temp (см. _creds.mjs)
import { loadClusterEmail, loadClusterUid } from './_creds.mjs';

const CLUSTER_HOST = process.env.EO_HOST || 'http://online3.skaz.tv';
const EMAIL = loadClusterEmail();
const UID = loadClusterUid();

// ВАЖНО: форма запроса ДОЛЖНА совпадать с readiness-matrix.mjs (release_date, без
// serial=0/year=1999) — вчерашний прогон с serial/year давал HTTP 400 от кластера.
const FILMS = [
  { label: 'Матрица (603)', movie: { id: '603', title: 'Матрица', original_title: 'The Matrix', release_date: '1999-03-30', original_language: 'en', source: 'tmdb', imdb_id: 'tt0133093', kinopoisk_id: '301', tmdb_id: '603' } },
  { label: 'Интерстеллар (157336)', movie: { id: '157336', title: 'Интерстеллар', original_title: 'Interstellar', release_date: '2014-11-05', original_language: 'en', source: 'tmdb', imdb_id: 'tt0816692', tmdb_id: '157336' } }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function eoReference(query, maxPolls = 30) {
  const url = new URL(CLUSTER_HOST + '/lite/events');
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('life', 'true');
  url.searchParams.set('account_email', EMAIL);
  url.searchParams.set('uid', UID);
  const t0 = Date.now();
  let ready = false, arr = [];
  try {
    const r = await fetch(url, { headers: { accept: '*/*' }, signal: AbortSignal.timeout(60000) });
    const j = JSON.parse(await r.text());
    if (j && j.memkey) {
      for (let i = 1; i <= maxPolls; i += 1) {
        await sleep(3000);
        const r2 = await fetch(`${CLUSTER_HOST}/lifeevents?memkey=${j.memkey}`, { headers: { accept: '*/*' }, signal: AbortSignal.timeout(60000) });
        const j2 = JSON.parse(await r2.text());
        arr = j2.online || [];
        if (j2.ready) { ready = true; break; }
      }
    }
  } catch (e) { console.log('  EO fetch error: ' + ((e && e.name) || e)); }
  const show = arr.filter((x) => String(x.show) === 'true').map((x) => String(x.balanser || '').replace(/^(?:rc\/|lite\/)/, ''));
  return { ready, ms: Date.now() - t0, count: arr.length, show };
}

async function main() {
  console.log('== readiness-eo-reprobe == eo=' + CLUSTER_HOST + ' email_len=' + EMAIL.length + ' uid_len=' + UID.length);
  const out = [];
  for (const f of FILMS) {
    console.log('\n' + f.label);
    const eo = await eoReference(f.movie);
    console.log('  ready=' + eo.ready + ' ms=' + eo.ms + ' total=' + eo.count + ' show=' + eo.show.length);
    console.log('  EO show: ' + eo.show.join(', '));
    out.push({ label: f.label, ...eo });
    await sleep(4000);
  }
  writeFileSync('C:/Users/Admin/AppData/Local/Temp/readiness-eo-reprobe.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('\nJSON: C:/Users/Admin/AppData/Local/Temp/readiness-eo-reprobe.json');
}

main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });
