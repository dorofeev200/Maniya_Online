// filmix: полный URL → Range-запрос → магистраль через наш прокси.
import { readFile } from 'node:fs/promises';
const users = JSON.parse(await readFile('/opt/maniya-online/server/data/users.json', 'utf8'));
const TOKEN = (users[1] || users[0]).token;

const q = new URLSearchParams({
  token: TOKEN, provider: 'filmix', source: 'tmdb',
  title: 'Дэдпул и Росомаха', original_title: 'Deadpool & Wolverine',
  year: '2024', serial: '0', id: '533535', imdb_id: 'tt6263850'
});
const j = await (await fetch(`http://127.0.0.1:3210/api/lampa/videos?${q}`, { signal: AbortSignal.timeout(20000) })).json();
const items = j.items || [];
console.log(`items=${items.length} pe=${j.provider_error?.code || '-'}`);
const it = items[0];
console.log('title:', it?.title || it?.voice_name);
const target = decodeURIComponent(new URL(it.url).searchParams.get('url'));
console.log('target:', target.slice(0, 120));

// (1) Range напрямую
const t0 = Date.now();
try {
  const r = await fetch(target, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Range': 'bytes=0-1023', referer: 'https://filmix.tv/', origin: 'https://filmix.tv', accept: '*/*' },
    signal: AbortSignal.timeout(20000)
  });
  const b = Buffer.from(await r.arrayBuffer());
  console.log(`(1) direct Range: ${r.status} ct=${r.headers.get('content-type')} len=${b.byteLength} in ${Date.now() - t0}ms sig=${JSON.stringify(b.slice(0, 16).toString('latin1'))}`);
} catch (e) { console.log(`(1) direct Range ERR in ${Date.now() - t0}ms: ${String(e).slice(0, 60)}`); }

// (2) Range через наш прокси (как реальный клиент)
const t1 = Date.now();
try {
  const proxyUrl = `http://127.0.0.1:3210/api/lampa/proxy?url=${encodeURIComponent(target)}&token=${TOKEN}`;
  const r = await fetch(proxyUrl, { headers: { 'Range': 'bytes=0-1023' }, signal: AbortSignal.timeout(20000) });
  const b = Buffer.from(await r.arrayBuffer());
  console.log(`(2) proxy Range: ${r.status} ct=${r.headers.get('content-type')} len=${b.byteLength} in ${Date.now() - t1}ms sig=${JSON.stringify(b.slice(0, 16).toString('latin1'))}`);
} catch (e) { console.log(`(2) proxy Range ERR in ${Date.now() - t1}ms: ${String(e).slice(0, 60)}`); }

console.log('FILMIX-RANGE DONE');