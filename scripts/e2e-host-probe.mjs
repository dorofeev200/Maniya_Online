// Зонд: какие CDN-хосты стоят в прокси-URL у «сломанных» E-Online источников.
// Печатаются ТОЛЬКО hostname целевого URL (без путей/токенов/секретов).
// Запуск на VPS: cd /opt/maniya-online/server && NODE_ENV=production node ../scripts/e2e-host-probe.mjs
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
if (!token) { console.log('нет токена'); process.exit(1); }

const MOVIES = [
  { id: '284647', imdb_id: 'tt0816692', kinopoisk_id: '437410', title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0' },
  { id: '329', imdb_id: 'tt0133093', kinopoisk_id: '301', title: 'Матрица', original_title: 'The Matrix', year: '1999', serial: '0' }
];
const TARGETS = ['skaz-kinopub', 'skaz-veoveo', 'skaz-solntse'];

function hostOfProxy(proxyUrl) {
  try {
    const u = new URL(proxyUrl);
    const target = u.searchParams.get('url');
    if (!target) return '(no-url)';
    const t = new URL(target);
    return t.protocol + '//' + t.host;
  } catch { return '(bad)'; }
}

for (const prov of TARGETS) {
  for (const movie of MOVIES) {
    const q = new URLSearchParams({ token, provider: prov, ...movie });
    const r = await fetch(`${base}/api/lampa/videos?${q}`, { signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (!r) { console.log(`${prov} ${movie.title} ERR fetch`); continue; }
    const json = await r.json().catch(() => ({}));
    const items = Array.isArray(json.items) ? json.items : [];
    const hosts = [...new Set(items.map((i) => hostOfProxy(i.url)).filter(Boolean))];
    const t0 = items[0] ? String(items[0].title || '').slice(0, 14) : '';
    console.log(`${prov} ${movie.title.padEnd(10)} items=${String(items.length).padEnd(2)} t0=${t0} hosts=[${hosts.join(', ')}]`);
  }
}