// SKAZ-REMAINING-PROVIDERS-001: дамп сырых тел для геб Graphs geosaitebi/videoseed-serial/rhsprem.
// Задача — понять ОТКУДА JSON(60B)/JSON(205B)/503: сами items, их url, резолв, финальный url.
const BASE = 'http://95.85.241.121:3210';
const TOKEN = 'mo-admin-test-2026';
const RW = (u) => String(u || '').replace('http://127.0.0.1:3210', BASE);

const CASES = {
  geosaitebi: ['Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682', 0],
  'videoseed-serial': ['Дом дракона', 'House of the Dragon', '2022', '94997', 'tt11198330', '0', 1],
  rhsprem: ['Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682', 0],
  'rhsprem-i': ['Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682', 0],
};

async function bodyOf(url, timeout = 30000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    const text = await r.text();
    return { status: r.status, ct: r.headers.get('content-type') || '', text };
  } catch (e) { return { status: 'ERR', ct: '', text: String(e).slice(0, 120) }; }
}

for (const [key, [title, ot, year, id, imdb, kp, serial]] of Object.entries(CASES)) {
  const provider = `skaz-${key.replace(/-serial$/, '').replace(/-i$/, '')}`;
  console.log(`\n===== ${key} (provider=${provider}) =====`);
  const q = new URLSearchParams({ token: TOKEN, provider, source: 'tmdb', title, original_title: ot, year, serial: String(serial), id, imdb_id: imdb, kinopoisk_id: kp });
  const v = await bodyOf(`${BASE}/api/lampa/videos?${q}`, 45000);
  console.log(`videos: HTTP ${v.status} ${v.text.slice(0, 400)}`);
  let items = []; try { items = JSON.parse(v.text).items || []; } catch {}
  for (let i = 0; i < Math.min(items.length, 2); i++) {
    const it = items[i];
    console.log(`\n[item ${i}] method=${it.method} title="${String(it.title).slice(0, 30)}" quality=${JSON.stringify(it.quality || {})}`);
    console.log(`  item.url = ${String(it.url).slice(0, 220)}`);
    if (it.stream) console.log(`  item.stream = ${String(it.stream).slice(0, 220)}`);
    if (it.method === 'play') {
      const raw = await bodyOf(RW(it.url), 25000);
      console.log(`  ← raw fetch item.url: ${raw.status} ct=${raw.ct} body=${JSON.stringify(raw.text.slice(0, 300))}`);
    } else if (it.method === 'call') {
      const rawUrl = RW(it.url);
      const rurl = rawUrl.startsWith('http') ? rawUrl + (rawUrl.includes('?') ? '&' : '?') + `token=${TOKEN}` : `${BASE}/api/lampa/video?provider=${provider}&voice=${encodeURIComponent(String(rawUrl || '0'))}&token=${TOKEN}`;
      const resolved = await bodyOf(rurl, 40000);
      console.log(`  resolve ${rurl.slice(0, 120)}: ${resolved.status} body=${JSON.stringify(resolved.text.slice(0, 400))}`);
      try {
        const rj = JSON.parse(resolved.text);
        if (rj && rj.url) {
          const finalUrl = String(rj.url).split(/\s+or\s+/i)[0];
          const f = await bodyOf(RW(finalUrl), 25000);
          console.log(`  ← raw fetch resolved.url ${RW(finalUrl).slice(0, 150)}: ${f.status} ct=${f.ct} body=${JSON.stringify(f.text.slice(0, 300))}`);
        }
      } catch {}
    }
  }
}
console.log('\nDONE');