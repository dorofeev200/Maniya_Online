import test from 'node:test';
import assert from 'node:assert/strict';

// Живая проверка фактической доступности Filmix-эндпоинтов.
// По умолчанию пропущена — включается явно: FILMIX_LIVE=1 FILMIX_TOKEN=... node --test test/live-filmix.test.js
const live = process.env.FILMIX_LIVE === '1';
const host = (process.env.FILMIX_HOST || 'https://filmix.my').replace(/\/+$/, '');
const tvHost = (process.env.FILMIX_TV_HOST || 'https://api.filmix.tv').replace(/\/+$/, '');
const token = process.env.FILMIX_TOKEN || '';

const args = new URLSearchParams({
  app_lang: 'ru_RU',
  user_dev_apk: '2.2.13',
  user_dev_id: 'lampacheck12345678',
  user_dev_name: 'Xiaomi 24069PC21G',
  user_dev_os: '12',
  user_dev_token: token,
  user_dev_vendor: 'Xiaomi'
}).toString();

async function probe(label, url) {
  const start = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'manual' });
    const status = response.status;
    const body = await response.text();
    return { label, status, ok: status >= 200 && status < 400, ms: Date.now() - start, body };
  } catch (error) {
    return { label, status: 'ERR', ok: false, ms: Date.now() - start, body: error.name };
  }
}

test('Filmix: живая проверка ссылок', { skip: !live && 'только с FILMIX_LIVE=1' }, async () => {
  const title = encodeURIComponent('Властелин колец');

  // Рабочий анонимный поиск — единственный контур, который должен дать 200 и записи.
  const fallback = await probe('search api-fx/list', `${tvHost}/api-fx/list?search=${title}&limit=48`);
  assert.equal(fallback.ok, true, 'aнонимный fallback-поиск обязан быть доступен: ' + JSON.stringify(fallback.status));

  let items = [];
  try { items = JSON.parse(fallback.body).items || []; } catch { items = []; }
  assert.ok(items.length > 0, 'fallback-поиск должен вернуть записи');
  const id = items[0].id;
  const itemTitle = items[0].title;
  console.log(`  [ok] askapi_fx_list: ${fallback.ms}ms, записей=${items.length}, id=${id} "${itemTitle}"`);

  // Primary API /api/v2/search — часто закрыт Cloudflare для анонима.
  const primary = await probe('primary search /api/v2/search', `${host}/api/v2/search?story=${title}&${args}`);
  console.log(`  [${primary.ok ? 'ok' : 'info'}] primary search: HTTP ${primary.status} (${primary.ms}ms)`);
  if (!primary.ok) {
    console.log('       → ожидаемая 403/Cloudflare без валидного FILMIX_TOKEN/рабочего FILMIX_HOST');
  }

  // Карточка /api/v2/post требует токен (459/Cloudflare анонимно).
  const card = await probe('card /api/v2/post/{id}', `${host}/api/v2/post/${id}?${args}`);
  const hasPlayerLinks = /"player_links"/.test(card.body || '');
  if (token && card.ok && hasPlayerLinks) {
    const parsed = JSON.parse(card.body);
    const movie = parsed.player_links?.movie;
    const playlist = parsed.player_links?.playlist;
    const type = movie && movie.length ? 'movie' : (playlist ? 'serial' : 'none');
    console.log(`  ✔ card: HTTP ${card.status}, тип=${type}, потоков/серий найдено для id=${id}`);
  } else if (card.ok) {
    console.log(`  [warn] card: HTTP ${card.status}, но нет player_links — возможно требует токен`);
  } else {
    console.log(`  [info] card: HTTP ${card.status}${card.body ? ' (' + String(card.body).slice(0, 60) + ')' : ''}`);
  }

  // Анонимный фолбэк browser-API api-fx — основной источник карточки,
  // когда /api/v2/post закрыт Cloudflare. Должен дать 200 и файлы потоков.
  const links = await probe('video-links api-fx/post/{id}/video-links', `${tvHost}/api-fx/post/${id}/video-links`);
  const hasFiles = /"files":\s*\[/.test(links.body || '');
  assert.equal(links.ok, true, 'анонимный video-links обязан быть доступен: ' + JSON.stringify(links.status));
  assert.ok(hasFiles, `video-links должен вернуть файлы потоков (HTTP ${links.status})`);
  console.log(`  ✔ video-links: HTTP ${links.status}, файлы потоков есть (${links.ms}ms)`);
});