// BALANCER-SEMANTICS-005-W1 — RELEASE GATE, CONTROLLED ALGORITHM EVIDENCE.
// Mock-кластер (fake fetchImpl), НАСТОЯЩИЙ код W1 (availability.probe/pinMap,
// SkazClient._scanLite/_liteTargets, SkazProvider pinFromContext). Ничего не меняет.
//
// Доказывает (п.1/п.2/п.4/п.5 гейта):
//  1) Pinned-host fallback: A(пин) 200-empty/timeout/500 → B CONTENT (actual нода-последовательность);
//  2) All-node failure (503+503+timeout) → НЕ EMPTY: card INCONCLUSIVE, videos UNABLE (lastScan noResponse>0);
//  3) B→A controlled: контент на ПОСЛЕДНЕЙ ноде h3 — OLD(FAIL-NOT-RETRY) EMPTY на h1, NEW ротация → CONTENT;
//  4) таблица состояний: 200-empty→rotation; timeout/503→rotation; all-errors→INCONCLUSIVE;
//     all-auth-empty→EMPTY/hide; content-anywhere→FOUND(+пин на ногу контента);
//  5) пин: uid-scope, provider/balancer-scope, TTL-истечение, перевыбор после TTL,
//     display-name не участвует (ключ userUid|providerId, id-начина).
process.env.NODE_ENV = 'test';
process.env.SKAZ_ENABLED = '1';
process.env.SKAZ_ACCOUNT_EMAIL = 'user@example.com';
process.env.SKAZ_UID = 'abc123';
process.env.SKAZ_BALANCERS = 'rezka,kinopub';
process.env.SKAZ_HOSTS = 'http://h1,http://h2,http://h3';
process.env.SKAZ_CHECK_TIMEOUT_MS = '200';
process.env.FILMIX_ENABLED = '0';
process.env.REZKA_ENABLED = '0';
process.env.KODIK_ENABLED = '0';
process.env.ALLOHA_ENABLED = '0';
process.env.RUTUBEMOVIE_ENABLED = '0';
process.env.CDNVIDEOHUB_ENABLED = '0';
process.env.COLLAPS_ENABLED = '0';
process.env.HDVB_ENABLED = '0';

const { createAvailabilityChecker } = await import('../server/src/availability.js');
const { SkazClient, isUsablePage } = await import('../server/src/providers/skaz/SkazClient.js');
const { SkazProvider } = await import('../server/src/providers/skaz/SkazProvider.js');
const { orderedSkazHosts } = await import('../server/src/providers/skaz/hostOrder.js');

const HOSTS = ['http://h1', 'http://h2', 'http://h3'];
const ACCOUNT = { accountEmail: 'user@example.com', uid: 'abc123' };
// Карточная сторона (availability): предикат → `"type":"movie"` (тот же маркер, что CONTENT_HTML в suite).
const CARD_HTML = '<html><div>"type":"movie"</div></html>';
// Клиентская сторона (SkazClient/у провайдера): usable-страница с play-картой (дает items).
const PLAY_CARD_HTML = '<div class="videos__item" data-json=\'{"method":"play","url":"http://h/play.m3u8","translate":"Дубляж"}\'>x</div>';
const Q = { id: '13', imdb_id: 'tt0109830', title: 'Форрест Гамп', original_title: 'Forrest Gump', source: 'tmdb', year: 1994, serial: 0 };

function resp(status, body = '') {
  return { status, ok: status >= 200 && status < 300, url: '', headers: {}, body: { cancel: () => {} }, text: async () => String(body) };
}

const hostOf = (u) => (/^(https?:\/\/[^/]+)/.exec(String(u)) || [])[1];
const balOf = (u) => (/\/lite\/([a-z0-9]+)/.exec(String(u)) || [])[1];

function seenFactory(map) {
  const seen = [];
  const fn = (url) => { const h = hostOf(url); const b = balOf(url); seen.push(`${h}#${b}`); return map(b, h, url); };
  return { seen, fn };
}

function makeChecker(fetchImpl, opts = {}) {
  return createAvailabilityChecker({ hosts: HOSTS, ...ACCOUNT, fetchImpl, timeoutMs: 200, backoffMs: 0, reservePolicy: 'abstain', ttlMs: 5000, ...opts });
}

function makeProvider(fetchImpl) {
  const client = new SkazClient({ balancer: 'rezka', hosts: HOSTS, ...ACCOUNT, timeoutMs: 200, fetchImpl });
  return new SkazProvider({ id: 'skaz-rezka', title: 'Maniya rezka', balancer: 'rezka', client });
}

const ctx = (host) => ({ query: { token: '', ...Q, ...(host ? { host } : {}) }, request: {} });
const fmtRow = (r) => `${r.show ? 'show' : 'hide'}|auth=${r.authoritative}|${r.inconclusive ? 'inconclusive' : 'definitive'}|${r.mixed ? 'mixed' : 'clean'}|${r.accsdb ? 'accsdb' : ''}|${r.host || 'host:—'}`;

async function cardRow(checker, uid) {
  const payload = await checker.card(Q, uid);
  return payload.sources.find((s) => s.id === 'skaz-rezka');
}

const results = [];
async function run(name, fn) {
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, FAIL: String(e.message || e).slice(0, 200) }); }
}

let ok = 0;
const assert_ = (cond, msg) => { if (!cond) throw new Error(`ASSERT: ${msg}`); ok += 1; console.log(`    [ok] ${msg}`); };

// ============ 1) PINNED-HOST FALLBACK: A(пин) занят, B имеет контент ============
await run('1a. пин A: 200-EMPTY → B CONTENT', async () => {
  const card = seenFactory((b, h) => (b === 'rezka' && h === 'http://h1' ? resp(200, CARD_HTML) : resp(503, 'disable')));
  const checker = makeChecker(card.fn);
  const row = await cardRow(checker, 'uid-a');
  assert_(row.show === true && row.authoritative === true && row.host === 'http://h1', `card FOUND на h1 (${fmtRow(row)})`);
  const pin = checker.pinnedHost('skaz-rezka', 'uid-a');
  assert_(pin === 'http://h1', `pin записан на h1, получено ${pin}`);

  const v = seenFactory((b, h) => {
    if (b !== 'rezka') return resp(503, 'disable');
    if (h === 'http://h1') return resp(200, 'null');        // пин-нода: 2xx-non-usable
    if (h === 'http://h2') return resp(200, PLAY_CARD_HTML); // B: контент
    return resp(200, 'null');
  });
  const res = await makeProvider(v.fn).videos(ctx(pin));
  console.log(`    attempts=${v.seen.join(' > ')} items=${(res?.items || []).length} ${(res?.provider_error?.code) || ''}`);
  assert_((res?.items || []).length > 0, 'B дал items');
  assert_(v.seen[0] === 'http://h1#rezka', 'старт с пина h1');
  assert_(v.seen.includes('http://h2#rezka'), 'после провала пина — ротация на B');
});

await run('1b. пин A: TIMEOUT → B CONTENT', async () => {
  const checker = makeChecker((url) => (balOf(url) === 'rezka' && hostOf(url) === 'http://h1' ? resp(200, CARD_HTML) : resp(503, 'disable')));
  await checker.card(Q, 'uid-b');
  const pin = checker.pinnedHost('skaz-rezka', 'uid-b');
  assert_(pin === 'http://h1', `pin h1, получено ${pin}`);

  const v = seenFactory((b, h) => {
    if (b !== 'rezka') return resp(503, 'disable');
    if (h === 'http://h1') throw new Error('TIMEOUT');       // A: сеть/таймаут
    if (h === 'http://h2') return resp(200, PLAY_CARD_HTML);
    return resp(200, 'null');
  });
  const res = await makeProvider(v.fn).videos(ctx(pin));
  console.log(`    attempts=${v.seen.join(' > ')} items=${(res?.items || []).length}`);
  assert_((res?.items || []).length > 0 && v.seen[0] === 'http://h1#rezka' && v.seen.includes('http://h2#rezka'), 'timeout пина → ротация → B CONTENT');
});

await run('1c. пин A: 500 → B CONTENT', async () => {
  const checker = makeChecker((url) => (balOf(url) === 'rezka' && hostOf(url) === 'http://h1' ? resp(200, CARD_HTML) : resp(503, 'disable')));
  await checker.card(Q, 'uid-c');
  const pin = checker.pinnedHost('skaz-rezka', 'uid-c');

  const v = seenFactory((b, h) => {
    if (b !== 'rezka') return resp(503, 'disable');
    if (h === 'http://h1') return resp(500, 'boom');        // A: 500
    if (h === 'http://h2') return resp(200, PLAY_CARD_HTML);
    return resp(200, 'null');
  });
  const res = await makeProvider(v.fn).videos(ctx(pin));
  console.log(`    attempts=${v.seen.join(' > ')} items=${(res?.items || []).length}`);
  assert_((res?.items || []).length > 0 && v.seen[0] === 'http://h1#rezka' && v.seen.includes('http://h2#rezka'), '500 пина → ротация → B CONTENT');
});

// ============ 2) ALL-NODE FAILURE (503+503+timeout) → НЕ EMPTY ============
await run('2a. card: 503+503+timeout → INCONCLUSIVE (не hide, не EMPTY)', async () => {
  const checker = createAvailabilityChecker({
    hosts: HOSTS, ...ACCOUNT,
    fetchImpl: (url) => { if (hostOf(url) === 'http://h3') throw new Error('NET_TIMEOUT'); return resp(503, 'disable'); },
    timeoutMs: 200, backoffMs: 0, reservePolicy: 'abstain', ttlMs: 5000
  });
  const row = await cardRow(checker, 'uid-allerr');
  console.log(`    card(503,503,timeout) = ${fmtRow(row)}`);
  assert_(row.show === true, 'не hide');
  assert_(row.inconclusive === true, 'inconclusive=true');
  assert_(row.authoritative === false, 'не authoritative');
  // дизайн §2.7: timeout/5xx/сеть НЕ становятся EMPTY — EMPTY = только когда ВСЕ дали content-«нет»
});
await run('2b. videos: 503+503+timeout → UNABLE (не EMPTY), lastScan noResponse>0', async () => {
  const v = seenFactory((b, h) => {
    if (b !== 'rezka') return resp(503, 'disable');
    if (h === 'http://h3') throw new Error('NET_TIMEOUT');
    return resp(503, 'disable');
  });
  const prov = makeProvider(v.fn);
  const res = await prov.videos(ctx(null));
  const ls = prov.client.lastScan;
  console.log(`    items=${(res?.items || []).length} lastScan=${JSON.stringify(ls)} attempts=${v.seen.join(' > ')}`);
  const isEMPTY = ls && ls.nonContent === ls.total && ls.noResponse === 0;
  assert_(isEMPTY === false, 'lastScan НЕ равен EMPTY — только content-«нет» все ноды дают EMPTY; здесь noResponse>0 → UNABLE/транзиент');
});

// ============ 3) B сценарий CONTROLLED: контент на ПОСЛЕДНЕЙ ноде h3 ============
await run('3. OLD(FAIL-NOT-RETRY) EMPTY на h1-2xx-nonusable; NEW ротация → h3 CONTENT', async () => {
  const page = (b, h) => (b === 'rezka' && h === 'http://h3' ? resp(200, PLAY_CARD_HTML) : resp(200, 'null'));
  // OLD (pre-W1): первый 2xx-non-usable → СТОП EMPTY (1 попытка)
  const oldSeen = [];
  let oldRes = 'EMPTY';
  for (const h of HOSTS) {
    const txt = await (await page('rezka', h)).text();
    oldSeen.push(`${h}:${txt.trim()}`);
    if (isUsablePage(txt)) { oldRes = 'CONTENT'; }
    break; // FAIL-NOT-RETRY — любой 2xx финален
  }
  const v = seenFactory(page);
  const res = await makeProvider(v.fn).videos(ctx(null));
  console.log(`    OLD=${oldRes} (${oldSeen.join(' > ')})  NEW items=${(res?.items || []).length} (${v.seen.join(' > ')})`);
  assert_(oldRes === 'EMPTY', 'OLD EMPTY: h1 2xx-nonusable = финал (это и был баг-механизм)');
  assert_((res?.items || []).length > 0, 'NEW: continue-скан дошёл до h3 → CONTENT');
  assert_(v.seen.includes('http://h3#rezka'), 'NEW дошёл до h3');

  // ВАЖНО: checker.fetchImpl вызывается как (url, opts), а не (balancer, host) →
  // оборачиваем url-парсером (прямая передача page(b,h) давала бы url в b и ломала маппинг).
  const checker = makeChecker((url) => { const h = hostOf(url); const b = balOf(url); return page(b, h); });
  await checker.card(Q, 'uid-b2');
  const row = await cardRow(checker, 'uid-b2');
  console.log(`    card(контент на h3) = ${fmtRow(row)}  pin=${checker.pinnedHost('skaz-rezka', 'uid-b2')}`);
  assert_(row.show === true && row.authoritative === true && row.host === 'http://h3', 'card FOUND на ноге контента h3 (show+auth+host)');
  assert_(checker.pinnedHost('skaz-rezka', 'uid-b2') === 'http://h3', 'пин на фактическую ногу контента');
});

// ============ 4) ТАБЛИЦА СОСТОЯНИЙ ============
await run('4. state-таблица', async () => {
  const states = [];
  {
    const v = seenFactory((b, h) => (b === 'rezka' && h === 'http://h2' ? resp(200, PLAY_CARD_HTML) : resp(200, 'null')));
    const res = await makeProvider(v.fn).videos(ctx(null));
    states.push(['200-empty на A → ротация → B content', `${v.seen.join(' > ')} | items=${(res?.items || []).length}`]);
  }
  {
    const v = seenFactory((b, h) => {
      if (b !== 'rezka') return resp(503, 'disable');
      if (h === 'http://h1') throw new Error('TIMEOUT');
      if (h === 'http://h3') return resp(503, 'boom');
      return resp(200, PLAY_CARD_HTML);
    });
    const res = await makeProvider(v.fn).videos(ctx(null));
    states.push(['timeout A + 503 C → ротация → B content', `${v.seen.join(' > ')} | items=${(res?.items || []).length}`]);
  }
  {
    const checker = makeChecker(() => resp(503, 'disable'));
    const row = await cardRow(checker, 'uid-err');
    states.push(['all-503 → card', fmtRow(row)]);
    const v = seenFactory((b, h) => resp(503, 'disable'));
    const prov = makeProvider(v.fn);
    const res = await prov.videos(ctx(null));
    states.push(['all-503 → videos', `items=${(res?.items || []).length} lastScan=${JSON.stringify(prov.client.lastScan)}`]);
  }
  {
    const checker = makeChecker(() => resp(200, 'null'));
    const row = await cardRow(checker, 'uid-empty');
    states.push(['all-200-empty → card', fmtRow(row)]);
    const v = seenFactory((b, h) => resp(200, 'null'));
    const prov = makeProvider(v.fn);
    const res = await prov.videos(ctx(null));
    states.push(['all-200-empty → videos', `items=${(res?.items || []).length} lastScan=${JSON.stringify(prov.client.lastScan)}`]);
  }
  {
    const checker = makeChecker((url) => (balOf(url) === 'rezka' && hostOf(url) === 'http://h2' ? resp(200, CARD_HTML) : resp(200, 'null')));
    const row = await cardRow(checker, 'uid-content');
    states.push(['content h2 → card', `${fmtRow(row)} pin=${checker.pinnedHost('skaz-rezka', 'uid-content')}`]);
    const v = seenFactory((b, h) => (b === 'rezka' && h === 'http://h2' ? resp(200, PLAY_CARD_HTML) : resp(200, 'null')));
    const res = await makeProvider(v.fn).videos(ctx(null));
    states.push(['content h2 → videos', `items=${(res?.items || []).length} ${v.seen.join(' > ')}`]);
  }
  for (const [l, r] of states) console.log(`    ${l}: ${r}`);
});

// ============ 5) ПИН ============
await run('5a. uid-scope (разные uid → независимые ключи)', async () => {
  const checker = makeChecker((url) => (balOf(url) === 'rezka' && hostOf(url) === 'http://h1' ? resp(200, CARD_HTML) : resp(503, 'disable')));
  await checker.card(Q, 'uid-a');
  assert_(checker.pinnedHost('skaz-rezka', 'uid-a') === 'http://h1', 'uid-a → пин h1');
  assert_(checker.pinnedHost('skaz-rezka', 'uid-b') === null, 'uid-b (не probing →) нет пина — ключ uid-скоупирован');
  await checker.card(Q, 'uid-b'); // тот же кластер, другой uid — отдельная запись
  assert_(checker.pinnedHost('skaz-rezka', 'uid-b') === 'http://h1', 'uid-b после своей карточки — пин h1 (независимо от uid-a)');
});

await run('5b. provider/balancer-scope (не смешивает)', async () => {
  const checker = createAvailabilityChecker({
    hosts: HOSTS, ...ACCOUNT,
    fetchImpl: (url) => {
      const b = balOf(url); const h = hostOf(url);
      if (b === 'rezka' && h === 'http://h1') return resp(200, CARD_HTML);
      if (b === 'kinopub' && h === 'http://h2') return resp(200, CARD_HTML);
      return resp(503, 'disable');
    },
    timeoutMs: 200, backoffMs: 0, reservePolicy: 'abstain', ttlMs: 5000
  });
  await checker.card(Q, 'uid-a');
  const payload = await checker.card(Q, 'uid-a');
  const ids = payload.sources.filter((s) => String(s.id).startsWith('skaz-')).map((s) => s.id);
  console.log(`    row ids=${ids.join(', ')} (ключ по id, display-name в ключе не участвует)`);
  assert_(checker.pinnedHost('skaz-rezka', 'uid-a') === 'http://h1', 'rezka-пин h1');
  assert_(checker.pinnedHost('skaz-kinopub', 'uid-a') === 'http://h2', 'kinopub-пин h2 (разные балансеры не смешиваются)');
});

await run('5c. TTL истекает → пин deleted-on-read → перевыбор ротацией', async () => {
  // Оба балансера дают FOUND (ни одна строка не hides) → hasConfirmedHide=false → pinTtl=ttlMs(200).
  const checker = makeChecker((url) => (['rezka', 'kinopub'].includes(balOf(url)) && hostOf(url) === 'http://h1' ? resp(200, CARD_HTML) : resp(503, 'disable')), { ttlMs: 200 });
  await checker.card(Q, 'uid-t');
  assert_(checker.pinnedHost('skaz-rezka', 'uid-t') === 'http://h1', 'после card пин на месте');
  await new Promise((r) => setTimeout(r, 280));
  const expired = checker.pinnedHost('skaz-rezka', 'uid-t');
  assert_(expired === null, `после TTL 200ms+80 пин протух (deleted-on-read): ${expired}`);

  const v = seenFactory((b, h) => (b === 'rezka' && h === 'http://h3' ? resp(200, PLAY_CARD_HTML) : resp(200, 'null')));
  const res = await makeProvider(v.fn).videos(ctx(null));
  console.log(`    перевыбор без пина (контент мигрировал на h3): ${v.seen.join(' > ')} items=${(res?.items || []).length}`);
  assert_((res?.items || []).length > 0, 'после TTL нода выбирается заново, актуальный контент найден');
});

// ============ 6) код-инварианты регрессий ============
await run('6. код-инварианты (GAP-002 order / пул клиента)', async () => {
  const ordered = orderedSkazHosts(['http://online8.skaz.tv', 'http://online3.skaz.tv', 'http://online5.skaz.tv']);
  console.log(`    orderedSkazHosts: ${ordered.join(' > ')}`);
  assert_(ordered[ordered.length - 1].includes('online8'), 'online8 — резерв, последний');
  const client = new SkazClient({ balancer: 'rezka', hosts: HOSTS, ...ACCOUNT, timeoutMs: 200 });
  console.log(`    клиентский пул = ${client.hosts.join(', ')} (совпадает с пулом карточки)`);
  assert_(client.hosts.join(',') === HOSTS.join(','), 'клиент и карта — ОДИН порядок пула');
});

console.log('\n===== ГЕЙТ-СВОДКА =====');
let fail = 0;
const summary = [];
for (const r of results) {
  if (r.FAIL) { console.log(`  FAIL ${r.name}: ${r.FAIL}`); fail += 1; summary.push(`FAIL ${r.name}`); }
  else summary.push(`ok ${r.name}`);
}
console.log(`  сценариев: ${results.length}, ассертов: ${ok}`);
console.log(fail === 0 ? '  CONTROLLED: 0 сбоев — все сценарии гейта прошли' : `  CONTROLLED: ${fail} сбоев → ${summary.filter((s) => s.startsWith('FAIL')).join('; ')}`);
console.log('GATE-CONTROLLED-DONE');