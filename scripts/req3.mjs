// PROBE 3: (а) раскрыть quality/subtitles JSON /lite/alloha/video;
// (б) полная трассировка сегментов через прокси Maniya для item #0.
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
function param(url, key) { try { return new URL(url).searchParams.get(key); } catch { return null; } }
function host(u) { try { const p = new URL(u); return `${p.hostname}${p.pathname}`; } catch { return String(u).slice(0, 60); } }
function walkUrlMap(o, label) {
  if (!o) { console.log(label, '= (none)'); return; }
  if (Array.isArray(o)) {
    console.log(label, '= array len', o.length);
    o.slice(0, 6).forEach((e, i) => {
      if (typeof e === 'string') console.log(`  [${i}] ${e.slice(0, 90)}`);
      else console.log(`  [${i}]`, JSON.stringify(e)?.slice(0, 160));
    });
    return;
  }
  console.log(label, '= keys', Object.keys(o).join(', '));
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string') console.log(`  ${k} -> ${v.slice(0, 110)}`);
    else console.log(`  ${k} -> (${typeof v})`, Array.isArray(v) ? `len ${v.length}` : JSON.stringify(v)?.slice(0, 200));
  }
}

async function jsonVideo() {
  // поток первой карточки → video JSON без play
  const q = new URLSearchParams({ ...SPIDER, serial: '0', source: 'tmdb', account_email: config.skaz.accountEmail, uid: config.skaz.uid, orid: '' });
  const r = await fetch(`http://online3.skaz.tv/lite/alloha?${q}`, { signal: AbortSignal.timeout(20000) });
  const html = await r.text();
  const re = /data-json\s*=\s*(['"])([\s\S]*?)\1/g;
  let m, cards = [];
  while ((m = re.exec(html)) !== null) { try { const c = JSON.parse(m[2]); if (c?.method === 'call') cards.push(c); } catch {} }
  const first = cards.find((c) => c.s == null && c.e == null);
  const video = new URL(first.stream);
  video.pathname = video.pathname.replace(/\.m3u8$/, '');
  video.searchParams.delete('play');
  const jr = await fetch(video.toString(), { headers: { Origin: config.skaz.origin }, signal: AbortSignal.timeout(25000) });
  const json = await jr.json();
  console.log('=== JSON video: quality + subtitles ===');
  walkUrlMap(json.quality, 'quality');
  walkUrlMap(json.subtitles, 'subtitles');
  if (json.segments) console.log('segments=', JSON.stringify(json.segments).slice(0, 200));
  if (json.hls_manifest_timeout) console.log('hls_manifest_timeout=', json.hls_manifest_timeout);
  // первая строка url (primary)
  const primary = String(json.url).split(/\s+or\s+/)[0];
  console.log('primary url host=', host(primary));
  return { cards, json };
}

async function manifestTrace() {
  console.log('\n=== Трассировка манифеста+сегментов через прокси Maniya (item #0) ===');
  // токен юзера
  const fs = await import('node:fs');
  const users = JSON.parse(fs.readFileSync(config.usersFile, 'utf8'));
  const token = (Array.isArray(users) && (users.find((x) => x && x.active && x.token) || users[0])?.token) || '';

  const q = new URLSearchParams({ token, provider: 'skaz-alloha', ...SPIDER });
  const vr = await fetch(`http://127.0.0.1:3000/api/lampa/videos?${q}`, { signal: AbortSignal.timeout(60000) });
  const payload = await vr.json();
  const item0 = payload.items[0];
  console.log('item0 url=', host(item0.url));

  async function get(u, depth) {
    const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const ct = String(r.headers.get('content-type') || '');
    const status = r.status;
    let body = '';
    if (status === 200) body = await r.text();
    console.log(`${'  '.repeat(depth)}[${status}] ${ct.split(';')[0].padEnd(22)} ${host(u)}`);
    return { status, ct, body, url: u, finalUrl: r.url };
  }

  // 1) мастер (proxied) — уже переписан прокси на внутренние URL
  let res = await get(item0.url, 0);
  const masterLines = res.body.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  console.log('  master variant lines=', masterLines.length);
  const firstVariant = masterLines[0];
  if (!firstVariant) { console.log('  !! нет вариантов в мастере'); return; }
  console.log('  variant(pached)=', host(firstVariant));

  // 2) рендер-плейлист
  res = await get(firstVariant, 1);
  const mediaLines = res.body.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  console.log('  media segments=', mediaLines.length);

  // 3) первый сегмент
  const seg = mediaLines[0];
  if (!seg) { console.log('  !! нет сегментов'); return; }
  console.log('  seg(pached)=', host(seg));
  const sr = await fetch(seg, { signal: AbortSignal.timeout(20000), headers: { Range: 'bytes=0-1023' } });
  const sct = String(sr.headers.get('content-type') || '');
  const sbuf = Buffer.from(await sr.arrayBuffer());
  console.log(`  SEG[${sr.status}] ct=${sct.split(';')[0]} bytes=${sbuf.length} magic=${sbuf.subarray(0, 4).toString('hex')}`);
}

await jsonVideo();
await manifestTrace();
console.log('\nDONE');