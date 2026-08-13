// Гарнесс: выполняет РЕАЛЬНЫЙ public/maniya-online.js с заглушкой Lampa и
// РЕАЛЬНЫМ payload /api/lampa/videos (production). Цель — увидеть, какие
// filter.set/chosen реально вызываются для сериала, как называются нарисованные
// серии и куда уходит /videos-запрос при выборе сезона.
import { readFileSync } from 'node:fs';

const VIDEOS = JSON.parse(readFileSync('C:/Users/Admin/AppData/Local/Temp/videos-prod.json', 'utf8'));

// ── цепочко-заглушка jQuery ────────────────────────────────────────────
function makeNode() {
  const node = {
    _text: '', _html: '', _children: [],
    find() { return node; },
    first() { return node; },
    prev() { return node; },
    text(v) { if (v !== undefined) { node._text = v; return node; } return node._text; },
    html(v) { if (v !== undefined) { node._html = v; return node; } return node._html; },
    append() { return node; },
    prepend() { return node; },
    before() { return node; },
    after() { return node; },
    remove() { return node; },
    addClass() { return node; },
    removeClass() { return node; },
    toggleClass() { return node; },
    on() { return node; },
    off() { return node; },
    attr() { return node; },
    css() { return node; },
    show() { return node; },
    hide() { return node; },
    empty() { return node; },
    prop() { return 'outerHTML'; },
    is() { return false; },
    length: 1,
    eq() { return node; },
    hasClass() { return false; }
  };
  return node;
}
function $sel() { return makeNode(); }
$sel.ajax = () => {};

// ── Lampa-заглушка ─────────────────────────────────────────────────────
const filterLog = { set: [], chosen: [], show: [] };
const filterInstances = [];
const drawnItems = [];
const networkLog = [];
let currentActivity = null;

function FakeFilter(object) {
  const self = this;
  filterInstances.push(self);
  this._node = makeNode();
  this.set = (type, items) => { filterLog.set.push({ type, items }); };
  this.chosen = (type, select) => { filterLog.chosen.push({ type, select }); };
  this.show = (title, type) => { filterLog.show.push({ title, type }); };
  this.render = () => self._node;
  this.onSelect = null;
  this._object = object;
}

const templates = {};
const storage = { maniya_token: 'mo-test-token', account_email: '' };
const networkByUrl = (url) => {
  networkLog.push(String(url));
  if (url.includes('/api/lampa/sources')) {
    return {
      sources: [{ id: 'filmix', name: 'Filmix', icon: '🎬', quality_label: '4K', url: 'https://plugin.maniya-kvn.online/api/lampa/videos?provider=filmix', show: true }]
    };
  }
  if (url.includes('/api/lampa/videos')) return VIDEOS;
  return { items: [] };
};

const Lampa = {
  Storage: {
    get: (k, def) => (k in storage ? storage[k] : def),
    set: (k, v) => { storage[k] = v; },
    field: () => ''
  },
  Utils: {
    uid: (n) => 'u'.repeat(n),
    hash: (s) => 'h'.repeat(8),
    addUrlComponent: (url, part) => url + (url.includes('?') ? '&' : '?') + part,
    shortText: (s, n) => String(s || '').slice(0, n),
    cardImgBackgroundBlur: () => ''
  },
  Lang: {
    add: () => {},
    translate: (k) => ({ maniya_source: 'Источник', maniya_season: 'Сезон', maniya_voice: 'Озвучка', maniya_episode: 'Серия', maniya_watch: 'Смотреть', maniya_subscription_error: 'Ошибка', maniya_no_results: 'Ничего не найдено', maniya_empty_sources: 'Нет источников', maniya_server_error: 'Ошибка сервера', title_maniya: 'Maniya Online', maniya_subscription_required: 'Нужна подписка', title_filter: 'Фильтр' })[k] || k
  },
  Arrays: {
    decodeJson: (s, d) => { try { return JSON.parse(s); } catch { return d; } },
    isArray: (v) => Array.isArray(v),
    getKeys: (o) => Object.keys(o || {})
  },
  Template: {
    add: () => {},
    get: (name, data) => {
      if (name === 'maniya_video_item' && data) drawnItems.push(data);
      if (!templates[name]) templates[name] = makeNode();
      return templates[name];
    }
  },
  Scroll: function () {
    this.render = () => makeNode();
    this.clear = () => {};
    this.reset = () => {};
    this.minus = () => {};
    this.append = () => {};
    this.update = () => {};
    this.body = () => makeNode();
    this.destroy = () => {};
  },
  Explorer: function () {
    this.render = () => makeNode();
    this.appendFiles = () => {};
    this.appendHead = () => {};
    this.destroy = () => {};
  },
  Filter: FakeFilter,
  Reguest: function () {
    this.timeout = () => {};
    this.silent = (url, ok, err) => {
      const res = networkByUrl(url);
      console.log(`[silent] ${String(url).split('?')[0]} ->`, Array.isArray(res) ? `array(${res.length})` : `keys=${Object.keys(res).join(',')}`);
      try { ok(res); } catch (e) { console.log('[silent ERR]', String(e)); err({ message: String(e) }); }
    };
    this.clear = () => {};
  },
  Select: { show: (opts) => { if (opts && typeof opts.onSelect === 'function' && opts.items && opts.items.length) opts.onSelect(opts.items[0]); }, close: () => {} },
  Activity: { active: () => ({ activity: currentActivity, component: '' }), push: () => {}, backward: () => {} },
  Controller: { add: () => {}, toggle: () => {}, enable: () => {}, enabled: () => ({ name: '' }), collectionSet: () => {}, collectionFocus: () => {} },
  Background: { immediately: () => {} },
  Navigator: { canmove: () => false, move: () => {} },
  TMDB: { image: () => '' },
  Player: { subtitles: () => {}, play: () => {}, playlist: () => {} },
  Loading: { start: () => {}, stop: () => {} },
  Noty: { show: () => {} },
  Manifest: { plugins: null },
  Component: { add: (name, fn) => { registeredComponent = fn; } },
  Listener: { follow: () => {}, remove: () => {} }
};

let registeredComponent = null;

// ── исполняем РЕАЛЬНЫЙ плагин ─────────────────────────────────────────
const source = readFileSync('C:/Users/Admin/Maniya_Online/public/maniya-online.js', 'utf8');
const href = 'https://plugin.maniya-kvn.online/maniya-online.js?token=mo-test-token';
const localStorageStub = {
  _d: { maniya_token: 'mo-test-token' },
  getItem: (k) => (k in this._d ? this._d[k] : null),
  setItem: (k, v) => { this._d[k] = v; }
};
const context = {
  window: { localStorage: localStorageStub, PLUGIN_FLAG: undefined, currentScript: null, location: { href, search: '' } },
  document: { getElementsByTagName: () => [], currentScript: null },
  location: { href, search: '' },
  navigator: {},
  Lampa,
  $: $sel,
  Navigator: Lampa.Navigator,
  console
};
context.window.window = context.window;
context.window.document = context.document;
context.window.Lampa = Lampa;
context.window.$ = $sel;

const vm = await import('node:vm');
vm.runInNewContext(source, context);

if (!registeredComponent) { console.error('КОМПОНЕНТ НЕ ЗАРЕГИСТРИРОВАН'); process.exit(1); }

function runFlow(label, movieObj) {
  filterLog.set = []; filterLog.chosen = []; filterLog.show = [];
  filterInstances.length = 0;
  drawnItems.length = 0;
  networkLog.length = 0;
  currentActivity = { loader: () => {}, toggle: () => {} };
  const ctx = { activity: currentActivity };
  registeredComponent.call(ctx, { movie: movieObj });
  const c = ctx;
  console.log(`[dbg ${label}] c.start=${typeof c.start} c.activity===currentActivity=${c.activity === currentActivity} active.activity===currentActivity=${Lampa.Activity.active().activity === currentActivity} keys=${Object.keys(c).join(',')}`);
  try {
    c.start();
    const sets = filterLog.set.map(s => ({ type: s.type, n: (s.items || []).length, stypes: (s.items || []).map(i => i.stype || 'none') }));
    console.log(`\n=== ${label} ===`);
    console.log('filter.set:', JSON.stringify(sets));
    console.log('filter.chosen:', JSON.stringify(filterLog.chosen.map(x => ({ type: x.type, sel: x.select }))));
    const f = filterLog.set.find(s => s.type === 'filter');
    if (f) console.log('filter items:', JSON.stringify(f.items.map(i => { const its = i.items || []; return { title: i.title, stype: i.stype || 'none', n: its.length, first: its[0], last: its[its.length - 1] }; })));
    console.log('drawn items:', JSON.stringify(drawnItems.map(it => ({ season: it.season, episode: it.episode, title: it.title }))));
    const v = networkLog.find(u => u.includes('/videos')) || '';
    console.log('videos url:', v);
    console.log('networkLog:', JSON.stringify(networkLog));

    // Симулируем выбор сезона 3 через канонический onSelect('filter', seasonItem, subitem)
    const seasonItem = f && f.items.find(i => i.stype === 'season');
    if (seasonItem) {
      networkLog.length = 0; drawnItems.length = 0;
      const sub = seasonItem.items.find(i => i.title.includes('3'));
      filterInstances[0].onSelect('filter', seasonItem, sub);
      const v3 = networkLog.find(u => u.includes('/videos')) || '';
      console.log('после выбора сезона: videos url:', v3);
    }
    return c;
  } catch (e) {
    console.log(`\n=== ${label} === ИСКЛЮЧЕНИЕ:`, e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n') : String(e));
    return null;
  }
}

const serialInst = runFlow('СЕРИАЛ (Дом Дракона, 3 сезона)', {
  id: 1396, name: 'Дом Дракона', original_name: 'House of the Dragon', first_air_date: '2022-08-21'
});

// фильм — контроль, что movie flow не сломан
runFlow('ФИЛЬМ (Форрест Гамп)', {
  id: 1567, title: 'Форрест Гамп', original_title: 'Forrest Gump', release_date: '1994-07-06'
});
