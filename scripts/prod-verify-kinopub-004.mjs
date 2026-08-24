// BALANCER-KINOPUB-004 — PRODUCTION VERIFICATION после deploy f3d387e.
// Проверяет ЧЕРЕЗ ЖИВОЙ ПРОД-API (https://plugin.maniya-kvn.online), что фикс
// navigation по similar-ссылкам реально работает:
//   Одиссея 2026 (1368337)        → items=0 (НЕ postid 1362 / 1997)
//   Последний дом 2026 (1284041)  → items=0 (НЕ postid 2536 / 2009)
//   Интерстеллар 2014 (157336)    → items>0, выбрана карточка postid 8613
//   Форрест Гамп (13)             → items>0
//   Матрица (603)                 → items>0
//   Дом Дракона serial (94997)    → сериал: сезоны/серии работают (items>0)
// Плюс: playback первого item (GET 2xx), card-проверка kinopub show для
// STABILITY-002 (Дом Дракона + FG), online8 abstain не задет (availability.js
// вне диффа — проверяется отдельно git diff).
// Секреты не печатаются. Вердикт — последней строкой.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
// SECURITY-001: creds только из env → temp (см. _creds.mjs)
import { loadUserA, loadClusterEmail, loadClusterUid } from './_creds.mjs';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const serverRoot = path.join(here, '..', 'server');

const BASE = process.env.PROD_BASE_URL || 'https://plugin.maniya-kvn.online';
const userA = loadUserA();
const email = loadClusterEmail();
const uid = loadClusterUid();

const CARDS = [
  { label: 'Одиссея 2026 (1368337)', expect: 'empty', query: { id: '1368337', imdb_id: 'tt33764258', title: 'Одиссея', original_title: 'The Odyssey', original_language: 'en', source: 'tmdb', year: 2026, serial: 0 } },
  { label: 'Последний дом 2026 (1284041)', expect: 'empty', query: { id: '1284041', imdb_id: 'tt32268156', title: 'Последний дом', original_title: 'The Last House', original_language: 'en', source: 'tmdb', year: 2026, serial: 0 } },
  { label: 'Интерстеллар 2014 (157336)', expect: 'movie', query: { id: '157336', imdb_id: 'tt0816692', title: 'Интерстеллар', original_title: 'Interstellar', original_language: 'en', source: 'tmdb', year: 2014, serial: 0 } },
  { label: 'Форрест Гамп (13)', expect: 'movie', query: { id: '13', imdb_id: 'tt0109830', title: 'Форрест Гамп', original_title: 'Forrest Gump', original_language: 'en', source: 'tmdb', year: 1994, serial: 0 } },
  { label: 'Матрица (603)', expect: 'movie', query: { id: '603', imdb_id: 'tt0133093', kinopoisk_id: '301', title: 'Матрица', original_title: 'The Matrix', original_language: 'en', source: 'tmdb', year: 1999, serial: 0 } },
  { label: 'Дом Дракона serial (94997)', expect: 'serial', query: { id: '94997', imdb_id: 'tt11198330', title: 'Дом Дракона', original_title: 'House of the Dragon', original_language: 'en', source: 'tmdb', year: 2022, serial: 1 } }
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byId = (id) => CARDS.find((c) => c.query.id === id);

async function api(path, token, query = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  url.searchParams.set('token', token);
  const t0 = Date.now();
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
  const ms = Date.now() - t0;
  const text = await r.text().catch(() => '');
  let body = null; try { body = JSON.parse(text); } catch { body = null; }
  return { status: r.status, ms, body, raw: text.slice(0, 120) };
}

async function head(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(String(url), { method: 'GET', headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(15000), redirect: 'follow' });
    const len = Number(r.headers.get('content-length') || 0);
    return { ok: r.status === 200 || r.status === 206, status: r.status, ms: Date.now() - t0, len, ctype: String(r.headers.get('content-type') || '').slice(0, 30) };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, len: 0, err: String((e && e.message) || e).slice(0, 40) };
  }
}

async function main() {
  if (!userA) { console.log('FATAL: нет токена (PROD_TOKEN или temp-файл, см. _creds.mjs)'); process.exitCode = 1; return; }
  console.log('== prod-verify kinopub-004 == base=' + BASE);
  const results = { pass: true, videos: {}, postid: {}, playback: {}, card: {}, notes: [] };

  // 1) videos по API для всех карточек
  for (const card of CARDS) {
    const r = await api('/api/lampa/videos', userA.token, { ...card.query, provider: 'skaz-kinopub', source: 'tmdb' });
    const body = r.body;
    const items = (body && Array.isArray(body.items)) ? body.items.length : 0;
    const seasons = (body && Array.isArray(body.seasons)) ? body.seasons.length : 0;
    results.videos[card.query.id] = { items, seasons };
    const ok = card.expect === 'empty' ? items === 0 : (items > 0 && (card.expect !== 'serial' || seasons > 0));
    if (!ok) { results.pass = false; results.notes.push(card.query.id + ': videos ' + card.expect + ' ожидание не сошлось (items=' + items + ' seasons=' + seasons + ')'); }
    const first = items && body.items[0] ? { title: String(body.items[0].title || '').slice(0, 30), url: String(body.items[0].url || body.items[0].stream || '').slice(0, 60) } : null;
    console.log(`  videos ${card.label}: items=${items} seasons=${seasons} status=${r.status} ms=${r.ms}${first ? ' first=' + JSON.stringify(first) : ''} → ${ok ? 'OK' : 'ПРОВЕРИТЬ'}`);
    await sleep(3000);
  }

  // 2) Интерстеллар — подтверждение выбранной карточки postid=8613 через
  //    задеплоенный код навигации (живой кластер). Используем SkazProvider.
  try {
    const { SkazProvider } = await import(pathToFileURL(path.join(serverRoot, 'src/providers/skaz/SkazProvider.js')).href);
    const q = byId('157336').query;
    const p = new SkazProvider({ id: 'skaz-kinopub', title: 'kinopub', balancer: 'kinopub', hosts: ['http://online3.skaz.tv', 'http://online8.skaz.tv'], accountEmail: email, uid });
    const firstHtml = await p.client.getLite(p.buildPageParams(q));
    const navCards = firstHtml ? p.normalizer.cards(firstHtml) : [];
    const href = p.movieHref(navCards, q);
    const picked = String(href || '').match(/postid=(\d+)/);
    const postid = picked ? picked[1] : 'none';
    results.postid['157336'] = postid;
    console.log(`  Интерстеллар: movieHref выбрал postid=${postid}${postid === '8613' ? ' → OK (правильная карточка 2014)' : ' → ПРОВЕРИТЬ (ожидали 8613)'}`);
    if (postid !== '8613') { results.pass = false; results.notes.push('157336: postid != 8613'); }
    await sleep(1500);
  } catch (e) {
    console.log('  postid check ERR ' + String((e && e.message) || e).slice(0, 60));
    results.pass = false; results.notes.push('postid check failed');
  }

  // 3) playback первого item для рабочих фильмов (Интерстеллар/Форрест Гамп/Матрица)
  for (const id of ['157336', '13', '603']) {
    const card = byId(id);
    const r = await api('/api/lampa/videos', userA.token, { ...card.query, provider: 'skaz-kinopub', source: 'tmdb' });
    const items = (r.body && Array.isArray(r.body.items)) ? r.body.items : [];
    const target = items.find((it) => it.url || it.stream) || items[0];
    if (!target) { results.playback[id] = { ok: false, err: 'нет items' }; console.log(`  playback ${card.label}: нет items`); continue; }
    const playUrl = String(target.stream || target.url || '');
    const h = await head(playUrl);
    results.playback[id] = { ok: h.ok, status: h.status, ms: h.ms, len: h.len, ctype: h.ctype, url: playUrl.slice(0, 55) };
    console.log(`  playback ${card.label}: ${h.ok ? 'OK' : 'ПРОВЕРИТЬ'} status=${h.status} ms=${h.ms} len=${h.len} type=${h.ctype} url=${playUrl.slice(0, 55)}`);
    if (!h.ok) { results.pass = false; results.notes.push(id + ': playback first item не 2xx'); }
    await sleep(3000);
  }

  // 4) STABILITY-002: kinopub show на card для Дом Дракона + Форрест Гамп
  for (const id of ['94997', '13']) {
    const card = byId(id);
    const r = await api('/api/lampa/sources/card', userA.token, { ...card.query, source: 'tmdb' });
    const row = (r.body && r.body.sources ? r.body.sources : []).find((s) => s.id === 'skaz-kinopub');
    const show = row ? row.show : null;
    const meta = r.body && r.body.meta;
    results.card[id] = show;
    console.log(`  card ${card.label}: kinopub=${show === true ? 'show' : show === false ? 'HIDE' : 'n/a'} first=${meta && meta.elapsed_ms}ms cached=${meta && meta.cached}`);
    if (show !== true) { results.pass = false; results.notes.push(id + ': kinopub card не show'); }
    await sleep(4000);
  }

  // 5) GAP-003 (pre-existing): Одиссея/Последний дом card=hide при items=0 — теперь консистентно
  const odysseyCard = await api('/api/lampa/sources/card', userA.token, { ...byId('1368337').query, source: 'tmdb' });
  const odRow = (odysseyCard.body && odysseyCard.body.sources || []).find((s) => s.id === 'skaz-kinopub');
  console.log(`  GAP-003: Одиссея card kinopub=${odRow ? (odRow.show === true ? 'show' : 'HIDE') : 'n/a'} (items=0 — hide теперь факт, а не ложный show)`);
  await sleep(3000);

  console.log('');
  console.log('='.repeat(70));
  console.log('VERDICT: ' + (results.pass ? 'PASS' : 'FAIL'));
  if (results.notes.length) console.log('  notes: ' + results.notes.join('; '));
  console.log('  videos=' + JSON.stringify(results.videos) + ' postid=' + JSON.stringify(results.postid) + ' playback=' + JSON.stringify(results.playback) + ' card=' + JSON.stringify(results.card));
}

main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });
