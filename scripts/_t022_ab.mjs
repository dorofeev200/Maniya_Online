// TASK-SKAZ-MANIYA-022 PHASE-2 PREP — диагностический A/B «SKAZ (первая нода) vs Shadow T021».
// Сравнивает то, что реально отдают оба плагина: SKAZ отдаёт кластерный online[]
// (первый валидный онлайн из его пула), Maniya Shadow отдаёт per-title модель
// sourceModel (клиентская модель-ветка). Задача — НЕ повторить T021, а зафиксировать
// расхождения, которые потенциально видны на экране TV, чтобы Phase 2 (ручное
// сравнение) имела серверную опору и точную таблицу ожиданий.
// Запуск: node scripts/_t022_ab.mjs   (из корня или server/; config читает server/.env)
import { writeFileSync, mkdirSync } from 'node:fs';

const { config } = await import('../server/src/config.js');
const { SkazClient } = await import('../server/src/providers/skaz/SkazClient.js');
const { createSourceModel } = await import('../server/src/sources/sourceModel.js');

const OUTDIR = 'docs/t022';
mkdirSync(OUTDIR, { recursive: true });

const EMAIL = String(config.skaz?.accountEmail || '').trim();
const UID = String(config.skaz?.uid || '').trim();
const HOSTS = Array.isArray(config.skaz?.hosts) ? config.skaz.hosts : [];
if (!HOSTS.length) throw new Error('config.skaz.hosts пуст');

const TITLES = [
  { key: 'mutiny',    id: '1288445', imdb_id: 'tt32338669', kinopoisk_id: '1288445', title: 'Мятеж',            original_title: 'Mutiny',        serial: '0', year: '2026' },
  { key: 'toystory5', id: '1084244', imdb_id: 'tt29355505', kinopoisk_id: '1084244', title: 'История игрушек 5', original_title: 'Toy Story 5',   serial: '0', year: '2026' },
  { key: 'interst',   id: '157372',  imdb_id: 'tt0816692',  kinopoisk_id: '258687',  title: 'Интерстеллар',      original_title: 'Interstellar',  serial: '0', year: '2014' },
  { key: 'drake',     id: '94997',   imdb_id: '',           kinopoisk_id: '',        title: 'Дом Дракона',       original_title: 'House of the Dragon', serial: '1', year: '2022' }
];

// 1) SKAZ: первый валидный online[] в пуле (как это видит SkazClient.getOnline —
//    т.е. РОВНО то, что отдаёт SKAZ-плагин на экран).
const skazClient = new SkazClient({ hosts: HOSTS, accountEmail: EMAIL, uid: UID, origin: config.skaz?.origin, timeoutMs: config.skaz?.checkTimeoutMs });

// 2) Maniya Shadow T021: та же модель (sourceModel card → client-facing items).
const model = createSourceModel({ client: skazClient });

function shapeRows(items) {
  return (items || []).map((x) => ({
    id: x.id ?? null,
    name: x.name ?? null,
    index: x.index ?? null,
    show: x.show === true,
    ghost: x.ghost === true,
    rch: x.rch === true,
    voices: x.voices ?? null,
    seasons: x.seasons ?? null,
    quality_label: x.quality_label ?? null,
    icon: x.icon ?? null
  }));
}

function printCard(t, label, items, extra = {}) {
  const rows = shapeRows(items);
  const shown = rows.filter((r) => r.show);
  const ghost = rows.filter((r) => r.ghost);
  console.log(`\n=== ${t.key} [${label}] m=${extra.model ?? '—'} cached=${extra.cached ?? '—'} ms=${extra.ms ?? '—'} ===`);
  console.log(`  total=${rows.length} shown=${shown.length} ghost=${ghost.length} first=${shown[0]?.name ?? '—'}`);
  console.log(`  shown: ${shown.map((r) => `#${r.index} ${r.name}${r.rch ? ' [rch]' : ''} v${r.voices}/s${r.seasons}`).join(' | ')}`);
  console.log(`  ghost: ${ghost.map((r) => `#${r.index} ${r.name}${r.rch ? ' [rch]' : ''}`).join(' | ')}`);
  return { label, total: rows.length, shown: shown.length, ghost: ghost.length, first: shown[0]?.name ?? null, rows, extra };
}

const all = {};
for (const t of TITLES) {
  const params = {
    id: t.id, imdb_id: t.imdb_id, kinopoisk_id: t.kinopoisk_id,
    title: t.title, original_title: t.original_title,
    serial: t.serial, year: t.year, source: 'tmdb',
    account_email: EMAIL, uid: UID
  };
  const skazOnline = await skazClient.getOnline({ ...params }, {});
  const card = await model.card({ id: t.id, imdb_id: t.imdb_id, kinopoisk_id: t.kinopoisk_id, title: t.title, original_title: t.original_title, serial: t.serial, year: t.year, source: 'tmdb' }, UID);

  const skaz = printCard(t, 'SKAZ cluster', skazOnline);
  const maniya = printCard(t, 'Maniya Shadow T021', card?.items, { model: true, cached: card?.cached, ms: card?.elapsedMs });

  // SKAZ-сырьё не несёт ghost — деривируем ghost = !show (то же, что buildModel).
  for (const r of skaz.rows) r.ghost = !r.show;
  // Дифф: названия/индексы/порядок/атрибуты (ghost не сравниваем — производное show).
  const byName = new Map();
  for (const r of skaz.rows) byName.set(r.name, r);
  const diffs = [];
  const namesSkaz = skaz.rows.map((r) => r.name);
  const namesManiya = maniya.rows.map((r) => r.name);
  // порядок shown: учитываем только ядро (extras Maniya в хвосте, index=null)
  const orderSkaz = skaz.rows.filter((r) => r.show).map((r) => r.name);
  const orderManiya = maniya.rows.filter((r) => r.show).map((r) => r.name);
  const coreManiya = maniya.rows.filter((r) => r.show && r.index !== null).map((r) => r.name);
  if (JSON.stringify(orderSkaz) !== JSON.stringify(coreManiya)) diffs.push(`order-shown-core: SKAZ[${orderSkaz.join('>')}] vs M-core[${coreManiya.join('>')}]`);
  if (JSON.stringify(orderManiya) !== JSON.stringify(orderSkaz)) diffs.push(`order-shown(+extras): M[${orderManiya.join('>')}]`);
  // присутствие/отсутствие в ядре
  for (const n of namesSkaz) if (!namesManiya.includes(n)) diffs.push(`MISSING in M: ${n}`);
  for (const n of namesManiya) if (!namesSkaz.includes(n)) diffs.push(`EXTRA in M: ${n}`);
  // сопоставление атрибутов по общим именам
  for (const r of maniya.rows) {
    const s = byName.get(r.name);
    if (!s) continue;
    for (const f of ['index', 'show', 'rch', 'voices', 'seasons']) {
      const a = s[f], b = r[f];
      if (a !== b) diffs.push(`attr ${f} '${r.name}': SKAZ=${a} vs M=${b}`);
    }
  }

  all[t.key] = { skaz, maniya, diffs };
  writeFileSync(`${OUTDIR}/ab2-${t.key}.json`, JSON.stringify({ card: t, skaz, maniya, diffs }, null, 2), 'utf8');
  if (diffs.length) {
    console.log(`  DIFFS: ${diffs.length}`);
    for (const d of diffs.slice(0, 12)) console.log(`    - ${d}`);
  } else console.log('  DIFFS: 0');
}
writeFileSync(`${OUTDIR}/ab2-all.json`, JSON.stringify(all, null, 2), 'utf8');
console.log('\ndone → docs/t022/{ab2-*, ab2-all}.json');