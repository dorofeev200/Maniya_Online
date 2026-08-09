import test from 'node:test';
import assert from 'node:assert/strict';

import { readFile } from 'node:fs/promises';
import { EoProvider } from '../src/providers/eonline/EoProvider.js';

async function fixture(name) {
  return readFile(`C:/tmp/showy/${name}`, 'utf8');
}

/** FakeClient: getLite → lite, openLiteUrl → по подстроке URL, resolve → финальный m3u8. */
class FakeEoClient {
  constructor(options = {}) {
    this.lite = String(options.lite ?? '');
    this.pages = options.pages || {};
    this.resolveResult = options.resolveStream || 'http://magic.stream.voidboost.one/s/key/manifest.m3u8';
    this.calls = [];
  }

  enabled() {
    return true;
  }

  async getLite(params) {
    this.calls.push(['getLite', params]);
    if (params && params.href) {
      for (const [needle, html] of Object.entries(this.pages)) {
        if (String(params.href).includes(needle)) return html;
      }
      return this.pages.fallback || null;
    }
    if (params && params.postid != null) {
      for (const [needle, html] of Object.entries(this.pages)) {
        if (`postid:${params.postid}` === needle) return html;
      }
      return this.pages.fallback || null;
    }
    return this.lite;
  }

  async openLiteUrl(url) {
    this.calls.push(['openLiteUrl', url]);
    for (const [needle, html] of Object.entries(this.pages)) {
      if (String(url).includes(needle)) return html;
    }
    return this.lite;
  }

  async resolveStream(url) {
    this.calls.push(['resolveStream', url]);
    return this.resolveResult;
  }
}

function makeProvider(client, balancer = 'rezka') {
  return new EoProvider({
    id: `eonline-${balancer}`,
    title: `Maniya ${balancer}`,
    balancer,
    client
  });
}

function context(query) {
  return { query: { token: '', ...query }, request: {} };
}

test('enabled() = false без client-enable', () => {
  const provider = new EoProvider({
    id: 'x',
    title: 'X',
    balancer: 'x',
    client: { enabled: () => false }
  });
  assert.equal(provider.enabled(), false);
});

test('enabled() = true при рабочем балансере', () => {
  const provider = makeProvider(new FakeEoClient());
  assert.equal(provider.enabled(), true);
});

test('movie: play-карточки, все URL идут через прокси', async () => {
  const client = new FakeEoClient({ lite: await fixture('eo-fx.json') });
  const provider = makeProvider(client, 'filmix');

  const result = await provider.videos(context({ title: 'film', serial: '0' }));

  assert.ok(result.items.length >= 1, `items: ${result.items.length}`);
  for (const item of result.items) {
    assert.ok(String(item.url).startsWith('http'), `item.url: ${item.url}`);
    assert.equal(item.method, 'play');
  }
});

test('movie: call-карточки без s/e (Alloha) → резолв каждого stream → items play', async () => {
  // Живой формат Alloha (raw/alloha.movie.html): method:"call", stream — m3u8,
  // у карточки фильма НЕТ s/e → обязательный резолв через resolveCardStream.
  const callHtml = [
    '<div class="videos__item" data-json=\'{"method":"call","url":"http://94.249.239.63/lite/alloha/video?t=7&token_movie=abc&rjson=False&play=true","stream":"http://94.249.239.63/lite/alloha/video.m3u8?t=7&play=true","translate":"Дубляж"}\'>x</div>',
    '<div class="videos__item" data-json=\'{"method":"call","url":"http://94.249.239.63/lite/alloha/video?t=8&token_movie=def&rjson=False&play=true","stream":"http://94.249.239.63/lite/alloha/video.m3u8?t=8&play=true","translate":"Оригінал"}\'>y</div>'
  ].join('');
  const client = new FakeEoClient({ lite: callHtml });
  const provider = makeProvider(client, 'alloha');

  const result = await provider.videos(context({ serial: '0' }));

  assert.equal(result.items.length, 2, `items по 2 call-карточкам: ${result.items.length}`);
  const resolved = client.calls.filter(([name]) => name === 'resolveStream');
  assert.equal(resolved.length, 2, 'каждая call-карточка резолвится');
  assert.ok(
    resolved.every(([, url]) => String(url).includes('video.m3u8')),
    `резолвятся именно stream (не url-страница): ${resolved.map(([, u]) => u).join(' | ')}`
  );
  for (const item of result.items) {
    assert.equal(item.method, 'play');
    assert.ok(String(item.url).includes('/api/lampa/proxy'), `через прокси: ${item.url}`);
    assert.ok(item.voice_name, 'голос перевода не пуст');
  }
});

test('movie: call-карточка БЕЗ stream (пустой резолв) — пропускается без падения', async () => {
  const callHtml = [
    '<div class="videos__item" data-json=\'{"method":"call","stream":"","url":"","translate":"Х"}\'>x</div>'
  ].join('');
  const client = new FakeEoClient({ lite: callHtml });
  const provider = makeProvider(client, 'alloha');
  const result = await provider.videos(context({ serial: '0' }));
  assert.equal(result.items.length, 0);
});

test('serial: голоса/сезоны + серии через openLiteUrl', async () => {
  const serialHtml = await fixture('eo-got-rezka.html');
  const epHtml = await fixture('eo-got-ep.html');
  const client = new FakeEoClient({ lite: serialHtml, pages: { 's=1': epHtml } });
  const provider = makeProvider(client, 'rezka');

  const result = await provider.videos(context({ serial: '1' }));

  assert.ok(result.voices.length >= 6, `голоса: ${result.voices.length}`);
  assert.ok(result.seasons.length >= 1, `сезоны: ${result.seasons.length}`);
  assert.ok(result.items.length >= 1, `серии: ${result.items.length}`);
  const item = result.items[0];
  assert.equal(item.method, 'play');
  assert.equal(item.season, 1);
  assert.ok(item.episode >= 1);
});

test('serial: поиск URL по выбранному сезону из query', async () => {
  const serialHtml = await fixture('eo-got-rezka.html');
  // Эпизоды именно 2-го сезона (в eo-got-ep.html все серии — S1).
  const ep2Html = [
    '<div class="videos__item"',
    " data-json='{\"method\":\"call\",\"stream\":\"http://h/x.m3u8\",\"url\":\"http://h/lite?t=111&s=2&e=1\",\"s\":2,\"e\":1,\"name\":\"2x01\"}'>",
    '<span class="videos__item-title">2x01</span></div>'
  ].join('');
  const client = new FakeEoClient({ lite: serialHtml, pages: { 's=2': ep2Html } });
  const provider = makeProvider(client, 'rezka');

  const result = await provider.videos(context({ serial: '1', season: '2' }));
  const opened = client.calls.find(([name]) => name === 'openLiteUrl');
  assert.ok(opened, 'должен быть открыт season-page');
  assert.ok(opened[1].includes('s=2'), `season URL: ${opened[1]}`);
  assert.ok(result.items.length >= 1);
  assert.equal(result.items[0].episode, 1);
});

test('movie: primary только похожие link-карточки → follow href → call-карточки фильма', async () => {
  // Живой случай (rezka «Интерстеллар»): на primary-странице только
  // {"method":"link","similar":true,"href":"films/fiction/2259-..."},
  // повторный запрос с `href` отдаёт страницу с call-карточками.
  const similarHtml = [
    '<div class="videos__item" data-json=\'{"method":"link","similar":true,"href":"films/fiction/2259-interstellar-2014.html"}\'>Интерстеллар</div>',
    '<div class="videos__item" data-json=\'{"method":"link","similar":true,"href":"films/fiction/777-other-2014.html"}\'>Другое</div>'
  ].join('');
  const filmHtml = [
    '<div class="videos__item" data-json=\'{"method":"call","stream":"http://h/movie.m3u8?play=true","url":"http://h/x","translate":"Дубляж"}\'>Дубляж</div>',
    '<div class="videos__item" data-json=\'{"method":"call","stream":"http://h/movie2.m3u8?play=true","url":"http://h/y","translate":"Оригінал"}\'>Оригінал</div>'
  ].join('');

  const client = new FakeEoClient({ lite: similarHtml, pages: { 'films/fiction/2259': filmHtml } });
  const provider = makeProvider(client, 'rezka');

  const result = await provider.videos(context({ title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0' }));

  const followed = client.calls.find(([name, p]) => name === 'getLite' && p && p.href);
  assert.ok(followed, 'должен быть повторный getLite с href');
  assert.ok(String(followed[1].href).includes('interstellar'), `href выбран по релевантности: ${followed[1].href}`);
  assert.ok(result.items.length >= 2, `items с call-карточек фильма: ${result.items.length}`);
  assert.ok(result.items.every((item) => item.method === 'play'));
});

test('movie: kinopub (Lime) — link-карточки с postid → follow через postid', async () => {
  // Живой случай (Lime «Интерстеллар»): primary-страница kinopub — только
  // link-карточки с `postid` (похожие тайтлы + сам фильм); пост-страница
  // отдаёт play-карточки переводов (cdntogo). Follow через postid.
  const similarHtml = [
    '<div class="videos__item" data-json=\'{"method":"link","url":"http://online8.skaz.tv/lite/kinopub?postid=8613&title=Interstellar&original_title=Interstellar","similar":true,"year":2014,"details":"Дубляж, Профессиональный многоголосый"}\'>Интерстеллар</div>',
    '<div class="videos__item" data-json=\'{"method":"link","url":"http://online8.skaz.tv/lite/kinopub?postid=123847&title=Interstellar&original_title=Interstellar","similar":true,"year":2026,"title":"Schiller / Interstellar"}\'>Schiller / Interstellar</div>'
  ].join('');
  const postHtml = [
    '<div class="videos__item" data-json=\'{"method":"play","url":"http://h/v.m3u8","stream":"http://1a5af214.cdntogo.net/s/x.m3u8","translate":"Дубляж"}\'>Дубляж</div>',
    '<div class="videos__item" data-json=\'{"method":"play","url":"http://h/v2.m3u8","stream":"http://1a5af214.cdntogo.net/s/y.m3u8","translate":"Оригинал"}\'>Оригінал</div>'
  ].join('');

  const client = new FakeEoClient({ lite: similarHtml, pages: { 'postid:8613': postHtml } });
  const provider = makeProvider(client, 'kinopub');

  const result = await provider.videos(context({ title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0' }));

  const postidCall = client.calls.find(([name, p]) => name === 'getLite' && p && p.postid != null);
  assert.ok(postidCall, 'должен быть повторный getLite с postid');
  assert.equal(postidCall[1].postid, '8613', `postid выбран из первой link-карточки: ${postidCall[1].postid}`);
  assert.ok(result.items.length >= 2, `items с play-карточек перевода: ${result.items.length}`);
  assert.ok(result.items.every((item) => item.method === 'play'));
  assert.ok(result.items.every((item) => item.voice_name), 'перевод не пуст');
});

test('movie: сразу play-карточки — follow НЕ вызывается', async () => {
  const playHtml = [
    '<div class="videos__item" data-json=\'{"method":"play","url":"http://h/v.m3u8","quality":{"1080p":"http://h/1080.m3u8"},"title":"Х"}\'>Дубляж</div>'
  ].join('');
  const client = new FakeEoClient({ lite: playHtml });
  const provider = makeProvider(client, 'filmix');

  const result = await provider.videos(context({ serial: '0' }));

  const followed = client.calls.filter(([name, p]) => name === 'getLite' && p && p.href);
  assert.equal(followed.length, 0, 'нет повторного запроса с href');
  assert.ok(result.items.length >= 1);
});

test('поиск без id/imdb — пусто', async () => {
  const provider = makeProvider(new FakeEoClient({ lite: '<html/>' }));
  assert.deepEqual(await provider.search({ title: '' }), []);
});

test('поиск с id/imdb_id — запись контракта', async () => {
  const provider = makeProvider(new FakeEoClient());
  const records = await provider.search({ id: '45', imdb_id: 'tt0944947', title: 'Игра престолов', serial: '1' });
  assert.equal(records.length, 1);
  assert.equal(records[0].type, 'serial');
  assert.equal(records[0].metadata.imdb_id, 'tt0944947');
});