// COLLAPS-EGRESS-001: playable-доказательство 200-пути (локальный egress).
// master.m3u8 → variant → сегмент TS (206 = играбельно через стандартный клиент).
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

const master = await fetch_(movie.url, { Range: 'bytes=0-1023' });
console.log(`master: ${master.status} ${master.ct} ${master.buf.length}B`);
const vuri = firstUri(master.buf.toString('utf8'));
console.log(`variant uri: ${String(vuri).slice(0, 90)}`);
if (!vuri) { console.log('no variant (single rendition?)'); process.exit(0); }
const vurl = new URL(vuri, movie.url).toString();
const v = await fetch_(vurl);
console.log(`variant: ${v.status} ${v.ct} ${v.buf.length}B`);
const segUri = firstUri(v.buf.toString('utf8'));
console.log(`seg uri: ${String(segUri).slice(0, 90)}`);
if (segUri) {
  const surl = new URL(segUri, vurl).toString();
  const s = await fetch_(surl, { Range: 'bytes=0-2047' });
  console.log(`segment: ${s.status} ${s.ct} ${s.buf.length}B sig=${s.buf.slice(0, 16).toString('latin1').replace(/[^\x20-\x7e]/g, '.')}`);
}
console.log('DONE');