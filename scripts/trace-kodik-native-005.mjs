// READ-ONLY: сравнение native Kodik API vs кластерный checksearch (skaz-kodik)
// для фильмов, где card даёт kodik=show:false (Матрица, Интерстеллар) и true (Форрест).
// Вопрос: card=false — это ИСТИНА (контента нет) или ЛОЖНОЕ скрытие (native находит)?
import { pathToFileURL } from 'node:url';
import path from 'node:path';
// SECURITY-001: creds только из env → temp (см. _creds.mjs)
import { loadUserA } from './_creds.mjs';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const serverRoot = path.join(here, '..', 'server');
const resolve = (rel) => pathToFileURL(path.join(serverRoot, rel)).href;
const { KodikProvider } = await import(resolve('src/providers/kodik/KodikProvider.js'));
const { config } = await import(resolve('src/config.js'));
const userA = loadUserA();
const BASE = 'https://plugin.maniya-kvn.online';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FILMS = [
  { label: 'Форрест Гамп', query: { id: '13', imdb_id: 'tt0109830', title: 'Форрест Гамп', original_title: 'Forrest Gump', serial: 0, year: '1994', original_language: 'en', source: 'tmdb' } },
  { label: 'Матрица', query: { id: '603', imdb_id: 'tt0133093', kinopoisk_id: '301', title: 'Матрица', original_title: 'The Matrix', serial: 0, year: '1999', original_language: 'en', source: 'tmdb' } },
  { label: 'Интерстеллар', query: { id: '157336', imdb_id: 'tt0816692', title: 'Интерстеллар', original_title: 'Interstellar', serial: 0, year: '2014', original_language: 'en', source: 'tmdb' } }
];

async function get(url, timeout = 30000) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { accept: '*/*' }, signal: AbortSignal.timeout(timeout) });
    const text = await r.text().catch(() => null);
    return { status: r.status, ms: Date.now() - t0, text, first: text ? text.split(/\r?\n/,1)[0].slice(0,60).replace(/\s+/g,' ') : '' };
  } catch (e) { return { status: 0, ms: Date.now() - t0, text: null, first: 'ERR ' + String((e&&e.message)||e).slice(0,40) }; }
}

async function nativeKodik(query) {
  const kp = new KodikProvider({ enabled: config.kodik.enabled, apiHost: config.kodik.apiHost, linkHost: config.kodik.linkHost, playerHost: config.kodik.playerHost, token: config.kodik.token, secretToken: config.kodik.secretToken });
  try {
    const r = await kp.search(query);
    return { found: Boolean(r && r.length), count: r ? r.length : 0, first: r && r[0] ? { title: String(r[0].title||'').slice(0,30), year: r[0].year } : null };
  } catch (e) { return { found: false, count: 0, err: String((e&&e.message)||e).slice(0,50) }; }
}

async function clusterKodik(query, mode) {
  // Прямой GET на кластер /lite/kodik (как availability.buildUrl + checksearch)
  const hosts = ['http://online3.skaz.tv', 'http://online8.skaz.tv'];
  const out = [];
  for (const host of hosts) {
    const u = new URL(`${host}/lite/kodik`);
    for (const [k,v] of Object.entries({ id: query.id, imdb_id: query.imdb_id, kinopoisk_id: query.kinopoisk_id, title: query.title, original_title: query.original_title, serial: query.serial, year: query.year, original_language: query.original_language, source: 'tmdb' })) {
      if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    }
    if (mode === 'check') u.searchParams.set('checksearch', 'true');
    u.searchParams.set('account_email', config.skaz.accountEmail);
    u.searchParams.set('uid', config.skaz.uid);
    const r = await get(u.toString());
    out.push({ host, mode, status: r.status, ms: r.ms, first: r.first, content: r.text && r.text.length > 40 && r.status === 200 });
  }
  return out;
}

async function main() {
  console.log('== kodik native vs cluster == token_len=' + userA.token.length);
  for (const f of FILMS) {
    console.log('');
    console.log('═══ ' + f.label + ' ═══');
    const native = await nativeKodik(f.query);
    console.log('  NATIVE Kodik API search: found=' + native.found + ' count=' + native.count + (native.first ? ' first=' + JSON.stringify(native.first) : '') + (native.err ? ' err=' + native.err : ''));
    const cluster = await clusterKodik(f.query, 'check');
    for (const c of cluster) console.log('  CLUSTER ' + c.mode + ' ' + c.host + ': status=' + c.status + ' ms=' + c.ms + ' content=' + c.content + ' first=[' + c.first + ']');
    await sleep(1200);
    // прямой lite-page (без checksearch) — механизм подтверждения «нет»
    const direct = await clusterKodik(f.query, 'direct');
    for (const c of direct) console.log('  CLUSTER ' + c.mode + ' ' + c.host + ': status=' + c.status + ' ms=' + c.ms + ' content=' + c.content + ' first=[' + c.first + ']');
    await sleep(1200);
  }
  console.log('');
  console.log('DONE');
}
main().catch((e) => { console.error('FATAL ' + (e.stack || e.message)); process.exitCode = 1; });
