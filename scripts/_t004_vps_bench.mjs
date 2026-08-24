// SKAZ-MANIYA-004 §21-22: VPS benchmark (10× на провайдер).
// group A = 4 VPS-провайдера (rezka/filmix/kinotochka/collaps) — §21.
// group B = 6 main (videoseed/hdvb/kodik/kinopub/alloha/veoveo) — §22.
// Read-only против SHADOW (3210). Считаем found/items, время, call-url, resolve.
const BASE = 'http://95.85.241.121:3210';
const TOKEN = 'mo-admin-test-2026';

const PROV = {
  // providerId: [title, ot, year, id, imdb, kp, serial]
  rezka:      ['Дом дракона', 'House of the Dragon', '2022', '94997', 'tt11198330', '0', 1],
  filmix:     ['Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 0],
  kinotochka: ['Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682', 0],
  collaps:    ['Паразиты', 'Parasite', '2019', '496243', 'tt6751668', '1023498', 0],
  // main
  videoseed:  ['Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 0],
  hdvb:       ['Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 0],
  kodik:      ['Паразиты', 'Parasite', '2019', '496243', 'tt6751668', '1023498', 0],
  kinopub:    ['Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 0],
  alloha:     ['Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 0],
  veoveo:     ['Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 0],
};
async function g(u, ms = 60000) { const t0 = Date.now(); try { const r = await fetch(u, { signal: AbortSignal.timeout(ms) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, json: j, ms: Date.now() - t0, text: t }; } catch (e) { return { status: 'ERR', json: null, ms: Date.now() - t0, text: String(e).slice(0, 50) }; } }
const RW = (u) => String(u || '').replace('http://127.0.0.1:3210', BASE);
// Видимые id в /sources shadow: native rezka/filmix/kinotochka/collaps/hdvb/kodik;
// videoseed/kinopub/alloha/veoveo — skaz-balancers (skaz-*).
const providerIdFor = (k) => {
  if (['videoseed', 'kinopub', 'alloha', 'veoveo'].includes(k)) return `skaz-${k}`;
  return k;
};
function looksLikeCallUrl(u) { const s = String(u || ''); return /\/lite\/[a-z0-9-]+\/video\//.test(s); }

async function bench(label, keys) {
  console.log(`\n===== ${label} (10× каждый, shadow) =====`);
  const rows = [];
  for (const key of keys) {
    const [title, ot, year, id, imdb, kp, serial] = PROV[key];
    const provider = providerIdFor(key);
    const per = [];
    for (let i = 0; i < 10; i++) {
      const q = new URLSearchParams({ token: TOKEN, provider, source: 'tmdb', title, original_title: ot, year, serial: String(serial), id, imdb_id: imdb, kinopoisk_id: kp });
      const v = await g(`${BASE}/api/lampa/videos?${q}`, 60000);
      const items = v.json?.items || [];
      const pe = v.json?.provider_error?.code || '';
      let meth = '', callurl = false, dur = v.ms;
      if (v.status !== 200) { per.push(`HTTP${v.status}@${dur}ms`); continue; }
      if (!items.length) { per.push(`empty@${dur}ms${pe ? '(' + pe + ')' : ''}`); continue; }
      const it = items[0];
      meth = it.method;
      if (it.method === 'play' && looksLikeCallUrl(it.url)) callurl = true;
      per.push(`${items.length}i/${it.method}@${dur}ms${callurl ? '/CALLURL⚠' : ''}${pe ? '(' + pe + ')' : ''}`);
    }
    const ok = per.filter((x) => !x.startsWith('empty') && !x.startsWith('HTTP') && !x.includes('CALLURL'));
    console.log(`${provider}: ${per.join('  ')}`);
    rows.push(`${provider}: found=${ok.length}/10`);
  }
  return rows;
}

const out = [];
out.push(...await bench('VPS providers (§21): rezka/filmix/kinotochka/collaps', ['rezka', 'filmix', 'kinotochka', 'collaps']));
out.push(...await bench('Main providers (§22): videoseed/hdvb/kodik/kinopub/alloha/veoveo', ['videoseed', 'hdvb', 'kodik', 'kinopub', 'alloha', 'veoveo']));
console.log('\n====== SUMMARY ======');
for (const r of out) console.log(r);
console.log('DONE');
