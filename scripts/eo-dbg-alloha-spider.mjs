// E2E-диагностика Alloha (skaz-alloha) на фильме «Человек-паук: Нет пути домой» (2021).
// Сравнение Maniya-контура (/api/lampa/videos) и прямого skaz-контура (lite/alloha).
// Секреты не печатаются: токен юзера читается из users.json, email/uid — из .env через config,
// в выводе всё маскируется (только hostname + префиксы query).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const serverDir = path.join(here, '..', 'server');
const config = (await import(path.join(serverDir, 'src', 'config.js'))).config;

const SPIDER = {
  id: '634649',
  tmdb_id: '634649',
  imdb_id: 'tt10872600',
  kinopoisk_id: '1309570',
  title: 'Человек-паук: Нет пути домой',
  original_title: 'Spider-Man: No Way Home',
  serial: '0',
  year: '2021'
};

function maskUrl(u) {
  if (!u) return '';
  try {
    const p = new URL(u);
    const keep = p.searchParams.get('url');
    let inner = '';
    if (keep) {
      try {
        const k = new URL(keep);
        inner = ` inner=${k.hostname}${k.pathname.slice(0, 30)}`;
      } catch { /* ignore */ }
    }
    return `${p.hostname}${p.pathname}${inner}`;
  } catch {
    return String(u).slice(0, 80);
  }
}

async function probe(url, { headers = {}, timeout = 15000 } = {}) {
  try {
    const r = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
    const ct = String(r.headers.get('content-type') || '');
    const loc = r.status >= 300 && r.status < 400 ? String(r.headers.get('location') || '') : '';
    let body = '';
    if (r.status === 200 && !/video\/|octet|mpeg|mp4/.test(ct)) {
      body = (await r.text()).slice(0, 120);
    }
    return { status: r.status, ct: ct.split(';')[0], loc: maskUrl(loc), body: body.slice(0, 60) };
  } catch (e) {
    return { status: 'ERR', err: String(e.message).slice(0, 60) };
  }
}

function token() {
  try {
    const users = JSON.parse(readFileSync(config.usersFile, 'utf8'));
    const u = Array.isArray(users) ? (users.find((x) => x && x.active && x.token) || users[0]) : null;
    return u?.token || '';
  } catch { return ''; }
}

async function maniyaVideos() {
  console.log('\n================ MANIYA: /api/lampa/videos skaz-alloha ================');
  const t = token();
  const q = new URLSearchParams({ token: t, provider: 'skaz-alloha', ...SPIDER });
  const r = await fetch(`http://127.0.0.1:3000/api/lampa/videos?${q}`, { signal: AbortSignal.timeout(60000) });
  const json = await r.json();
  const items = Array.isArray(json.items) ? json.items : [];
  console.log('HTTP', r.status, 'items=', items.length, 'seasons=', (json.seasons || []).length, 'voices=', (json.voices || []).length);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const keys = it.quality && typeof it.quality === 'object' ? Object.keys(it.quality) : [];
    const pr = await probe(it.url);
    console.log(`[#${i}] ${String(it.title || '').slice(0, 34).padEnd(36)} voice="${it.voice_name}" method=${it.method}`);
    console.log(`      url=${maskUrl(it.url)}`);
    console.log(`      quality=[${keys.join(',')}] srt=${(it.subtitles || []).length} poster=${it.poster ? 'Y' : 'N'} hdrs=${it.headers ? Object.keys(it.headers).join(',') : '-'}`);
    console.log(`      probe(${it.url ? (new URL(it.url).searchParams.get('url') ? 'viaProxy' : 'direct') : '-'}) -> status=${pr.status} ct=${pr.ct} ${pr.loc ? 'loc->' + pr.loc : ''} ${pr.err ? 'err=' + pr.err : ''}`);
    if (pr.body) console.log(`      body=${JSON.stringify(pr.body)}`);
  }
  return items;
}

async function directSkaz() {
  console.log('\n================ SKAZ DIRECT: lite/alloha (like E-Online) ================');
  const q = new URLSearchParams({
    ...SPIDER,
    serial: '0',
    source: 'tmdb',
    account_email: config.skaz.accountEmail,
    uid: config.skaz.uid,
    orid: ''
  });
  delete q.delete;
  const url = `http://online3.skaz.tv/lite/alloha?${q}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const html = await r.text();
  console.log('HTTP', r.status, 'ct=', r.headers.get('content-type'), 'len=', html.length);
  // карточки
  const cards = [];
  const re = /data-json\s*=\s*(['"])([\s\S]*?)\1/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const c = JSON.parse(m[2]);
      if (c && typeof c === 'object') cards.push(c);
    } catch { /* skip */ }
  }
  console.log('cards=', cards.length);
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    console.log(`[#${i}] method=${c.method} title=${String(c._text || c.title || c.translate || '').slice(0, 34)} t=${c.t ?? '-'} s=${c.s ?? '-'} e=${c.e ?? '-'} maxq=${c.maxquality} vn=${c.voice_name}`);
    console.log(`      url=` + maskUrl(c.url || ''));
    if (c.stream) console.log(`      stream=` + maskUrl(c.stream));
    if (c.quality) console.log(`      quality=[${Object.keys(c.quality).join(',')}]`);
  }
  return { html, cards };
}

async function resolveFirstStream(cards) {
  console.log('\n================ RESOLVE: stream первой карточки (как resolveStream) ================');
  const c = cards.find((x) => x.method === 'call' && x.s == null && x.e == null && x.stream);
  if (!c) { console.log('no call-card without s/e'); return; }
  const stream = c.stream;
  console.log('stream=' + maskUrl(stream));
  const r = await fetch(stream, {
    headers: { Origin: config.skaz.origin, Referer: config.skaz.origin, 'User-Agent': 'Mozilla/5.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(25000)
  });
  const body = await r.text();
  const ct = String(r.headers.get('content-type') || '');
  console.log('HTTP', r.status, 'ct=', ct);
  console.log('URL(final)=' + maskUrl(r.url));
  if (body.startsWith('#EXTM3U')) {
    const lines = body.split(/\r?\n/);
    const variants = lines.filter((l) => l.startsWith('#EXT-X-STREAM-INF') || l.startsWith('#EXTINF'));
    console.log('m3u8 lines=', lines.length, 'variants/extinf=', variants.length);
    console.log(body.slice(0, 700));
  } else {
    console.log('body=', body.slice(0, 200));
  }
}

await maniyaVideos();
const { html, cards } = await directSkaz();
await resolveFirstStream(cards);
console.log('\nDONE');