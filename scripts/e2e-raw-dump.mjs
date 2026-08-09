// Дамп СЫРЫХ card-карточек lite/<slug> (filmix/alloha для Интерстеллар) —
// что именно парсит браузерный плагин E-Online. Секреты маскируются.
// Запуск: cd /opt/maniya-online/server && NODE_ENV=production node ../scripts/e2e-raw-dump.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = (await import(path.join(here, '..', 'server', 'src', 'config.js'))).config;
const { EoClient } = await import(path.join(here, '..', 'server', 'src', 'providers', 'eonline', 'EoClient.js'));

const accountEmail = config.eonline.accountEmail;
const uid = config.eonline.uid;
const origin = config.eonline.origin;

function client(slug) {
  return new EoClient({ balancer: slug, hosts: config.eonline.hosts, skazHosts: config.eonline.skazHosts, accountEmail, uid, origin });
}

const P = { id: '284647', imdb_id: 'tt0816692', kinopoisk_id: '437410', title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0' };

const SENSITIVE_KEYS = /token|uid|email|secret|key|hash/i;

/** Маскирование URL: чувствительные query-параметры → имя=*. */
function maskUrl(value) {
  if (typeof value !== 'string') return value;
  try {
    const u = new URL(value);
    for (const key of [...u.searchParams.keys()]) {
      if (SENSITIVE_KEYS.test(key) && !['play', 'rjson'].includes(key)) {
        u.searchParams.set(key, '*');
      }
    }
    return u.toString().length > 160 ? u.protocol + '//' + u.host + '/…?' + u.searchParams.toString().slice(0, 80) : u.toString();
  } catch {
    const s = String(value);
    return s.length > 90 ? s.slice(0, 90) + '…' : s;
  }
}

function maskValue(key, value) {
  if (typeof value === 'string' && SENSITIVE_KEYS.test(key)) return `*${value.length}chars`;
  return value;
}

function maskEntry(key, value) {
  if (typeof value === 'string') {
    if (/(url|href|src|stream|link)/i.test(key)) return maskUrl(value);
    return maskValue(key, value);
  }
  if (Array.isArray(value)) return value.map((x) => (x && typeof x === 'object' ? maskRec(x) : x));
  if (value && typeof value === 'object') return maskRec(value);
  return value;
}

function maskRec(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = maskEntry(k, v);
  return out;
}

async function dump(slug, label) {
  const P2 = { ...P, source: 'tmdb' };
  const html = await client(slug).getLite(P2);
  if (!html) { console.log(`== ${label}: НЕТ HTML ==`); return; }
  const re = /data-json\s*=\s*(['"])([\s\S]*?)\1/g;
  const matchCount = (html.match(/data-json\s*=/g) || []).length;
  console.log(`== ${label}: data-json в HTML: ${matchCount} ==`);
  let m; let i = 0;
  while ((m = re.exec(html)) && i < 8) {
    let raw = m[2];
    try { raw = JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&')); } catch { /* строка */ }
    console.log(`\n--- ${label} карточка #${i + 1} ---`);
    if (typeof raw === 'string') { console.log(maskUrl(raw)); i++; continue; }
    console.log(JSON.stringify(maskRec(raw), null, 1));
    i++;
  }
}

await dump('filmix', 'FILMIX');
await dump('alloha', 'ALLOHA');