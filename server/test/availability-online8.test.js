// BALANCER-ONLINE8-002: политика голоса резервной легаси-ноды online8 (abstain).
// Покрывает SHADOW-фикс в availability.js: для НЕ-kinopub балансеров при
// reservePolicy='abstain' online8 ВОЗДЕРЖИВАЕТСЯ — её быстрый 403 `disable`/503/
// 2xx-non-content это политика ноды «модуль выключен», а НЕ «контента нет»
// (док. BALANCER-ONLINE8-001 §9-б/г). hide возможен ТОЛЬКО от content-«нет»
// primary (2xx-non-content / accsdb-«Ожидаем фильм»). Kinopub и legacy —
// byte-identical (новый тест для абстаина + подтверждение legacy/kino-кейсов).
// Env задаём ДО динамического import (паттерн availability.test.js).
process.env.NODE_ENV = 'test';
process.env.SKAZ_ENABLED = '1';
process.env.SKAZ_ACCOUNT_EMAIL = 'user@example.com';
process.env.SKAZ_UID = 'abc123';
process.env.SKAZ_BALANCERS = 'alloha,filmix,rezka,kinopub';
process.env.SKAZ_HOSTS = 'http://online3.skaz.tv,http://online8.skaz.tv';
process.env.SKAZ_CHECK_TIMEOUT_MS = '200';
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

const { createAvailabilityChecker } = await import('../src/availability.js');

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

// Хост-пул как в проде: primary online3 + резерв online8 ПОСЛЕДНИМ (isReserveHost).
const HOSTS = ['http://online3.skaz.tv', 'http://online8.skaz.tv'];

function makeChecker(handler, options = {}) {
  return createAvailabilityChecker({
    hosts: HOSTS,
    accountEmail: 'user@example.com',
    uid: 'abc123',
    fetchImpl: fakeFetch(handler),
    timeoutMs: 200,
    backoffMs: 0,
    ...options
  });
}

const CONTENT = '<html>data-json={"method":"call","url":"http://x/m.m3u8"}</html>';
const NON_CONTENT = 'null';
const DISABLE = 'disable'; // 7 байт, 403-профиль online8

// ===== reservePolicy='abstain' (не-kinopub): online8 воздерживается =====

test('abstain: online3=503 + online8=403 disable → show (primary статусный шум + online8 воздержание ≠ «нет») (rule 3)', async () => {
  const seen = [];
  const checker = makeChecker((url) => {
    seen.push(String(url));
    if (String(url).includes('online3')) return Promise.resolve(response(503, ''));
    return Promise.resolve(response(403, DISABLE));
  }, { reservePolicy: 'abstain' });
  const row = await checker.checkBalancer('filmix', QUERY, Date.now() + 10_000);
  assert.equal(row.show, true, '403 disable от online8 не «контента нет»');
  assert.equal(row.authoritative, false);
  assert.equal(row.inconclusive, true, 'три-стейт сохранён: show = inconclusive, не permanent show:true');
  assert.equal(row.mixed, true, 'status-шум + abstain помечены mixed');
  assert.ok(seen[0].includes('online3'), 'online3 (primary) первым');
  assert.ok(seen[1].includes('online8'), 'online8 (резерв) последним');
});

test('abstain: online3=200 `null` + online8=403 disable → hide (content-«нет» primary авторитетен, online8 не переворачивает) (rule 5/7)', async () => {
  const checker = makeChecker((url) => {
    if (String(url).includes('online3')) return Promise.resolve(response(200, NON_CONTENT));
    return Promise.resolve(response(403, DISABLE));
  }, { reservePolicy: 'abstain' });
  const row = await checker.checkBalancer('filmix', QUERY, Date.now() + 10_000);
  assert.equal(row.show, false, '2xx-non-content с primary — настоящее «нет»');
  assert.equal(row.authoritative, true, 'вердикт, не транзиент');
  assert.equal(row.verdict, 'absent');
});

test('abstain: online3=200 контент + online8=403 disable → show authoritative (primary-вердикт, online8 не достигнут) (rule 6)', async () => {
  const seen = [];
  const checker = makeChecker((url) => {
    seen.push(String(url));
    if (String(url).includes('online3')) return Promise.resolve(response(200, CONTENT));
    return Promise.resolve(response(403, DISABLE));
  }, { reservePolicy: 'abstain' });
  const row = await checker.checkBalancer('filmix', QUERY, Date.now() + 10_000);
  assert.equal(row.show, true);
  assert.equal(row.authoritative, true);
  assert.equal(seen.length, 1, 'контент с primary останавливает ротацию (online8 не тронут)');
});

test('abstain: online3=таймаут + online8=200 `null` → show (no-response → inconclusive; online8 abstain не «нет») (rule 3)', async () => {
  const checker = makeChecker((url) => {
    if (String(url).includes('online3')) throw new Error('timeout');
    return Promise.resolve(response(200, NON_CONTENT));
  }, { reservePolicy: 'abstain' });
  const row = await checker.checkBalancer('filmix', QUERY, Date.now() + 10_000);
  assert.equal(row.show, true, 'нет ни одного content-«нет» → не прячем');
  assert.equal(row.inconclusive, true);
});

test('abstain: online3=accsdb-«Ожидаем фильм» + online8=403 disable → hide (RULE-2 content-«нет» primary)', async () => {
  const checker = makeChecker((url) => {
    if (String(url).includes('online3')) {
      return Promise.resolve(response(200, '{"accsdb":true,"msg":"Ожидаем фильм в хорошем качестве. Добавим позже"}'));
    }
    return Promise.resolve(response(403, DISABLE));
  }, { reservePolicy: 'abstain' });
  const row = await checker.checkBalancer('filmix', QUERY, Date.now() + 10_000);
  assert.equal(row.show, false, 'accsdb-«Ожидаем фильм» с primary = content-«нет» (RULE-2)');
  assert.equal(row.authoritative, true);
});

// ===== legacy (дефолт): byte-identical — online8 403/2xx-non-content даёт «нет» =====

test('legacy (default): online3=503 + online8=403 disable → hide (прежнее поведение сохранено)', async () => {
  const checker = makeChecker((url) => {
    if (String(url).includes('online3')) return Promise.resolve(response(503, ''));
    return Promise.resolve(response(403, DISABLE));
  });
  const row = await checker.checkBalancer('filmix', QUERY, Date.now() + 10_000);
  assert.equal(row.show, false, 'legacy: не-2xx online8 = «нет»-голос → hide');
  assert.equal(row.authoritative, true);
  assert.equal(row.verdict, 'absent');
});

test('legacy (default): online3=200 контент + online8=403 → show authoritative (primary останавливает ротацию)', async () => {
  const seen = [];
  const checker = makeChecker((url) => {
    seen.push(String(url));
    if (String(url).includes('online3')) return Promise.resolve(response(200, CONTENT));
    return Promise.resolve(response(403, DISABLE));
  });
  const row = await checker.checkBalancer('filmix', QUERY, Date.now() + 10_000);
  assert.equal(row.show, true);
  assert.equal(row.authoritative, true);
  assert.equal(seen.length, 1);
});

// ===== kinopub: абстаин НЕ применяется (реально живёт на online8, rule 8) =====

test('abstain НЕ влияет на kinopub: online3=503 + online8=403 disable → hide (как legacy)', async () => {
  const checker = makeChecker((url) => {
    if (String(url).includes('online3')) return Promise.resolve(response(503, ''));
    return Promise.resolve(response(403, DISABLE));
  }, { reservePolicy: 'abstain' });
  const row = await checker.checkBalancer('kinopub', QUERY, Date.now() + 10_000);
  assert.equal(row.show, false, 'kinopub вне abstain-политики — прежний вердикт');
  assert.equal(row.authoritative, true);
});

test('abstain НЕ влияет на kinopub: online3=503 + online8=200 `null` → hide (2xx-non-content online8 = «нет»)', async () => {
  const checker = makeChecker((url) => {
    if (String(url).includes('online3')) return Promise.resolve(response(503, ''));
    return Promise.resolve(response(200, NON_CONTENT));
  }, { reservePolicy: 'abstain' });
  const row = await checker.checkBalancer('kinopub', QUERY, Date.now() + 10_000);
  assert.equal(row.show, false);
  assert.equal(row.verdict, 'absent');
});

// ===== карточка (card): абстаин в связке с confirm-гейтом (checksearch + lite-page) =====

test('card (abstain): ВСЕ хосты non-2xx (полный скан без контента) → strict-подтверждение → hide (BALANCER-FINAL-AVAILABILITY-001)', async () => {
  const checker = makeChecker((url) => {
    if (String(url).includes('online3')) return Promise.resolve(response(503, ''));
    return Promise.resolve(response(403, DISABLE));
  }, { reservePolicy: 'abstain' });
  const result = await checker.card(QUERY, 'uid-1');
  // skaz-alloha (НЕ в TRUSTED_ALWAYS_VISIBLE — проверка честно идёт через probe).
  const row = result.sources.find((s) => s.id === 'skaz-alloha');
  assert.ok(row, 'skaz-alloha виден в карточке');
  // Раньше (до фикса): optimistic-show (inconclusive) → source показан, но /videos=0
  // (пустой источник из-за abstain-«статусный шум ≠ нет»). Теперь optimistic-show
  // подтверждается СТРОГИМ прямым lite-page: полный скан без контента ни на одной
  // ноде = «у этого источника этого фильма нет» → авторитетный hide.
  assert.equal(row.show, false, 'нет контента ни на одной ноде (все хосты non-2xx) → source скрыт');
  assert.equal(row.authoritative, true, 'строй вердикт авторитетен (не inconclusive)');
  assert.equal(row.confirmed, true, 'подтверждён вторым (строгим) сигналом');
});

test('card (abstain): контент на ЛЮБОЙ ноде (online3=503 + online8=200 content) → hide невозможен (W1: контент не прячем)', async () => {
  const checker = makeChecker((url) => {
    if (String(url).includes('online3')) return Promise.resolve(response(503, ''));
    return Promise.resolve(response(200, CONTENT));
  }, { reservePolicy: 'abstain' });
  const result = await checker.card(QUERY, 'uid-1');
  const row = result.sources.find((s) => s.id === 'skaz-alloha');
  assert.equal(row.show, true, 'content-ответ на любой ноде — авторитетный SHOW (W1 не сломан)');
  assert.equal(row.authoritative, true);
  assert.equal(row.host, 'http://online8.skaz.tv', 'показ с ноды с контентом');
});

test('strict-подтверждение: полный скан 2xx-EMPTY (`null` все хосты) → hide (EMPTY классификация)', async () => {
  const checker = makeChecker((url) => Promise.resolve(response(200, NON_CONTENT)), { reservePolicy: 'abstain' });
  const result = await checker.card(QUERY, 'uid-1');
  const row = result.sources.find((s) => s.id === 'skaz-alloha');
  assert.equal(row.show, false, '2xx-EMPTY на всех хостах = content-«нет» → hide');
  assert.equal(row.confirmed, true);
});

test('strict-подтверждение: decoy-карточка чужого фильма (comparables-script, title не совпал) → hide (RULE-1)', async () => {
  const DECOY = '<html>data-json={"method":"link","title":"Полтергейст","year":2010}</html>';
  const checker = makeChecker((url) => Promise.resolve(response(200, DECOY)), { reservePolicy: 'abstain' });
  const result = await checker.card(QUERY, 'uid-1');
  const row = result.sources.find((s) => s.id === 'skaz-alloha');
  assert.equal(row.show, false, 'карточка чужого фильма (по title/год) = «нет» для запрошенного (RULE-1)');
  assert.equal(row.authoritative, true);
});

test('strict-подтверждение: волновая проба (2 хоста/волну) — кластер НЕ троттлится (live: параллельный скан всех хостов → no-response у части → неполный скан → show), полный скан завершается → hide', async () => {
  // Регрессия live-случая BALANCER-FINAL-AVAILABILITY-001: у xvideocdnultra/Паразиты
  // параллельная стрельба по ВСЕМ хостам кластера давала no-response (конкарренси-
  // троттл кластера на аккаунт) → строгий скан никогда не завершался → источник
  // оставался показанным пустым. Волны по 2 хоста обходят троттл и всё равно
  // совершают ПОЛНЫЙ проход (гарантия «absent только от полного скана»).
  // 3 хоста → волна1=[online3,online8], волна2=[.63]; пик конкарренси alloha = 2
  // (первичный probe по одной ноде; confirm — волной по 2), не 3 и не 6.
  let inFlight = 0;
  let maxInFlight = 0;
  const checker = makeChecker(async (url) => {
    const isAlloha = String(url).includes('/alloha?');
    if (isAlloha) { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); }
    const result = response(String(url).includes('online3') ? 503 : 403, '');
    if (isAlloha) inFlight -= 1;
    return result;
  }, { reservePolicy: 'abstain', hosts: [...HOSTS, 'http://94.249.239.63'] });
  const result = await checker.card(QUERY, 'uid-1');
  const row = result.sources.find((s) => s.id === 'skaz-alloha');
  assert.equal(row.show, false, 'все хосты ответили 503/403 (полный волновой скан) → absent → hide');
  assert.equal(row.confirmed, true, 'подтверждён строгим сигналом');
  assert.ok(maxInFlight <= 2, `пик конкарренси по alloha ≤ 2 (было ${maxInFlight}); больший пик = кластерный троттл → unverifiable`);
});

test('strict-подтверждение: таймаут на ноде при подтверждении → inconclusive (неполный скан не прячет рабочий источник)', async () => {
  const checker = makeChecker((url) => {
    if (String(url).includes('online3')) throw new Error('timeout');
    return Promise.resolve(response(503, ''));
  }, { reservePolicy: 'abstain' });
  const result = await checker.card(QUERY, 'uid-1');
  const row = result.sources.find((s) => s.id === 'skaz-alloha');
  // primary: online3=таймаут (no-response) + online8=503 (abstain) → show/inconclusive.
  // confirm: строгая проба тоже встречает no-response → вердикта нет → show СОХРАНЁН.
  assert.equal(row.show, true, 'no-response при подтверждении → не прячем (транзиентный тормоз кластера)');
  assert.equal(row.confirmInconclusive, true, 'подтверждение инконклюзивно — row помечен (как RULE-4)');
});
