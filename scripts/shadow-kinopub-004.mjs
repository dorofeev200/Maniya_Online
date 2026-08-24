// BALANCER-KINOPUB-004 — shadow против ЖИВОГО кластера (READ-ONLY, только GET).
// Проверяем ИСПРАВЛЕННЫЙ код SkazProvider (уже в src): navigation выбирает postid
// ТОЛЬКО у карточки запрошенного фильма (год/название/ID). Ожидания:
//   - Одиссея 2026 (1368337)  → НЕ postid 1362, videos() = пусто
//   - Последний дом 2026 (1284041) → НЕ postid 2536, videos() = пусто
//   - Дом Дракона serial (94997) → сериалы не ломаются, items>0
//   - рабочие кинопуб-фильмы (если карточка сходится по году/названию) → items>0
// Печатает: первая страница (метод/title/year/similar/postid), eligible-вердикт,
// выбранный postid, items. Ничего не пишет в кластер кроме GET.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
// SECURITY-001: creds только из env → temp (см. _creds.mjs)
import { loadClusterEmail, loadClusterUid, loadClusterOrigin } from './_creds.mjs';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const serverRoot = path.join(here, '..', 'server');
const { SkazProvider } = await import(pathToFileURL(path.join(serverRoot, 'src/providers/skaz/SkazProvider.js')).href);

const email = loadClusterEmail();
const uid = loadClusterUid();
const origin = loadClusterOrigin();
const HOSTS = ['http://online3.skaz.tv', 'http://online8.skaz.tv', 'http://94.249.239.63', 'http://94.249.239.37', 'http://94.249.239.11', 'http://77.90.33.109'];

const CARDS = [
  { label: 'Одиссея 2026 (1368337)', expect: 'empty', query: { id: '1368337', imdb_id: 'tt33764258', title: 'Одиссея', original_title: 'The Odyssey', original_language: 'en', source: 'tmdb', year: '2026', serial: '0' } },
  { label: 'Последний дом 2026 (1284041)', expect: 'empty', query: { id: '1284041', imdb_id: 'tt32268156', title: 'Последний дом', original_title: 'The Last House', original_language: 'en', source: 'tmdb', year: '2026', serial: '0' } },
  { label: 'Дом Дракона serial (94997)', expect: 'serial', query: { id: '94997', imdb_id: 'tt11198330', title: 'Дом Дракона', original_title: 'House of the Dragon', original_language: 'en', source: 'tmdb', year: '2022', serial: '1' } },
  { label: 'Форрест Гамп (13)', expect: 'movie', query: { id: '13', imdb_id: 'tt0109830', title: 'Форрест Гамп', original_title: 'Forrest Gump', original_language: 'en', source: 'tmdb', year: '1994', serial: '0' } },
  { label: 'Матрица (603)', expect: 'movie', query: { id: '603', imdb_id: 'tt0133093', kinopoisk_id: '301', title: 'Матрица', original_title: 'The Matrix', original_language: 'en', source: 'tmdb', year: '1999', serial: '0' } },
  { label: 'Интерстеллар (157336)', expect: 'movie', query: { id: '157336', imdb_id: 'tt0816692', title: 'Интерстеллар', original_title: 'Interstellar', original_language: 'en', source: 'tmdb', year: '2014', serial: '0' } }
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeProvider() {
  return new SkazProvider({
    id: 'skaz-kinopub',
    title: 'kinopub',
    balancer: 'kinopub',
    hosts: HOSTS,
    accountEmail: email,
    uid,
    origin
  });
}

function postidOf(card) {
  try { return new URL(String(card.url || '')).searchParams.get('postid'); } catch { return null; }
}

function summary(card) {
  return { method: card.method, title: String(card.title || card._text || '').slice(0, 34), year: card.year || '', similar: card.similar ? true : undefined, postid: postidOf(card) };
}

async function main() {
  console.log('== shadow kinopub-004 (live) == email_len=' + email.length + ' uid_len=' + uid.length);
  const results = [];
  for (const card of CARDS) {
    console.log('');
    console.log('═'.repeat(78));
    console.log('CARD ' + card.label + '   expect=' + card.expect);
    const provider = makeProvider();
    const q = card.query;

    // Первая страница: карточки поисковой выдачи + eligible-вердикт по каждой
    const firstHtml = await provider.client.getLite(provider.buildPageParams(q));
    const firstCards = provider.normalizer.cards(firstHtml || '');
    console.log('— первая страница (' + firstCards.length + ' карточек) —');
    for (const c of firstCards) {
      const eligible = c.method === 'link'
        ? (provider.postidFromCards([c], q) !== null || (c.href || '').length > 0)
        : undefined;
      console.log('  ' + JSON.stringify(summary(c)) + (eligible === undefined ? '' : ' eligible=' + eligible));
    }

    // Навигация исправленным кодом
    try {
      if (card.expect === 'serial') {
        const streamProxy = (url) => url;
        const res = await provider.serialVideos(q, { query: q, request: {} }, streamProxy);
        console.log('  serialVideos: items=' + res.items.length + ' seasons=' + res.seasons.length + ' voices=' + res.voices.length);
        results.push({ id: card.query.id, ok: res.items.length > 0, items: res.items.length, note: 'serial' });
      } else {
        const nav = await provider.collectMovieCards(q);
        const finalCards = nav.cards || [];
        const playable = finalCards.filter((c) => c.method === 'play' || (c.method === 'call' && c.s == null && c.e == null)).length;
        const res = await provider.movieVideos(q, { query: q, request: {} }, (url) => url);
        console.log('  collectMovieCards: финальных карточек=' + finalCards.length + ' playable=' + playable);
        console.log('  movieVideos items=' + res.items.length + (res.items[0] ? ' first=' + JSON.stringify({ title: res.items[0].title, url: String(res.items[0].url || '').slice(0, 48) }) : ''));
        const ok = card.expect === 'empty' ? res.items.length === 0 : res.items.length > 0;
        results.push({ id: card.query.id, ok, items: res.items.length, note: card.expect });
        console.log('  → ' + (ok ? (card.expect === 'empty' ? 'OK: пусто (не перешёл на чужой фильм)' : 'OK: items>0') : 'ПРОВЕРИТЬ (не совпало с ожиданием)'));
      }
    } catch (error) {
      console.log('  NAV ERR ' + String((error && error.message) || error).slice(0, 70));
      results.push({ id: card.query.id, ok: false, note: 'ERR' });
    }
    await sleep(2500);
  }
  console.log('');
  console.log('='.repeat(78));
  const pass = results.filter((r) => r.ok).length;
  console.log('VERDICT: ' + pass + '/' + results.length + ' соответствуют ожиданию');
  for (const r of results) console.log('  ' + r.id + ' ' + r.note + ' items=' + r.items + ' → ' + (r.ok ? 'OK' : 'ПРОВЕРИТЬ'));
}

main().catch((error) => { console.error('FATAL ' + ((error && error.stack) || error)); process.exitCode = 1; });
