// SKAZ-MANIYA-004 §11-15: cross-query 50× sequential (movie/series/episode mixed)
// + videoseed cold-empty классификация. Read-only против SHADOW (3210).
// Инварианты: 0 state-leak между запросами; call-url = 0 ДАЖЕ когда items=0/empty.
// COUNT: found(n>0) / empty(items=0) / callurl / resolve-fail / HTTP-ошибки.
const BASE = 'http://95.85.241.121:3210';
const TOKEN = 'mo-admin-test-2026';

// чередование movie/serial/episode. (title, ot, year, id, imdb, kp, serial)
const TITLES = [
  ['Дом дракона',  'House of the Dragon', '2022', '94997',  'tt11198330', '0',       1], // serial
  ['Интерстеллар', 'Interstellar',        '2014', '157336', 'tt0816692', '462682',   0], // movie
  ['Дюна: Часть вторая', 'Dune: Part Two','2024', '693134', 'tt15239678', '4670204', 0], // movie
  ['Паразиты',     'Parasite',            '2019', '496243', 'tt6751668', '1023498',  0], // movie
  ['Дом дракона',  'House of the Dragon', '2022', '94997',  'tt11198330', '0',       1], // serial again (nav-leak check)
  ['Острые козырьки','Peaky Blinders',    '2013', '60574',  'tt2442560',  '',        1], // another serial
  ['Матрица',      'The Matrix',          '1999', '603',    'tt0133093', '2899',     0], // movie
  ['Дом дракона',  'House of the Dragon', '2022', '94997',  'tt11198330', '0',       1], // serial episode
];

async function getJSON(url, timeout = 50000) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(timeout) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, json: j, text: t }; }
  catch (e) { return { status: 'ERR', json: null, text: String(e).slice(0, 60) }; }
}
const RW = (u) => String(u || '').replace('http://127.0.0.1:3210', BASE);
function isCallItem(item) { return item?.method === 'call'; }
function looksLikeCallUrl(u) {
  // call-url = сырая запись протокола skaz на само cluste (lite/<balancer>/video/…) —
  // НЕ /api/lampa/proxy и НЕ /proxy/. Настоящий resolved поток — /proxy/<hash> или CDN.
  const s = String(u || '');
  if (/\/api\/lampa\/proxy\?/.test(s)) return false;      // Maniya-proxy (resolved)
  if (/\/proxy\/[0-9a-f]{20,}/.test(s)) return false;      // skaz proxied stream
  if (/\/lite\/[a-z0-9-]+\/video\//.test(s)) return true;  // raw call-url → host-bound token
  if (/\/lite\/[a-z0-9-]+\?/.test(s)) return true;
  return false;
}

const stats = { total: 0, found: 0, empty: 0, httpErr: 0, callItems: 0, callUrlAfterResolve: 0, resolveFail: 0, hasResolvedURL: 0, noCallUrl: 0 };
const rows = [];
for (let qi = 0; qi < 50; qi++) {
  const [title, ot, year, id, imdb, kp, serial] = TITLES[qi % TITLES.length];
  const provider = 'skaz-videoseed';
  const q = new URLSearchParams({ token: TOKEN, provider, source: 'tmdb', title, original_title: ot, year, serial: String(serial), id, imdb_id: imdb, kinopoisk_id: kp });
  const v = await getJSON(`${BASE}/api/lampa/videos?${q}`, 60000);
  stats.total++;
  const items = v.json?.items || [];
  const pe = v.json?.provider_error ? ` pe=${v.json.provider_error.code}` : '';
  if (v.status !== 200) { stats.httpErr++; rows.push(`[${qi}] HTTP ${v.status}${pe} "${title}"`); continue; }
  if (!items.length) { stats.empty++; rows.push(`[${qi}] EMPTY items=0 "${title}"${pe} (call-url=0✓)`); continue; }
  stats.found++;
  const it = items[0];
  let line;
  if (isCallItem(it)) {
    stats.callItems++;
    // резолвим call через /api/lampa/video
    const rawUrl = RW(it.url);
    const rurl = rawUrl.startsWith('http')
      ? rawUrl + (rawUrl.includes('?') ? '&' : '?') + `token=${TOKEN}`
      : `${BASE}/api/lampa/video?provider=${provider}&voice=${encodeURIComponent(String(rawUrl || '0'))}&token=${TOKEN}`;
    const resolved = await getJSON(rurl);
    if (resolved.json?.provider_error) { stats.resolveFail++; line = `call→resolve provider_error=${resolved.json.provider_error.code}`; }
    else if (resolved.json?.url) {
      stats.hasResolvedURL++;
      if (looksLikeCallUrl(resolved.json.url)) { stats.callUrlAfterResolve++; line = `call→resolve→CALL-URL ⚠ ${String(resolved.json.url).slice(0,45)}`; }
      else { stats.noCallUrl++; line = `call→resolve→resolved ✓ ${String(resolved.json.url).slice(0,45)}`; }
    }
    else { stats.resolveFail++; line = `call→resolve noURL ${resolved.status} ${resolved.text.slice(0, 40)}`; }
  } else if (it.method === 'play') {
    stats.hasResolvedURL++;
    if (looksLikeCallUrl(it.url)) { stats.callUrlAfterResolve++; line = `play→CALL-URL ⚠ ${String(it.url).slice(0,45)}`; }
    else { stats.noCallUrl++; line = `play resolved ✓ ${String(it.url).slice(0,45)}`; }
  } else {
    line = `method=${it.method} url=${String(it.url).slice(0, 45)}`;
  }
  rows.push(`[${qi}] ${title} (${serial ? 'serial' : 'movie'}) items=${items.length} → ${line}${pe}`);
}

// ==== SUMMARY ====
console.log('\n===== CROSS-QUERY 50× (skaz-videoseed) — SHADOW =====');
for (const r of rows) console.log(RW(r).replace(new RegExp(TOKEN, 'g'), '***'));
console.log('\n====== COUNTS ======');
console.log(JSON.stringify(stats, null, 2));
console.log(`ИТОГ: found=${stats.found} empty=${stats.empty} httpErr=${stats.httpErr} callUrlAfterResolve=${stats.callUrlAfterResolve} resolveFail=${stats.resolveFail} hasResolvedURL=${stats.hasResolvedURL}`);
console.log('DONE');
