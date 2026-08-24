// BALANCER-ONLINE8-003 — READ-ONLY: идентификация postid-карточек kinopub.
// Для Одиссея/Последний дом: все similar-link postid из checksearch → какая это
// реально карточка (title/year), есть ли там ЗАПРАШИВАЕМЫЙ фильм 2026.
// Также: полный разбор data-json карточек checksearch (все поля).
import { pathToFileURL } from 'node:url';
import path from 'node:path';
// SECURITY-001: creds только из env → temp (см. _creds.mjs)
import { loadClusterEmail, loadClusterUid } from './_creds.mjs';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const serverRoot = path.join(here, '..', 'server');
const resolve = (rel) => pathToFileURL(path.join(serverRoot, rel)).href;
const { checkSearchPredicate } = await import(resolve('src/availability.js'));
const { SkazProvider } = await import(resolve('src/providers/skaz/SkazProvider.js'));

const email = loadClusterEmail();
const uid = loadClusterUid();
const HOSTS = ['http://online3.skaz.tv', 'http://online8.skaz.tv'];

const CARDS = [
  { label: 'Одиссея 2026 (1368337)', query: { id: '1368337', imdb_id: 'tt33764258', title: 'Одиссея', original_title: 'The Odyssey', original_language: 'en', source: 'tmdb', year: 2026, serial: 0 }, postids: [1362, 17578, 20295] },
  { label: 'Последний дом 2026 (1284041)', query: { id: '1284041', imdb_id: 'tt32268156', title: 'Последний дом', original_title: 'The Last House', original_language: 'en', source: 'tmdb', year: 2026, serial: 0 }, postids: [2536, 12646] }
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== инлайн-репликация внутренних хелперов availability.js (НЕ экспортированы) =====
function comparableScripts(a, b) {
  const aCyr = /[Ѐ-ӿ]/.test(String(a));
  const bCyr = /[Ѐ-ӿ]/.test(String(b));
  const aLat = /[a-z]/i.test(String(a));
  const bLat = /[a-z]/i.test(String(b));
  return (aCyr && bCyr) || (aLat && bLat);
}
function normalizeTitle(value) {
  return String(value || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');
}
function linkTargetIds(url) {
  let kp = 0;
  let imdb = '';
  try {
    const parsed = new URL(String(url || ''));
    kp = Number(parsed.searchParams.get('kinopoisk_id') || parsed.searchParams.get('kp') || 0) || 0;
    imdb = String(parsed.searchParams.get('imdb_id') || '').trim().toLowerCase();
  } catch { /* no ids */ }
  return { kp, imdb };
}
function classifyLinkCard(card, query) {
  const cardTitle = normalizeTitle(card.title);
  const cardYear = Number(card.year) || 0;
  const { kp, imdb } = linkTargetIds(card.url);
  const qKp = Number(query.kinopoisk_id || query.kp || 0) || 0;
  const qImdb = String(query.imdb_id || query.imdb || '').trim().toLowerCase();
  const qYear = Number(query.year) || 0;
  const qTitle = normalizeTitle(query.title);
  const qOriginalTitle = normalizeTitle(query.original_title);
  if (kp && qKp && kp !== qKp) return 'absent';
  if (imdb && qImdb && imdb !== qImdb) return 'absent';
  if (kp && qKp && kp === qKp) return 'content';
  if (imdb && qImdb && imdb === qImdb) return 'content';
  const titleText = qTitle || qOriginalTitle;
  const comparable = cardTitle && titleText && comparableScripts(cardTitle, titleText);
  const titleMatch = comparable && (cardTitle === qTitle || cardTitle === qOriginalTitle);
  if (titleMatch) return 'content';
  if (comparable && !titleMatch) return 'absent';
  const yearKnown = cardYear > 0 && qYear > 0;
  if (yearKnown && cardYear !== qYear) return 'absent';
  if (yearKnown && cardYear === qYear) return 'content';
  return 'inconclusive';
}

async function get(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { accept: '*/*' }, signal: AbortSignal.timeout(12_000) });
    const text = await r.text().catch(() => null);
    return { status: r.status, ms: Date.now() - t0, text };
  } catch (e) { return { status: 0, ms: Date.now() - t0, text: null, err: String((e && e.message) || e).slice(0, 40) }; }
}

// Полный разбор data-json карточек из HTML (все поля).
function parseCards(text) {
  const out = [];
  const re = /data-json\s*=\s*["']?\{/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const brace = String(text).indexOf('{', m.index);
    let depth = 0, inStr = false, q = '', closed = -1;
    for (let j = brace; j < String(text).length; j += 1) {
      const c = String(text)[j];
      if (inStr) { if (c === '\\') { j += 1; continue; } if (c === q) inStr = false; continue; }
      if (c === '"' || c === "'") { inStr = true; q = c; continue; }
      if (c === '{') depth += 1; else if (c === '}') { depth -= 1; if (depth === 0) { closed = j; break; } }
    }
    if (closed === -1) break;
    const frag = String(text).slice(brace, closed + 1)
      .replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    try { out.push(JSON.parse(frag)); } catch { out.push({ __unparsed: true }); }
    re.lastIndex = closed + 1;
    if (out.length > 12) break;
  }
  return out;
}

function provider() {
  return new SkazProvider({ id: 'skaz-kinopub', title: 'kinopub', balancer: 'kinopub', hosts: HOSTS, accountEmail: email, uid });
}

async function postidPage(query, postid) {
  const p = provider();
  const params = p.buildPageParams(query);
  const html = await p.client.getLite({ ...params, postid: String(postid) });
  if (!html) return { cards: 0, items: 0, firstCard: null, error: 'null page' };
  const cards = p.normalizer.cards(html);
  const first = cards[0] || null;
  return {
    cards: cards.length,
    playable: cards.filter((c) => c.method === 'play' || c.method === 'call').length,
    firstCard: first ? { method: first.method, title: first.title, year: first.year, type: first.type, voice: first.voice_translate || first.translate || '' } : null,
    cardsPreview: cards.slice(0, 4).map((c) => ({ method: c.method, title: String(c.title || '').slice(0, 45), year: c.year || '' }))
  };
}

async function main() {
  console.log('== kinopub postid identity == email_len=' + email.length + ' uid_len=' + uid.length);
  for (const card of CARDS) {
    console.log('');
    console.log('═'.repeat(78));
    console.log('CARD ' + card.label);
    const q = card.query;
    // Полный разбор checksearch карточек
    const url = (host) => {
      const u = new URL(`${host}/lite/kinopub`);
      for (const [k, v] of Object.entries({ id: q.id, imdb_id: q.imdb_id, title: q.title, original_title: q.original_title, original_language: q.original_language, serial: 0, year: String(q.year), source: 'tmdb', checksearch: 'true' })) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
      u.searchParams.set('account_email', email); u.searchParams.set('uid', uid);
      return u.toString();
    };
    const r = await get(url(HOSTS[0]));
    const cards = r.text ? parseCards(r.text) : [];
    console.log('— checksearch data-json карточки (полностью) —');
    for (const c of cards) {
      const verdict = classifyLinkCard(c, q);
      console.log('  ' + JSON.stringify({ method: c.method, title: c.title, year: c.year, similar: c.similar, url: String(c.url || '').slice(0, 80), details: c.details }) + ' → classify=' + verdict);
    }
    const pred = r.text ? checkSearchPredicate(r.text, q) : null;
    console.log('  checkSearchPredicate: work=' + pred && pred.work + ' verdict=' + (pred && pred.verdict));
    await sleep(800);

    // Идентификация каждого postid
    console.log('— postid страницы (что реально играет videos()) —');
    for (const postid of card.postids) {
      const page = await postidPage(q, postid);
      console.log(`  postid=${postid}: cards=${page.cards} playable=${page.playable} first=${page.firstCard ? JSON.stringify(page.firstCard) : page.error}`);
      await sleep(1200);
    }

    // Точная идентификация выбранного videos() postid (movieHref scoring)
    const p = provider();
    const pageParams = p.buildPageParams(q);
    const firstHtml = await p.client.getLite(pageParams);
    const navCards = firstHtml ? p.normalizer.cards(firstHtml) : [];
    const href = p.movieHref(navCards, q);
    const picked = String(href || '').match(/postid=(\d+)/);
    console.log('  movieHref выбрал postid=' + (picked ? picked[1] : 'none') + ' (href=' + String(href || '').slice(0, 80) + ')');
    const page = await postidPage(q, picked ? picked[1] : '0');
    console.log('  → что это за фильм: ' + (page.firstCard ? JSON.stringify(page.firstCard) : page.error));
    await sleep(1000);
  }
}

main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });
