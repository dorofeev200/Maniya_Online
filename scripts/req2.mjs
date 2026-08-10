// PROBE 2: JSON-режим /lite/alloha/video (как в Lampac: качество ← hlsSource.quality)
// + трассировка сегментов через прокси Maniya для «Человек-паук: Нет пути домой».
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
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
  try { const p = new URL(u); return `${p.hostname}${p.pathname}`; } catch { return String(u).slice(0, 80); }
}

async function getCards() {
  const q = new URLSearchParams({ ...SPIDER, serial: '0', source: 'tmdb', account_email: config.skaz.accountEmail, uid: config.skaz.uid, orid: '' });
  const r = await fetch(`http://online3.skaz.tv/lite/alloha?${q}`, { signal: AbortSignal.timeout(20000) });
  const html = await r.text();
  const cards = [];
  const re = /data-json\s*=\s*(['"])([\s\S]*?)\1/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { const c = JSON.parse(m[2]); if (c && typeof c === 'object' && (c.method === 'call' || c.method === 'play')) cards.push(c); } catch {}
  }
  return cards;
}

// Параметр из строки stream: t=/token_movie=
function param(url, key) {
  try { return new URL(url).searchParams.get(key); } catch { return null; }
}

async function main() {
  const cards = await getCards();
  const first = cards.find((c) => c.method === 'call' && c.s == null && c.e == null);
  console.log('cards=', cards.length, 'first translate=', first?._text?.slice(0, 30));

  // token_movie + t из stream-URL первой карточки
  const stream = first.stream;
  const tm = param(stream, 'token_movie');
  const t = param(stream, 't');
  console.log('token_movie=', (tm || '').slice(0, 8) + '…', 't=', t);

  // Построить тот же URL, но video (JSON) без play
  const video = new URL(stream);
  video.pathname = video.pathname.replace(/\.m3u8$/, '');
  video.searchParams.delete('play');
  console.log('\n=== JSON /lite/alloha/video (без play, как Lampac) ===');
  const r = await fetch(video.toString(), { headers: { Origin: config.skaz.origin }, signal: AbortSignal.timeout(25000) });
  const ct = String(r.headers.get('content-type') || '');
  const raw = await r.text();
  console.log('HTTP', r.status, 'ct=', ct);
  let json = null;
  try { json = JSON.parse(raw); } catch {}
  if (json) {
    // распечатать структуру верхнеуровневой
    console.log('keys=', Object.keys(json).join(','));
    if (json.streamquality) {
      console.log('streamquality=[', json.streamquality.map((s) => s?.quality || Object.keys(s)[0] || '?').join(', '), ']');
      const firstQ = json.streamquality && json.streamquality[0];
      console.log('first streamquality obj keys=', firstQ ? Object.keys(firstQ).join(',') : '-');
      console.log('first stq full=', JSON.stringify(firstQ)?.slice(0, 200));
    }
    if (json.method) console.log('method=', json.method);
    if (json.url) console.log('url=', maskUrl(String(json.url)));
    if (json.title) console.log('title=', String(json.title).slice(0, 40));
    if (json.subtitle) console.log('subtitles=', JSON.stringify(json.subtitle)?.slice(0, 300));
  } else {
    console.log('raw=', raw.slice(0, 400));
  }
}

await main();
console.log('\nDONE');