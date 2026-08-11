import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/maniya-online.js');

/**
 * Загружает НАСТОЯЩИЙ public/maniya-online.js в изолированный vm-контекст.
 * Критично: `Lampa.Select` в заглушке имеет ТОЛЬКО `show`+`close` — БЕЗ `.open`,
 * ровно как реальная Lampa пользователя. Если код плагина обращается к
 * `Lampa.Select.open(...)`, в этом контексте бросится `TypeError:
 * Lampa.Select.open is not a function` — регрессия «Script error.» воспроизведётся.
 */
async function loadSandbox() {
  const source = await readFile(PLUGIN_PATH, 'utf8');
  const calls = { show: [], close: 0, toggle: [] };
  const langMap = { maniya_watch_quality: 'Смотреть в качестве', maniya_quality: 'Качество' };

  const lampa = {
    Storage: {
      // video_quality_default = '1080p' — поведение Lampa: дефолт качества из настроек
      get: (key, fallback) => fallback,
      set: () => {},
      remove: () => {},
      field: (key) => (key === 'video_quality_default' ? '1080p' : '')
    },
    Arrays: { isArray: Array.isArray, getKeys: Object.keys, decodeJson: (s) => JSON.parse(s) },
    Utils: {
      uid: () => 'abcdef12',
      addUrlComponent: (u, p) => u + (u.indexOf('?') >= 0 ? '&' : '?') + p,
      hash: () => 'deadbeef',
      decodeJson: (s) => JSON.parse(s)
    },
    Manifest: { plugins: [] },
    Component: { add: () => {} },
    Listener: { follow: () => {} },
    Activity: {
      // вызвана на старте внутри try/catch — бросаем, как «нет активного экрана»
      active: () => { throw new Error('no active activity (sandbox)'); }
    },
    Lang: { translate: (k) => langMap[k] || k, add: () => {} },
    Template: {
      add: () => {},
      get: () => fakeJq
    },
    Reguest: function () {},
    Controller: {
      enabled: () => ({ name: 'content' }),
      toggle: (name) => calls.toggle.push(name)
    },
    Select: {
      // НАМЕРЕННО без open — реальная Lampa пользователя
      show: (opts) => calls.show.push(opts),
      close: () => { calls.close += 1; }
    },
    TMDB: { image: (url) => 'https://img.proxy.example/' + url },
    Player: { play: () => {}, playlist: () => {} },
    Loading: { stop: () => {}, show: () => {} },
    Noty: { show: () => {} }
  };

  // jQuery-совместимая цепочка для Lampa.Template.get / $() на старте плагина
  const fakeJq = {
    append: () => fakeJq,
    prepend: () => fakeJq,
    before: () => fakeJq,
    after: () => fakeJq,
    find: () => fakeJq,
    first: () => fakeJq,
    remove: () => fakeJq,
    on: () => fakeJq,
    addClass: () => fakeJq,
    hasClass: () => false,
    attr: () => fakeJq,
    prop: () => '',
    text: () => fakeJq,
    html: () => fakeJq,
    is: () => false,
    length: 0
  };
  lampa.Template.get = () => fakeJq;

  const context = {
    console,
    $: () => fakeJq,
    Lampa: lampa,
    document: { currentScript: null, getElementsByTagName: () => [] },
    location: { href: 'http://localhost:9999/player.html' },
    localStorage: { getItem: () => null, setItem: () => {} }
  };
  context.window = context; // window[PLUGIN_FLAG], MANIYA_LIB и пр. — на самом контексте

  vm.runInNewContext(source, context, { filename: 'maniya-online.js' });

  const lib = context.window.MANIYA_LIB;
  assert.ok(lib && typeof lib.openQualitySelect === 'function', 'MANIYA_LIB экспортирован');
  return { lib, lampa, calls, context };
}

test('static: нет Lampa.Select.open и hardcoded image.tmdb.org; есть канонический show/TMDB.image; pre-play Select удалён', async () => {
  const source = await readFile(PLUGIN_PATH, 'utf8');
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  assert.ok(!/Lampa\.Select\.open/.test(stripped),
    'Lampa.Select.open не должен встречаться в коде (в реальной Lampa его нет → Script error)');
  assert.ok(!/image\.tmdb\.org/.test(stripped),
    'hardcoded image.tmdb.org не должен встречаться (у пользователя блокируется → чёрный постер)');
  assert.match(stripped, /api\.show\(\{/, 'Select (там, где нужен) — через канонический show({items, onSelect, onBack})');
  assert.match(stripped, /Lampa\.TMDB\.image\(/, 'постер — через настроенный клиентом image-CDN');
  assert.match(stripped, /\.on\('error'[\s\S]*?img_broken\.svg/, 'onerror постера → img_broken (механизм E-Online)');
  assert.match(stripped, /orUrlReserve\(/, 'primary-or-reserve split присутствует');
  assert.match(stripped, /setDefaultQuality\(/, 'дефолт качества из настроек Lampa присутствует');
  assert.match(stripped, /MANIYA_LIB\s*=\s*\{/, 'тестовая ручка экспортирована');
  // Клик результата НЕ открывает предплеерный селектор — качество выбирает нативный
  // плеер (play.quality = карта), ровно как в рабочем E-Online (Online/plugin.js).
  assert.ok(!stripped.includes('chooseQuality(item, entries)'),
    'pre-play выбор качества удалён из клика — играем дефолт, карта уходит в плеер');
});

test('поведение: Lampa.Select без .open — селектор качества работает через show (регрессия «Script error.»)', async () => {
  const { lib, calls } = await loadSandbox();

  const item = {
    title: 'Человек-паук: Нет пути домой',
    quality: {
      '1080p': 'https://cdn.example/1080.mp4',
      '720p': 'https://cdn.example/720.mp4',
      '480p': 'https://cdn.example/480.mp4',
      '360p': 'https://cdn.example/360.mp4'
    },
    subtitles: [{ url: 'https://cdn.example/sub-ru.srt', label: 'Русские' }]
  };
  const entries = lib.qualityEntries(item);
  assert.equal(entries.length, 4, '4 качества из мапы');

  let runCalled = null;
  lib.openQualitySelect(item, entries, (sourceItem, stream) => {
    runCalled = { sourceItem, stream };
  }); // 4-й арг (select) не передаём → Lampa.Select из sandbox (БЕЗ .open)

  assert.equal(calls.show.length, 1, 'show вызван ровно один раз');
  const opts = calls.show[0];
  assert.ok(opts.title.includes('Человек-паук'), 'заголовок селектора');
  assert.deepEqual(Array.from(opts.items).map((i) => i.label), ['1080p', '720p', '480p', '360p'],
    'качества отсортированы по приоритету (1080 → 360)');
  assert.ok(typeof opts.onSelect === 'function' && typeof opts.onBack === 'function');

  opts.onSelect(opts.items[0]); // пользователь выбрал 1080p

  assert.equal(calls.close, 1, 'select закрыт после выбора');
  assert.deepEqual(calls.toggle, ['content'], 'контроллер переключён обратно на контент');
  assert.ok(runCalled, 'run вызван → запуск плеера с выбранным качеством');
  assert.equal(runCalled.stream.url, 'https://cdn.example/1080.mp4');
  assert.deepEqual(runCalled.stream.quality, item.quality, 'мапа качеств проброшена в плеер');
  assert.deepEqual(runCalled.stream.subtitles, item.subtitles, 'субтитры проброшены в плеер');

  opts.onBack();
  assert.deepEqual(calls.toggle, ['content', 'content'], 'onBack тоже переключает контроллер');
});

test('поведение: orUrlReserve — primary or reserve → url + url_reserve (E-Online 631-637)', async () => {
  const { lib } = await loadSandbox();

  const data = { url: 'https://a/1080.m3u8 or https://b/1080.m3u8' };
  lib.orUrlReserve(data);
  assert.equal(data.url, 'https://a/1080.m3u8');
  assert.equal(data.url_reserve, 'https://b/1080.m3u8');

  const single = { url: 'https://only.example/x.m3u8' };
  lib.orUrlReserve(single);
  assert.equal(single.url, 'https://only.example/x.m3u8');
  assert.equal(single.url_reserve, undefined, 'без " or " резерва нет');
});

test('поведение: setDefaultQuality — дефолт из Lampa settings, " or " в карте → primary (E-Online 638-648)', async () => {
  const { lib } = await loadSandbox();

  // video_quality_default='1080p' → url переключается на 1080p; его " or " split;
  // остальные значения карты тоже очищаются от " or " (остаётся primary).
  const data = {
    url: 'https://primary/play.m3u8 or https://reserve/play.m3u8',
    quality: {
      '1080p': 'https://c/1080.m3u8 or https://d/1080.m3u8',
      '720p': 'https://e/720.m3u8',
      '480p': 'https://f/480.m3u8'
    }
  };
  lib.setDefaultQuality(data);

  assert.equal(data.url, 'https://c/1080.m3u8', 'url = дефолтное качество (1080p)');
  assert.equal(data.url_reserve, 'https://d/1080.m3u8', 'резерв дефолтного качества');
  assert.equal(data.quality['1080p'], 'https://c/1080.m3u8', 'карта очищена от " or "');
  assert.deepEqual(data.quality['720p'], 'https://e/720.m3u8');
  assert.deepEqual(data.quality['480p'], 'https://f/480.m3u8');
});

test('поведение: качество без совпадения с дефолтом — url не трогается, карта чистится', async () => {
  const ss = await loadSandbox();
  // field() всегда '1080p', а в карте только 480/360 → дефолт не применится.
  // Как в runPlayer: сначала orUrlReserve, потом setDefaultQuality.
  const data = {
    url: 'https://primary/x.m3u8 or https://reserve/x.m3u8',
    quality: { '480p': 'https://f/480.m3u8 or https://g/480.m3u8', '360p': 'https://h/360.m3u8' }
  };
  ss.lib.orUrlReserve(data);
  ss.lib.setDefaultQuality(data);
  assert.equal(data.url, 'https://primary/x.m3u8', 'url остался primary');
  assert.equal(data.url_reserve, 'https://reserve/x.m3u8');
  assert.equal(data.quality['480p'], 'https://f/480.m3u8', '" or " в карте почищен');
  assert.equal(data.quality['360p'], 'https://h/360.m3u8');
});

test('поведение: moviePoster резолвит backdrop/poster через Lampa.TMDB.image (механизм E-Online 1234)', async () => {
  const { lib } = await loadSandbox();

  assert.equal(
    lib.moviePoster({ backdrop_path: '/abc123.jpg', poster_path: '/x.jpg' }),
    'https://img.proxy.example/t/p/w300/abc123.jpg',
    'backdrop имеет приоритет и проходит через настроенный image-CDN'
  );
  assert.equal(
    lib.moviePoster({ poster_path: '/poster.jpg' }),
    'https://img.proxy.example/t/p/w300/poster.jpg',
    'без backdrop берётся poster_path'
  );
  assert.equal(lib.moviePoster({}), '', 'пустой movie → нет постера');
  assert.equal(lib.moviePoster(null), '', 'null movie → нет постера');
});

test('поведение: sourceLabel — «🎬 Allo-XA - 4K», fallback-иконка у неизвестного', async () => {
  const { lib } = await loadSandbox();

  // Иконка ПЕРЕД названием, качество — через « - ». (ВИЗУАЛЬНЫЕ ЗНАЧКИ)
  assert.equal(
    lib.sourceLabel({ name: 'Allo-XA', icon: '🎬', quality_label: '4K' }),
    '🎬 Allo-XA - 4K'
  );
  // Без качества подписи короче; без меты → fallback-иконка 🎬.
  assert.equal(lib.sourceLabel({ name: 'GeoVideo', icon: '🌍' }), '🌍 GeoVideo');
  assert.equal(lib.sourceLabel({ name: 'PidTor' }), '🎬 PidTor');
  assert.equal(lib.sourceLabel({}), '🎬 ');
  // fallbackName — уже отформатированное сервером имя (brand), не трогаем.
  assert.equal(lib.sourceLabel(null, 'Maniya · X'), '🎬 Maniya · X');
});

test('поведение: qualityEntries — строковое качество и пустые/отсутствующие мапы', async () => {
  const { lib } = await loadSandbox();

  // Объекты созданы в vm-реалме → приводим в тестовый реалм через Array.from
  // (deepStrictEqual считает другой Array.prototype за разные объекты).
  const two = lib.qualityEntries({ quality: { '1080p': 'u1', '720p': 'u2' } });
  assert.deepEqual(Array.from(two).map((e) => e.label), ['1080p', '720p']);
  assert.deepEqual(Array.from(two).map((e) => e.url), ['u1', 'u2']);

  const one = lib.qualityEntries({ quality: '1080p' });
  assert.deepEqual(Array.from(one).map((e) => e.label), ['1080p'], 'строка-качество → один элемент');
  assert.deepEqual(Array.from(one).map((e) => e.url), ['']);

  assert.deepEqual(Array.from(lib.qualityEntries({})), []);
  assert.deepEqual(Array.from(lib.qualityEntries(null)), []);
});

test('static: мобильная карточка — компактный постер (Lampac-модель), TV-базовый блок не тронут', async () => {
  const source = await readFile(PLUGIN_PATH, 'utf8');
  const line640 = source.split('\n').find((l) => l.includes('@media (max-width:640px)'));
  assert.ok(line640, 'mobile media-запрос (max-width:640px) присутствует');

  // Root cause «растянутого» постера: базовый блок имеет align-self:stretch + min-height
  // → высота = высоте тела карточки (длинный заголовок/бейджи раздувают постер по вертикали).
  // На мобильном stretch отменён, постер absolute cover внутри фикс. блока (модель
  // Lampac online-prestige__img: width + min-height, plugin.js 2012-2044) → карточка компактна.
  assert.match(line640, /maniya-online-item__poster-block\{[^}]*?align-self:flex-start/,
    'постер-блок не растягивается по высоте тела на мобильном');
  assert.doesNotMatch(line640, /maniya-online-item__poster-block\{[^}]*?align-self:stretch/,
    'в мобильном блоке НЕТ content-driven stretch');
  assert.match(line640, /maniya-online-item__poster-block\{[^}]*?min-height:/,
    'у блока есть фиксированная min-height (как online-prestige__img)');
  assert.match(line640, /maniya-online-item__poster\{[^}]*?position:absolute/,
    'постер absolute внутри блока (не растягивает блок)');
  assert.match(line640, /maniya-online-item__poster\{[^}]*?object-fit:cover/,
    'постер сохраняет object-fit:cover → без искажений');
  assert.match(line640, /maniya-online-item__title\{[^}]*?-webkit-line-clamp:2/,
    'длинный заголовок обрезается на 2 строки (truncate)');

  // TV-базовые правила (вне media) — БЕЗ изменений: постер-блок 8.5em + stretch как было.
  const baseBlock = source.match(/\.maniya-online-item__poster-block\{([^}]*)\}/);
  assert.ok(baseBlock, 'базовый TV-блок постера присутствует');
  assert.ok(baseBlock[1].includes('flex:0 0 8.5em'), 'TV ширина постера 8.5em не изменилась');
  assert.ok(baseBlock[1].includes('align-self:stretch'), 'TV layout сохранил stretch (как было)');
  assert.match(source, /\.maniya-online-item__poster\{[^}]*?object-fit:cover/,
    'TV img по-прежнему object-fit:cover');
});

test('поведение: qualityChips — 1080p/720p/480p/360p компактными бейджами, сортировка 1080→360', async () => {
  const { lib } = await loadSandbox();
  const chips = lib.qualityChips({
    quality: { '480p': 'u1', '1080p': 'u2', '360p': 'u3', '720p': 'u4' }
  });
  // Порядок бейджей: 1080p → 720p → 480p → 360p (qualityPriority, Filmix-мапа).
  assert.deepEqual(
    Array.from(chips.matchAll(/maniya-online-item__quality">([^<]+)</g)).map((m) => m[1]),
    ['1080p', '720p', '480p', '360p'],
    '4 бейджа качества в порядке приоритета'
  );
  assert.ok(chips.includes('maniya-online-item__quality'), 'бейджи используют общий класс (не Filmix-хак)');
});