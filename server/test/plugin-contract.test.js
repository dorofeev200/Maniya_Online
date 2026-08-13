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

test('static: сезоны/озвучки — через канонический filter.set(\'filter\') с stype, а не отдельные типы', async () => {
  const source = await readFile(PLUGIN_PATH, 'utf8');
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  // ROOT CAUSE «нет отображения сезонов/серий»: Lampa.Filter рендерит только
  // sort/filter/search. filter.set('season'/'voice') как ОТДЕЛЬНЫЕ типы не дают
  // видимого селектора — E-Online кладёт их ПОД-фильтрами одного `filter`
  // (stype: season/voice). Здесь — тот же канонический механизм.
  assert.match(stripped, /filter\.set\('filter',\s*select\)/, 'сезоны/озвучки кладутся в один filter.set(\'filter\')');
  assert.match(stripped, /stype:\s*'season'/, 'под-фильтр сезона имеет stype: season');
  assert.match(stripped, /stype:\s*'voice'/, 'под-фильтр озвучки имеет stype: voice');
  assert.ok(!/filter\.set\('season'/.test(stripped), 'filter.set(\'season\') — нестандартный тип, не рендерится');
  assert.ok(!/filter\.set\('voice'/.test(stripped), 'filter.set(\'voice\') — нестандартный тип, не рендерится');
  // Индекс выбранного под-элемента мапится обратно в значение через отдельные
  // массивы (Lampa не сохраняет произвольные поля под-элементов).
  assert.match(stripped, /seasonNumbers\[subitem\.index\]/, 'сезон берётся из seasonNumbers по subitem.index');
  assert.match(stripped, /voiceIndexes\[subitem\.index\]/, 'озвучка берётся из voiceIndexes по subitem.index');
});

test('static: setFilters — E-Online-паритет: voice→season→reset, chosen(\'filter\'), maniya_reset', async () => {
  const source = await readFile(PLUGIN_PATH, 'utf8');
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  // Подпись текущего выбора на кнопке фильтра (эталон E-Online this.selected
  // → filter.chosen('filter', select): «Озвучка: …, Сезон: …»).
  assert.match(stripped, /filter\.chosen\('filter',\s*labels\)/,
    'подпись выбора уходит в chosen(\'filter\')');
  // Reset-пункт списка (эталон E-Online select.push reset) — обработчик item.reset уже есть.
  assert.match(stripped, /title:\s*Lampa\.Lang\.translate\('maniya_reset'\)[\s\S]*?reset:\s*true/,
    'reset-пункт добавлен');
  assert.match(stripped, /maniya_reset:\s*\{\s*ru:\s*'Сброс'/,
    'lang-ключ maniya_reset существует');
  // Порядок как на эталонном скриншоте: «Перевод» (voice) раньше «Сезон» (season).
  const voicePos = stripped.indexOf("stype: 'voice'");
  const seasonPos = stripped.indexOf("stype: 'season'");
  assert.ok(voicePos > 0 && seasonPos > voicePos,
    'voice объявляется раньше season в setFilters');
});

/**
 * Поведенческий sandbox полного цикла компонента: НАСТОЯЩИЙ плагин + заглушки
 * Lampa, реальный flow start() → checkSubscription → loadSources → loadVideos →
 * setFilters → draw() с фикстурой сериального payload (сезоны/озвучки/серии).
 * Аналогичен filmix-plugin-harness.mjs (прогон с реальным production-ответом),
 * но здесь — воспроизводимый юнит-тест на фикстуре.
 */
async function loadComponentSandbox(payload, opts = {}) {
  const source = await readFile(PLUGIN_PATH, 'utf8');
  const filterCalls = { set: [], chosen: [], show: [] };
  const selectCalls = { show: [], close: 0 };
  const drawn = [];
  const network = [];
  const filterInstances = [];
  // Мини-подписка по образцу Lampa.Subscribe (BALANCER-UI-001): плагин подписывается
  // на Lampa.Select.listener, чтобы знать, открыто ли его sort-меню.
  const selectListeners = {};
  const selectListener = {
    add: (t, fn) => { (selectListeners[t] = selectListeners[t] || []).push(fn); },
    remove: (t, fn) => { selectListeners[t] = (selectListeners[t] || []).filter((f) => f !== fn); },
    send: (t, e) => { (selectListeners[t] || []).slice().forEach((fn) => fn(e)); }
  };
  const langMap = {
    maniya_source: 'Источник', maniya_season: 'Сезон', maniya_voice: 'Озвучка',
    maniya_reset: 'Сброс', maniya_episode: 'Серия', title_filter: 'Фильтр',
    maniya_empty_sources: 'Нет источников', maniya_server_error: 'Ошибка сервера',
    maniya_no_results: 'Ничего не найдено'
  };
  let activity = null;

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
      shortText: (s, n) => String(s || '').slice(0, n),
      cardImgBackgroundBlur: () => ''
    },
    Lang: { add: () => {}, translate: (k) => langMap[k] || k },
    Arrays: { isArray: Array.isArray, getKeys: Object.keys, decodeJson: (s) => JSON.parse(s) },
    Template: {
      add: () => {},
      get: (name, data) => {
        if (name === 'maniya_video_item' && data) drawn.push(data);
        return fakeJq;
      }
    },
    Scroll: function () {
      this.render = () => fakeJq; this.clear = () => {}; this.reset = () => {};
      this.minus = () => {}; this.append = () => {}; this.update = () => {};
      this.body = () => fakeJq; this.destroy = () => {};
    },
    Explorer: function () {
      this.render = () => fakeJq; this.appendFiles = () => {}; this.appendHead = () => {};
      this.destroy = () => {};
    },
    Filter: function () {
      filterInstances.push(this);
      this._data = {};
      this.set = (type, items) => { this._data[type] = items; filterCalls.set.push({ type, items }); };
      this.chosen = (type, select) => filterCalls.chosen.push({ type, select });
      // Канонический Lampa filter.show (filter.js:221-224): читает data[type] и
      // открывает Select. Делегирование нужно, чтобы тест BALANCER-UI-001 видел
      // переоткрытие меню с новым массивом через Select.show.
      this.show = (title, type) => {
        filterCalls.show.push({ title, type });
        lampa.Select.show({ title, items: this._data[type] || [], onBack: null, onSelect: this.onSelect });
      };
      this.render = () => fakeJq;
      this.onSelect = null;
    },
    Reguest: function () {
      this.timeout = () => {};
      this.silent = (url, ok) => {
        network.push(String(url));
        // BALANCER-UI-001: opts.network — кастомный обработчик для тестов гонки
        // (нужно различать /sources и /sources/card, отложить card-ответ).
        if (opts.network) return opts.network(String(url), ok);
        if (url.includes('/api/lampa/sources')) return ok({ sources: [{ id: 'filmix', name: 'Filmix', icon: '🎬', quality_label: '4K', url: 'https://x/api/lampa/videos?provider=filmix', show: true }] });
        if (url.includes('/api/lampa/videos')) return ok(payload);
        return ok({});
      };
      this.clear = () => {};
    },
    Select: {
      listener: selectListener,
      show: (opts) => { selectCalls.show.push(opts); selectListener.send('fullshow', { active: opts }); },
      close: () => { selectCalls.close += 1; selectListener.send('close', { active: null }); }
    },
    Activity: { active: () => ({ activity }), push: () => {}, backward: () => {} },
    Controller: { add: () => {}, toggle: () => {}, enable: () => {}, enabled: () => ({ name: '' }), collectionSet: () => {}, collectionFocus: () => {} },
    Background: { immediately: () => {} },
    Navigator: { canmove: () => false, move: () => {} },
    TMDB: { image: () => '' },
    Player: { play: () => {}, playlist: () => {} },
    Loading: { start: () => {}, stop: () => {} },
    Noty: { show: () => {} },
    Manifest: { plugins: [] },
    Component: { add: (name, fn) => { lampa._component = fn; } },
    Listener: { follow: () => {}, remove: () => {} }
  };

  // TMDB-обогащение (FILMIX-004 follow-up): при opts.tmdbSeasons плагин получает
  // рабочий Lampa.Api.sources.tmdb — эпизоды сезона {episode_number, name}.
  // Успех-колбэк вызываем СИНХРОННО (в реальной Lampa он асинхронный — там это
  // сетевой запрос; здесь это не важно для отрисовки, т.к. draw() ждёт его).
  if (opts.tmdbSeasons) {
    lampa.Api = {
      sources: {
        tmdb: {
          get: (method, params, ok) => {
            const m = String(method).match(/\/season\/(\d+)/);
            const season = m ? m[1] : '1';
            ok({ episodes: (opts.tmdbSeasons[season] || []).slice() });
          }
        }
      }
    };
  }

  const context = {
    console, $: () => fakeJq, Lampa: lampa, Navigator: lampa.Navigator,
    document: { currentScript: null, getElementsByTagName: () => [] },
    location: { href: 'http://localhost/player.html?token=mo-t', search: '' }
  };
  context.window = context;

  vm.runInNewContext(source, context, { filename: 'maniya-online.js' });

  activity = { loader: () => {}, toggle: () => {} };
  const inst = { activity };
  // Реальное устройство шлёт source=tmdb, id=94997 (TMDB id HOTD), БЕЗ tmdb_id
  // (у TMDB-карточки movie.id и есть TMDB id). Плагин берёт movie.id → 94997.
  lampa._component.call(inst, { movie: { id: 94997, source: 'tmdb', name: 'Дом Дракона', original_name: 'House of the Dragon', first_air_date: '2022-08-21' } });
  inst.start();

  return { filterCalls, selectCalls, drawn, network, filterInstances };
}

test('поведение: сериал — фильтр voice→season→reset + chosen(\'filter\'), серии с реальными названиями, сезон уходит в /videos', async () => {
  const payload = JSON.parse(
    await readFile(new URL('./fixtures/filmix-videos-payload-serial.json', import.meta.url), 'utf8')
  );
  const { filterCalls, drawn, network, filterInstances } = await loadComponentSandbox(payload);

  const set = filterCalls.set.find((c) => c.type === 'filter');
  assert.ok(set, 'filter.set(\'filter\') вызван');
  const stypes = Array.from(set.items.map((i) => i.stype || 'reset'));
  assert.deepEqual(stypes, ['voice', 'season', 'reset'], 'порядок: voice → season → reset (эталон E-Online)');

  const voice = set.items[0];
  assert.equal(voice.title, 'Озвучка');
  assert.equal(voice.subtitle, 'Дубляж [Кравец-Рекордз]');
  assert.equal(voice.items.length, 2, '2 озвучки в под-фильтре');

  const season = set.items[1];
  assert.equal(season.title, 'Сезон');
  assert.equal(season.items.length, 3, '3 сезона в под-фильтре');
  assert.equal(season.items[2].title, '3 сезон');
  assert.equal(season.items[2].index, 2);

  const chosen = filterCalls.chosen.find((c) => c.type === 'filter');
  assert.ok(chosen, 'chosen(\'filter\') вызван — подпись на кнопке фильтра');
  assert.deepEqual(
    Array.from(chosen.select),
    ['Озвучка: Дубляж [Кравец-Рекордз]', 'Сезон: 1 сезон']
  );
  assert.ok(filterCalls.chosen.some((c) => c.type === 'sort'), 'chosen(\'sort\') вызван');

  // Серии: «номер + реальное название серии» — название Filmix дошло без потери;
  // пустой title от сервера («1 серия») тоже получил номер.
  assert.deepEqual(
    drawn.map((i) => i.title),
    ['01 Enter The House of the Dragon', '02 House Of The Dragon Premiere Special', '01 1 серия']
  );

  // Выбор «3 сезон» через канонический onSelect → в /videos уходит season=3
  // (сервер фильтрует серии по сезону — вернёт только серии 3-го).
  const before = network.filter((u) => u.includes('/api/lampa/videos')).length;
  filterInstances[0].onSelect('filter', season, season.items[2]);
  assert.ok(
    network.slice(before).some((u) => u.includes('/api/lampa/videos') && u.includes('season=3')),
    'сезон 3 ушёл в /videos после выбора'
  );
});

test('поведение: TMDB даёт русские названия серий → они перекрывают английский episode.title Filmix и фолбэк «N серия», во всех сезонах', async () => {
  const payload = JSON.parse(
    await readFile(new URL('./fixtures/filmix-videos-payload-serial.json', import.meta.url), 'utf8')
  );
  // Провайдер знает только s1e01/e02 (английские) и s3e01 (фолбэк «1 серия»).
  // TMDB (язык Lampa пользователя — русский) знает все сезоны → перекрываем.
  const tmdbSeasons = {
    '1': [
      { episode_number: 1, name: 'Наследники дракона' },
      { episode_number: 2, name: 'Строптивый принц' },
      { episode_number: 3, name: 'Второй из своего имени' }
    ],
    '3': [
      { episode_number: 1, name: 'После пляски' },
      { episode_number: 2, name: 'Свиньи и ублюдки' }
    ]
  };
  const { drawn } = await loadComponentSandbox(payload, { tmdbSeasons });

  assert.deepEqual(
    drawn.map((i) => i.title),
    ['01 Наследники дракона', '02 Строптивый принц', '01 После пляски'],
    'TMDB-имена (русские) во всех сезонах; номер серии — отдельно, имя шоу не примешивается'
  );
});

test('поведение: TMDB не знает имени серии → оставляем название провайдера/фолбэк как есть', async () => {
  const payload = JSON.parse(
    await readFile(new URL('./fixtures/filmix-videos-payload-serial.json', import.meta.url), 'utf8')
  );
  // TMDB знает только s1e01. s1e02 (английское Filmix) и s3e01 («1 серия») не тронуты.
  const tmdbSeasons = {
    '1': [{ episode_number: 1, name: 'Наследники дракона' }]
  };
  const { drawn } = await loadComponentSandbox(payload, { tmdbSeasons });

  assert.deepEqual(
    drawn.map((i) => i.title),
    ['01 Наследники дракона', '02 House Of The Dragon Premiere Special', '01 1 серия'],
    'нет имени в TMDB → английское название Filmix и фолбэк «N серия» остаются как есть'
  );
});

test('поведение: фильм без сезонов/озвучек — filter.set(\'filter\') не вызывается (movie flow не тронут)', async () => {
  const payload = {
    items: [
      { method: 'play', title: 'Дубляж [Rus]', url: 'https://cdn.example/movie.m3u8', quality: { '1080p': 'https://cdn.example/movie_1080.m3u8' }, headers: {}, subtitles: [], type: 'movie' }
    ],
    seasons: [],
    voices: []
  };
  const { filterCalls, drawn } = await loadComponentSandbox(payload);

  assert.ok(!filterCalls.set.some((c) => c.type === 'filter'),
    'для фильма нет под-фильтров сезонов/озвучек → кнопка «Фильтр» не рисуется');
  assert.ok(filterCalls.set.some((c) => c.type === 'sort'), 'источники (sort) остаются');
  assert.equal(drawn[0].title, 'Дубляж [Rus]', 'заголовок фильма не тронут (без префикса серии)');
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

test('поведение: bestQualityLabel — строковая метка (не объект) для info/title', async () => {
  const { lib } = await loadSandbox();
  // Регрессия «[object Object]»: info/title падали в item.quality (объект).
  assert.equal(lib.bestQualityLabel({ quality: { '1080p': 'u1', '4K': 'u2', '480p': 'u3' } }), '4K',
    'лучшее качество — по приоритету, строка');
  assert.equal(lib.bestQualityLabel({ quality: { '720p': 'u1' } }), '720p');
  assert.equal(lib.bestQualityLabel({ quality: '1080p' }), '1080p', 'строковое качество как есть');
  assert.equal(lib.bestQualityLabel({}), '', 'без качества — пустая строка');
  assert.equal(lib.bestQualityLabel({ quality: {} }), '', 'пустая мапа — пустая строка');
});

test('static: info/title не присваивают item.quality (объект) — регрессия «[object Object]»', async () => {
  const source = await readFile(PLUGIN_PATH, 'utf8');
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  assert.ok(!/item\.info\s*=\s*item\.voice_name\s*\|\|\s*item\.quality/.test(stripped),
    'item.info больше не падает в item.quality (объект)');
  assert.ok(!/item\.title\s*=\s*item\.voice_name\s*\|\|\s*item\.quality/.test(stripped),
    'item.title больше не падает в item.quality (объект)');
  assert.match(stripped, /bestQualityLabel\(item\)/, 'fallback — строковая метка лучшего качества');
});

// ── BALANCER-UI-001: race между /sources/card и открытым меню «Сортировать» ──
// ROOT CAUSE (диагностика #19): Lampa.Select рендерит снапшот data['sort'] один
// раз при открытии меню и НЕ перерисовывает его при filter.set('sort', ...).
// Фикс: если sort-меню открыто в момент прихода /sources/card — закрыть Select,
// filter.set('sort', новые), заново открыть меню (close → set → reopen).
// В sandbox: /sources отдаёт реестр (16), /sources/card отложен (захватываем ok),
// /videos пустой. Select.show записывает переоткрытие и шлёт 'fullshow' →
// плагин выставляет sortMenuOpen (у sort-элементов есть поле `source`).

// Реестр: те же 16 источников, что в production (meta.js), все show:true.
function fixtureRegistry16() {
  const ids = ['filmix', 'kodik', 'rezka', 'rutubemovie', 'cdnvideohub', 'collaps', 'hdvb',
    'skaz-alloha', 'skaz-videoseed', 'skaz-kinopub', 'skaz-kinoflix', 'skaz-veoveo',
    'skaz-pidtor', 'skaz-solntse', 'skaz-geosaitebi', 'skaz-rhsprem'];
  return ids.map((id) => ({ id, name: id, icon: '🎬', quality_label: '', url: 'https://x/api/lampa/videos?provider=' + id, show: true }));
}

// Карта для «Одиссеи»: 7 источников не нашли фильм → show:false, остальные 9 — true.
function fixtureCardOdyssey() {
  const falseIds = ['kodik', 'rezka', 'skaz-kinopub', 'skaz-kinoflix', 'skaz-pidtor', 'skaz-solntse', 'skaz-rhsprem'];
  const ids = fixtureRegistry16().map((s) => s.id);
  return ids.map((id) => ({ id, show: !falseIds.includes(id) }));
}

// Открывает меню «Сортировать» так, как это делает Lampa: filter.show → Select.show
// с items из data['sort']; Select.show шлёт 'fullshow' {active} → плагин ставит sortMenuOpen.
function openSortMenu(filterInstance) {
  filterInstance.show('Фильтр', 'sort');
}

test('BALANCER-UI-001: card приходит при открытом «Сортировать» — меню переоткрывается с 9', async () => {
  let cardOk = null;
  const { filterCalls, selectCalls, filterInstances } = await loadComponentSandbox(
    { items: [], seasons: [], voices: [] },
    {
      network: (url, ok) => {
        if (url.includes('/api/lampa/sources/card')) return void (cardOk = ok);
        if (url.includes('/api/lampa/sources')) return ok({ sources: fixtureRegistry16() });
        return ok({});
      }
    }
  );

  const sortSets = () => filterCalls.set.filter((c) => c.type === 'sort');
  assert.equal(sortSets().at(-1).items.length, 16, 'до карты: sort = 16 (реестр)');

  // Юзер открывает меню до прихода карты → Select.show(16) → sortMenuOpen=true
  openSortMenu(filterInstances[0]);
  assert.equal(selectCalls.show.length, 1, 'меню открыто один раз');
  assert.equal(selectCalls.show[0].items.length, 16, 'открыто с реестром (16)');

  // /sources/card приходит: 7 из 16 show:false → filterSources пересобирается в 9
  cardOk({ sources: fixtureCardOdyssey() });
  assert.equal(sortSets().at(-1).items.length, 9, 'filter.set(sort) → 9 после карты');

  assert.ok(selectCalls.close >= 1, 'открытый Select закрыт перед переоткрытием');
  assert.equal(selectCalls.show.length, 2, 'меню переоткрыто');
  assert.equal(selectCalls.show[1].items.length, 9, 'переоткрыто с 9 — старые 7 ушли');
  assert.deepEqual(selectCalls.show[1].items.map((i) => i.source),
    ['filmix', 'rutubemovie', 'cdnvideohub', 'collaps', 'hdvb', 'skaz-alloha', 'skaz-videoseed', 'skaz-veoveo', 'skaz-geosaitebi'],
    'в переоткрытом меню — только актуальные источники (нет kodik/rezka/kinopub/kinoflix/pidtor/solntse/rhsprem)');
});

test('BALANCER-UI-001: card пришла ДО открытия меню — открывается сразу с 9, без переоткрытий', async () => {
  let cardOk = null;
  const { filterCalls, selectCalls, filterInstances } = await loadComponentSandbox(
    { items: [], seasons: [], voices: [] },
    {
      network: (url, ok) => {
        if (url.includes('/api/lampa/sources/card')) return void (cardOk = ok);
        if (url.includes('/api/lampa/sources')) return ok({ sources: fixtureRegistry16() });
        return ok({});
      }
    }
  );

  // Карта приходит ДО того, как юзер открыл меню
  cardOk({ sources: fixtureCardOdyssey() });
  assert.equal(filterCalls.set.filter((c) => c.type === 'sort').at(-1).items.length, 9,
    'data.sort уже 9 к моменту открытия');
  assert.equal(selectCalls.show.length, 0, 'меню не открывалось и не переоткрывалось');

  // Теперь юзер открывает меню → сразу отфильтрованный список
  openSortMenu(filterInstances[0]);
  assert.equal(selectCalls.show.length, 1, 'открыто один раз');
  assert.equal(selectCalls.show[0].items.length, 9, 'сразу 9 актуальных источников');
});

test('BALANCER-UI-001: меню открыто, карта НЕ меняет флаги (cached, все как в реестре) — без переоткрытия', async () => {
  let cardOk = null;
  const { selectCalls, filterInstances } = await loadComponentSandbox(
    { items: [], seasons: [], voices: [] },
    {
      network: (url, ok) => {
        if (url.includes('/api/lampa/sources/card')) return void (cardOk = ok);
        if (url.includes('/api/lampa/sources')) return ok({ sources: fixtureRegistry16() });
        return ok({});
      }
    }
  );

  openSortMenu(filterInstances[0]);
  assert.equal(selectCalls.show.length, 1, 'меню открыто');

  // Карта повторяет реестр (все show:true) → changed=false, activeChanged=false
  cardOk({ sources: fixtureRegistry16().map((s) => ({ id: s.id, show: true })) });
  assert.equal(selectCalls.close, 0, 'Select не закрывался — флаги не менялись, переоткрытие не нужно');
  assert.equal(selectCalls.show.length, 1, 'меню не переоткрывалось (нет race, меню уже актуально)');
});