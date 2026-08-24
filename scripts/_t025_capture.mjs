// TASK-SKAZ-MANIYA-025 capture (READ-ONLY): live lite/events for 4 cards,
// extract concrete runtime-url strings for the target sources + HOD serial.
// Run: node scripts/_t025_capture.mjs   (from repo root; reads server config)
import { writeFileSync, mkdirSync } from 'node:fs';
const { config } = await import('../server/src/config.js');

// Reuse our own read-only skaz client (additive, no writes)
const { SkazClient } = await import('../server/src/providers/skaz/SkazClient.js');
const client = new SkazClient({
  hosts: config.skaz.hosts,
  accountEmail: config.skaz.accountEmail,
  uid: config.skaz.uid,
  origin: config.skaz.origin,
  timeoutMs: 8000,
  enabled: () => config.skaz.enabled !== false,
});
mkdirSync('docs/t025', { recursive: true });

const AB = (id, imdb, kp, title, orig, serial, year, key) =>
  ({ key, id, imdb_id: imdb, kinopoisk_id: kp, title, original_title: orig, serial, year, source: 'tmdb' });
const CARDS = [
  AB('1288445',  'tt32338669', '1288445', 'Мятеж',          'Mutiny',                '0', '2026', 'mutiny'),
  AB('1084244',  'tt29355505', '1084244', 'История игрушек 5', 'Toy Story 5',        '0', '2026', 'toystory5'),
  AB('157372',   'tt0816692',  '258687',  'Интерстеллар',   'Interstellar',          '0', '2014', 'interst'),
  AB('94997',    'tt11198330', '411406',  'Дом Дракона',    'House of the Dragon',   '1', '2022', 'hod-kp'),
  AB('411406',   'tt11198330', '411406',  'Дом Дракона',    'House of the Dragon',   '1', '2022', 'hod-id'),
];

const TARGETS = new Set(['kinopub', 'filmix', 'filmixtv', 'hdrezka', 'rezka', 'alloha', 'videoseed', 'veoveo', 'kinotochka', 'zetflixdb', 'lumex']);
const RED = (u) => u?.replace(/(account_email=)[^&]*/, '$1RED').replace(/(&uid=)[^&]*/, '$1RED');

const out = {};
for (const card of CARDS) {
  const group = card.key.split('-')[0];
  if (out[group]?.status === 'OK') continue; // для hod пробуем кандидатов, берём первого сработавшего
  const row = { card: { ...card }, status: 'NO_EVENTS' };
  try {
    const online = await client.getOnline(card, { timeoutMs: 9000 });
    if (Array.isArray(online) && online.length) {
      row.status = 'OK';
      row.total = online.length;
      row.shown = online.filter((o) => o.show === true).length;
      row.first = online[0];
      let sel = online.filter((o) => TARGETS.has(o.balanser) || o.rch === true);
      if (!sel.length) sel = online.slice(0, 5);
      row.selected = sel.map((o) => ({
        name: o.name, index: o.index, show: o.show, balanser: o.balanser,
        rch: o.rch, voices: o.voices, seasons: o.seasons,
        url: RED(o.url), hasIcon: Object.prototype.hasOwnProperty.call(o, 'icon'), hasId: Object.prototype.hasOwnProperty.call(o, 'id'),
        hasApiUrl: Object.prototype.hasOwnProperty.call(o, 'api_url'), hasQuality: Object.prototype.hasOwnProperty.call(o, 'quality'),
      }));
    }
  } catch (e) { row.status = `ERR: ${e.message}`; }
  out[group] = row;
}
writeFileSync('docs/t025/events-capture.json', JSON.stringify(out, null, 2), 'utf8');
for (const k of Object.keys(out)) {
  const r = out[k];
  console.log(`\n== ${k} == ${r.status}`);
  if (r.status !== 'OK') continue;
  console.log(`  total=${r.total} shown=${r.shown}`);
  console.log(`  first=${r.first?.name} [balanser=${r.first?.balanser}]`);
  for (const s of r.selected) console.log(`  · ${s.name} | idx=${s.index} show=${s.show} rch=${s.rch} v=${s.voices} s=${s.seasons} b=${s.balanser} [icon:${s.hasIcon} id:${s.hasId} api:${s.hasApiUrl} q:${s.hasQuality}] url=${s.url}`);
}
console.log('\n→ docs/t025/events-capture.json');