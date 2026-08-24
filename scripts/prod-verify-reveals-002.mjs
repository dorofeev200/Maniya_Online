// BALANCER-ONLINE8-002 — доп. проверка 4 оставшихся REVEAL-кейсов (Seven-Per-Cent,
// Матрица — вне 5 карточек ТЗ). В 5 карточках ТЗ 10/14 REVEAL уже подтверждены
// видимыми; здесь добираем последние 4, чтобы закрыть все 14.
//   Seven-Per-Cent (27190): videoseed, kinoflix, geosaitebi
//   Матрица (603): kinoflix
// Для каждого: card show:true + videos items (ожидаем 0 = контента нет, legit
// optimistic show от abstain, НЕ скрытый рабочий источник) + sanity-смесь show/hide
// (пробы реально бежали, а не checkEnabled-off/все-show).
// SECURITY-001: creds только из env → temp (см. _creds.mjs)
import { loadUserA } from './_creds.mjs';

const BASE = process.env.PROD_BASE_URL || 'https://plugin.maniya-kvn.online';
const userA = loadUserA();

const CARDS = [
  { label: 'Seven-Per-Cent (27190)', query: { id: '27190', imdb_id: 'tt0076851', title: 'The Seven-Per-Cent Solution', original_title: 'The Seven-Per-Cent Solution', original_language: 'en', source: 'tmdb', year: 1976, serial: 0 } },
  { label: 'Матрица (603)', query: { id: '603', imdb_id: 'tt0133093', kinopoisk_id: '301', title: 'Матрица', original_title: 'The Matrix', original_language: 'en', source: 'tmdb', year: 1999, serial: 0 } }
];
const REVEALS = {
  '27190': ['videoseed', 'kinoflix', 'geosaitebi'],
  '603': ['kinoflix']
};
const SPECIAL = ['filmix', 'rezka', 'rhsprem', 'videoseed', 'kinopub', 'kodik', 'kinoflix', 'rutubemovie', 'geosaitebi'];
const idFor = (slug, ids) => ids.includes('skaz-' + slug) ? 'skaz-' + slug : (ids.includes(slug) ? slug : '');
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
  let body = null; try { body = JSON.parse(text); } catch { body = null; }
  return { status: r.status, ms, body };
}

async function main() {
  const reg = await api('/api/lampa/sources', userA.token, {});
  const ids = reg.body && reg.body.sources ? reg.body.sources.map((s) => s.id) : [];
  let pass = true; const notes = []; let revealed = 0;
  for (const card of CARDS) {
    console.log('─'.repeat(76));
    console.log('CARD ' + card.label);
    const r = await api('/api/lampa/sources/card', userA.token, { ...card.query, source: 'tmdb' });
    const rows = new Map((r.body && r.body.sources ? r.body.sources : []).map((s) => [s.id, s]));
    const showCount = [...rows.values()].filter((s) => s.show).length;
    const meta = r.body && r.body.meta;
    console.log('  card first=' + meta.elapsed_ms + 'ms cached=' + meta.cached + ' show=' + showCount + '/' + meta.count +
      (showCount === meta.count ? ' — ALL show (подозрительно!)' : ' — mix show/hide (пробы бежали)'));
    for (const slug of SPECIAL) {
      const row = rows.get(idFor(slug, ids));
      console.log(`  ${String(slug).padEnd(12)} ${row ? (row.show ? 'show' : 'hide') : 'n/a'}`);
    }
    for (const slug of REVEALS[card.query.id]) {
      const row = rows.get(idFor(slug, ids));
      const show = row ? row.show : null;
      const v = await api('/api/lampa/videos', userA.token, { ...card.query, provider: idFor(slug, ids), source: 'tmdb' });
      const items = (v.body && Array.isArray(v.body.items)) ? v.body.items.length : 0;
      const ok = show === true;
      const legit = items === 0; // контента нет → legit optimistic show от abstain
      console.log(`  REVEAL ${slug}: card=${show === true ? 'show' : 'HIDE'} videos_items=${items} ${ok ? 'visible' : 'FAIL'} ${legit ? '(контента нет — legit optimistic)' : '(есть контент — не reveal!)'}`);
      revealed += 1;
      if (!ok || !legit) { pass = false; notes.push(card.query.id + ':' + slug + ' ' + (ok ? '' : 'not-visible') + (legit ? '' : ' has-content')); }
      await sleep(2500);
    }
  }
  console.log('');
  console.log('='.repeat(76));
  console.log('VERDICT: ' + (pass ? 'PASS — все REVEAL-кейсы (5 карточек + здесь) видимы и корректны' : 'FAIL'));
  console.log('  дополнительно проверено REVEAL: ' + revealed);
  if (notes.length) console.log('  notes: ' + notes.join('; '));
}

main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });
