// Точечный прогон «золотых жалоб» 09.08 после конфиг-фикса:
//  1) каждый item eonline-alloha (все 8 переводов) — свой play-check;
//  2) item.quality для провайдера filmix (native и eonline) — какие ключи.
// Только hostname/ключи/статусы. Запуск на VPS.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = (await import(path.join(here, '..', 'server', 'src', 'config.js'))).config;
const base = 'http://127.0.0.1:3000';

let token = '';
try {
  const users = JSON.parse(readFileSync(config.usersFile, 'utf8'));
  const anyUser = (Array.isArray(users) ? users.find((u) => u && u.active && u.token) : null) || (Array.isArray(users) ? users[0] : null);
  token = (anyUser && anyUser.token) || '';
} catch { token = ''; }

const MOVIE = { id: '284647', imdb_id: 'tt0816692', kinopoisk_id: '437410', title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0' };

function playCheck(raw) {
  return (async () => {
    const url = String(raw || '');
    if (!url) return '-';
    try {
      const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
      const ct = String(r.headers.get('content-type') || '').toLowerCase();
      const body = await r.text().catch(() => '');
      if (r.status === 200 && (/mpegurl|mpd|video\/|mp4|mpeg/.test(ct))) return 'OK:' + ct.split(';')[0].split('/').pop();
      if (r.status === 200 && body.startsWith('#EXTM3U')) return 'OK:hls';
      return 'HTTP' + r.status + ':' + ct.split('/').pop() + ':' + body.slice(0, 16);
    } catch (e) { return 'ERR:' + String(e.message).slice(0, 20); }
  })();
}

async function eachAllohaItem() {
  console.log('== ALLOHA: все items eonline-alloha ==');
  const q = new URLSearchParams({ token, provider: 'eonline-alloha', ...MOVIE });
  const r = await fetch(`${base}/api/lampa/videos?${q}`, { signal: AbortSignal.timeout(30000) }).catch(() => null);
  const json = r ? await r.json().catch(() => ({})) : {};
  const items = Array.isArray(json.items) ? json.items : [];
  console.log('items=' + items.length);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const t = (it.title || it.voice_name || '').slice(0, 30);
    console.log(`  #${i} ${t.padEnd(32)} play=${await playCheck(it.url)}`);
  }
}

async function qualityMap() {
  console.log('== QUALITY для filmix (и eonline-filmix) ==');
  for (const provider of ['filmix', 'eonline-filmix']) {
    const q = new URLSearchParams({ token, provider, ...MOVIE });
    const r = await fetch(`${base}/api/lampa/videos?${q}`, { signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (!r) { console.log(`${provider}: ERR`); continue; }
    const json = await r.json().catch(() => ({}));
    const items = Array.isArray(json.items) ? json.items : [];
    console.log(`${provider}: items=${items.length}`);
    items.slice(0, 6).forEach((it, i) => {
      const keys = it.quality && typeof it.quality === 'object' ? Object.keys(it.quality) : [];
      const t = (it.title || it.voice_name || '').slice(0, 24);
      console.log(`  #${i}] ${t.padEnd(26)} quality=${keys.join(',') || '(none)'} method=${it.method}`);
    });
  }
}

await eachAllohaItem();
await qualityMap();