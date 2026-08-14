// BALANCER-ONLINE8-002 — SHADOW/COMPARE: OLD (legacy) vs NEW (reservePolicy='abstain').
//
// online8.skaz.tv = легаси-нода: из 10 балансеров реально обслуживает ТОЛЬКО kinopub;
// для остальных 9 отвечает единообразным 403 `disable` (7 байт) = «модуль выключен»,
// НЕ «контента нет» (док. BALANCER-ONLINE8-001 §9). В legacy probe() этот 403 считается
// «нет»-голосом → primary 503 + online8 403 = unanimous «нет» → hide рабочего источника.
// NEW: online8 для не-kinopub ВОЗДЕРЖИВАЕТСЯ (403/503/2xx-non-content ≠ «нет»); hide
// возможен ТОЛЬКО от content-«нет» primary (2xx-non-content / accsdb-«Ожидаем фильм»).
//
// OLD  — createAvailabilityChecker({})                      — текущее прод-поведение.
// NEW  — createAvailabilityChecker({ reservePolicy:'abstain' }) — SHADOW-фикс (rule 2).
// OLDv — provider.videos() на каждый видимый источник (что юзер реально получает).
// EO   — reference E-Online lite/events (show:true per balancer) — контекст.
//
// КРИТИЧЕСКИЙ ГЕЙТ: OLD=show && OLDv>0 → NEW обязан быть show:true.
// FIXED:  OLD=hide && OLDv>0 && NEW=show — фикс вернул рабочий источник.
// REGRESSION (не должен существовать по построению): OLD=show → NEW=hide.
//
// Запуск на VPS (STAGED — НЕ деплой): /tmp/shadow-online8
//   cd /tmp/shadow-online8/server && NODE_ENV=production node ../scripts/online8-002-shadow.mjs
// Секреты НЕ печатаются (len только). Итоговый вердикт — последней строкой.
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(here, '..', 'server');
const resolve = (rel) => pathToFileURL(path.join(serverRoot, rel)).href;
const config = (await import(resolve('src/config.js'))).config;
const { registeredProviders, twinFor } = await import(resolve('src/providers/registry.js'));
const { createAvailabilityChecker } = await import(resolve('src/availability.js'));

// 7 карточек ТЗ BALANCER-ONLINE8-002 (query как у реальных устройств).
const CARDS = [
  { label: 'Одиссея 2026 (1368337)', query: { id: '1368337', imdb_id: 'tt33764258', title: 'Одиссея', original_title: 'The Odyssey', original_language: 'en', source: 'tmdb', year: 2026, serial: 0 } },
  { label: 'Последний дом 2026 (1284041)', query: { id: '1284041', imdb_id: 'tt32268156', title: 'Последний дом', original_title: 'The Last House', original_language: 'en', source: 'tmdb', year: 2026, serial: 0 } },
  { label: 'Дом Дракона serial (94997)', query: { id: '94997', imdb_id: 'tt11198330', title: 'Дом Дракона', original_title: 'House of the Dragon', original_language: 'en', source: 'tmdb', year: 2022, serial: 1 } },
  { label: 'Forrest Gump (13)', query: { id: '13', imdb_id: 'tt0109830', title: 'Форрест Гамп', original_title: 'Forrest Gump', original_language: 'en', source: 'tmdb', year: 1994, serial: 0 } },
  { label: 'The OA serial (71712)', query: { id: '71712', imdb_id: 'tt4491250', title: 'ОА', original_title: 'The OA', original_language: 'en', source: 'tmdb', year: 2016, serial: 1 } },
  { label: 'Seven-Per-Cent (27190)', query: { id: '27190', imdb_id: 'tt0076851', title: 'The Seven-Per-Cent Solution', original_title: 'The Seven-Per-Cent Solution', original_language: 'en', source: 'tmdb', year: 1976, serial: 0 } },
  { label: 'Матрица (603)', query: { id: '603', imdb_id: 'tt0133093', kinopoisk_id: '301', title: 'Матрица', original_title: 'The Matrix', original_language: 'en', source: 'tmdb', year: 1999, serial: 0 } }
];

// 9 специальных балансеров (online8 легаси: 403 disable; kinopub — реально живой).
const SPECIAL = ['filmix', 'rezka', 'rhsprem', 'videoseed', 'kinopub', 'kodik', 'kinoflix', 'rutubemovie', 'geosaitebi'];

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

function rowsById(payload) {
  return new Map(payload.sources.map((s) => [s.id, s]));
}

function slugOf(url) {
  const m = String(url || '').match(/\/lite\/([^/?#]+)/i);
  return m ? m[1] : '';
}

// ===== OLDv: videos() на каждый видимый источник (ground truth «что реально работает») =====
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
    return { id: provider.id, working: false, items: 0, ms: Date.now() - t0, error: String((error && error.message) || error).slice(0, 40) };
  }
}

async function oldForCard(card, providers) {
  const started = Date.now();
  const results = await mapConcurrent(providers, (provider) => oldProbe(provider, card.query), 5);
  return { results, working: results.filter((r) => r.working), totalMs: Date.now() - started };
}

// ===== NEW/OLD: availability card() (по одной на checker — раздельные кэши) =====
const oldChecker = createAvailabilityChecker({});                   // legacy (прод)
const newChecker = createAvailabilityChecker({ reservePolicy: 'abstain' }); // фикс

async function checkerCard(checker, card, label) {
  const query = { ...card.query, source: 'tmdb' };
  const t0 = Date.now();
  const first = await checker.card(query, userUid);
  const firstMs = Date.now() - t0;
  const second = await checker.card(query, userUid); // должен быть cache hit
  return { first, second, firstMs, label };
}

// ===== EO: reference lite/events (какие балансеры кластер реально показывает) =====
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
    const r = await fetch(url, { headers: { accept: '*/*', Origin: origin }, redirect: 'follow', signal: AbortSignal.timeout(90_000) });
    const text = await r.text().catch(() => '');
    const ms = Date.now() - t0;
    let entries = [];
    try { entries = JSON.parse(text); } catch { entries = null; }
    if (!Array.isArray(entries)) return { status: r.status, ms, show: [], parseError: String(text).slice(0, 70) };
    return { status: r.status, ms, show: entries.filter((e) => e && e.show).map((e) => slugOf(e.url)).filter(Boolean), parseError: '' };
  } catch (error) {
    return { status: 0, ms: 0, show: [], parseError: String((error && error.message) || error).slice(0, 40) };
  }
}

// ===== дифф-строка по балансеру =====
// row: {show, ...}. Флаг: '=' same | 'FIXED' (OLD=hide→NEW=show при OLDv>0) | 'reveal'
// (OLD=hide→NEW=show, OLDv=0) | 'REGR' (OLD=show→NEW=hide) | 'skaz' (только абстаин-источники)
function diffFlag(oldRow, newRow, videos) {
  const oldShow = Boolean(oldRow && oldRow.show);
  const newShow = Boolean(newRow && newRow.show);
  if (oldShow && !newShow) return 'REGR';               // критично — не должен существовать
  if (!oldShow && newShow && videos && videos.items > 0) return 'FIXED';
  if (!oldShow && newShow) return 'reveal';              // показан, но контента нет (оптимизм)
  return '=';
}

async function main() {
  if (process.env.SHADOW_DRY_RUN) {
    console.log('== BALANCER-ONLINE8-002 SHADOW (dry-run) == email_len=' + email.length + ' uid_len=' + uid.length + ' token_len=' + token.length);
    console.log('hosts[0]=' + hosts[0] + ' reservePolicy OLD=legacy NEW=abstain');
    const visible = registeredProviders().filter((p) => p.enabled());
    console.log('visible providers (' + visible.length + '): ' + visible.map((p) => p.id).join(', '));
    process.exit(0);
  }

  console.log('== BALANCER-ONLINE8-002 SHADOW == email_len=' + email.length + ' uid_len=' + uid.length + ' token_len=' + token.length);
  console.log('hosts[0]=' + hosts[0] + ' | OLD=createAvailabilityChecker({}) legacy | NEW=reservePolicy:\'abstain\' | checkEnabled=' + config.skaz.checkEnabled);
  const visible = registeredProviders().filter((p) => p.enabled());
  console.log('visible providers (' + visible.length + '): ' + visible.map((p) => p.id).join(', '));
  console.log('');

  const overall = { pass: true, notes: [], fixed: 0, regressed: 0, revealed: 0, gates: 0 };
  for (const card of CARDS) {
    console.log('─'.repeat(76));
    console.log('CARD ' + card.label);

    // OLDv (ground truth)
    const oldV = await oldForCard(card, visible);
    const vMap = new Map(oldV.results.map((r) => [r.id, r]));
    console.log('  OLDv videos(): ' + oldV.working.length + '/' + visible.length + ' рабочих (wall=' + oldV.totalMs + 'ms)');
    for (const r of oldV.results) {
      if (SPECIAL.some((s) => r.id === 'skaz-' + s) || twinFor(r.id) && SPECIAL.includes(twinFor(r.id).balancer)) {
        console.log(`    ${pad(r.id, 18)} items=${pad(r.items, 3)}${r.working ? 'OK ' : '---'}${r.error ? r.error : ''}`);
      }
    }

    // OLD + NEW карточки (последовательно — не нагружаем кластер двумя сразу)
    let oldC, newC;
    try {
      oldC = await checkerCard(oldChecker, card, 'OLD');
      newC = await checkerCard(newChecker, card, 'NEW');
    } catch (error) {
      console.log('  card() ERR: ' + String((error && error.message) || error));
      overall.pass = false;
      overall.notes.push(card.label + ': card threw');
      continue;
    }
    const oldMap = rowsById(oldC.first);
    const newMap = rowsById(newC.first);
    console.log('  OLD card:  ' + [...oldMap.values()].filter((s) => s.show).length + '/' + oldMap.size + ' show:true; first=' + oldC.firstMs + 'ms; 2nd cached=' + (oldC.second.cached ? 'YES' : 'NO'));
    console.log('  NEW card:  ' + [...newMap.values()].filter((s) => s.show).length + '/' + newMap.size + ' show:true; first=' + newC.firstMs + 'ms; 2nd cached=' + (newC.second.cached ? 'YES' : 'NO'));

    // EO reference
    const eo = await eoReference(card);
    const eoSet = new Set(eo.show);
    console.log('  EO ref:    status=' + eo.status + ' show:true=' + eo.show.length + ' ms=' + eo.ms + (eo.parseError ? ' PARSE-ERR ' + eo.parseError : ''));

    // ===== Дифф по 9 специальным балансерам =====
    console.log('');
    console.log(`  ${pad('balancer', 12)} OLD  NEW  OLDv  EO  flag`);
    const gates = [];
    for (const slug of SPECIAL) {
      const oldId = oldMap.has('skaz-' + slug) ? 'skaz-' + slug : [...oldMap.entries()].find(([, r]) => r.twinBalancer === slug)?.[0] || '';
      const newId = newMap.has('skaz-' + slug) ? 'skaz-' + slug : [...newMap.entries()].find(([, r]) => r.twinBalancer === slug)?.[0] || '';
      const oldRow = oldMap.get(oldId);
      const newRow = newMap.get(newId);
      const videos = vMap.get(oldId || newId) || vMap.get('skaz-' + slug) || null;
      if (!oldRow && !newRow) { console.log(`  ${pad(slug, 12)} n/a  n/a  n/a   n/a  (не видим)`); continue; }
      const oldS = oldRow ? (oldRow.show ? 'show' : 'hide') : 'n/a';
      const newS = newRow ? (newRow.show ? 'show' : 'hide') : 'n/a';
      const v = videos ? `${videos.items}${videos.working ? '' : '!'}` : 'n/a';
      const eoFlag = eoSet.has(slug) ? 'show' : 'hide';
      const flag = diffFlag(oldRow, newRow, videos);
      if (flag === 'FIXED') overall.fixed += 1;
      if (flag === 'REGR') { overall.regressed += 1; overall.pass = false; overall.notes.push(card.label + ':' + slug + ' REGR'); }
      if (flag === 'reveal') overall.revealed += 1;
      console.log(`  ${pad(slug, 12)} ${pad(oldS, 5)} ${pad(newS, 5)} ${pad(v, 5)} ${pad(eoFlag, 5)} ${flag}`);
      // ГЕЙТ: OLD=show && OLDv>0 → NEW=show
      if (oldRow && oldRow.show && videos && videos.working) {
        overall.gates += 1;
        if (!(newRow && newRow.show)) {
          gates.push(slug);
          overall.pass = false;
          overall.notes.push(card.label + ':' + slug + ' GATE-FAIL');
        }
      }
    }
    if (gates.length) console.log('  ✗ ГЕЙТ OLD∩OLDv→NEW FAIL: ' + gates.join(', '));
    else if (overall.gates) console.log('  ✓ ГЕЙТ OLD∩OLDv→NEW PASS (' + overall.gates + ' проверок на этой карточке)');
    console.log('');
  }

  console.log('='.repeat(76));
  console.log('ИТОГ: ' + (overall.pass ? 'GATE PASS' : 'GATE FAIL'));
  console.log('  FIXED=' + overall.fixed + ' (OLD=hide, OLDv>0, NEW=show — фикс вернул рабочий источник)');
  console.log('  REVEAL=' + overall.revealed + ' (OLD=hide, OLDv=0, NEW=show — оптимистичный показ, контента нет)');
  console.log('  REGRESSED=' + overall.regressed + ' (OLD=show → NEW=hide — не должно существовать по построению)');
  console.log('  GATE checks=' + overall.gates);
  if (overall.notes.length) console.log('  notes: ' + overall.notes.join('; '));
}

main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });
