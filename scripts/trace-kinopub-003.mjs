// BALANCER-ONLINE8-003 — READ-ONLY трассировка kinopub false-negative.
// Цель: для Одиссея (1368337) и Последний дом (1284041) показать, ПОЧЕМУ
// availability (checksearch→hide) расходится с videos() (items>0) и E-Online (show).
//
// Воспроизводит вручную оба контура с РЕАЛЬНЫМИ кредами кластера:
//   1) availability: buildUrl (id/imdb_id/title/original_title/original_language/serial/
//      year/source + checksearch=true) → checkSearchPredicate (сырой ответ + вердикт);
//      прямой lite-page (без checksearch) → тот же предикат (второй сигнал confirmAbsence);
//   2) videos(): getLite → href → postid (навигация SkazProvider.collectMovieCards) → items;
//   3) E-Online: lite/events (life=false) → show per balancer.
// Ничего не пишет в кластер кроме GET. Никаких изменений кода/деплоя.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
// SECURITY-001: creds только из env → temp (см. _creds.mjs)
import { loadClusterEmail, loadClusterUid, loadClusterOrigin } from './_creds.mjs';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const serverRoot = path.join(here, '..', 'server');
const resolve = (rel) => pathToFileURL(path.join(serverRoot, rel)).href;

const { checkSearchPredicate, isSerialQuery } = await import(resolve('src/availability.js'));
const { SkazProvider } = await import(resolve('src/providers/skaz/SkazProvider.js'));
const { SkazNormalizer } = await import(resolve('src/providers/skaz/SkazNormalizer.js'));

const email = loadClusterEmail();
const uid = loadClusterUid();
const origin = loadClusterOrigin();
const HOSTS = ['http://online3.skaz.tv', 'http://online8.skaz.tv', 'http://94.249.239.63', 'http://94.249.239.37', 'http://94.249.239.11', 'http://77.90.33.109'];

const CARDS = [
  { label: 'Одиссея 2026 (1368337)', query: { id: '1368337', imdb_id: 'tt33764258', title: 'Одиссея', original_title: 'The Odyssey', original_language: 'en', source: 'tmdb', year: 2026, serial: 0 } },
  { label: 'Последний дом 2026 (1284041)', query: { id: '1284041', imdb_id: 'tt32268156', title: 'Последний дом', original_title: 'The Last House', original_language: 'en', source: 'tmdb', year: 2026, serial: 0 } }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function pad(text, width) { return String(text).padEnd(width); }

// ===== 1) availability URL (buildUrl replication) =====
function buildUrl(host, balancer, query, checksearch, extra = {}) {
  const url = new URL(`${host}/lite/${balancer}`);
  const params = {
    id: String(query.id ?? query.tmdb_id ?? ''),
    imdb_id: String(query.imdb_id ?? ''),
    kinopoisk_id: String(query.kinopoisk_id ?? ''),
    title: String(query.title ?? ''),
    original_title: String(query.original_title ?? ''),
    original_language: String(query.original_language ?? ''),
    serial: isSerialQuery(query) ? 1 : 0,
    year: String(query.year ?? ''),
    source: String(query.source || 'tmdb'),
    ...extra
  };
  if (checksearch) params.checksearch = 'true';
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  url.searchParams.set('account_email', email);
  url.searchParams.set('uid', uid);
  return url.toString();
}

async function get(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { accept: '*/*' }, signal: AbortSignal.timeout(12_000) });
    const text = await r.text().catch(() => null);
    return { status: r.status, ms: Date.now() - t0, text };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, text: null, err: String((e && e.message) || e).slice(0, 50) };
  }
}

function firstLine(text) {
  return String(text || '').split(/\r?\n/, 1)[0].slice(0, 90).replace(/\s+/g, ' ');
}

function summarizeCards(text) {
  // Приблизительный обзор карточек (как в checkSearchPredicate): method/type/title
  const raw = String(text || '');
  const out = [];
  const re = /data-json\s*=\s*["']?\{/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const brace = raw.indexOf('{', m.index);
    let depth = 0, inStr = false, q = '', closed = -1;
    for (let j = brace; j < raw.length; j += 1) {
      const c = raw[j];
      if (inStr) { if (c === '\\') { j += 1; continue; } if (c === q) inStr = false; continue; }
      if (c === '"' || c === "'") { inStr = true; q = c; continue; }
      if (c === '{') depth += 1; else if (c === '}') { depth -= 1; if (depth === 0) { closed = j; break; } }
    }
    if (closed === -1) break;
    const frag = raw.slice(brace, closed + 1).replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    try {
      const o = JSON.parse(frag);
      out.push({ method: String(o.method || ''), type: String(o.type || ''), title: String(o.title || '').slice(0, 40), url: String(o.url || '').slice(0, 70), s: o.s, e: o.e });
    } catch { out.push({ __unparsed: true }); }
    m = re; re.lastIndex = closed + 1;
    if (out.length > 8) break;
  }
  return out;
}

// ===== 2) videos() навигация =====
function makeProvider(balancer) {
  return new SkazProvider({
    id: `skaz-${balancer}`,
    title: balancer,
    balancer,
    hosts: HOSTS,
    accountEmail: email,
    uid,
    origin
  });
}

async function traceNavigation(provider, query) {
  const steps = [];
  const pageParams = provider.buildPageParams(query);
  const firstHtml = await provider.client.getLite(pageParams);
  let cards = firstHtml ? provider.normalizer.cards(firstHtml) : [];
  steps.push({ step: 'getLite', cards: cards.length, methods: cards.map((c) => `${c.method || '?'}`).join(',') });

  if (firstHtml && cards.length) {
    const href = provider.movieHref(cards, query);
    steps.push({ step: 'movieHref', href: href ? href.slice(0, 70) : null });
    if (href) {
      const followed = await provider.client.getLite({ ...pageParams, href });
      const fc = followed ? provider.normalizer.cards(followed) : [];
      steps.push({ step: 'follow-href', cards: fc.length, methods: fc.map((c) => `${c.method || '?'}`).join(',') });
      cards = fc;
    }
    const postid = provider.postidFromCards(cards);
    steps.push({ step: 'postid', postid });
    if (postid != null) {
      const postCards = await provider.client.getLite({ ...pageParams, postid: String(postid) });
      const pc = postCards ? provider.normalizer.cards(postCards) : [];
      steps.push({ step: 'follow-postid', cards: pc.length, methods: pc.map((c) => `${c.method || '?'}`).join(',') });
    }
  }
  return { steps, cards };
}

// ===== 3) EO lite/events =====
async function eoReference(card) {
  const url = new URL(`${HOSTS[0]}/lite/events`);
  const params = {
    id: card.query.id, imdb_id: card.query.imdb_id, kinopoisk_id: card.query.kinopoisk_id,
    title: card.query.title, original_title: card.query.original_title,
    original_language: card.query.original_language, source: card.query.source || 'tmdb',
    year: card.query.year, serial: Number(card.query.serial) === 1 ? 1 : 0,
    life: 'false', account_email: email, uid
  };
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const r = await fetch(url, { headers: { accept: '*/*', Origin: origin }, redirect: 'follow', signal: AbortSignal.timeout(90_000) });
  const text = await r.text().catch(() => '');
  let entries = null; try { entries = JSON.parse(text); } catch { entries = null; }
  if (!Array.isArray(entries)) return { status: r.status, ms: 0, show: [], raw: text.slice(0, 120) };
  return { status: r.status, ms: 0, show: entries.filter((e) => e && e.show).map((e) => String((e.url || '').match(/\/lite\/([^/?#]+)/i)?.[1] || '')).filter(Boolean) };
}

// ===== main =====
async function main() {
  console.log('== kinopub trace == email_len=' + email.length + ' uid_len=' + uid.length + ' hosts[0]=' + HOSTS[0]);
  for (const card of CARDS) {
    console.log('');
    console.log('═'.repeat(80));
    console.log('CARD ' + card.label);
    const q = card.query;

    // --- availability signal 1: checksearch (buildUrl) ---
    console.log('— availability signal 1: checksearch=true (buildUrl) —');
    for (const host of [HOSTS[0], HOSTS[1]]) {
      const url = buildUrl(host, 'kinopub', q, true);
      const r = await get(url);
      if (r.err) { console.log(`  ${host} ERR ${r.err}`); continue; }
      const verdict = r.text != null ? checkSearchPredicate(r.text, q) : null;
      const cards = r.text != null ? summarizeCards(r.text) : [];
      console.log(`  ${host} status=${r.status} ms=${r.ms} first=[${firstLine(r.text)}]`);
      console.log(`    predicate: work=${verdict && verdict.work} verdict=${verdict && verdict.verdict} rch=${verdict && verdict.rch} quality=[${verdict && verdict.quality}]`);
      if (cards.length) console.log('    cards: ' + JSON.stringify(cards));
      await sleep(600);
    }
    // вариант без original_language (изоляция параметра)
    const urlNoLang = buildUrl(HOSTS[0], 'kinopub', q, true, { original_language: '' });
    const rNoLang = await get(urlNoLang);
    const vNoLang = rNoLang.text != null ? checkSearchPredicate(rNoLang.text, q) : null;
    console.log(`  online3 (без original_language) status=${rNoLang.status} ms=${rNoLang.ms} first=[${firstLine(rNoLang.text)}] verdict=${vNoLang && vNoLang.verdict}`);
    await sleep(600);

    // --- availability signal 2: direct lite-page (confirmAbsence) ---
    console.log('— availability signal 2: direct lite-page, no checksearch (confirmAbsence) —');
    for (const host of [HOSTS[0], HOSTS[1]]) {
      const url = buildUrl(host, 'kinopub', q, false);
      const r = await get(url);
      if (r.err) { console.log(`  ${host} ERR ${r.err}`); continue; }
      const verdict = r.text != null ? checkSearchPredicate(r.text, q) : null;
      const cards = r.text != null ? summarizeCards(r.text) : [];
      console.log(`  ${host} status=${r.status} ms=${r.ms} first=[${firstLine(r.text)}]`);
      console.log(`    predicate: work=${verdict && verdict.work} verdict=${verdict && verdict.verdict} rch=${verdict && verdict.rch}`);
      if (cards.length) console.log('    cards: ' + JSON.stringify(cards));
      await sleep(600);
    }

    // --- videos(): навигация ---
    console.log('— videos(): navigation (getLite → href → postid) —');
    const provider = makeProvider('kinopub');
    const nav = await traceNavigation(provider, q);
    for (const s of nav.steps) console.log('  step: ' + JSON.stringify(s));
    const context = { query: { ...q, token: '' }, request: { headers: {} } };
    const streamProxy = (url) => String(url);
    let items = [];
    try {
      const payload = await provider.movieVideos(context.query, context.request, streamProxy);
      items = payload.items || [];
    } catch (e) {
      console.log('  movieVideos ERR ' + String((e && e.message) || e).slice(0, 60));
    }
    console.log('  movieVideos items=' + items.length);
    if (items[0]) console.log('  items[0]: ' + JSON.stringify({ method: items[0].method, title: items[0].title, type: items[0].type, quality_keys: Object.keys(items[0].quality || {}).length, url_prefix: String(items[0].url || '').slice(0, 60) }));
    await sleep(1000);

    // --- E-Online reference ---
    console.log('— E-Online lite/events (life=false) —');
    const eo = await eoReference(card);
    console.log('  status=' + eo.status + ' show=' + eo.show.join(',') + (eo.raw ? ' raw=' + eo.raw.slice(0, 90) : ''));
    console.log('  kinopub в EO: ' + (eo.show.includes('kinopub') ? 'SHOW' : 'HIDE') + (eo.show.length ? '' : ' (нет entries)'));

    // --- сырые тела (для контекста, первые 400 симв.) ---
    console.log('— raw checksearch online3 (первые 500) —');
    const rawCheck = await get(buildUrl(HOSTS[0], 'kinopub', q, true));
    console.log('  ' + JSON.stringify(String(rawCheck.text || '').slice(0, 500)));
    await sleep(800);
  }
}

main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });
