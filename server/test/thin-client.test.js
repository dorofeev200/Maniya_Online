// SKAZ-MANIYA-052: тонкий клиент — vm-харнесс по паттерну plugin-contract.test.js.
// Загружается НАСТОЯЩИЙ public/maniya-online.js; экспорт MANIYA_LIB.thinApi —
// чистые функции + хуки (_resetState/_setPingMs). fetch маршрутизируется по
// lite-цепочке (bootstrap → lite-страница → mint), WebSocket — фейк с ручным
// триггером событий (Connected → RchRegistry, ping, close). Все значения из
// песочницы нормализуются JSON round-trip — realm-объекты/массивы vm ломают
// assert.deepStrictEqual (другая [[Prototype]]).
//
// Отличия от плана Faza C §(c): клиентский зеркало-клиент ДЕРЖИТ ws-сессии
// локально и минтит с nws_id напрямую — POST rch/result на наш сервер не ходит
// (серверный минт с VPS и есть та «долго»-причина, её избегаем).

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/maniya-online.js');

const normalize = (v) => JSON.parse(JSON.stringify(v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const start = Date.now();
  while (!fn() && Date.now() - start < ms) await sleep(3);
  return fn();
}

// ── фикстуры кластера (lite-страницы / mint-дескрипторы / реестр) ───────────
const BOOTSTRAP_ON = {
  body: {
    enabled: true,
    modules: ['alloha', 'lordfilm'],
    ttl_s: 600,
    skaz: {
      account_email: 'probe@maniya.test',
      uid: 'probe-uid',
      lite_hosts: ['http://lite.example'],
      ws_hosts: ['ws://lite.example']
    }
  }
};
const BOOTSTRAP_OFF = { body: { enabled: false } };
const BOOTSTRAP_ALLOW_ONLY_LORDFILM = {
  body: { enabled: true, modules: ['lordfilm'], ttl_s: 600, skaz: BOOTSTRAP_ON.body.skaz }
};

// Фильм, 2 call-голоса (мovieBranch минтит первый, второй — ленивый call).
const ALLOHA_MOVIE_HTML = [
  '<div class="videos__item" data-json=\'{"method":"call","url":"http://lite.example/streams/1/video.m3u8?title=Alloha+2024&id=101","stream":"http://lite.example/streams/1/video.m3u8?title=Alloha+2024&id=101","translate":"Дубляж"}\'>',
  '<div class="videos__item-title">Дубляж</div></div>',
  '<div class="videos__item" data-json=\'{"method":"call","url":"http://lite.example/streams/2/video.m3u8?title=Alloha+2024&id=101","stream":"http://lite.example/streams/2/video.m3u8?title=Alloha+2024&id=101","translate":"Оригинал"}\'>',
  '<div class="videos__item-title">Оригинал</div></div>'
].join('\n');

// Сериал: link-голоса + link-сезоны (serialBranch идёт на страницу сезона).
const LORDFILM_SERIAL_HTML = [
  '<div class="videos__item" data-json=\'{"method":"link","url":"http://lite.example/lite/lordfilm?t=1","translate":"Дубляж"}\'><div class="videos__item-title">Дубляж</div></div>',
  '<div class="videos__item" data-json=\'{"method":"link","url":"http://lite.example/lite/lordfilm?t=2","translate":"Оригинал"}\'><div class="videos__item-title">Оригинал</div></div>',
  '<div class="videos__item" data-json=\'{"method":"link","url":"http://lite.example/lite/lordfilm?s=1&t=1"}\'><div class="videos__season-title">1 сезон</div></div>',
  '<div class="videos__item" data-json=\'{"method":"link","url":"http://lite.example/lite/lordfilm?s=2&t=1"}\'><div class="videos__season-title">2 сезон</div></div>'
].join('\n');

const LORDFILM_SEASON_HTML = [
  '<div class="videos__item" data-json=\'{"method":"call","url":"http://lite.example/streams/s1e1/video.m3u8?title=Serial&id=1","stream":"http://lite.example/streams/s1e1/video.m3u8?title=Serial&id=1","s":1,"e":1,"name":"Серия 1","translate":"Дубляж"}\'><div class="videos__item-title">Серия 1</div></div>',
  '<div class="videos__item" data-json=\'{"method":"call","url":"http://lite.example/streams/s1e2/video.m3u8?title=Serial&id=1","stream":"http://lite.example/streams/s1e2/video.m3u8?title=Serial&id=1","s":1,"e":2,"name":"Серия 2","translate":"Дубляж"}\'><div class="videos__item-title">Серия 2</div></div>'
].join('\n');

// Прямой CDN-дескриптор: одна прямая метка качества + наш /proxy (маска —
// точка, которую T052 не должен пропускать в item.quality) + субтитры через /proxy.
const MINT_DESCRIPTOR = {
  body: {
    method: 'play',
    url: 'https://cdn.example/hls/master.m3u8?exp=999',
    quality: {
      '1080p': 'https://cdn.example/hls/master_1080.m3u8?exp=999',
      '360p': 'https://plugin.maniya-kvn.online/api/lampa/proxy?url=' + encodeURIComponent('https://skaz.tv/proxy/unit-token')
    },
    subtitles: [{ label: 'Русские', url: 'https://cdn.example/sub/ru.srt' }],
    hls_manifest_timeout: 30
  }
};

// Mint вернул не-play (нода не дала дескриптор) → thin-ветка не докажет direct.
const NOT_PLAY_DESCRIPTOR = { body: { method: 'call', url: 'x' } };

const MOVIE = { id: '202', title: 'Фильм 2024', original_title: 'Movie 2024', release_date: '2024-05-01', source: 'tmdb' };
const SERIAL = { id: '123', name: 'Серийный сериал', original_name: 'Serial', first_air_date: '2020-01-01', source: 'tmdb' };

const REGISTRY = [
  { id: 'skaz-alloha', name: 'Alloha', balanser: 'alloha', icon: '🎬', quality_label: '4K', url: 'http://lite.example/lite/alloha', show: true },
  { id: 'skaz-lordfilm', name: 'LordFilm', balanser: 'lordfilm', icon: '🎬', quality_label: 'FHD', url: 'http://lite.example/lite/lordfilm', show: true },
  { id: 'filmix', name: 'Filmix', icon: '🎬', quality_label: '4K', url: 'https://x/api/lampa/videos?provider=filmix', show: true }
];
const CARD_MODEL = {
  sources: [
    { id: 'skaz-alloha', name: 'Alloha', balanser: 'alloha', index: 1, show: true, thin: true, icon: '🎬', quality_label: '4K', url: 'http://lite.example/lite/alloha', api_url: '/api/lampa/videos?provider=skaz-alloha' },
    { id: 'skaz-lordfilm', name: 'LordFilm', balanser: 'lordfilm', index: 2, show: true, thin: true, icon: '🎬', quality_label: 'FHD', url: 'http://lite.example/lite/lordfilm', api_url: '/api/lampa/videos?provider=skaz-lordfilm' },
    { id: 'filmix', name: 'Filmix', index: 3, show: true, icon: '🎬', quality_label: '4K', url: 'https://x/api/lampa/videos?provider=filmix' }
  ]
};
const LEGACY_PAYLOAD = {
  items: [{ method: 'play', title: 'Легаси-плей', url: 'https://cdn.example/legacy.m3u8', quality: { '1080p': 'https://cdn.example/legacy.m3u8' }, subtitles: [], voice_name: 'Дубляж легаси', type: 'movie' }],
  voices: [{ name: 'Дубляж легаси', index: 0 }],
  seasons: []
};

/** Маршрутизатор lite-цепочки (первый матч побеждает). mint — строка/дескриптор/'hang'. */
function clusterRoutes({ bootstrap = BOOTSTRAP_ON, season = LORDFILM_SEASON_HTML, mint = MINT_DESCRIPTOR, movie = ALLOHA_MOVIE_HTML, serial = LORDFILM_SERIAL_HTML } = {}) {
  return (url, u) => {
    if (url.includes('/thin/bootstrap')) return bootstrap;
    if (u && u.pathname.startsWith('/lite/alloha')) return movie;
    if (u && u.pathname.startsWith('/lite/lordfilm') && u.searchParams.has('s')) return season;
    if (u && u.pathname.startsWith('/lite/lordfilm')) return serial;
    if (u && u.pathname.endsWith('/video')) return mint;
    return null;
  };
}

/** Reguest-роутер компонента (Z01-ветка): подписка → реестр → кард-модель → /videos. */
function componentNetwork() {
  return (url, ok) => {
    if (url.includes('/api/lampa/subscription/check')) return ok({ active: true });
    if (url.includes('/api/lampa/sources/card')) return ok(CARD_MODEL);
    if (url.includes('/api/lampa/sources')) return ok({ sources: REGISTRY });
    if (url.includes('/api/lampa/videos')) return ok(LEGACY_PAYLOAD);
    return ok({});
  };
}

// ── фейки веб-платформы ─────────────────────────────────────────────────────
class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = String(url);
    this.readyState = 0; // CONNECTING
    this.sent = [];
    this.listeners = {};
    this.closed = false;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  send(data) { this.sent.push(String(data)); }
  close(code, reason) {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3; // CLOSED
    this.fire('close', { code: code || 1000, reason: reason || '' });
  }
  fire(type, event) { (this.listeners[type] || []).slice().forEach((fn) => fn(event || {})); }
  fakeOpen() { this.readyState = 1; this.fire('open', {}); }
  fakeMessage(data) { this.fire('message', { data: typeof data === 'string' ? data : JSON.stringify(data) }); }
}

function makeJq() {
  const h = {
    length: 1,
    append: () => h, prepend: () => h, before: () => h, after: () => h,
    remove: () => h, empty: () => h, removeAttr: () => h,
    find: () => h, first: () => h, last: () => h, next: () => h, prev: () => h,
    parent: () => h, children: () => h, closest: () => h, get: () => h,
    on: () => h, off: () => h, one: () => h,
    addClass: () => h, removeClass: () => h, toggleClass: () => h, hasClass: () => false,
    css: () => h,
    attr: (k, v) => (v === undefined ? '' : h),
    prop: (k, v) => (v === undefined ? '' : h),
    text: (v) => (v === undefined ? '' : h),
    html: (v) => (v === undefined ? '' : h),
    val: (v) => (v === undefined ? '' : h),
    is: () => false, each: () => h, map: () => h, toArray: () => [],
    data: () => undefined, show: () => h, hide: () => h
  };
  return h;
}

function makeFetch(routes, net) {
  return async (url, init) => {
    const u = String(url);
    net.push(u);
    let parsed = null;
    try { parsed = new URL(u); } catch (e) { /* не URL — пойдём по строковым матчам */ }
    const res = routes(u, parsed);
    if (res === 'hang') return new Promise(() => {});
    if (res === null || res === undefined) return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    if (typeof res === 'string') return { ok: true, status: 200, text: async () => res, json: async () => JSON.parse(res) };
    if (res.status && res.status !== 200) return { ok: false, status: res.status, text: async () => '', json: async () => ({}) };
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    return { ok: true, status: 200, text: async () => body, json: async () => (typeof res.body === 'string' ? JSON.parse(res.body) : res.body) };
  };
}

// ── песочница ───────────────────────────────────────────────────────────────
const LANG = {
  maniya_polling_start: 'Опрашиваем источники',
  maniya_polling_found: 'Найдено источников: {n}',
  maniya_sec: 'с',
  maniya_polling_slow: 'отвечают медленно',
  maniya_source: 'Источник', maniya_season: 'Сезон', maniya_voice: 'Озвучка',
  maniya_reset: 'Сброс', maniya_episode: 'Серия',
  maniya_thin_fallback: 'Мгновенный источник недоступен — обычная загрузка',
  maniya_empty_sources: 'Нет источников', maniya_server_error: 'Ошибка сервера',
  maniya_no_results: 'Ничего не найдено', maniya_switch_source: 'Сменить источник',
  maniya_watch: 'Смотреть', maniya_continue: 'Продолжить', maniya_items_count: '{n} серий'
};

async function loadSandbox(opts = {}) {
  const source = await readFile(PLUGIN_PATH, 'utf8');
  const net = [];
  const regNetwork = [];
  const store = Object.assign({}, opts.store);
  // Панель опроса (uiLoadingPanel) и watchdog (15с) живут реальными таймерами;
  // в конце каждого теста clearPending гасит их (иначе node --test не выйдет).
  const pendingTimers = [];
  const trackedSetTimeout = (fn, ms) => { const t = setTimeout(fn, ms); pendingTimers.push(t); return t; };
  const trackedSetInterval = (fn, ms) => { const t = setInterval(fn, ms); pendingTimers.push(t); return t; };
  const clearPending = () => {
    pendingTimers.slice().forEach((t) => { try { clearTimeout(t); clearInterval(t); } catch (e) {} });
    pendingTimers.length = 0;
  };
  const activityStats = { loaderShow: 0, loaderFalse: 0, toggles: 0 };
  const calls = {
    show: [], close: 0, toggle: [], filterSet: [], filterChosen: [], drawn: [],
    loadingShow: 0, loadingStop: 0, noty: [], selectShow: [],
    activity: activityStats
  };
  const z01 = !!opts.z01;
  FakeWebSocket.instances = [];

  const selectListeners = {};
  const selectListener = {
    add: (t, fn) => { (selectListeners[t] = selectListeners[t] || []).push(fn); },
    remove: (t, fn) => { selectListeners[t] = (selectListeners[t] || []).filter((f) => f !== fn); },
    send: (t, e) => { (selectListeners[t] || []).slice().forEach((fn) => fn(e)); }
  };
  let currentActivity = null;

  const lampa = {
    Storage: {
      get: (k, d) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : d),
      set: (k, v) => { store[k] = v; },
      remove: (k) => { delete store[k]; },
      field: (k) => (k === 'video_quality_default' ? '1080p' : '')
    },
    Arrays: { isArray: Array.isArray, getKeys: Object.keys, decodeJson: (s) => JSON.parse(s) },
    Utils: {
      uid: () => 'abcdef12',
      hash: () => 'deadbeef',
      addUrlComponent: (u, p) => u + (String(u).includes('?') ? '&' : '?') + p,
      shortText: (s, n) => String(s || '').slice(0, n),
      cardImgBackgroundBlur: () => '',
      secondsToTime: (s) => String(s)
    },
    Lang: { add: () => {}, translate: (k) => LANG[k] || k },
    Template: { add: () => {}, get: (name, data) => { if (name === 'maniya_video_item' && data && !z01) calls.drawn.push(data); return makeJq(); } },
    Scroll: function () {
      this.render = () => makeJq(); this.clear = () => {}; this.reset = () => {};
      this.minus = () => {}; this.append = () => {}; this.update = () => {};
      this.body = () => makeJq(); this.destroy = () => {};
    },
    Explorer: function () {
      this.render = () => makeJq(); this.appendFiles = () => {}; this.appendHead = () => {};
      this.destroy = () => {};
    },
    Filter: function () {
      this._data = {};
      this.set = (type, items) => { this._data[type] = items; calls.filterSet.push({ type, items }); };
      this.chosen = (type, select) => calls.filterChosen.push({ type, select });
      this.show = () => {};
      this.render = () => makeJq();
      this.onSelect = null;
    },
    Reguest: function () {
      this.timeout = () => {};
      this.silent = (url, ok) => {
        regNetwork.push(String(url));
        if (opts.network) return opts.network(String(url), ok);
        return ok({});
      };
      this.clear = () => {};
    },
    Select: {
      listener: selectListener,
      show: (opts2) => { calls.selectShow.push(opts2); selectListener.send('fullshow', { active: opts2 }); },
      close: () => { calls.close += 1; selectListener.send('close', { active: null }); }
    },
    Activity: { active: () => ({ activity: currentActivity }), push: () => {}, backward: () => {} },
    Controller: {
      add: () => {}, toggle: () => {}, enable: () => {}, enabled: () => ({ name: '' }),
      collectionSet: () => {}, collectionFocus: () => {}
    },
    Background: { immediately: () => {} },
    Navigator: { canmove: () => false, move: () => {} },
    TMDB: { image: () => '' },
    Player: { play: () => {}, playlist: () => {} },
    Loading: { show: () => { calls.loadingShow += 1; }, stop: () => { calls.loadingStop += 1; } },
    Noty: { show: (msg) => calls.noty.push(String(msg)) },
    Manifest: { plugins: [] },
    Component: { add: (name, fn) => { lampa._component = fn; } },
    Listener: { follow: () => {}, remove: () => {} }
  };

  const context = {
    console,
    Lampa: lampa,
    $: () => makeJq(),
    Navigator: lampa.Navigator,
    document: { currentScript: null, getElementsByTagName: () => [], ...(z01 ? { createElement: () => ({}) } : {}) },
    location: { href: 'http://localhost:9999/player.html', search: '' },
    fetch: makeFetch(opts.routes || (() => null), net),
    WebSocket: opts.noWs ? undefined : FakeWebSocket,
    AbortController: opts.noAbort ? undefined : AbortController,
    URL,
    URLSearchParams,
    crypto: (typeof globalThis.crypto !== 'undefined') ? globalThis.crypto : undefined,
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: trackedSetTimeout, clearTimeout, setInterval: trackedSetInterval, clearInterval,
    MANIYA_THIN_TRACE: 0
  };
  if (opts.noFetch) delete context.fetch;
  context.window = context;

  vm.runInNewContext(source, context, { filename: 'maniya-online.js' });

  const th = context.window.MANIYA_LIB.thinApi;
  assert.ok(th && typeof th.flow === 'function', 'MANIYA_LIB.thinApi экспортирован');
  return {
    th, net, regNetwork, store, calls, lampa, context,
    clearPending,
    setActivity(a) { currentActivity = a; },
    wsInstances: FakeWebSocket.instances
  };
}

function startComponent(s, payload) {
  const stats = s.calls.activity;
  const activity = {
    loader: (status) => { if (status) stats.loaderShow += 1; else stats.loaderFalse += 1; },
    toggle: () => { stats.toggles += 1; }
  };
  const inst = { activity };
  s.setActivity(activity);
  s.lampa._component.call(inst, payload);
  inst.start();
  return inst;
}

// ── тесты ───────────────────────────────────────────────────────────────────
test('static: thin-ветка без eval/window.open/Lampa.Select.open; ключи T052 на месте', async () => {
  // Наивный strip-комментариев ломает строковые литералы с `//` (maniya-thin://),
  // поэтому ищем по СЫРОМУ исходнику — и запретные токены, и маркеры T052.
  const source = await readFile(PLUGIN_PATH, 'utf8');

  // Именно ВЫЗОВ запрещён (комментарии про отсутствие Lampa.Select.open в Lampa
  // допустимы) — ищем 'Lampa.Select.open(' (со скобкой).
  assert.ok(!source.includes('Lampa.Select.open('), 'Lampa.Select.open не вызывается');
  assert.ok(!source.includes('window.open('), 'window.open не встречается');
  assert.ok(!source.includes('eval('), 'eval не встречается');
  assert.ok(source.includes('maniya-thin://'), 'схема ленивых тонких call-позиций');
  assert.ok(source.includes('/api/lampa/thin/bootstrap'), 'роут bootstrap');
  assert.ok(source.includes('maniya_thin_off'), 'kill-ключ');
  assert.ok(source.includes('maniya_thin_fallback'), 'нота фолбэка');
  assert.ok(source.includes(' ✈'), 'индикатор «✈» (thin direct подтверждён)');
  assert.ok(source.includes('thinApi: ThinSkaz'), 'экспорт MANIYA_LIB.thinApi');
  assert.ok(source.includes('function isDirectThin'), 'страж прямого CDN');
});

test('module: off → flow null и НИ ОДНОГО запроса к кластеру (legacy-контракт)', async () => {
  const s = await loadSandbox({ routes: clusterRoutes({ bootstrap: BOOTSTRAP_OFF }) });
  const res = await s.th.flow({ slug: 'alloha', movie: MOVIE, component: {}, sourceUrl: 'http://lite.example/lite/alloha', budgetMs: 2000 });
  assert.equal(res, null, 'bootstrap выключен → null');
  assert.equal(s.net.length, 1, 'только bootstrap-запрос');
  assert.ok(s.net[0].includes('/thin/bootstrap'), 'единственный запрос — bootstrap');
  assert.ok(!s.net.some((u) => u.includes('/lite/')), '/lite/* НЕ запрашивался');
  assert.ok(!s.net.some((u) => u.includes('/video')), 'mint НЕ запрашивался');
  s.th.destroyAll();
});

test('module: слаг вне allowlist → flow null без lite-запросов', async () => {
  const s = await loadSandbox({ routes: clusterRoutes({ bootstrap: BOOTSTRAP_ALLOW_ONLY_LORDFILM }) });
  const res = await s.th.flow({ slug: 'alloha', movie: MOVIE, component: {}, sourceUrl: 'http://lite.example/lite/alloha', budgetMs: 2000 });
  assert.equal(res, null, 'alloha вне allowlist → null');
  assert.equal(s.net.length, 1, 'только bootstrap');
  s.th.destroyAll();
});

test('module: wants/клиент-гейты (kill-switch, отсутствующие WebSocket/fetch/AbortController)', async () => {
  const s = await loadSandbox({});
  assert.equal(s.th.wants('alloha'), true, 'базовая среда → тонкий путь доступен');
  assert.equal(s.th.wants(''), false, 'пустой слаг → false');
  assert.equal(s.th.wants(null), false);

  const killed = await loadSandbox({ store: { maniya_thin_off: '1' } });
  assert.equal(killed.th.wants('alloha'), false, 'maniya_thin_off=1 → тонкий путь выключен юзером');
  const noWs = await loadSandbox({ noWs: true });
  assert.equal(noWs.th.wants('alloha'), false, 'нет WebSocket → false (R2)');
  const noFetch = await loadSandbox({ noFetch: true });
  assert.equal(noFetch.th.wants('alloha'), false, 'нет fetch → false');
  const noAbort = await loadSandbox({ noAbort: true });
  assert.equal(noAbort.th.wants('alloha'), false, 'нет AbortController → false');
});

test('module: bootstrap — enabled только для allowlist-модулей, креды только в памяти', async () => {
  const s = await loadSandbox({ routes: clusterRoutes() });
  assert.equal(s.th.enabled('alloha'), false, 'до загрузки bootstrap → false');

  const bs = await s.th.ensureBootstrap();
  assert.ok(bs, 'bootstrap загружен');
  const raw = JSON.stringify(bs);
  assert.ok(!raw.includes('/proxy'), 'bootstrap не отдаёт /proxy');
  assert.ok(!raw.includes('token'), 'bootstrap не отдаёт токены');
  assert.ok(!/(\d{1,3}\.){3}\d{1,3}/.test(raw), 'серверные IP не светятся');

  assert.equal(s.th.enabled('alloha'), true, 'alloha в allowlist → enabled');
  assert.equal(s.th.enabled('lordfilm'), true, 'lordfilm в allowlist → enabled');
  assert.equal(s.th.enabled('filmix'), false, 'filmix вне allowlist → false');

  // bootstrap не пишется в Storage/локальное хранилище (R3: креды только память+TTL).
  assert.equal(s.store.account_email, undefined, 'креды НЕ в Lampa.Storage');

  s.th._resetState();
  assert.equal(s.th.enabled('alloha'), false, 'после сброса кэша enabled снова false');
  s.th.destroyAll();
});

test('module: фильм (alloha) → 1 прямой play + 1 ленивый call, mint с креды+nws_id', async () => {
  const s = await loadSandbox({ routes: clusterRoutes() });
  const res = await s.th.flow({ slug: 'alloha', movie: MOVIE, component: {}, sourceUrl: 'http://lite.example/lite/alloha', budgetMs: 4000 });
  assert.ok(res, 'flow вернул форму');
  const r = normalize(res);

  assert.equal(r.items.length, 2, 'первый голос минтится, второй — ленивый call');
  const first = r.items[0];
  assert.equal(first.method, 'play');
  assert.ok(first.url.startsWith('https://cdn.example/'), 'URL — прямой CDN (не skaz.tv/proxy)');
  assert.deepEqual(Object.keys(first.quality), ['1080p'], 'skaz.tv/proxy-метка из quality отмаскирована');
  assert.equal(first.subtitles.length, 1, 'субтитры из дескриптора');
  assert.ok(first.subtitles[0].url.startsWith('https://plugin.maniya-kvn.online/api/lampa/proxy?url='), 'субтитры через наш /proxy');
  assert.ok(first.subtitles[0].url.includes('origin=http%3A%2F%2Flampa.mx'), 'Origin на субтитрах как у эталона');
  assert.equal(first.hls_manifest_timeout, 30, 'hls_manifest_timeout пробрасывается');

  const lazy = r.items[1];
  assert.equal(lazy.method, 'call');
  assert.equal(lazy.url, 'maniya-thin://alloha/voice/1', 'ленивый голос — thin-call схема');
  assert.equal(lazy.title, 'Оригинал');
  assert.deepEqual(r.seasons, [], 'фильм: сезонов нет');
  assert.deepEqual(r.voices, [], 'фильм: голосов в форме нет (голоса — карточки)');

  // mint URL: прямой CDN-путь, креды из bootstrap, nws_id из живой ws-сессии.
  const mintUrl = s.net.find((u) => u.includes('/streams/1/video'));
  assert.ok(mintUrl, 'mint-запрос ушёл');
  const m = new URL(mintUrl);
  assert.equal(m.searchParams.get('account_email'), 'probe@maniya.test', 'account_email из bootstrap');
  assert.equal(m.searchParams.get('uid'), 'probe-uid', 'uid из bootstrap');
  assert.match(m.searchParams.get('nws_id') || '', /^[0-9a-f]{32}$/, 'nws_id = 32 hex');
  s.th.destroyAll();
});

test('module: сериал (lordfilm) → {items,seasons,voices} ровно как /videos', async () => {
  const s = await loadSandbox({ routes: clusterRoutes() });
  const res = await s.th.flow({ slug: 'lordfilm', movie: SERIAL, component: {}, sourceUrl: 'http://lite.example/lite/lordfilm', budgetMs: 4000 });
  assert.ok(res, 'flow вернул форму сериала');
  const r = normalize(res);

  assert.equal(r.items.length, 2, '1 серия = play, остальные — ленивые call');
  const ep1 = r.items[0];
  assert.equal(ep1.method, 'play');
  assert.equal(ep1.season, 1);
  assert.equal(ep1.episode, 1);
  assert.ok(ep1.url.startsWith('https://cdn.example/'), 'первая серия — прямой CDN');
  assert.equal(ep1.voice_name, 'Дубляж', 'голос из выбранного перевода');

  const ep2 = r.items[1];
  assert.equal(ep2.method, 'call');
  assert.equal(ep2.url, 'maniya-thin://lordfilm/ep/1/2', 'ленивая серия — thin-call схема');

  assert.deepEqual(r.seasons, [{ number: 1, title: '1 сезон' }, { number: 2, title: '2 сезон' }], 'сезоны из link-карточек');
  assert.deepEqual(r.voices, [{ name: 'Дубляж', index: 0 }, { name: 'Оригинал', index: 1 }], 'голоса из link-карточек');

  // Сезонная страница ушла с s=1 и кредами.
  const seasonUrl = s.net.find((u) => u.includes('/lite/lordfilm') && u.includes('s=1'));
  assert.ok(seasonUrl, 'страница сезона запрошена');
  assert.ok(seasonUrl.includes('account_email=probe%40maniya.test'), 'креды на сезонной странице');
  s.th.destroyAll();
});

test('module: ws-сессия — Connected→RchRegistry, nws_id в handshake и mint один и тот же, ping, close 1000, reuse', async () => {
  const s = await loadSandbox({ routes: clusterRoutes() });
  s.th._setPingMs(5); // ускоряем keepalive для теста
  const res = await s.th.flow({ slug: 'alloha', movie: MOVIE, component: {}, sourceUrl: 'http://lite.example/lite/alloha', budgetMs: 4000 });
  assert.ok(res, 'flow прошёл');

  assert.equal(s.wsInstances.length, 1, 'одна ws-сессия на хост за один flow');
  const ws = s.wsInstances[0];
  assert.match(ws.url, /^ws:\/\/lite\.example\/nws\?id=[0-9a-f]{32}&ver=1$/, 'ws-URL: /nws?id=<32hex>&ver=1');
  const wsId = new URL(ws.url).searchParams.get('id');

  const mintUrl = s.net.find((u) => u.includes('/streams/1/video'));
  assert.equal(new URL(mintUrl).searchParams.get('nws_id'), wsId, 'mint-запрос несёт nws_id ИМЕННО этой сессии');

  // Handshake: Connected → RchRegistry с host/rchtype apk.
  ws.fakeMessage({ method: 'Connected', args: ['conn-42'] });
  const registry = JSON.stringify({ method: 'RchRegistry', args: [{ host: 'lite.example', rchtype: 'apk', apkVersion: 0, player: null }] });
  assert.ok(ws.sent.includes(registry), 'после Connected уходит RchRegistry с host из bootstrap');
  ws.fakeMessage({ method: 'RchRegistry', args: ['1.2.3.4', 'conn-42'] }); // ack — не бросает

  // Keepalive-пинг после open.
  ws.fakeOpen();
  await sleep(25);
  assert.ok(ws.sent.includes('ping'), 'через ~PING_MS уходит ping');

  // Повторный резолв ленивого голоса — ТА ЖЕ сессия (sessions[host] жив).
  const lazyItem = { url: 'maniya-thin://alloha/voice/1', method: 'call' };
  const lazy = await s.th.resolveCall(lazyItem, MOVIE, {});
  assert.ok(lazy, 'ленивый голос резолвится');
  assert.equal(normalize(lazy).voice_name, 'Оригинал');
  assert.equal(s.wsInstances.length, 1, 'сессия переиспользована (новый ws не открывался)');

  // destroyAll: close(1000) + без исключений на поздние события
  // (STABILITY-004: orphan-сессия не должна крашить flow/promise).
  s.th.destroyAll();
  assert.equal(ws.closed, true, 'destroyAll закрыл ws');
  assert.equal(ws.readyState, 3, 'readyState закрыт');
  ws.fakeMessage({ method: 'Connected', args: ['late'] });   // не бросает (ws уже null)
  ws.fakeMessage({ method: 'RchRegistry', args: ['1.2.3.4', 'late'] });

  // Новая сессия на новом flow — старый разрушен, создаётся заново.
  const res2 = await s.th.flow({ slug: 'alloha', movie: MOVIE, component: {}, sourceUrl: 'http://lite.example/lite/alloha', budgetMs: 4000 });
  assert.ok(res2, 'после destroyAll новый flow работает');
  assert.equal(s.wsInstances.length, 2, 'сессия пересоздалась');
  s.th.destroyAll();
  s.clearPending();
});

test('module: зависший mint → flow null по бюджету (гарантированный settle, STABILITY-004)', async () => {
  const s = await loadSandbox({ routes: clusterRoutes({ mint: 'hang' }) });
  const started = Date.now();
  const res = await s.th.flow({ slug: 'alloha', movie: MOVIE, component: {}, sourceUrl: 'http://lite.example/lite/alloha', budgetMs: 700 });
  const elapsed = Date.now() - started;
  assert.equal(res, null, 'mint завис (fetch игнорирует abort) → бюджет вернул null');
  assert.ok(elapsed >= 450, `settle не мгновенный (waiting бюджет ≈${elapsed}ms)`);
  s.th.destroyAll();
});

test('module: cluster wrapper host/proxy/<token> в thin-потоке → direct (T052 lordfilm)', async () => {
  // lordfilm: нода отвечает на thin-минт С ДЕВАЙСА обёрткой `host/proxy/<token>`,
  // IP-bound к девайсу (T049: same-IP 200) → играем напрямую, без нашего /proxy.
  const s = await loadSandbox({ routes: clusterRoutes() });
  assert.equal(s.th.isDirectThin('https://cdn.example/hls/x.m3u8'), true, 'прямой CDN — да');
  assert.equal(s.th.isDirectThin('https://skaz.tv/proxy/abc'), true, 'cluster wrapper (thin-минт с девайса) → direct');
  assert.equal(s.th.isDirectThin('https://plugin.maniya-kvn.online/api/lampa/proxy?url=x'), false, 'наш /proxy — нет');
  assert.equal(s.th.isDirectThin('https://lampa.example/api/lampa/videos?provider=z'), false, 'наш /api/lampa/videos — нет');
  s.th.destroyAll();

  // Поведение: mint вернул wrapper → flow даёт item (прямой путь), а не legacy null.
  const wrapper = { body: { method: 'play', url: 'https://skaz.tv/proxy/<dev-token>', quality: {} } };
  const s2 = await loadSandbox({ routes: clusterRoutes({ mint: wrapper }) });
  const res = await s2.th.flow({ slug: 'alloha', movie: MOVIE, component: {}, sourceUrl: 'http://lite.example/lite/alloha', budgetMs: 4000 });
  assert.ok(res && res.items && res.items.length, 'wrapper от ноды → flow дал item (direct, а не legacy)');
  assert.ok(String(res.items[0].url).indexOf('/api/lampa/proxy') === -1, 'item.url НЕ через наш /proxy');
  s2.th.destroyAll();
});

test('module: resolveCall — ленивый EP-резолв и кэш-попадание по fingerprint', async () => {
  const s = await loadSandbox({ routes: clusterRoutes() });
  const flow = await s.th.flow({ slug: 'lordfilm', movie: SERIAL, component: {}, sourceUrl: 'http://lite.example/lite/lordfilm', budgetMs: 4000 });
  assert.ok(flow, 'сериал протек');

  const ep2 = await s.th.resolveCall(
    { url: 'maniya-thin://lordfilm/ep/1/2', method: 'call' }, SERIAL, {}
  );
  assert.ok(ep2, 'вторая серия резолвится');
  const r = normalize(ep2);
  assert.equal(r.method, 'play');
  assert.equal(r.season, 1);
  assert.equal(r.episode, 2);
  // Голос — из translate карточки серии. Сезонная страница lordfilm впитывает
  // перевод целиком (s=1&t=1 → серии Дубляжа), поэтому у ep2 — «Дубляж».
  assert.equal(r.voice_name, 'Дубляж', 'голос серии из её translate');

  // Кэш-промах (другой фильм) → null, ничего не бросая.
  const miss = await s.th.resolveCall({ url: 'maniya-thin://lordfilm/ep/1/2' }, { id: '999', title: 'Другой' }, {});
  assert.equal(miss, null, 'не в кэше → null (STABILITY: без исключений)');
  s.th.destroyAll();
});

test('module: парсеры lite-страниц и хелперы (unit)', async () => {
  const s = await loadSandbox({ routes: clusterRoutes() });
  const th = s.th;

  const cards = th.parseCards(ALLOHA_MOVIE_HTML);
  assert.equal(cards.length, 2, 'две карточки');
  assert.equal(normalize(cards[0]).method, 'call');
  assert.equal(normalize(cards[0])._text, 'Дубляж', 'nearbyText подтянул title');

  const serialCards = th.parseCards(LORDFILM_SERIAL_HTML);
  const voices = normalize(th.parseVoices(serialCards));
  assert.deepEqual(voices.map((v) => v.t), [1, 2], 'голоса из link-карточек без s');
  const seasons = normalize(th.parseSeasons(serialCards));
  assert.deepEqual(seasons.map((x) => x.number), [1, 2], 'сезоны из link-карточек с s');

  const epCards = th.parseCards(LORDFILM_SEASON_HTML);
  const eps = normalize(th.parseEpisodes(epCards, 1));
  assert.deepEqual(eps.map((e) => e.episode), [1, 2], 'эпизоды отсортированы');
  assert.equal(th.hasEpisodes(epCards), true, 'call+s+e → hasEpisodes');
  assert.equal(th.hasEpisodes(serialCards), false, 'link-карточки — не эпизоды');
  assert.equal(th.hasMovieItems(th.parseCards(ALLOHA_MOVIE_HTML)), true, 'call без s/e → movie items');

  assert.equal(th.paramValue('http://x/?t=3&title=%D0%94%D0%B5%D0%BB%D0%BE', 't'), '3');
  assert.equal(th.paramNumber('http://x/?s=41', 's'), 41);
  assert.equal(th.paramNumber('http://x/?z=abc', 'z'), null);

  assert.deepEqual(normalize(th.splitOr('a or b')), ['a', 'b']); // realm-массив → normalize (deepEqual ≡ deepStrictEqual)
  assert.deepEqual(normalize(th.splitOr('a%20or%20b')), ['a', 'b']);
  assert.equal(th.isThinCallUrl('maniya-thin://x/voice/0'), true);
  assert.equal(th.isThinCallUrl('https://x/y'), false);

  assert.equal(th.canonicalId({ kinopoisk_id: '455', id: 'x', tmdb_id: '9' }), '455', 'kp → id → tmdb → imdb');
  assert.equal(th.canonicalId({ id: '455' }), '455');
  assert.equal(th.canonicalId({ tmdb_id: '455' }), '455');
  assert.equal(th.canonicalId({ imdb_id: 'tt001', id: 'notnum' }), 'tt001');

  const params = th.pageParams(SERIAL, {});
  assert.ok(params.includes('serial=1'), 'сериал → serial=1');
  assert.ok(params.includes('id=123'), 'канон id');
  assert.ok(params.includes('original_title=Serial'), 'original_title');
  assert.ok(params.includes('year=2020'), 'год из first_air_date');
  assert.equal(params.length, 6, 'whitelist: id/title/original_title/serial/year/source (без мусора)');

  // descriptorToItem: склейка primary or reserve + качество.
  const item = normalize(th.descriptorToItem({
    method: 'play',
    url: 'https://cdn.example/a.m3u8 or https://cdn.example/b.m3u8',
    quality: { '1080p': 'https://cdn.example/a.m3u8?q=1' },
    subtitles: []
  }, { title: 'Т', type: 'movie' }));
  assert.equal(item.url, 'https://cdn.example/a.m3u8 or https://cdn.example/b.m3u8', 'or-резерв сохранён');
  assert.equal(item.voice_name, 'Т');
  assert.equal(th.descriptorToItem({ method: 'link' }, {}), null, 'не-play дескриптор → null');
  s.th.destroyAll();
});

test('component: thin-источник играет через клиентский mint (Z01, direct) — /videos не вызывается', async () => {
  const s = await loadSandbox({ z01: true, routes: clusterRoutes(), network: componentNetwork() });
  try {
    startComponent(s, { movie: MOVIE });

    // draw завершён = loading(false) второй раз (панель опроса 1 + render 2);
    // клиент сам минтил — mint-URL уже в fetch-сети.
    const drawn = await until(() => s.calls.activity.toggles >= 2 && s.net.some((u) => u.includes('/streams/1/video')));
    assert.ok(drawn, 'draw прошёл и клиент минтил (lite-цепочка с IP устройства)');

    const mint = new URL(s.net.find((u) => u.includes('/streams/1/video')));
    assert.match(mint.searchParams.get('nws_id') || '', /^[0-9a-f]{32}$/, 'nws_id на минте');
    assert.equal(mint.searchParams.get('account_email'), 'probe@maniya.test');
    assert.equal(mint.searchParams.get('uid'), 'probe-uid');

    assert.equal(s.th.flowOk('skaz-alloha'), true, 'direct доказан → flowReady (индикатор ✈)');
    assert.ok(!s.regNetwork.some((u) => u.includes('/api/lampa/videos')), 'серверный /videos НЕ запрашивался (главный A/B критерий)');
    assert.equal(s.calls.noty.length, 0, 'фолбэк-ноты нет');
  } finally {
    s.th.destroyAll();
    s.clearPending(); // uiPollTimer (1с) + watchdog (15с) не держат процесс
  }
});

test('component: провал тонкой ветки (mint без play) → Noty + legacy /videos ровно раз', async () => {
  // bootstrap ON, но mint не вернул {method:"play"} (нода не дала дескриптор):
  // thin-ветка стартует, direct не доказан → flow null → thinFallback: Noty +
  // повтор в legacy /videos с activeUrl=api_url (не cluster deep-link).
  const s = await loadSandbox({ z01: true, routes: clusterRoutes({ mint: NOT_PLAY_DESCRIPTOR }), network: componentNetwork() });
  try {
    startComponent(s, { movie: MOVIE });

    const drawn = await until(() => s.calls.activity.toggles >= 2 && s.regNetwork.some((u) => u.includes('/api/lampa/videos')));
    assert.ok(drawn, 'legacy /videos вызван и draw прошёл');

    assert.deepEqual(s.calls.noty, [LANG.maniya_thin_fallback], 'нота фолбэка показана ровно раз');
    const legacyCount = s.regNetwork.filter((u) => u.includes('/api/lampa/videos')).length;
    assert.equal(legacyCount, 1, 'legacy /videos — один (нет зацикливания)');
    assert.ok(s.net.some((u) => u.includes('/lite/')), 'кластер просматривался (flow стартовал)');
    assert.ok(s.net.some((u) => u.includes('/video')), 'mint запрашивался');
    assert.ok(!s.th.flowOk('skaz-alloha'), 'direct НЕ доказан (mint без play) → ✈ нет');
    assert.ok(s.calls.filterSet.some((f) => f.type === 'filter'), 'legacy голоса нарисовались (setFilters из /videos)');
  } finally {
    s.th.destroyAll();
    s.clearPending();
  }
});