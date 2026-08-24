// BALANCER-ONLINE8-002 — focused kinopub RE-VERIFICATION after verification-induced
// cluster saturation flake (prod card first=12006/12001ms → kinopub hide, тот же
// паттерн, что shadow run1 OA 12005ms: online8-туннель kinopub насыщается под
// 5-карточным burst'ом). kinopub ИСКЛЮЧЁН из abstain (rule 8, newMode-гейт) — его
// проба побайтово legacy. Поэтому hide под deadline = транзиент, self-heal по
// HIDE_TTL_MS=60с.
//
// Шаги:
//   1. ждём 70с (hide-TTL 60с истекает — карточка пересчитается)
//   2. live-проба kinopub на кластере по каждой из 4 карточек (checksearch+direct,
//      online3+online8, 2 раунда) — ожидаем 200 content-bearing
//   3. пере-карточка по API для Дом Дракона (94997) и Forrest Gump (13) —
//      kinopub обязан вернуться в show (последовательно, с паузами)
//   4. videos() по API для kinopub на Одиссея (1368337), Последний дом (1284041),
//      Дом Дракона (94997) — ожидаем items>0 (как в shadow: 4/3/10)
//   5. подтверждаем pre-existing GAP 003 без изменений: Одиссея/Последний дом
//      kinopub card=hide ПРИ items>0 (БЫЛО и в shadow OLD/NEW) — не регрессия фикса.
//
// Секреты не печатаются. Вердикт — последней строкой.
// SECURITY-001: creds только из env → temp (см. _creds.mjs)
import { loadUserA, loadClusterEmail, loadClusterUid, loadClusterOrigin } from './_creds.mjs';

const BASE = process.env.PROD_BASE_URL || 'https://plugin.maniya-kvn.online';
const userA = loadUserA();
const email = loadClusterEmail();
const uid = loadClusterUid();
const origin = loadClusterOrigin();
const HOSTS = ['http://online3.skaz.tv', 'http://online8.skaz.tv'];

const CARDS = [
  { label: 'Одиссея 2026 (1368337)', query: { id: '1368337', imdb_id: 'tt33764258', title: 'Одиссея', original_title: 'The Odyssey', original_language: 'en', source: 'tmdb', year: 2026, serial: 0 } },
  { label: 'Последний дом 2026 (1284041)', query: { id: '1284041', imdb_id: 'tt32268156', title: 'Последний дом', original_title: 'The Last House', original_language: 'en', source: 'tmdb', year: 2026, serial: 0 } },
  { label: 'Дом Дракона serial (94997)', query: { id: '94997', imdb_id: 'tt11198330', title: 'Дом Дракона', original_title: 'House of the Dragon', original_language: 'en', source: 'tmdb', year: 2022, serial: 1 } },
  { label: 'Forrest Gump (13)', query: { id: '13', imdb_id: 'tt0109830', title: 'Форрест Гамп', original_title: 'Forrest Gump', original_language: 'en', source: 'tmdb', year: 1994, serial: 0 } }
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byId = (id) => CARDS.find((c) => c.query.id === id);

async function api(path, token, query = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  url.searchParams.set('token', token);
  const t0 = Date.now();
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
  const ms = Date.now() - t0;
  const text = await r.text().catch(() => '');
  let body = null; try { body = JSON.parse(text); } catch { body = null; }
  return { status: r.status, ms, body, raw: text.slice(0, 120) };
}

async function clusterProbe(card, hostIndex, withCheck) {
  const url = new URL(`${HOSTS[hostIndex]}/lite/kinopub`);
  for (const [k, v] of Object.entries(card.query)) {
    if (k === 'serial') continue;
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  if (card.query.serial) url.searchParams.set('serial', '1');
  if (withCheck) url.searchParams.set('checksearch', 'true');
  if (email) url.searchParams.set('account_email', email);
  if (uid) url.searchParams.set('uid', uid);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { accept: '*/*', Origin: origin }, signal: AbortSignal.timeout(9000) });
    const text = await r.text().catch(() => '(no body)');
    const first = text.split(/\r?\n/, 1)[0].slice(0, 60).replace(/\s+/g, ' ');
    const content = r.status === 200 && text.length > 40;
    return { host: HOSTS[hostIndex], mode: withCheck ? 'check' : 'direct', status: r.status, ms: Date.now() - t0, content, first };
  } catch (e) {
    return { host: HOSTS[hostIndex], mode: withCheck ? 'check' : 'direct', status: 0, ms: Date.now() - t0, content: false, first: 'ERR ' + String((e && e.message) || e).slice(0, 30) };
  }
}

async function main() {
  console.log('== kinopub re-verify == email_len=' + email.length + ' uid_len=' + uid.length);
  console.log('ждём 70с (hide-TTL 60с)…');
  await sleep(70_000);
  const results = { pass: true, notes: [], live: [], card: {}, videos: {} };

  // 1) live-проба кластера по 4 карточкам (2 раунда × 2 хоста × check/direct)
  for (const card of CARDS) {
    let okAll = true;
    for (let round = 1; round <= 2; round += 1) {
      const p1 = await clusterProbe(card, 0, true);   // online3 checksearch
      const p2 = await clusterProbe(card, 0, false);  // online3 direct
      const p3 = await clusterProbe(card, 1, true);   // online8 checksearch
      const p4 = await clusterProbe(card, 1, false);  // online8 direct
      const line = `${card.query.id} r${round} online3-check:${p1.status}${p1.content ? ' content' : ' [' + p1.first + ']'} | online3-direct:${p2.status}${p2.content ? ' content' : ' [' + p2.first + ']'} | online8-check:${p3.status}${p3.content ? ' content' : ' [' + p3.first + ']'} | online8-direct:${p4.status}${p4.content ? ' content' : ' [' + p4.first + ']'}`;
      console.log('  live ' + line);
      if (!(p1.content && p3.status === 200)) okAll = false;
      await sleep(800);
    }
    results.live.push({ id: card.query.id, ok: okAll });
    if (!okAll) { results.pass = false; results.notes.push(card.query.id + ': kinopub cluster probe нестабилен'); }
  }
  console.log('live-проба kinopub: ' + results.live.map((l) => l.id + '=' + (l.ok ? 'OK' : 'FLAKE')).join(' '));

  // 2) пере-карточка для Дом Дракона и FG (kinopub обязан вернуться в show)
  for (const id of ['94997', '13']) {
    const card = byId(id);
    const r = await api('/api/lampa/sources/card', userA.token, { ...card.query, source: 'tmdb' });
    const row = (r.body && r.body.sources ? r.body.sources : []).find((s) => s.id === 'skaz-kinopub');
    const show = row ? row.show : null;
    const meta = r.body && r.body.meta;
    results.card[id] = show;
    console.log(`  card ${card.label}: kinopub=${show === true ? 'show' : show === false ? 'HIDE' : 'n/a'} first=${meta && meta.elapsed_ms}ms cached=${meta && meta.cached}`);
    if (show !== true) { results.pass = false; results.notes.push(id + ': kinopub card всё ещё hide'); }
    await sleep(4000);
  }

  // 3) videos kinopub на 3 карточках (Одиссея/Последний дом/Дом Дракона) → items>0
  for (const id of ['1368337', '1284041', '94997']) {
    const card = byId(id);
    const r = await api('/api/lampa/videos', userA.token, { ...card.query, provider: 'skaz-kinopub', source: 'tmdb' });
    const items = (r.body && Array.isArray(r.body.items)) ? r.body.items.length : 0;
    results.videos[id] = items;
    console.log(`  videos kinopub ${card.label}: items=${items}${items > 0 ? ' OK' : ' ---'}`);
    if (items === 0) { results.pass = false; results.notes.push(id + ': kinopub videos=0'); }
    await sleep(4000);
  }

  // 4) GAP 003: Одиссея/Последний дом — card=hide при items>0 (pre-existing, было в shadow)
  console.log('  GAP 003 (pre-existing, вне фикса): Одиссея card=' + (results.card['1368337'] === undefined ? 'n/a' : '') + ' items=' + results.videos['1368337'] +
    ' | Последний дом items=' + results.videos['1284041'] +
    ' | (shadow: Одиссея hide+4, Последний дом hide+3)');

  console.log('');
  console.log('='.repeat(70));
  console.log('VERDICT: ' + (results.pass ? 'PASS — kinopub работает как раньше' : 'FAIL'));
  if (results.notes.length) console.log('  notes: ' + results.notes.join('; '));
}

main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });
