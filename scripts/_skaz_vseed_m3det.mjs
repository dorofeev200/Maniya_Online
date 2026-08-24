// SKAZ-REMAINING-PROVIDERS-001: videoseed-serial — детерминизм m3u8.
// Creds берутся ИЗ САМИХ resolved-URL (account_email/uid уже в них, runtime-конфиг).
// Вариации: (0) как есть, (1) +creds, (2) +creds+Origin. 4 раунда × 3 серии.
const BASE = 'http://95.85.241.121:3210';
const TOKEN = 'mo-admin-test-2026';
const RW = (u) => String(u || '').replace('http://127.0.0.1:3210', BASE);
async function rawFetch(url, timeout = 20000, headers = {}) {
  try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) }); const t = await r.text(); return { status: r.status, ct: r.headers.get('content-type') || '', t }; }
  catch (e) { return { status: 'ERR', ct: '', t: String(e.message || e).slice(0, 60) }; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resolveEp(ep) {
  const q = new URLSearchParams({ token: TOKEN, provider: 'skaz-videoseed', source: 'tmdb', title: 'Дом дракона', original_title: 'House of the Dragon', year: '2022', serial: '1', id: '94997', imdb_id: 'tt11198330', kinopoisk_id: '0', voice: '0', season: '1', episode: String(ep) });
  const r = await rawFetch(`${BASE}/api/lampa/video?${q}`, 45000);
  let j = null; try { j = JSON.parse(r.t); } catch {}
  return { status: r.status, j, body: r.t };
}

let seen = { m3u8ok: 0, m3u8_404: 0, desc_err: 0, items0: 0, m3u8_other: 0 };
for (let round = 0; round < 4; round++) {
  for (let ep = 1; ep <= 3; ep++) {
    const { status, j, body } = await resolveEp(ep);
    if (status !== 200 || !j?.url) { if (/provider_error|items/.test(body)) seen.items0++; else seen.desc_err++; console.log(`r${round} ep${ep}: resolve ${status} ${JSON.stringify(body.slice(0, 80))}`); continue; }
    const u0 = String(j.url).split(/\s+or\s+/i)[0];
    const decoded = decodeURIComponent(String(u0));
    const d = await rawFetch(RW(decoded), 25000, { Origin: 'http://lampa.mx' });
    let m3 = null;
    try { const dj = JSON.parse(d.t); if (dj?.url) m3 = String(dj.url).split(/\s+or\s+/i)[0]; } catch {}
    if (!m3) { seen.desc_err++; console.log(`r${round} ep${ep}: descriptor ${d.status} ${JSON.stringify(d.t.slice(0, 80))}`); continue; }
    // (0) как есть, (1) +creds, (2) +creds+Origin. Creds — из env (не в открытых скриптах).
    const CE = encodeURIComponent(process.env.SKAZ_ACCOUNT_EMAIL || '');
    const CU = encodeURIComponent(process.env.SKAZ_UID || '');
    const cred = CU ? (String(m3).includes('?') ? `&account_email=${CE}&uid=${CU}` : `?account_email=${CE}&uid=${CU}`) : '';
    const r0 = await rawFetch(RW(m3), 15000);
    const r1 = await rawFetch(RW(m3 + cred), 15000);
    const r2 = await rawFetch(RW(m3 + cred), 15000, { Origin: 'http://lampa.mx' });
    const s0 = /^#EXTM3U/.test(r0.t) ? 'm3u8' : `${r0.t.slice(0, 20)}`.replace(/\n/, '');
    const s1 = /^#EXTM3U/.test(r1.t) ? 'm3u8' : `${r1.t.slice(0, 20)}`.replace(/\n/, '');
    const s2 = /^#EXTM3U/.test(r2.t) ? 'm3u8' : `${r2.t.slice(0, 20)}`.replace(/\n/, '');
    if (r0.status === 200 && s0 === 'm3u8') seen.m3u8ok++;
    else if (r0.status === 404) seen.m3u8_404++;
    else seen.m3u8_other++;
    console.log(`r${round} ep${ep}: m3 ${m3.slice(0, 70)} → (0)${r0.status}/${s0} (1)${r1.status}/${s1} (2)${r2.status}/${s2}`);
    await sleep(1000);
  }
}
console.log('\n=== ИТОГ ===', JSON.stringify(seen));
console.log(seen.m3u8ok > 0 ? 'М3У8 ХОТЬ РАЗ 200 → upstream serial МОЖЕТ быть играбелен' : 'М3У8 НИ РАЗУ 200 → upstream serial медиа бито');
console.log('DONE');