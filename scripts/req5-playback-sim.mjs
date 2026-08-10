// PROBE 5 (VPS): «симулятор плеера hls.js». Воспроизводит ТОЧНУЮ последовательность
// запросов hls.js/Lampa к item текущего Maniya-сервера (skaz-alloha, «Человек-паук»):
//   item.url (мастер через нашу прокси) → вариант → render-плейлист → EXT-X-MAP init → сегмент.
// Вывод: PASS/FAIL для играбельности и почему (duration/ENDLIST/magic). Проверка того,
// что проигрывание реально стартует (источник 00:00 у пользователя vs рабочий end-to-end).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..', 'server');
const config = (await import(path.join(serverDir, 'src', 'config.js'))).config;

const SPIDER = {
  id: '634649', tmdb_id: '634649', imdb_id: 'tt10872600', kinopoisk_id: '1309570',
  title: 'Человек-паук: Нет пути домой', original_title: 'Spider-Man: No Way Home',
  serial: '0', year: '2021'
};

const users = JSON.parse(readFileSync(config.usersFile, 'utf8'));
const token = (Array.isArray(users) && (users.find((x) => x && x.active && x.token) || users[0])?.token) || '';

function short(u) {
  if (!u) return '';
  try {
    const p = new URL(u);
    const inner = p.searchParams.get('url');
    if (inner) { try { const k = new URL(inner); return `${p.host}${k.hostname}${k.pathname.slice(0, 44)}`; } catch { return `${p.host}...`; } }
    return `${p.host}${p.pathname}`;
  } catch { return String(u).slice(0, 80); }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
async function get(url, { range = false, hls = false } = {}) {
  const headers = { 'User-Agent': UA, 'Accept': hls ? 'application/vnd.apple.mpegurl,*/*' : '*/*' };
  if (range) headers.Range = 'bytes=0-1048575';
  const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  const status = r.status;
  const ct = String(r.headers.get('content-type') || '').split(';')[0];
  let body = null;
  let buf = null;
  if (/mpegurl|dash\+xml|text\/plain|application\/octet-stream/i.test(ct) || !ct || String(url).includes('.m3u8')) {
    body = await r.text();
  } else {
    buf = Buffer.from(await r.arrayBuffer());
  }
  return { status, ct, body, buf, finalUrl: r.url };
}

function lines(body) { return String(body || '').split(/\r?\n/).filter((l) => l && !l.startsWith('#')); }

async function sim(item, idx) {
  const tags = [];
  const fail = (step, why) => { tags.push(`FAIL:${step}:${why}`); };
  if (!item?.url) { console.log(`[item${idx}] no url`); return null; }

  // 1) мастер (через нашу прокси)
  let r = await get(item.url, { hls: true });
  if (r.status !== 200 || !/mpegurl/.test(r.ct)) fail('master', `${r.status} ${r.ct}`);
  let lns = lines(r.body);
  const variants = lns.filter((l) => !/^https?:/.test(l) || true); // мастер может содержать относительные/абсолютные варианты
  if (!lns.length) fail('master', 'no media rows');
  // #EXT-X-STREAM-INF → первый вариант
  const hasStreamInf = /#EXT-X-STREAM-INF/i.test(r.body);
  const target = hasStreamInf ? variants[0] : null;
  if (hasStreamInf && !target) fail('master', 'variant missing');
  console.log(`[item${idx}] master ${r.status} ${r.ct} rows=${lns.length} streamInf=${hasStreamInf}`);

  // 2) вариант (только если мастер — мультивариант; иначе мастер уже render)
  let renderBody = hasStreamInf ? null : r.body;
  let renderUrl = item.url;
  if (hasStreamInf) {
    const variantUrl = new URL(target, r.finalUrl).toString();
    r = await get(variantUrl, { hls: true });
    if (r.status !== 200 || !/mpegurl/.test(r.ct)) fail('variant', `${r.status} ${r.ct}`);
    renderBody = r.body;
    renderUrl = variantUrl;
    console.log(`  variant ${short(variantUrl)} -> ${r.status} ${r.ct}`);
  }

  // 3) render-плейлист
  const extinf = (renderBody.match(/#EXTINF:([\d.]+)/g) || []).map((e) => parseFloat(e.slice(8)));
  const durSum = extinf.length ? extinf.reduce((a, b) => a + b, 0) : null;
  const endlist = /#EXT-X-ENDLIST/g.test(renderBody);
  const ptype = (renderBody.match(/#EXT-X-PLAYLIST-TYPE:([A-Z0-9-]+)/) || [])[1] || '-';
  const media = lines(renderBody);
  const xmapMatch = renderBody.match(/#EXT-X-MAP:([^\n]+)/);
  console.log(`  render ${renderUrl ? short(renderUrl) : ''} extinf=${extinf.length} dur=${durSum != null ? Math.round(durSum) + 's' : '-'} type=${ptype} ENDLIST=${endlist} X-MAP=${Boolean(xmapMatch)} segCount=${media.length}`);
  if (durSum != null && durSum < 8000) fail('render', `dur ${Math.round(durSum)}s < 02:00`);
  if (!extinf.length) fail('render', 'no EXTINF');
  if (!media.length) fail('render', 'no segments');

  // 4) EXT-X-MAP init
  if (xmapMatch) {
    const uri = (xmapMatch[1].match(/URI="([^"]+)"/) || [])[1];
    if (uri) {
      const initUrl = new URL(uri.replace(/^(?!https?:)/, ''), renderUrl).toString();
      r = await get(initUrl, { range: true });
      const ok = r.status === 206 || r.status === 200;
      const magic = r.buf ? r.buf.subarray(4, 8).toString('ascii') : '';
      if (!ok || !(magic === 'ftyp' || magic === 'moov')) fail('init', `${r.status} ${r.ct} magic=${magic}`);
      console.log(`  init ${r.status} ${r.ct} magic4=${magic} bytes=${r.buf?.length || 0}`);
    }
  } else {
    console.log('  init (no EXT-X-MAP)');
  }

  // 5) первый сегмент
  const seg0 = media[0];
  if (seg0) {
    const segUrl = new URL(String(seg0).startsWith('http') ? seg0 : seg0, renderUrl).toString();
    r = await get(segUrl, { range: true });
    const magic = r.buf ? r.buf.subarray(0, 4).toString('hex') : '';
    const ok = r.status === 206 || r.status === 200;
    if (!ok || !/video\/mp4|mp4/.test(r.ct)) fail('segment', `${r.status} ${r.ct}`);
    console.log(`  seg0 ${r.status} ${r.ct} bytes=${r.buf?.length || 0} magic=${magic}`);
  }

  const keys = { quality: Object.keys(item.quality || {}).length, subs: (item.subtitles || []).length, poster: item.poster ? 'Y' : 'N' };
  console.log(`  payload: quality=${JSON.stringify(Object.keys(item.quality || {}))} subs=${keys.subs} poster=${keys.poster}`);
  if (tags.length) { console.log(`  VERDICT: ${tags.join(' | ')}`); return 'FAIL'; }
  console.log('  VERDICT: PLAYABLE');
  return 'PASS';
}

const q = new URLSearchParams({ token, provider: 'skaz-alloha', ...SPIDER });
const vr = await fetch(`http://127.0.0.1:3000/api/lampa/videos?${q}`, { signal: AbortSignal.timeout(60000) });
const payload = await vr.json();
console.log(`Videos: HTTP ${vr.status} items=${(payload.items || []).length}`);

let verdicts = [];
for (let i = 0; i < Math.min(2, (payload.items || []).length); i++) {
  verdicts.push(await sim(payload.items[i], i));
}
console.log(`\n== REQ5 SUMMARY: ${verdicts.filter((v) => v === 'PASS').length}/2 playable (current deployed) ==`);