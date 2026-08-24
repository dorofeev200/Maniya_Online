// SKAZ-MANIYA-005 §18: playback validation в здоровом окне.
// По одному провайдеру: /videos → (call→resolve) → streamUrl → fetch master m3u8 (#EXTM3U)
// → распаковать первую /media дорожку → fetch media playlist → взять первый .ts segment
// → проверить HTTP/Content-Type/first-bytes.
// Arg: <providerLabel> (см. PROV). Read-only против SHADOW.
const BASE = process.env.T005_BASE || 'http://95.85.241.121:3210';
const TOKEN = process.env.T005_TOKEN || 'mo-admin-test-2026';
const label = process.argv[2];
if (!label) { console.log('usage: node _t005_playback.mjs <label>'); process.exit(2); }

const PROV = {
  videoseed: { provider: 'skaz-videoseed', title: 'Дом дракона', ot: 'House of the Dragon', year: '2022', id: '94997', imdb: 'tt11198330', kp: '', serial: 1, ep: 1 },
  kodik:     { provider: 'kodik', title: 'Паразиты', ot: 'Parasite', year: '2019', id: '496243', imdb: 'tt6751668', kp: '1023498', serial: 0, ep: null },
  kinopub:   { provider: 'skaz-kinopub', title: 'Дюна: Часть вторая', ot: 'Dune: Part Two', year: '2024', id: '693134', imdb: 'tt15239678', kp: '4670204', serial: 0, ep: null },
  rezka:     { provider: 'rezka', title: 'Дом дракона', ot: 'House of the Dragon', year: '2022', id: '94997', imdb: 'tt11198330', kp: '', serial: 1, ep: 1 },
  kinotochka:{ provider: 'kinotochka', title: 'Интерстеллар', ot: 'Interstellar', year: '2014', id: '157336', imdb: 'tt0816692', kp: '462682', serial: 0, ep: null },
  alloha:    { provider: 'skaz-alloha', title: 'Дюна: Часть вторая', ot: 'Dune: Part Two', year: '2024', id: '693134', imdb: 'tt15239678', kp: '4670204', serial: 0, ep: null },
  veoveo:    { provider: 'skaz-veoveo', title: 'Дюна: Часть вторая', ot: 'Dune: Part Two', year: '2024', id: '693134', imdb: 'tt15239678', kp: '4670204', serial: 0, ep: null },
  hdvb:      { provider: 'skaz-hdvb', title: 'Дюна: Часть вторая', ot: 'Dune: Part Two', year: '2024', id: '693134', imdb: 'tt15239678', kp: '4670204', serial: 0, ep: null },
  filmix:    { provider: 'filmix', title: 'Дюна: Часть вторая', ot: 'Dune: Part Two', year: '2024', id: '693134', imdb: 'tt15239678', kp: '4670204', serial: 0, ep: null },
};

async function g(url, ms = 30000, hdrs = {}) {
  const t0 = Date.now();
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'Mozilla/5.0', ...hdrs } }); const t = await r.text(); let j=null; try{j=JSON.parse(t);}catch{} return { status: r.status, json: j, text: t, ctype: String(r.headers?.get?.('content-type')||''), ms: Date.now()-t0, hdrs: Object.fromEntries([...r.headers]) }; }
  catch (e) { return { status: 'ERR', json: null, text: String(e).slice(0,60), ctype: '', ms: Date.now()-t0, hdrs: {} }; }
}
const RW = (u) => String(u||'').replace('http://127.0.0.1:3210', BASE);
function looksLikeCallUrl(u){const s=String(u||'');if(/\/api\/lampa\/(proxy|video|stream)\?/.test(s))return false;if(/\/proxy\/[0-9a-f]{20,}/.test(s))return false;if(/\/lite\/[a-z0-9-]+\/(video\/|\?)/.test(s))return true;return false;}
function absUrl(base, u){ try { return new URL(u, base).href; } catch { return u; } }

(async () => {
  const p = PROV[label];
  if (!p) { console.log('unknown label', label); process.exit(2); }
  console.log(`\n===== §18 PLAYBACK: ${label} (${p.provider}) «${p.title}» =====`);
  const vq = new URLSearchParams({ token: TOKEN, provider: p.provider, source: 'tmdb', title: p.title, original_title: p.ot, year: p.year, serial: String(p.serial), id: p.id, imdb_id: p.imdb, kinopoisk_id: p.kp });
  const v = await g(`${BASE}/api/lampa/videos?${vq}`, 60000);
  if (v.status !== 200) { console.log(`FAIL /videos HTTP ${v.status}`); return; }
  const items = v.json?.items || [];
  const pe = v.json?.provider_error?.code || '';
  if (!items.length) { console.log(`EMPTY /videos${pe? ' pe='+pe:''}`); return; }
  let it = items[0];
  if (p.ep != null) it = items.find(x=>x.episode===p.ep&&x.season===1)||items[0];
  console.log(`videos: items=${items.length}, first method=${it.method}${p.ep? ` (ep=${p.ep})`:''}`);
  let streamUrl = it.url, stage = 'direct';
  if (it.method === 'call') {
    const r = await g(RW(it.url), 60000);
    if (r.status !== 200) { console.log(`FAIL resolve HTTP ${r.status}`); return; }
    streamUrl = r.json?.url || null; stage = 'call→resolve';
  }
  if (!streamUrl) { console.log('FAIL no resolved url'); return; }
  if (looksLikeCallUrl(streamUrl)) { console.log(`FAIL call-url leak: ${streamUrl.slice(0,60)}`); return; }
  console.log(`resolved: [${stage}] ${String(streamUrl).slice(0,90)}`);
  const fut = RW(streamUrl);
  const m = await g(fut, 30000);
  if (m.status !== 200) { console.log(`FAIL stream HTTP ${m.status} ctype=${m.ctype}`); return; }
  const hasM3U = /#EXTM3U/.test(m.text);
  console.log(`stream: HTTP ${m.status} ctype=${m.ctype} hasEXTM3U=${hasM3U} bytes=${m.text.length} (${m.ms}ms)`);
  if (!hasM3U) { console.log('FAIL: no #EXTM3U'); return; }
  // Master → выбрать первую дорожку (или если это Media Playlist сразу — берём .ts)
  const lines = m.text.split('\n').map(s=>s.trim()).filter(Boolean);
  const isMaster = lines.some(l=>/^#EXT-X-STREAM-INF/i.test(l)||/^#EXT-X-MEDIA:/i.test(l));
  let mediaLine = null;
  if (isMaster) {
    for (let i=0;i<lines.length;i++) if (/^#EXT-X-STREAM-INF/i.test(lines[i])||/^#EXT-X-MEDIA:/i.test(lines[i])) { if (lines[i+1] && !lines[i+1].startsWith('#')) { mediaLine = lines[i+1]; } }
  } else {
    mediaLine = lines.find(l=>!l.startsWith('#') && /(m3u8|ts|mp4|m4s)/i.test(l)) || lines.find(l=>!l.startsWith('#'));
  }
  if (!mediaLine) { console.log('WARN: no media line found in playlist'); return; }
  const mediaUrl = absUrl(RW(mediaLine), fut.startsWith('http')?fut:'');
  console.log(`media: ${mediaLine.slice(0,80)}`);
  // если master → это m3u8 → фетчим как media playlist и берём сегмент
  let segUrl = null, mediaStatus = 'skip';
  if (isMaster || /\.m3u8/i.test(mediaLine)) {
    const mp = await g(mediaUrl, 30000);
    mediaStatus = `HTTP ${mp.status} ctype=${mp.ctype} ${mp.ms}ms`;
    console.log(`media playlist: ${mediaStatus}`);
    if (mp.status === 200 && mp.text) {
      const sl = mp.text.split('\n').map(s=>s.trim()).filter(Boolean);
      const firstSeg = sl.find(l=>!l.startsWith('#') && !/^#EXT/.test(l) && (/.ts$|.m4s$|.mp4$|.aac$/i.test(l)) );
      if (firstSeg) {
        segUrl = absUrl(firstSeg, mediaUrl);
        const seg = await g(segUrl, 30000);
        console.log(`segment[0]: HTTP ${seg.status} ctype=${seg.ctype} bytes=${seg.text.length} first4=${seg.text.slice(0,3)} (${seg.ms}ms)`);
        const validSeg = seg.status === 200 && /(video|octet|mpegurl|m4s|bin)/i.test(seg.ctype) && seg.text.length > 100;
        console.log(validSeg ? 'SEGMENT: PASS' : 'SEGMENT: check');
      }
    }
  }
  console.log(`PLAYBACK ${label}: master=${hasM3U} stream200=${m.status===200} → ${m.status===200&&hasM3U ? 'PASS' : 'FAIL'}`);
})();
