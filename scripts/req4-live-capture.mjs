// PROBE 4 (LOCAL): полный RAW-захват Alloha (skaz-alloha) для «Человек-паук: Нет пути домой».
// 1) HTML movie-страницы lite/alloha → raw/alloha-spiderman.movie.html (+поиск постеров);
// 2) JSON video первой call-карточки → raw/alloha-spiderman.video.json (+структура);
// 3) Диагностика 00:00: разбор MASTER → variant → render playlist (#EXTINF/ENDLIST/X-MAP/абс-URLы),
//    сравниваем URL первичный из JSON и финальный после resolveStream(play=true).
// Секреты: account_email/uid при печати маскируются; в файлы raw кладём как есть (локально, в raw/).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(here, 'raw');
mkdirSync(rawDir, { recursive: true });
const config = (await import(pathToFileURL(path.join(here, '..', 'server', 'src', 'config.js')))).config;

const SPIDER = {
  id: '634649', tmdb_id: '634649', imdb_id: 'tt10872600', kinopoisk_id: '1309570',
  title: 'Человек-паук: Нет пути домой', original_title: 'Spider-Man: No Way Home',
  serial: '0', year: '2021'
};

const AUTH = { account_email: config.skaz.accountEmail, uid: config.skaz.uid };

function host(u) { try { return new URL(u).hostname; } catch { return String(u).slice(0, 80); } }
function maskAuth(u) {
  try { const p = new URL(u); for (const k of ['account_email', 'uid']) if (p.searchParams.get(k)) p.searchParams.set(k, k === 'account_email' ? 'MASKED_EMAIL' : 'MASKED_UID'); return `${p.hostname}${p.pathname}?${[...p.searchParams].map(([k]) => k).join('&')}`; }
  catch { return String(u).slice(0, 80); }
}
function plKey(n) { return String(n).replace(/-/g, '_'); }

async function main() {
  const base = config.skaz.allowHosts ? '' : ''; // заглушка — хост из пула напрямую

  // ---------- 1) MOVIE PAGE ----------
  const q = new URLSearchParams({ ...SPIDER, serial: '0', source: 'tmdb', orid: '', ...AUTH });
  const host0 = config.skaz.hosts[0];
  const pageUrl = `${host0}/lite/alloha?${q}`;
  const r = await fetch(pageUrl, { signal: AbortSignal.timeout(20000) });
  const html = await r.text();
  const movieFile = path.join(rawDir, 'alloha-spiderman.movie.html');
  writeFileSync(movieFile, html);
  console.log(`MOVIE PAGE: HTTP ${r.status} len=${html.length} -> ${movieFile}`);
  console.log('  auth-params in URL:', maskAuth(pageUrl));

  // Поиск постеров: tmdb/картинки в data-json/атрибутах
  const posterRe = /(?:poster|backdrop|image_path|\.poster\s*[:=]|..image.tmdb.org.)[^"'>\s]{0,120}/gi;
  const posterHits = (html.match(posterRe) || []).slice(0, 12);
  if (posterHits.length) {
    console.log('  POSTER HINTS:', posterHits.map((h) => { try { const u = new URL(h.split(/[=:]/).pop().trim().replace(/^["']/, '')); return `${u.host}${u.pathname.slice(0, 60)}`; } catch { return h.slice(0, 80); } }));
  } else {
    console.log('  POSTER HINTS: (none found in page, checking data-json body)');
    const re = /data-json\s*=\s*(['"])([\s\S]*?)\1/g; let m; let found = 0;
    while ((m = re.exec(html)) !== null) { if (/poster|image|backdrop|\.jpg|\.webp/i.test(m[2])) { console.log('   json with image hint len=', m[2].length, m[2].slice(0, 120)); if (++found > 4) break; } }
    if (!found) console.log('   (no poster/image refs in cards either)');
  }
  // Структура карточек
  const cards = [];
  const re = /data-json\s*=\s*(['"])([\s\S]*?)\1/g; let m;
  while ((m = re.exec(html)) !== null) { try { const c = JSON.parse(m[2]); if (c && typeof c === 'object' && c.method) cards.push(c); } catch {} }
  console.log(`  cards=${cards.length}`);
  cards.forEach((c, i) => {
    console.log(`   [#${i}] method=${c.method} title=${String(c._text || c.translate || c.title || '').slice(0, 28)} s=${c.s ?? '-'} e=${c.e ?? '-'} img=${c.image || c.poster || '-'}`);
  });

  // ---------- 2) JSON VIDEO ----------
  const first = cards.find((c) => c.method === 'call' && c.s == null && c.e == null);
  if (first?.stream) {
    const video = new URL(first.stream);
    video.pathname = video.pathname.replace(/\.m3u8$/, '');
    video.searchParams.delete('play');
    const jr = await fetch(video.toString(), { headers: { Origin: config.skaz.origin }, signal: AbortSignal.timeout(25000) });
    const rawJson = await jr.text();
    const videoFile = path.join(rawDir, 'alloha-spiderman.video.json');
    writeFileSync(videoFile, rawJson);
    console.log(`\nJSON VIDEO: HTTP ${jr.status} ct=${jr.headers.get('content-type')} len=${rawJson.length} -> ${videoFile}`);
    let json = null; try { json = JSON.parse(rawJson); } catch { console.log('  raw=', rawJson.slice(0, 200)); return; }
    console.log('  keys=', Object.keys(json).join(','));
    if (json.url) console.log('  url=', maskAuth(String(json.url)));
    const qk = json.quality ? Object.keys(json.quality) : [];
    console.log('  quality=', qk.join(','));
    for (let i = 0; i < qk.length; i++) console.log(`     ${qk[i]} -> ${host(String(json.quality[qk[i]]))} ...`);
    console.log('  subtitles=', Array.isArray(json.subtitles) ? json.subtitles.length : '-');
    if (Array.isArray(json.subtitles)) json.subtitles.slice(0, 3).forEach((s, i) => console.log(`     sub[${i}] keys=${s && typeof s === 'object' ? Object.keys(s).join(',') : typeof s}`));
    if (json.segments) console.log('  segments=', JSON.stringify(json.segments).slice(0, 200));
    const primary = String(json.url).split(/\s+or\s+/)[0];
    await analyzeChain('JSON-primary', primary);

    // ---------- 3) RESOLVE play=true ----------
    const rs = new URL(first.stream);
    const rr = await fetch(rs.toString(), { headers: { Origin: config.skaz.origin }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    console.log(`\nRESOLVE stream(play=true): HTTP ${rr.status} final=${host(rr.url)} ct=${rr.headers.get('content-type')}`);
    const finalBody = await rr.text();
    await analyzeChain('RESOLVE-final', rr.url, finalBody);
  }
}

async function analyzeChain(label, rawUrl, knownBody = null) {
  console.log(`\n=== HLS CHAIN: ${label} ===`);
  console.log('  url=', maskAuth(rawUrl));
  const mk = label.replace(/[^a-z0-9]/gi, '-');
  const r = await fetch(rawUrl, { headers: { Origin: 'http://lampa.mx' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  const body = awaitedText(await r.text(), r);
  writeFileSync(path.join(rawDir, `${mk}.m3u8`), body);
  console.log(`  HTTP ${r.status} final=${host(r.url)} ct=${r.headers.get('content-type')}`);
  const lines = body.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const extinf = (body.match(/#EXTINF:([\d.]+)/g) || []);
  if (body.startsWith('#EXTM3U')) {
    const xmap = /#EXT-X-MAP/g.test(body);
    const endlist = /#EXT-X-ENDLIST/g.test(body);
    const ptype = (body.match(/#EXT-X-PLAYLIST-TYPE:([A-Z0-9-]+)/) || [])[1] || '-';
    const xstreaminf = (body.match(/#EXT-X-STREAM-INF/g) || []).length;
    const durSum = extinf.length ? extinf.map((e) => parseFloat(e.slice(8))).reduce((a, b) => a + b, 0) : null;
    console.log(`  #EXT-X-STREAM-INF=${xstreaminf} #EXTINF=${extinf.length} #EXT-X-MAP=${xmap} PLAYLIST-TYPE=${ptype} ENDLIST=${endlist}`);
    if (durSum != null) console.log(`  durSum=${Math.round(durSum)}s (${formatDur(durSum)}) avg=${(durSum / Math.max(1, extinf.length)).toFixed(2)}s`);
    console.log('  media rows=', lines.length, 'first=', lines[0]?.slice(0, 90));
    const abs = lines.filter((l) => /^https?:\/\//.test(l)).length;
    console.log('  absolute-url rows=', abs, 'hosts=', [...new Set(lines.filter((l) => /^https?:\/\//.test(l)).map((l) => new URL(l).hostname))].join(','));
    const fq = lines.find((l) => /^https?:\/\//.test(l));
    if (fq) { try { const u = new URL(fq); console.log('  seg/q-keys=', [...u.searchParams.keys()].join(',')); } catch {} }
    if (xstreaminf > 0 && lines.length) {
      // это мастер — идём в первый вариант
      const v = lines[0];
      console.log('  master variant=[', v.slice(0, 90), ']');
      await analyzeChain(`${label}/variant`, new URL(v, rawUrl).toString());
    }
  } else {
    console.log('  NOT m3u8 (ct=', r.headers.get('content-type'), ') body=', body.slice(0, 120));
  }
}

function awaitedText(t, r) { return t; }
function formatDur(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

await main();
console.log('\nDONE');