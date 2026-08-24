// TASK-SOURCES-005 live-probe: zetflixdb/zagonka/xvideocdnultra/kinotochka.
// Запускать на VPS: MANIYA_SERVER=/opt/maniya-online/server node /tmp/probe-balancers.mjs
// Использует продакшен-конфиг (.env: SKAZ_* / EO_* creds) и родной SkazClient.
import { pathToFileURL } from 'node:url';

const serverDir = String(process.env.MANIYA_SERVER || '').replace(/[\\/]+$/, '');
if (!serverDir) throw new Error('MANIYA_SERVER обязателен (путь к server/)');

const { config } = await import(pathToFileURL(serverDir + '/src/config.js'));
const { SkazClient } = await import(pathToFileURL(serverDir + '/src/providers/skaz/SkazClient.js'));

const BALANCERS = ['zetflixdb', 'zagonka', 'xvideocdnultra', 'kinotochka'];

const MOVIES = [
  { id: '284647', imdb_id: 'tt0816692', kinopoisk_id: '437410', title: 'Интерстеллар', original_title: 'Interstellar', year: '2014' },
  { id: '329', imdb_id: 'tt0133093', kinopoisk_id: '301', title: 'Матрица', original_title: 'The Matrix', year: '1999' }
];

const accountEmail = config.skaz.accountEmail || '';
const uid = config.skaz.uid || '';
console.log(`account: ${accountEmail ? 'SET' : 'EMPTY'} uid: ${uid ? 'SET' : 'EMPTY'} hosts: ${config.skaz.hosts.length}`);

const results = [];
for (const balancer of BALANCERS) {
  const client = new SkazClient({
    balancer,
    hosts: config.skaz.hosts,
    accountEmail,
    uid,
    origin: config.skaz.origin,
    timeoutMs: 15_000
  });
  const row = { balancer, perMovie: {} };
  for (const m of MOVIES) {
    const html = await client.getLite({
      id: m.id,
      imdb_id: m.imdb_id,
      kinopoisk_id: m.kinopoisk_id,
      title: m.title,
      original_title: m.original_title,
      serial: '0',
      year: m.year
    });
    const usable = Boolean(html);
    const preview = usable ? String(html).slice(0, 160).replace(/\s+/g, ' ').trim() : '';
    row.perMovie[m.title] = usable ? `usable(${preview.length > 100 ? preview.slice(0, 100) + '…' : preview})` : 'EMPTY/null';
  }
  results.push(row);
  console.log(JSON.stringify(row));
}

const allUsable = results.every((r) => Object.values(r.perMovie).every((v) => v.startsWith('usable')));
console.log(allUsable ? 'RESULT: ALL-USABLE' : 'RESULT: PARTIAL');