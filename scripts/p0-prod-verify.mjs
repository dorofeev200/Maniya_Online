// P0 production-verify: сезоны/серии у сериала с несколькими сезонами.
// Использование: node scripts/p0-prod-verify.mjs <provider> <title>
// env: TOKEN (иначе mo-admin-test-2026), BASE (иначе https://plugin.maniya-kvn.online)
const BASE = process.env.BASE || 'https://plugin.maniya-kvn.online';
const TOKEN = process.env.TOKEN || 'mo-admin-test-2026';

const provider = process.argv[2];
const title = process.argv[3];
if (!provider || !title) {
  console.error('usage: node p0-prod-verify.mjs <provider> <title>');
  process.exit(2);
}

async function get(params) {
  const url = new URL('/api/lampa/videos', BASE);
  url.searchParams.set('token', TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function summarize(body) {
  const items = body.items || [];
  const seasons = body.seasons || [];
  const voices = body.voices || [];
  const sample = items[0] || null;
  return {
    seasons: seasons.map((s) => s.number).join(',') || '(нет)',
    voices: voices.map((v) => v.name).join(' | ') || '(нет)',
    items: items.length,
    sample: sample ? {
      title: sample.title,
      season: sample.season,
      episode: sample.episode,
      voice_name: sample.voice_name,
      method: sample.method,
      hasUrl: !!sample.url,
      url: (sample.url || '').slice(0, 90)
    } : null
  };
}

const out = {};
out.base = await get({ provider, title });
out.season1 = await get({ provider, title, season: '1' });
out.season2 = await get({ provider, title, season: '2' });

console.log('provider=%s title=%s', provider, title);
console.log('BASE(no season) status=%s -> %s', out.base.status, JSON.stringify(summarize(out.base.body)));
console.log('season=1        status=%s -> %s', out.season1.status, JSON.stringify(summarize(out.season1.body)));
console.log('season=2        status=%s -> %s', out.season2.status, JSON.stringify(summarize(out.season2.body)));

// Конкретная серия: резолв play URL. Если item method:'call' — через /api/lampa/video.
const ep = (out.season1.body.items || [])[0] || (out.base.body.items || [])[0];
if (ep) {
  if (ep.method === 'call' && ep.url) {
    const videoUrl = new URL('/api/lampa/video', BASE);
    videoUrl.searchParams.set('token', TOKEN);
    videoUrl.searchParams.set('provider', provider);
    if (ep.season != null) videoUrl.searchParams.set('season', ep.season);
    if (ep.episode != null) videoUrl.searchParams.set('episode', ep.episode);
    if (ep.voice_index != null) videoUrl.searchParams.set('voice', ep.voice_index);
    if (ep.url) videoUrl.searchParams.set('url', ep.url);
    const r = await fetch(videoUrl);
    const body = await r.json().catch(() => ({}));
    console.log('RESOLVE episode[0] status=%s -> method=%s hasUrl=%s url=%s',
      r.status, body.method, !!body.url, (body.url || body.stream?.url || '').slice(0, 90));
  } else {
    console.log('EPISODE[0] inline url=%s', (ep.url || '').slice(0, 120));
  }
}
