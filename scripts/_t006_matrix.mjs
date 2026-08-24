// SKAZ-MANIYA-006 §12-17: production provider matrix + host-bound + cross-query.
// Read-only против PRODUCTION (public HTTPS + nginx + TLS). Base из T006_BASE, токен из T006_TOKEN.
const BASE = process.env.T006_BASE || 'https://plugin.maniya-kvn.online';
const TOKEN = process.env.T006_TOKEN || '';
const MODE = process.argv[2] || 'matrix';

async function g(url, ms = 90000) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, json: j, text: t, ms: Date.now() - t0 };
  } catch (e) { return { status: 'ERR', json: null, text: String(e).slice(0, 60), ms: Date.now() - t0 }; }
}
const RW = (u) => String(u || '').replace(/https?:\/\/127\.0\.0\.1:3000/, BASE).replace(/https?:\/\/plugin\.maniya-kvn\.online/, BASE);
function leak(s) { return /\/lite\/|clearcount|account\?referrer/.test(String(s || '')); }
function q(o) { return new URLSearchParams(o).toString(); }

const PROV = [
  ['videoseed', 'skaz-videoseed', 'Дом дракона', 'House of the Dragon', '2022', '94997', 'tt11198330', '', '1', 1],
  ['rezka', 'rezka', 'Дом дракона', 'House of the Dragon', '2022', '94997', 'tt11198330', '', '1', 1],
  ['filmix', 'filmix', 'Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', '', 0],
  ['hdvb', 'skaz-hdvb', 'Паразиты', 'Parasite', '2019', '496243', 'tt6751668', '1023498', '', 0],
  ['kodik', 'kodik', 'Паразиты', 'Parasite', '2019', '496243', 'tt6751668', '1023498', '', 0],
  ['kinopub', 'skaz-kinopub', 'Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', '', 0],
  ['alloha', 'skaz-alloha', 'Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', '', 0],
  ['veoveo', 'skaz-veoveo', 'Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', '', 0],
  ['kinotochka', 'kinotochka', 'Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682', '', 0],
  ['collaps', 'collaps', 'Паразиты', 'Parasite', '2019', '496243', 'tt6751668', '1023498', '', 0],
];

async function one(p, ep) {
  const [label, provider, title, ot, year, id, imdb, kp, , serial] = p;
  const v = await g(`${BASE}/api/lampa/videos?${q({ token: TOKEN, provider, source: 'tmdb', title, original_title: ot, year, serial, id, imdb_id: imdb, kinopoisk_id: kp })}`);
  if (v.status !== 200) return { label, stage: 'videos_http' + v.status, ms: v.ms };
  const items = v.json?.items || [];
  if (!items.length) return { label, stage: 'empty/' + (v.json?.provider_error?.code || ''), ms: v.ms };
  const it = (ep != null ? items.find((x) => x.episode === ep && x.season === 1) : items[0]) || items[0];
  if (it.method === 'call') {
    const r = await g(RW(it.url));
    const pu = r.json?.url || '';
    return { label, stage: 'call→' + r.status, resolved: !!pu, leak: leak(pu), url: String(pu).slice(0, 90), ms: v.ms + r.ms };
  }
  return { label, stage: 'direct', leak: leak(it.url), url: String(it.url || '').slice(0, 80), ms: v.ms };
}

(async () => {
  if (MODE === 'matrix') {
    console.log('\n===== §12/§17 PROVIDER MATRIX (prod, public HTTPS) =====');
    for (const p of PROV) {
      const r = await one(p, null);
      console.log(`${r.label.padEnd(12)} ${r.stage} leak=${r.leak ? 'YES⚠' : 'no'} ${r.resolved ? 'resolved' : ''} ${(r.url || '').slice(0, 60)} ${r.ms}ms`);
      await new Promise((s) => setTimeout(s, 1200));
    }
  }

  if (MODE === 'hb') {
    console.log('\n===== §14 HOST-BOUND (gen==res, 0 call-url) =====');
    for (const p of PROV.slice(0, 6)) {
      const v = await g(`${BASE}/api/lampa/videos?${q({ token: TOKEN, provider: p[1], source: 'tmdb', title: p[2], original_title: p[3], year: p[4], serial: p[9], id: p[5], imdb_id: p[6], kinopoisk_id: p[7] })}`);
      const items = v.json?.items || [];
      const call = items.find((x) => x.method === 'call');
      if (!call) { console.log(`${p[0].padEnd(12)} no call item → host-bound N/A`); await new Promise((s) => setTimeout(s, 1200)); continue; }
      const genHost = (() => { try { return new URL(call.url).host } catch { return '' } })();
      const r = await g(RW(call.url));
      const pu = r.json?.url || '';
      const resHost = (() => { try { return new URL(pu).host } catch { return '' } })();
      console.log(`${p[0].padEnd(12)} gen=${genHost} res=${resHost} leaked=${leak(pu) ? 'YES⚠' : 'no'}`);
      await new Promise((s) => setTimeout(s, 1500));
    }
  }

  if (MODE === 'cross20') {
    console.log('\n===== §15 CROSS-QUERY 20× (mixed movie/serial/episode) =====');
    let found = 0, callUrl = 0, empty = 0, stateLeak = 0, resolveFail = 0;
    const seq = [];
    for (let i = 0; i < 20; i++) seq.push(PROV[i % PROV.length]);
    for (let i = 0; i < seq.length; i++) {
      const p = seq[i];
      const ep = (p[9] === '1') ? ((i % 3) + 1) : null;
      const r = await one(p, ep);
      if (r.stage.startsWith('videos_')) { } // counted below
      if (r.leak) callUrl++;
      if (r.stage.startsWith('empty')) empty++;
      else found++;
      if (r.stage.includes('call→') && !r.resolved) resolveFail++;
      console.log(`${String(i + 1).padStart(2)} ${r.label.padEnd(10)} ${r.stage} leak=${r.leak ? 'Y' : '-'}`);
      await new Promise((s) => setTimeout(s, 600));
    }
    console.log(`\nRESULT: found=${found}/20 empty=${empty} callUrl=${callUrl} resolveFail=${resolveFail} stateLeak=${stateLeak}`);
  }
})();