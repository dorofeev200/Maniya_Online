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
  assert.equal(byId(result, 'skaz-filmix').show, false, 'null на всех хостах → нет источника');
  assert.equal(byId(result, 'skaz-kinopub').show, false, '503 на всех хостах → нет источника');

  for (const b of ['alloha', 'rezka', 'filmix', 'kinopub']) {
    assert.ok(seen.some((u) => balancerOf(u) === b), `запрошен балансер ${b}`);
  }
  assert.ok(seen.every((u) => u.includes('account_email=user%40example.com') && u.includes('uid=abc123')), 'auth в URL каждого запроса');
  assert.ok(seen.some((u) => u.includes('checksearch=true') && balancerOf(u) === 'filmix'), 'pass1 filmix — checksearch');
  assert.ok(seen.some((u) => u.includes('checksearch=true') && balancerOf(u) === 'kinopub'), 'pass1 kinopub — checksearch');
  // filmix/kinopub вернули «нет» → подтверждение прямым lite-page (без checksearch).
  assert.ok(seen.some((u) => !u.includes('checksearch=true') && balancerOf(u) === 'filmix'), 'filmix подтверждение — прямой lite-page');
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
    return Promise.resolve(response(200, '<html>data-json={}</html>'));
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
    return Promise.resolve(response(200, '<html>data-json={}</html>'));
  });
  const result = await checker.card(QUERY, 'uid-1');
  assert.equal(byId(result, 'skaz-filmix').show, false, '404 на всех хостах → нет источника');
  assert.equal(byId(result, 'skaz-kinopub').show, false, '500 на всех хостах → нет источника');
  assert.equal(byId(result, 'skaz-filmix').authoritative, true, 'это вердикт, не транзиент');
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
      return Promise.resolve(response(200, '<html>data-json={"v":1}</html>')); // карточка есть
    }
    return Promise.resolve(response(200, '<html>data-json={}</html>'));
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
    return Promise.resolve(response(200, '<html>data-json={}</html>'));
  });
  const result = await checker.card(QUERY, 'uid-1');
  const row = byId(result, 'skaz-kinopub');
  assert.equal(row.show, false, 'оба механизма сказали «нет» → скрыт');
  assert.equal(row.authoritative, true, 'подтверждённый вердикт — авторитетный');
  assert.equal(row.confirmed, true, 'прошёл подтверждение');
});

test('card: подтверждение инконклюзивно (таймаут прямого lite-page) → show:true, карточка не кэшируется', async () => {
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
    return Promise.resolve(response(200, '<html>data-json={}</html>'));
  }, { timeoutMs: 120, ttlMs: 60_000 });
  const first = await checker.card(QUERY, 'uid-1');
  assert.equal(byId(first, 'skaz-kinopub').show, true, 'нет вердикта → оптимистично показываем');
  assert.equal(byId(first, 'skaz-kinopub').inconclusive, true, 'подтверждение не дало ответа');
  const second = await checker.card(QUERY, 'uid-1');
  assert.equal(second.cached, false, 'стрессовая карточка не фиксируется на 5 минут');
});

test('card: все accsdb-отказы — вердикта нет → show:true, карточка НЕ кэшируется (self-heal)', async () => {
  let fetches = 0;
  const checker = makeChecker((url) => {
    fetches += 1;
    const b = balancerOf(url);
    // Кластер отвечает отказом учётки, но «да» — через подтверждение (эмуляция флака).
    if (b === 'kinopub' && String(url).includes('checksearch=true')) return Promise.resolve(response(200, '{"accsdb":true,"msg":"Войдите в аккаунт"}'));
    return Promise.resolve(response(200, '<html>data-json={}</html>'));
  }, { ttlMs: 60_000 });
  const first = await checker.card(QUERY, 'uid-1');
  assert.equal(byId(first, 'skaz-kinopub').show, true, 'accsdb = вердикта нет → показываем оптимистично');
  assert.equal(byId(first, 'skaz-kinopub').inconclusive, true);
  assert.equal(byId(first, 'skaz-kinopub').accsdb, true);
  const second = await checker.card(QUERY, 'uid-1');
  assert.equal(second.cached, false, 'accsdb-флак не фиксируется на 5 минут — следующий запрос перепроверит');
});

test('card: подтверждённый «нет» кэшируется (двойная проверка + retry) — 2-й вызов без fetch', async () => {
  let fetches = 0;
  const checker = makeChecker(() => {
    fetches += 1;
    return Promise.resolve(response(503, 'disable'));
  }, { ttlMs: 60_000 });
  // Все 4 балансера «нет» на 2 хостах:
  //   pass1 (checksearch)    = 4×2
  //   подтверждение (прямой) = 4×2
  //   retry подтверждения    = 4×2 (hide выжил после паузы — настоящий absent)
  // Итого 24; 2-й вызов — кэш (hide TTL 60с).
  const first = await checker.card(QUERY, 'uid-1');
  const second = await checker.card(QUERY, 'uid-1');
  assert.ok(first.sources.every((s) => s.show === false), 'все скрыты (двойной «нет» + retry)');
  assert.ok(first.sources.every((s) => s.confirmed === true), 'каждый «нет» прошёл подтверждение');
  assert.ok(first.sources.every((s) => s.retried === true), 'hide перепроверен с retry');
  assert.equal(second.cached, true, 'двойной вердикт — кэшируется');
  assert.equal(fetches, 24, '4 балансера × (2 pass1 + 2 подтверждение + 2 retry) = 24, 2-й вызов без fetch');
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
      return Promise.resolve(response(200, '<html>data-json={"v":1}</html>'));
    }
    return Promise.resolve(response(200, '<html>data-json={}</html>'));
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

test('card: inconclusive-ряд (таймаут) НЕ кэшируется — 2-й вызов перепроверяет', async () => {
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
    return Promise.resolve(response(200, '<html>data-json={}</html>'));
  }, { timeoutMs: 120, ttlMs: 60_000 });

  const first = await checker.card(QUERY, 'uid-1');
  const second = await checker.card(QUERY, 'uid-1');
  assert.equal(first.cached, false);
  assert.equal(second.cached, false, 'стрессовая карточка не фиксируется на 5 минут');
  assert.equal(byId(second, 'skaz-rezka').show, true);
  assert.equal(fetches, 10, 'повторный полный прогон (3×1 контент-стоп + 2 таймаут = 5, ×2 карточки)');
});

test('card: параллельно — все балансеры запрошены одновременно', async () => {
  let active = 0;
  let maxActive = 0;
  const checker = makeChecker(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 30));
    active -= 1;
    return response(200, '<html>data-json={}</html>');
  });
  await checker.card(QUERY, 'uid-1');
  assert.equal(maxActive, 4, `все 4 балансера в полёте одновременно (maxActive=${maxActive})`);
});

test('card: кэш-hit — второй вызов без повторного fetch', async () => {
  let fetches = 0;
  const checker = makeChecker(() => {
    fetches += 1;
    return Promise.resolve(response(200, '<html>data-json={}</html>'));
  }, { ttlMs: 60_000 });

  const first = await checker.card(QUERY, 'uid-1');
  const second = await checker.card(QUERY, 'uid-1');
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(fetches, 4, 'после кэша новых fetch нет (4 = первый прогон)');
  assert.deepEqual(
    second.sources.map((s) => [s.id, s.show]),
    first.sources.map((s) => [s.id, s.show])
  );
});

test('card: кэш-miss — другой id → повторный fetch', async () => {
  let fetches = 0;
  const checker = makeChecker(() => {
    fetches += 1;
    return Promise.resolve(response(200, '<html>data-json={}</html>'));
  }, { ttlMs: 60_000 });

  await checker.card(QUERY, 'uid-1');
  await checker.card({ ...QUERY, id: '94997' }, 'uid-1');
  assert.equal(fetches, 8, 'другой id → новый прогон (4+4)');
});

test('card: кэш разделён по userUid', async () => {
  let fetches = 0;
  const checker = makeChecker(() => {
    fetches += 1;
    return Promise.resolve(response(200, '<html>data-json={}</html>'));
  }, { ttlMs: 60_000 });

  await checker.card(QUERY, 'uid-1');
  await checker.card(QUERY, 'uid-2');
  assert.equal(fetches, 8, 'разные пользователи → разные кэши');
});

// ===== checkBalancer: host-политика =====

test('checkBalancer: хост-фолбэк 503 → 200 content на следующем хосте', async () => {
  const seen = [];
  const checker = makeChecker((url) => {
    seen.push(String(url));
    if (String(url).includes('h1')) return Promise.resolve(response(503, 'disable'));
    return Promise.resolve(response(200, '<html>data-json={}</html>'));
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
      return Promise.resolve(response(200, '<html>data-json={}</html>'));
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
        ? response(200, '<html>data-json={"v":1}</html>')
        : response(200, '{"accsdb":true,"msg":"Нет доступа"}'));
    })
  });
  const row = await checker.checkBalancer('alloha', QUERY, Date.now() + 10_000);
  assert.equal(row.show, true);
  assert.equal(row.authoritative, true);
  assert.equal(seen.length, 2);
});
