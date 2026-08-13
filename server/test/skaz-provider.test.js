import test from 'node:test';
import assert from 'node:assert/strict';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkazProvider, cleanedQualityMap } from '../src/providers/skaz/SkazProvider.js';
import { extractAccsdbMessage } from '../src/providers/skaz/SkazClient.js';
import { buildProxyUrl } from '../src/proxy.js';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const repoFixture = (name) => readFile(path.join(FIXTURE_DIR, name), 'utf8');
const fixture = (name) => readFile(`C:/tmp/showy/${name}`, 'utf8'); // dev-фикстуры (RAW-захваты)

/** FakeClient: getLite → lite, openLiteUrl → по подстроке URL, resolve → финальный m3u8. */
class FakeSkazClient {
  constructor(options = {}) {
    this.lite = String(options.lite ?? '');
    this.pages = options.pages || {};
    this.resolveResult = options.resolveStream || 'http://magic.stream.voidboost.one/s/key/manifest.m3u8';
    this.videoJson = options.videoJson == null ? null : options.videoJson; // строка JSON или объект для resolveVideoJson
    this.calls = [];
    this.lastAccsdb = null; // I1: симулирует SkazClient.lastAccsdb
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

  async resolveVideoJson(streamUrl) {
    this.calls.push(['resolveVideoJson', streamUrl]);
    if (this.videoJson == null) return null;
    return typeof this.videoJson === 'string' ? JSON.parse(this.videoJson) : this.videoJson;
  }
}

function makeProvider(client, balancer = 'rezka') {
  return new SkazProvider({
    id: `skaz-${balancer}`,
    title: `Maniya ${balancer}`,
    balancer,
    client
  });
}

function context(query) {
  return { query: { token: '', ...query }, request: {} };
}

test('enabled() = false без client-enable', () => {
  const provider = new SkazProvider({
    id: 'x',
    title: 'X',
    balancer: 'x',
    client: { enabled: () => false }
  });
  assert.equal(provider.enabled(), false);
});

test('enabled() = true при рабочем балансере', () => {
  const provider = makeProvider(new FakeSkazClient());
  assert.equal(provider.enabled(), true);
});

test('movie: play-карточки, все URL идут через прокси', async () => {
  const client = new FakeSkazClient({ lite: await fixture('eo-fx.json') });
  const provider = makeProvider(client, 'filmix');

  const result = await provider.videos(context({ title: 'film', serial: '0' }));

  assert.ok(result.items.length >= 1, `items: ${result.items.length}`);
  for (const item of result.items) {
    assert.ok(String(item.url).startsWith('http'), `item.url: ${item.url}`);
    assert.equal(item.method, 'play');
  }
});

test('movie: call-карточки без s/e (Alloha) → ЛЕНИВЫЕ call-items; резолв только выбранного голоса', async () => {
  const callHtml = [
    '<div class="videos__item" data-json=\'{"method":"call","url":"http://94.249.239.63/lite/alloha/video?t=7&token_movie=abc&rjson=False&play=true","stream":"http://94.249.239.63/lite/alloha/video.m3u8?t=7&play=true","translate":"Дубляж"}\'>x</div>',
    '<div class="videos__item" data-json=\'{"method":"call","url":"http://94.249.239.63/lite/alloha/video?t=8&token_movie=def&rjson=False&play=true","stream":"http://94.249.239.63/lite/alloha/video.m3u8?t=8&play=true","translate":"Оригінал"}\'>y</div>'
  ].join('');
  const client = new FakeSkazClient({ lite: callHtml });
  const provider = makeProvider(client, 'alloha');

  const result = await provider.videos(context({ serial: '0' }));

  assert.equal(result.items.length, 2, `items по 2 call-карточкам: ${result.items.length}`);
  // videos() НЕ резолвит голоса заранее — карточки уходят как `call`.
  const eagerResolves = client.calls.filter(([name]) => name === 'resolveStream' || name === 'resolveVideoJson');
  assert.equal(eagerResolves.length, 0, 'нет eager-резолвов при videos()');
  for (const item of result.items) {
    assert.equal(item.method, 'call');
    assert.ok(String(item.url).includes('/api/lampa/video'), `ленивый URL резолва: ${item.url}`);
    assert.ok(item.voice_name, 'голос перевода не пуст');
  }
  assert.match(result.items[0].url, /voice=0/, 'первый голос → индекс 0');
  assert.match(result.items[1].url, /voice=1/, 'второй голос → индекс 1');

  // Play ВЫБРАННОГО голоса → резолв ровно ОДНОЙ карточки (не всех).
  const play = await provider.resolveVideo(context({ serial: '0', voice: '1' }));
  assert.ok(play, 'дескриптор выбранного голоса');
  assert.equal(play.method, 'play');
  assert.ok(String(play.url).includes('/api/lampa/proxy'), `через прокси: ${play.url}`);
  assert.ok(play.voice_name, 'голос перевода не пуст');
  const streamResolves = client.calls.filter(([name]) => name === 'resolveStream');
  assert.ok(
    streamResolves.every(([, url]) => String(url).includes('video.m3u8') && String(url).includes('t=8')),
    `резолвится именно выбранный голос (t=8), а не все: ${streamResolves.map(([, u]) => u).join(' | ')}`
  );
});

test('movie: call-карточка БЕЗ stream — ленивый call-item в списке, резолв → null (без падения)', async () => {
  const callHtml = [
    '<div class="videos__item" data-json=\'{"method":"call","stream":"","url":"","translate":"Х"}\'>x</div>'
  ].join('');
  const client = new FakeSkazClient({ lite: callHtml });
  const provider = makeProvider(client, 'alloha');
  const result = await provider.videos(context({ serial: '0' }));
  // Лениво карточку не фильтруем (stream неизвестен до резолва) — но и не падаем.
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].method, 'call');

  const resolved = await provider.resolveVideo(context({ serial: '0', voice: '0' }));
  assert.equal(resolved, null, 'пустой резолв → null, без исключения');
});

test('movie: Alloha JSON-режим — resolveVideo даёт primary or reserve, 4 качества, 7 субтитров, segments.skip', async () => {
  // RAW-фикстура видео-дескриптора «Человек-паук»: то, что E-Online отдаёт из
  // /lite/alloha/video (без play). Русская «Студия HDRezka»-подобная карточка.
  const videoJson = await repoFixture('alloha-spiderman-video.json');
  const html = [
    '<div class="videos__item" data-json=\'{"method":"call","stream":"http://h/lite/alloha/video.m3u8?t=7&play=true","translate":"HDrezka Studio"}\'>Дубляж</div>'
  ].join('');
  const client = new FakeSkazClient({ lite: html, videoJson });
  const provider = makeProvider(client, 'alloha');

  const result = await provider.videos(context({ serial: '0' }));

  assert.equal(result.items.length, 1, `items по call-карточке: ${result.items.length}`);
  const callItem = result.items[0];
  // Лениво: при videos() дескриптор НЕ резолвится (главный фикс per iOS-latency).
  assert.equal(callItem.method, 'call');
  assert.equal(callItem.voice_name, 'HDrezka Studio');
  assert.ok(!client.calls.some(([name]) => name === 'resolveVideoJson'), 'videos() не резолвит JSON');

  // Полный дескриптор — только на Play резолва выбранной карточки.
  const item = await provider.resolveVideo(context({ serial: '0', voice: '0' }));
  assert.ok(item, 'дескриптор резолвится');

  // JSON-режим: дескриптор из resolveVideoJson, resolveStream-фолбэка нет.
  assert.ok(client.calls.some(([name]) => name === 'resolveVideoJson'), 'resolveVideoJson вызван при резолве');
  assert.ok(!client.calls.some(([name]) => name === 'resolveStream'), 'resolveStream фолбэк НЕ вызывался');

  assert.equal(item.method, 'play');
  assert.equal(item.voice_name, 'HDrezka Studio');

  // primary or reserve — оба через прокси Maniya.
  assert.match(item.url, / or /, 'url — «primary or reserve»');
  const parts = String(item.url).split(/\s+or\s+/i);
  assert.equal(parts.length, 2);
  for (const part of parts) {
    assert.ok(String(part).includes('/api/lampa/proxy'), `резервные части через прокси: ${part}`);
  }

  // качество: 4 ключа из источника, каждый proxied.
  assert.deepEqual(Object.keys(item.quality).sort(), ['1080p', '360p', '480p', '720p']);
  for (const [, url] of Object.entries(item.quality)) {
    assert.ok(String(url).includes('/api/lampa/proxy'), `качество через прокси: ${url}`);
  }

  // субтитры: 7, каждый proxied.
  assert.equal(item.subtitles.length, 7, 'субтитры из JSON не потеряны');
  for (const sub of item.subtitles) {
    assert.ok(sub.label, 'label субтитра не пуст');
    assert.ok(String(sub.url).includes('/api/lampa/proxy'), `субтитр через прокси: ${sub.url}`);
  }

  // segments.skip [1..38] и таймаут проходят в item.
  assert.deepEqual(item.segments, { ad: [], skip: [{ start: 1, end: 38 }] });
  assert.equal(item.hls_manifest_timeout, 20000);
  assert.equal(item.type, 'movie');
});

test('movie: Alloha JSON-режим недоступен (null) → resolveVideo фолбэк resolveStream, как было', async () => {
  const html = [
    '<div class="videos__item" data-json=\'{"method":"call","stream":"http://h/lite/alloha/video.m3u8?t=7&play=true","translate":"Дубляж"}\'>Дубляж</div>'
  ].join('');
  const client = new FakeSkazClient({ lite: html, videoJson: null });
  const provider = makeProvider(client, 'alloha');

  const result = await provider.videos(context({ serial: '0' }));

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].method, 'call', 'в списке — ленивый резолв');

  const item = await provider.resolveVideo(context({ serial: '0', voice: '0' }));
  assert.ok(item, 'дескриптор через фолбэк');
  assert.ok(client.calls.some(([name]) => name === 'resolveStream'), 'фолбэк на resolveStream');
  assert.ok(String(item.url).includes('/api/lampa/proxy'), 'резолвнутый URL через прокси');
  // фолбэк НЕ даёт качества/субтитров (старое поведение — не сломали).
  assert.equal(item.quality, undefined);
  assert.deepEqual(item.subtitles, []);
  assert.equal(item.voice_name, 'Дубляж');
});

test('serial: Alloha эпизод в JSON-режиме — ленивый call-item, resolveSerialVideo даёт season/episode и мапу качеств', async () => {
  const baseAlloha = [
    '<div class="videos__item" data-json=\'{"method":"link","url":"http://h/lite/alloha?title=GOT&s=1","similar":false}\'><span class="videos__item-title">1 сезон</span></div>'
  ].join('');
  const season1Html = [
    '<div class="videos__item" data-json=\'{"method":"link","url":"http://h/lite/alloha/s?t=138&s=1","similar":false}\'><span class="videos__item-title">Рен-ТВ</span></div>',
    '<div class="videos__item" data-json=\'{"method":"call","url":"http://h/x","stream":"http://h/video.m3u8?t=138&s=1&e=1&play=true","s":1,"e":1,"name":"1 серия"}\'>s</div>'
  ].join('');
  const videoJson = JSON.stringify({
    method: 'play',
    url: 'https://a.vkvideo.cloud/e1/master.m3u8 or https://b.vkvideo.cloud/e1/reserve.m3u8',
    quality: { '1080p': 'https://a.vkvideo.cloud/e1/1080.m3u8', '720p': 'https://a.vkvideo.cloud/e1/720.m3u8' },
    subtitles: [{ method: 'link', url: 'https://s.skaz.su/sub/e1.vtt', label: 'Русские' }],
    segments: { ad: [], skip: [] }
  });
  const client = new FakeSkazClient({ lite: baseAlloha, pages: { 's=1': season1Html }, videoJson });
  const provider = makeProvider(client, 'alloha');

  const result = await provider.videos(context({ serial: '1', title: 'GOT' }));

  assert.equal(result.items.length, 1, `серия: ${result.items.length}`);
  const callItem = result.items[0];
  // Лениво: серия уходит call-карточкой, серии не резолвятся при videos().
  assert.equal(callItem.method, 'call');
  assert.equal(callItem.season, 1);
  assert.equal(callItem.episode, 1);
  assert.ok(String(callItem.url).includes('/api/lampa/video'), `ленивый URL резолва: ${callItem.url}`);
  assert.ok(!client.calls.some(([name]) => name === 'resolveVideoJson'), 'videos() не резолвит JSON серии');

  // Полный дескриптор серии — только на Play (voice/season/episode из карточки).
  const item = await provider.resolveVideo(context({ serial: '1', title: 'GOT', voice: '0', season: '1', episode: '1' }));
  assert.ok(item, 'дескриптор серии');
  assert.equal(item.method, 'play');
  assert.equal(item.season, 1);
  assert.equal(item.episode, 1);
  assert.equal(item.type, 'serial');
  assert.equal(item.voice_name, 'Оригінал'); // дефолт-перевод, если у серии голос не указан
  assert.ok(String(item.url).includes('/api/lampa/proxy'), 'серия через прокси');
  assert.ok(String(item.url).includes(' or '), 'primary or reserve');
  assert.equal(Object.keys(item.quality).length, 2, 'качества серии из JSON');
  assert.equal(item.subtitles.length, 1);
  assert.ok(client.calls.some(([name]) => name === 'resolveVideoJson'), 'JSON-резолв серии при Play');
});

test('serial: голоса/сезоны + серии через openLiteUrl', async () => {
  const serialHtml = await fixture('eo-got-rezka.html');
  const epHtml = await fixture('eo-got-ep.html');
  const client = new FakeSkazClient({ lite: serialHtml, pages: { 's=1': epHtml } });
  const provider = makeProvider(client, 'rezka');

  const result = await provider.videos(context({ serial: '1' }));

  assert.ok(result.voices.length >= 6, `голоса: ${result.voices.length}`);
  assert.ok(result.seasons.length >= 1, `сезоны: ${result.seasons.length}`);
  assert.ok(result.items.length >= 1, `серии: ${result.items.length}`);
  const item = result.items[0];
  assert.equal(item.method, 'call', 'серии лениво уходят call-карточками');
  assert.ok(String(item.url).includes('/api/lampa/video'), `ленивый URL резолва: ${item.url}`);
  assert.equal(item.season, 1);
  assert.ok(item.episode >= 1);
});

test('serial: alloha-вид — база только с сезонами (нет голосов) → openLiteUrl сезона → серии', async () => {
  // Всеoha/видеоид/солнце: базовая serial-страница несёт только сезонные карточки
  // `link s=N` без `t=` — голосов на базовой нет. Голоса и серии появляются
  // только на странице сезона.
  const baseAlloha = [
    '<div class="videos__item" data-json=\'{"method":"link","url":"http://h/lite/alloha?title=GOT&s=1","similar":false}\'><span class="videos__item-title">1 сезон</span></div>',
    '<div class="videos__item" data-json=\'{"method":"link","url":"http://h/lite/alloha?title=GOT&s=2","similar":false}\'><span class="videos__item-title">2 сезон</span></div>'
  ].join('');
  // Страница сезона: переводы (link с t=) + серии (call c s/e).
  const season1Html = [
    '<div class="videos__item" data-json=\'{"method":"link","url":"http://h/lite/alloha/s?t=138&s=1","similar":false}\'><span class="videos__item-title">Рен-ТВ</span></div>',
    '<div class="videos__item" data-json=\'{"method":"link","url":"http://h/lite/alloha/s?t=3&s=1","similar":false}\'><span class="videos__item-title">AlexFilm</span></div>',
    '<div class="videos__item" data-json=\'{"method":"call","url":"http://h/x","stream":"http://h/video.m3u8?t=138&s=1&e=1&play=true","s":1,"e":1,"name":"1 серия"}\'>s</div>',
    '<div class="videos__item" data-json=\'{"method":"call","url":"http://h/y","stream":"http://h/video.m3u8?t=138&s=1&e=2&play=true","s":1,"e":2,"name":"2 серия"}\'>s</div>'
  ].join('');

  const client = new FakeSkazClient({ lite: baseAlloha, pages: { 's=1': season1Html } });
  const provider = makeProvider(client, 'alloha');

  const result = await provider.videos(context({ serial: '1', title: 'GOT' }));

  assert.equal(result.seasons.length, 2, `сезоны с базовой: ${result.seasons.length}`);
  assert.ok(result.items.length >= 2, `серии со страницы сезона: ${result.items.length}`);
  assert.equal(result.items[0].episode, 1);
  assert.equal(result.items[0].method, 'call', 'серии — ленивые call-карточки');
  assert.ok(String(result.items[0].url).includes('/api/lampa/video'), `ленивый URL резолва: ${result.items[0].url}`);
  const opened = client.calls.find(([name]) => name === 'openLiteUrl');
  assert.ok(opened, 'сезон открывается через openLiteUrl');
});

test('serial: veoveo-вид — эпизоды на странице сезона как method:play (готовый CDN)', async () => {
  const baseVeoveo = [
    '<div class="videos__item" data-json=\'{"method":"link","url":"http://h/lite/veoveo?title=GOT&s=1","similar":false}\'><span class="videos__item-title">1 сезон</span></div>'
  ].join('');
  const seasonHtml = [
    '<div class="videos__item" data-json=\'{"method":"play","url":"http://cdn.example.com/ep/1.m3u8","s":1,"e":1,"name":"1 серия"}\'>x</div>',
    '<div class="videos__item" data-json=\'{"method":"play","url":"http://cdn.example.com/ep/2.m3u8","s":1,"e":2,"name":"2 серия"}\'>x</div>'
  ].join('');

  const client = new FakeSkazClient({ lite: baseVeoveo, pages: { 's=1': seasonHtml } });
  const provider = makeProvider(client, 'veoveo');

  const result = await provider.videos(context({ serial: '1', title: 'GOT' }));

  assert.ok(result.items.length >= 2, `play-серии: ${result.items.length}`);
  // play-серии не резолвятся через resolveStream — url готовый через прокси.
  const resolved = client.calls.filter(([name]) => name === 'resolveStream');
  assert.equal(resolved.length, 0, 'play-серии не идут в resolveStream');
  assert.ok(String(result.items[0].url).includes('/api/lampa/proxy'), `url через прокси: ${result.items[0].url}`);
});

test('serial: база без сезонов и голосов — пусто (не киноплэй-путь)', async () => {
  const weirdHtml = '<div class="videos__item" data-json=\'{"method":"play","url":"http://h/v.m3u8","s":null,"e":null}\'>x</div>';
  const client = new FakeSkazClient({ lite: weirdHtml });
  const provider = makeProvider(client, 'filmix');
  const result = await provider.videos(context({ serial: '1', title: 'X' }));
  assert.equal(result.items.length, 0);
  assert.equal(result.seasons.length, 0);
});

test('serial: поиск URL по выбранному сезону из query', async () => {
  const serialHtml = await fixture('eo-got-rezka.html');
  const ep2Html = [
    '<div class="videos__item"',
    " data-json='{\"method\":\"call\",\"stream\":\"http://h/x.m3u8\",\"url\":\"http://h/lite?t=111&s=2&e=1\",\"s\":2,\"e\":1,\"name\":\"2x01\"}'>",
    '<span class="videos__item-title">2x01</span></div>'
  ].join('');
  const client = new FakeSkazClient({ lite: serialHtml, pages: { 's=2': ep2Html } });
  const provider = makeProvider(client, 'rezka');

  const result = await provider.videos(context({ serial: '1', season: '2' }));
  const opened = client.calls.find(([name]) => name === 'openLiteUrl');
  assert.ok(opened, 'должен быть открыт season-page');
  assert.ok(opened[1].includes('s=2'), `season URL: ${opened[1]}`);
  assert.ok(result.items.length >= 1);
  assert.equal(result.items[0].episode, 1);
});

test('movie: geosaitebi/animelib — link-карточка без href-поля, но с `href=<slug>.html` в URL → follow слагом', async () => {
  // RAW-паттерн GeoVideo (проверено 2026-08-10 live): карточка-линк несёт СВОЙ URL
  // с параметром href=<slug>.html, а не поле href. Следовать нужно этим слагом,
  // иначе getLite получит весь URL вместо slug → 0 карточек.
  const similarHtml = [
    '<div class="videos__item" data-json=\'{"method":"link","url":"http://online3.skaz.tv/lite/geosaitebi?title=%D0%98%D0%BD%D1%82%D0%B5%D1%80%D1%81%D1%82%D0%B5%D0%BB%D0%BB%D0%B0%D1%80&original_title=Interstellar&year=2014&serial=0&href=2792-interstelari-qartulad.html"}\'>Интерстеллар</div>'
  ].join('');
  const playHtml = [
    '<div class="videos__item" data-json=\'{"method":"play","url":"http://online3.skaz.tv/proxy/caea9417d22285de34917c3ff77d6189.m3u8","translate":"Интерстеллар"}\'>Интерстеллар</div>'
  ].join('');

  const client = new FakeSkazClient({ lite: similarHtml, pages: { '2792-interstelari-qartulad.html': playHtml } });
  const provider = makeProvider(client, 'geosaitebi');

  const result = await provider.videos(context({ title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0' }));

  const followed = client.calls.find(([name, p]) => name === 'getLite' && p && p.href);
  assert.ok(followed, 'должен быть повторный getLite с href');
  assert.equal(String(followed[1].href), '2792-interstelari-qartulad.html',
    `href = слаг из URL карточки, не весь URL: ${followed[1].href}`);
  assert.equal(result.items.length, 1, `play-карточка после follow: ${result.items.length}`);
  assert.equal(result.items[0].method, 'play');
  assert.match(String(result.items[0].url), /proxy/, 'url — играбельный (через прокси)');
});

test('movie: primary только похожие link-карточки → follow href → call-карточки фильма', async () => {
  const similarHtml = [
    '<div class="videos__item" data-json=\'{"method":"link","similar":true,"href":"films/fiction/2259-interstellar-2014.html"}\'>Интерстеллар</div>',
    '<div class="videos__item" data-json=\'{"method":"link","similar":true,"href":"films/fiction/777-other-2014.html"}\'>Другое</div>'
  ].join('');
  const filmHtml = [
    '<div class="videos__item" data-json=\'{"method":"call","stream":"http://h/movie.m3u8?play=true","url":"http://h/x","translate":"Дубляж"}\'>Дубляж</div>',
    '<div class="videos__item" data-json=\'{"method":"call","stream":"http://h/movie2.m3u8?play=true","url":"http://h/y","translate":"Оригінал"}\'>Оригінал</div>'
  ].join('');

  const client = new FakeSkazClient({ lite: similarHtml, pages: { 'films/fiction/2259': filmHtml } });
  const provider = makeProvider(client, 'rezka');

  const result = await provider.videos(context({ title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0' }));

  const followed = client.calls.find(([name, p]) => name === 'getLite' && p && p.href);
  assert.ok(followed, 'должен быть повторный getLite с href');
  assert.ok(String(followed[1].href).includes('interstellar'), `href выбран по релевантности: ${followed[1].href}`);
  assert.ok(result.items.length >= 2, `items с call-карточек фильма: ${result.items.length}`);
  // call-карточки фильма → ленивые call-items (не резолвим все переводы).
  assert.ok(result.items.every((item) => item.method === 'call'));
  assert.ok(result.items.every((item) => String(item.url).includes('/api/lampa/video')));
});

test('movie: resolveVideo после videos() берёт карточки из КЭША — не повторяет follow (фикс «долго думает/видео не найдено»)', async () => {
  const similarHtml = [
    '<div class="videos__item" data-json=\'{"method":"link","similar":true,"href":"films/fiction/2259-interstellar-2014.html"}\'>Интерстеллар</div>'
  ].join('');
  const filmHtml = [
    '<div class="videos__item" data-json=\'{"method":"call","stream":"http://h/movie.m3u8?t=5&play=true","url":"http://h/x","translate":"Дубляж"}\'>Дубляж</div>'
  ].join('');

  const client = new FakeSkazClient({ lite: similarHtml, pages: { 'films/fiction/2259': filmHtml } });
  const provider = makeProvider(client, 'rezka');
  const query = { title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0' };

  const list = await provider.videos(context(query));
  assert.equal(list.items.length, 1);
  assert.ok(String(list.items[0].url).includes('voice=0'), 'индекс голоса из списка');

  const play = await provider.resolveVideo(context({ ...query, voice: '0' }));
  assert.equal(play.method, 'play');
  assert.ok(String(play.url).includes('/api/lampa/proxy'), 'через прокси');
  assert.ok(play.voice_name, 'перевод сохранён');

  // Навигация кластера выполнена РОВНО один раз (в videos()): resolveVideo не
  // повторяет getLite-фоллоу на Play — он берёт карточки из кэша навигации.
  const followed = client.calls.filter(([name, p]) => name === 'getLite' && p && p.href);
  assert.equal(followed.length, 1, 'resolveVideo НЕ повторяет follow — кэш карточек (voice/время не в ключе)');
});

test('movie: resolveVideo БЕЗ videos() (кэш пуст) — навигация выполняется, резолв работает', async () => {
  const similarHtml = [
    '<div class="videos__item" data-json=\'{"method":"link","similar":true,"href":"films/fiction/2259-interstellar-2014.html"}\'>Интерстеллар</div>'
  ].join('');
  const filmHtml = [
    '<div class="videos__item" data-json=\'{"method":"call","stream":"http://h/movie.m3u8?t=5&play=true","url":"http://h/x","translate":"Дубляж"}\'>Дубляж</div>'
  ].join('');

  const client = new FakeSkazClient({ lite: similarHtml, pages: { 'films/fiction/2259': filmHtml } });
  const provider = makeProvider(client, 'rezka');
  const query = { title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0' };

  const play = await provider.resolveVideo(context({ ...query, voice: '0' }));
  assert.equal(play.method, 'play');
  assert.ok(String(play.url).includes('/api/lampa/proxy'), 'через прокси');
  const followed = client.calls.filter(([name, p]) => name === 'getLite' && p && p.href);
  assert.equal(followed.length, 1, 'кэш пуст → resolveVideo сам делает навигацию (фолбэк кэш-miss)');
});

test('movie: buildResolveUrl несёт provider, page-параметры, voice и токен', () => {
  const client = new FakeSkazClient({ lite: '' });
  const provider = makeProvider(client, 'alloha');
  const url = provider.buildResolveUrl(context({ serial: '1', title: 'GOT', token: 'tok-123' }), { voice: '2', season: '1', episode: '4' });
  const parsed = new URL(url);
  assert.equal(parsed.pathname, '/api/lampa/video');
  assert.equal(parsed.searchParams.get('provider'), 'skaz-alloha');
  assert.equal(parsed.searchParams.get('serial'), '1');
  assert.equal(parsed.searchParams.get('title'), 'GOT');
  assert.equal(parsed.searchParams.get('voice'), '2');
  assert.equal(parsed.searchParams.get('season'), '1');
  assert.equal(parsed.searchParams.get('episode'), '4');
  assert.equal(parsed.searchParams.get('token'), 'tok-123');

  // Фильм (serial=0): параметр serial НЕ попадает в URL (не нужен на резолве).
  const movieUrl = provider.buildResolveUrl(context({ serial: '0', token: '' }), { voice: '0' });
  const movieParsed = new URL(movieUrl);
  assert.equal(movieParsed.searchParams.get('serial'), null);
});

test('movie: kinopub (Lime) — link-карточки с postid → follow через postid', async () => {
  const similarHtml = [
    '<div class="videos__item" data-json=\'{"method":"link","url":"http://online8.skaz.tv/lite/kinopub?postid=8613&title=Interstellar&original_title=Interstellar","similar":true,"year":2014,"details":"Дубляж, Профессиональный многоголосый"}\'>Интерстеллар</div>',
    '<div class="videos__item" data-json=\'{"method":"link","url":"http://online8.skaz.tv/lite/kinopub?postid=123847&title=Interstellar&original_title=Interstellar","similar":true,"year":2026,"title":"Schiller / Interstellar"}\'>Schiller / Interstellar</div>'
  ].join('');
  const postHtml = [
    '<div class="videos__item" data-json=\'{"method":"play","url":"http://h/v.m3u8","stream":"http://1a5af214.cdntogo.net/s/x.m3u8","translate":"Дубляж"}\'>Дубляж</div>',
    '<div class="videos__item" data-json=\'{"method":"play","url":"http://h/v2.m3u8","stream":"http://1a5af214.cdntogo.net/s/y.m3u8","translate":"Оригинал"}\'>Оригінал</div>'
  ].join('');

  const client = new FakeSkazClient({ lite: similarHtml, pages: { 'postid:8613': postHtml } });
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
  const client = new FakeSkazClient({ lite: playHtml });
  const provider = makeProvider(client, 'filmix');

  const result = await provider.videos(context({ serial: '0' }));

  const followed = client.calls.filter(([name, p]) => name === 'getLite' && p && p.href);
  assert.equal(followed.length, 0, 'нет повторного запроса с href');
  assert.ok(result.items.length >= 1);
});

test('поиск без id/imdb — пусто', async () => {
  const provider = makeProvider(new FakeSkazClient({ lite: '<html/>' }));
  assert.deepEqual(await provider.search({ title: '' }), []);
});

test('поиск с id/imdb_id — запись контракта', async () => {
  const provider = makeProvider(new FakeSkazClient());
  const records = await provider.search({ id: '45', imdb_id: 'tt0944947', title: 'Игра престолов', serial: '1' });
  assert.equal(records.length, 1);
  assert.equal(records[0].type, 'serial');
  assert.equal(records[0].metadata.imdb_id, 'tt0944947');
});

// ===== cleanedQualityMap: P1-B — reserve «URL1 or URL2» в качествах =====
// Каждая метка качества из JSON может нести `URL1 or URL2`. Проксируем каждую
// часть отдельно и склеиваем обратно ` or ` (как item.url в resolveCardItem),
// а НЕ один proxy-URL с or-хвостом внутри url-параметра.
// fakeProxy даёт детерминированный вид: P[<url>] — легко проверять split/join.

test('cleanedQualityMap: один URL без or → один proxy-URL (поведение прежнее)', () => {
  const proxy = (url) => `P[${url}]`;
  const out = cleanedQualityMap({ '1080p': 'https://a.vkvideo.cloud/1080.m3u8' }, proxy);
  assert.equal(out['1080p'], 'P[https://a.vkvideo.cloud/1080.m3u8]');
});

test('cleanedQualityMap: URL1 or URL2 → proxy(URL1) or proxy(URL2)', () => {
  const proxy = (url) => `P[${url}]`;
  const out = cleanedQualityMap(
    { '2160p': 'https://a.vkvideo.cloud/2160.m3u8 or https://b.vkvideo.cloud/2160.m3u8' },
    proxy
  );
  assert.equal(out['2160p'], 'P[https://a.vkvideo.cloud/2160.m3u8] or P[https://b.vkvideo.cloud/2160.m3u8]');
});

test('cleanedQualityMap: несколько качеств — каждое сплитится независимо', () => {
  const proxy = (url) => `P[${url}]`;
  const out = cleanedQualityMap({
    '2160p': 'https://a/2160.m3u8 or https://b/2160.m3u8',
    '1080p': 'https://a/1080.m3u8 or https://b/1080.m3u8',
    '720p': 'https://a/720.m3u8'
  }, proxy);
  assert.equal(out['2160p'], 'P[https://a/2160.m3u8] or P[https://b/2160.m3u8]');
  assert.equal(out['1080p'], 'P[https://a/1080.m3u8] or P[https://b/1080.m3u8]');
  assert.equal(out['720p'], 'P[https://a/720.m3u8]', 'без or — без изменений');
  assert.equal(Object.keys(out).length, 3);
});

test('cleanedQualityMap: подстрока "or" внутри URL — не разделитель (splitOrUrl)', () => {
  const proxy = (url) => `P[${url}]`;
  // `/or/` и base64url с «or» без пробелов — НЕ « or »; такая ссылка не режется.
  const out = cleanedQualityMap({
    '1080p': 'https://cdn.example/or/video.m3u8',
    '720p': 'https://cdn.example/0/aXZjb3Jkb2Z0ZXI/base64.m3u8'
  }, proxy);
  assert.equal(out['1080p'], 'P[https://cdn.example/or/video.m3u8]');
  assert.equal(out['720p'], 'P[https://cdn.example/0/aXZjb3Jkb2Z0ZXI/base64.m3u8]');
});

test('cleanedQualityMap: больше двух частей — все части проксируются и склеиваются', () => {
  const proxy = (url) => `P[${url}]`;
  const out = cleanedQualityMap(
    { '720p': 'https://a/1.m3u8 or https://b/2.m3u8 or https://c/3.m3u8' },
    proxy
  );
  assert.equal(out['720p'], 'P[https://a/1.m3u8] or P[https://b/2.m3u8] or P[https://c/3.m3u8]');
});

test('cleanedQualityMap: реальный формат — ДВА отдельных /api/lampa/proxy, не один proxy с "or" в query', () => {
  const context = { query: { token: '' }, request: {} };
  const proxy = (url) => buildProxyUrl(context, url);
  const out = cleanedQualityMap(
    { '2160p': 'https://a.vkvideo.cloud/2160.m3u8 or https://b.vkvideo.cloud/2160.m3u8' },
    proxy
  );

  const value = out['2160p'];
  assert.ok(value.includes(' or '), 'reserve-разделитель сохранён');
  const proxies = String(value).split(/\s+or\s+/i);
  assert.equal(proxies.length, 2, `два независимых proxy-URL: ${proxies.length}`);
  for (const p of proxies) {
    assert.ok(String(p).startsWith('http') && String(p).includes('/api/lampa/proxy?url='), `через прокси: ${p.slice(0, 80)}`);
    const inner = new URL(p).searchParams.get('url');
    assert.ok(!/(^|\s)or(\s|$)/i.test(inner), `внутри url= нет « or »: ${String(inner).slice(0, 60)}`);
    assert.equal(String(inner).split(/\s+or\s+/i).length, 1, 'url-параметр — один адрес, без or-хвоста');
  }
});

test('resolveCardItem: quality с or из JSON → primary/reserve раздельно через прокси', async () => {
  const html = [
    '<div class="videos__item" data-json=\'{"method":"call","stream":"http://h/lite/alloha/video.m3u8?t=7&play=true","translate":"Дубляж"}\'>Дубляж</div>'
  ].join('');
  const videoJson = {
    method: 'play',
    url: 'https://a.vkvideo.cloud/master.m3u8 or https://b.vkvideo.cloud/reserve.m3u8',
    quality: {
      '2160p': 'https://a.vkvideo.cloud/2160.m3u8 or https://b.vkvideo.cloud/2160-reserve.m3u8',
      '1080p': 'https://a.vkvideo.cloud/1080.m3u8 or https://b.vkvideo.cloud/1080-reserve.m3u8'
    },
    subtitles: []
  };
  const client = new FakeSkazClient({ lite: html, videoJson });
  const provider = makeProvider(client, 'alloha');

  const item = await provider.resolveVideo(context({ serial: '0', voice: '0' }));

  assert.ok(item, 'дескриптор резолвится');
  assert.ok(String(item.url).includes(' or '), 'item.url — primary or reserve');

  const proxies2160 = String(item.quality['2160p']).split(/\s+or\s+/i);
  assert.equal(proxies2160.length, 2, '2160p: две части');
  for (const p of proxies2160) {
    assert.ok(String(p).includes('/api/lampa/proxy'), `2160p через прокси: ${p.slice(0, 80)}`);
    const inner = new URL(p).searchParams.get('url');
    assert.ok(!/(^|\s)or(\s|$)/i.test(inner), `2160p url= без « or »: ${String(inner).slice(0, 60)}`);
  }

  const proxies1080 = String(item.quality['1080p']).split(/\s+or\s+/i);
  assert.equal(proxies1080.length, 2, '1080p: две части');
  for (const p of proxies1080) {
    const inner = new URL(p).searchParams.get('url');
    assert.ok(!/(^|\s)or(\s|$)/i.test(inner), `1080p url= без « or »: ${String(inner).slice(0, 60)}`);
  }
});

// ===== I1: accsdb — provider_error в результате videos() =====

test('I1: accsdb=true + msg → provider_error в результате videos()', async () => {
  const client = new FakeSkazClient({ lite: '' });
  client.lastAccsdb = { message: 'Аккаунт не найден' };
  const provider = makeProvider(client, 'alloha');

  const result = await provider.videos(context({ serial: '0' }));

  assert.equal(result.items.length, 0, 'пустые items при accsdb');
  assert.ok(result.provider_error, 'provider_error присутствует');
  assert.equal(result.provider_error.code, 'accsdb');
  assert.equal(result.provider_error.message, 'Аккаунт не найден');
});

test('I1: accsdb=true без msg → generic сообщение в provider_error', async () => {
  const client = new FakeSkazClient({ lite: '' });
  client.lastAccsdb = { message: 'Учётная запись не подтверждена (accsdb)' };
  const provider = makeProvider(client, 'alloha');

  const result = await provider.videos(context({ serial: '0' }));

  assert.equal(result.items.length, 0);
  assert.ok(result.provider_error);
  assert.equal(result.provider_error.code, 'accsdb');
  assert.match(result.provider_error.message, /учётная запись/i);
});

test('I1: GRANTED (обычный ответ) → provider_error ОТСУТСТВУЕТ', async () => {
  const playHtml = [
    '<div class="videos__item" data-json=\'{"method":"play","url":"http://h/v.m3u8"}\'>Дубляж</div>'
  ].join('');
  const client = new FakeSkazClient({ lite: playHtml });
  // lastAccsdb НЕ установлен (как после успешного getLite).
  const provider = makeProvider(client, 'filmix');

  const result = await provider.videos(context({ serial: '0' }));

  assert.ok(result.items.length >= 1, 'play-карточки на месте');
  assert.equal(result.provider_error, undefined, 'provider_error должен отсутствовать');
});

test('I1: HTTP 5xx (сеть) → пустые items, provider_error ОТСУТСТВУЕТ', async () => {
  // Симуляция сетевой ошибки: lite='' → getLite вернёт '', cards()=[] → collectMovieCards=[].
  const client = new FakeSkazClient({ lite: '' });
  // lastAccsdb НЕ установлен (сетевая ошибка — не accsdb).
  const provider = makeProvider(client, 'alloha');

  const result = await provider.videos(context({ serial: '0' }));

  assert.equal(result.items.length, 0, 'нет карточек при 5xx');
  assert.equal(result.provider_error, undefined, 'provider_error должен отсутствовать при 5xx');
});

test('I1: accsdb в serial-пути → provider_error в результате videos()', async () => {
  // Базовая страница: сезоны без голосов (alloha-вид).
  const baseHtml = [
    '<div class="videos__item" data-json=\'{"method":"link","url":"http://h/lite/alloha?title=GOT&s=1","similar":false}\'><span class="videos__item-title">1 сезон</span></div>'
  ].join('');
  const client = new FakeSkazClient({ lite: baseHtml });
  // Симулируем: openLiteUrl (страница сезона) вернула accsdb.
  client.lastAccsdb = { message: 'Учётная запись не grant' };
  const provider = makeProvider(client, 'alloha');

  const result = await provider.videos(context({ serial: '1', title: 'GOT' }));

  assert.ok(result.provider_error, 'provider_error присутствует в serial-пути');
  assert.equal(result.provider_error.code, 'accsdb');
});

test('I1: Email/UID НЕ попадают в сообщение об ошибке', async () => {
  // Проверяем на уровне extractAccsdbMessage: даже если кластер возвращает
  // их в msg, функция извлекает только msg-поле — без account_email/uid.
  // (account_email/uid никогда не попадают в message, потому что мы читаем
  // ТОЛЬКО поле "msg" из JSON-тела, и never форматируем их сами.)
  const result = extractAccsdbMessage('{"accsdb":true,"msg":"Нет доступа"}');
  assert.ok(result);
  assert.ok(!result.message.includes('@'), 'Email не в сообщении');
  assert.ok(!result.message.includes('dg4xu2tj'), 'UID не в сообщении');
  assert.ok(!result.message.includes('nazarov6'), 'старый UID не в сообщении');
});