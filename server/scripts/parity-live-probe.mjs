// Parity-009 live probe: /videos → item → playback HTTP check for 4 sources.
// Run locally: node scripts/parity-live-probe.mjs
// Uses PRODUCTION https server (current deployed code).
const TOKEN = process.env.TOKEN || 'mo-6d7c07e49e511b105726d6de1c0fdce4';
const BASE = 'https://plugin.maniya-kvn.online';

const TITLES = {
  Matrix: {
    movie: 'Матрица', original: 'The Matrix', year: '1999',
    id: '603', imdb_id: 'tt0133093', tmdb_id: '603', kinopoisk_id: '301'
  },
  Inception: {
    movie: 'Inception', original: 'Inception', year: '2010',
    id: '27205', imdb_id: 'tt1375666', tmdb_id: '27205', kinopoisk_id: '300'
  },
  Interstellar: {
    movie: 'Интерстеллар', original: 'Interstellar', year: '2014',
    id: '157336', imdb_id: 'tt0816692', tmdb_id: '157336', kinopoisk_id: '437410'
  }
};

const PROVIDERS = ['skaz-zetflixdb', 'skaz-xvideocdnultra', 'skaz-geosaitebi', 'skaz-kinoflix'];

function movieQuery(t) {
  return new URLSearchParams({
    id: t.id, imdb_id: t.imdb_id, tmdb_id: t.tmdb_id, kinopoisk_id: t.kinopoisk_id,
    title: t.movie, original_title: t.original, serial: '0', year: t.year, source: 'tmdb'
  }).toString();
}

async function resolveItem(item, provider, qs) {
  if (item.method === 'play') return item;
  if (item.method === 'call' && item.url) {
    const videoUrl = item.url + (item.url.includes('?') ? '&' : '?') + 'token=' + TOKEN;
    const res = await fetch(videoUrl);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { method: 'play', url: '', parseError: text.slice(0, 120) }; }
  }
  return item;
}

async function checkPlayback(url) {
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-1023', 'User-Agent': 'Lampa/2.8' },
      redirect: 'follow'
    });
    const ct = res.headers.get('content-type') || '';
    const cl = res.headers.get('content-length') || (res.headers.get('content-range') || '').split('/')[1] || '';
    return `${res.status} ct=${ct.split(';')[0]} len=${cl} final=${res.url.slice(0, 65)}`;
  } catch (e) {
    return `ERR ${e.message}`;
  }
}

for (const [provider, shape] of [['skaz-zetflixdb', 'Matrix'], ['skaz-xvideocdnultra', 'Matrix'], ['skaz-xvideocdnultra', 'Interstellar'], ['skaz-geosaitebi', 'Matrix'], ['skaz-kinoflix', 'Matrix'], ['skaz-kinoflix', 'Inception']]) {
  const t = TITLES[shape];
  const qs = movieQuery(t);
  const url = `${BASE}/api/lampa/videos?provider=${provider}&${qs}&token=${TOKEN}`;
  const start = Date.now();
  const res = await fetch(url);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { console.log(`${provider} :: ${shape} -> RAW ${text.slice(0, 100)} [${Date.now() - start}ms]`); continue; }
  const items = data.items || [];
  console.log(`${provider} :: ${shape} -> items=${items.length} [${Date.now() - start}ms] (${JSON.stringify(items[0] && items[0].method)})`);
  if (!items.length) continue;
  const it = await resolveItem(items[0], provider, qs);
  if (it.parseError) { console.log(`   resolve FAIL: ${it.parseError}`); continue; }
  const p = await checkPlayback(it.url || '');
  console.log(`   [0] ${it.method} '${(it.title || '').slice(0, 40)}' -> ${p}`);
}