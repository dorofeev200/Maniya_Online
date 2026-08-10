/**
 * INVENTORY + GAP ANALYSIS — живой пробинг skaz-кластера (2026-08-10).
 *
 * Для КАЖДОГО слага:
 *   1. REST-пробинг поиска: GET {host}/lite/{slug}?... → статус/методы/карточки.
 *   2. Если источник живой и кандидат на добавление (geosaitebi и др.) —
 *      ПОЛНЫЙ E2E через существующий SkazProvider.videos() (фильм + сериал):
 *      search → карточки → follow/postid → play-дескриптор (quality/subtitles).
 *   3. Полученный play-URL пробируем первыми байтами (200/403/404/429).
 *
 * Креды — из локального бекап-снапшота backup/snapshots/<stamp>/.env
 * (SKAZ_ACCOUNT_EMAIL/SKAZ_UID), не печатаются. НЕ читают server/.env.
 *
 * Запуск:  node scripts/inventory-gap-probe.mjs [--stamp 20260810-163948]
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SkazClient } from '../server/src/providers/skaz/SkazClient.js';
import { SkazNormalizer } from '../server/src/providers/skaz/SkazNormalizer.js';
import { SkazProvider } from '../server/src/providers/skaz/SkazProvider.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const stampArg = process.argv.find((a) => a.startsWith('--stamp'));
const stamp = stampArg ? stampArg.split('=')[1] : '20260810-163948';
const env = loadEnv(path.join(ROOT, 'backup/snapshots', stamp, '.env'));

const accountEmail = (process.env.SKAZ_ACCOUNT_EMAIL || env.SKAZ_ACCOUNT_EMAIL || '').trim();
const uid = (process.env.SKAZ_UID || env.SKAZ_UID || '').trim();
if (!accountEmail || !uid) {
  console.error(`Нет кредов: SKAZ_ACCOUNT_EMAIL/SKAZ_UID в снапшоте ${stamp}`);
  process.exit(2);
}

const HOSTS = ['http://online3.skaz.tv', 'http://online8.skaz.tv'];
const ORIGIN = 'http://lampa.mx';
const TIMEOUT = 8000;

// ---- лёгкий REST-пробинг ----
const MOVIE_QUERY = {
  id: '157336', imdb_id: 'tt0816692', tmdb_id: '157336',
  title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', source: 'tmdb'
};

async function probe(slug) {
  const params = new URLSearchParams({ ...MOVIE_QUERY, account_email: accountEmail, uid });
  let last = '';
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}/lite/${slug}?${params}`, {
        headers: { Origin: ORIGIN }, signal: AbortSignal.timeout(TIMEOUT)
      });
      if (res.status !== 200) { last = `HTTP ${res.status}`; continue; }
      const html = await res.text();
      const cards = new SkazNormalizer().cards(html);
      if (!cards.length) { last = `200, 0 cards (${html.slice(0, 40)})`; continue; }
      const methods = [...new Set(cards.map((c) => c.method || '(none)'))].join(',');
      const first = cards[0] || {};
      return {
        host, status: 'OK', cards: cards.length, methods,
        quality: first.quality || '', translate: first.translate || ''
      };
    } catch (e) {
      last = `ERR ${e.name}:${e.message}`;
    }
  }
  return { host: '-', status: last, cards: 0, methods: '', quality: '', translate: '' };
}

// ---- полный E2E через SkazProvider ----
async function e2eProvider(provider, query) {
  const out = await provider.videos({ query: { ...query, source: 'tmdb' }, request: {} });
  return out;
}

function kindMethods(cards) {
  return [...new Set(cards.map((c) => c.method || '(none)'))].join(',');
}

async function e2eReport(slug, host = HOSTS[0]) {
  const provider = new SkazProvider({
    id: `skaz-${slug}`, title: 'Probe', balancer: slug,
    hosts: HOSTS, accountEmail, uid, origin: ORIGIN
  });

  const res = { movie: null, serial: null, streamProbe: null };

  // фильм
  try {
    const movie = await e2eProvider(provider, { ...MOVIE_QUERY, serial: '0' });
    res.movie = {
      items: movie.items.length,
      seasons: movie.seasons.length,
      voices: movie.voices.length,
      first: movie.items[0] ? {
        method: movie.items[0].method,
        title: movie.items[0].title,
        quality: Object.keys(movie.items[0].quality || {}).join(','),
        subs: (movie.items[0].subtitles || []).length,
        segments: movie.items[0].segments ? 'yes' : undefined
      } : null
    };
    // живой пробинг первого play-URL (через исходный card -> resolveStream)
    if (movie.items[0]) {
      const rawCards = new SkazNormalizer().cards(
        await provider.client.getLite({ ...provider.buildPageParams({ ...MOVIE_QUERY, serial: '0' }) })
      );
      const raw = String(rawCards[0]?.stream || rawCards[0]?.url || '').trim();
      if (raw) {
        const final = await provider.client.resolveStream(raw);
        if (final && /^https?:/i.test(final)) {
          try {
            const p = await fetch(final, {
              headers: { Origin: ORIGIN, Range: 'bytes=0-1023' },
              signal: AbortSignal.timeout(TIMEOUT)
            });
            res.streamProbe = `${p.status} ${p.headers.get('content-type') || ''}`.trim();
          } catch (e) {
            res.streamProbe = `ERR ${e.name}`;
          }
        } else {
          res.streamProbe = 'resolve→' + String(final || '').slice(0, 40);
        }
      }
    }
  } catch (e) {
    res.movie = { error: `${e.name}:${e.message}` };
  }

  // сериал (GoT S1)
  try {
    const serial = await e2eProvider(provider, {
      id: '1399', imdb_id: 'tt0944947', tmdb_id: '1399',
      title: 'Игра престолов', original_title: 'Game of Thrones', year: '2011',
      serial: '1', season: '1', voice: '0'
    });
    res.serial = {
      items: serial.items.length,
      seasons: serial.seasons.length,
      voices: serial.voices.length,
      first: serial.items[0] ? {
        method: serial.items[0].method,
        title: serial.items[0].title,
        season: serial.items[0].season, episode: serial.items[0].episode,
        quality: Object.keys(serial.items[0].quality || {}).join(',')
      } : null
    };
  } catch (e) {
    res.serial = { error: `${e.name}:${e.message}` };
  }

  return res;
}

// ---- прогон ----
const slugs = [
  // E-Online карта §10.1 + кластер withsearch (scan 08.08) + EO_TITLES.
  'alloha', 'filmix', 'rezka', 'videoseed', 'hdvb', 'veoveo', 'kinopub',
  'kinoflix', 'pidtor', 'solntse', 'rutubemovie', 'kodik', 'zagonka',
  'geosaitebi', 'vkmovie', 'kinoteatrkg', 'filmixtv', 'collaps',
  'kinobase', 'videohub', 'turboserial', 'vk', 'rutube', 'fancdn', 'mirage',
  'fanserials', 'mirkino', 'xvideocdn', 'hdrezka', 'aniliberty', 'animebesst', 'animelib'
];

console.log('=== REST-пробинг (поиск по «Интерстеллар») ===');
const probeOut = {};
for (const slug of slugs) {
  const r = await probe(slug);
  probeOut[slug] = r;
  console.log(`${slug.padEnd(14)} | ${r.host.padEnd(22)} | ${String(r.status).padEnd(24)} | cards=${String(r.cards).padEnd(3)} | methods=[${r.methods}] | q=${r.quality}`);
}

const e2eSlugs = ['geosaitebi', 'vkmovie', 'kinoteatrkg', 'vkmovie'];
console.log('\n=== Полный E2E через SkazProvider (фильм Interstellar + сериал GoT) ===');
const e2eOut = {};
for (const slug of e2eSlugs) {
  const r = await e2eReport(slug);
  e2eOut[slug] = r;
  const m = r.movie?.first;
  const s = r.serial?.first;
  console.log(`\n[${slug}] movie: items=${r.movie?.items} voices=${r.movie?.voices}`);
  console.log(`   → first: ${m ? `method=${m.method} title="${m.title}" quality=[${m.quality}] subs=${m.subs}` : '(none)'}`);
  console.log(`   → live-пробинг первого потока: ${r.streamProbe || '(нет url)'}`);
  console.log(`[${slug}] serial: items=${r.serial?.items} seasons=${r.serial?.seasons} voices=${r.serial?.voices}`);
  console.log(`   → first: ${s ? `method=${s.method} ep=${s.season}x${s.episode} title="${s.title}" quality=[${s.quality}]` : '(none)'}`);
}

console.log('\n=== summary json ===');
console.log(JSON.stringify({ probe: probeOut, e2e: e2eOut }, null, 2).slice(0, 8000));