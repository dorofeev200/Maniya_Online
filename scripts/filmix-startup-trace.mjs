// FILMIX STARTUP LATENCY TRACE (runs ON VPS, targets prod :3000 + public HTTPS + direct CDN)
// Title: Spider-Man: No Way Home (2021) — TMDB 634649 / IMDb tt10872600
// Target result: «Дубляж [1080, Ukr, звук с TS, AD]»
// Trace both contors for the SAME result:
//   A) MANIYA: /videos -> (call?) /api/lampa/video -> proxied master -> variant 1080p -> init/segment
//   B) server-internal (real SkazProvider, nav-cache warm) -> resolveVideoJson -> build
//   C) E-ONLINE floor: direct cluster lite/filmix -> direct CDN master/variant/segment (no proxy)
// Each stage: ttfb/total/status/content-type/bytes/headers.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:3000';
const PUBLIC = 'https://plugin.maniya-kvn.online';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const MIME = { 'Accept': 'application/vnd.apple.mpegurl,*/*', 'User-Agent': UA };

const SPIDER = {
  id: '634649', tmdb_id: '634649', imdb_id: 'tt10872600', kinopoisk_id: '1309570',
  title: 'Человек-паук: Нет пути домой', original_title: 'Spider-Man: No Way Home',
  serial: '0', year: '2021', source: 'tmdb'
};

const users = JSON.parse(readFileSync('/opt/maniya-online/server/data/users.json', 'utf8'));
const arr = Array.isArray(users) ? users : (users.users || []);
const token = (arr.find((x) => x && x.active && x.token) || arr[0])?.token || '';

const pid = String(execFileSync('pgrep', ['-f', 'node.*src/index.js']).toString().trim().split(/\s+/)[0]);
const envRaw = readFileSync('/proc/' + pid + '/environ', 'utf8');
const env = Object.fromEntries(envRaw.split('\0').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));

const t0 = Date.now();
function mark(label, extra = {}) { console.log(`  @t+${String(Date.now() - t0).padStart(6)}ms  ${label}${Object.keys(extra).length ? '  ' + JSON.stringify(extra) : ''}`); }

async function timedGet(url, opts = {}) {
  const start = Date.now();
  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(60000),
      headers: { 'User-Agent': UA, ...(opts.headers || {}) }
    });
  } catch (e) {
    return { status: 0, err: e.message.slice(0, 90), ttfbMs: null, totalMs: Date.now() - start, ct: '', bytes: 0 };
  }
  const ttfb = Date.now() - start;
  const ct = String(res.headers.get('content-type') || '').split(';')[0];
  const cl = res.headers.get('content-length');
  const ar = res.headers.get('accept-ranges');
  let buf = null;
  if (opts.readBody === false) {
    await res.body?.cancel?.().catch?.(() => {});
  } else {
    try { buf = Buffer.from(await res.arrayBuffer()); } catch (e) {}
  }
  const total = Date.now() - start;
  return { status: res.status, ct, cl, ar, ttfbMs: ttfb, totalMs: total, bytes: buf ? buf.length : 0, buf, finalUrl: res.url, headers: res.headers };
}

function resolveUrl(ref, base) { try { return ref == null ? null : new URL(String(ref), base).toString(); } catch { return null; } }

function pickVariant(masterText, masterUrl) {
  const lines = String(masterText || '').split(/\r?\n/);
  const variants = []; let block = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) { if (block.length) variants.push([...block]); block = []; continue; }
    block.push(t);
    if (!t.startsWith('#')) { variants.push([...block]); block = []; }
  }
  if (block.length) variants.push([...block]);
  if (!variants.length) return null;
  let picked = variants[0];
  let best = -1;
  for (const v of variants) {
    const attrs = v.join('\n');
    const m = attrs.match(/RESOLUTION=(\d+)x(\d+)/i);
    const h = m ? parseInt(m[2], 10) : 0;
    if (h === 1080) return { url: resolveUrl(v.filter((l) => !l.startsWith('#')).pop() || '', masterUrl), attr: attrs, height: 1080 };
    if (h > best) { best = h; picked = v; }
  }
  return { url: resolveUrl(picked.filter((l) => !l.startsWith('#')).pop() || '', masterUrl), attr: picked.find((l) => l.startsWith('#EXT-X-STREAM-INF')) || '', height: best };
}

function decodeProxyUrl(proxyUrl) {
  try { return new URL(proxyUrl).searchParams.get('url'); } catch { return null; }
}

function show(r, indent = '    ') {
  const extra = r.err ? ` ERR=${r.err}` : ` cl=${r.cl || '-'} ar=${r.ar || '-'} bytes=${r.bytes}`;
  console.log(`${indent}HTTP ${r.status || '-'}  ttfb=${r.ttfbMs == null ? '-' : r.ttfbMs + 'ms'}  total=${r.totalMs}ms${extra}`);
}

function qualityKeys(map) { return map && typeof map === 'object' ? Object.keys(map) : []; }

function findTarget(items) {
  const all = items || [];
  let hit = all.find((it) => /Дубляж/i.test(String(it.voice_name || it.title || '')) && /Ukr|AD|звук/i.test(String(it.voice_name || it.title || '')));
  if (!hit) hit = all.find((it) => /Дубляж/i.test(String(it.voice_name || it.title || '')));
  return { hit, index: hit ? all.indexOf(hit) : -1 };
}

async function main() {
  console.log('=== FILMIX STARTUP LATENCY TRACE — Spider-Man No Way Home 2021 ===');
  console.log(`token=${token ? token.slice(0, 12) + '…' : 'NONE'}  skaz=${env.SKAZ_ACCOUNT_EMAIL || env.EO_ACCOUNT_EMAIL || '?'}/${env.SKAZ_UID || env.EO_UID || '?'}  pid=${pid}`);

  // ─────────────────────────── PART A. MANIYA chain (real server) ───────────────────────────
  console.log('\n[PART A] MANIYA — /videos (real server :3000)');
  const vq = new URLSearchParams({ token, provider: 'filmix', ...SPIDER });
  mark('A0 begin');
  const vr = await timedGet(`${BASE}/api/lampa/videos?${vq}`);
  mark('A1 /api/lampa/videos done');
  show(vr);
  let items = [];
  try { items = (JSON.parse(vr.buf?.toString('utf8') || '{}').items) || []; } catch {}
  console.log(`    items=${items.length}`);
  items.forEach((it, i) => {
    console.log(`      [${i}] method=${it.method}  q=[${qualityKeys(it.quality).join(',')}]  voice="${it.voice_name || it.title || ''}"`);
  });
  const { hit, index } = findTarget(items);
  if (!hit) { console.log('    TARGET «Дубляж [1080, Ukr, звук с TS, AD]» НЕ найден — стоп'); process.exit(2); }
  console.log(`    TARGET -> index ${index}: method=${hit.method} voice="${hit.voice_name || hit.title}" q=[${qualityKeys(hit.quality).join(',')}]`);

  // ─────────────────────────── PART A2. resolve to playable descriptor ───────────────────────────
  let descriptor = hit;
  let videoMs = 0;
  if (hit.method === 'call') {
    mark('A2 /api/lampa/video begin');
    const tVideo = Date.now();
    const dq = new URL(hit.url);
    dq.searchParams.set('token', token);
    const dr = await timedGet(dq.toString());
    videoMs = Date.now() - tVideo;
    mark('A3 /api/lampa/video done');
    show(dr);
    try { descriptor = JSON.parse(dr.buf?.toString('utf8') || '{}'); } catch {}
    console.log(`    descriptor: method=${descriptor.method} q=[${qualityKeys(descriptor.quality).join(',')}] subtitles=${Array.isArray(descriptor.subtitles) ? descriptor.subtitles.length : 0}`);
    console.log(`    url="${String(descriptor.url || '').slice(0, 110)}…"`);
  } else {
    console.log('    (play item — /api/lampa/video НЕ вызывается)');
  }

  const playUrlRaw = String(descriptor.url || hit.url || '').trim();
  const primary = String(playUrlRaw.split(/\s+or\s+|\s*%20or%20\s*/i)[0]).trim();
  const isProxied = primary.includes('/api/lampa/proxy');
  console.log(`    playable primary: proxied=${isProxied} len=${primary.length}`);
  const directCdn = isProxied ? decodeProxyUrl(primary) : primary;
  console.log(`    direct CDN target: ${directCdn ? String(directCdn).slice(0, 110) + '…' : 'N/A'}`);

  // ─────────────────────────── PART A3. proxied chain via BASE (:3000) ───────────────────────────
  console.log('\n[PART A3] PROXIED chain via :3000 (server, no nginx)');
  mark('A4 proxied master begin');
  const pm = await timedGet(primary, { headers: MIME });
  mark('A5 proxied master done');
  show(pm);
  const masterText = pm.buf?.toString('utf8') || '';
  const variant = pickVariant(masterText, primary);
  console.log(`    master is HLS=${/^#EXTM3U/.test(masterText)}  variant=${variant ? `h=${variant.height}` : 'NONE'}  len=${masterText.length}`);

  if (variant && variant.url) {
    mark('A6 proxied variant begin');
    const pv = await timedGet(variant.url, { headers: MIME });
    mark('A7 proxied variant done');
    show(pv);
    const vText = pv.buf?.toString('utf8') || '';
    const xmap = (vText.match(/#EXT-X-MAP:[^\n]*URI="([^"]+)"/) || [])[1] || null;
    const segs = vText.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
    if (xmap) {
      mark('A8 proxied init begin');
      const pi = await timedGet(resolveUrl(xmap, variant.url), { headers: { 'User-Agent': UA, 'Range': 'bytes=0-1048575' } });
      mark('A9 proxied init done');
      show(pi);
    }
    if (segs.length) {
      mark('A10 proxied seg[0] begin');
      const ps = await timedGet(resolveUrl(segs[0], variant.url), { headers: { 'User-Agent': UA, 'Range': 'bytes=0-1048575' } });
      mark('A11 proxied seg[0] done');
      show(ps);
    }
  }

  // ─────────────────────────── PART A4. SAME chain via PUBLIC https (nginx) ───────────────────────────
  if (isProxied) {
    console.log('\n[PART A4] PROXIED chain via PUBLIC https (nginx in front)');
    const pub = (u) => u.replace(/^http:\/\/127\.0\.0\.1:3000/, PUBLIC);
    mark('A12 public master begin');
    const gm = await timedGet(pub(primary), { headers: MIME });
    mark('A13 public master done');
    show(gm);
    if (variant && variant.url) {
      const gv = await timedGet(pub(variant.url), { headers: MIME });
      show(gv, '    variant: ');
      const vText = gv.buf?.toString('utf8') || '';
      const segs = vText.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
      const xmap = (vText.match(/#EXT-X-MAP:[^\n]*URI="([^"]+)"/) || [])[1] || null;
      if (xmap) {
        const gi = await timedGet(pub(resolveUrl(xmap, variant.url)), { headers: { 'User-Agent': UA, 'Range': 'bytes=0-1048575' } });
        show(gi, '    init:   ');
      }
      if (segs.length) {
        const gs = await timedGet(pub(resolveUrl(segs[0], variant.url)), { headers: { 'User-Agent': UA, 'Range': 'bytes=0-1048575' } });
        show(gs, '    seg[0]: ');
      }
    }
  }

  // ─────────────────────────── PART A5. DIRECT CDN chain (no proxy) = E-Online floor ───────────────────────────
  if (directCdn) {
    console.log('\n[PART A5] DIRECT CDN chain (no proxy, plain UA)');
    mark('A14 direct master begin');
    const dm = await timedGet(directCdn, { headers: MIME });
    mark('A15 direct master done');
    show(dm);
    const dText = dm.buf?.toString('utf8') || '';
    const dv = pickVariant(dText, directCdn);
    console.log(`    direct master is HLS=${/^#EXTM3U/.test(dText)}  variant=${dv ? `h=${dv.height}` : 'NONE'}`);
    if (dv && dv.url) {
      const dvr = await timedGet(dv.url, { headers: MIME });
      show(dvr, '    variant: ');
      const dvText = dvr.buf?.toString('utf8') || '';
      const dsegs = dvText.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
      const dxmap = (dvText.match(/#EXT-X-MAP:[^\n]*URI="([^"]+)"/) || [])[1] || null;
      if (dxmap) {
        const di = await timedGet(resolveUrl(dxmap, dv.url), { headers: { 'User-Agent': UA, 'Range': 'bytes=0-1048575' } });
        show(di, '    init:   ');
      }
      if (dsegs.length) {
        const ds = await timedGet(resolveUrl(dsegs[0], dv.url), { headers: { 'User-Agent': UA, 'Range': 'bytes=0-1048575' } });
        show(ds, '    seg[0]: ');
      }
    }
  }

  // ─────────────────────────── PART B. server-internal steps (real classes, nav-cache warm) ───────────────────────────
  console.log('\n[PART B] SERVER-INTERNAL (real SkazProvider, fresh instance, nav-cache warm)');
  const { SkazClient } = await import('/opt/maniya-online/server/src/providers/skaz/SkazClient.js');
  const { SkazProvider } = await import('/opt/maniya-online/server/src/providers/skaz/SkazProvider.js');

  // Rebuild client with prod skaz account exactly as registry does (hosts from env/default).
  const hosts = String(env.SKAZ_HOSTS || env.EO_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean).length
    ? String(env.SKAZ_HOSTS || env.EO_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean)
    : ['http://online3.skaz.tv', 'http://online8.skaz.tv', 'http://94.249.239.63', 'http://94.249.239.37', 'http://94.249.239.11', 'http://77.90.33.109'];
  const client = new SkazClient({
    balancer: 'filmix',
    hosts,
    accountEmail: env.SKAZ_ACCOUNT_EMAIL || env.EO_ACCOUNT_EMAIL || '',
    uid: env.SKAZ_UID || env.EO_UID || '',
    origin: env.SKAZ_ORIGIN || env.EO_ORIGIN || 'http://lampa.mx'
  });
  const provider = new SkazProvider({
    id: 'skaz-filmix', title: 'filmix', balancer: 'filmix',
    hosts, accountEmail: client.accountEmail, uid: client.uid, origin: client.origin,
    client
  });
  const ctx = { query: { ...SPIDER, provider: 'filmix', token } };

  const b0 = Date.now();
  const payload = await provider.videos(ctx);
  console.log(`  B1 provider.videos() (nav warm + build items): ${Date.now() - b0}ms  items=${payload.items.length}`);
  const callItems = payload.items.filter((it) => it.method === 'call');
  console.log(`     call items=${callItems.length}  play items=${payload.items.length - callItems.length}`);

  const b1 = Date.now();
  const nav = await provider._cachedCollectMovieCards(ctx.query);
  console.log(`  B2 _cachedCollectMovieCards (nav cache): ${Date.now() - b1}ms  cards=${nav.cards.length}`);

  const vIndex = index; // same voice index as target
  const videoCards = nav.cards.filter((card) => card.method === 'call' && card.s == null && card.e == null);
  const targetCard = videoCards[vIndex] || videoCards[0] || null;
  console.log(`  B3 target card: method=${targetCard?.method}  hasStream=${Boolean(targetCard?.stream)}  stream=${String(targetCard?.stream || '').slice(0, 100)}`);
  let json = null;
  if (targetCard && targetCard.stream) {
    const b2 = Date.now();
    json = await client.resolveVideoJson(targetCard.stream);
    console.log(`  B4 resolveVideoJson (cluster GET): ${Date.now() - b2}ms  -> ${json ? 'play' : 'null'} q=[${qualityKeys(json?.quality).join(',')}]`);
  }
  const b3 = Date.now();
  const playable = provider.resolveVideo ? await provider.resolveVideo(ctx) : null;
  console.log(`  B5 provider.resolveVideo() (full, cache-warm): ${Date.now() - b3}ms  -> ${playable ? playable.method : 'null'}`);

  // ─────────────────────────── PART C. E-Online floor: direct cluster + direct CDN ───────────────────────────
  console.log('\n[PART C] E-ONLINE FLOOR — direct cluster lite/filmix (same account, no proxy)');
  const liteStart = Date.now();
  const liteHtml = await client.getLite({ ...SPIDER, serial: '0' });
  console.log(`  C1 direct lite/filmix (cluster): ${Date.now() - liteStart}ms  len=${String(liteHtml || '').length}`);
  const { SkazNormalizer } = await import('/opt/maniya-online/server/src/providers/skaz/SkazNormalizer.js');
  const cards = new SkazNormalizer().cards(liteHtml || '');
  console.log(`     cluster cards=${cards.length}  play=${cards.filter((c) => c.method === 'play').length}  call=${cards.filter((c) => c.method === 'call').length}  link=${cards.filter((c) => c.method === 'link').length}`);
  const cTarget = cards.find((c) => /Дубляж/i.test(String(c.translate || c.title || c._text || '')) && /Ukr|AD|звук/i.test(String(c.translate || c.title || c._text || '')))
    || cards.find((c) => /Дубляж/i.test(String(c.translate || c.title || c._text || '')));
  if (cTarget) {
    console.log(`  C2 cluster target: method=${cTarget.method} translate="${cTarget.translate || cTarget.title || cTarget._text}"`);
    const cUrl = String(cTarget.url || cTarget.stream || '');
    if (cUrl) {
      const c0 = Date.now();
      const cm = await timedGet(cUrl, { headers: MIME });
      console.log(`  C3 DIRECT cluster-CDN master (E-Online floor): ${Date.now() - c0}ms`);
      show(cm, '      ');
    }
  } else {
    console.log('  C2 cluster target НЕ найден (переводы не содержат «Дубляж»)');
    cards.filter((c) => c.method !== 'link').slice(0, 12).forEach((c, i) => console.log(`      c[${i}] ${c.method}  "${c.translate || c.title || c._text || ''}"`));
  }

  // ─────────────────────────── SUMMARY ───────────────────────────
  console.log('\n=== SUMMARY (median-style, single pass) ===');
  console.log(`MANIYA select->frame (approx):
  /videos=${vr.totalMs}ms${hit.method === 'call' ? `  /video=${videoMs}ms` : '  (play: no /video)'}
  proxied master ttfb=${pm.ttfbMs}ms total=${pm.totalMs}ms  (via :3000)
  + variant + init + seg[0] via proxy (sequential)`);
  if (variant?.url && directCdn) {
    console.log(`\nDELTA proxy vs direct (same CDN, VPS network):
  master:  proxied ttfb=${pm.ttfbMs}ms total=${pm.totalMs}ms  vs  direct (see A5)`);
  }
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e.stack || e); process.exit(1); });
