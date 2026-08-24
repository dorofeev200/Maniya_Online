// COLLAPS-EGRESS-001: добиваем сегмент — варианты headers/Range для seg.
import { pathToFileURL } from 'node:url';
const SRC = 'C:/Users/Admin/Maniya_Online/server/src';
const { CollapsClient } = await import(pathToFileURL(`${SRC}/providers/collaps/CollapsClient.js`));
const { CollapsNormalizer } = await import(pathToFileURL(`${SRC}/providers/collaps/CollapsNormalizer.js`));

const client = new CollapsClient({ embedHost: 'https://api.luxembd.ws' });
const norm = new CollapsNormalizer();
const { text } = await client.embed({ kinopoiskId: 301 });
const movie = norm.parseEmbed(text, { title: 'Матрица', year: 0 }).movie;

function firstUri(m3u8) {
  for (const raw of String(m3u8 || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    return line;
  }
  return '';
}
async function fetch_(url, headers = {}) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(url, { headers, signal: c.signal, redirect: 'follow' });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ct: (r.headers.get('content-type') || '').split(';')[0], buf };
  } catch (e) { return { status: 'ERR', ct: '', buf: Buffer.from(String(e.message || e).slice(0, 60)) }; }
  finally { clearTimeout(t); }
}

const vurl = new URL(firstUri((await fetch_(movie.url)).buf.toString('utf8')), movie.url).toString();
const v = await fetch_(vurl);
const segBase = vurl.split('?')[0];
const segUri = firstUri(v.buf.toString('utf8'));
const segAbs = new URL(segUri, segBase).toString(); // без query от variant, но с query segUri
console.log(`vurl: ${vurl.slice(0, 110)}`);
console.log(`segAbs: ${segAbs.slice(0, 130)}\n`);

const tries = [
  ['no headers', {}],
  ['Range', { Range: 'bytes=0-2047' }],
  ['Origin kinokrad', { origin: 'https://kinokrad.my', referer: 'https://kinokrad.my/' }],
  ['Range+Origin', { Range: 'bytes=0-2047', origin: 'https://kinokrad.my', referer: 'https://kinokrad.my/' }],
];
for (const [name, h] of tries) {
  const s = await fetch_(segAbs, h);
  console.log(`${name}: ${s.status} ${s.ct} ${s.buf.length}B sig=${s.buf.slice(0, 16).toString('latin1').replace(/[^\x20-\x7e]/g, '.')}`);
}
console.log('DONE');