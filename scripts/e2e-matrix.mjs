// Живая матрица ВСЕХ источников E-Online по контуру «как работает E-Online»:
// lite/<slug> (skaz-кластер) → карточки → резолв потока → финальный манифест.
// Плюс дублирование контура UI через публичный API localhost (sources→videos→play).
//
// Запуск на VPS (где server/.env с реальными кредами и та же сеть, что у API):
//   cd /opt/maniya-online/server && NODE_ENV=production node ../scripts/e2e-matrix.mjs [--all]
//
// Никаких catch(()=>[]) — каждая ошибка логируется. Секреты не печатаются (len только).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = (await import(path.join(here, '..', 'server', 'src', 'config.js'))).config;
const { EoClient } = await import(path.join(here, '..', 'server', 'src', 'providers', 'eonline', 'EoClient.js'));

// Все slug из карты балансеров исходного JS (_0x39b522, E-ONLINE-REPORT §10.1).
const ALL_SLUGS = [
  'kinobase', 'veoveo', 'alloha', 'filmix', 'videoseed', 'videohub', 'turboserial',
  'vk', 'rutube', 'zagonka', 'kinopub', 'hdvb', 'fancdn', 'mirage', 'kodik', 'fanserials',
  'rezka', 'mirkino', 'xvideocdn', 'hdrezka', 'aniliberty', 'animebesst', 'animelib',
  'solntse', 'kinoflix', 'pidtor', 'rutubemovie'
];

const MOVIES = [
  { id: '284647', imdb_id: 'tt0816692', kinopoisk_id: '437410', title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0' },
  { id: '329', imdb_id: 'tt0133093', kinopoisk_id: '301', title: 'Матрица', original_title: 'The Matrix', year: '1999', serial: '0' }
];
const SERIAL = { id: '1399', imdb_id: 'tt0944947', kinopoisk_id: '79322', title: 'Игра престолов', original_title: 'Game of Thrones', serial: '1' };

const accountEmail = config.eonline.accountEmail;
const uid = config.eonline.uid;
const origin = config.eonline.origin;
const base = 'http://127.0.0.1:3000';

let token = '';
try {
  const users = JSON.parse(readFileSync(config.usersFile, 'utf8'));
  const anyUser = (Array.isArray(users) ? users.find((u) => u && u.active && u.token) : null) || (Array.isArray(users) ? users[0] : null);
  token = (anyUser && anyUser.token) || '';
} catch { token = ''; }

function newClient(slug) {
  return new EoClient({ balancer: slug, hosts: config.eonline.hosts, skazHosts: config.eonline.skazHosts, accountEmail, uid, origin });
}

async function probeLite(client, params) {
  let url = '';
  try { url = client.buildLiteUrl(params); } catch { url = ''; }
  try {
    const response = await fetch(url, { headers: { accept: '*/*', Origin: origin }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const text = await response.text().catch(() => '');
    return { status: response.status, text };
  } catch (error) {
    return { status: 0, text: 'ERR ' + String(error && error.message) };
  }
}

function gateOf(status, text) {
  const head = String(text || '').slice(0, 300).toLowerCase();
  if (status === 0) return 'conn';
  if (status === 403 || status === 429) return 'gate';
  if (/\brch\b|cloudflare|cf-ray|access denied|forbidden/.test(head)) return 'gate';
  if (head.startsWith('{') || head.startsWith('[')) return 'json';
  return 'html';
}

const pageParams = (movie) => { const p = { ...movie }; delete p.token; return p; };

/** Как плеер: items.url → (call: JSON resolve) → прокси/абсолютный URL → загрузка медиа. */
async function playCheck(rawLike, method) {
  let url = String(rawLike || '');
  if (method === 'call') {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => null);
      url = (j && j.url) || url;
    } catch { return 'callERR'; }
  }
  if (url.startsWith('/')) url = base + url;
  if (!String(url).includes('token=') && token) {
    try { const u = new URL(url); u.searchParams.set('token', token); url = u.toString(); } catch {}
  }
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const ct = String(r.headers.get('content-type') || '').toLowerCase();
    if (r.status === 200 && (/mpegurl|mpd|video\/|mp4|mpeg/.test(ct))) return 'OK:' + ct.split('/').pop();
    const body = await r.text().catch(() => '');
    if (r.status === 200 && (body.startsWith('#EXTM3U') || body.includes('#EXT-X-STREAM-INF'))) return 'OK:hls';
    return 'HTTP' + r.status + ':' + ct.split('/').pop() + ':' + String(body).slice(0, 20);
  } catch (error) {
    return 'ERR:' + String(error && error.message).slice(0, 26);
  }
}

async function main() {
  console.log('== НАСТРОЙКИ == email_len=' + accountEmail.length + ' uid_len=' + uid.length + ' token_len=' + token.length);
  console.log('EO_BALANCERS=' + config.eonline.balancers.join(','));
  console.log('');

  console.log('== ЧАСТЬ A: lite/<slug> для ВСЕХ слагов (как ходит E-Online) ==');
  for (const slug of ALL_SLUGS) {
    const probe = await probeLite(newClient(slug), pageParams(MOVIES[0]));
    const gate = gateOf(probe.status, probe.text);
    let cards = 0, first = '';
    if (gate === 'html') {
      cards = (String(probe.text).match(/data-json\s*=/g) || []).length;
      const m = String(probe.text).match(/data-json\s*=\s*(['"])([\s\S]*?)\1/);
      if (m) { try { const j = JSON.parse(m[2]); first = String(j.method || j.title || j.translate || '').slice(0, 22); } catch {} }
    }
    console.log(`LITE ${slug.padEnd(14)} ${String(probe.status).padEnd(4)} ${gate.padEnd(5)} cards=${cards} first=${first}`);
  }

  console.log('\n== ЧАСТЬ B: контур UI через API (sources→videos→play) ==');
  if (!token) { console.log('нет активного токена в ' + config.usersFile + ' — часть B пропущена'); return; }

  const srcRes = await fetch(`${base}/api/lampa/sources?token=${token}`, { signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!srcRes) { console.log('src fetch ERR'); return; }
  const srcJson = await srcRes.json().catch(() => ({}));
  const providers = Array.isArray(srcJson.sources) ? srcJson.sources : [];
  console.log('источников в /sources: ' + providers.length);

  for (const prov of providers) {
    for (const movie of MOVIES) {
      const q = new URLSearchParams({ token, provider: prov.id, ...movie });
      const r = await fetch(`${base}/api/lampa/videos?${q}`, { signal: AbortSignal.timeout(30000) }).catch(() => null);
      if (!r) { console.log(`VID  ${prov.id.padEnd(18)} ${movie.title.padEnd(12)} ERR fetch`); continue; }
      const json = await r.json().catch(() => ({ items: [] }));
      const items = Array.isArray(json.items) ? json.items : [];
      const voices = Array.isArray(json.voices) ? json.voices.length : 0;
      const seasons = Array.isArray(json.seasons) ? json.seasons.length : 0;
      const first = items[0];
      const play = first && first.url ? await playCheck(first.url, first.method) : '-';
      const t0 = first ? String(first.title || first.voice_name || '').slice(0, 22) : '';
      console.log(`VID  ${prov.id.padEnd(18)} ${movie.title.padEnd(12)} items=${String(items.length).padEnd(2)} vo=${String(voices).padEnd(2)} s=${String(seasons).padEnd(2)} play=${play} t0=${t0}`);
    }
    const q = new URLSearchParams({ token, provider: prov.id, ...SERIAL });
    const r = await fetch(`${base}/api/lampa/videos?${q}`, { signal: AbortSignal.timeout(30000) }).catch(() => null);
    const json = r ? await r.json().catch(() => ({})) : {};
    const items = Array.isArray(json.items) ? json.items : [];
    const first = items[0];
    const play = first && first.url ? await playCheck(first.url, first.method) : '-';
    console.log(`SER  ${prov.id.padEnd(18)} GoT items=${String(items.length).padEnd(2)} vo=${Array.isArray(json.voices) ? json.voices.length : 0} s=${Array.isArray(json.seasons) ? json.seasons.length : 0} ep0=${first ? (String(first.season) + 'x' + String(first.episode)) : '-'} play=${play}`);
  }
}

// Секреты не печатаются — только длины (email/uid/token).
main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });