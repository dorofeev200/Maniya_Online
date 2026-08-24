// SKAZ-REMAINING-PROVIDERS-001: апстрим-проба кластера НА VPS (creds остаются на сервере).
// Запуск: node /tmp/_skaz_upstream_probe.mjs из /opt/maniya-online (или с issue: ENV=путь).
// Читает creds из /opt/maniya-online/server/.envx (задаётся ENV_FILE), импортирует
// ДЕПЛОЙНУТЫЙ SkazClient/SkazNormalizer и собирает карточки для каждого кандидата.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ENV_FILE = process.env.ENV_FILE || '/opt/maniya-online/server/.env';
const SKAZ_DIR = process.env.SKAZ_DIR || '/opt/maniya-online/server/src';
function envPairs(file) {
  const out = {};
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line);
      if (m) { let v = m[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); out[m[1]] = v; }
    }
  } catch (e) { console.error('env read error', e.message); }
  return out;
}
const env = envPairs(ENV_FILE);
const accountEmail = env.SKAZ_ACCOUNT_EMAIL || env.EO_ACCOUNT_EMAIL || '';
const uid = env.SKAZ_UID || env.EO_UID || '';
const origin = env.SKAZ_ORIGIN || env.EO_ORIGIN || 'http://lampa.mx';

const { SkazClient } = await import(pathToFileURL(`${SKAZ_DIR}/providers/skaz/SkazClient.js`));
const { SkazNormalizer } = await import(pathToFileURL(`${SKAZ_DIR}/providers/skaz/SkazNormalizer.js`));

const HOSTS = ['http://online3.skaz.tv', 'http://online8.skaz.tv', 'http://94.249.239.63', 'http://94.249.239.37', 'http://94.249.239.11', 'http://77.90.33.109'];

function classify(cards) {
  const c = { play: 0, call: 0, link: 0, torrent: 0, other: 0, samples: [] };
  for (const card of cards || []) {
    if (card.method === 'play') { c.play++; const u = String(card.url || ''); if (c.samples.length < 2) c.samples.push(['play', u.slice(0, 130), isTorrent(u)]); }
    else if (card.method === 'call') { c.call++; if (c.samples.length < 2) c.samples.push(['call', String(card.url || card.stream || '').slice(0, 130)]); }
    else if (card.method === 'link') { c.link++; if (c.samples.length < 2) c.samples.push(['link', String(card.url || '').slice(0, 130)]); }
    else c.other++;
  }
  for (const card of cards || []) if (card.method === 'play' && isTorrent(String(card.url || ''))) c.torrent++;
  return c;
}
function isTorrent(u) { const s = String(u || '').trim(); if (!s) return false; if (/^magnet:/i.test(s)) return true; try { const x = new URL(s); return /\/lite\/[^/]+\/s[0-9a-f]{16,}$/i.test(x.pathname); } catch { return false; } }
function sampleLink(cards) { for (const c of cards || []) if (c.method === 'link') return String(c.url || ''); return null; }

const QUERIES = {
  kinoflix: [['Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682']],
  solntse: [['Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204'], ['Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682']],
  videoseed: [['Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', 'serial:0'], ['Дом дракона', 'House of the Dragon', '2022', '94997', 'tt11198330', '0', 'serial:1']],
  geosaitebi: [['Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682']],
  pidtor: [['Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204'], ['Последний дом', 'The Last House on the Left', '2009', '10354', 'tt0089666', '50022']],
  rhsprem: [['Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682'], ['Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204']],
  zetflixdb: [['Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682']],
  zagonka: [['Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682']],
  xvideocdnultra: [['Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682']]
};

const out = [];
for (const [balancer, rows] of Object.entries(QUERIES)) {
  const client = new SkazClient({ balancer, hosts: HOSTS, accountEmail, uid, origin, timeoutMs: 12000 });
  const normalizer = new SkazNormalizer();
  for (const [title, ot, year, id, imdb, kp, maybeSerial] of rows) {
    const serial = maybeSerial === 'serial:1' ? 1 : 0;
    const params = { title, original_title: ot, year, serial, id, imdb_id: imdb, kinopoisk_id: kp, source: 'tmdb' };
    try {
      const html = await client.getLite(params, {});
      const cards = normalizer.cards(html || '');
      const s = classify(cards);
      const row = `${balancer}|${title}|${year}|serial=${serial}|html=${html ? String(html).length : 0}|play=${s.play} call=${s.call} link=${s.link} torrent=${s.torrent} accsdb=${client.lastAccsdb ? JSON.stringify(client.lastAccsdb.message || client.lastAccsdb) : ''} scan=${JSON.stringify(client.lastScan)}`;
      out.push(row);
      if (s.link > 0 && sampleLink(cards)) {
        const linkUrl = sampleLink(cards);
        try {
          const followHtml = await client.openLiteUrl(linkUrl, {});
          const f2 = classify(normalizer.cards(followHtml || ''));
          out.push(`  └ follow: play=${f2.play} call=${f2.call} link=${f2.link} torrent=${f2.torrent} accsdb=${client.lastAccsdb ? JSON.stringify(client.lastAccsdb.message || client.lastAccsdb) : ''}`);
        } catch (e) { out.push(`  └ follow ERR ${e.message.slice(0, 60)}`); }
      }
      for (const smp of s.samples) out.push(`  · ${smp[0]} ${smp[1]} torrent=${smp[2] ? 'Y' : 'n'}`);
    } catch (e) {
      out.push(`${balancer}|${title}|ERR ${e.message.slice(0, 80)}`);
    }
  }
}
console.log(`env: email_len=${accountEmail.length} uid_len=${uid.length}\n`);
for (const line of out) console.log(line);
console.log('\nDONE');