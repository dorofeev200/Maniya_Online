// Дебаг «золотых остатков» матрицы 09.08:
//  1) eonline-kodik: почему 2 link-карточки не дают play-items (трасса movieVideos);
//  2) eonline-veoveo: почему stream всё ещё 403 proxy_host (трасса редиректов сырого URL).
// Печатаются только hostname/card-метки — пути/токены НЕ выводятся.
// Запуск: cd /opt/maniya-online/server && NODE_ENV=production node ../scripts/e2e-debug.mjs kodik|veoveo
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = (await import(path.join(here, '..', 'server', 'src', 'config.js'))).config;
const { EoClient } = await import(path.join(here, '..', 'server', 'src', 'providers', 'eonline', 'EoClient.js'));
const { EoNormalizer } = await import(path.join(here, '..', 'server', 'src', 'providers', 'eonline', 'EoNormalizer.js'));

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

function client(slug) {
  return new EoClient({ balancer: slug, hosts: config.eonline.hosts, skazHosts: config.eonline.skazHosts, accountEmail, uid, origin });
}

const MOVIE = { id: '284647', imdb_id: 'tt0816692', kinopoisk_id: '437410', title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0' };

/** Трасса редиректов сырого URL (только hostname каждого шага). */
async function traceHosts(url, max = 6) {
  const steps = [];
  let current = String(url || '');
  for (let i = 0; i < max; i++) {
    let parsed;
    try { parsed = new URL(current); } catch { return steps.concat([current.slice(0, 40) + ' (bad)']); }
    steps.push(`${parsed.protocol}//${parsed.host}`);
    try {
      const r = await fetch(current, { redirect: 'manual', headers: { Origin: origin, 'User-Agent': 'Mozilla/5.0', accept: '*/*' }, signal: AbortSignal.timeout(15000) });
      const location = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && location) {
        current = new URL(location, parsed).toString();
        continue;
      }
      steps.push(`  final: HTTP${r.status} ct=${String(r.headers.get('content-type') || '').split(';')[0]}`);
      return steps;
    } catch (error) {
      steps.push('  ERR ' + String(error.message || error).slice(0, 25));
      return steps;
    }
  }
  steps.push('  loop');
  return steps;
}

function dumpCards(cards, limit = 8) {
  for (const card of (cards || []).slice(0, limit)) {
    const keys = Object.keys(card || {}).sort();
    const url = String(card.url || card.href || '');
    let host = '';
    try { host = new URL(url).host; } catch { host = url.slice(0, 36); }
    const label = String(card.title || card.translate || card._text || card.voice_translate || '').slice(0, 22);
    console.log(`  m=${String(card.method).padEnd(6)} sim=${Boolean(card.similar)} y=${String(card.year ?? '').padEnd(4)} ${label.padEnd(24)} host=${host} keys=${keys.slice(0, 10).join(',')}`);
  }
}

async function mainKodik() {
  console.log('== KODIK lite: карточки и шаги movieVideos ==');
  const c = client('kodik');
  const params = {
    id: MOVIE.id, imdb_id: MOVIE.imdb_id, kinopoisk_id: MOVIE.kinopoisk_id,
    title: MOVIE.title, original_title: MOVIE.original_title, serial: '0', year: MOVIE.year, source: 'tmdb'
  };
  const html = await c.getLite(params);
  if (!html) { console.log('  нет HTML от getLite'); return; }
  const cards = new EoNormalizer().cards(html);
  console.log('cards: ' + cards.length);
  dumpCards(cards);
  // шаг follow-карточки (movieHref) — кандидаты
  const follows = cards.filter((card) => card.method === 'link' || !card.method);
  console.log(`link/без-method кандидатов на follow: ${follows.length}`);
}

async function mainVeoveo() {
  console.log('== VEOVEO: первый item + трасса сырого URL ==');
  const q = new URLSearchParams({ token, provider: 'eonline-veoveo', ...MOVIE });
  const r = await fetch(`${base}/api/lampa/videos?${q}`, { signal: AbortSignal.timeout(30000) }).catch(() => null);
  if (!r) { console.log('  ERR fetch videos'); return; }
  const json = await r.json().catch(() => ({}));
  const items = Array.isArray(json.items) ? json.items : [];
  console.log(`  items=${items.length}`);
  const first = items[0];
  if (!first || !first.url) { console.log('  нет первого item'); return; }
  let target = '';
  try { target = new URL(first.url).searchParams.get('url') || ''; } catch { target = first.url; }
  console.log(`  method=${first.method} title=${(first.title || '').slice(0, 20)}`);
  console.log(`  target host=${(() => { try { return new URL(target).host; } catch { return '(bad)'; } })()}`);
  const chain = await traceHosts(target);
  for (const step of chain) console.log('  · ' + step);
}

const which = String(process.argv[2] || 'kodik').toLowerCase();
if (which === 'veoveo') await mainVeoveo();
else await mainKodik();