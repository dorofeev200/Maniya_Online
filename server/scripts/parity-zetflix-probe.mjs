// Parity-009 probe v4: xvideocdnultra deep + candidate slugs.
// Run on VPS: cd /opt/maniya-online/server && node --env-file=.env scripts/parity-zetflix-probe.mjs
import { config } from '../src/config.js';
import { SkazClient } from '../src/providers/skaz/SkazClient.js';

const hosts = config.skaz.hosts;
const { accountEmail, uid, origin } = config.skaz;

const BALS = ['xvideocdnultra', 'vcdn', 'videocdn', 'xvideocdn', 'xvideocdn60fps', 'zetflixdb'];

const SHAPES = {
  interd: { id: '284647', kinopoisk_id: '437410', title: 'Интерстеллар', original_title: 'Interstellar', serial: '0', year: '2014' },
  intertmdb: { id: '157336', imdb_id: 'tt0816692', tmdb_id: '157336', kinopoisk_id: '437410', title: 'Интерстеллар', original_title: 'Interstellar', serial: '0', year: '2014' },
  matrix: { id: '603', imdb_id: 'tt0133093', tmdb_id: '603', kinopoisk_id: '301', title: 'Матрица', original_title: 'The Matrix', serial: '0', year: '1999' }
};

for (const bal of BALS) {
  const client = new SkazClient({ balancer: bal, hosts, accountEmail, uid, origin, timeoutMs: 12_000 });
  for (const [name, q] of Object.entries(SHAPES)) {
    const html = await client.getLite(q);
    console.log(`${bal.padEnd(15)} ${name.padEnd(10)} -> ${html ? `len=${String(html.length).padEnd(6)} data-json=${(html.match(/data-json/g)||[]).length}` : 'NULL'} scan=noResponse:${client.lastScan?.noResponse}`);
  }
}
const client = new SkazClient({ balancer: 'xvideocdnultra', hosts, accountEmail, uid, origin });
const html = await client.getLite(SHAPES.interd);
console.log('\n=== xvideocdnultra interd HTML ===');
if (html) console.log(html.slice(0, 1200));