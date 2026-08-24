// FINAL-PLAYBACK-GAP-001: live-проверка AMS-резолва РЕАЛЬНЫМ KodikClient.parsePlayer
// против живой публичной ссылки kodikplayer.com. Токен не нужен (поиск только).
// Магия: если decodeAmsSrc вернёт manifest.m3u8 — цепочка src подтверждена live.
import { KodikClient } from '../server/src/providers/kodik/KodikClient.js';

const client = new KodikClient({}); // без token — parsePlayer не требует token
for (const link of [
  'https://kodikplayer.com/video/726/041d96e0573412e4db1de4a8e425ff91/720p',
]) {
  console.log(`\nLINK: ${link}`);
  try {
    const out = await client.parsePlayer(link);
    const links = out?.links || out;
    let quals = 0, deco = 0;
    for (const [q, list] of Object.entries(links || {})) {
      if (!Array.isArray(list)) continue;
      quals++;
      for (const v of list) {
        const src = typeof v === 'string' ? v : (v?.Src || v?.src || '');
        if (src) { deco++; console.log(`  [${q}] src=${String(src).slice(0, 140)}`); }
      }
    }
    console.log(`RESULT: quals=${quals} decodedSrc=${deco}`);
    const allSrcs = Object.values(links || {}).flat().map((v) => typeof v === 'string' ? v : (v?.Src || ''));
    const m3u8 = allSrcs.filter((s) => s.includes('manifest.m3u8'));
    const steps = await runChainFirst(m3u8[0] || allSrcs[0] || '');
    console.log(`CHAIN: ${steps}`);
  } catch (e) {
    console.log(`ERR ${e?.constructor?.name}: ${String(e?.message || e).slice(0, 120)}`);
  }
}

async function runChainFirst(url) {
  if (!url) return 'no-src';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const bytes = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') || '';
    const text = bytes.toString('utf8');
    const head = text.slice(0, 24).replace(/\n/g, '\\n');
    if (res.status === 200 && /^#EXTM3U/.test(head)) return `m3u8 200/${ct.split(';')[0]} ${bytes.length}B head=${head}`;
    return `first=${res.status}/${ct.split(';')[0]} ${bytes.length}B head=${head}`;
  } catch (e) { return `FETCH-ERR ${String(e).slice(0, 60)}`; }
}
console.log('\nAMS LIVE DONE');