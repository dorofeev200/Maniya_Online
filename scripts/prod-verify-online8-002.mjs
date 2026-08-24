// BALANCER-ONLINE8-002 — PRODUCTION VERIFICATION (ТЗ п.5-8).
//
// Проверяет ЗАДЕПЛОЕННЫЙ прод (https://plugin.maniya-kvn.online) после включения
// reservePolicy:'abstain' в defaultChecker. Сравнивает факт с SHADOW-ожиданиями
// (scripts/online8-002-shadow.mjs, docs/balancer-online8-002-report.md):
//   - health 200
//   - Filmix всегда show:true (TRUSTED_ALWAYS_VISIBLE, без пробы)
//   - kinopub как раньше (исключён из abstain, rule 8; pre-existing gap 003 — hide при items>0)
//   - рабочие источники не пропали: ГЕЙТ OLD=show && OLDv>0 → прод обязан show:true
//   - online8 403/503 больше сам по себе не даёт hide не-kinopub → REVEAL-источники
//     (OLD=hide → NEW=show, OLDv=0) стали видимы в проде
//   - cache BALANCER-STABILITY-002: первый вызов MISS, второй HIT
//   - два userUid НЕ смешиваются: токен B на ту же карточку — первый вызов MISS
//   - videos items + первый playback item по карточкам
//
// Секреты НЕ печатаются. Финальный вердикт — последней строкой.
// Запуск (Windows): node scripts/prod-verify-online8-002.mjs
// SECURITY-001: creds только из env → temp (см. _creds.mjs)
import { loadUsers, loadUserA } from './_creds.mjs';

const BASE = process.env.PROD_BASE_URL || 'https://plugin.maniya-kvn.online';
const userA = loadUserA();
const users = loadUsers();
const userB = process.env.PROD_TOKEN_B ? { token: process.env.PROD_TOKEN_B } : users.find((u) => u.token && !u.email);
if (!userA || !userB) throw new Error('need two users: one with email (A), one without (B)');

const SPECIAL = ['filmix', 'rezka', 'rhsprem', 'videoseed', 'kinopub', 'kodik', 'kinoflix', 'rutubemovie', 'geosaitebi'];

const CARDS = [
  { label: 'Одиссея 2026 (1368337)', query: { id: '1368337', imdb_id: 'tt33764258', title: 'Одиссея', original_title: 'The Odyssey', original_language: 'en', source: 'tmdb', year: 2026, serial: 0 } },
  { label: 'Последний дом 2026 (1284041)', query: { id: '1284041', imdb_id: 'tt32268156', title: 'Последний дом', original_title: 'The Last House', original_language: 'en', source: 'tmdb', year: 2026, serial: 0 } },
  { label: 'Дом Дракона serial (94997)', query: { id: '94997', imdb_id: 'tt11198330', title: 'Дом Дракона', original_title: 'House of the Dragon', original_language: 'en', source: 'tmdb', year: 2022, serial: 1 } },
  { label: 'Forrest Gump (13)', query: { id: '13', imdb_id: 'tt0109830', title: 'Форрест Гамп', original_title: 'Forrest Gump', original_language: 'en', source: 'tmdb', year: 1994, serial: 0 } },
  { label: 'The OA serial (71712)', query: { id: '71712', imdb_id: 'tt4491250', title: 'ОА', original_title: 'The OA', original_language: 'en', source: 'tmdb', year: 2016, serial: 1 } }
];

// Shadow-ожидания (run2, стабильные). old/new = show/hide, oldv = items videos() в shadow.
// reveal = NEW=show при OLD=hide и oldv=0 (14 кейсов, в этих 5 карточках — 11).
const SHADOW = {
  '1368337': { // Одиссея
    filmix: { old: 'show', new: 'show', oldv: 13 }, rezka: { old: 'hide', new: 'hide', oldv: 0 },
    rhsprem: { old: 'hide', new: 'hide', oldv: 0 }, videoseed: { old: 'show', new: 'show', oldv: 5 },
    kinopub: { old: 'hide', new: 'hide', oldv: 4 }, kodik: { old: 'hide', new: 'hide', oldv: 0 },
    kinoflix: { old: 'hide', new: 'show', oldv: 0, reveal: true }, rutubemovie: { old: 'show', new: 'show', oldv: 2 },
    geosaitebi: { old: 'show', new: 'show', oldv: 0 }
  },
  '1284041': { // Последний дом
    filmix: { old: 'show', new: 'show', oldv: 4 }, rezka: { old: 'show', new: 'show', oldv: 3 },
    rhsprem: { old: 'show', new: 'show', oldv: 2 }, videoseed: { old: 'hide', new: 'show', oldv: 0, reveal: true },
    kinopub: { old: 'hide', new: 'hide', oldv: 3 }, kodik: { old: 'hide', new: 'hide', oldv: 0 },
    kinoflix: { old: 'hide', new: 'hide', oldv: 2 }, rutubemovie: { old: 'show', new: 'show', oldv: 0 },
    geosaitebi: { old: 'hide', new: 'hide', oldv: 1 }
  },
  '94997': { // Дом Дракона
    filmix: { old: 'show', new: 'show', oldv: 10 }, rezka: { old: 'show', new: 'show', oldv: 10 },
    rhsprem: { old: 'show', new: 'show', oldv: 10 }, videoseed: { old: 'show', new: 'show', oldv: 10 },
    kinopub: { old: 'show', new: 'show', oldv: 10 }, kodik: { old: 'hide', new: 'hide', oldv: 0 },
    kinoflix: { old: 'hide', new: 'show', oldv: 0, reveal: true }, rutubemovie: { old: 'hide', new: 'show', oldv: 0, reveal: true },
    geosaitebi: { old: 'hide', new: 'show', oldv: 0, reveal: true }
  },
  '13': { // Forrest Gump
    filmix: { old: 'show', new: 'show', oldv: 5 }, rezka: { old: 'show', new: 'show', oldv: 22 },
    rhsprem: { old: 'show', new: 'show', oldv: 22 }, videoseed: { old: 'hide', new: 'show', oldv: 0, reveal: true },
    kinopub: { old: 'show', new: 'show', oldv: 25 }, kodik: { old: 'hide', new: 'show', oldv: 0, reveal: true },
    kinoflix: { old: 'show', new: 'show', oldv: 3 }, rutubemovie: { old: 'show', new: 'show', oldv: 0 },
    geosaitebi: { old: 'show', new: 'show', oldv: 1 }
  },
  '71712': { // The OA
    filmix: { old: 'show', new: 'show', oldv: 8 }, rezka: { old: 'show', new: 'show', oldv: 8 },
    rhsprem: { old: 'show', new: 'show', oldv: 8 }, videoseed: { old: 'hide', new: 'show', oldv: 0, reveal: true },
    kinopub: { old: 'show', new: 'show', oldv: 8 }, kodik: { old: 'hide', new: 'hide', oldv: 0 },
    kinoflix: { old: 'hide', new: 'hide', oldv: 0 }, rutubemovie: { old: 'hide', new: 'show', oldv: 0, reveal: true },
    geosaitebi: { old: 'hide', new: 'show', oldv: 0, reveal: true }
  }
};

// ===== утилиты =====
function pad(text, width) { return String(text).padEnd(width); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: r.status, ms, body, raw: text.slice(0, 200) };
}

async function mapConcurrent(items, worker, cap = 3) {
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

// ===== сбор данных =====
const summary = { pass: true, notes: [], gates: 0, revealsChecked: 0, revealsOk: 0, filmixChecks: 0, playback: 0 };

async function verify() {
  // 1) health
  const health = await api('/health', userA.token, {});
  const healthOk = health.status === 200 && health.body && health.body.ok === true;
  console.log('health: ' + health.status + (healthOk ? ' OK' : ' FAIL'));
  if (!healthOk) { summary.pass = false; return; }

  // 2) статический реестр → id по слагу (native filmix/rezka/kodik/rutubemovie; skaz-* для остальных)
  const reg = await api('/api/lampa/sources', userA.token, {});
  const regIds = (reg.body && reg.body.sources ? reg.body.sources.map((s) => s.id) : []);
  function idFor(slug) {
    if (regIds.includes('skaz-' + slug)) return 'skaz-' + slug;
    if (regIds.includes(slug)) return slug;
    return '';
  }
  console.log('visible sources (' + regIds.length + '): ' + regIds.join(', '));

  for (const card of CARDS) {
    console.log('');
    console.log('─'.repeat(80));
    console.log('CARD ' + card.label);
    const exp = SHADOW[card.query.id];

    // 3) карточка: A1 MISS → A2 HIT (cache), B1 MISS (uid-разделение) → B2 HIT
    const q = { ...card.query, source: 'tmdb' };
    const a1 = await api('/api/lampa/sources/card', userA.token, q);
    const a2 = await api('/api/lampa/sources/card', userA.token, q);
    const b1 = await api('/api/lampa/sources/card', userB.token, q);
    const b2 = await api('/api/lampa/sources/card', userB.token, q);
    const rows = new Map((a1.body && a1.body.sources ? a1.body.sources : []).map((s) => [s.id, s]));
    const showIds = [...rows.values()].filter((s) => s.show).map((s) => s.id);
    const meta = a1.body && a1.body.meta;
    const count = meta ? meta.count : rows.size;

    console.log('  card A: first=' + (a1.body && a1.body.meta && a1.body.meta.elapsed_ms) + 'ms cached=' + (a1.body && a1.body.meta && a1.body.meta.cached) +
      ' | A2 cached=' + (a2.body && a2.body.meta && a2.body.meta.cached) +
      ' | B1 cached=' + (b1.body && b1.body.meta && b1.body.meta.cached) +
      ' | B2 cached=' + (b2.body && b2.body.meta && b2.body.meta.cached) +
      ' | count=' + count + ' show=' + showIds.length);
    const cacheOk = a1.body.meta.cached === false && a2.body.meta.cached === true
      && b1.body.meta.cached === false && b2.body.meta.cached === true;
    console.log('  cache MISS→HIT + uid-разделение: ' + (cacheOk ? 'OK' : 'FAIL'));

    const checkEnabled = meta && meta.elapsed_ms > 0;
    console.log('  probes реально бежали (elapsed_ms>0): ' + (checkEnabled ? 'OK' : 'FAIL — checkEnabled выключен?'));

    // 4) таблица по 9 специальным
    console.log('  ' + pad('balancer', 12) + ' OLD   NEW(shadow) prod videos  flag');
    const gates = [];
    const reveals = [];
    for (const slug of SPECIAL) {
      const e = exp[slug];
      const id = idFor(slug);
      const row = rows.get(id);
      const prod = row ? (row.show ? 'show' : 'hide') : 'n/a';
      const flag = [];
      if (prod === 'n/a') { console.log(`  ${pad(slug, 12)} ${pad(e.old, 5)} ${pad(e.new, 10)} ${pad(prod, 6)}  (не видим в проде)`); continue; }
      if (e.new === 'show' && prod !== 'show') flag.push('REGR');
      if (e.new === 'hide' && prod !== 'hide') flag.push('SHOULD-HIDE');
      if (e.old === 'show' && e.oldv > 0 && prod !== 'show') { flag.push('GATE-FAIL'); gates.push(slug); }
      if (e.old === 'show' && e.oldv > 0) summary.gates += 1;
      // REVEAL: shadow NEW=show при OLD=hide и oldv=0 → прод обязан показывать
      if (e.reveal) {
        summary.revealsChecked += 1;
        if (prod === 'show') { summary.revealsOk += 1; reveals.push(slug); }
        else flag.push('REVEAL-NOT-VISIBLE');
      }
      // filmix
      if (slug === 'filmix') {
        summary.filmixChecks += 1;
        if (prod !== 'show') flag.push('FILMIX-HIDDEN');
      }
      console.log(`  ${pad(slug, 12)} ${pad(e.old, 5)} ${pad(e.new, 10)} ${pad(prod, 6)} ${flag.length ? flag.join(',') : '='}`);
    }
    if (gates.length) { summary.pass = false; summary.notes.push(card.label + ': GATE-FAIL ' + gates.join(',')); }
    if (reveals.length) console.log('  REVEAL-видимы в проде: ' + reveals.join(', '));

    // 5) videos items по 9 специальным (ground truth «что юзер реально получает»)
    const vids = await mapConcurrent(SPECIAL.map((slug) => ({ slug, id: idFor(slug) })).filter((x) => x.id),
      async ({ slug, id }) => {
        const r = await api('/api/lampa/videos', userA.token, { ...q, provider: id });
        const items = (r.body && Array.isArray(r.body.items)) ? r.body.items.length : 0;
        return { slug, id, items, status: r.status };
      }, 3);
    const vMap = new Map(vids.map((v) => [v.slug, v]));
    for (const v of vids) {
      const e = exp[v.slug];
      const marker = v.items > 0 ? 'OK ' : '---';
      const note = [];
      if (e.oldv > 0 && v.items === 0) { note.push('LOST-CONTENT'); summary.pass = false; summary.notes.push(card.label + ':' + v.slug + ' LOST-CONTENT'); }
      if (e.reveal && v.items > 0) { note.push('REVEAL-HAS-CONTENT'); }
      console.log(`  videos ${pad(v.id, 18)} items=${pad(v.items, 3)}${marker}${note.length ? ' ' + note.join(',') : ''}`);
    }

    // 6) первый playback item: filmix + kinopub (и rezka на сериалах/где релевантно)
    for (const pslug of ['filmix', 'kinopub', 'rezka']) {
      const vid = vMap.get(pslug);
      if (!vid || vid.items === 0) continue;
      const rv = await api('/api/lampa/videos', userA.token, { ...q, provider: vid.id });
      const items = (rv.body && Array.isArray(rv.body.items)) ? rv.body.items : [];
      const item0 = items[0];
      if (!item0) { console.log(`  play ${pad(vid.id, 18)} items[] пуст — пропуск`); continue; }
      summary.playback += 1;
      if (item0.method === 'call' && item0.url) {
        // item0.url = наш /api/lampa/video?…&token=… (buildResolveUrl уже добавил токен)
        const res = await fetch(item0.url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
        const txt = await res.text().catch(() => '');
        let desc = null; try { desc = JSON.parse(txt); } catch { desc = null; }
        const ok = res.status === 200 && desc && desc.method === 'play' && typeof desc.url === 'string' && desc.url;
        console.log(`  play ${pad(vid.id, 18)} call→resolve status=${res.status} playable=${ok ? 'YES' : 'NO'}${ok ? '' : ' body=' + txt.slice(0, 90)}`);
        if (!ok) { summary.pass = false; summary.notes.push(card.label + ':' + pslug + ' playback NO'); }
      } else if (item0.method === 'play' && typeof item0.url === 'string') {
        const proxy = item0.url.startsWith(BASE) && item0.url.includes('/api/lampa/proxy');
        const quality = Object.keys(item0.quality || {}).length > 0;
        console.log(`  play ${pad(vid.id, 18)} play direct proxy=${proxy ? 'YES' : 'NO'} quality_keys=${quality ? 'YES' : 'NO'}`);
        if (!proxy) { summary.pass = false; summary.notes.push(card.label + ':' + pslug + ' play-not-proxy'); }
      } else {
        console.log(`  play ${pad(vid.id, 18)} UNEXPECTED item shape: ` + JSON.stringify(item0).slice(0, 80));
        summary.pass = false; summary.notes.push(card.label + ':' + pslug + ' unexpected-item');
      }
      await sleep(150);
    }

    if (!cacheOk) { summary.pass = false; summary.notes.push(card.label + ': cache/uid FAIL'); }
    if (!checkEnabled) { summary.pass = false; summary.notes.push(card.label + ': probes not run'); }
    if (showIds.length === count && count > 0) { summary.notes.push(card.label + ': ALL show — подозрительно (checkEnabled?)'); }
  }

  // 7) сводка
  console.log('');
  console.log('='.repeat(80));
  console.log('VERDICT: ' + (summary.pass ? 'PASS' : 'FAIL'));
  console.log('  GATE checks (OLD=show && OLDv>0 → prod show): ' + summary.gates);
  console.log('  filmix always show: ' + summary.filmixChecks + '/' + summary.filmixChecks + ' (недоступно=0)');
  console.log('  REVEAL visible: ' + summary.revealsOk + '/' + summary.revealsChecked);
  console.log('  playback resolved: ' + summary.playback);
  if (summary.notes.length) console.log('  notes: ' + summary.notes.join('; '));
}

verify().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });
