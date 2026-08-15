// BALANCER-002: availability-слой (server/src/availability.js).
// Предикат checkSearch (точно как Lampac), параллельный per-card check по видимым
// skaz-балансерам, изоляция сбоев (allSettled), таймаут, кэш 5 мин, host-политика
// (online8 — резерв в конце пула).
// Env задаём ДО динамического import (паттерн registry-twin.test.js): статические
// import'ы хостуются раньше process.env → config.js поднялся бы с пустым аккаунтом.
process.env.NODE_ENV = 'test';
process.env.SKAZ_ENABLED = '1';
process.env.SKAZ_ACCOUNT_EMAIL = 'user@example.com';
process.env.SKAZ_UID = 'abc123';
process.env.SKAZ_BALANCERS = 'alloha,filmix,rezka,kinopub';
process.env.SKAZ_HOSTS = 'http://h1,http://h2';
process.env.SKAZ_CHECK_TIMEOUT_MS = '200';
// Нативные дубли ВЫКЛючены → skaz-alloha/filmix/rezka/kinopub ВИДИМЫ (карточка их проверяет).
process.env.FILMIX_ENABLED = '0';
process.env.REZKA_ENABLED = '0';
process.env.KODIK_ENABLED = '0';
process.env.ALLOHA_ENABLED = '0';
process.env.RUTUBEMOVIE_ENABLED = '0';
process.env.CDNVIDEOHUB_ENABLED = '0';
process.env.COLLAPS_ENABLED = '0';
process.env.HDVB_ENABLED = '0';

import test from 'node:test';
import assert from 'node:assert/strict';

const { createAvailabilityChecker, checkSearchPredicate, fnv1aKey } = await import('../src/availability.js');

function fakeFetch(handler) {
  return async (url, options = {}) => handler(String(url), options);
}

function response(status, body = '') {
  return {
    status,
    ok: status >= 200 && status < 300,
    url: '',
    headers: {},
    body: { cancel: () => {} },
    text: async () => String(body)
  };
}

function balancerOf(url) {
  const match = String(url).match(/\/lite\/([a-z0-9]+)/);
  return match ? match[1] : '';
}

const QUERY = {
  id: '13',
  imdb_id: 'tt0109830',
  title: 'Форрест Гамп',
  original_title: 'Forrest Gump',
  original_language: 'en',
  source: 'tmdb',
  year: 1994,
  serial: 0
};

function makeChecker(handler, options = {}) {
  return createAvailabilityChecker({
    hosts: ['http://h1', 'http://h2'],
    accountEmail: 'user@example.com',
    uid: 'abc123',
    fetchImpl: fakeFetch(handler),
    timeoutMs: 200,
    // retry подтверждения без реальной паузы: повторные пробы считаем по fetch.
    backoffMs: 0,
    ...options
  });
}

function byId(result, id) {
  return result.sources.find((s) => s.id === id);
}

// ===== Предикат (ТОЧНЫЙ как Lampac OnlineApi.cs:975) =====

test('checkSearchPredicate: data-json / type / rch → work=true; пусто/accsdb → false', () => {
  assert.equal(checkSearchPredicate('<html>data-json={"v":1}</html>').work, true);
  assert.equal(checkSearchPredicate('<div>"type":"movie"</div>').work, true);
  assert.equal(checkSearchPredicate('<div>"type":"episode"</div>').work, true);
  assert.equal(checkSearchPredicate('<div>"type":"season"</div>').work, true);

  const rch = checkSearchPredicate('{"rch":true,"ws":"wss://x"}');
  assert.equal(rch.work, true, 'rch — «доступен» по предикату Lampac');
  assert.equal(rch.rch, true);

  assert.equal(checkSearchPredicate('<html>пустая страница</html>').work, false);
  assert.equal(checkSearchPredicate('{"accsdb":true,"msg":"нет"}').work, false);
  assert.equal(checkSearchPredicate('').work, false);

  assert.equal(checkSearchPredicate('<html><!--q:2160p--></html>').quality, '2160p');
  assert.equal(checkSearchPredicate('<html>"2160p" HDR</html>').quality, '2160p');
});

// ===== RULE-1 (NATIVE-AVAILABILITY-002): similar-link-карточки против запрошенного фильма =====

test('checkSearchPredicate (RULE-1): link-карточка на ДРУГОЙ фильм → absent (work=false)', () => {
  const odyssey = { title: 'Одиссея', original_title: 'The Odyssey', year: '2026', imdb_id: 'tt33764258' };
  // kodik: «Бесконечная Одиссея капитана Харлока» 2002 — реальное тело из nginx-лога.
  const kodik = '<html>data-json={"similar":true,"method":"link","title":"Бесконечная Одиссея капитана Харлока","year":2002,"url":"http://x/lite/kodik?kinopoisk_id=46491"}</html>';
  const k = checkSearchPredicate(kodik, odyssey);
  assert.equal(k.work, false, 'substring data-json= БОЛЬШЕ не даёт work');
  assert.equal(k.verdict, 'absent', 'чужой год/тайтл → другой фильм');
  // kinopub: namesake-сериал 1997 (постid=1362) вместо фильма 2026.
  const kinopub = '{"similar":true,"method":"link","title":"Одиссей / The Odyssey","year":1997,"url":"http://x/lite/kinopub?postid=1362"}';
  const kp = checkSearchPredicate(kinopub, odyssey);
  assert.equal(kp.work, false, 'namesake-сериал 1997 ≠ фильм 2026');
  assert.equal(kp.verdict, 'absent');
});

test('checkSearchPredicate (RULE-1): link совпал по KP/год/тайтл → content (work=true)', () => {
  const odyssey = { title: 'Одиссея', original_title: 'The Odyssey', year: '2026', imdb_id: 'tt33764258' };
  // hdvb: kp-туннель к ТОМУ ЖЕ фильму (год совпадает; kp эха сравнить не с чем — q без kp).
  const hdvb = '<html>data-json={"method":"link","year":2026,"url":"http://x/lite/hdvb?kinopoisk_id=6385370&title=The+Odyssey"}</html>';
  assert.equal(checkSearchPredicate(hdvb, odyssey).verdict, 'content');
  // geosaitebi: другой алфавит (грузинский), НЕ «чужой title» → год совпал → контент.
  const geo = '{"method":"link","title":"ოდისეა","year":2026,"url":"http://x/lite/geosaitebi?t=1"}';
  assert.equal(checkSearchPredicate(geo, odyssey).verdict, 'content', 'несопоставимый алфавит не «чужой title»');
  // Точное совпадение названия.
  const same = '{"method":"link","title":"Одиссея","year":2026,"url":"http://x/lite/kodik?d=1"}';
  assert.equal(checkSearchPredicate(same, odyssey).verdict, 'content');
  // Совпавший imdb в url.
  const imdbMatch = '{"method":"link","url":"http://x/lite/kodik?imdb_id=tt33764258"}';
  assert.equal(checkSearchPredicate(imdbMatch, odyssey).verdict, 'content');
});

test('checkSearchPredicate (RULE-1): link без данных для сравнения → inconclusive (work=true)', () => {
  const odyssey = { title: 'Одиссея', original_title: 'The Odyssey', year: '2026', imdb_id: 'tt33764258' };
  const bare = '{"method":"link","url":"http://x/lite/kodik?d=9"}';
  const r = checkSearchPredicate(bare, odyssey);
  assert.equal(r.verdict, 'inconclusive', 'ничего для сравнения → вердикта нет');
  assert.equal(r.work, true, 'inconclusive → показываем (не прячем без доказательства)');
  // method:call/play — контент (даже без data-json-обёртки).
  assert.equal(checkSearchPredicate('{"method":"call","url":"http://x"}', odyssey).verdict, 'content');
  // Сущности в data-json атрибуте.
  const entities = '<html>data-json="{&quot;method&quot;:&quot;call&quot;,&quot;url&quot;:&quot;http://x&quot;}"</html>';
  assert.equal(checkSearchPredicate(entities, odyssey).verdict, 'content');
});

// ===== GAP-005: составной title «RU / EN» — части сравниваются отдельно, не склейкой =====

test('checkSearchPredicate (GAP-005): «Интерстеллар / Interstellar» + совпавший год → content', () => {
  const q = { title: 'Интерстеллар', original_title: 'Interstellar', year: '2014' };
  const card = '{"method":"link","similar":true,"year":2014,"title":"Интерстеллар / Interstellar","url":"http://x/lite/kinopub?postid=8613"}';
  assert.equal(checkSearchPredicate(card, q).verdict, 'content', 'составной title по частям + год → искомый фильм');
});

test('checkSearchPredicate (GAP-005): одиночные названия по-прежнему content', () => {
  const q = { title: 'Интерстеллар', original_title: 'Interstellar', year: '2014' };
  assert.equal(checkSearchPredicate('{"method":"link","title":"Интерстеллар","year":2014,"url":"http://x/lite/kinopub?postid=1"}', q).verdict, 'content');
  assert.equal(checkSearchPredicate('{"method":"link","title":"Interstellar","year":2014,"url":"http://x/lite/kinopub?postid=2"}', q).verdict, 'content');
});

test('checkSearchPredicate (GAP-005): decoy-карточки остаются absent (даже при совпавшем годе)', () => {
  const q = { title: 'Интерстеллар', original_title: 'Interstellar', year: '2014' };
  // Реальный decoy (postid=123847): правая часть «interstellar» совпала, но год другой.
  assert.equal(checkSearchPredicate('{"method":"link","title":"Schiller / Interstellar","year":2026,"url":"http://x/lite/kinopub?postid=123847"}', q).verdict, 'absent', 'Schiller 2026 → чужой год');
  // Чужой тайтл + чужой год.
  assert.equal(checkSearchPredicate('{"method":"link","title":"Быстрее света / Faster than Light","year":2017,"url":"http://x/lite/kinopub?postid=52882"}', q).verdict, 'absent', 'Быстрее света → чужой фильм');
  // Док «Наука Интерстеллар»: год совпал, но часть НЕ равна ровно (подстрока) → absent.
  assert.equal(checkSearchPredicate('{"method":"link","title":"Наука Интерстеллар / The Science of Interstellar","year":2014,"url":"http://x/lite/kinopub?postid=19932"}', q).verdict, 'absent', 'док с совпавшим годом → absent');

  // «Последний дом слева» vs запрос «Последний дом»: части не равны ровно, даже если год совпал.
  const lh = { title: 'Последний дом', original_title: 'The Last House', year: '2026' };
  assert.equal(checkSearchPredicate('{"method":"link","title":"Последний дом слева / The Last House on the Left","year":2026,"url":"http://x/lite/kinopub?postid=2536"}', lh).verdict, 'absent', 'год совпал, но название другое');
  assert.equal(checkSearchPredicate('{"method":"link","title":"Последний дом слева / The Last House on the Left","year":2009,"url":"http://x/lite/kinopub?postid=2536"}', lh).verdict, 'absent', 'чужой год');

  // «Одиссей / The Odyssey» 1997 vs запрос «Одиссея» 2026: часть odyssey совпала, но год другой.
  const od = { title: 'Одиссея', original_title: 'The Odyssey', year: '2026' };
  assert.equal(checkSearchPredicate('{"method":"link","title":"Одиссей / The Odyssey","year":1997,"url":"http://x/lite/kinopub?postid=1362"}', od).verdict, 'absent', 'namesake-сериал 1997');
  assert.equal(checkSearchPredicate('{"method":"link","title":"Одиссея / The Odyssey","year":1992,"url":"http://x/lite/kinopub?postid=17578"}', od).verdict, 'absent', 'namesake-сериал 1992');
});

test('checkSearchPredicate (GAP-005): ID сильнее title/year; чужой ID — absent', () => {
  const q = { title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', imdb_id: 'tt0816692', kinopoisk_id: '157336' };
  // Совпавший imdb при «чужом» составном title/год → content (ID побеждает).
  assert.equal(checkSearchPredicate('{"method":"link","title":"Другое / Something","year":1999,"url":"http://x/lite/kinopub?postid=1&imdb_id=tt0816692"}', q).verdict, 'content', 'imdb совпал → контент');
  // Совпавший kp при «чужом» title/год → content.
  assert.equal(checkSearchPredicate('{"method":"link","title":"Другое / Something","year":1999,"url":"http://x/lite/kinopub?postid=2&kinopoisk_id=157336"}', q).verdict, 'content', 'kp совпал → контент');
  // Чужой imdb при совпавшем составном title/год → absent (ID чужой).
  assert.equal(checkSearchPredicate('{"method":"link","title":"Интерстеллар / Interstellar","year":2014,"url":"http://x/lite/kinopub?postid=3&imdb_id=tt9999999"}', q).verdict, 'absent', 'чужой imdb → другой фильм');
  // Чужой kp при совпавшем title/год → absent.
  assert.equal(checkSearchPredicate('{"method":"link","title":"Интерстеллар / Interstellar","year":2014,"url":"http://x/lite/kinopub?postid=4&kinopoisk_id=999999"}', q).verdict, 'absent', 'чужой kp → другой фильм');
});

test('fnv1aKey: стабильный и разный для разных ключей', () => {
  const a = fnv1aKey('13:0:tmdb:4:uid-1');
  const b = fnv1aKey('94997:0:tmdb:4:uid-1');
  const a2 = fnv1aKey('13:0:tmdb:4:uid-1');
  assert.ok(a && a2 === a, 'один ключ → один hash');
  assert.notEqual(a, b, 'разные карточки → разные ключи');
});

// ===== card(): фильм/сериал, изоляция, параллельность, кэш =====

test('card: фильм с несколькими источниками — show по предикату, сбой одного не ломает других', async () => {
  const seen = [];
  const checker = makeChecker((url) => {
    seen.push(String(url));
    const b = balancerOf(url);
    if (b === 'alloha') return Promise.resolve(response(200, '<html>data-json={"r":"x"}</html>'));
    if (b === 'rezka') return Promise.resolve(response(200, '<html><div>"type":"movie"</div></html>'));
    if (b === 'filmix') return Promise.resolve(response(200, 'null'));
    if (b === 'kinopub') return Promise.resolve(response(503, 'disable'));
    return Promise.resolve(response(200, '<html>ok</html>'));
  });

  const result = await checker.card(QUERY, 'uid-1');
  assert.equal(result.count, 4);
  assert.equal(result.cached, false);
  assert.equal(byId(result, 'skaz-alloha').show, true, 'data-json → доступен');
  assert.equal(byId(result, 'skaz-rezka').show, true, 'type movie → доступен');
  // TRUSTED_ALWAYS_VISIBLE: skaz-filmix (native выключен → видимый skaz) НЕ пробируется
  // и всегда показывается, даже когда кластер отвечает «нет».
  assert.equal(byId(result, 'skaz-filmix').show, true, 'trusted → видим (кластер «нет» не прячет)');
  assert.equal(byId(result, 'skaz-filmix').trusted, true, 'политика помечена trusted');
  assert.equal(byId(result, 'skaz-kinopub').show, false, '503 на всех хостах → нет источника');

  for (const b of ['alloha', 'rezka', 'kinopub']) {
    assert.ok(seen.some((u) => balancerOf(u) === b), `запрошен балансер ${b}`);
  }
  assert.ok(!seen.some((u) => balancerOf(u) === 'filmix'), 'trusted filmix НЕ запрашивается');
  assert.ok(seen.every((u) => u.includes('account_email=user%40example.com') && u.includes('uid=abc123')), 'auth в URL каждого запроса');
  assert.ok(seen.some((u) => u.includes('checksearch=true') && balancerOf(u) === 'kinopub'), 'pass1 kinopub — checksearch');
  // kinopub вернул «нет» → подтверждение прямым lite-page (без checksearch).
  assert.ok(seen.some((u) => !u.includes('checksearch=true') && balancerOf(u) === 'kinopub'), 'kinopub подтверждение — прямой lite-page');
});

test('card: сериал — serial=1 в checksearch URL', async () => {
  let captured = '';
  const checker = makeChecker((url) => {
    captured = String(url);
    return Promise.resolve(response(200, '<html>"type":"episode"</html>'));
  });
  const result = await checker.card({ ...QUERY, id: '94997', serial: 1 }, 'uid-1');
  assert.ok(captured.includes('serial=1'), `serial=1 в URL: ${captured}`);
  assert.equal(byId(result, 'skaz-alloha').show, true, 'type episode → сериал доступен');
});

test('card: фейк-id — рыхлые балансеры (data-json на любой запрос) → show:true', async () => {
  const checker = makeChecker(() => Promise.resolve(response(200, '<html>data-json={"x":1}</html>')));
  const result = await checker.card({ id: '999999999', title: 'Nonexistent', serial: 0 }, 'uid-1');
  assert.equal(result.sources.length, 4);
  assert.ok(result.sources.every((s) => s.show), 'все рыхлые → show:true (как E-Online)');
});

test('card: таймаут балансера изолирован — НЕ прячем (вердикта нет), остальные отвечают', async () => {
  const checker = makeChecker((url, options = {}) => {
    if (balancerOf(url) === 'rezka') {
      // Виснет до abort (fake уважает signal).
      return new Promise((resolve, reject) => {
        const signal = options.signal;
        if (signal?.aborted) return reject(new Error('aborted'));
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  }, { timeoutMs: 120 });

  const result = await checker.card(QUERY, 'uid-1');
  assert.equal(byId(result, 'skaz-rezka').show, true, 'таймаут = вердикта нет → показываем оптимистично');
  assert.equal(byId(result, 'skaz-rezka').inconclusive, true, 'ряд помечен inconclusive (не кэшируется)');
  assert.equal(byId(result, 'skaz-alloha').show, true, 'другие балансеры не задеты');
  assert.equal(byId(result, 'skaz-filmix').show, true);
});

test('card: 404/500 на всех хостах — кластер ответил «нет» → show:false (вердикт)', async () => {
  const checker = makeChecker((url) => {
    const b = balancerOf(url);
    if (b === 'filmix') return Promise.resolve(response(404, 'not found'));
    if (b === 'kinopub') return Promise.resolve(response(500, 'disable'));
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  });
  const result = await checker.card(QUERY, 'uid-1');
  assert.equal(byId(result, 'skaz-filmix').show, true, 'trusted → видим даже при 404 кластера');
  assert.equal(byId(result, 'skaz-filmix').trusted, true);
  assert.equal(byId(result, 'skaz-kinopub').show, false, '500 на всех хостах → нет источника');
  assert.equal(byId(result, 'skaz-kinopub').authoritative, true, 'это вердикт, не транзиент');
  assert.equal(byId(result, 'skaz-alloha').show, true);
  assert.equal(byId(result, 'skaz-rezka').show, true);
});

// ===== КРИТИЧЕСКИЙ ГЕЙТ: подтверждение «нет» прямым lite-page (confirmAbsence) =====

test('card: checksearch «нет» + прямой lite-page «да» → show:true (не прячем рабочий источник)', async () => {
  const seen = [];
  const checker = makeChecker((url) => {
    seen.push(String(url));
    const b = balancerOf(url);
    const search = String(url).includes('checksearch=true');
    if (b === 'kinopub') {
      if (search) return Promise.resolve(response(503, 'disable')); // search флакнул
      return Promise.resolve(response(200, '<html>data-json={"method":"play","url":"http://x/m.m3u8"}</html>')); // карточка есть
    }
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  });
  const result = await checker.card(QUERY, 'uid-1');
  assert.equal(byId(result, 'skaz-kinopub').show, true, 'прямой lite-page подтвердил источник → показываем');
  assert.equal(byId(result, 'skaz-kinopub').confirmed, true, 'ряд прошёл подтверждение');
  assert.equal(byId(result, 'skaz-kinopub').authoritative, true, 'подтверждение авторитетно');
  assert.ok(seen.some((u) => balancerOf(u) === 'kinopub' && u.includes('checksearch=true')), 'pass1 — checksearch');
  assert.ok(seen.some((u) => balancerOf(u) === 'kinopub' && !u.includes('checksearch=true')), 'подтверждение — прямой lite-page');
  assert.equal(byId(result, 'skaz-alloha').confirmed, undefined, '«да» без подтверждения — confirmed нет');
});

test('card: checksearch «нет» + прямой lite-page «нет» → show:false (двойная проверка скрыла)', async () => {
  const checker = makeChecker((url) => {
    if (balancerOf(url) === 'kinopub') return Promise.resolve(response(503, 'disable'));
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  });
  const result = await checker.card(QUERY, 'uid-1');
  const row = byId(result, 'skaz-kinopub');
  assert.equal(row.show, false, 'оба механизма сказали «нет» → скрыт');
  assert.equal(row.authoritative, true, 'подтверждённый вердикт — авторитетный');
  assert.equal(row.confirmed, true, 'прошёл подтверждение');
});

test('card: подтверждение инконклюзивно (таймаут прямого lite-page) → первичное «нет» сохраняется (RULE-4), карточка кэшируется с hasInconclusive', async () => {
  let fetches = 0;
  const checker = makeChecker((url, options = {}) => {
    fetches += 1;
    const b = balancerOf(url);
    const search = String(url).includes('checksearch=true');
    if (b === 'kinopub' && search) return Promise.resolve(response(503, 'disable'));
    if (b === 'kinopub' && !search) {
      return new Promise((resolve, reject) => {
        const signal = options.signal;
        if (signal?.aborted) return reject(new Error('aborted'));
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  }, { timeoutMs: 120, ttlMs: 60_000 });
  const first = await checker.card(QUERY, 'uid-1');
  // Первичный checksearch = ЧИСТЫЙ «нет» (503); подтверждение вердикта НЕ дало (таймаут).
  // RULE-4: инконклюзивное подтверждение не переворачивает definitive «нет» в показ.
  assert.equal(byId(first, 'skaz-kinopub').show, false, 'definitive «нет» от checksearch не переворачивается инконклюзивным подтверждением');
  assert.equal(byId(first, 'skaz-kinopub').inconclusive, true, 'подтверждение не дало ответа → ряд inconclusive');
  assert.equal(byId(first, 'skaz-kinopub').confirmInconclusive, true, 'диагностический флаг инконклюзивного подтверждения');
  assert.equal(first.hasInconclusive, true, 'entry помечена hasInconclusive (НЕ definitive)');
  const fetchesBefore = fetches;
  const second = await checker.card(QUERY, 'uid-1');
  assert.equal(second.cached, true, 'INCONCLUSIVE не блокирует кэш (BALANCER-STABILITY-002)');
  assert.equal(fetches, fetchesBefore, 'hit — без повторного checksearch');
  assert.equal(byId(second, 'skaz-kinopub').show, false, 'вердикт пережил кэш');
  assert.equal(byId(second, 'skaz-kinopub').inconclusive, true, 'hit сохраняет INCONCLUSIVE — не сворачивает в definitive');
  assert.equal(byId(second, 'skaz-kinopub').confirmInconclusive, true, 'RULE-4 состояние пережило кэш');
  assert.equal(second.hasInconclusive, true, 'hit отдаёт hasInconclusive');
});

test('card: accsdb-отказ — вердикта нет → show:true, INCONCLUSIVE-ряд кэшируется (BALANCER-STABILITY-002)', async () => {
  let fetches = 0;
  const checker = makeChecker((url) => {
    fetches += 1;
    const b = balancerOf(url);
    // Кластер отвечает отказом учётки, но «да» — через подтверждение (эмуляция флака).
    if (b === 'kinopub' && String(url).includes('checksearch=true')) return Promise.resolve(response(200, '{"accsdb":true,"msg":"Войдите в аккаунт"}'));
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  }, { ttlMs: 60_000 });
  const first = await checker.card(QUERY, 'uid-1');
  assert.equal(byId(first, 'skaz-kinopub').show, true, 'accsdb = вердикта нет → показываем оптимистично');
  assert.equal(byId(first, 'skaz-kinopub').inconclusive, true);
  assert.equal(byId(first, 'skaz-kinopub').accsdb, true);
  assert.equal(first.hasInconclusive, true);
  const second = await checker.card(QUERY, 'uid-1');
  assert.equal(second.cached, true, 'INCONCLUSIVE-ряд не блокирует кэш');
  assert.equal(byId(second, 'skaz-kinopub').inconclusive, true, 'hit сохраняет INCONCLUSIVE');
  assert.equal(byId(second, 'skaz-kinopub').accsdb, true, 'accsdb-пометка пережила кэш');
});

test('card: подтверждённый «нет» кэшируется (двойная проверка + retry) — 2-й вызов без fetch', async () => {
  let fetches = 0;
  const checker = makeChecker(() => {
    fetches += 1;
    return Promise.resolve(response(503, 'disable'));
  }, { ttlMs: 60_000 });
  // 3 не-trusted балансера (filmix trusted — без пробы) «нет» на 2 хостах:
  //   pass1 (checksearch)    = 3×2
  //   подтверждение (прямой) = 3×2
  //   retry подтверждения    = 3×2 (hide выжил после паузы — настоящий absent)
  // Итого 18; 2-й вызов — кэш (hide TTL 60с). filmix при этом виден (trusted).
  const first = await checker.card(QUERY, 'uid-1');
  const second = await checker.card(QUERY, 'uid-1');
  const nonTrusted = first.sources.filter((s) => !s.trusted);
  assert.equal(nonTrusted.length, 3, '3 не-trusted + filmix trusted');
  assert.equal(first.sources.filter((s) => s.show === false).length, 3, 'все 3 не-trusted скрыты (двойной «нет» + retry)');
  assert.equal(byId(first, 'skaz-filmix').show, true, 'filmix trusted → видим');
  assert.ok(nonTrusted.every((s) => s.confirmed === true), 'каждый не-trusted «нет» прошёл подтверждение');
  assert.ok(nonTrusted.every((s) => s.retried === true), 'hide перепроверен с retry');
  assert.equal(second.cached, true, 'двойной вердикт — кэшируется');
  assert.equal(fetches, 18, '3 не-trusted × (2 pass1 + 2 подтверждение + 2 retry) = 18; filmix без пробы; 2-й вызов без fetch');
});

test('card: retry подтверждения — первый прямой «нет», повтор нашёл карточку → show:true, retried', async () => {
  let directFetches = 0;
  const checker = makeChecker((url) => {
    const b = balancerOf(url);
    if (b === 'kinopub') {
      if (String(url).includes('checksearch=true')) return Promise.resolve(response(503, 'disable')); // search — «нет»
      directFetches += 1;
      // Первый прямой прогон (оба хоста) — «нет» (окно насыщения); retry — «да».
      if (directFetches <= 2) return Promise.resolve(response(503, 'disable'));
      return Promise.resolve(response(200, '<html>data-json={"method":"play","url":"http://x/m.m3u8"}</html>'));
    }
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  }, { backoffMs: 1 });
  const result = await checker.card(QUERY, 'uid-1');
  const row = byId(result, 'skaz-kinopub');
  assert.equal(row.show, true, 'retry после окна насыщения → источник видим');
  assert.equal(row.retried, true, 'диагностическая пометка повтора');
  assert.equal(row.confirmed, true);
  assert.equal(directFetches, 3, 'подтверждение: 2×«нет», retry: 1-й хост «да» (стоп)');
});

test('checkBalancer: смешанный вердикт (хост 503 + хост таймаут) → show:true (вердикта нет)', async () => {
  const checker = createAvailabilityChecker({
    hosts: ['http://h1', 'http://h2'],
    accountEmail: 'user@example.com',
    uid: 'abc123',
    timeoutMs: 120,
    fetchImpl: fakeFetch((url, options = {}) => {
      if (String(url).includes('h1')) return Promise.resolve(response(503, ''));
      return new Promise((resolve, reject) => {
        const signal = options.signal;
        if (signal?.aborted) return reject(new Error('aborted'));
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    })
  });
  const row = await checker.checkBalancer('alloha', QUERY, Date.now() + 10_000);
  assert.equal(row.show, true, 'есть no-response → вердикта нет → оптимистично показываем');
  assert.equal(row.inconclusive, true);
});

test('card: inconclusive-ряд (таймаут) кэшируется — 2-й вызов hit без повторного checksearch', async () => {
  let fetches = 0;
  const checker = makeChecker((url, options = {}) => {
    fetches += 1;
    const b = balancerOf(url);
    if (b === 'rezka') {
      return new Promise((resolve, reject) => {
        const signal = options.signal;
        if (signal?.aborted) return reject(new Error('aborted'));
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  }, { timeoutMs: 120, ttlMs: 60_000 });

  const first = await checker.card(QUERY, 'uid-1');
  const second = await checker.card(QUERY, 'uid-1');
  assert.equal(first.cached, false);
  assert.equal(second.cached, true, 'INCONCLUSIVE не блокирует кэш (BALANCER-STABILITY-002)');
  assert.equal(byId(second, 'skaz-rezka').show, true);
  assert.equal(byId(second, 'skaz-rezka').inconclusive, true, 'hit сохраняет INCONCLUSIVE — фактический вердикт');
  assert.equal(second.hasInconclusive, true);
  assert.equal(fetches, 4, 'второй вызов — hit без re-checksearch (первый: 2×1 контент-стоп + 2 таймаут = 4; filmix trusted не пробируется)');
});

test('card: параллельно — все НЕ-trusted балансеры запрошены одновременно', async () => {
  let active = 0;
  let maxActive = 0;
  const checker = makeChecker(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 30));
    active -= 1;
    return response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>');
  });
  await checker.card(QUERY, 'uid-1');
  assert.equal(maxActive, 3, `все 3 не-trusted балансера в полёте одновременно (maxActive=${maxActive}; filmix trusted без пробы)`);
});

test('card: кэш-hit — второй вызов без повторного fetch', async () => {
  let fetches = 0;
  const checker = makeChecker(() => {
    fetches += 1;
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  }, { ttlMs: 60_000 });

  const first = await checker.card(QUERY, 'uid-1');
  const second = await checker.card(QUERY, 'uid-1');
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(fetches, 3, 'после кэша новых fetch нет (3 = первый прогон; filmix trusted без пробы)');
  assert.deepEqual(
    second.sources.map((s) => [s.id, s.show]),
    first.sources.map((s) => [s.id, s.show])
  );
});

test('card: кэш-miss — другой id → повторный fetch', async () => {
  let fetches = 0;
  const checker = makeChecker(() => {
    fetches += 1;
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  }, { ttlMs: 60_000 });

  await checker.card(QUERY, 'uid-1');
  await checker.card({ ...QUERY, id: '94997' }, 'uid-1');
  assert.equal(fetches, 6, 'другой id → новый прогон (3+3; filmix trusted без пробы)');
});

test('card: кэш разделён по userUid', async () => {
  let fetches = 0;
  const checker = makeChecker(() => {
    fetches += 1;
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  }, { ttlMs: 60_000 });

  await checker.card(QUERY, 'uid-1');
  await checker.card(QUERY, 'uid-2');
  assert.equal(fetches, 6, 'разные пользователи → разные кэши (3+3; filmix trusted без пробы)');
});

// ===== BALANCER-STABILITY-002: INCONCLUSIVE не блокирует кэш, tri-state сохраняется =====

test('card: MIXED (available + inconclusive + unavailable) → кэшируется целиком; hit возвращает тот же набор и вердикты', async () => {
  const checker = makeChecker((url, options = {}) => {
    const b = balancerOf(url);
    if (b === 'alloha') return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>')); // AVAILABLE
    if (b === 'kinopub') return Promise.resolve(response(503, 'disable')); // UNAVAILABLE (подтверждение тоже «нет»)
    if (b === 'rezka') { // INCONCLUSIVE
      return new Promise((resolve, reject) => {
        const signal = options.signal;
        if (signal?.aborted) return reject(new Error('aborted'));
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>')); // filmix trusted
  }, { timeoutMs: 120, ttlMs: 60_000 });

  const first = await checker.card(QUERY, 'uid-1');
  assert.equal(first.cached, false);
  assert.equal(byId(first, 'skaz-alloha').show, true, 'AVAILABLE');
  assert.equal(byId(first, 'skaz-rezka').show, true, 'INCONCLUSIVE → показ');
  assert.equal(byId(first, 'skaz-rezka').inconclusive, true, 'INCONCLUSIVE остаётся distinct-состоянием');
  assert.equal(byId(first, 'skaz-kinopub').show, false, 'UNAVAILABLE');
  assert.equal(byId(first, 'skaz-kinopub').confirmed, true, 'подтверждённый «нет»');
  assert.equal(first.hasInconclusive, true, 'entry с inconclusive помечена hasInconclusive');
  assert.deepEqual(first.sources.map((s) => [s.id, s.show]),
    [['skaz-alloha', true], ['skaz-filmix', true], ['skaz-rezka', true], ['skaz-kinopub', false]], '3 состояния в наборе');

  const second = await checker.card(QUERY, 'uid-1');
  assert.equal(second.cached, true, 'MIXED-карточка кэшируется целиком');
  assert.equal(second.elapsedMs, 0, 'hit — мгновенный');
  assert.deepEqual(second.sources.map((s) => [s.id, s.show]),
    first.sources.map((s) => [s.id, s.show]), 'hit возвращает тот же source-set');
  assert.equal(byId(second, 'skaz-rezka').inconclusive, true, 'INCONCLUSIVE пережил кэш (не свёрнут в show:true/false)');
  assert.equal(byId(second, 'skaz-kinopub').confirmed, true, 'confirmed hide пережил кэш');
  assert.equal(second.hasInconclusive, true);
});

test('card: 10 последовательных запросов — 1 MISS + 9 HIT, набор одинаковый 10/10', async () => {
  const checker = makeChecker((url, options = {}) => {
    const b = balancerOf(url);
    if (b === 'rezka') { // INCONCLUSIVE — кэш-кейс из real-карточки
      return new Promise((resolve, reject) => {
        const signal = options.signal;
        if (signal?.aborted) return reject(new Error('aborted'));
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  }, { timeoutMs: 120, ttlMs: 60_000 });

  const results = [];
  for (let i = 0; i < 10; i++) results.push(await checker.card(QUERY, 'uid-1'));
  assert.equal(results[0].cached, false, 'первый — MISS (полный check)');
  for (let i = 1; i < 10; i++) assert.equal(results[i].cached, true, `запрос #${i} — HIT`);
  const sets = new Set(results.map((r) => r.sources.map((s) => `${s.id}:${s.show}`).join('|')));
  assert.equal(sets.size, 1, 'один и тот же набор source visibility 10/10');
  assert.ok(results.every((r) => r.hasInconclusive), 'INCONCLUSIVE-карточка кэшируется и отдаёт hasInconclusive');
});

test('card: serial/source в ключе — отдельные кэши (по существующему fnv1a key)', async () => {
  let fetches = 0;
  const checker = makeChecker(() => {
    fetches += 1;
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  }, { ttlMs: 60_000 });
  await checker.card(QUERY, 'uid-1');
  await checker.card({ ...QUERY, serial: 1 }, 'uid-1');       // serial в ключе
  await checker.card({ ...QUERY, source: 'kinopoisk' }, 'uid-1'); // source в ключе
  assert.equal(fetches, 9, 'id/serial/source — отдельные ключи (3×3; filmix trusted без пробы)');
  // season в ключ НЕ входит (как Lampac memkey Fnv1a(id:serial:source:count:uid)) —
  // изменение season не создаёт новый ключ, это задокументированное поведение.
});

test('card: TTL — после истечения кэш перепроверяет (механизм 5-мин TTL)', async () => {
  let fetches = 0;
  const checker = makeChecker(() => {
    fetches += 1;
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  }, { ttlMs: 50 });
  const first = await checker.card(QUERY, 'uid-1');
  const second = await checker.card(QUERY, 'uid-1');
  assert.equal(second.cached, true, 'в пределах TTL — hit');
  await new Promise((resolve) => setTimeout(resolve, 70));
  const third = await checker.card(QUERY, 'uid-1');
  assert.equal(third.cached, false, 'после TTL — свежий check');
  assert.equal(fetches, 6, '2 полных прогона (первый + после TTL); вторая — hit без fetch');
});

test('card: self-heal — INCONCLUSIVE-кэш НЕ definitive; force возвращает свежий вердикт и заменяет entry', async () => {
  let mutated = false;
  const checker = makeChecker((url, options = {}) => {
    const b = balancerOf(url);
    if (b === 'rezka' && !mutated) {
      return new Promise((resolve, reject) => {
        const signal = options.signal;
        if (signal?.aborted) return reject(new Error('aborted'));
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  }, { timeoutMs: 120, ttlMs: 60_000 });

  const first = await checker.card(QUERY, 'uid-1');
  assert.equal(byId(first, 'skaz-rezka').inconclusive, true, 'сначала INCONCLUSIVE (таймаут)');
  assert.equal(first.hasInconclusive, true);

  mutated = true; // контент появился
  const forced = await checker.card(QUERY, 'uid-1', true);
  assert.equal(forced.cached, false, 'force — принудительный refresh');
  assert.equal(byId(forced, 'skaz-rezka').show, true, 'свежий вердикт: контент доступен');
  assert.equal(byId(forced, 'skaz-rezka').inconclusive, undefined, 'INCONCLUSIVE ушёл');
  assert.equal(forced.hasInconclusive, false, 'новая entry — чистая');

  const after = await checker.card(QUERY, 'uid-1');
  assert.equal(after.cached, true, 'форс-результат заменяет entry → следующий — hit');
  assert.equal(byId(after, 'skaz-rezka').inconclusive, undefined, 'hit отдаёт новый вердикт, не старый INCONCLUSIVE');
});

// ===== BALANCER-STABILITY-003: single-flight для /sources/card =====
// Параллельные запросы ОДНОГО cache-key+force-флага → ОДИН upstream calc (probe-цикл),
// join-запросы получают тот же Promise → тот же объект результата (sources ===). Разные
// userUid/serial/source → разные flightKey → не дедуплицируются и не блокируют друг друга.
// force изолирован от non-force. Entry удаляется в finally → flight не «застревает».
// Счётчик fetch на calc при контент-хэндлере = 3 (alloha, rezka, kinopub; filmix trusted).

// Счётчик — объект: замыкание мутирует поле, а не переприсваивает примитив-параметр.
function contentHandler(counter) {
  return () => {
    counter.n += 1;
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  };
}

function newContentChecker(options = {}) {
  const counter = { n: 0 };
  return { checker: makeChecker(contentHandler(counter), { ttlMs: 60_000, ...options }), counter };
}

function concurrentCards(checker, n, query = QUERY, uid = 'uid-1', force = false) {
  return Promise.all(Array.from({ length: n }, () => checker.card(query, uid, force)));
}

test('card: single-flight — 5 параллельных одинаковых запросов = 1 upstream calc, все получают ТОТ ЖЕ результат', async () => {
  const { checker, counter } = newContentChecker();
  const results = await concurrentCards(checker, 5);
  assert.equal(counter.n, 3, 'один calc на 5 параллельных (alloha+rezka+kinopub; filmix trusted без пробы)');
  assert.ok(results.every((r) => r.cached === false), 'все — в полёте (кэш ещё не записан)');
  assert.ok(results.every((r) => r.sources === results[0].sources), 'тот же объект результата: join-запросы разделили ОДИН promise');
  const sets = new Set(results.map((r) => r.sources.map((s) => `${s.id}:${s.show}`).join('|')));
  assert.equal(sets.size, 1, 'идентичный набор source visibility 5/5');
  const after = await checker.card(QUERY, 'uid-1');
  assert.equal(after.cached, true, 'результат полёта закэширован');
  assert.equal(counter.n, 3, 'hit не делает upstream');
});

test('card: single-flight — 10 и 20 параллельных одинаковых запросов: один calc каждый раз', async () => {
  for (const n of [10, 20]) {
    const { checker, counter } = newContentChecker();
    const results = await concurrentCards(checker, n);
    assert.equal(counter.n, 3, `${n} параллельных → 1 calc`);
    assert.ok(results.every((r) => r.sources === results[0].sources), `${n} запросов — один объект результата`);
  }
});

test('card: single-flight — разные userUid НЕ дедуплицируются и не блокируют друг друга', async () => {
  const { checker, counter } = newContentChecker();
  const [a, b, c] = await Promise.all([
    checker.card(QUERY, 'uid-1'),
    checker.card(QUERY, 'uid-2'),
    checker.card(QUERY, 'uid-3')
  ]);
  assert.equal(counter.n, 9, '3 разных uid × 3 источника = 3 отдельных calc');
  assert.ok(a.sources !== b.sources && b.sources !== c.sources && a.sources !== c.sources, 'разные uid → разные полёты (не общий объект)');
  assert.ok(a.cached === false && b.cached === false && c.cached === false, 'все три — полноценные calc');
});

test('card: single-flight — serial/source в ключе: параллельные разные ключи не блокируют друг друга', async () => {
  const { checker, counter } = newContentChecker();
  const results = await Promise.all([
    checker.card(QUERY, 'uid-1'),
    checker.card({ ...QUERY, serial: 1 }, 'uid-1'),
    checker.card({ ...QUERY, source: 'kinopoisk' }, 'uid-1')
  ]);
  assert.equal(counter.n, 9, '3 разных cache-key → 3 calc');
  assert.ok(results.every((r) => r.cached === false), 'каждый ключ — свой полёт');
  assert.ok(new Set(results.map((r) => r.sources)).size === 3, 'разные объекты результатов');
});

test('card: single-flight — force изолирован от non-force; force+force — один calc', async () => {
  // (а) force ∥ force → один flight
  const { checker: checkerA, counter: counterA } = newContentChecker();
  const forces = await concurrentCards(checkerA, 3, QUERY, 'uid-1', true);
  assert.equal(counterA.n, 3, '3 force параллельно → 1 calc');
  assert.ok(forces.every((r) => r.sources === forces[0].sources), 'force-полёт общий (flightKey :f)');
  assert.ok(forces.every((r) => r.cached === false), 'force — всегда полёт, кэш не читается');

  // (б) non-force ∥ force (оба cache-miss) → ДВА calc: force не «наследует» non-force
  const { checker: checkerB, counter: counterB } = newContentChecker();
  const [normal, forced] = await Promise.all([
    checkerB.card(QUERY, 'uid-1', false),
    checkerB.card(QUERY, 'uid-1', true)
  ]);
  assert.equal(counterB.n, 6, 'non-force (:n) и force (:f) — разные flightKey → 2 calc');
  assert.ok(normal.sources !== forced.sources, 'force не делит результат с идущим non-force полётом');
});

test('card: single-flight — slow-flight (rezka таймаутит) разделяется всеми; после разрешения flight чист', async () => {
  const fetches = [];
  const checker = makeChecker((url, options = {}) => {
    const b = balancerOf(url);
    fetches.push(b);
    if (b === 'rezka') {
      // «завис»: ответа нет, fetchHost оборвёт по таймауту → INCONCLUSIVE (вердикта нет → показ)
      return new Promise((resolve, reject) => {
        const signal = options.signal;
        if (signal?.aborted) return reject(new Error('aborted'));
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  }, { timeoutMs: 60, ttlMs: 60_000 });

  const t0 = Date.now();
  const results = await concurrentCards(checker, 5);
  const batchMs = Date.now() - t0;

  assert.equal(fetches.filter((b) => b === 'rezka').length, 2, 'rezka пробована один раз (h1+h2), НЕ 5 раз');
  assert.ok(results.every((r) => r.sources === results[0].sources), 'все 5 разделяют один полёт');
  assert.equal(byId(results[0], 'skaz-rezka').inconclusive, true, 'таймаут → INCONCLUSIVE, не «нет»');
  assert.equal(results[0].hasInconclusive, true);
  assert.ok(batchMs < 500, `все 5 уложились в ~один calc (${batchMs}ms), а не 5× (~600ms)`);

  // recovery: после разрешения полёта кэш HIT; flight-словарь пуст → force делает свежий calc
  const after = await checker.card(QUERY, 'uid-1');
  assert.equal(after.cached, true, 'после разрешения полёта — кэш');
  const beforeForce = fetches.length;
  await checker.card(QUERY, 'uid-1', true);
  assert.ok(fetches.length > beforeForce, 'force после полёта — свежий calc (flight не «застрял» на старом promise)');
});

test('card: OLD∩NEW гейт сохранён — подтверждённый hide переживает кэш-hit (confirmed/authoritative)', async () => {
  const checker = makeChecker((url) => {
    if (balancerOf(url) === 'kinopub') return Promise.resolve(response(503, 'disable'));
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  }, { ttlMs: 60_000 });
  const first = await checker.card(QUERY, 'uid-1');
  const second = await checker.card(QUERY, 'uid-1');
  for (const r of [first, second]) {
    const row = byId(r, 'skaz-kinopub');
    assert.equal(row.show, false, 'оба сигнала «нет» → скрыт');
    assert.equal(row.confirmed, true, 'гейт прошёл подтверждение — пережил кэш');
    assert.equal(row.authoritative, true);
  }
});

// ===== checkBalancer: host-политика =====

test('checkBalancer: хост-фолбэк 503 → 200 content на следующем хосте', async () => {
  const seen = [];
  const checker = makeChecker((url) => {
    seen.push(String(url));
    if (String(url).includes('h1')) return Promise.resolve(response(503, 'disable'));
    return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
  });
  const row = await checker.checkBalancer('alloha', QUERY, Date.now() + 10_000);
  assert.equal(row.show, true);
  assert.equal(row.status, 200);
  assert.ok(seen[0].includes('h1'));
  assert.ok(seen[1].includes('h2'));
});

test('checkBalancer: online8 — резерв, идёт ПОСЛЕ primary (данные с primary, online8 не тронут)', async () => {
  const seen = [];
  const checker = createAvailabilityChecker({
    hosts: ['http://online8.skaz.tv', 'http://online3.skaz.tv', 'http://94.249.239.63'],
    accountEmail: 'user@example.com',
    uid: 'abc123',
    fetchImpl: fakeFetch((url) => {
      seen.push(String(url));
      return Promise.resolve(response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>'));
    })
  });
  const row = await checker.checkBalancer('alloha', QUERY, Date.now() + 10_000);
  assert.equal(row.show, true);
  assert.ok(seen[0].startsWith('http://online3.skaz.tv'), 'online3 первым, не online8');
  assert.equal(seen.length, 1, 'авторитетный ответ с primary останавливает ротацию (.63/online8 не тронуты)');
});

test('checkBalancer: online8-only балансер (primary 403 disable → online8 rch) → show:true', async () => {
  const seen = [];
  const checker = createAvailabilityChecker({
    hosts: ['http://online3.skaz.tv', 'http://online8.skaz.tv'],
    accountEmail: 'user@example.com',
    uid: 'abc123',
    fetchImpl: fakeFetch((url) => {
      seen.push(String(url));
      if (String(url).includes('online3')) return Promise.resolve(response(403, 'disable'));
      return Promise.resolve(response(200, '{"rch":true,"ws":"wss://x"}'));
    })
  });
  const row = await checker.checkBalancer('lift', QUERY, Date.now() + 10_000);
  assert.equal(row.show, true, 'rch — «доступен» по предикату Lampac');
  assert.equal(row.rch, true);
  assert.ok(seen[seen.length - 1].includes('online8'), 'online8 — последний резерв');
});

test('checkBalancer: accsdb — отказ учётки, вердикта нет → show:true (optimistic), ротация продолжается', async () => {
  const seen = [];
  const checker = createAvailabilityChecker({
    hosts: ['http://h1', 'http://h2'],
    accountEmail: 'user@example.com',
    uid: 'abc123',
    fetchImpl: fakeFetch((url) => {
      seen.push(String(url));
      return Promise.resolve(response(200, '{"accsdb":true,"msg":"Нет доступа"}'));
    })
  });
  const row = await checker.checkBalancer('alloha', QUERY, Date.now() + 10_000);
  assert.equal(row.show, true, 'accsdb не доказывает отсутствия источника — показываем оптимистично');
  assert.equal(row.inconclusive, true, 'отказ авторизации = вердикта нет, как таймаут');
  assert.equal(row.accsdb, true);
  assert.equal(seen.length, 2, 'ротация продолжается: следующий хост может ответить контентом');
});

test('checkBalancer: accsdb на первом хосте, контент на втором → авторитетный show:true', async () => {
  const seen = [];
  const checker = createAvailabilityChecker({
    hosts: ['http://h1', 'http://h2'],
    accountEmail: 'user@example.com',
    uid: 'abc123',
    fetchImpl: fakeFetch((url) => {
      seen.push(String(url));
      const isH2 = String(url).startsWith('http://h2');
      return Promise.resolve(isH2
        ? response(200, '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>')
        : response(200, '{"accsdb":true,"msg":"Нет доступа"}'));
    })
  });
  const row = await checker.checkBalancer('alloha', QUERY, Date.now() + 10_000);
  assert.equal(row.show, true);
  assert.equal(row.authoritative, true);
  assert.equal(seen.length, 2);
});
