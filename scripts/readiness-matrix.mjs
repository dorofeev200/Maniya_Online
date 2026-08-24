// PROJECT-READINESS-001 — READ-ONLY регрессионная матрица (код НЕ меняется).
// Для каждой карточки регресс-матрицы (5 фильмов + 3 сериала):
//   1) Maniya /api/lampa/sources       — статический реестр (состав/порядок);
//   2) Maniya /api/lampa/sources/card  — per-card show/hide (прод-вердикт);
//   3) E-Online reference lite/events  — show/hide эталона (life=true → poll);
//   4) /api/lampa/videos per visible source → items count + первый item;
//   5) PLAYBACK probe: у первых N источников с items>0 резолвим первый играбельный
//      item (call → /api/lampa/video) и делаем реальный HTTP GET (Range 0-1023) на
//      итоговый URL через прод-прокси (или прямой внешний URL). «items>0 ≠ playback» —
//      доказываем живым HTTP-статусом и content-type.
// Выход: построчный отчёт + JSON-дамп в temp. Только GET, ничего не меняет.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
// SECURITY-001: creds только из env → temp (см. _creds.mjs)
import { loadUserA, loadUserB, loadClusterEmail, loadClusterUid } from './_creds.mjs';

const BASE = process.env.PROD_BASE_URL || 'https://plugin.maniya-kvn.online';
const CLUSTER_HOST = process.env.EO_HOST || 'http://online3.skaz.tv';
const GAP_MS = Number(process.env.GAP_MS || 700);
const MAX_PLAYBACK_PROBES = Number(process.env.MAX_PLAYBACK_PROBES || 3);

const userA = loadUserA();
const userB = loadUserB();
if (!userA) { console.log('FATAL: токен A не найден (PROD_TOKEN или temp-файл)'); process.exit(1); }
const EMAIL = loadClusterEmail();
const UID = loadClusterUid();
const USER_UID_A = createHash('sha256').update(userA.token).digest('hex').slice(0, 16);
const USER_UID_B = userB ? createHash('sha256').update(userB.token).digest('hex').slice(0, 16) : null;

const FILMS = [
  { label: 'Форрест Гамп', movie: { id: '13', title: 'Форрест Гамп', original_title: 'Forrest Gump', release_date: '1994-06-23', original_language: 'en', source: 'tmdb', imdb_id: 'tt0109830', tmdb_id: '13' } },
  { label: 'Матрица', movie: { id: '603', title: 'Матрица', original_title: 'The Matrix', release_date: '1999-03-30', original_language: 'en', source: 'tmdb', imdb_id: 'tt0133093', kinopoisk_id: '301', tmdb_id: '603' } },
  { label: 'Интерстеллар', movie: { id: '157336', title: 'Интерстеллар', original_title: 'Interstellar', release_date: '2014-11-05', original_language: 'en', source: 'tmdb', imdb_id: 'tt0816692', tmdb_id: '157336' } },
  { label: 'Одиссея 2026', movie: { id: '1368337', title: 'Одиссея', original_title: 'The Odyssey', release_date: '2026-11-27', original_language: 'en', source: 'tmdb', imdb_id: 'tt33764258', tmdb_id: '1368337' } },
  { label: 'Последний дом 2026', movie: { id: '1284041', title: 'Последний дом', original_title: 'The Last House', release_date: '2026-08-14', original_language: 'en', source: 'tmdb', imdb_id: 'tt32268156', tmdb_id: '1284041' } },
  { label: 'Дом Дракона', movie: { id: '94997', title: 'Дом Дракона', name: 'Дом Дракона', original_name: 'House of the Dragon', original_title: 'House of the Dragon', first_air_date: '2022-08-21', original_language: 'en', source: 'tmdb', imdb_id: 'tt11198330', tmdb_id: '94997' } },
  { label: 'The OA', movie: { id: '71712', title: 'The OA', name: 'The OA', original_name: 'The OA', original_title: 'The OA', first_air_date: '2016-12-16', original_language: 'en', source: 'tmdb', imdb_id: 'tt4491250', tmdb_id: '71712' } },
  { label: 'Укрытие (Silo)', movie: { id: '125988', title: 'Укрытие', name: 'Укрытие', original_name: 'Silo', original_title: 'Silo', first_air_date: '2023-05-04', original_language: 'en', source: 'tmdb', imdb_id: 'tt14688458', tmdb_id: '125988' } }
];

function movieQuery(movie) {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function prodApi(path, query) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('token', userA.token);
  url.searchParams.set('uid', 'audit0001');
  const t0 = Date.now();
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(90000) });
  const ms = Date.now() - t0;
  const text = await r.text().catch(() => '');
  let body = null; try { body = JSON.parse(text); } catch { body = null; }
  return { status: r.status, ms, body, raw: text.slice(0, 120) };
}

async function eoReference(query) {
  // life=true → memkey → poll lifeevents (как клиент E-Online/Lampac)
  const url = new URL(CLUSTER_HOST + '/lite/events');
  for (const [k, v] of Object.entries({ ...query, life: true, rchtype: '' })) {
    if (v !== undefined && v !== null && v !== '' && v !== false) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('account_email', EMAIL);
  url.searchParams.set('uid', UID);
  const t0 = Date.now();
  let ready = false, arr = [];
  try {
    const r = await fetch(url, { headers: { accept: '*/*' }, signal: AbortSignal.timeout(60000) });
    const j = JSON.parse(await r.text());
    if (j && j.memkey) {
      for (let i = 1; i <= 20; i += 1) {
        await sleep(2500);
        const r2 = await fetch(`${CLUSTER_HOST}/lifeevents?memkey=${j.memkey}`, { headers: { accept: '*/*' }, signal: AbortSignal.timeout(60000) });
        const j2 = JSON.parse(await r2.text());
        arr = j2.online || [];
        if (j2.ready) { ready = true; break; }
      }
    }
  } catch { /* cluster не ответил */ }
  const show = new Set();
  for (const x of arr) if (String(x.show) === 'true') show.add(String(x.balanser || '').replace(/^(?:rc\/|lite\/)/, ''));
  return { ready, ms: Date.now() - t0, count: arr.length, show, balancers: arr.map((x) => ({ balanser: String(x.balanser || '').replace(/^(?:rc\/|lite\/)/, ''), show: String(x.show) === 'true' })) };
}

function itemBrief(item) {
  const q = item && item.quality;
  const quals = q && typeof q === 'object' ? Object.keys(q).join(',') : (q || '');
  return {
    method: item && item.method,
    title: String(item && (item.title || '')).slice(0, 28),
    type: item && item.type,
    episode: item && item.episode,
    season: item && item.season,
    voice: String(item && (item.voice_name || '')).slice(0, 16),
    qualities: quals,
    url: String(item && item.url || '').slice(0, 60)
  };
}

async function fetchWithRange(url, extraHeaders = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { accept: '*/*', range: 'bytes=0-1023', ...extraHeaders },
      signal: AbortSignal.timeout(30000),
      redirect: 'follow'
    });
    const buf = Buffer.from(await r.arrayBuffer().catch(() => Buffer.alloc(0)));
    return { status: r.status, ms: Date.now() - t0, len: buf.length, ctype: r.headers.get('content-type') || '', head: buf.slice(0, 12).toString('utf8').replace(/[^\x20-\x7e]/g, '.') };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, len: 0, ctype: '', head: String(e && e.name) };
  }
}

async function playbackProbe(item) {
  // item.method='call' → резолв через /api/lampa/video (как Play в UI)
  let resolved = item;
  if (item.method === 'call' && item.url) {
    const q = {};
    try {
      const u = new URL(item.url);
      for (const [k, v] of u.searchParams.entries()) if (k !== 'token' && k !== 'uid') q[k] = v;
    } catch {}
    const r = await prodApi('/api/lampa/video', q);
    if (r.status !== 200 || !r.body) return { stage: 'resolve', status: r.status, ms: r.ms, error: String(r.body && r.body.error || r.status) };
    resolved = r.body;
  }
  const url = String(resolved.url || item.url || '').trim();
  if (!url) return { stage: 'no-url', status: 0 };
  const urls = url.split(/\s+or\s+/i);
  const target = urls[0];
  const headers = (resolved.headers && typeof resolved.headers === 'object') ? resolved.headers : {};
  const probe = target.startsWith(BASE) || target.includes('/api/lampa/proxy')
    ? await fetchWithRange(target)
    : await fetchWithRange(target, { Origin: 'http://lampa.mx', Referer: 'http://lampa.mx', ...headers });
  return { stage: 'play', status: probe.status, ms: probe.ms, len: probe.len, ctype: probe.ctype, head: probe.head, nUrls: urls.length };
}

const RESULTS = [];

async function checkFilm(film, index) {
  const q = movieQuery(film.movie);
  console.log(`\n${'═'.repeat(100)}`);
  console.log(`[${index + 1}/${FILMS.length}] ${film.label}  id=${q.id} serial=${q.serial}`);
  const row = { label: film.label, id: q.id, serial: q.serial, sources: [], card: null, eo: null, videos: [], playback: [] };

  // 1) статический реестр
  const s = await prodApi('/api/lampa/sources', q);
  const srcList = (s.body && s.body.sources) || [];
  console.log(`  /sources        : status=${s.status} ms=${s.ms} count=${srcList.length} order=${srcList.map((x) => x.id).join(',')}`);
  row.sources = srcList.map((x) => x.id);
  await sleep(GAP_MS);

  // 2) per-card availability (прод)
  const c = await prodApi('/api/lampa/sources/card', q);
  const cardRows = (c.body && c.body.sources) || [];
  const cardMeta = (c.body && c.body.meta) || {};
  const visible = cardRows.filter((x) => x.show !== false).map((x) => x.id);
  const hidden = cardRows.filter((x) => x.show === false).map((x) => x.id);
  console.log(`  /sources/card   : status=${c.status} ms=${c.ms} cached=${cardMeta.cached} elapsed_ms=${cardMeta.elapsed_ms} visible=${visible.length} hidden=${hidden.length}`);
  console.log(`    visible: ${visible.join(', ')}`);
  if (hidden.length) console.log(`    hidden : ${hidden.join(', ')}`);
  row.card = { visible, hidden, cached: cardMeta.cached, elapsed_ms: cardMeta.elapsed_ms };
  await sleep(GAP_MS);

  // 3) E-Online reference
  const eo = await eoReference(q);
  console.log(`  EO lite/events  : ready=${eo.ready} ms=${eo.ms} total=${eo.count} show=${eo.show.size}`);
  console.log(`    EO show: ${[...eo.show].join(', ')}`);
  row.eo = { total: eo.count, show: [...eo.show], balancers: eo.balancers };
  await sleep(GAP_MS);

  // 4) /videos per visible source
  const videos = [];
  for (const src of visible) {
    const v = await prodApi('/api/lampa/videos', { ...q, provider: src });
    const items = (v.body && v.body.items) || [];
    const seasons = (v.body && v.body.seasons) || [];
    const voices = (v.body && v.body.voices) || [];
    const perr = (v.body && v.body.provider_error) || null;
    videos.push({ src, status: v.status, ms: v.ms, items: items.length, seasons: seasons.length, voices: voices.length, provider_error: perr && perr.code, first: items.length ? itemBrief(items[0]) : null });
    console.log(`    videos ${String(src).padEnd(18)} : items=${String(items.length).padEnd(3)} s=${String(seasons.length).padEnd(2)} v=${String(voices.length).padEnd(2)} ms=${String(v.ms).padEnd(5)} ${perr ? 'ERR:' + perr.code : ''}${items.length ? ' first=' + (items[0].method || '?') + '|' + String(items[0].title || '').slice(0, 22) : ''}`);
    await sleep(GAP_MS);
  }
  row.videos = videos;

  // 5) playback probe (первые MAX_PLAYBACK_PROBES источников с items>0)
  const withItems = videos.filter((v) => v.items > 0);
  let probed = 0;
  for (const v of withItems) {
    if (probed >= MAX_PLAYBACK_PROBES) break;
    const vq = { ...q, provider: v.src };
    const pv = await prodApi('/api/lampa/videos', vq);
    const items = (pv.body && pv.body.items) || [];
    if (!items.length) continue;
    const p = await playbackProbe(items[0]);
    row.playback.push({ src: v.src, probe: p, item: itemBrief(items[0]) });
    console.log(`    PLAY ${String(v.src).padEnd(18)} : ${p.stage} status=${p.status} ms=${p.ms} ctype=${String(p.ctype).slice(0, 30)} len=${p.len} head=${p.head}`);
    probed += 1;
    await sleep(GAP_MS * 2);
  }
  RESULTS.push(row);
  return row;
}

const skipFilms = new Set(String(process.env.SKIP_FILMS || '').split(',').filter(Boolean));
async function main() {
  console.log('== readiness-matrix == base=' + BASE + ' eo=' + CLUSTER_HOST + ' gap=' + GAP_MS + ' maxPlayback=' + MAX_PLAYBACK_PROBES);
  console.log('userA uid=' + USER_UID_A + (userB ? ' userB uid=' + USER_UID_B : '') + ' email_len=' + EMAIL.length + ' uid_len=' + UID.length);
  for (let i = 0; i < FILMS.length; i += 1) {
    if (skipFilms.has(String(i + 1))) { console.log(`\n[skip] #${i + 1} ${FILMS[i].label}`); continue; }
    await checkFilm(FILMS[i], i);
    await sleep(GAP_MS * 4);
  }
  const out = 'C:/Users/Admin/AppData/Local/Temp/readiness-matrix.json';
  writeFileSync(out, JSON.stringify(RESULTS, null, 2), 'utf8');
  console.log('\n' + '='.repeat(100));
  console.log('СВОДКА:');
  for (const r of RESULTS) {
    const maniyaV = (r.card && r.card.visible) || [];
    const eoShow = (r.eo && r.eo.show) || [];
    const fp = r.videos.filter((v) => v.items === 0 && maniyaV.includes(v.src)).map((v) => v.src);
    const vsEO = maniyaV.filter((x) => !eoShow.includes(x));
    console.log(`  ${r.label.padEnd(18)}: Maniya visible=${maniyaV.length} EO show=${eoShow.length} | false-positive(videos=0): ${fp.length ? fp.join(',') : '—'} | Maniya-show но EO-hide: ${vsEO.length ? vsEO.join(',') : '—'}`);
  }
  console.log('\nJSON: ' + out);
}

main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });
