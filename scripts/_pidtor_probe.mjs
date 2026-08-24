// PIDTOR-DEEPLINK-001: локальная проба кластера для pidtor-only.
// Цель — подтвердить: дескриптор = magnet/torrent-only, HTTP/HLS/MP4 target за линками НЕТ.
// Creds из env (SKAZ_ACCOUNT_EMAIL/SKAZ_UID/SKAZ_ORIGIN) — НЕ хардкодятся.
import { pathToFileURL } from 'node:url';
const SKAZ_DIR = process.env.SKAZ_DIR || 'C:/Users/Admin/Maniya_Online/server/src';
const accountEmail = process.env.SKAZ_ACCOUNT_EMAIL || '';
const uid = process.env.SKAZ_UID || '';
const origin = process.env.SKAZ_ORIGIN || 'http://lampa.mx';

const { SkazClient } = await import(pathToFileURL(`${SKAZ_DIR}/providers/skaz/SkazClient.js`));
const { SkazNormalizer } = await import(pathToFileURL(`${SKAZ_DIR}/providers/skaz/SkazNormalizer.js`));

const HOSTS = ['http://online3.skaz.tv', 'http://online8.skaz.tv', 'http://94.249.239.63', 'http://94.249.239.37', 'http://94.249.239.11', 'http://77.90.33.109'];

function sampleLine(u, n = 130) { return String(u || '').slice(0, n); }
async function httpProbe(url, timeout = 15000) {
  try { const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(timeout) }); return { status: r.status, ct: (r.headers.get('content-type') || '').split(';')[0] }; }
  catch (e) { try { const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeout) }); const b = Buffer.from(await r.arrayBuffer()); return { status: r.status, ct: (r.headers.get('content-type') || '').split(';')[0], bytes: b.length, head: b.slice(0, 24).toString('latin1') }; } catch (e2) { return { status: 'ERR', ct: '', err: String(e2.message || e2).slice(0, 50) }; } }
}

const QUERIES = {
  pidtor: [
    ['Дюна: Часть вторая', 'Dune: Part Two', '2024', '693134', 'tt15239678', '4670204', '0'],
    ['Последний дом', 'The Last House on the Left', '2009', '10354', 'tt0089666', '50022', '0'],
    ['Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682', '0']
  ]
};

const client = new SkazClient({ balancer: 'pidtor', hosts: HOSTS, accountEmail, uid, origin, timeoutMs: 12000 });
const normalizer = new SkazNormalizer();

let magnets = 0, httpTargets = 0, accsdb = 0, followResult = [];
console.log(`env: email_len=${accountEmail.length} uid_len=${uid.length}\n`);

for (const [title, ot, year, id, imdb, kp] of QUERIES.pidtor) {
  const params = { title, original_title: ot, year, serial: 0, id, imdb_id: imdb, kinopoisk_id: kp, source: 'tmdb' };
  try {
    const html = await client.getLite(params, {});
    const cards = normalizer.cards(html || '');
    const counts = { play: 0, call: 0, link: 0, other: 0, magnet: 0, litesuffix: 0, httpTorrent: 0 };
    const samples = [];
    for (const c of cards || []) {
      const u = String(c.url || c.stream || '').trim();
      const isMag = /^magnet:/i.test(u);
      const isLiteSuffix = (() => { try { return /\/lite\/[^/]+\/s[0-9a-f]{16,}$/i.test(new URL(u).pathname); } catch { return false; } })();
      if (isMag) counts.magnet++;
      if (isLiteSuffix) counts.litesuffix++;
      if (c.method === 'play') counts.play++;
      else if (c.method === 'call') counts.call++;
      else if (c.method === 'link') counts.link++;
      else counts.other++;
      if (samples.length < 3) samples.push([c.method, u.slice(0, 140), isMag ? 'MAGNET' : (isLiteSuffix ? 'LITE-SUFFIX' : '')]);
    }
    console.log(`pidtor|${title}|${year}|html=${String(html).length}|play=${counts.play} call=${counts.call} link=${counts.link} magnet=${counts.magnet} lite-suffix=${counts.litesuffix}`);
    for (const s of samples) console.log(`  · ${s[0]} ${s[1]} [${s[2]}]`);
    // Если магнитных карточек много — пробуем HTTP-пробу на НЕ-магнитных play url (если есть).
    for (const c of cards || []) {
      const u = String(c.url || c.stream || '').trim();
      if (c.method !== 'play' || !u || /^magnet:/i.test(u)) continue;
      const p = await httpProbe(u);
      console.log(`  HTTP-probe play url: ${u.slice(0, 90)} → ${p.status} ${p.ct}${p.bytes ? ` ${p.bytes}B»${p.head}` : ''}`);
      if (p.status >= 200 && p.status < 300 && !/^magnet:/.test(u)) httpTargets++;
    }
  } catch (e) {
    console.log(`pidtor|${title}|ERR ${e.message.slice(0, 80)}`);
  }
}
console.log(`\nмагнитов: ${magnets} (считается в cards), HTTP-таргетов за play: ${httpTargets}`);
console.log('DONE');