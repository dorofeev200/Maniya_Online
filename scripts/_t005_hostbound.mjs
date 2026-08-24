// SKAZ-MANIYA-005 §13: host-bound check.
// Skaz call-URL валиден ТОЛЬКО на генерирующем хосте. Maniya-resolve обязан:
//   a) резолвить call на ТОМ ЖЕ хосте, что сгенерировал items (generationHost == resolveHost);
//   b) НЕ носить host-bound токен/URL на другой хост (сторонний хост → fail/не-токен).
// Read-only против SHADOW. По одному запросу + паузы (burst-контроль §16).
const BASE = process.env.T005_BASE || 'http://95.85.241.121:3210';
const TOKEN = process.env.T005_TOKEN || 'mo-admin-test-2026';

async function g(url, ms = 60000) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, json: j, text: t, ms: Date.now() - t0, ctype: String(r.headers?.get?.('content-type') || '') };
  } catch (e) { return { status: 'ERR', json: null, text: String(e).slice(0, 80), ms: Date.now() - t0, ctype: '' }; }
}
const RW = (u) => String(u || '').replace('http://127.0.0.1:3210', BASE);
function hostOf(u) { try { return new URL(String(u || '')).host; } catch { return ''; } }
function hasHostBoundToken(u) { const s = String(u || ''); return /\/lite\/[a-z0-9-]+\/(video\/.?|\?)/.test(s); }

const PROV = [
  { label: 'videoseed', provider: 'skaz-videoseed', title: 'Дом дракона', ot: 'House of the Dragon', year: '2022', id: '94997', imdb: 'tt11198330', kp: '', serial: 1 },
  { label: 'kodik(movie)', provider: 'kodik', title: 'Паразиты', ot: 'Parasite', year: '2019', id: '496243', imdb: 'tt6751668', kp: '1023498', serial: 0 },
  { label: 'kinopub', provider: 'skaz-kinopub', title: 'Дюна: Часть вторая', ot: 'Dune: Part Two', year: '2024', id: '693134', imdb: 'tt15239678', kp: '4670204', serial: 0 },
  { label: 'alloha', provider: 'skaz-alloha', title: 'Дюна: Часть вторая', ot: 'Dune: Part Two', year: '2024', id: '693134', imdb: 'tt15239678', kp: '4670204', serial: 0 },
];

(async () => {
  console.log(`\n===== §13 HOST-BOUND: generationHost == resolveHost, 0 call-url =====`);
  for (const p of PROV) {
    const vq = new URLSearchParams({ token: TOKEN, provider: p.provider, source: 'tmdb', title: p.title, original_title: p.ot, year: p.year, serial: String(p.serial), id: p.id, imdb_id: p.imdb, kinopoisk_id: p.kp });
    const v = await g(`${BASE}/api/lampa/videos?${vq}`, 60000);
    if (v.status !== 200 || !(v.json?.items?.length)) { console.log(`${p.label.padEnd(16)} videos ${v.status} empty/err`); await new Promise(s => setTimeout(s, 1500)); continue; }
    const items = v.json.items;
    const callItems = items.filter(x => x.method === 'call');
    if (!callItems.length) { console.log(`${p.label.padEnd(16)} direct-play только — host-bound N/A`); await new Promise(s => setTimeout(s, 1500)); continue; }
    const it = callItems[0];
    const genHost = hostOf(it.url);
    // resolve call
    const r = await g(RW(it.url), 60000);
    if (r.status !== 200) { console.log(`${p.label.padEnd(16)} resolve HTTP ${r.status}`); await new Promise(s => setTimeout(s, 1500)); continue; }
    const resUrl = r.json?.url || '';
    const resHost = hostOf(resUrl);
    const leaked = hasHostBoundToken(resUrl);
    const same = (genHost && resHost && genHost === resHost);
    const status = leaked ? 'CALLURL-LEAK⚠' : (same ? 'same-host' : (resHost === '127.0.0.1' ? 'proxy-local' : 'DIFF-HOST⚠'));
    console.log(`${p.label.padEnd(16)} gen=${genHost} → res=${resHost} leaked=${leaked} → ${status}`);
    await new Promise(s => setTimeout(s, 2000));
  }
  console.log('\nDONE');
})();
