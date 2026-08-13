// Диагностика Kodik «Игра престолов» = 0 items. Запускать на VPS:
//   node /opt/maniya-online/server/scripts/kodik-got-diag.mjs
// Читает KODIK_TOKEN из env (как KodikClient), бьёт напрямую в kodik-api.com.
const TOKEN = (process.env.KODIK_TOKEN || '').trim();
const API = 'https://kodik-api.com';

if (!TOKEN) {
  console.log('NO TOKEN');
  process.exit(1);
}

async function search(params) {
  const url = new URL('/search', API + '/');
  url.searchParams.set('token', TOKEN);
  url.searchParams.set('limit', '100');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url);
  if (!res.ok) return { _http: res.status };
  const data = await res.json();
  return {
    total: data.total,
    count: Array.isArray(data.results) ? data.results.length : 0,
    results: (Array.isArray(data.results) ? data.results : []).slice(0, 3).map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      title_orig: r.title_orig,
      year: r.year,
      kinopoisk_id: r.kinopoisk_id,
      imdb_id: r.imdb_id,
      season_count: r.season_count,
      episodes_count: r.episodes_count
    }))
  };
}

console.log('=== by kinopoisk_id 464963 ===');
console.log(JSON.stringify(await search({ kinopoisk_id: 464963, with_episodes: 'true' }), null, 2));

console.log('\n=== by imdb_id tt0944947 ===');
console.log(JSON.stringify(await search({ imdb_id: 'tt0944947', with_episodes: 'true' }), null, 2));

console.log('\n=== by title "Игра престолов" ===');
console.log(JSON.stringify(await search({ title: 'Игра престолов', with_episodes: 'true', with_material_data: 'true' }), null, 2));

console.log('\n=== by title "Game of Thrones" ===');
console.log(JSON.stringify(await search({ title: 'Game of Thrones', with_episodes: 'true', with_material_data: 'true' }), null, 2));
