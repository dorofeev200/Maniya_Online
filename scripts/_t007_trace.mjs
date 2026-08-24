// SKAZ-MANIYA-007 §trace — differential playback trace, READ-ONLY.
// MANIYA leg: prod public HTTPS (b1f98f8c). SKAZ leg: skaz.tv cluster (reference lampa).
// Prints one crisp line per step. No server-side writes anywhere.
import fs from 'node:fs';
import path from 'node:path';

const PROD = 'https://plugin.maniya-kvn.online';
const TOKEN = 'mo-admin-test-2026';

// SKAZ creds from local server/.env
const env = {};
for (const line of fs.readFileSync(path.resolve('server/.env'), 'utf8').split(/\r?\n/)) {
  if (line && !line.startsWith('#') && line.includes('=')) {
    const i = line.indexOf('=');
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
}
const SKAZ_EMAIL = env.SKAZ_ACCOUNT_EMAIL || '';
const SKAZ_UID = env.SKAZ_UID || '';
const SKAZ_ORIGIN = env.SKAZ_ORIGIN || 'http://lampa.mx';

const REDACT = (u) => String(u || '')
  .replace(/account_email=[^&]*/, 'account_email=***')
  .replace(/uid=[^&]*/, 'uid=***')
  .replace(/token=[^&]*/, 'token=***')
  .replace(/hash=[^&]*/, 'hash=***')
  .replace(/play\.[^&]*/, 'play.***');
const HOST = (u) => { try { return new URL(u).host } catch { return '' } };
const CT = (x) => String(x || '').slice(0, 60);

async function g(url, { headers = {}, ms = 60000, range } = {}) {
  const t0 = Date.now();
  const h = { ...headers };
  if (range) h.Range = range;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: h, redirect: 'follow' });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ms: Date.now() - t0, ctype: r.headers.get('content-type') || '', len: buf.length, hdrs: Object.fromEntries(r.headers.entries()), finalUrl: r.url || '', body: buf };
  } catch (e) {
    return { status: 'ERR', ms: Date.now() - t0, error: String(e).slice(0, 80), body: Buffer.alloc(0), ctype: '', len: 0 };
  }
}
const b16 = (b, n = 12) => b.length ? b.slice(0, n).toString('hex') : '(empty)';
function pickVariant(master, needle) {
  // master m3u8: EXT-X-STREAM-INF with next line = URI
  const lines = master.split(/\r?\n/);
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^#EXT-X-STREAM-INF/i.test(lines[i]) && lines[i + 1] && !lines[i + 1].startsWith('#')) {
      variants.push({ meta: lines[i], uri: lines[i + 1] });
    }
  }
  if (!variants.length) return { variants };
  const scored = variants.map((v) => ({
    ...v,
    score: (needle[k = 'q'] ? (v.meta + v.uri).includes(needle.q) : true) ? 1 : 0
  })).sort((a, b) => b.score - a.score);
  return { variants, pick: scored[0] };
}

function filmixItemsFromItems(items) {
  // pick per-item: return items with method/url/headers/quality + voice
  return items.map((it, idx) => ({
    idx, method: it.method, type: it.type, title: it.title, voice_name: it.voice_name,
    url: it.url || '', headers: it.headers || {}, quality: it.quality || {}
  }));
}

const log = (s) => console.log(s);

(async () => {
  log('════════ MANIYA LEG (prod ' + PROD + ', token=' + TOKEN + ') ════════');
  const q = new URLSearchParams({
    token: TOKEN, provider: 'filmix', source: 'tmdb',
    title: 'История игрушек 5', original_title: 'Toy Story 5', year: '2026', serial: '0'
  });
  const vres = await g(`${PROD}/api/lampa/videos?${q}`);
  log(`M1 /videos → HTTP ${vres.status} (${vres.ms}ms) len=${vres.len} ctype=${CT(vres.ctype)}`);
  let j = null; try { j = JSON.parse(vres.body.toString('utf8')) } catch {}
  const items = (j && j.items) || [];
  log(`M1 items=${items.length}${j && j.provider_error ? ' provider_error=' + JSON.stringify(j.provider_error) : ''}`);
  if (!items.length) return;
  for (const it of filmixItemsFromItems(items)) {
    log(`M1 item[${it.idx}] voice="${it.voice_name}" type=${it.type} title="${it.title}" qualities=${Object.keys(it.quality).join('/')} url=${REDACT(it.url).slice(0, 110)} hdrs=${JSON.stringify(it.headers)}`);
  }
  // choose Дубляж 4K SDR
  const artifact = /(4К|4K|2160)/i;
  const sdr = /SDR/i;
  let target = items.find((it) => {
    const keys = Object.keys(it.quality || {});
    const qs = it.voice_name + ' ' + keys.join(' ') + ' ' + JSON.stringify(it.quality);
    return artifact.test(qs) && sdr.test(qs) && /Дубляж/i.test(it.voice_name || '');
  }) || items.find((it) => artifact.test(JSON.stringify(it.quality || {})));
  if (!target) { log('M1 no 4K target — using item0'); target = items[0]; }
  log(`M1 TARGET voice="${target.voice_name}" url=${REDACT(target.url).slice(0, 140)}`);

  // M3: proxy fetch of the m3u8, with the item headers like Lampa.Player would (Referer filmix.my)
  const M3_H = { ...(target.headers || {}), 'User-Agent': 'Lampa/2.4.7' };
  const m3 = await g(target.url, { headers: M3_H });
  const m3Orig = REDACT(target.url);
  log(`M3 play-url body → HTTP ${m3.status} (${m3.ms}ms) ctype=${CT(m3.ctype)} len=${m3.len} final=${HOST(m3.finalUrl)} b16=${b16(m3.body)}`);
  log(`M3 final-url=${REDACT(m3.finalUrl).slice(0, 120)}`);
  const m3text = m3.body.toString('utf8');
  log(`M3 body head: ${m3text.replace(/\r?\n/g, '⏎').slice(0, 220)}`);

  const hasStreamInf = /#EXT-X-STREAM-INF/i.test(m3text);
  if (m3.status === 200 && (/EXT-X-STREAM-INF/i.test(m3text))) {
    log('M3 → MASTER HLS');
    const { variants, pick } = pickVariant(m3text, {});
    log(`M3 master variants=${variants.length}`);
    for (const v of variants.slice(0, 12)) log(`M3   ${v.meta.slice(0, 90)} → ${REDACT(v.uri).slice(0, 90)}`);
    if (pick) {} // master-level only (not in this source normally)
  }

  // Segments live either in the media playlist or right in the single-level playlist
  const rawSegs = m3text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  log(`${hasStreamInf ? 'M4' : 'M4-single'} segments=${rawSegs.length} first=${REDACT(rawSegs[0] || '').slice(0, 130)}`);
  if (rawSegs.length) {
    const seg1 = new URL(rawSegs[0], m3.finalUrl).toString();
    const seg2 = new URL(rawSegs[1] || rawSegs[0], m3.finalUrl).toString();
    const s1 = await g(seg1, { headers: { 'User-Agent': 'Lampa/2.4.7' } }); // NO referer — player/hls.js
    log(`M5 seg#1 via proxy (no-referer) → HTTP ${s1.status} (${s1.ms}ms) ctype=${CT(s1.ctype)} len=${s1.len} b16=${b16(s1.body, 8)}`);
    const s2 = await g(seg2, { headers: { 'User-Agent': 'Lampa/2.4.7' } });
    log(`M5 seg#2 via proxy (no-referer) → HTTP ${s2.status} (${s2.ms}ms) ctype=${CT(s2.ctype)} len=${s2.len} b16=${b16(s2.body, 8)}`);
    log(`M5 seg#1 proxy-url inner: ${REDACT(seg1).slice(0, 150)}`);
    const cdnSeg = (() => { try { return new URL(seg1).searchParams.get('url') } catch { return null } })();
    if (cdnSeg) {
      log(`M5 CDN segment direct: ${REDACT(cdnSeg).slice(0, 150)}`);
      for (const [label, hdrs] of [
        ['no-referer', { 'User-Agent': 'Mozilla/5.0' }],
        ['Referer filmix.my', { 'User-Agent': 'Mozilla/5.0', Referer: 'https://filmix.my/' }],
        ['Origin lampa.mx', { 'User-Agent': 'Mozilla/5.0', Origin: 'http://lampa.mx', Referer: 'https://filmix.my/' }],
      ]) {
        const d = await g(cdnSeg, { headers: hdrs, ms: 30000 });
        log(`M5 seg direct [${label}] → HTTP ${d.status} (${d.ms}ms) ctype=${CT(d.ctype)} len=${d.len} b16=${b16(d.body, 8)}`);
      }
      // d) through-proxy WITH ref param restored (what buildProxyUrl does if upstream ref were set)
      const segWithRef = new URL(seg1); segWithRef.searchParams.set('ref', 'https://filmix.my/');
      const sr = await g(segWithRef.toString(), { headers: { 'User-Agent': 'Lampa/2.4.7' } });
      log(`M5 seg#1 via proxy +ref=filmix.my → HTTP ${sr.status} (${sr.ms}ms) ctype=${CT(sr.ctype)} len=${sr.len} b16=${b16(sr.body, 8)}`);
      // e) proxy request WITH the Referer HEADER like Lampa play.headers would send on manifest only (segments don't)
      const sr2 = await g(seg1, { headers: { 'User-Agent': 'Lampa/2.4.7', Referer: 'https://filmix.my/' } });
      log(`M5 seg#1 via proxy +Referer-header → HTTP ${sr2.status} (${sr2.ms}ms) ctype=${CT(sr2.ctype)} len=${sr2.len} b16=${b16(sr2.body, 8)}`);
    }
  } else if (m3.status === 200 && !hasStreamInf && m3.body.length > 4) {
    log('M3 body is DIRECT MEDIA (mp4/ts) — no HLS chain');
  } else {
    log('M3 unexpected: ' + JSON.stringify({ status: m3.status, ctype: m3.ctype }).slice(0, 120));
  }

  log('');
  log('════════ SKAZ LEG (reference lampa cluster) ════════');
  const skazHosts = ['http://online3.skaz.tv', 'http://online8.skaz.tv', 'http://94.249.239.63', 'http://94.249.239.37', 'http://94.249.239.11', 'http://77.90.33.109'];
  let sres = null, stext = '';
  for (const host of skazHosts) {
    const stu = `${host}/lite/filmix?search=${encodeURIComponent('Toy Story 5')}&account_email=${encodeURIComponent(SKAZ_EMAIL)}&uid=${encodeURIComponent(SKAZ_UID)}`;
    const r = await g(stu, { headers: { accept: '*/*' }, ms: 20000 });
    log(`S1 search ${host.replace(/^http:\/\//, '')} → HTTP ${r.status} (${r.ms}ms) len=${r.len}`);
    if (r.status === 200 && r.len > 10) { sres = r; stext = r.body.toString('utf8'); break; }
    await new Promise((s) => setTimeout(s, 700));
  }
  if (!sres) { log('S1 all hosts failed'); return; }
  log(`S1 html head: ${stext.replace(/\s+/g, ' ').slice(0, 240)}`);
  const cards = [...stext.matchAll(/data-json="([^"]+)"/g)].map((m) => { try { return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')) } catch { return null } }).filter(Boolean);
  log(`S1 cards=${cards.length} method/url sample:`);
  for (const c of cards.slice(0, 6)) log(`S1   card method=${c.method} url=${REDACT(c.url || '').slice(0, 120)} q=${c.quality || ''} subtitle=${c.subtitle || c.title || ''}`);
  const playable = cards.filter((c) => /play|video/i.test(String(c.method || '')) || /\.(m3u8|mp4|ts)(\?|$)/i.test(String(c.url || '')));
  log(`S1 playable=${playable.length}`);
  for (const c of playable.slice(0, 8)) log(`S1   PLAY method=${c.method} q=${c.quality || ''} url=${REDACT(c.url || '').slice(0, 150)}`);
  // pick 4K SDR Дубляж best effort: match quality/bandwidth
  let pick = playable.find((c) => /Дубляж/i.test(String(c.subtitle || c.title || c.voice || '')) && /4K|2160/i.test(String(c.quality || ''))) || playable[0];
  if (!pick) { log('S1 no playable — dump first 1200 chars'); log(stext.replace(/\s+/g, ' ').slice(0, 1200)); return; }
  log(`S1 TARGET quality=${pick.quality || ''} url=${REDACT(pick.url || '').slice(0, 150)}`);
  const finalUrl = pick.url;
  // Treat as player: fetch directly (Skaz items are direct URLs; no proxy)
  const pf = await g(finalUrl, { headers: { 'User-Agent': 'Lampa/2.4.7', Origin: SKAZ_ORIGIN, Referer: SKAZ_ORIGIN }, range: 'bytes=0-1023', ms: 30000 });
  log(`S2 final-url Range fetch → HTTP ${pf.status} (${pf.ms}ms) ctype=${CT(pf.ctype)} len=${pf.len} final-host=${HOST(pf.finalUrl)} b16=${b16(pf.body)}`);
  log(`S2 final-url=${REDACT(pf.finalUrl).slice(0, 140)}`);
  if (/\.m3u8/i.test(finalUrl) || /EXT-X/i.test(pf.body.toString('utf8').slice(0, 300))) {
    // HLS chain on skaz side
    const master = pf.body.toString('utf8');
    log(`S2 MASTER HLS head: ${master.replace(/\r?\n/g, '⏎').slice(0, 200)}`);
  } else {
    log('S2 → DIRECT MEDIA (mp4/ts). Skaz plays single-file progressive; NO HLS fragment chain.');
    // second chunk
    const pf2 = await g(finalUrl, { headers: { 'User-Agent': 'Lampa/2.4.7', Origin: SKAZ_ORIGIN }, range: 'bytes=1000000-1002047', ms: 30000 });
    log(`S2 second-chunk bytes=1000000-1002047 → HTTP ${pf2.status} (${pf2.ms}ms) len=${pf2.len} ctype=${CT(pf2.ctype)}`);
  }
  log('════════ END TRACE ════════');
})().catch((e) => { console.error('TRACE-FAIL', e); process.exit(1); });