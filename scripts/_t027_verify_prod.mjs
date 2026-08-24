// T027 P2: server-side verify PROD после деплоя T021 (минимальный, read-only).
// Проверяет 4 карточки ("Мятеж", "История игрушек 5", "Интерстеллар", "Дом Дракона"):
//  - GET /api/lampa/sources (статический реестр — НЕ должен измениться, 21+ entries, no model)
//  - GET /api/lampa/sources/card → meta.model === true (per-title модель), items count/порядок/
//    ghost/KinoPub-first/voices/seasons/rch поля. При недоступности кластера — probe-fallback.
import { writeFileSync, mkdirSync } from 'node:fs';

const TOKEN = process.env.T027_TOKEN || 'mo-admin-test-2026';
const BASE = process.env.T027_BASE || 'https://plugin.maniya-kvn.online';

const CARDS = [
  { key: 'mutiny',    id: '1288445', imdb_id: 'tt32338669', kinopoisk_id: '1288445', title: 'Мятеж',              original_title: 'Mutiny',               serial: '0', year: '2026', source: 'tmdb' },
  { key: 'toystory5', id: '1084244', imdb_id: 'tt29355505', kinopoisk_id: '1084244', title: 'История игрушек 5',  original_title: 'Toy Story 5',           serial: '0', year: '2026', source: 'tmdb' },
  { key: 'interst',   id: '157372',  imdb_id: 'tt0816692',  kinopoisk_id: '258687',  title: 'Интерстеллар',      original_title: 'Interstellar',          serial: '0', year: '2014', source: 'tmdb' },
  { key: 'hod',       id: '94997',   imdb_id: 'tt11198330', kinopoisk_id: '411406',  title: 'Дом Дракона',        original_title: 'House of the Dragon',   serial: '1', year: '2022', source: 'tmdb' }
];

mkdirSync('docs/t027', { recursive: true });
const out = { ts: new Date().toISOString(), base: BASE, cards: [] };

// статический реестр (один запрос)
const staticRes = await fetch(`${BASE}/api/lampa/sources?token=${TOKEN}`);
out.staticSources = await staticRes.json().catch(() => null);

for (const card of CARDS) {
  const q = new URLSearchParams({ token: TOKEN, ...card });
  const t0 = Date.now();
  let res; let ms;
  try {
    res = await fetch(`${BASE}/api/lampa/sources/card?${q.toString()}`, { signal: AbortSignal.timeout(30000) });
    ms = Date.now() - t0;
  } catch (e) {
    out.cards.push({ key: card.key, title: card.title, http: 0, ms: Date.now() - t0, error: String(e).slice(0, 120) });
    continue;
  }
  const body = await res.json().catch(() => null);
  const rec = {
    key: card.key,
    title: card.title,
    http: res.status,
    ms,
    meta: body?.meta || null
  };
  if (Array.isArray(body?.sources)) {
    rec.model = body.meta?.model === true;
    rec.count = body.sources.length;
    rec.shown = body.sources.filter((s) => s.show === true).length;
    rec.hidden = body.sources.filter((s) => s.show !== true).length;
    rec.first = body.sources[0] ? { id: body.sources[0].id, name: body.sources[0].name, index: body.sources[0].index, show: body.sources[0].show } : null;
    rec.firstShown = body.sources.find((s) => s.show === true)?.id ?? null;
    rec.kinopubFirst = rec.firstShown === 'kinopub';
    rec.rch = body.sources.filter((s) => s.rch).map((s) => s.id);
    rec.sources = body.sources.map((s) => ({
      id: s.id, name: s.name, index: s.index, show: s.show,
      ghost: s.ghost ?? (s.show !== true),
      rch: !!s.rch, voices: s.voices, seasons: s.seasons,
      hasApiUrl: !!s.api_url, hasUrl: !!s.url
    }));
  } else {
    rec.model = false;
    rec.shape = body; // fallback probe-path или ошибка
  }
  out.cards.push(rec);
  // маленькая пауза между карточками, не бурстим
  await new Promise((r) => setTimeout(r, 500));
}

writeFileSync(process.env.T027_OUT || 'docs/t027/p2-server-verify.json', JSON.stringify(out, null, 2), 'utf8');

// console summary
for (const c of out.cards) {
  console.log(`\n=== ${c.title} (${c.key}) HTTP=${c.http} ${c.ms}ms model=${c.model} ===`);
  if (c.model && c.sources) {
    console.log(`  count=${c.count} shown=${c.shown} hidden=${c.hidden} kinopubFirst=${c.kinopubFirst} firstShown=${c.firstShown || '-'} rch=${JSON.stringify(c.rch) || '[]'}`);
    console.log(`  first=${JSON.stringify(c.first)}`);
    const names = c.sources.map((s) => `${s.show ? '' : '✗'}${s.name}@${s.index}${s.rch ? '[rch]' : ''}`).join('; ');
    console.log(`  sources: ${names}`);
  } else {
    console.log(`  NOT MODEL: ${JSON.stringify(c.shape).slice(0, 300)}`);
  }
}
console.log(`\nstatic /sources count = ${out.staticSources?.sources?.length ?? '?'}`);
console.log(`\n→ docs/t027/p2-server-verify.json`);