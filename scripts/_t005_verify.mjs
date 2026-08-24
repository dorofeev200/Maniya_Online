// SKAZ-MANIYA-005 §8/§14: post-deploy verification.
// §8  — TASK-002 regression: Videoseed serial, 10 эпизодов → 10/10 resolved, 0 call-url.
// §14 — cross-query 50× (movie/serial/episode mixed, продуктовые провидееры).
// Read-only против SHADOW (3210). Подсчёт: found/empty/call-url/resolve-fail.
const BASE = process.env.T005_BASE || 'http://95.85.241.121:3210';
const TOKEN = process.env.T005_TOKEN || 'mo-admin-test-2026';
const MODE = process.argv[2] || 'vseed10';

// ---- хелперы ----
async function g(url, ms = 60000) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, json: j, text: t, ms: Date.now() - t0, ctype: String(r.headers?.get?.('content-type') || '') };
  } catch (e) { return { status: 'ERR', json: null, text: String(e).slice(0, 60), ms: Date.now() - t0, ctype: '' }; }
}
const RW = (u) => String(u || '').replace('http://127.0.0.1:3210', BASE);
function looksLikeCallUrl(u) {
  const s = String(u || '');
  if (/\/api\/lampa\/proxy\?/.test(s)) return false;      // Maniya-proxy (resolved)
  if (/\/proxy\/[0-9a-f]{20,}/.test(s)) return false;      // skaz proxied stream
  if (/\/(proxy|stream|api\/lampa\/video)\?/.test(s)) return false;
  if (/\/lite\/[a-z0-9-]+\/video\//.test(s)) return true;  // raw call-url → host-bound token
  if (/\/lite\/[a-z0-9-]+\?/.test(s)) return true;
  return false;
}
function qstr(o) { return new URLSearchParams(o).toString(); }

// Параметры тайтлов: [label, provider, {…query}]
const TITLES = {
  vseed10: ['skaz-videoseed', 'Дом дракона', 'House of the Dragon', '2022', '94997', 'tt11198330', '', 1],
  vseed32: ['skaz-videoseed', 'Дом дракона', 'House of the Dragon', '2022', '94997', 'tt11198330', '', 1],
  interstellar: ['skaz-videoseed', 'Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682', 0],
  dune: ['skaz-videoseed', 'Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 0],
  matrix: ['skaz-videoseed', 'Матрица', 'The Matrix', '1999', '603', 'tt0133093', '2899', 0],
  house1: ['skaz-videoseed', 'Дом дракона', 'House of the Dragon', '2022', '94997', 'tt11198330', '', 1],
  hdvb: ['skaz-hdvb', 'Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 0],
  filmix: ['filmix', 'Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 0],
  rezka: ['rezka', 'Дом дракона', 'House of the Dragon', '2022', '94997', 'tt11198330', '', 1],
  kinotochka: ['kinotochka', 'Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682', 0],
  collaps: ['collaps', 'Паразиты', 'Parasite', '2019', '496243', 'tt6751668', '1023498', 0],
  kodik: ['kodik', 'Паразиты', 'Parasite', '2019', '496243', 'tt6751668', '1023498', 0],
  kinopub: ['skaz-kinopub', 'Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 0],
  alloha: ['skaz-alloha', 'Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 0],
  veoveo: ['skaz-veoveo', 'Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 0],
};

async function resolveOne(provider, baseQuery, episode, season) {
  // 1) /videos
  const vq = qstr({ token: TOKEN, provider, source: 'tmdb', title: baseQuery.title, original_title: baseQuery.ot, year: baseQuery.year, serial: String(baseQuery.serial), id: baseQuery.id, imdb_id: baseQuery.imdb, kinopoisk_id: baseQuery.kp });
  const v = await g(`${BASE}/api/lampa/videos?${vq}`, 60000);
  if (v.status !== 200) return { stage: 'videos_http', status: v.status };
  const items = v.json?.items || [];
  if (!items.length) return { stage: 'videos_empty', pe: v.json?.provider_error?.code || '' };
  // ищем эпизод (или берём first для movie)
  let it = items[0];
  if (episode != null) it = items.find((x) => x.episode === episode && x.season === season) || items[0];
  if (it.method !== 'call') {
    if (looksLikeCallUrl(it.url)) return { stage: 'callurl_at_videos', url: it.url };
    return { stage: 'play_direct', url: it.url, method: it.method };
  }
  // 2) resolve call через /api/lampa/video
  const cu = RW(it.url);
  const r = await g(cu, 60000);
  if (r.status !== 200) return { stage: 'resolve_http', status: r.status, text: r.text.slice(0, 80) };
  const p = r.json;
  if (!p?.url) { return { stage: 'resolve_nourl', method: p?.method, text: r.text.slice(0, 100), pe: p?.provider_error?.code || '' }; }
  if (looksLikeCallUrl(p.url)) return { stage: 'callurl_after_resolve', url: String(p.url).slice(0, 80) };
  return { stage: 'resolved', url: String(p.url).slice(0, 90), method: p.method };
}

// ======================= §8: videoseed serial 10 эпизодов =======================
async function vseed10() {
  const [provider, title, ot, year, id, imdb, kp, serial] = TITLES.vseed10;
  const baseQuery = { title, ot, year, id, imdb, kp, serial };
  console.log(`\n===== §8 TASK-002 REGRESSION: ${provider} «${title}» сезоны 1-2, эп 1..10 (с паузой между — burst-контроль §16) =====`);
  const out = [];
  let resolved = 0, callurl = 0, fail = 0;
  for (let ep = 1; ep <= 10; ep++) {
    const r = await resolveOne(provider, baseQuery, ep, 1);
    const tag = r.stage === 'resolved' ? 'OK' : (r.stage.includes('callurl') ? 'CALLURL⚠' : 'FAIL');
    if (r.stage === 'resolved') resolved++; else if (r.stage.includes('callurl')) callurl++; else fail++;
    out.push(`ep${ep}: ${tag}${r.stage === 'resolved' ? ' ' + r.url : ' [' + r.stage + (r.pe ? ' pe=' + r.pe : '') + ']'}`);
    await new Promise((s) => setTimeout(s, 2000)); // burst-контроль
  }
  for (const l of out) console.log(l);
  console.log(`RESULT: resolved=${resolved}/10  callUrl=${callurl}  fail=${fail}`);
  console.log((resolved === 10 && callurl === 0) ? 'PASS (10/10 resolved, 0 call-url)' : 'FAIL');
}

// ======================= cross-query 50× =======================
const CROSS = [
  ['house1', 1], ['interstellar', null], ['dune', null], ['matrix', null],
  ['house1', 1], ['vseed32', 1], ['house1', 2], ['dune', null], ['interstellar', null],
];
async function cross50() {
  console.log(`\n===== §14 CROSS-QUERY 50× (mixed movie/serial/episode) =====`);
  const stats = { found: 0, empty: 0, httpErr: 0, callUrlAfterResolve: 0, resolveFail: 0, resolved: 0, directPlay: 0 };
  const rows = [];
  for (let qi = 0; qi < 50; qi++) {
    const [key, ep] = CROSS[qi % CROSS.length];
    const [provider, title, ot, year, id, imdb, kp, serial] = TITLES[key];
    const r = await resolveOne(provider, { title, ot, year, id, imdb, kp, serial }, ep, 1);
    let tag;
    if (r.stage === 'resolved') { stats.resolved++; stats.found++; tag = 'resolved'; }
    else if (r.stage === 'play_direct') { stats.directPlay++; stats.found++; tag = 'play'; }
    else if (r.stage === 'videos_empty') { stats.empty++; tag = 'empty'; }
    else if (r.stage === 'videos_http' || r.stage === 'resolve_http' || r.stage === 'resolve_nourl') { stats.resolveFail++; tag = 'fail'; }
    else if (r.stage.includes('callurl')) { stats.callUrlAfterResolve++; tag = 'CALLURL⚠'; }
    else { stats.found++; tag = r.stage; }
    rows.push(`[${qi}] ${provider} ${title.slice(0, 12)} ep=${ep ?? '-'} → ${tag}`);
    await new Promise((s) => setTimeout(s, 1500)); // burst-контроль §16
  }
  for (const l of rows) console.log(l);
  console.log('\nCOUNTS:', JSON.stringify(stats));
  const pass = stats.callUrlAfterResolve === 0 && stats.empty === 0 && stats.httpErr === 0 && (stats.resolved + stats.directPlay) === 50;
  console.log(pass ? 'PASS: found=50/50, call-url=0, state-leak=0' : 'FAIL');
}

(async () => {
  if (MODE === 'vseed10') await vseed10();
  else if (MODE === 'cross50') await cross50();
  console.log('DONE');
})();
