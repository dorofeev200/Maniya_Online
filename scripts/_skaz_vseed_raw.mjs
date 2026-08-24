// SKAZ-REMAINING-PROVIDERS-001: videoseed-serial — сырой дамп дескриптора и каждого URL цепочки.
// Крутится до появления items (флак). Печатает т.ч. разницу movie-vs-serial m3u8-эндпоинтов.
const BASE = 'http://95.85.241.121:3210';
const TOKEN = 'mo-admin-test-2026';
const RW = (u) => String(u || '').replace('http://127.0.0.1:3210', BASE);
async function raw(url, timeout = 30000) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(timeout) }); const t = await r.text(); return { status: r.status, ct: r.headers.get('content-type') || '', url, t }; }
  catch (e) { return { status: 'ERR', ct: '', url, t: String(e.message || e).slice(0, 80) }; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 1. videoseed serial items (флак) ---
let items = [];
for (let i = 0; i < 6 && !items.length; i++) {
  const q = new URLSearchParams({ token: TOKEN, provider: 'skaz-videoseed', source: 'tmdb', title: 'Дом дракона', original_title: 'House of the Dragon', year: '2022', serial: '1', id: '94997', imdb_id: 'tt11198330', kinopoisk_id: '0' });
  const v = await raw(`${BASE}/api/lampa/videos?${q}`, 45000);
  try { items = JSON.parse(v.t).items || []; } catch { console.log(`attempt${i}: HTTP ${v.status} ${v.t.slice(0, 80)}`); }
  if (!items.length) await sleep(1500);
}
if (!items.length) { console.log('videoseed-serial items=0 (после 6 попыток) — upstream флак'); }
else {
  console.log(`videoseed-serial items=${items.length}`);
  const it = items[0];
  const rurl = RW(it.url) + (it.url.includes('?') ? '&' : '?') + `token=${TOKEN}`;
  const resolved = await raw(rurl, 40000);
  console.log(`resolve: ${resolved.status} ct=${resolved.ct}`);
  let rj = null; try { rj = JSON.parse(resolved.t); } catch {}
  console.log(`resolve body: ${JSON.stringify(resolved.t.slice(0, 600))}`);
  if (rj?.url) {
    const u0 = String(rj.url).split(/\s+or\s+/i)[0];
    const decoded = decodeURIComponent(String(u0)).replace(/^https?:/, 'http:');
    console.log(`\nfinal URL decoded: ${decoded.slice(0, 200)}`);
    const r = await raw(RW(u0), 30000);
    console.log(`1) fetch RESOLVED.url ${r.status} ct=${r.ct} body=${JSON.stringify(r.t.slice(0, 500))}`);
    let j2 = null; try { j2 = JSON.parse(r.t); } catch {}
    if (j2 && typeof j2 === 'object' && j2.url) {
      const m3 = String(j2.url).split(/\s+or\s+/i)[0];
      console.log(`   descriptor.url = ${m3.slice(0, 160)}`);
      const m3r = await raw(RW(m3), 30000);
      console.log(`2) fetch descriptor.url ${m3r.status} ct=${m3r.ct} body=${JSON.stringify(m3r.t.slice(0, 400))}`);
      if (!/^#EXT/.test(m3r.t)) {
        // попытка с play=true и без Range (как клиент без Range)
        const withPlay = m3 + (m3.includes('?') ? '&' : '?') + 'play=true';
        const p = await raw(RW(withPlay), 30000);
        console.log(`2b) fetch descriptor.url+play=true ${p.status} ct=${p.ct} body=${JSON.stringify(p.t.slice(0, 400))}`);
      }
    }
  }
}

// --- 2. Контроль: videoseed MOVIE m3u8-эндпоинт (рабочий) ---
console.log('\n--- контроль movie (рабочий путь) ---');
const qm = new URLSearchParams({ token: TOKEN, provider: 'skaz-videoseed', source: 'tmdb', title: 'Дюна: Часть вторая', original_title: 'Dune: Part Two', year: '2024', serial: '0', id: '693134', imdb_id: 'tt15239678', kinopoisk_id: '4670204' });
{
  const v = await raw(`${BASE}/api/lampa/videos?${qm}`, 45000);
  let its = []; try { its = JSON.parse(v.t).items || []; } catch {}
  console.log(`movie items=${its.length}`);
  if (its[0]) {
    const mu = RW(its[0].url);
    const r = await raw(mu, 20000);
    console.log(`movie item.url ${r.status} ct=${r.ct} head=${JSON.stringify(r.t.slice(0, 200))}`);
    const m2 = /url%3D([^&]+)/.exec(its[0].url);
    if (m2) {
      const inner = decodeURIComponent(decodeURIComponent(m2[1])).replace(/^https?:/, 'http:');
      console.log(`movie resolved inner url: ${inner.slice(0, 160)}`);
    }
  }
}
console.log('\nDONE');