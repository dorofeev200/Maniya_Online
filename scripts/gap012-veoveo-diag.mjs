#!/usr/bin/env node
// GAP-012 — диагностика redirect-цепочки veoveo (READ-ONLY).
// Для тайтла: /videos skaz-veoveo → первый play item → декод прокси-URL →
// целевой URL → ручное следование редиректам (redirect:manual), печать каждого
// hop'а: status + location. Цель — увидеть ТЕКУЩИЙ CDN-хост после api.rstprgapipt.com.
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:3100';
const KEY = process.argv[3] || 'odyssey';

const TOKEN = (() => {
  try {
    const users = JSON.parse(readFileSync('/tmp/maniya-shadow/data/users.json', 'utf8'));
    const arr = Array.isArray(users) ? users : [users];
    return (arr.find((u) => u.token) || arr[0])?.token || '';
  } catch { return ''; }
})();

const TITLES = {
  odyssey: { id: '1368337', kp: '6385370', imdb: 'tt33764258', title: 'Одиссея', year: 2026, serial: 0 },
  forrest: { id: '14', kp: '448', imdb: 'tt0109830', title: 'Форрест Гамп', year: 1994, serial: 0 },
  last_house: { id: '1284041', kp: '', imdb: 'tt32268156', title: 'Последний дом', year: 2026, serial: 0 }
};

async function api(base, path, params) {
  params.token = TOKEN;
  const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  const res = await fetch(`${base}${path}?${qs}`, { headers: { accept: 'application/json' } });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, body };
}

async function traceRedirects(url, hops = 0, seen = new Set()) {
  if (hops > 6 || seen.has(url)) return [];
  seen.add(url);
  let res;
  try {
    res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
  } catch (e) {
    return [{ url, err: String((e && e.message) || e) }];
  }
  const location = res.headers.get('location');
  const row = { hop: hops, status: res.status, url: url.slice(0, 140), ct: res.headers.get('content-type') || '', location: location ? location.slice(0, 140) : '' };
  if (location && res.status >= 300 && res.status < 400) {
    const next = new URL(location, url).toString();
    return [row, ...(await traceRedirects(next, hops + 1, seen))];
  }
  return [row];
}

async function main() {
  const t = TITLES[KEY];
  if (!t) { console.error(`unknown: ${KEY}`); process.exit(2); }
  const q = { id: String(t.id), title: t.title, original_title: t.original_title, year: String(t.year), original_language: 'en', source: 'tmdb', serial: String(t.serial) };
  if (t.imdb) q.imdb_id = t.imdb;
  if (t.kp) q.kinopoisk_id = String(t.kp);

  const videos = await api(BASE, '/api/lampa/videos', { ...q, provider: 'skaz-veoveo' });
  console.log(`videos status=${videos.status} items=${Array.isArray(videos.body?.items) ? videos.body.items.length : 0}`);
  const items = Array.isArray(videos.body?.items) ? videos.body.items : [];
  const play = items.find((i) => i.method === 'play');
  if (!play) { console.error('NO play item'); process.exit(0); }
  console.log('item:', JSON.stringify({ method: play.method, title: play.title, episode: play.episode, url: String(play.url).slice(0, 160) }));

  const proxy = new URL(play.url);
  const target = proxy.searchParams.get('url') || '';
  console.log('decoded target:', target.slice(0, 180));
  console.log('--- redirect chain ---');
  const chain = await traceRedirects(target);
  for (const row of chain) console.log(JSON.stringify(row));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
