// Диагностика Rezka «откуда сезоны». Запускать на VPS:
//   node /opt/maniya-online/server/scripts/rezka-seasons-diag.mjs
import { RezkaClient } from '../src/providers/rezka/RezkaClient.js';
import { parseSearchHtml, parseEmbedHtml, parseEpisodesHtml } from '../src/providers/rezka/RezkaCodec.js';

const client = new RezkaClient({ baseUrl: 'https://rezka.ag', timeoutMs: 25000 });

const title = 'Дом Дракона';

// 1) Поиск
const searchHtml = await client.searchHtml({ query: title });
if (!searchHtml) {
  console.log('SEARCH: null');
  process.exit(1);
}
const results = parseSearchHtml(searchHtml);
console.log('SEARCH results:');
for (const r of results.slice(0, 5)) {
  console.log('  href=%s title=%s serial=%s', r.href, r.title, r.serial);
}

const first = results.find((r) => /dom-drakona/i.test(r.href)) || results[0];
if (!first) {
  console.log('NO RESULT');
  process.exit(1);
}

const canonical = first.href.replace(/-latest\.html$/, '.html');
console.log('\nPICKED href=%s', first.href);
console.log('CANONICAL (strip -latest) href=%s', canonical);

// 2) Embed canonical page
const html = await client.page(canonical);
console.log('\nEMBED canonical: %s bytes, isAnubis=%s', html ? html.length : 0, /anubis_challenge/i.test(html || ''));
if (html) {
  const embed = parseEmbedHtml(html);
  console.log('  id=%s isSerial=%s translators=%d favs=%s', embed.id, embed.isSerial, Object.keys(embed.translators).length, embed.favs ? 'yes' : 'no');
  // Сезоны из embed: data-season_id (все эпизоды) и data-tab_id (табы)
  const seasonIds = [...new Set([...String(html).matchAll(/data-season_id="(\d+)"/g)].map((m) => m[1]))];
  const tabIds = [...new Set([...String(html).matchAll(/data-tab_id="(\d+)"/g)].map((m) => m[1]))];
  console.log('  data-season_id=%s', seasonIds.join(',') || '(нет)');
  console.log('  data-tab_id=%s', tabIds.join(',') || '(нет)');
}

// 3) Embed latest page
const htmlLatest = await client.page(first.href);
console.log('\nEMBED latest: %s bytes, isAnubis=%s', htmlLatest ? htmlLatest.length : 0, /anubis_challenge/i.test(htmlLatest || ''));
if (htmlLatest) {
  const seasonIds = [...new Set([...String(htmlLatest).matchAll(/data-season_id="(\d+)"/g)].map((m) => m[1]))];
  const tabIds = [...new Set([...String(htmlLatest).matchAll(/data-tab_id="(\d+)"/g)].map((m) => m[1]))];
  console.log('  data-season_id=%s', seasonIds.join(',') || '(нет)');
  console.log('  data-tab_id=%s', tabIds.join(',') || '(нет)');
}

// 4) get_episodes с разными referer
const id = first.href.match(/(\d+)-[^/]*\.html$/)?.[1];
for (const ref of [canonical, first.href, undefined]) {
  const root = await client.getEpisodes(id, 1, ref); // translator 1 (Дубляж) — пример
  if (!root) {
    console.log('\nget_episodes(ref=%s): null', ref);
    continue;
  }
  console.log('\nget_episodes(ref=%s): seasons=%s episodes=%d', ref, root.seasons.map((s) => s.number).join(','), root.episodes.length);
}
