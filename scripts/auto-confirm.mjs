// АВТОМАТИЧЕСКОЕ ПОДТВЕРЖДЕНИЕ источников Maniya (live-проверка, без браузера).
//   для каждого источника × фильма/сериала:
//     1) /api/lampa/videos?provider=<id>  →  играбельные items;
//     2) берём первый item и запрашиваем его URL (уже проксированный, token вшит);
//     3) PASS = HTTP 200 + манифест/файл (#EXTM3U / mpd / mp4 / webm / mkv).
//   Выход: таблица, сводка, ненулевой exit-code если хоть один источник не
//   подтвердился хотя бы на одном тайтле.
// Использование:
//   TOKEN=<реальный токен> node scripts/auto-confirm.mjs [--source <id>] [--only <key,key>]
import { config } from './auto-confirm-config.mjs';

const BASE = 'https://plugin.maniya-kvn.online/api/lampa/videos';
const TOKEN = process.env.TOKEN || config.TOKEN;
const CONCURRENCY = Number(process.env.AUTO_CONFIRM_CONCURRENCY || config.CONCURRENCY || 4);
const TIMEOUT_MS = Number(process.env.AUTO_CONFIRM_TIMEOUT || config.TIMEOUT_MS || 25000);

const MOVIES = config.MOVIES;
let STOCKS = [...config.STOCKS];
const argSource = process.argv.findIndex(a => a === '--source');
if (argSource !== -1 && process.argv[argSource + 1]) STOCKS = [process.argv[argSource + 1]];
const argOnly = process.argv.findIndex(a => a === '--only');
if (argOnly !== -1 && process.argv[argOnly + 1]) {
  const keys = process.argv[argOnly + 1].split(',').map(s => s.trim());
  MOVIES.splice(0, MOVIES.length, ...MOVIES.filter(m => keys.includes(m.key)));
}

function buildQuery(m) {
  const p = new URLSearchParams({ token: TOKEN, serial: m.serial || '0', source: 'tmdb', id: m.kinopoisk_id, title: m.title, original_title: m.original_title });
  if (m.year) p.set('year', m.year);
  if (m.imdb_id) p.set('imdb_id', m.imdb_id);
  if (m.kinopoisk_id) p.set('kinopoisk_id', m.kinopoisk_id);
  if (m.tmdb_id) p.set('tmdb_id', m.tmdb_id);
  return p;
}

async function fetchWithTimeout(url, timeout = TIMEOUT_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    return await fetch(url, { signal: ctl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(t);
  }
}

function classify(status, contentType, head) {
  if (status !== 200) return `FAIL·HTTP${status}`;
  if (head.includes('#EXTM3U') || contentType.includes('mpegurl')) return 'PASS·HLS';
  if (head.includes('<') || contentType.includes('mpd') || contentType.includes('dash')) return 'PASS·DASH';
  if (contentType.includes('mp4') || contentType.includes('webm') || contentType.includes('matroska') || contentType.includes('video')) return 'PASS·FILE';
  return `PASS·?(${contentType.split(';')[0] || 'no-ct'})`;
}

async function confirmItem(item) {
  const raw = String(item?.url || '');
  if (!raw) return 'FAIL·NURL';
  try {
    const r = await fetchWithTimeout(raw);
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const head = (await r.text()).slice(0, 24);
    return classify(r.status, ct, head);
  } catch (e) {
    return `FAIL·${(e.cause?.code || e.message).slice(0, 24)}`;
  }
}

async function probeCell(provider, movie) {
  const url = `${BASE}?provider=${encodeURIComponent(provider)}&${buildQuery(movie)}`;
  try {
    const r = await fetchWithTimeout(url);
    if (!r.ok) {
      const text = (await r.text()).slice(0, 80);
      return { status: `HTTP${r.status}`, detail: text };
    }
    const body = await r.json();
    const items = Array.isArray(body) ? body : (body.items || []);
    if (!items.length) return { status: 'EMPTY', detail: '' };
    const verdict = await confirmItem(items[0]);
    return { status: verdict, detail: String(items[0].voice_name || items[0].title || '').slice(0, 40) };
  } catch (e) {
    return { status: `ERR:${(e.cause?.code || e.message).slice(0, 22)}`, detail: '' };
  }
}

async function main() {
  const jobs = [];
  for (const s of STOCKS) for (const m of MOVIES) jobs.push({ s, m });
  const results = {};
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      results[`${job.s}|${job.m.key}`] = await probeCell(job.s, job.m);
      const r = results[`${job.s}|${job.m.key}`];
      process.stdout.write(`  [${job.s}] ${job.m.key.padEnd(12)} ${r.status}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

  // Таблица
  console.log('\n=== AUTO-CONFIRM ===');
  const header = ['stock'.padEnd(17), ...MOVIES.map(m => m.key.slice(0, 11).padEnd(11))].join(' ');
  console.log(header);
  let allPass = true;
  for (const s of STOCKS) {
    const cells = MOVIES.map(m => {
      const r = results[`${s}|${m.key}`];
      return (r.status.startsWith('PASS') ? '✅' : (r.status.startsWith('EMPTY') ? '·' : '❌')).padEnd(11);
    });
    const passCount = MOVIES.filter(m => results[`${s}|${m.key}`].status.startsWith('PASS')).length;
    if (passCount === 0) allPass = false;
    console.log(s.padEnd(17) + cells.join(' '));
  }
  console.log('\n=== FAILS ===');
  for (const key of Object.keys(results)) {
    const r = results[key];
    if (!r.status.startsWith('PASS')) console.log(`  ${key} -> ${r.status} ${r.detail}`);
  }
  console.log(`\nVerdict: ${allPass ? 'ALL SOURCES ALIVE ✅' : 'SOME SOURCES DEAD ❌'} (${Object.keys(results).length} cells)`);
  process.exit(allPass ? 0 : 1);
}

main().catch(e => { console.error('auto-confirm crash: ' + e.message); process.exit(2); });