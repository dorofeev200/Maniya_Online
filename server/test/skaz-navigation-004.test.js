// BALANCER-KINOPUB-004 — навигация по similar-ссылкам выбирает ТОЛЬКО карточку
// запрошенного фильма (год/название/ID). Нет подходящей → пусто, а НЕ первый
// похожий фильм (Одиссея 2026 ≠ postid 1362/1997, Последний дом 2026 ≠ 2536/2009).
// Сериальный путь (openSeasonPage) и прямые play/call-страницы не затронуты.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SkazProvider } from '../src/providers/skaz/SkazProvider.js';

// ===== фейковый клиент: getLite → lite / pages (href, postid:N) =====
class FakeSkazClient {
  constructor(options = {}) {
    this.lite = String(options.lite ?? '');
    this.pages = options.pages || {};
    this.calls = [];
  }
  enabled() { return true; }
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
}

function makeProvider(client, balancer = 'kinopub') {
  return new SkazProvider({
    id: `skaz-${balancer}`,
    title: balancer,
    balancer,
    client
  });
}

function context(query) {
  return { query: { token: '', ...query }, request: {} };
}

// ===== фикстуры (реальные data-json с кластера, см. trace-kinopub-003) =====
const ODYSSEY_CARDS = [
  { method: 'link', similar: true, year: 1997, title: 'Одиссей / The Odyssey', url: 'http://online8.skaz.tv/lite/kinopub?postid=1362&title=%D0%9E%D0%B4%D0%B8%D1%81%D1%81%D0%B5%D1%8F&original_title=The+Odyssey' },
  { method: 'link', similar: true, year: 1992, title: 'Одиссея / The Odyssey', url: 'http://online8.skaz.tv/lite/kinopub?postid=17578&title=%D0%9E%D0%B4%D0%B8%D1%81%D1%81%D0%B5%D1%8F&original_title=The+Odyssey' },
  { method: 'link', similar: true, year: 2016, title: 'Florence + the Machine: The Odyssey', url: 'http://online8.skaz.tv/lite/kinopub?postid=20295&title=%D0%9E%D0%B4%D0%B8%D1%81%D1%81%D0%B5%D1%8F&original_title=The+Odyssey' }
];
const ODYSSEY_QUERY = { id: '1368337', imdb_id: 'tt33764258', title: 'Одиссея', original_title: 'The Odyssey', year: '2026', serial: '0' };

const LAST_HOUSE_CARDS = [
  { method: 'link', similar: true, year: 2009, title: 'Последний дом слева / The Last House on the Left', url: 'http://online8.skaz.tv/lite/kinopub?postid=2536&title=%D0%9F%D0%BE%D1%81%D0%BB%D0%B5%D0%B4%D0%BD%D0%B8%D0%B9+%D0%B4%D0%BE%D0%BC&original_title=The+Last+House' },
  { method: 'link', similar: true, year: 1972, title: 'Последний дом слева / The Last House on the Left', url: 'http://online8.skaz.tv/lite/kinopub?postid=12646&title=%D0%9F%D0%BE%D1%81%D0%BB%D0%B5%D0%B4%D0%BD%D0%B8%D0%B9+%D0%B4%D0%BE%D0%BC&original_title=The+Last+House' }
];
const LAST_HOUSE_QUERY = { id: '1284041', imdb_id: 'tt32268156', title: 'Последний дом', original_title: 'The Last House', year: '2026', serial: '0' };

const INTERSTELLAR_CARDS = [
  { method: 'link', similar: true, year: 2014, title: 'Интерстеллар / Interstellar', url: 'http://online8.skaz.tv/lite/kinopub?postid=8613&title=%D0%98%D0%BD%D1%82%D0%B5%D1%80%D1%81%D1%82%D0%B5%D0%BB%D0%BB%D0%B0%D1%80&original_title=Interstellar' },
  { method: 'link', similar: true, year: 1997, title: 'Интерстеллар: Начало / Interstellar 0', url: 'http://online8.skaz.tv/lite/kinopub?postid=999&title=%D0%98%D0%BD%D1%82%D0%B5%D1%80%D1%81%D1%82%D0%B5%D0%BB%D0%BB%D0%B0%D1%80&original_title=Interstellar' }
];
const INTERSTELLAR_QUERY = { title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0' };

const cardHtml = (cards) => cards.map((c) =>
  `<div class="videos__item videos__season selector focused" data-json='${JSON.stringify(c)}'>x</div>`
).join('');

// ===== чистые тесты выбора цели (предикат / postid / href) =====

test('Одиссея 2026: similar-карточки ДРУГИХ лет → НЕ выбираются (postid=null, href=null)', () => {
  const provider = makeProvider(new FakeSkazClient());
  assert.equal(provider.movieHref(ODYSSEY_CARDS, ODYSSEY_QUERY), null, 'href не выбирается');
  assert.equal(provider.postidFromCards(ODYSSEY_CARDS, ODYSSEY_QUERY), null, 'postid не выбирается');
});

test('Последний дом 2026: similar-карточки 2009/1972 → НЕ выбираются (postid=null)', () => {
  const provider = makeProvider(new FakeSkazClient());
  assert.equal(provider.movieHref(LAST_HOUSE_CARDS, LAST_HOUSE_QUERY), null);
  assert.equal(provider.postidFromCards(LAST_HOUSE_CARDS, LAST_HOUSE_QUERY), null);
});

test('Интерстеллар 2014: карточка с совпадающим годом+названием выбирается, decoy другого года — нет', () => {
  const provider = makeProvider(new FakeSkazClient());
  const postid = provider.postidFromCards(INTERSTELLAR_CARDS, INTERSTELLAR_QUERY);
  assert.equal(postid, 8613, 'первая подходящая карточка (год 2014)');
  const href = provider.movieHref(INTERSTELLAR_CARDS, INTERSTELLAR_QUERY);
  assert.ok(href && href.includes('postid=8613'), `href на подходящую карточку: ${href}`);
});

test('ID сильнее года: imdb в URL совпал, год/название расходятся → карточка ВЫБИРАЕТСЯ', () => {
  const provider = makeProvider(new FakeSkazClient());
  const cards = [
    { method: 'link', similar: true, year: 1990, title: 'Нечто / The Thing', url: 'http://h/lite/kinopub?postid=1&imdb_id=tt0109830' }
  ];
  const query = { title: 'Форрест Гамп', original_title: 'Forrest Gump', imdb_id: 'tt0109830', year: '1994', serial: '0' };
  assert.equal(provider.postidFromCards(cards, query), 1, 'ID совпал → цель');
});

test('ID чужой: imdb в URL отличается → карточка НЕ выбирается', () => {
  const provider = makeProvider(new FakeSkazClient());
  const cards = [
    { method: 'link', similar: true, year: 1994, title: 'Форрест Гамп / Forrest Gump', url: 'http://h/lite/kinopub?postid=2&imdb_id=tt9999999' }
  ];
  const query = { title: 'Форрест Гамп', original_title: 'Forrest Gump', imdb_id: 'tt0109830', year: '1994', serial: '0' };
  assert.equal(provider.postidFromCards(cards, query), null, 'чужой imdb → другой фильм');
});

test('Название «Русское / Original»: совпавшая часть → выбирается (без года)', () => {
  const provider = makeProvider(new FakeSkazClient());
  const cards = [
    { method: 'link', similar: true, title: 'Форрест Гамп / Forrest Gump', url: 'http://h/lite/kinopub?postid=42' }
  ];
  const query = { title: 'Форрест Гамп', original_title: 'Forrest Gump', serial: '0' }; // года нет
  assert.equal(provider.postidFromCards(cards, query), 42);
});

test('Сопоставимые алфавиты, ни одна часть не совпала → НЕ выбирается (title-мисмэтч)', () => {
  const provider = makeProvider(new FakeSkazClient());
  const cards = [
    { method: 'link', similar: true, title: 'Другой фильм / Something Else', url: 'http://h/lite/kinopub?postid=7' }
  ];
  const query = { title: 'Форрест Гамп', original_title: 'Forrest Gump', serial: '0' };
  assert.equal(provider.postidFromCards(cards, query), null);
});

test('Несопоставимый алфавит (грузинское название) — вердикта нет → выбирается (не ломаем geosaitebi)', () => {
  const provider = makeProvider(new FakeSkazClient());
  const cards = [
    { method: 'link', similar: true, title: 'ინტერსტელარი', url: 'http://h/lite/kinopub?postid=5' }
  ];
  const query = { title: 'Интерстеллар', original_title: 'Interstellar', serial: '0' };
  assert.equal(provider.postidFromCards(cards, query), 5);
});

test('Название из _text (у карточки нет title в data-json) — как у реальной выдачи kinopub', () => {
  const provider = makeProvider(new FakeSkazClient());
  const cards = [
    { method: 'link', similar: true, year: 2014, _text: 'Интерстеллар', url: 'http://h/lite/kinopub?postid=8613' }
  ];
  assert.equal(provider.postidFromCards(cards, INTERSTELLAR_QUERY), 8613);
});

// ===== интеграция: collectMovieCards / videos() =====

test('Одиссея 2026 (интеграция): videos() пусто, postid НЕ запрашивается', async () => {
  const playHtml = '<div class="videos__item" data-json=\'{"method":"play","url":"http://h/v.m3u8","translate":"Дубляж"}\'>x</div>';
  const client = new FakeSkazClient({ lite: cardHtml(ODYSSEY_CARDS), pages: { 'postid:1362': playHtml } });
  const provider = makeProvider(client);

  const result = await provider.videos(context(ODYSSEY_QUERY));

  assert.equal(result.items.length, 0, 'пусто — НЕ переходим на 1997-минисериал');
  const postidCalls = client.calls.filter(([name, p]) => name === 'getLite' && p && p.postid != null);
  assert.equal(postidCalls.length, 0, 'никаких getLite с postid не было');
});

test('Интерстеллар 2014 (интеграция): подходящий postid выбран, items есть', async () => {
  const playHtml = [
    '<div class="videos__item" data-json=\'{"method":"play","url":"http://h/v.m3u8","stream":"http://cdntogo/x.m3u8","translate":"Дубляж"}\'>x</div>',
    '<div class="videos__item" data-json=\'{"method":"play","url":"http://h/v2.m3u8","stream":"http://cdntogo/y.m3u8","translate":"Оригинал"}\'>y</div>'
  ].join('');
  const client = new FakeSkazClient({ lite: cardHtml(INTERSTELLAR_CARDS), pages: { 'postid:8613': playHtml } });
  const provider = makeProvider(client);

  const result = await provider.videos(context(INTERSTELLAR_QUERY));

  const postidCalls = client.calls.filter(([name, p]) => name === 'getLite' && p && p.postid != null);
  assert.equal(postidCalls.length, 1);
  assert.equal(postidCalls[0][1].postid, '8613', 'переход на подходящий postid');
  assert.ok(result.items.length >= 2, `items по play-карточкам: ${result.items.length}`);
  assert.ok(result.items.every((item) => item.method === 'play'));
});

test('Сразу play-карточки (фильм-страница) — навигация не нужна, items на месте', async () => {
  const playHtml = '<div class="videos__item" data-json=\'{"method":"play","url":"http://h/v.m3u8","quality":{"1080p":"http://h/1080.m3u8"},"title":"Х"}\'>x</div>';
  const client = new FakeSkazClient({ lite: playHtml });
  const provider = makeProvider(client, 'filmix');

  const result = await provider.videos(context({ serial: '0' }));

  const postidCalls = client.calls.filter(([name, p]) => name === 'getLite' && p && p.postid != null);
  const hrefCalls = client.calls.filter(([name, p]) => name === 'getLite' && p && p.href);
  assert.equal(postidCalls.length, 0, 'нет postid-перехода');
  assert.equal(hrefCalls.length, 0, 'нет href-фоллоу');
  assert.ok(result.items.length >= 1);
});

test('Сериал: openSeasonPage-путь НЕ затронут — сезоны/переводы/серии работают', async () => {
  const baseAlloha = [
    '<div class="videos__item" data-json=\'{"method":"link","url":"http://h/lite/alloha?title=GOT&s=1","similar":false}\'><span class="videos__item-title">1 сезон</span></div>',
    '<div class="videos__item" data-json=\'{"method":"link","url":"http://h/lite/alloha?title=GOT&s=2","similar":false}\'><span class="videos__item-title">2 сезон</span></div>'
  ].join('');
  const season1Html = [
    '<div class="videos__item" data-json=\'{"method":"link","url":"http://h/lite/alloha/s?t=138&s=1","similar":false}\'><span class="videos__item-title">Рен-ТВ</span></div>',
    '<div class="videos__item" data-json=\'{"method":"call","url":"http://h/x","stream":"http://h/video.m3u8?t=138&s=1&e=1&play=true","s":1,"e":1,"name":"1 серия"}\'>s</div>',
    '<div class="videos__item" data-json=\'{"method":"call","url":"http://h/y","stream":"http://h/video.m3u8?t=138&s=1&e=2&play=true","s":1,"e":2,"name":"2 серия"}\'>s</div>'
  ].join('');

  const client = new FakeSkazClient({ lite: baseAlloha, pages: { 's=1': season1Html } });
  const provider = makeProvider(client, 'alloha');

  const result = await provider.videos(context({ serial: '1', title: 'GOT' }));

  assert.equal(result.seasons.length, 2, 'сезоны на месте');
  assert.ok(result.items.length >= 2, `серии со страницы сезона: ${result.items.length}`);
  assert.equal(result.items[0].episode, 1);
  assert.equal(result.items[0].method, 'call', 'серии — ленивые call-карточки');
});
