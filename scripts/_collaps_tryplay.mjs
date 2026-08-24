// COLLAPS-EGRESS-001: pollный Maniya-путь к playable: embed → parseEmbed → URL.
// Если URL извлечён — Range-пробa первого сегмента (206 = играбельно).
import { pathToFileURL } from 'node:url';
const SRC = 'C:/Users/Admin/Maniya_Online/server/src';
const { CollapsClient } = await import(pathToFileURL(`${SRC}/providers/collaps/CollapsClient.js`));
const { CollapsNormalizer } = await import(pathToFileURL(`${SRC}/providers/collaps/CollapsNormalizer.js`));

const EMBED = 'https://api.luxembd.ws';
const client = new CollapsClient({ embedHost: EMBED });
const norm = new CollapsNormalizer();

async function rangeProbe(url) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-1023' }, signal: c.signal, redirect: 'follow' });
    const buf = Buffer.from(await r.arrayBuffer());
    return `${r.status} ${(r.headers.get('content-type') || '').split(';')[0]} ${buf.length}B ${buf.slice(0, 16).toString('latin1').replace(/[^\x20-\x7e]/g, '.')}`;
  } catch (e) { return `ERR ${String(e.message || e).slice(0, 50)}`; }
  finally { clearTimeout(t); }
}

const cases = [
  ['Матрица kp/301', { kinopoiskId: 301 }, 'Матрица'],
  ['Интерстеллар kp/258687', { kinopoiskId: 258687 }, 'Интерстеллар'],
  ['Одиссея orid/87624', { orid: 87624 }, 'Одиссея'],
  ['Матрица imdb/tt0133093', { imdbId: 'tt0133093' }, 'Матрица'],
];

for (const [label, opt, title] of cases) {
  try {
    const { text, embedHost } = await client.embed(opt);
    const parsed = norm.parseEmbed(text, { title, year: 0 });
    const movie = parsed.movie;
    console.log(`===== ${label}  isSerial=${parsed.isSerial} seasons=${parsed.seasons?.length}`);
    if (movie?.url) {
      console.log(`  play-url: ${movie.url.slice(0, 140)}`);
      console.log(`  voicename: ${movie.voicename}  audio=${JSON.stringify(movie.audioNames).slice(0, 80)}`);
      console.log(`  range: ${await rangeProbe(movie.url)}`);
    } else {
      const src = norm.sourceBlock(text);
      console.log(`  NO play-url. sourceBlock=${src ? src.length + 'B' : 'null'}`);
      const idx = text.indexOf('source:');
      console.log(`  контекст: ${JSON.stringify(text.slice(idx, idx + 300)).slice(0, 300)}`);
    }
  } catch (e) {
    console.log(`===== ${label}\n  ERR ${e.status || e?.info?.kind || ''} ${String(e.message || e).slice(0, 90)}`);
  }
}
console.log('DONE');