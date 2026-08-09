// Сравнение клиентов: EoClient (текущий, рабочий live) vs SkazClient (новый, 1:1-порт)
// на одном и том же тайтле (Интерстеллар) и дискавери. Доказывает, что SkazClient
// даёт те же карточки/резолвы, что EoClient — перед свичем registry на `skaz-*`.
//
// Запуск на VPS (где server/.env с реальными кредами):
//   cd /opt/maniya-online/server && NODE_ENV=production node ../scripts/e2e-skaz-vs-eo.mjs
//
// Секреты НЕ печатаются (len только). Результат — стобцы Eo vs Skaz по каждомy
// балансеру: status/cards/methods/первый item, и для call — резолв потока.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = (await import(path.join(here, '..', 'server', 'src', 'config.js'))).config;
const { EoClient } = await import(path.join(here, '..', 'server', 'src', 'providers', 'eonline', 'EoClient.js'));
const { SkazClient } = await import(path.join(here, '..', 'server', 'src', 'providers', 'skaz', 'SkazClient.js'));

const MOVIES = [
  { id: '284647', imdb_id: 'tt0816692', kinopoisk_id: '437410', title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0' },
  { id: '329', imdb_id: 'tt0133093', kinopoisk_id: '301', title: 'Матрица', original_title: 'The Matrix', year: '1999', serial: '0' }
];
const serial = { id: '1399', imdb_id: 'tt0944947', kinopoisk_id: '79322', title: 'Игра престолов', original_title: 'Game of Thrones', serial: '1' };
const BALANCERS = ['filmix', 'alloha', 'rezka', 'videoseed', 'kinoflix', 'veoveo', 'pidtor', 'solntse'];

const accountEmail = config.eonline.accountEmail;
const uid = config.eonline.uid;
const origin = config.eonline.origin;

function eoClient(slug) {
  return new EoClient({ balancer: slug, hosts: config.eonline.hosts, skazHosts: config.eonline.skazHosts, accountEmail, uid, origin });
}
function skazClient(slug) {
  return new SkazClient({ balancer: slug, hosts: config.eonline.hosts, accountEmail, uid, origin });
}

const pageParams = (movie) => ({ ...movie, source: 'tmdb' });
const cardsIn = (text) => (String(text || '').match(/data-json\s*=/g) || []).length;

async function probeLite(client, params) {
  const url = client.buildLiteUrl(params);
  try {
    const r = await fetch(url, { headers: { accept: '*/*', Origin: origin }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const text = await r.text().catch(() => '');
    return { status: r.status, text };
  } catch (e) {
    return { status: 0, text: 'ERR ' + String(e?.message).slice(0, 24) };
  }
}

function firstMethod(text) {
  const m = String(text || '').match(/data-json\s*=\s*(['"])([\s\S]*?)\1/);
  if (!m) return '';
  try { const j = JSON.parse(m[2]); return String(j.method || j.translate || '').slice(0, 24); } catch { return ''; }
}

async function resolvePlay(client, method, urlRef) {
  if (method !== 'call' || !urlRef) return '-';
  try {
    const final = await client.resolveStream(urlRef);
    if (!final) return 'RESOLVE-null';
    const r = await fetch(final, { headers: { Origin: 'http://lampa.mx', accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const ct = String(r.headers.get('content-type') || '').toLowerCase();
    if (r.status === 200 && (/mpegurl|mpd|video\/|mp4|mpeg/.test(ct))) return 'OK:' + ct.split('/').pop();
    const body = await r.text().catch(() => '');
    if (r.status === 200 && (body.startsWith('#EXTM3U') || body.includes('#EXT-X-STREAM-INF'))) return 'OK:hls';
    return 'HTTP' + r.status + ':' + ct.split('/').pop();
  } catch (e) {
    return 'ERR:' + String(e?.message).slice(0, 22);
  }
}

async function comparePage(label, params, slug) {
  const eo = await probeLite(eoClient(slug), params);
  const sk = await probeLite(skazClient(slug), params);
  const eoCards = eo.status === 200 ? cardsIn(eo.text) : 0;
  const skCards = sk.status === 200 ? cardsIn(sk.text) : 0;
  const same = eo.status === sk.status && eoCards === skCards;
  const eoMethod = firstMethod(eo.text);
  const skMethod = firstMethod(sk.text);
  const match = same && eoMethod === skMethod ? '✓' : '✗';
  console.log(`${match} ${label.padEnd(36)} Eo:${String(eo.status).padEnd(4)}cards=${String(eoCards).padEnd(3)}${eoMethod.padEnd(22)} || Sk:${String(sk.status).padEnd(4)}cards=${String(skCards).padEnd(3)}${skMethod.padEnd(22)}`);
  if (same && eoCards) {
    // резолв первого call-потока через оба клиента (инстансы, не строки!)
    const m = String(eo.text).match(/data-json\s*=\s*(['"])([\s\S]*?)\1/);
    let j = null; try { j = JSON.parse(m[2]); } catch {}
    const ref = j && j.method === 'call' ? String(j.stream || j.url || '') : '';
    if (ref) {
      const ee = await resolvePlay(eoClient(slug), 'call', ref);
      const ss = await resolvePlay(skazClient(slug), 'call', ref);
      console.log(`     └─ resolve call: Eo=${ee}  Sk=${ss}`);
    }
  }
  return { eo, sk };
}

async function compareDiscovery() {
  console.log('\n== DISCOVERY: Eo(нет discover) vs Sk(discover) — только Sk ==');
  const sk = skazClient('filmix');
  const list = await sk.discover();
  console.log('SkazClient.discover() → ' + (list ? list.slice(0, 24).join(',') + ' (…' + list.length + ')' : 'null'));
}

async function main() {
  console.log('== PARAMS == email_len=' + accountEmail.length + ' uid_len=' + uid.length);
  console.log('SKAZ_HOSTS=' + config.eonline.hosts.join(','));

  for (const movie of MOVIES) {
    console.log(`\n== МОВИ ${movie.title} ==`);
    for (const slug of BALANCERS) {
      await comparePage(`${slug.padEnd(10)} ${movie.title.padEnd(12)}`, pageParams(movie), slug);
    }
  }

  console.log('\n== СЕРИАЛ Game of Thrones ==');
  for (const slug of BALANCERS.slice(0, 4)) {
    await comparePage(`${slug.padEnd(10)} GoT`, pageParams(serial), slug);
  }

  await compareDiscovery();
}

main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });