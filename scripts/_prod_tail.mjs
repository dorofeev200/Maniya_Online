// RELEASE хвосты: natives с KP-id (462682 Интерстеллар), TMDB relay 403 body.
const BASE = 'https://plugin.maniya-kvn.online';
const TOKEN = process.env.FPG_TOKEN || '';
async function g(u, timeout = 40000) {
  try { const r = await fetch(u, { signal: AbortSignal.timeout(timeout) }); return { status: r.status, text: await r.text(), ct: r.headers.get('content-type') }; }
  catch (e) { return { status: 'ERR', text: String(e).slice(0, 50) }; }
}
console.log('=== natives с kinopoisk_id=462682 (Интерстеллар) ===');
for (const provider of ['vkmovie', 'alloha', 'veoveo', 'kinopub', 'collaps']) {
  const q = new URLSearchParams({ token: TOKEN, provider, source: 'tmdb', title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0', id: '157336', imdb_id: 'tt0816692', kinopoisk_id: '462682' });
  const v = await g(`${BASE}/api/lampa/videos?${q}`);
  let items = 0, first = '', pe = '';
  try { const j = JSON.parse(v.text); items = (j.items || []).length; first = JSON.stringify((j.items || [])[0] || {}).slice(0, 90); pe = j.provider_error ? ' pe=' + j.provider_error.code : ''; } catch {}
  console.log(`${provider}: ${v.status} items=${items} ${first}${pe}`);
}
console.log('\n=== TMDB relay 403 body ===');
for (const [name, u] of [
  ['img', `${BASE}/api/lampa/tmdb/img/p/w92/wwemzKWzjKYJFfCeiB57q3r4Bcm.jpg`],
  ['api', `${BASE}/api/lampa/tmdb/api/3/configuration?api_key=INVALIDKEY4TEST`],
  ['img-direct-3000', `http://95.85.241.121:3000/api/lampa/tmdb/img/p/w92/wwemzKWzjKYJFfCeiB57q3r4Bcm.jpg`]
]) {
  const r = await g(u, 20000);
  console.log(`${name}: ${r.status} ct=${r.ct} body=${r.text.slice(0, 160)}`);
}
console.log('\nDONE');