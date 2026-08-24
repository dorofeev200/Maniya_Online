// T028 P3: CLIENT RUNTIME FIRST DIVERGENCE — доказательство через ВЫПОЛНЕНИЕ.
//
// Загружает НАСТОЯЩИЕ клиентские плагины в эмуляцию Lampa (vm-контекст) и прогоняет
// их против РЕАЛЬНЫХ зафиксированных сетевых ответов:
//   - backup/t028-moscow-sources.json   — /sources реального прода (Moscow, DNS)
//   - backup/t028-realprod-card.json    — /sources/card реального прода (770 B probe)
//   - backup/t028-t021-card.json        — /sources/card нашего Stockholm (model:true)
//   - backup/t028-realprod-moscow-plugin.js — плагин, который реально скачал TV (54779 B)
//   - backup/t028-t028-t021-plugin.js   — public/maniya-online.js (T021, 57085 B)
//
// Цель: зафиксировать, ЧТО реальный клиент видит на экране в обоих случаях:
//   - scope: [T028] сырой ответ /sources/card (есть ли model/index?)
//   - scope: [T028] modelMode = исполняется (true) или нет (false)
//   - scope: [T028] filterSources (ключи) + sources[key] -> UI sort-чипы
// READ-ONLY: ничего не меняет, только исполняет уже скачанные файлы.
import { readFileSync } from 'node:fs';

const BACKUP = 'backup';
const load = (p) => readFileSync(`${BACKUP}/${p}`, 'utf8');

const PLUGINS = {
  'prod-moscow': { file: 't028-realprod-moscow-plugin.js', label: 'ПЛАГИН REAL PROD (Moscow, что скачал TV)' },
  't021-stockholm': { file: 't028-t021-plugin.js', label: 'ПЛАГИН T021 (Stockholm, наш)' }
};
const SERVERS = {
  'moscow-realprod': {
    label: 'СЕРВЕР REAL PROD (Moscow, DNS -> TV)',
    sources: JSON.parse(load('t028-moscow-sources.json')),
    card: JSON.parse(load('t028-realprod-card.json'))
  },
  'stockholm-t021': {
    label: 'СЕРВЕР T021 (Stockholm /opt)',
    sources: JSON.parse(load('t028-moscow-sources.json')), // статик-реестр в обоих 21
    card: JSON.parse(load('t028-t021-card.json'))
  }
};

function makeSandbox(pluginFile, server, log) {
  const source = load(pluginFile);
  const filterCalls = { set: [], chosen: [] };
  const drawn = [];
  const network = [];
  const langMap = {
    title_filter: 'Фильтр', maniya_empty_sources: 'Нет источников', maniya_server_error: 'Ошибка сервера'
  };
  const fakeJq = {
    append: () => fakeJq, prepend: () => fakeJq, before: () => fakeJq, after: () => fakeJq,
    find: () => fakeJq, first: () => fakeJq, prev: () => fakeJq, remove: () => fakeJq,
    on: () => fakeJq, addClass: () => fakeJq, hasClass: () => false, attr: () => fakeJq,
    prop: () => '', text: () => fakeJq, html: () => fakeJq, is: () => false, length: 1
  };
  const lampa = {
    Storage: { get: (k, d) => d, set: () => {}, field: () => '' },
    Utils: {
      uid: () => 'abcdef12', hash: () => 'deadbeef',
      addUrlComponent: (u, p) => u + (u.includes('?') ? '&' : '?') + p,
      shortTitle: (s) => String(s || ''),
      shortText: (s, n) => String(s || '').slice(0, n)
    },
    Lang: { add: () => {}, translate: (k) => langMap[k] || k },
    Arrays: { isArray: Array.isArray, getKeys: Object.keys, decodeJson: (s) => JSON.parse(s) },
    Template: { add: () => {}, get: () => fakeJq },
    Scroll: function () { this.render = () => fakeJq; this.clear = () => {}; this.reset = () => {}; this.minus = () => {}; this.append = () => {}; this.update = () => {}; this.body = () => fakeJq; this.destroy = () => {}; },
    Explorer: function () { this.render = () => fakeJq; this.appendFiles = () => {}; this.appendHead = () => {}; this.destroy = () => {}; },
    Filter: function () {
      this._data = {};
      this.set = (type, items) => { this._data[type] = items; filterCalls.set.push({ type, items }); };
      this.chosen = (type, select) => filterCalls.chosen.push({ type, select });
      this.show = () => {};
      this.render = () => fakeJq;
    },
    Reguest: function () {
      this.timeout = () => {};
      this.silent = (url, ok) => {
        network.push(String(url));
        if (String(url).includes('/sources/card')) { log('[T028] GET ' + String(url).slice(0, 90) + ' …'); ok(server.card); return; }
        if (String(url).includes('/sources')) { log('[T028] GET ' + String(url).slice(0, 90) + ' …'); ok(server.sources); return; }
        ok({});
      };
      this.clear = () => {};
    },
    Select: { listener: { add: () => {}, remove: () => {}, send: () => {} }, show: () => {}, close: () => {} },
    Activity: { active: () => ({ activity, toggle: () => {}, loader: () => {} }), push: () => {}, backward: () => {} },
    Controller: { add: () => {}, toggle: () => {}, enable: () => {}, enabled: () => ({ name: '' }), collectionSet: () => {}, collectionFocus: () => {} },
    Navigator: { canmove: () => false, move: () => {} },
    TMDB: { image: () => '' },
    Player: { play: () => {}, playlist: () => {} },
    Loading: { start: () => {}, stop: () => {} },
    Noty: { show: () => {} },
    Manifest: { plugins: [] },
    Component: { add: (name, fn) => { lampa._component = fn; } },
    Listener: { follow: () => {}, remove: () => {} }
  };

  // [T028] self-updateFilter: ВЫВОД источников -> финальный UI sort-чипер
  const activity = { toggle: () => {}, loader: () => {} };
  const ctx = {
    console, $: () => fakeJq, Lampa: lampa, Navigator: lampa.Navigator,
    document: { currentScript: null, getElementsByTagName: () => [] },
    location: { href: 'http://localhost/player.html?token=mo-t', search: '' }
  };
  ctx.window = ctx;
  // eslint-disable-next-line no-eval
  (0, eval)('(function(){ ' + source + '\n })()').call(ctx); // нет — аккуратно через vm
}

// Обойдёмся через node:vm, чтобы не исполнять в своём окружении.
import vm from 'node:vm';

function runCase(pluginKey, serverKey, log) {
  const plugin = PLUGINS[pluginKey];
  const server = SERVERS[serverKey];
  log(`\n===== [T028] ${plugin.label}`);
  log(`     × ${server.label}`);

  const source = load(plugin.file);
  const filterCalls = { set: [], chosen: [] };
  const net = [];
  const langMap = { title_filter: 'Фильтр', maniya_empty_sources: 'Нет источников', maniya_server_error: 'Ошибка сервера' };
  const fakeJq = {
    append: () => fakeJq, prepend: () => fakeJq, before: () => fakeJq, after: () => fakeJq,
    find: () => fakeJq, first: () => fakeJq, prev: () => fakeJq, remove: () => fakeJq,
    on: () => fakeJq, off: () => fakeJq, addClass: () => fakeJq, removeClass: () => fakeJq,
    hasClass: () => false, attr: () => fakeJq, prop: () => '', val: () => fakeJq,
    text: () => fakeJq, html: () => fakeJq, is: () => false, eq: () => fakeJq,
    each: () => fakeJq, css: () => fakeJq, show: () => fakeJq, hide: () => fakeJq,
    length: 1
  };
  const lampa = {
    Storage: { get: (k, d) => d, set: () => {}, field: () => '' },
    Utils: {
      uid: () => 'abcdef12', hash: () => 'deadbeef',
      addUrlComponent: (u, p) => u + (u.includes('?') ? '&' : '?') + p,
      shortText: (s, n) => String(s || '').slice(0, n),
      shortTitle: (s) => String(s || ''),
      cardImgBackgroundBlur: () => ''
    },
    Lang: { add: () => {}, translate: (k) => langMap[k] || k },
    Arrays: { isArray: Array.isArray, getKeys: Object.keys, decodeJson: (s) => JSON.parse(s) },
    Template: { add: () => {}, get: () => fakeJq },
    Background: { immediately: () => {} },
    Scroll: function () { this.render = () => fakeJq; this.clear = () => {}; this.reset = () => {}; this.minus = () => {}; this.append = () => {}; this.update = () => {}; this.body = () => fakeJq; this.destroy = () => {}; },
    Explorer: function () { this.render = () => fakeJq; this.appendFiles = () => {}; this.appendHead = () => {}; this.destroy = () => {}; },
    Filter: function () {
      this._data = {};
      this.set = (type, items) => { this._data[type] = items; filterCalls.set.push({ type, items }); };
      this.chosen = (type, select) => filterCalls.chosen.push({ type, select });
      this.show = () => {};
      this.render = () => fakeJq;
    },
    Reguest: function () {
      this.timeout = () => {};
      this.silent = (url, ok, error) => {
        net.push(String(url));
        const u = String(url);
        log('[T028]   → ' + (u.includes('/sources/card') ? '/sources/card' : u.includes('/sources') ? '/sources' : u.slice(-60)));
        if (u.includes('/sources/card')) return ok(server.card);
        if (u.includes('/sources')) return ok(server.sources);
        return ok({});
      };
      this.clear = () => {};
    },
    Select: { listener: { add: () => {}, remove: () => {}, send: () => {} }, show: () => {}, close: () => {} },
    Activity: { active: () => ({ activity, toggle: () => {}, loader: () => {} }), push: () => {}, backward: () => {} },
    Controller: { add: () => {}, toggle: () => {}, enable: () => {}, enabled: () => ({ name: '' }), collectionSet: () => {}, collectionFocus: () => {} },
    Navigator: { canmove: () => false, move: () => {} },
    TMDB: { image: () => '' },
    Player: { play: () => {}, playlist: () => {} },
    Loading: { start: () => {}, stop: () => {} },
    Noty: { show: () => {} },
    Manifest: { plugins: [] },
    Component: { add: (name, fn) => { lampa._component = fn; } },
    Listener: { follow: () => {}, remove: () => {} }
  };
  const activity = { toggle: () => {}, loader: () => {} };
  const ctx = {
    console, $: () => fakeJq, Lampa: lampa, Navigator: lampa.Navigator,
    document: { currentScript: null, getElementsByTagName: () => [] },
    location: { href: 'http://localhost/player.html?token=mo-t', search: '' }
  };
  ctx.window = ctx;

  vm.runInNewContext(source, ctx, { filename: plugin.file });
  const inst = { activity };
  lampa._component.call(inst, {
    movie: { id: 1288445, source: 'tmdb', name: 'Мятеж', original_name: 'Mutiny', year: 2026 }
  });
  inst.start();

  // После applyCardAvailability конечные источники
  const sortCalls = filterCalls.set.filter((c) => c.type === 'sort');
  const sort = sortCalls.length ? sortCalls[sortCalls.length - 1] : null; // ПОСЛЕДНИЙ = итог после model/legacy
  const sortArr = sort ? sort.items : [];
  const nCall = sortCalls.length;
  const shown = sortArr.filter((i) => !i.ghost).length;
  const hidden = sortArr.filter((i) => i.ghost).length;
  log(`[T028]   filter.set('sort') вызовов=${nCall} ПОСЛЕДНИЙ чипов=${sortArr.length} (shown=${shown} ghost=${hidden})`);
  const prev = nCall >= 2 ? sortCalls[nCall - 2].items : null;
  if (prev) log(`[T028]   предпоследний sort (до model/applyCardAvailability): ${prev.length} чипов, первый=${prev[0] ? prev[0].title : '—'}`);
  log(`[T028]   первый чип ПОСЛЕ: ${sortArr[0] ? JSON.stringify(sortArr[0].title) + ' ghost=' + JSON.stringify(sortArr[0].ghost) : '—'}`);
  log(`[T028]   чипы ПОСЛЕ (по 6): ${sortArr.slice(0, 18).map((i) => (i.ghost ? '✗' : '✓') + i.title).join(' | ')}`);
  return { sortArr, net, filterCalls, nCall };
}

// РЕЗУЛЬТАТЫ
// Кейс A: реальный TV видит ровно это — PROD-плагин × REAL PROD сервер
// Кейс B: плагин T021 × REAL PROD сервер (что было бы, если TV просто перекачал бы плагин)
// Кейс C: плагин T021 × T021-сервер (что было на Stockholm)
// Кейс D: PROD-плагин × T021-сервер (контроль)

console.log('T028 P3 — CLIENT RUNTIME (vm-Lampa эмуляция, реальные плагины и сетевые ответы)');
runCase('prod-moscow', 'moscow-realprod', console.log);        // A
runCase('t021-stockholm', 'moscow-realprod', console.log);     // B
runCase('t021-stockholm', 'stockholm-t021', console.log);      // C
runCase('prod-moscow', 'stockholm-t021', console.log);         // D
console.log('\n[нормальный конец: все 4 кейса выполнены]');