// SKAZ-MANIYA-005 §19: 20× benchmark (после здорового env). §15: cold/warm тайминги.
// Читает /videos + resolve (если call) для смеси провайдеров. Подсчёт: 200s, resolve,
// call-url-leak, empty, fail, latency (p50/p95/max). Паузы между запросами (burst §16).
const BASE = process.env.T005_BASE || 'http://95.85.241.121:3210';
const TOKEN = process.env.T005_TOKEN || 'mo-admin-test-2026';
const MODE = process.argv[2] || 'bench20';

async function g(url, ms = 60000) {
  const t0 = Date.now();
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, json: j, text: t, ms: Date.now() - t0 }; }
  catch (e) { return { status: 'ERR', json: null, text: String(e).slice(0, 60), ms: Date.now() - t0 }; }
}
const RW = (u) => String(u || '').replace('http://127.0.0.1:3210', BASE);
function looksLikeCallUrl(u) { const s = String(u || ''); if (/\/api\/lampa\/(proxy|video|stream)\?/.test(s)) return false; if (/\/proxy\/[0-9a-f]{20,}/.test(s)) return false; if (/\/lite\/[a-z0-9-]+\/(video\/|\?)/.test(s)) return true; return false; }

const POOL = [
  ['skaz-videoseed', 'Дом дракона', 'House of the Dragon', '2022', '94997', 'tt11198330', '', 1],
  ['skaz-videoseed', 'Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682', 0],
  ['skaz-kinopub', 'Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 0],
  ['kodik', 'Паразиты', 'Parasite', '2019', '496243', 'tt6751668', '1023498', 0],
  ['skaz-alloha', 'Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 0],
  ['skaz-veoveo', 'Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 0],
  ['rezka', 'Дом дракона', 'House of the Dragon', '2022', '94997', 'tt11198330', '', 1],
  ['skaz-videoseed', 'Матрица', 'The Matrix', '1999', '603', 'tt0133093', '2899', 0],
];

async function one(t) {
  const [provider, title, ot, year, id, imdb, kp, serial] = t;
  const vq = new URLSearchParams({ token: TOKEN, provider, source: 'tmdb', title, original_title: ot, year, serial: String(serial), id, imdb_id: imdb, kinopoisk_id: kp });
  const t0 = Date.now();
  const v = await g(`${BASE}/api/lampa/videos?${vq}`, 60000);
  const vms = Date.now() - t0;
  if (v.status !== 200) return { ok: false, why: `videos_http${v.status}`, ms: vms };
  const items = v.json?.items || [];
  if (!items.length) { /* не считаем empty за fail — это content/провайдер отсутствие */ return { ok: false, why: 'videos_empty' + (v.json?.provider_error?.code || ''), ms: vms }; }
  let it = items[0];
  if (it.method === 'call') {
    const t2 = Date.now();
    const r = await g(RW(it.url), 60000);
    const rms = Date.now() - t2;
    if (r.status !== 200) return { ok: false, why: `resolve_http${r.status}`, ms: vms + rms };
    const p = r.json;
    if (!p?.url) return { ok: false, why: 'resolve_nourl', ms: vms + rms };
    if (looksLikeCallUrl(p.url)) return { ok: false, why: 'CALLURL_LEAK', ms: vms + rms };
    return { ok: true, why: 'resolve', ms: vms + rms };
  }
  // play direct
  if (looksLikeCallUrl(it.url)) return { ok: false, why: 'CALLURL_LEAK', ms: vms };
  return { ok: true, why: 'play', ms: vms };
}

(async () => {
  if (MODE === 'bench20') {
    console.log('\n===== §19 BENCHMARK 20× (смесь провайдеров, паузы = burst §16) =====');
    const lat = []; let ok = 0, fail = 0, leak = 0, empty = 0; const rows = [];
    for (let i = 0; i < 20; i++) {
      const t = POOL[i % POOL.length];
      const r = await one(t);
      lat.push(r.ms);
      if (r.ok) ok++; else if (r.why.includes('CALLURL')) leak++; else if (r.why.includes('empty')) empty++; else fail++;
      rows.push(`[${String(i).padStart(2)}] ${t[0]} «${t[1].slice(0, 10)}» → ${r.ok ? 'OK ' + r.why : r.why} ${r.ms}ms`);
      await new Promise(s => setTimeout(s, 1200));
    }
    for (const l of rows) console.log(l);
    lat.sort((a, b) => a - b);
    const p = (q) => lat[Math.floor(lat.length * q)];
    console.log(`\nlatency: p50=${p(0.5)}ms p95=${p(0.95)}ms max=${lat[lat.length - 1]}ms n=${lat.length}`);
    console.log(`ok=${ok} empty=${empty} callurl-leak=${leak} fail=${fail}`);
    console.log((ok >= 16 && leak === 0) ? `PASS: resolved=${ok}/20, call-url-leak=${leak}` : 'CHECK');
  } else if (MODE === 'coldwarm') {
    console.log('\n===== §15 COLD vs WARM (skaz-videoseed «Дом дракона») =====');
    const q = new URLSearchParams({ token: TOKEN, provider: 'skaz-videoseed', source: 'tmdb', title: 'Дом дракона', original_title: 'House of the Dragon', year: '2022', serial: '1', id: '94997', imdb_id: 'tt11198330', kinopoisk_id: '' });
    const u = `${BASE}/api/lampa/videos?${q}`;
    // COLD: первый после отдыха (ждём 5с, чтобы сбросить возможный burst-кэш)
    // (cold здесь = недавно не вызывался; реальный cold-cache недостижим без рестарта)
    const times = [];
    for (let i = 0; i < 2; i++) {
      const r = await g(u, 60000);
      times.push(r.ms);
      console.log(`run${i + 1}: HTTP ${r.status} items=${r.json?.items?.length || 0} ${r.ms}ms`);
      await new Promise(s => setTimeout(s, 4000));
    }
    console.log('WARM=run2 (после run1 прогрев) — сравнить');
  }
  console.log('DONE');
})();
