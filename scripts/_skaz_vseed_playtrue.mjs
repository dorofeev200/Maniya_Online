// SKAZ-REMAINING-PROVIDERS-001: videoseed-serial — Лампак-форма `?play=true` на дескриптор-эндпоинте
// + тайт-цикл дескриптор→m3u8 с разными вариациями. Решает: серийные m3u8 вообще живы?
const BASE = 'http://95.85.241.121:3210';
const TOKEN = 'mo-admin-test-2026';
const RW = (u) => String(u || '').replace('http://127.0.0.1:3210', BASE);
async function rawFetch(url, timeout = 20000) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(timeout) }); const t = await r.text(); return { status: r.status, ct: r.headers.get('content-type') || '', t }; }
  catch (e) { return { status: 'ERR', ct: '', t: String(e.message || e).slice(0, 60) }; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resolveEp(ep) {
  const q = new URLSearchParams({ token: TOKEN, provider: 'skaz-videoseed', source: 'tmdb', title: 'Дом дракона', original_title: 'House of the Dragon', year: '2022', serial: '1', id: '94997', imdb_id: 'tt11198330', kinopoisk_id: '0', voice: '0', season: '1', episode: String(ep) });
  const r = await rawFetch(`${BASE}/api/lampa/video?${q}`, 45000);
  let j = null; try { j = JSON.parse(r.t); } catch {}
  return { status: r.status, j, body: r.t };
}

for (let round = 0; round < 3; round++) {
  console.log(`\n===== round ${round} =====`);
  for (let ep = 1; ep <= 3; ep++) {
    const { status, j, raw } = await resolveEp(ep);
    if (status !== 200 || !j?.url) { console.log(`ep${ep}: resolve ${status} ${JSON.stringify(raw.slice(0, 100))}`); continue; }
    const u0 = String(j.url).split(/\s+or\s+/i)[0];
    const decoded = decodeURIComponent(String(u0));
    // A) Прямо дескриптор-эндпоинт ДОБАВИВ play=true (форма Lampac: lite/videoseed/video/<opaque>?...&play=true)
    const a = decoded + (decoded.includes('?') ? '&' : '?') + 'play=true';
    const rA = await rawFetch(RW(a), 25000);
    // B) дескриптор без play → его m3u8 сразу
    const d = await rawFetch(RW(decoded), 25000);
    let m3 = null;
    try { const dj = JSON.parse(d.t); if (dj?.url) m3 = String(dj.url).split(/\s+or\s+/i)[0]; } catch {}
    const rB = m3 ? await rawFetch(RW(m3), 20000) : null;
    const sig = (t, u) => { const h = t.slice(0, 24); return /^#EXTM3U/.test(h) ? `m3u8[${t.length}B]` : `${t.slice(0, 40)}`.replace(/\n/g, '\\n'); };
    console.log(`ep${ep}: A) play=true → ${rA.status} ${sig(rA.t, a)}`);
    if (m3) console.log(`       B) desc→m3u8 ${m3.slice(0, 90)} → ${rB?.status} ${sig(rB?.t || '', '')}`);
    else console.log(`       B) descriptor: ${d.status} ${JSON.stringify(d.t.slice(0, 120))}`);
    await sleep(1200);
  }
}
console.log('\nDONE');