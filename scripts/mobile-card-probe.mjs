// MOBILE CARD + LAZY-RESOLVE POST-DEPLOY PROBE (runs ON the VPS, targets prod)
// 1) Провайдеры: /api/lampa/videos → items[] (filmix/skaz-alloha/hdvb)
// 2) Lazy-resolve: /api/lampa/video (резолв выбранного голоса) → play-дескриптор
// 3) Alloha 1080p playback: дескриптор → мастер → вариант 1080p → init → сегмент
import { readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3000';
const users = JSON.parse(readFileSync('/opt/maniya-online/server/data/users.json', 'utf8'));
const arr = Array.isArray(users) ? users : (users.users || []);
const token = (arr.find((x) => x && x.active && x.token) || arr[0])?.token || '';
if (!token) { console.error('ERR: нет токена в prod users.json'); process.exit(2); }

const SPIDER = {
  id: '634649', tmdb_id: '634649', imdb_id: 'tt10872600', kinopoisk_id: '1309570',
  title: 'Человек-паук: Нет пути домой', original_title: 'Spider-Man: No Way Home',
  serial: '0', year: '2021', source: 'tmdb'
};
const MANIFEST_HEADERS = { 'Accept': 'application/vnd.apple.mpegurl,*/*', 'User-Agent': 'Mozilla/5.0 Chrome/126' };
const UA = 'Mozilla/5.0 Chrome/126';

async function get(url, headers = {}, readBody = true) {
  const t0 = Date.now();
  let r;
  try {
    r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers: { 'User-Agent': UA, ...headers } });
  } catch (e) {
    return { err: e.message, ms: Date.now() - t0, status: 0 };
  }
  const ms = Date.now() - t0;
  const ct = String(r.headers.get('content-type') || '').split(';')[0];
  if (!readBody) { await r.body?.cancel?.().catch?.(() => {}); return { ms, status: r.status, ct }; }
  const buf = Buffer.from(await r.arrayBuffer().catch(() => new Uint8Array(0)));
  return { ms, status: r.status, ct, bytes: buf.length, text: buf.toString('utf8') };
}

function resolveUrl(ref, baseUrl) {
  try { return ref == null ? null : new URL(String(ref), baseUrl).toString(); } catch { return null; }
}
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
  let picked = variants[0] || null;
  for (const v of variants) if (/#EXT-X-STREAM-INF[^\n]*RESOLUTION=1920x1080/i.test(v.join('\n'))) { picked = v; break; }
  if (!picked) return null;
  const urlLine = picked.filter((l) => !l.startsWith('#')).pop() || '';
  return { url: resolveUrl(urlLine, masterUrl), attr: picked.find((l) => l.startsWith('#EXT-X-STREAM-INF')) || '' };
}

async function probeProvider(provider) {
  const q = new URLSearchParams({ token, provider, ...SPIDER });
  const r = await get(`${BASE}/api/lampa/videos?${q}`);
  if (r.status !== 200) { console.log(`${provider}: HTTP ${r.status} ${r.ms}ms ERR`); return; }
  const items = (JSON.parse(r.text || '{}') || {}).items || [];
  const it = items[0] || {};
  const qm = it.quality && typeof it.quality === 'object' ? Object.keys(it.quality) : (it.quality || '');
  console.log(`${provider}: HTTP 200 ${r.ms}ms items=${items.length} method=${it.method || '-'} ` +
    `voice=${it.voice_name || '-'} title="${(it.title || '').slice(0, 24)}" quality=${JSON.stringify(qm)}`);
  return items;
}

async function lazyResolveAlloha1080p() {
  const items = await probeProvider('skaz-alloha');
  const call = items?.[0];
  if (!call || call.method !== 'call') { console.log('lazy: FAIL item[0] не method=call'); return; }
  console.log(`lazy: call-item URL=${call.url.slice(0, 90)}…`);

  const rd = await get(call.url.replace(/^https:\/\/plugin\.maniya-kvn\.online/, 'http://127.0.0.1:3000'));
  let play = null; try { play = JSON.parse(rd.text || '{}'); } catch {}
  if (rd.status !== 200 || play.method !== 'play' || !play.url) {
    console.log(`lazy/video: FAIL HTTP ${rd.status} method=${play?.method} hasUrl=${Boolean(play?.url)}`); return;
  }
  const qmap = play.quality && typeof play.quality === 'object' ? Object.keys(play.quality) : [];
  console.log(`lazy/video: HTTP 200 ${rd.ms}ms method=play voice="${play.voice_name}" quality=${JSON.stringify(qmap)} ` +
    `subs=${play.subtitles?.length ?? 0}`);

  const has1080 = qmap.includes('1080p') || (play.quality && typeof play.quality === 'object' && play.quality['1080p']);
  const primary = String(play.url).split(/\s+or\s+/i)[0].trim();
  const m = await get(primary, MANIFEST_HEADERS);
  console.log(`master: HTTP ${m.status} ${m.ms}ms ct=${m.ct}`);
  if (m.status !== 200) return;
  const isStreamInf = /#EXT-X-STREAM-INF/i.test(m.text || '');
  if (!isStreamInf) { console.log('playback: master не ремап (низкий формат) — проверяем сегмент'); }
  let segStatus = null, initStatus = null, variantInfo = '';
  if (isStreamInf) {
    const v = pickVariant(m.text, primary);
    variantInfo = v ? (v.attr.slice(0, 50)) : '';
    if (v?.url) {
      const vr = await get(v.url, MANIFEST_HEADERS);
      console.log(`variant 1080p: HTTP ${vr.status} ${vr.ms}ms ct=${vr.ct} [${variantInfo}]`);
      if (vr.status === 200 && vr.text) {
        const xmap = (vr.text.match(/#EXT-X-MAP:[^\n]*URI="([^"]+)"/) || [])[1] || null;
        if (xmap) {
          const iu = resolveUrl(xmap, v.url);
          const ir = await get(iu, { Range: 'bytes=0-1048575' });
          initStatus = `${ir.status}/${ir.ct}`;
          console.log(`init: HTTP ${ir.status} ${ir.ms}ms ct=${ir.ct}`);
        }
        const segLine = vr.text.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).pop();
        if (segLine) {
          const su = resolveUrl(segLine, v.url);
          const sr = await get(su, { Range: 'bytes=0-1048575' });
          segStatus = `${sr.status}/${sr.ct}`;
          console.log(`segment: HTTP ${sr.status} ${sr.ms}ms ct=${sr.ct} bytes=${sr.bytes}`);
        }
      }
    }
  } else {
    const segLine = String(m.text || '').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).pop();
    if (segLine) {
      const su = resolveUrl(segLine, primary);
      const sr = await get(su, { Range: 'bytes=0-1048575' });
      segStatus = `${sr.status}/${sr.ct}`;
      console.log(`segment(low): HTTP ${sr.status} ${sr.ms}ms ct=${sr.ct}`);
    }
  }
  const ok = has1080 && (segStatus?.startsWith('206') || segStatus?.startsWith('200'));
  console.log(`lazy-resolve+1080p+playback: ${ok ? 'OK' : 'CHECK'} (1080=${has1080}, seg=${segStatus}, init=${initStatus})`);
}

console.log('=== PROVIDERS (шаг 5) ===');
await probeProvider('filmix');
await probeProvider('skaz-alloha');
await probeProvider('hdvb');
console.log('\n=== LAZY-RESOLVE + ALLOHA 1080p PLAYBACK (шаг 6) ===');
await lazyResolveAlloha1080p();
