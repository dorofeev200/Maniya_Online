// BALANCER-002 §10 — SHADOW/COMPARE: OLD vs NEW vs E-Online reference.
//
// OLD  — текущий рабочий поток Maniya: `provider.videos()` на каждый видимый
//        источник (то, что юзер получает сегодня, кликая источник в UI).
// NEW  — новый availability-слой: `defaultChecker.card()` (checksearch на кластер,
//        show:true/false per card, кэш 5 мин, параллельно).
// EO   — reference E-Online: `lite/events?<card>&life=false` на тот же кластер —
//        серверный checkSearch по ВСЕМ источникам универсума E-Online (тот самый
//        механизм, что мы реплицируем; ответ — [{name,url,index,show,balanser,rch}]).
//
// КРИТИЧЕСКИЙ ГЕЙТ (задача не считается готовой при его провале):
//   OLD∩NEW — каждый источник, где OLD videos() дал items>0, обязан быть
//   NEW show:true. Иначе availability скрывает реально работающий источник.
//
// Запуск на VPS (server/.env с реальными кредами):
//   cd /opt/maniya-online/server && NODE_ENV=production node ../scripts/balancer-002-shadow.mjs
//
// Секреты НЕ печатаются (len только). Карточки, результат, диффы — в консоль;
// итоговый вердикт — последней строкой (для отчёта docs/balancer-002-report.md).
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(here, '..', 'server');
const resolve = (rel) => pathToFileURL(path.join(serverRoot, rel)).href;
const config = (await import(resolve('src/config.js'))).config;
const { registeredProviders } = await import(resolve('src/providers/registry.js'));
const { defaultChecker } = await import(resolve('src/availability.js'));

const CARDS = [
  { label: 'HOTD serial (94997)', query: { id: '94997', imdb_id: 'tt11198330', title: 'Дом Дракона', original_title: 'House of the Dragon', original_language: 'en', source: 'tmdb', year: 2022, serial: 1 } },
  { label: 'Forrest Gump (13)', query: { id: '13', imdb_id: 'tt0109830', title: 'Форрест Гамп', original_title: 'Forrest Gump', original_language: 'en', source: 'tmdb', year: 1994, serial: 0 } },
  { label: 'niche Seven-Per-Cent (27190)', query: { id: '27190', imdb_id: 'tt0076851', title: 'The Seven-Per-Cent Solution', original_title: 'The Seven-Per-Cent Solution', original_language: 'en', source: 'tmdb', year: 1976, serial: 0 } },
  { label: 'fake id (999999999)', query: { id: '999999999', imdb_id: 'tt9999999', title: 'Never Gonna Exist', original_title: 'Never Gonna Exist', original_language: 'en', source: 'tmdb', year: 2099, serial: 0 } },
  { label: 'The OA serial (71712)', query: { id: '71712', imdb_id: 'tt4491250', title: 'ОА', original_title: 'The OA', original_language: 'en', source: 'tmdb', year: 2016, serial: 1 } }
];

// ===== креды/токен (как index.js: userUid = sha256(token).slice(0,16)) =====
const email = config.skaz.accountEmail;
const uid = config.skaz.uid;
const origin = config.skaz.origin;
const hosts = config.skaz.hosts && config.skaz.hosts.length ? config.skaz.hosts : ['http://online3.skaz.tv'];

let token = '';
try {
  const users = JSON.parse(readFileSync(config.usersFile, 'utf8'));
  const anyUser = (Array.isArray(users) ? users.find((u) => u && u.active && u.token) : null) || (Array.isArray(users) ? users[0] : null);
  token = (anyUser && anyUser.token) || '';
} catch { token = ''; }
const userUid = crypto.createHash('sha256').update(String(token || '')).digest('hex').slice(0, 16);

// ===== утилиты =====
function pad(text, width) { return String(text).padEnd(width); }

async function mapConcurrent(items, worker, cap = 5) {
  const results = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor; cursor += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, () => run()));
  return results;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ===== OLD: videos() на каждый видимый источник =====
async function oldProbe(provider, query) {
  const t0 = Date.now();
  try {
    const context = {
      query: { ...query, token },
      request: { headers: { authorization: `Bearer ${token}` } }
    };
    const result = await withTimeout(provider.videos(context), 30_000, `old:${provider.id}`);
    const items = Array.isArray(result && result.items) ? result.items.length : 0;
    return { id: provider.id, working: items > 0, items, ms: Date.now() - t0, error: '' };
  } catch (error) {
    return { id: provider.id, working: false, items: 0, ms: Date.now() - t0, error: String((error && error.message) || error).slice(0, 50) };
  }
}

async function oldForCard(card, providers) {
  const started = Date.now();
  const results = await mapConcurrent(providers, (provider) => oldProbe(provider, card.query), 5);
  const totalMs = Date.now() - started;
  const sequentialMs = results.reduce((sum, r) => sum + r.ms, 0); // Σ per-provider (что платит клиент, кликая по очереди)
  const working = results.filter((r) => r.working);
  return { results, working, totalMs, sequentialMs };
}

// ===== NEW: availability card() + кэш =====
async function newForCard(card) {
  const query = { ...card.query, source: 'tmdb' };
  const t0 = Date.now();
  const first = await defaultChecker.card(query, userUid);
  const firstMs = Date.now() - t0;
  const second = await defaultChecker.card(query, userUid); // должен быть cache hit
  return { first, second, firstMs };
}

// ===== EO: reference через lite/events =====
function slugOf(url) {
  const m = String(url || '').match(/\/lite\/([^/?#]+)/i);
  return m ? m[1] : '';
}

async function eoUniverse() {
  const url = new URL(`${hosts[0]}/lite/events`);
  url.searchParams.set('life', 'false');
  if (email) url.searchParams.set('account_email', email);
  if (uid) url.searchParams.set('uid', uid);
  try {
    const r = await fetch(url, { headers: { accept: '*/*', Origin: origin }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    const text = await r.text().catch(() => '');
    let entries = [];
    try { entries = JSON.parse(text); } catch { entries = []; }
    if (!Array.isArray(entries)) entries = [];
    return { status: r.status, count: entries.length, slugs: entries.map((e) => slugOf(e.url)).filter(Boolean) };
  } catch (error) {
    return { status: 0, count: 0, slugs: [], error: String((error && error.message) || error).slice(0, 40) };
  }
}

async function eoReference(card) {
  const url = new URL(`${hosts[0]}/lite/events`);
  const params = {
    id: card.query.id, imdb_id: card.query.imdb_id, kinopoisk_id: card.query.kinopoisk_id,
    title: card.query.title, original_title: card.query.original_title,
    original_language: card.query.original_language, source: card.query.source || 'tmdb',
    year: card.query.year, serial: Number(card.query.serial) === 1 ? 1 : 0,
    life: 'false', account_email: email, uid
  };
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { accept: '*/*', Origin: origin }, redirect: 'follow', signal: AbortSignal.timeout(120_000) });
    const text = await r.text().catch(() => '');
    const ms = Date.now() - t0;
    let entries = [];
    try { entries = JSON.parse(text); } catch { entries = null; }
    if (!Array.isArray(entries)) {
      return { status: r.status, ms, entries: [], parseError: String(text).slice(0, 90) };
    }
    const show = entries.filter((e) => e && e.show).map((e) => slugOf(e.url)).filter(Boolean);
    return { status: r.status, ms, entries, show, parseError: '' };
  } catch (error) {
    return { status: 0, ms: 0, entries: [], show: [], parseError: String((error && error.message) || error).slice(0, 40) };
  }
}

// ===== сводка =====
function summarize(payload) {
  const map = new Map(payload.sources.map((s) => [s.id, s]));
  const show = [];
  const confirmed = [];
  const hidden = [];
  for (const s of payload.sources) {
    if (s.show) {
      const q = s.quality ? ` q=${s.quality}` : '';
      const rch = s.rch ? ' rch' : '';
      const conf = s.confirmed ? ' ✓confirm' : '';
      show.push(`${s.id}${q}${rch}${conf}`);
      if (s.confirmed) confirmed.push(s.id);
    } else if (s.confirmed) {
      hidden.push(s.id); // скрыт только после ДВОЙНОЙ проверки («нет» от checksearch + прямого lite-page)
    }
  }
  return { map, show, confirmed, hidden, count: payload.sources.length, showCount: show.length };
}

async function main() {
  if (process.env.SHADOW_DRY_RUN) {
    console.log('== BALANCER-002 SHADOW (dry-run) == email_len=' + email.length + ' uid_len=' + uid.length + ' token_len=' + token.length);
    console.log('hosts[0]=' + hosts[0] + ' checkEnabled=' + config.skaz.checkEnabled + ' checkTimeoutMs=' + config.skaz.checkTimeoutMs);
    const visible = registeredProviders().filter((p) => p.enabled());
    console.log('visible providers (' + visible.length + '): ' + visible.map((p) => p.id).join(', '));
    process.exit(0);
  }

  console.log('== BALANCER-002 SHADOW == email_len=' + email.length + ' uid_len=' + uid.length + ' token_len=' + token.length + ' userUid_len=' + userUid.length);
  console.log('hosts[0]=' + hosts[0] + ' checkEnabled=' + config.skaz.checkEnabled + ' checkTimeoutMs=' + config.skaz.checkTimeoutMs);
  const visible = registeredProviders().filter((p) => p.enabled());
  console.log('visible providers (' + visible.length + '): ' + visible.map((p) => p.id).join(', '));
  console.log('');

  // Универсум E-Online (lite/events без id) — для сравнения счётчиков.
  const universe = await eoUniverse();
  console.log('EO universe: lite/events (no id) status=' + universe.status + ' count=' + universe.count +
    (universe.error ? ' ERR=' + universe.error : ''));
  console.log('Maniya visible: ' + visible.length + ' | EO universe: ' + universe.count + (universe.status ? '' : ' (unavailable)'));
  console.log('');

  const overall = { pass: true, notes: [] };
  for (const card of CARDS) {
    console.log('─'.repeat(72));
    console.log('CARD ' + card.label);

    // OLD
    const old = await oldForCard(card, visible);
    console.log('  OLD videos(): ' + old.working.length + '/' + visible.length + ' рабочих; Σ per-provider=' + old.sequentialMs + 'ms (wall=' + old.totalMs + 'ms)');
    for (const r of old.results) {
      console.log(`    ${pad(r.id, 20)} items=${pad(r.items, 3)}${r.working ? 'OK  ' : '--- '}${r.error ? r.error : ''}`);
    }

    // NEW
    let newRes, secondCached = 'n/a';
    try {
      newRes = await newForCard(card);
      const firstSum = summarize(newRes.first);
      secondCached = newRes.second.cached ? 'YES' : 'NO';
      console.log('  NEW availability: ' + firstSum.showCount + '/' + firstSum.count + ' show:true; first=' + newRes.firstMs + 'ms (parallel); 2nd call cached=' + secondCached + (firstSum.confirmed.length ? '; confirm=' + firstSum.confirmed.length : ''));
      console.log('    show:true → ' + firstSum.show.join(' | '));
      if (firstSum.hidden.length) console.log('    hidden (double-verified) → ' + firstSum.hidden.join(', '));
      if (firstSum.showCount !== firstSum.show.length) console.log('    (showCount=' + firstSum.showCount + ')');
      newRes = newRes.first;
    } catch (error) {
      console.log('  NEW availability: ERR ' + String((error && error.message) || error));
      overall.pass = false;
      overall.notes.push(card.label + ': NEW threw');
      continue;
    }
    const newMap = summarize(newRes).map;

    // EO reference
    const eo = await eoReference(card);
    if (eo.parseError) {
      console.log('  EO reference: status=' + eo.status + 'ms=' + eo.ms + ' PARSE-ERR: ' + eo.parseError);
    } else {
      const eoSet = new Set(eo.show);
      console.log('  EO reference: status=' + eo.status + ' entries=' + eo.entries.length + ' show:true=' + eo.show.length + ' ms=' + eo.ms);
      console.log('    show:true → ' + eo.show.join(', '));
      // Слаги E-Online, соответствующие нашим видимым skaz-источникам.
      const ourSkazSlugs = visible.filter((p) => p.id.startsWith('skaz-')).map((p) => p.balancer);
      const eoOnly = ourSkazSlugs.filter((slug) => eoSet.has(slug) && !(newMap.get('skaz-' + slug) && newMap.get('skaz-' + slug).show));
      const newOnly = ourSkazSlugs.filter((slug) => newMap.get('skaz-' + slug) && newMap.get('skaz-' + slug).show && !eoSet.has(slug));
      if (eoOnly.length) console.log('    ⚠ EO показывает, NEW скрывает (наш видимый skaz): ' + eoOnly.join(', '));
      if (newOnly.length) console.log('    ℹ NEW показывает, EO скрывает: ' + newOnly.join(', '));
    }

    // ГЕЙТ: OLD∩NEW
    const skazGaps = old.working
      .filter((r) => r.id.startsWith('skaz-'))
      .filter((r) => !(newMap.get(r.id) && newMap.get(r.id).show))
      .map((r) => r.id);
    const nativeGaps = old.working
      .filter((r) => !r.id.startsWith('skaz-'))
      .filter((r) => !(newMap.get(r.id) && newMap.get(r.id).show))
      .map((r) => r.id);
    const gateOk = skazGaps.length === 0 && nativeGaps.length === 0;
    console.log('  ГЕЙТ OLD∩NEW: ' + (gateOk ? 'PASS' : 'FAIL'));
    if (skazGaps.length) { console.log('    ✗ OLD рабочие, но NEW скрывает (skaz): ' + skazGaps.join(', ')); overall.pass = false; }
    if (nativeGaps.length) { console.log('    ✗ OLD рабочие, но NEW скрывает (native): ' + nativeGaps.join(', ')); overall.pass = false; }
    if (!gateOk) overall.notes.push(card.label + ': OLD∩NEW diff непустой');
    console.log('');
  }

  console.log('='.repeat(72));
  console.log('ИТОГ: ' + (overall.pass ? 'GATE PASS — OLD∩NEW пустой, availability не скрывает рабочих источников' : 'GATE FAIL — ' + overall.notes.join('; ')));
}

main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });
