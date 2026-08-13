import test from 'node:test';
import assert from 'node:assert/strict';
import { FilmixClient } from '../src/providers/filmix/FilmixClient.js';

// Живая проверка реального роутинга Filmix (FILMIX-002):
//   PRIMARY  — api.filmix.tv/api-fx (search + video-links)
//   FALLBACK — filmix.my/api/v2 (search + post)
// По умолчанию пропущена — включается явно:
//   FILMIX_LIVE=1 node --test test/live-filmix.test.js
const live = process.env.FILMIX_LIVE === '1';
const host = (process.env.FILMIX_HOST || 'https://filmix.my').replace(/\/+$/, '');
const tvHost = (process.env.FILMIX_TV_HOST || 'https://api.filmix.tv').replace(/\/+$/, '');
const tvUser = process.env.FILMIX_TV_USER || '';
const tvPassword = process.env.FILMIX_TV_PASSWORD || '';

const client = new FilmixClient({ host, tvHost, tvUser, tvPassword });

const skip = !live && 'только с FILMIX_LIVE=1';

test('Filmix search: api-fx primary живьём, "Форрест Гамп" → id 1567', { skip }, async () => {
  const result = await client.search({ title: 'Форрест Гамп', originalTitle: 'Forrest Gump', year: 1994 });
  assert.ok(result.items.length > 0, 'api-fx/list должен вернуть записи');
  const ids = result.items.slice(0, 5).map((item) => `${item.id}:${item.title}`);
  assert.ok(
    result.items.some((item) => Number(item.id) === 1567),
    `среди записей должен быть id 1567 (первые: ${ids.join(', ')})`
  );
  console.log(`  [ok] api-fx search: ${result.items.length} записей, есть id 1567`);
});

test('Filmix search: фолбэк на v2 (api-fx пуст) не падает и не висит', { skip }, async () => {
  // api-fx принудительно пустой — реальный клиент уходит на filmix.my/api/v2/search.
  const httpClient = { get: async () => ({ json: async () => ({ items: [] }) }) };
  const c = new FilmixClient({ host, tvHost, tvUser, tvPassword, httpClient });
  const started = Date.now();
  const result = await c.search({ title: 'Властелин колец', originalTitle: 'The Lord of the Rings', year: 2001 });
  const elapsed = Date.now() - started;
  // v2 mirror сейчас мёртв (301→501) — результат может быть пустым, но поиск обязан
  // завершиться быстро (primary-клиент 3с без ретраев) и вернуть массив.
  assert.ok(Array.isArray(result.items));
  assert.ok(elapsed < 15000, `v2-фолбэк обязан укладываться в ~3с, заняло ${elapsed}ms`);
  console.log(`  [info] v2 fallback: ${result.items.length} записей за ${elapsed}ms`);
});

test('Filmix video-links: primary по реальному id отдаёт файлы потоков', { skip }, async () => {
  const result = await client.search({ title: 'Форрест Гамп', originalTitle: 'Forrest Gump', year: 1994 });
  const id = result.items.find((item) => Number(item.id) === 1567)?.id;
  assert.ok(id, 'нужен id 1567 для проверки video-links');

  const links = await client.videoLinks(id, {});
  assert.ok(links, 'video-links должен вернуть данные');
  const isMovie = Array.isArray(links);
  const size = isMovie ? links.length : Object.keys(links).length;
  assert.ok(size > 0, `video-links должен содержать данные (найдено ${size})`);
  console.log(`  [ok] video-links id=${id}: ${isMovie ? 'фильм' : 'сериал'}, записей/озвучек=${size}`);
});

test('Filmix video-links: битый id → null без падения', { skip }, async () => {
  const links = await client.videoLinks('not-a-real-id', {});
  assert.equal(links, null);
  console.log('  [ok] video-links c битым id: null');
});

test('Filmix searchApiFx: story={kp/imdb} не даёт целевой id (диагностика T5, поиск по внешним id удалён)', { skip }, async () => {
  // Контроль: тайтл-поиск находит 1567.
  const byTitle = await client.search({ title: 'Форрест Гамп', originalTitle: 'Forrest Gump', year: 1994 });
  assert.ok(byTitle.items.some((item) => Number(item.id) === 1567), 'контроль: тайтл-поиск находит 1567');

  // Прямой стори-поиск по IMDb- и KP-id — тот самый путь searchByExternalIds,
  // который отдаёт несвязанные тайтлы и поэтому удалён из роутинга.
  const imdb = await client.searchApiFx('tt0109830', {});
  const kp = await client.searchApiFx('301', {});
  const notTarget = (items) => items.every((item) => Number(item.id) !== 1567);
  assert.ok(notTarget(imdb), `tt0109830 не должен давать 1567 (${imdb.map((i) => `${i.id}:${i.title}`).join(', ') || 'пусто'})`);
  assert.ok(notTarget(kp), `301 не должен давать 1567 (${kp.map((i) => `${i.id}:${i.title}`).join(', ') || 'пусто'})`);
  console.log(`  [ok] tt0109830 → ${imdb.length ? imdb.map((i) => `${i.id}:${i.title}`).join(', ') : 'пусто'} (не 1567)`);
  console.log(`  [ok] 301 → ${kp.length ? kp.map((i) => `${i.id}:${i.title}`).join(', ') : 'пусто'} (не 1567)`);
});
