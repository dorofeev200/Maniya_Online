// TASK-005 §18: skaz-hdvb probe — is EMPTY global (upstream/egress) or title-specific?
// Перебираем несколько тайтлов через shadow /videos, по одному с паузой (burst-контроль).
const BASE = process.env.T005_BASE || 'http://95.85.241.121:3210';
const TOKEN = process.env.T005_TOKEN || 'mo-admin-test-2026';
async function g(url, ms = 60000) {
  const t0 = Date.now();
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, json: j, text: t, ms: Date.now() - t0 }; }
  catch (e) { return { status: 'ERR', json: null, text: String(e).slice(0, 60) }; }
}
const T = [
  { t: 'Дюна: Часть вторая', ot: 'Dune: Part Two', y: '2024', id: '693134', imdb: 'tt15239678', kp: '4670204', s: 0 },
  { t: 'Паразиты', ot: 'Parasite', y: '2019', id: '496243', imdb: 'tt6751668', kp: '1023498', s: 0 },
  { t: 'Матрица', ot: 'The Matrix', y: '1999', id: '603', imdb: 'tt0133093', kp: '2899', s: 0 },
  { t: 'Гладиатор II', ot: 'Gladiator II', y: '2024', id: '974635', imdb: 'tt9218128', kp: '3275792', s: 1 },
];
(async () => {
  console.log('\n===== skaz-hdvb PROBE (title-scan) =====');
  for (const x of T) {
    const q = new URLSearchParams({ token: TOKEN, provider: 'skaz-hdvb', source: 'tmdb', title: x.t, original_title: x.ot, year: x.y, serial: String(x.s), id: x.id, imdb_id: x.imdb, kinopoisk_id: x.kp });
    const v = await g(`${BASE}/api/lampa/videos?${q}`, 60000);
    const items = v.json?.items || [];
    const pe = v.json?.provider_error?.code || '';
    console.log(`«${x.t}» (${x.y}) items=${items.length}${pe ? ' pe=' + pe : ''}${items[0] ? ' first=' + items[0].method : ''} ${v.status}`);
    await new Promise(s => setTimeout(s, 2500));
  }
  console.log('DONE');
})();
