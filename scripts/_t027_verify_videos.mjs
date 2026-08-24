// T027 P3: playback regression check on PROD после деплоя T021.
// Проверяет /api/lampa/videos для: kinopub (первый по модели, зарегистрирован),
// эфемерный skaz-lordfilm (вне реестра — резолв через skazProviderFor, новая
// ветка T021), native filmix/collaps/kodik (не тронуты T021), serial kinopub.
import { writeFileSync, mkdirSync } from 'node:fs';

const TOKEN = process.env.T027_TOKEN || 'mo-admin-test-2026';
const BASE = process.env.T027_BASE || 'http://127.0.0.1:3000';

const MOVIE = { id: '1288445', imdb_id: 'tt32338669', kinopoisk_id: '1288445', title: 'Мятеж', original_title: 'Mutiny', serial: '0', year: '2026', source: 'tmdb' };
const SERIAL = { id: '94997', imdb_id: 'tt11198330', kinopoisk_id: '411406', title: 'Дом Дракона', original_title: 'House of the Dragon', serial: '1', year: '2022', source: 'tmdb' };

const CASES = [
  { key: 'kinopub-movie',       provider: 'skaz-kinopub',  q: MOVIE },
  { key: 'lordfilm-ephemeral',  provider: 'skaz-lordfilm', q: MOVIE },
  { key: 'ashdi-rch',           provider: 'skaz-ashdi',    q: MOVIE },
  { key: 'filmix-native',       provider: 'filmix',        q: MOVIE },
  { key: 'collaps-native',      provider: 'collaps',       q: MOVIE },
  { key: 'kodik-native',        provider: 'kodik',         q: MOVIE },
  { key: 'kinopub-serial',      provider: 'skaz-kinopub',  q: SERIAL }
];

mkdirSync('docs/t027', { recursive: true });
const out = { ts: new Date().toISOString(), cases: [] };

for (const c of CASES) {
  const q = new URLSearchParams({ token: TOKEN, provider: c.provider, ...c.q });
  const t0 = Date.now();
  let res; let ms;
  try {
    res = await fetch(`${BASE}/api/lampa/videos?${q.toString()}`, { signal: AbortSignal.timeout(25000) });
    ms = Date.now() - t0;
  } catch (e) {
    out.cases.push({ key: c.key, provider: c.provider, http: 0, ms: Date.now() - t0, error: String(e).slice(0, 120) });
    continue;
  }
  const body = await res.json().catch(() => null);
  const items = Array.isArray(body?.items) ? body.items : [];
  const rec = {
    key: c.key,
    provider: c.provider,
    http: res.status,
    ms,
    count: items.length,
    seasons: body?.seasons,
    voices: body?.voices,
    first: items[0] ? { method: items[0].method, type: items[0].type, title: String(items[0].title || '').slice(0, 60), urlOk: /^https?:/.test(String(items[0].url || '')) } : null
  };
  out.cases.push(rec);
  console.log(`${c.key.padEnd(18)} HTTP=${res.status} ${ms}ms items=${items.length} seasons=${rec.seasons} voices=${rec.voices} first=${items[0] ? `${items[0].method}/${items[0].type} url=${rec.first.urlOk}` : '∅'}`);
}

writeFileSync(process.env.T027_OUT || 'docs/t027/p3-playback.json', JSON.stringify(out, null, 2), 'utf8');
console.log('\n→ saved');