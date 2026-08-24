// COLLAPS-EGRESS-001: прямое сравнение upstream vs текущий CollapsClient.
// Один URL embed — три запроса: (A) голый fetch, (B) полный браузерный набор,
// (C) ровно то, что шлёт текущий CollapsClient.embed(). Плюс контрольные точки
// embed `/` и apihost `/list` (без токена — только статус/классификация).
import { pathToFileURL } from 'node:url';

const SRC = 'C:/Users/Admin/Maniya_Online/server/src';
const { CollapsClient } = await import(pathToFileURL(`${SRC}/providers/collaps/CollapsClient.js`));

const EMBED = 'https://api.luxembd.ws';
const APIHOST = 'https://api.bhcesh.me';

const BROWSER = {
  origin: 'https://kinokrad.my',
  referer: 'https://kinokrad.my/',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site',
  accept: '*/*',
  'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

function classify(status, client) {
  try { client.httpError(status); return '(ok)'; }
  catch (e) { return e?.info?.kind || e?.message || '?'; }
}

async function grab(url, headers) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(url, { redirect: 'manual', headers, signal: c.signal });
    const buf = Buffer.from(await r.arrayBuffer());
    const loc = r.headers.get('location');
    const out = {
      status: r.status,
      ct: (r.headers.get('content-type') || '').split(';')[0],
      len: r.headers.get('content-length') || buf.length,
      server: r.headers.get('server') || '',
      vary: r.headers.get('vary') || '',
      bytes: buf.length,
      head: JSON.stringify(buf.slice(0, 48).toString('utf8')),
      loc: loc ? loc.slice(0, 80) : ''
    };
    return out;
  } catch (e) { return { status: 'ERR', bytes: 0, head: String(e.message || e).slice(0, 60) }; }
  finally { clearTimeout(t); }
}

const client = new CollapsClient({ apihost: APIHOST, embedHost: EMBED });

const cases = [
  ['kp/301 (Матрица)', `${EMBED}/embed/kp/301`],
  ['kp/258687 (Интерстеллар)', `${EMBED}/embed/kp/258687`],
  ['imdb/tt0133093 (Матрица)', `${EMBED}/embed/imdb/tt0133093`],
  [`movie/87624 (Одиссея orid)`, `${EMBED}/embed/movie/87624`],
];

for (const [label, url] of cases) {
  console.log(`===== ${label}`);
  // A. голый fetch (node default headers)
  const a = await grab(url, undefined);
  console.log(` A bare            → ${a.status} ${a.ct} bytes=${a.bytes} vary=${a.vary} ${a.head.slice(0, 40)}`);
  // B. полный браузерный набор
  const b = await grab(url, BROWSER);
  console.log(` B browser-full    → ${b.status} ${b.ct} bytes=${b.bytes} vary=${b.vary} ${b.head.slice(0, 40)}`);
  // C. ровно current CollapsClient.embed()
  const c = new AbortController(); const ct = setTimeout(() => c.abort(), 20000);
  try {
    const path = url.slice(EMBED.length);
    const p = /\/embed\/kp\/(\d+)|\/embed\/imdb\/([^/]+)|\/embed\/movie\/(\d+)/.exec(path);
    const opt = p[1] ? { kinopoiskId: p[1] } : p[2] ? { imdbId: p[2] } : { orid: p[3] };
    const { text } = await client.embed({ ...opt, embedHost: EMBED, fetchImpl: (u, h) => fetch(u, { ...h, signal: c.signal }) });
    console.log(` C client.embed    → 200 bytes=${text.length} head=${JSON.stringify(text.slice(0, 48))}`);
  } catch (e) {
    console.log(` C client.embed    → ERR classified=${classify(e.status || e, client)} ${String(e.message || e).slice(0, 70)}`);
  } finally { clearTimeout(ct); }
}

// Контроль инфраструктуры: корень embed-хоста и apihost /list.
console.log('===== infra');
const root = await grab(`${EMBED}/`, BROWSER);
console.log(` embed root /      → ${root.status} ${root.ct} bytes=${root.bytes} server=${root.server} ${root.head.slice(0, 40)}`);
const list = await grab(`${APIHOST}/list?token=test`, BROWSER);
console.log(` apihost /list     → ${list.status} ${list.ct} bytes=${list.bytes} ${list.head.slice(0, 60)}`);
console.log('DONE');