(function () {
  'use strict';

  var MANIYA_API_BASE = 'http://95.85.241.121/api/lampa';
  var COMPONENT = 'maniya_online_staging';
  var PLUGIN_FLAG = 'maniya_online_staging_plugin_started';

  // BALANCER-UI-001: флаг «открыто именно наше sort-меню (список источников)».
  // Lampa.Select.listener — единственный не-DOM способ узнать, какой селект открыт:
  // у sort-элементов есть поле `source`, у quality-селектора и season/voice — нет.
  var sortMenuOpen = false;
  var selectWatchBound = false;
  function bindSelectWatch() {
    if (selectWatchBound || !Lampa.Select.listener) return;
    selectWatchBound = true;
    Lampa.Select.listener.add('fullshow', function (e) {
      var items = e && e.active && e.active.items;
      sortMenuOpen = !!(items && Lampa.Arrays.isArray(items) && items.length && items[0] && items[0].source);
    });
    Lampa.Select.listener.add('hide', function () { sortMenuOpen = false; });
    Lampa.Select.listener.add('close', function () { sortMenuOpen = false; });
  }

  if (window[PLUGIN_FLAG]) return;
  window[PLUGIN_FLAG] = true;

  // MANIYA-STAGING (TASK-032 Phase 17): id сборки тестового плагина.
  // Сверка в Web Lampa: window.MANIYA_STAGING_BUILD === server /version.build.
  window.MANIYA_STAGING_BUILD = 'a23b9b0c';

  function trimSlash(value) {
    return (value || '').replace(/\/+$/, '');
  }

  /** Origin (scheme://host[:port]) API-базы — для резолва origin-relative url. */
  function apiOrigin(base) {
    var m = String(base || '').match(/^https?:\/\/[^/]+/i);
    return m ? m[0] : '';
  }

  /**
   * Перевести api_url источника в АБСОЛЮТНЫЙ play-URL (SKAZ-MANIYA-039 §6 + FIX):
   * сервер отдаёт api_url ОТ КОРНЯ — '/api/lampa/videos?provider=…', префикс
   * /api/lampa уже в пути. Клеим к ORIGIN хоста, а НЕ к MANIYA_API_BASE —
   * иначе двойной путь '…/api/lampa/api/lampa/videos?…' → 404 → после кард-модели
   * loadVideos падал в error → «Видео не найдено» и старый рендер поверх z01-ui.
   * Относительный url (+'/videos') сохраняется через trimSlash(MANIYA_API_BASE).
   */
  function resolveVideosUrl(u) {
    if (!u) return '';
    if (/^(https?:)?\/\//i.test(u)) return u;
    if (u.charAt(0) === '/') return apiOrigin(MANIYA_API_BASE) + u;
    return trimSlash(MANIYA_API_BASE) + '/' + u;
  }

  function readParamFromUrl(url, name) {
    if (!url) return '';
    var escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var match = (url + '').match(new RegExp('[?&#]' + escaped + '=([^&#]+)'));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function getScriptUrlToken(name) {
    var scripts = document.getElementsByTagName('script');
    var current = document.currentScript && document.currentScript.src ? document.currentScript.src : '';
    var candidates = [];

    if (current) candidates.push(current);

    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i] && scripts[i].src ? scripts[i].src : '';
      if (src && candidates.indexOf(src) === -1) candidates.push(src);
    }

    for (var j = 0; j < candidates.length; j++) {
      var url = candidates[j];
      if (url.indexOf('maniya-online.js') !== -1 || url.indexOf('maniya') !== -1) {
        var token = readParamFromUrl(url, name);
        if (token) return token;
      }
    }

    for (var k = 0; k < candidates.length; k++) {
      var fallback = readParamFromUrl(candidates[k], name);
      if (fallback) return fallback;
    }

    return '';
  }

  function readStoredToken() {
    var token = Lampa.Storage.get('maniya_token_staging', '') || Lampa.Storage.get('lampac_token', '') || '';

    if (!token) {
      try {
        token = window.localStorage ? (localStorage.getItem('maniya_token_staging') || localStorage.getItem('lampac_token') || '') : '';
      } catch (e) {}
    }

    return token;
  }

  function persistToken(token) {
    token = (token || '').trim();
    if (!token) return '';

    Lampa.Storage.set('maniya_token_staging', token);

    try {
      if (window.localStorage) localStorage.setItem('maniya_token_staging', token);
    } catch (e) {}

    return token;
  }

  function getTokenFromRuntime() {
    if (window.MANIYA_ONLINE_TOKEN_STAGING) return window.MANIYA_ONLINE_TOKEN_STAGING;
    return '';
  }

  function getQueryParam(name) {
    return readParamFromUrl(location.href, name) || getScriptUrlToken(name);
  }

  function ensureUid() {
    var uid = Lampa.Storage.get('maniya_unic_id_staging', '');
    if (!uid) {
      uid = Lampa.Utils.uid(8).toLowerCase();
      Lampa.Storage.set('maniya_unic_id_staging', uid);
    }
    return uid;
  }

  function ensureToken() {
    return persistToken(getQueryParam('token') || getTokenFromRuntime() || readStoredToken());
  }

  function addAccountParams(url) {
    url = url + '';

    var email = Lampa.Storage.get('account_email', '');
    var uid = ensureUid();
    var token = ensureToken();

    if (email && url.indexOf('account_email=') === -1) {
      url = Lampa.Utils.addUrlComponent(url, 'account_email=' + encodeURIComponent(email));
    }

    if (uid && url.indexOf('uid=') === -1) {
      url = Lampa.Utils.addUrlComponent(url, 'uid=' + encodeURIComponent(uid));
    }

    if (token && url.indexOf('token=') === -1) {
      url = Lampa.Utils.addUrlComponent(url, 'token=' + encodeURIComponent(token));
    }

    if (email && url.indexOf('cub_id=') === -1) {
      url = Lampa.Utils.addUrlComponent(url, 'cub_id=' + encodeURIComponent(Lampa.Utils.hash(email)));
    }

    return url;
  }

  function addMovieParams(url, movie, object) {
    var query = [];
    var title = object && object.clarification ? object.search : movie.title || movie.name || '';
    var original = movie.original_title || movie.original_name || '';
    var date = movie.release_date || movie.first_air_date || '0000';

    query.push('id=' + encodeURIComponent(movie.id || ''));
    query.push('title=' + encodeURIComponent(title));
    query.push('original_title=' + encodeURIComponent(original));
    query.push('serial=' + (movie.name ? 1 : 0));
    query.push('year=' + encodeURIComponent((date + '').slice(0, 4)));
    query.push('original_language=' + encodeURIComponent(movie.original_language || ''));
    query.push('source=' + encodeURIComponent(movie.source || 'tmdb'));
    query.push('clarification=' + (object && object.clarification ? 1 : 0));
    query.push('similar=' + (object && object.similar ? true : false));

    if (movie.imdb_id) query.push('imdb_id=' + encodeURIComponent(movie.imdb_id));
    if (movie.kinopoisk_id) query.push('kinopoisk_id=' + encodeURIComponent(movie.kinopoisk_id));
    if (movie.tmdb_id) query.push('tmdb_id=' + encodeURIComponent(movie.tmdb_id));

    return url + (url.indexOf('?') >= 0 ? '&' : '?') + query.join('&');
  }

  function requestJson(network, url, success, error) {
    var token = ensureToken();
    var headers = token ? { Authorization: 'Bearer ' + token } : {};

    network.timeout(15000);
    network.silent(addAccountParams(url), function (json) {
      if (typeof json === 'string') json = Lampa.Arrays.decodeJson(json, {});
      success(json || {});
    }, function (response) {
      error(response || {});
    }, false, {
      dataType: 'json',
      headers: headers
    });
  }

  function normalizeSources(response) {
    if (Lampa.Arrays.isArray(response)) return response;
    return response.sources || response.online || [];
  }

  function normalizeItems(response) {
    if (Lampa.Arrays.isArray(response)) return response;
    return response.items || response.videos || [];
  }

  function sourceKey(source) {
    return (source.id || source.balanser || source.name || 'main').toLowerCase();
  }

  /**
   * ЕДИНАЯ отображаемая подпись источника: «4K 🎞 KinoPUB» (качество → иконка →
   * имя) — порядок, как у эталона SKAZ (чипы «4K 🌐 Lime»). icon/quality_label
   * приходят из мета-реестра сервера (meta.js) отдельными полями — эмодзи НЕ
   * вшивается в id/название провайдера, здесь только визуальная склейка.
   * Неизвестный источник → fallback-иконка 🎬. Чистый отображение-слой:
   * сортировка источников (filterSources) от этой подписи не зависит.
   */
  function sourceLabel(source, fallbackName) {
    var name = (source && source.name) || fallbackName || '';
    var icon = (source && source.icon) || '🎬';
    var quality = (source && source.quality_label) || '';
    var label = quality ? quality + ' ' + icon + ' ' + name : icon + ' ' + name;
    return label;
  }

  // ── SKAZ-like UI (T040): modern-отображение источников как в SKAZ-клиенте ──
  // Эталон: onlines.js Z01UI (`z01_ui_mode` modern) — собственная CSS-тема
  // (.z01-hero / .z01-toolbar / .z01-chip / .z01-card), hero-карточка сверху,
  // компактный селектор «ИСТОЧНИК [4K 🌐 Lime ▼]» с раскрытием в pill-чипы
  // (бейдж качества + иконка + имя + зелёная точка) и «Ещё N». Порт рисует ТЕ
  // ЖЕ классы и раскладку нашим серверным контрактом (name/icon/quality_label).
  // Браузерный гейт: рендер строится только там, где есть настоящий DOM
  // (document.createElement). В vm-песочнице тестов (заглушки без DOM) активен
  // старый нативный путь — контракт-тесты не зависят от отображения.
  var Z01_UI_OK = (typeof window !== 'undefined') && (typeof document !== 'undefined') &&
    (typeof document.createElement === 'function') && (typeof $ === 'function');
  var ui = { root: null, heroBox: null, rows: null, list: null, hero: null, open: '' };
  var uiAllSources = false;

  /** Короткая метка качества как у SKAZ: 2160/4K→«4K», 1080/FHD→«FHD», 720/HD→«HD», прочее→SD/пусто. */
  function shortQuality(text) {
    if (!text) return '';
    text = String(text);
    var match = text.match(/(2160|1440|1080|720|576|480|360)\s*p?/i);
    if (match) {
      var value = parseInt(match[1], 10);
      if (value >= 2160) return '4K';
      if (value >= 1080) return 'FHD';
      if (value >= 720) return 'HD';
      return 'SD';
    }
    if (/4k|uhd/i.test(text)) return '4K';
    if (/fhd/i.test(text)) return 'FHD';
    if (/\bhd\b/i.test(text)) return 'HD';
    return '';
  }

  /** Части чипа источника: {badge, label} = бейдж качества + «иконка имя». */
  function sourceChipParts(source, fallbackName) {
    var name = (source && source.name) || fallbackName || '';
    var icon = (source && source.icon) || '🎬';
    var quality = (source && source.quality_label) || '';
    return {
      badge: shortQuality(quality || name),
      label: icon + ' ' + name,
      name: name,
      icon: icon
    };
  }

  // ── SKAZ-MANIYA-059 E1/E2 helpers ──
  // Kill-switch'и «живого источника на карточке»: maniya_live_probe (E1) и
  // maniya_auto_switch (E2) — false в Lampa.Storage → старое поведение целиком
  // (бандл откатывать не нужно). Default on, как skaz_auto_switch у SKAZ.
  function liveProbeEnabled() {
    try { return String(Lampa.Storage.get('maniya_live_probe', true)) !== 'false'; }
    catch (e) { return true; }
  }
  function liveAutoSwitchEnabled() {
    try { return String(Lampa.Storage.get('maniya_auto_switch', true)) !== 'false'; }
    catch (e) { return true; }
  }
  /** Ранг качества источника для авто-выбора (4K>FHD>HD>SD>—) — из тех же данных, что бейдж чипа. */
  function liveQualityRank(source) {
    var rank = { '4K': 4, 'FHD': 3, 'HD': 2, 'SD': 1 };
    return rank[shortQuality(source && source.quality_label)] || 0;
  }
  /** Активен ли плеер — тики E1 встают на паузу, чтобы не мешать воспроизведению (§5). */
  function playerBusy() {
    try {
      if (Lampa.Activity && Lampa.Activity.active &&
        String(Lampa.Activity.active().activity) === 'player') return true;
    } catch (e) {}
    try {
      if (Lampa.Player && typeof Lampa.Player.isActive === 'function' && Lampa.Player.isActive()) return true;
    } catch (e) {}
    return false;
  }

  // SKAZ-MANIYA-058 (W3, D9): классификатор озвучки по kind — порт ShezUI.VOICE_KINDS +
  // VOICE_STUDIOS (onlines.js 452-499). Используется для сортировки ряда «Озвучка»
  // (Дубляж → Многоголосый → Двухголосый → Авторский → Оригинал → Субтитры → прочее)
  // и для памяти предпочтения голоса (skaz_voice_pref → maniya_voice_pref).
  var VOICE_KINDS = [
    { key: 'dub', rank: 0, re: /дубляж|дублирован|\bdub\b|\bdubbing\b/i },
    { key: 'mvo', rank: 1, re: /многоголос|\bmvo\b|\bpmvo\b/i },
    { key: 'dvo', rank: 2, re: /двухголос|\bdvo\b/i },
    { key: 'avo', rank: 3, re: /авторск|одноголос|\bavo\b|\bvo\b/i },
    { key: 'orig', rank: 4, re: /оригинал|original|\beng\b|\bua\b|\bukr\b/i },
    { key: 'sub', rank: 5, re: /субтитр|sub(title)?s?\b/i }
  ];
  var VOICE_STUDIOS = [
    { key: 'mvo', re: /lostfilm|лостфильм|tvshows|dniprofilm|невафильм|newstudio|newcomers|baibako|байбако|alexfilm|jaskier|coldfilm|колдфильм|hdrezka|rezkastudio|red head sound|sunshine|amedia|zakadry|закадры|linefilm|le-production|1win|kerob|profix|selena|октопус/i },
    { key: 'dvo', re: /кубик в кубе|kubik|viruseproject|вирус|green ?tea|paradox/i },
    { key: 'avo', re: /яроцк|гаврилов|володарск|сербин|горчаков|михал[её]в|живов|пучков|гоблин|кураж|дольск|есарев|карповск|визгунов/i }
  ];
  function voiceKind(title) {
    var text = String(title || '');
    for (var i = 0; i < VOICE_KINDS.length; i++) {
      if (VOICE_KINDS[i].re.test(text)) return VOICE_KINDS[i].key;
    }
    for (var j = 0; j < VOICE_STUDIOS.length; j++) {
      if (VOICE_STUDIOS[j].re.test(text)) return VOICE_STUDIOS[j].key;
    }
    return 'other';
  }
  function voiceKindRank(key) {
    for (var i = 0; i < VOICE_KINDS.length; i++) {
      if (VOICE_KINDS[i].key === key) return VOICE_KINDS[i].rank;
    }
    return 90;
  }

  function escapeHtml(value) {
    return (value === undefined || value === null ? '' : String(value))
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Строка-стрелка «▼» в стиле SKAZ (chevron). */
  function chevronSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>';
  }

  // --- Постер/изображение результата (#5) ---
  // RAW Alloha (movie-страница и video-JSON) НЕ содержит poster/image/thumbnail —
  // эталон E-Online/Online.plugin.js тоже не берёт его у провайдера, а рисует
  // на клиенте из карточки фильма: Lampa.TMDB.image('t/p/w300' + backdrop_path)
  // (Online/plugin.js Lampac, строка 1234, onerror→img_broken / onload→loaded).
  // Hardcoded `https://image.tmdb.org/...` НЕ работает у пользователя: Lampa
  // использует НАСТРОЕННЫЙ image-CDN (свой домен/миeрт к TMDB), и прямой
  // image.tmdb.org в его сети блокируется → чёрный прямоугольник / иконка «?».
  // Резолвим через Lampa.TMDB.image, как работающая реализация E-Online.
  function moviePoster(movie) {
    var path = movie && (movie.backdrop_path || movie.poster_path);
    if (!path) return '';
    try {
      if (Lampa.TMDB && typeof Lampa.TMDB.image === 'function') {
        return Lampa.TMDB.image('t/p/w300' + String(path));
      }
    } catch (e) {}
    return '';
  }

  // SKAZ-MANIYA-047: timeline/time для карточек и hero — ровно эталон SKAZ/Lampac
  // (onlines.js 2510-2517): hash_timeline = hash(сериал: [season, ':', episode,
  // original_title] / фильм: original_title) → Lampa.Timeline.view(hash) читает
  // сохранённый прогресс из хранилища Lampa (при просмотре core сам обновляет его
  // через play.timeline). «Продолжить просмотр» + полоска + время — из этого поля.
  // time = runtime TMDB (минуты) → «1ч 23м». Только в real-DOM режиме (Z01).
  // ВАЖНО: `movie` передаётся аргументом — глобальный `object` в Lampa это
  // замыкание КОМПОНЕНТА плагина, из модульной функции (вне его скоупа) он не
  // виден (ReferenceError: object is not defined на девайсе).
  function applyTimelineModel(item, movie) {
    if (!Z01_UI_OK || !item || !movie) return;
    try {
      // Ключ-материал хэша = как у эталона: сериал → original_name, фильм →
      // original_title (Lampac DLNA plugin.js:328). У сериальной карточки Lampa
      // нет original_title (есть original_name) — без фолбэка timeline для
      // сериалов не строился вовсе → «Продолжить просмотр»/полоска/время пустые.
      var key = movie.original_title || movie.original_name || movie.name || movie.title || '';
      if (!key) return;
      if (item.time === undefined || !item.time) {
        var runtime = (item.runtime || movie.runtime || 0) * 1;
        item.time = runtime ? Lampa.Utils.secondsToTime(runtime * 60, true) : '';
      }
      if (item.timeline || typeof Lampa.Timeline !== 'object' ||
          typeof Lampa.Timeline.view !== 'function' || typeof Lampa.Utils.hash !== 'function') return;
      var hash_timeline = Lampa.Utils.hash(item.season
        ? [item.season, item.season > 10 ? ':' : '', item.episode, key].join('')
        : key);
      item.hash_timeline = hash_timeline;
      item.timeline = Lampa.Timeline.view(hash_timeline);
    } catch (e) {}
  }

  // --- Селектор качества (#10) ---

  function qualityPriority(label) {
    var s = String(label || '').toLowerCase();
    if (s.indexOf('4k') !== -1 || s.indexOf('2160') !== -1) return 6;
    if (s.indexOf('1080') !== -1 || s.indexOf('full hd') !== -1 || s.indexOf('fullhd') !== -1) return 5;
    if (s.indexOf('720') !== -1 || s === 'hd') return 4;
    if (s.indexOf('480') !== -1 || s === 'sd') return 3;
    return 2;
  }

  /** Варианты качества из item: мапа {label: url} → [{label, url}], строка-метка → один. */
  function qualityEntries(item) {
    var q = item && item.quality;
    if (!q) return [];
    if (typeof q === 'string') return q ? [{ label: String(q), url: '' }] : [];
    var entries = [];
    for (var label in q) {
      if (q[label] && typeof q[label] === 'string') entries.push({ label: label, url: q[label] });
    }
    return entries;
  }

  /** Бейджи качеств для строки списка (сортировка: 4K → 1080 → HD → SD). */
  function qualityChips(item) {
    return qualityEntries(item).sort(function (a, b) {
      return qualityPriority(b.label) - qualityPriority(a.label);
    }).map(function (e) {
      return '<span class="maniya-online-item__quality">' + e.label + '</span>';
    }).join('');
  }

  /** Строковая метка лучшего качества (для info/title, где объект качества даёт «[object Object]»). */
  function bestQualityLabel(item) {
    var entries = qualityEntries(item);
    if (!entries.length) return '';
    entries.sort(function (a, b) {
      return qualityPriority(b.label) - qualityPriority(a.label);
    });
    return entries[0].label;
  }

  /**
   * Открыть выбор качества. Канонический API рабочего E-Online/Lampac-plигина —
   * Lampa.Select.show({ title, items, onSelect, onBack }) с ГЛОБАЛЬНЫМ
   * onSelect(entry) и onBack → Lampa.Controller.toggle(enabled) (online.plugin.js,
   * строки 1477/1504). Lampa.Select.open в реальной Lampa НЕ СУЩЕСТВУЕТ —
   * «Script error.: Lampa.Select.open is not a function». Параметр `select`
   * только для тестов (mock БЕЗ .open — регрессия упадёт тем же TypeError).
   */
  function openQualitySelect(item, entries, run, select) {
    var api = select && typeof select.show === 'function' ? select : Lampa.Select;
    var enabled = Lampa.Controller.enabled().name;
    api.show({
      title: item.title || Lampa.Lang.translate('maniya_quality'),
      items: entries.slice().sort(function (a, b) {
        return qualityPriority(b.label) - qualityPriority(a.label);
      }).map(function (entry) {
        return {
          title: Lampa.Lang.translate('maniya_watch_quality') + ' ' + entry.label,
          label: entry.label,
          url: entry.url
        };
      }),
      onSelect: function (chosen) {
        if (api.close) api.close();
        Lampa.Controller.toggle(enabled);
        run(item, {
          url: chosen && chosen.url,
          quality: item.quality,
          subtitles: item.subtitles
        });
      },
      onBack: function () {
        Lampa.Controller.toggle(enabled);
      }
    });
  }

  // ── E-Online: orUrlReserve + setDefaultQuality (Online/plugin.js, строки 631-648) ──
  // Играем ДЕФОЛТНОЕ качество (настройка Lampa video_quality_default); полная карта
  // quality уходит в плеер — выбор 1080p/720p/480p/360p делает НАТИВНЫЙ плеер,
  // как в рабочем E-Online. Отдельного предплеерного селектора НЕТ.
  function orUrlReserve(data) {
    if (data && data.url && typeof data.url === 'string' && data.url.indexOf(' or ') !== -1) {
      var urls = data.url.split(' or ');
      data.url = urls[0].trim();
      data.url_reserve = urls[1].trim();
    }
  }

  // SKAZ-MANIYA-045 (запрос юзера «сначала прямой доступ — если не доступно,
  // тогда через прокси»): когда play.url указывает ПРЯМО на CDN (direct-режим
  // T037), url_reserve делаем НАШИМ /api/lampa/proxy той же ссылки. Нативный
  // плеер Lampa при ошибке первичной ссылки (403/CORS/обрыв — это видно только
  // клиенту) сам переключается на url_reserve — та же механика, что « or » у
  // E-Online. Прямой CDN = абсолютный http(s), но НЕ наш сервер (см.ниже).
  function isDirectCdnUrl(value) {
    var s = String(value || '');
    if (!/^https?:\/\//i.test(s)) return false;
    if (s.indexOf('/api/lampa/proxy') !== -1) return false;
    if (s.indexOf('/api/lampa/video') !== -1 || s.indexOf('/api/lampa/videos') !== -1) return false;
    var ours = apiOrigin(MANIYA_API_BASE);
    if (ours && s.indexOf(ours) === 0) return false;
    return true;
  }

  /** /api/lampa/proxy?url=<прямой CDN>&token=…&origin/ref=… — резерв для play. */
  function proxyUrlFor(play) {
    var base = trimSlash(MANIYA_API_BASE) + '/proxy?url=' + encodeURIComponent(play.url);
    var token = ensureToken();
    if (token) base += '&token=' + encodeURIComponent(token);
    var headers = play.headers || {};
    var origin = headers.origin || '';
    var referer = headers.Referer || headers.referer || '';
    if (origin) base += '&origin=' + encodeURIComponent(origin);
    if (referer) base += '&ref=' + encodeURIComponent(referer);
    return base;
  }

  function setDefaultQuality(data) {
    var map = data && data.quality;
    if (!map || typeof map !== 'object') return;
    try {
      var keys = Lampa.Arrays.getKeys(map);
      var i;
      var q;
      for (i = 0; i < keys.length; i++) {
        q = keys[i];
        var value = map[q];
        if (String(value) !== value) continue;
        if (parseInt(q, 10) === parseInt(Lampa.Storage.field('video_quality_default'), 10)) {
          data.url = value;
          orUrlReserve(data);
        }
        if (value.indexOf(' or ') !== -1) map[q] = value.split(' or ')[0].trim();
      }
    } catch (e) {}
  }

  function component(object) {
    var network = new Lampa.Reguest();
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var files = new Lampa.Explorer(object);
    var filter = new Lampa.Filter(object);
    bindSelectWatch();
    var sources = {};
    var filterSources = [];
    var activeSource = '';
    var activeUrl = '';
    var initialized = false;
    var last;
    var activeSeason = null;
    var activeVoice = null;
    var seasonNumbers = [];
    var voiceIndexes = [];
    // SKAZ-MANIYA-058: опции сезонов/озвучек ДЛЯ Z01-тулбара (чипы «Сезон»/«Озвучка»).
    // Данные те же, что у етalonа filter_find (onlines.js parse): array {title, url/мета}.
    // Сезоны: number+title; озвучки: name+index. Чипы рисуются только при >1 опции.
    // Чисто клиентский рендер — сервер уже понимает season=/voice= (store.js+SkazProvider).
    var uiSeasons = [];
    var uiVoices = [];
    // W3 (D7): число серий текущего сезона (для чипа «Переход»; >20 → рисуем).
    var uiItemsCount = 0;
    var seasonEpisodesCache = {};
    // SKAZ-MANIYA-052: тонкий путь уже пробовали на этой карточке → после
    // фолбэка навсегда legacy /videos+/proxy (гейт не зацикливается).
    var thinExhausted = false;
    // SKAZ-MANIYA-041: процесс балансировки — пока кард-модель (/sources/card)
    // считается, показываем hero + панель «Опрашиваем источники» (SKAZ
    // uiLoadingPanel), БЕЗ тулбара «ИСТОЧНИК» и без статического списка.
    var uiPolling = false;
    var uiPollTimer = null;
    var uiPollStart = 0;
    var uiPollFound = -1; // -1 = балансер ещё не ответил; n = найдено источников (SKAZ ui_load_found)
    var uiPollPct = 0;    // % от ответа балансера (SKAZ ui_load_percent)
    var uiPollBar = null; // jQuery .z01-loading__bar>div
    var uiPollText = null; // jQuery .z01-loading__text
    // SKAZ-MANIYA-044: источники, живая проба которых (/videos) на ЭТОЙ карточке
    // уже вернула 0 видео. Сбрасываются при новом фильме (loadCardAvailability).
    var uiDeadSources = {};
    // SKAZ-MANIYA-059 E1/E2: «живой источник на карточке» (аналог SKAZ
    // probeBackground + doesNotAnswer). Всё client-only под Z01_UI_OK, откат —
    // kill-switch Storage maniya_live_probe / maniya_auto_switch (helpers выше).
    var cardReady = false;           // после первого успешного draw — тики только тогда
    var liveProbeTimer = null;       // один глобальный interval (STABILITY-004: чистка в destroy)
    var liveProbeBusy = false;       // тик не заходит в себя
    var liveTickSeq = 0;             // обесценивает вердикты устаревшего тика
    var liveProbeCache = {};         // key -> {v:'ok'|'empty'|'unverified', t:ms}; сметается на карточку
    var autoSwitchCount = 0;         // анти-thrash: ≤ LIVE_SWITCH_LIMIT авто-свитчей на карточку
    var autoSwitchTimer = null;      // E2 таймер обратного отсчёта (1с тик)
    var autoSwitchNote = null;       // jQuery .z01-note__switch — живая строка отсчёта
    var LIVE_PROBE_TICK_MS = 25000;      // период тика E1
    var LIVE_PROBE_TIMEOUT = 8000;       // live Range-проба на URL (как probeSources)
    var LIVE_PROBE_PARALLEL = 2;         // параллель пробы (как SKAZ PROBE_PARALLEL)
    var LIVE_PROBE_TARGET_LIMIT = 6;     // макс целей за тик
    var LIVE_PROBE_BUDGET = 25000;       // бюджет тика (дедлайн, а не «висим»)
    var LIVE_PROBE_OK_TTL = 6 * 60 * 60 * 1000;   // ok не перепроверяем 6ч (не трогаем часто)
    var LIVE_PROBE_EMPTY_TTL = 30 * 1000;         // empty перепроверяем каждые 30с (ловить оживание)
    var LIVE_SWITCH_SECONDS = 6;         // как SKAZ doesNotAnswer
    var LIVE_SWITCH_LIMIT = 2;           // анти-thrash: макс 2 авто-свитча на карточку
    // SKAZ WATCHDOG (onlines.js uiLoadTimer + watchdog): если балансер не ответил
    // за дедлайн — прекращаем «Опрашиваем источники» и показываем статический
    // реестр (фолбэк), чтобы экран не висел на skeleton вечно.
    var uiPollDeadline = function () {
      setTimeout(function () {
        if (!uiPolling) return;
        uiPollStop();
        if (Z01_UI_OK) self.loadVideos();
      }, 15000);
    };
    var uiPollStop = function () {
      if (uiPollTimer !== null) { clearInterval(uiPollTimer); uiPollTimer = null; }
      uiPolling = false;
      uiPollBar = null;
      uiPollText = null;
    };

    this.create = function () {
      return this.render();
    };

    this.render = function () {
      return files.render();
    };

    this.loading = function (status) {
      this.activity.loader(status);
      if (!status) this.activity.toggle();
    };

    this.start = function () {
      if (Lampa.Activity.active().activity !== this.activity) return;

      if (!initialized) {
        initialized = true;
        this.initialize();
      }

      Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
      Lampa.Controller.add('content', {
        toggle: function () {
          Lampa.Controller.collectionSet(scroll.render(), files.render());
          Lampa.Controller.collectionFocus(last || false, scroll.render());
        },
        up: function () {
          if (Navigator.canmove('up')) Navigator.move('up');
          else Lampa.Controller.toggle('head');
        },
        down: function () { Navigator.move('down'); },
        right: function () {
          if (Navigator.canmove('right')) Navigator.move('right');
          else filter.show(Lampa.Lang.translate('title_filter'), 'sort');
        },
        left: function () {
          if (Navigator.canmove('left')) Navigator.move('left');
          else Lampa.Controller.toggle('menu');
        },
        back: this.back.bind(this)
      });
      Lampa.Controller.toggle('content');
    };

    this.initialize = function () {
      var self = this;
      this.loading(true);
      files.appendFiles(scroll.render());
      files.appendHead(filter.render());
      scroll.minus(files.render().find('.explorer__files-head'));
      // SKAZ-MANIYA-042 (onlines.latest.js:3003-3006): в modern-режиме SKAZ прячет
      // нативную шапку фильтров Lampa (skaz-hidden-head + display:none) — селектор
      // источников рендерит свой z01-тулбар. У нас тот же гейт Z01_UI_OK: иначе на
      // экране вверху остаётся панель «Источник» с лупой поиска, которой в SKAZ нет.
      if (Z01_UI_OK && files && files.render) {
        try {
          files.render().find('.explorer__files-head').addClass('z01-hidden-head').css('display', 'none');
        } catch (e) {}
      }
      scroll.body().append(Lampa.Template.get('maniya_content_loading'));

      filter.render().find('.filter--sort span').text(Lampa.Lang.translate('maniya_source'));
      filter.onSelect = function (type, item, subitem) {
        if (type === 'sort') {
          Lampa.Select.close();
          self.changeSource(item.source);
        } else if (type === 'filter') {
          // Канонический Lampa-Filter `filter` (как E-Online Online/plugin.js):
          // season/voice — под-фильтры с `stype`, индекс выбранного под-элемента
          // (subitem.index) мапится обратно в season/voice через seasonNumbers/
          // voiceIndexes (Lampa не гарантирует сохранение произвольных полей).
          Lampa.Select.close();
          if (item.reset) {
            activeSeason = null;
            activeVoice = null;
            self.loadVideos();
          } else if (item.stype === 'season') {
            activeSeason = seasonNumbers[subitem.index];
            self.loadVideos();
          } else if (item.stype === 'voice') {
            activeVoice = voiceIndexes[subitem.index];
            self.loadVideos();
          }
        }
      };

      this.checkSubscription(function () {
        self.loadSources();
      });
    };

    this.checkSubscription = function (next) {
      var self = this;
      var url = trimSlash(MANIYA_API_BASE) + '/subscription/check';
      requestJson(network, url, function (json) {
        if (json.active === false) return self.subscriptionRequired(json.message);
        next();
      }, function () {
        self.subscriptionRequired(Lampa.Lang.translate('maniya_subscription_error'));
      });
    };

    this.loadSources = function () {
      var self = this;
      var url = addMovieParams(trimSlash(MANIYA_API_BASE) + '/sources', object.movie, object);
      requestJson(network, url, function (json) {
        if (json.error === 'subscription_required') return self.subscriptionRequired(json.message);

        normalizeSources(json).forEach(function (item) {
          var key = sourceKey(item);
          // Мета (icon/quality_label) приходит КАК ЕСТЬ из единого реестра
          // сервера (meta.js). Клиент их только отображает — не вычисляет.
          sources[key] = {
            name: item.name || key,
            icon: item.icon || '🎬',
            quality_label: item.quality_label || '',
            url: item.url,
            show: item.show !== false
          };
        });

        filterSources = Lampa.Arrays.getKeys(sources).filter(function (key) {
          return sources[key].show;
        });

        if (!filterSources.length) return self.empty(Lampa.Lang.translate('maniya_empty_sources'));

        activeSource = Lampa.Storage.get('maniya_online_source', filterSources[0]);
        if (!sources[activeSource]) activeSource = filterSources[0];
        activeUrl = sources[activeSource].url;

        self.updateFilter();

        if (Z01_UI_OK) {
          // SKAZ-MANIYA-041: пока балансер опрашивает источники (/sources/card) —
          // экран «Опрашиваем источники» (SKAZ uiLoadingPanel: title + Nс + бар +
          // skeleton), БЕЗ тулбара «ИСТОЧНИК» и БЕЗ статического списка. Статический
          // реестр остаётся фолбэком при ошибке/дедлайне кард-сверки (ниже). Ветка не
          // зависит от конкретного контента — работает на всех фильмах.
          self.loading(true);
          self.uiLoadingPanel();
        }

        // BALANCER-002 §8 (врезано после live-сверки OLD∩NEW — гейт пройден):
        // статический /sources — реестр, карточная доступность (show:true/false
        // per card, кэш 5 мин на сервере) приходит отдельным параллельным запросом.
        // Пока сверка идёт — юзер видит реестр (поведение до врезки); по ответу
        // мёртвые источники гостятся (show:false), скрытый активный заменяется.
        if (!Z01_UI_OK) self.loadVideos();
        self.loadCardAvailability();
      }, function () {
        self.empty(Lampa.Lang.translate('maniya_server_error'));
      });
    };

    this.loadCardAvailability = function () {
      var self = this;
      // SKAZ-MANIYA-044: новый фильм — источники опрашиваем заново: «пустые» для
      // одного фильма могут снова ожить (ghost-статус — только для этой карточки).
      uiDeadSources = {};
      // SKAZ-MANIYA-059 E1/E2: новая карточка — кэш вердиктов, анти-thrash и
      // readiness тика с нуля (между фильмами не перетекают).
      liveAutoSwitchCancel();
      autoSwitchCount = 0;
      liveProbeCache = {};
      cardReady = false;
      // SKAZ-MANIYA-058: опции сезонов/озвучек и счётчик серий — per-карточка
      // (не перетекать между фильмами; заполняются снова в setFilters/draw).
      uiSeasons = [];
      uiVoices = [];
      uiItemsCount = 0;
      var url = addMovieParams(trimSlash(MANIYA_API_BASE) + '/sources/card', object.movie, object);
      requestJson(network, url, function (json) {
        self.applyCardAvailability(json);
      }, function () {
        // Сверка недоступна (сеть/сервер) — остаёмся на статическом реестре.
        if (Z01_UI_OK) {
          uiPollStop();
          self.loadVideos();
        }
      });
    };

    this.applyCardAvailability = function (json) {
      var self = this;
      // SKAZ-MANIYA-041: ответ балера пришёл, но панель опроса НЕ снимаем сразу:
      // SKAZ держит uiLoadingPanel живым до отрисовки (uiLoadingText обновляет
      // found/бар по ответу events), снимает её только в uiDraw/ноте. Следующие
      // ветки ставят found/percent и передают в эту же панель.
      if (!json || !Lampa.Arrays.isArray(json.sources)) return;

      // SKAZ-MANIYA-019: per-title модель (`meta.model`, ряд с полем `index`).
      // Модель — ПОЛНАЯ истина карточки: заменяет статический реестр; скрытые
      // источники сохраняются (ghost «Ещё N» от Lampa через updateFilter),
      // порядок — серверный index ASC (KinoPub первым), имя — серверное.
      // Играбельный URL = наш /api/lampa/videos (api_url), НЕ кластерный
      // deep-link (url) — загрузчик (activeUrl/changeSource/loadVideos) не меняется.
      var modelMode = false;
      for (var probe = 0; probe < json.sources.length; probe++) {
        if (json.sources[probe] && 'index' in json.sources[probe]) { modelMode = true; break; }
      }

      if (modelMode) {
        var built = {};
        // SKAZ-MANIYA-039 (§6 + T041 FIX): сервер отдаёт row.api_url ОТ КОРНЯ —
        // '/api/lampa/videos?provider=…' (префикс /api/lampa уже в пути, см.
        // sourceModel.js videosUrl). Глобальный resolveVideosUrl резолвит его
        // против ORIGIN хоста (а НЕ против MANIYA_API_BASE — иначе двойной путь
        // '…/api/lampa/api/lampa/…' → 404 → «Видео не найдено» после кард-модели).
        json.sources.forEach(function (row) {
          var key = sourceKey(row);
          if (!key) return;
          built[key] = {
            name: row.name || key,
            icon: row.icon || '🎬',
            quality_label: row.quality_label || '',
            url: resolveVideosUrl(row.api_url || row.url || ''),
            show: row.show !== false,
            ghost: row.show === false,
            index: row.index,
            rch: !!row.rch,
            voices: row.voices || 0,
            seasons: row.seasons || 0,
            // T052 тонкий клиент: флаг из модели (SKAZ_THIN_MODULES allowlist,
            // только skaz-строки) + слаг-балансер для проверок ThinSkaz.
            // thinUrl = КЛАСТЕРНЫЙ deep-link (row.url) — его мы отдаём lite-цепочке
            // с IP устройства. url (api_url) остаётся для legacy /videos: сервер
            // минтит с VPS, legacy-игра через /proxy. При off поле отсутствует →
            // legacy-путь байт-в-байт; thinUrl не мешает old-веткам.
            thin: !!row.thin,
            slug: row.balanser || row.balancer || '',
            thinUrl: row.url || ''
          };
        });
        sources = built;
        // Все ключи, включая ghost — Lampa сколапсит скрытые под «Ещё N».
        filterSources = Lampa.Arrays.getKeys(sources);
        var shown = filterSources.filter(function (key) { return sources[key].show; });
        // SKAZ-MANIYA-043: ответ балансера — обновляем панель опроса как
        // SKAZ uiLoadingProgress: found=count(show), бар готовится к завершению.
        uiPollFound = shown.length;
        uiPollPct = 95;
        this.uiLoadingText();
        if (!shown.length) return self.empty(Lampa.Lang.translate('maniya_empty_sources'));
        // SKAZ-MANIYA-041: активный источник должен быть ПОДТВЕРЖДЁН кластером
        // для ЭТОЙ карточки (index != null). Хранимое с прошлой карточки значение
        // (maniya_online_source) может указывать на index:null-source (rhsprem/
        // kodik — оптимистичные extras, их /videos → 0 items) → после перехода
        // на другой фильм «источники пропадают / видео не находится». Перепривязка
        // на первый подтверждённый показанный источник (server-order).
        var confirmedShown = shown.filter(function (key) { return sources[key].index != null; });
        var ordered = confirmedShown.length ? confirmedShown : shown;
        var activeStale = shown.indexOf(activeSource) === -1 ||
          (confirmedShown.length && sources[activeSource] && sources[activeSource].index == null);
        if (activeStale) {
          activeSource = ordered[0];
          activeSeason = null;
          activeVoice = null;
          Lampa.Storage.set('maniya_online_source', activeSource);
        }
        activeUrl = sources[activeSource].url;
        if (Z01_UI_OK) {
          // SKAZ-MANIYA-044: подтверждённый кластером (index != null) НЕ значит,
          // что /videos отдаст видео ЭТОЙ карточки — skaz-kinopub на «Одиссее»
          // index:1/show:true, но 0 items → мёртвый активный → «крутит долго,
          // скрипт эрор», в селекторе источники без фильмов. Пробуем кандидатов
          // ПАРАЛЛЕЛЬНО: первый реально отдавший видео — активный, пустые гочаются
          // (show:false → «Ещё N»). Панель «Найдено источников: N» живёт до
          // отрисовки (SKAZ-стиль).
          // T052 ТОНКИЙ КЛИЕНТ: активный источник помечен thin (allowlist) и не
          // падал на этой карточке → НЕ просим сервер минтить (с VPS нода отдаёт
          // skaz.tv/proxy/<token>-wrapper → «долго» через наш прокси). Плагин сам
          // проходит lite-цепочку с IP устройства (ThinSkaz.flow), UI-ветки
          // потом те же setFilters/draw. Провал flow → thinFallback → probeSources.
          var thinPick = sources[activeSource] && sources[activeSource].thin &&
            !thinExhausted && ThinSkaz.wants(sources[activeSource].slug);
          if (thinPick) {
            activeUrl = sources[activeSource].url;
            this.uiLoadingText();
            self.loadVideos();
            return;
          }
          self.probeSources(ordered);
          return;
        }
        var wasSortOpen = sortMenuOpen;
        if (wasSortOpen) Lampa.Select.close();
        self.updateFilter();
        if (wasSortOpen) filter.show(Lampa.Lang.translate('title_filter'), 'sort');
        self.loadVideos();
        return;
      }

      var changed = false;
      json.sources.forEach(function (row) {
        var key = sourceKey(row);
        if (!sources[key]) return; // реестр — источник истины для СПИСКА; тут только флаги
        var show = row.show !== false;
        if (sources[key].show !== show) {
          sources[key].show = show;
          changed = true;
        }
      });

      // Активный источник мог стать скрытым ещё до сверки (хранимое значение с
      // прошлой карточки) — проверяем всегда, не только при изменении флагов.
      filterSources = Lampa.Arrays.getKeys(sources).filter(function (key) {
        return sources[key].show;
      });

      // SKAZ-MANIYA-043: found/бар на панель опроса (legacy-ответ).
      uiPollFound = filterSources.length;
      uiPollPct = 95;
      this.uiLoadingText();

      if (!filterSources.length) return self.empty(Lampa.Lang.translate('maniya_empty_sources'));

      var activeChanged = !sources[activeSource] || !sources[activeSource].show;
      if (activeChanged) {
        activeSource = filterSources[0];
        activeUrl = sources[activeSource].url;
        activeSeason = null;
        activeVoice = null;
        Lampa.Storage.set('maniya_online_source', activeSource);
      }
      if (changed || activeChanged) {
        // BALANCER-UI-001: если sort-меню уже открыто, Lampa.Select не перерисует
        // его при filter.set('sort') (bind рисует снапшот один раз) — закрываем и
        // заново открываем с обновлённым списком (close → set → reopen).
        var wasSortOpen = sortMenuOpen;
        if (wasSortOpen) Lampa.Select.close();
        self.updateFilter();
        if (wasSortOpen) filter.show(Lampa.Lang.translate('title_filter'), 'sort');
        if (activeChanged) self.loadVideos();
      } else if (Z01_UI_OK) {
        // SKAZ-MANIYA-041: кард-ответ legacy-формата без изменений флагов — а
        // загрузочная панель ещё на экране (статик не рисовался). Переключаемся
        // на статический реестр, чтобы экран не остался на skeleton.
        self.updateFilter();
        self.loadVideos();
      }
    };

    /**
     * SKAZ-MANIYA-044/046: параллельная live-проба кандидатов (≤ PROBE_LIMIT=6;
     * сервер кэширует /videos 5 мин — повторные ответы быстрые). Первый источник,
     * ЧЬЯ ПЛЕЙ-ССЫЛКА ОТВЕТИЛА 2xx (live Range-проба), становится активным.
     * Двухслойно: (1) пустой /videos (skaz-kinopub index:1 → 0 items на «Одиссее»)
     * и (2) items есть, но ссылка битая (kinopub 403, kinoteatrkg 404, mirkino 403) —
     * оба → ghost (show:false → «Ещё N», не предлагаются). network/CORS-сбой пробы
     * → 'unverified' (не мёртв): источник виден, но active переходит к нему только
     * если никто не подтвердился. Никто не ответил → активный = первый кандидат
     * (экран покажет note + живой селектор, без вечных кручений).
     */
    /**
     * SKAZ-MANIYA-047: ghost-вердикт пришёл УЖЕ после отрисовки (другой кандидат
     * подтвердился раньше — список источников/карточки нарисованы). НЕ перерисовываем
     * тулбар целиком: каждый такой колбэк строил DOM поверх открытой панели →
     * «источники динамично моргают, то появляются, то исчезают» (жалоба юзера).
     * Точечно перестраиваем только раскрытый ряд .z01-drop (чипы + «Ещё N»).
     */
    this.uiRefreshGhost = function () {
      if (!Z01_UI_OK || ui.open !== 'source') return;
      var drop = ui.rows.find('.z01-drop');
      if (!drop.length) return;
      drop.replaceWith(this.uiSourceRow());
      Lampa.Controller.enable('content');
    };

    this.probeSources = function (ordered) {
      var self = this;
      var LIMIT = 6;
      var probed = [];
      // Активный источник (хранимый/перепривязанный) пробуем ПЕРВЫМ — если он жив,
      // юзер не теряет свой выбор; обход кандидатов — дальше по серверному порядку.
      if (sources[activeSource] && sources[activeSource].show) probed.push(activeSource);
      for (var i = 0; i < ordered.length && probed.length < LIMIT; i++) {
        var k = ordered[i];
        if (k === activeSource || !sources[k] || !sources[k].show) continue;
        probed.push(k);
      }
      if (!probed.length) return this.loadVideos();

      var winner = null;
      var finished = false;
      var pending = probed.length;   // ответы /videos
      var pendingDeep = 0;           // live-пробы плей-ссылок
      var hasVideo = {};             // 'dead' | 'unverified' | 'confirmed'
      function kill(key) {
        if (!sources[key]) return;
        uiDeadSources[key] = true;
        sources[key].show = false;
        sources[key].ghost = true;
        hasVideo[key] = 'dead';
        // SKAZ-MANIYA-059 E1/E2: вердикт важен и для периодического re-probe, и для
        // ранжирования nextSource при авто-переключении (общий in-memory кэш).
        liveProbeCache[key] = { v: 'empty', t: Date.now() };
        if (finished) { self.updateFilter(); self.uiRefreshGhost(); }
      }
      var settle = function () {
        if (finished) return;
        if (!winner && (pending > 0 || pendingDeep > 0)) return; // ещё шанс подтвердить
        finished = true;
        // Без confirmed-победителя берём первый unverified (видео ЕСТЬ, но 2xx не
        // подтверждён), иначе первый кандидат (note + живой селектор).
        var key = winner;
        if (!key) {
          for (var i = 0; i < probed.length && !key; i++) {
            if (hasVideo[probed[i]] === 'unverified') key = probed[i];
          }
          if (!key) key = probed[0];
        }
        activeSource = key;
        activeUrl = sources[key] ? sources[key].url : '';
        activeSeason = null;
        activeVoice = null;
        Lampa.Storage.set('maniya_online_source', activeSource);
        self.uiLoadingText();
        self.updateFilter();
        // Туулбаp «ИСТОЧНИК» рисуют draw()/uiListEmpty() — здесь он вылез бы
        // поверх ещё открытой панели опроса (SKAZ рисует тулбар только в uiDraw).
        self.loadVideos();
      };

      probed.forEach(function (key) {
        var url = addMovieParams(sources[key].url || '', object.movie, object);
        requestJson(network, url, function (json) {
          pending -= 1;
          var items = (json && json.items) || [];
          if (!items.length) { kill(key); settle(); return; }
          // Первая плей-ссылка; call-позиции резолвятся позже — live-пробе не подлежат.
          var play = '';
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it && it.method !== 'call' && it.url && /^https?:\/\//i.test(it.url)) { play = it.url; break; }
          }
          if (!play) { hasVideo[key] = 'unverified'; settle(); return; }
          if (typeof fetch !== 'function' || typeof AbortController !== 'function') {
            hasVideo[key] = 'unverified'; settle(); return;
          }
          pendingDeep += 1;
          var ctrl = new AbortController();
          var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 8000);
          var done = function (verdict) {
            if (timer) clearTimeout(timer);
            pendingDeep -= 1;
            if (verdict === 'ok') {
              hasVideo[key] = 'confirmed';
              if (!winner) winner = key;
              // SKAZ-MANIYA-059 E1/E2: подтверждённый живой источник — в общий кэш
              // (для следующего тика E1 и ранжирования nextSource у E2).
              liveProbeCache[key] = { v: 'ok', t: Date.now() };
            }
            else if (verdict === 'bad') { kill(key); }
            else { hasVideo[key] = 'unverified'; } // network/CORS → не подтверждён, не мёртв
            if (finished) { self.updateFilter(); self.uiRefreshGhost(); }
            settle();
          };
          fetch(play, { method: 'GET', headers: { 'Range': 'bytes=0-1023' }, signal: ctrl.signal })
            .then(function (r) { done(r && r.ok ? 'ok' : 'bad'); })
            .catch(function () { done('unverified'); });
        }, function () {
          pending -= 1;
          kill(key);
          settle();
        });
      });
    };

    // ══ SKAZ-MANIYA-059 E1: периодический фоновый re-probe известных источников ══
    // Аналог SKAZ probeBackground/probeSources/probeMark: раз в ~25с прицельно
    // перепроверяем мёртвых (вдруг ожили) + текущего активного (вдруг умер) и
    // живьём флипаем show/ghost в ОТКРЫТОМ drop (uiRefreshGhost) + в filter
    // (Lampa сколлапсирует под «Ещё N») — чип появляется/гаснет без выхода из
    // карточки. Кэш вердиктов in-memory: ok 6ч / empty 30с. Тик НЕ трогает
    // rch/thin — у тех живая картина на девайсе (RCH-only /ws, thin-минты).
    // Гигиена — STABILITY-004: один глобальный interval, clear в destroy, все
    // проб в цепочке с deadline-стражем, ни одного «висящего» колбэка.

    this.startProbeTick = function () {
      var self = this;
      if (!Z01_UI_OK || liveProbeTimer || typeof setInterval !== 'function') return;
      liveProbeTimer = setInterval(function () {
        try { self.probeTick(); } catch (e) { /* STABILITY-004 */ }
      }, LIVE_PROBE_TICK_MS);
    };

    this.probeTick = function () {
      if (!Z01_UI_OK || liveProbeBusy || !cardReady) return;
      if (!Lampa.Arrays.getKeys(sources).length) return;
      if (!liveProbeEnabled()) return;                      // kill-switch
      if (typeof document !== 'undefined' && document.hidden) return;
      if (playerBusy()) return;                             // плеер активен — не мешаем
      var self = this;
      var seq = ++liveTickSeq;
      var queue = this.liveProbeTargets(Date.now());
      if (!queue.length) return;
      liveProbeBusy = true;
      var finished = false;
      var guard = setTimeout(function () {                  // бюджет тика = дедлайн
        finished = true;
        liveProbeBusy = false;
      }, LIVE_PROBE_BUDGET);
      var inflight = 0;
      function next() {
        while (inflight < LIVE_PROBE_PARALLEL && queue.length) {
          var key = queue.shift();
          if (!sources[key]) continue;
          inflight += 1;
          self.liveProbeOne(key, function (verdict) {
            inflight -= 1;
            liveProbeCache[key] = { v: verdict, t: Date.now() };
            if (seq === liveTickSeq) self.liveProbeApply(key, verdict);
            if (!queue.length && inflight === 0 && !finished) {
              finished = true;
              clearTimeout(guard);
              liveProbeBusy = false;
            }
          });
        }
      }
      next();
    };

    /** Цели тика: мёртвые (вдруг ожили) + активный (вдруг умер). rch/thin — skip. */
    this.liveProbeTargets = function (now) {
      var targets = [];
      Lampa.Arrays.getKeys(sources).forEach(function (key) {
        var src = sources[key];
        if (!src || src.rch || src.thin) return;
        var cache = liveProbeCache[key];
        if (cache && cache.v === 'ok' && (now - cache.t) < LIVE_PROBE_OK_TTL) return;
        if (cache && cache.v === 'empty' && (now - cache.t) < LIVE_PROBE_EMPTY_TTL) return;
        if (key === activeSource) { targets.push(key); return; }  // активный — всегда
        if (src.show === false || src.ghost) targets.push(key);   // мёртвые — вдруг ожили
      });
      if (targets.length > LIVE_PROBE_TARGET_LIMIT) {
        var keep = targets.indexOf(activeSource) >= 0 ? 1 : 0;
        targets = targets
          .filter(function (k) { return k === activeSource; })
          .concat(targets.filter(function (k) { return k !== activeSource; })
            .slice(0, LIVE_PROBE_TARGET_LIMIT - keep));
      }
      return targets;
    };

    /** Одна живая проба источника: /videos (0 items → 'empty'); для активного ещё
     *  live Range-проба первой плей-ссылки (кликабельность). Ошибка сети → 'unverified'
     *  (не мёртв: транзиентный сбой сервера не должен гостить всё подряд). */
    this.liveProbeOne = function (key, cb) {
      var self = this;
      var src = sources[key];
      if (!src || !src.url) { cb('empty'); return; }
      if (src.thin && ThinSkaz.flowOk(key)) { cb('ok'); return; }  // девайс уже доказал direct
      var finished = false;
      var done = function (v) { if (finished) return; finished = true; cb(v); };
      var url = addMovieParams(src.url, object.movie, object);
      requestJson(network, url, function (json) {
        var items = Lampa.Arrays.isArray(json) ? json
          : (Lampa.Arrays.isArray(json && json.items) ? json.items : []);
        if (!items.length) { done('empty'); return; }
        if (key !== activeSource) { done('ok'); return; }  // ghost-ожившему достаточно жизни /videos
        var play = '';
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (it && it.method !== 'call' && it.url && /^https?:\/\//i.test(it.url)) { play = it.url; break; }
        }
        if (!play) { done('unverified'); return; }  // call-позиции резолвятся позже — жив не мёртв
        if (typeof fetch !== 'function' || typeof AbortController !== 'function') { done('ok'); return; }
        var ctrl = new AbortController();
        var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, LIVE_PROBE_TIMEOUT);
        var settled = function (verdict) {
          if (timer) clearTimeout(timer);
          done(verdict);
        };
        fetch(play, { method: 'GET', headers: { 'Range': 'bytes=0-1023' }, signal: ctrl.signal })
          .then(function (r) { settled(r && r.ok ? 'ok' : 'empty'); })
          .catch(function () { settled('unverified'); });  // network/CORS → не подтверждён, не мёртв
      }, function () {
        done('unverified');
      });
    };

    /** Применение вердикта: флип show/ghost + живая перестройка открытого drop
     *  (uiRefreshGhost) и filter (обновляет «Ещё N» Lampa). Активный только
     *  тускнеет (skaz-chip--ghost), НЕ уходит в «Ещё N» — юзер не теряет место;
     *  его следующий /videos уйдёт в uiListEmpty → E2 auto-switch. */
    this.liveProbeApply = function (key, verdict) {
      var self = this;
      if (!Z01_UI_OK) return;
      var src = sources[key];
      if (!src) return;
      var showBefore = src.show;
      var ghostBefore = src.ghost;
      if (verdict === 'ok') {
        if (uiDeadSources[key] || src.ghost || src.show === false) {
          delete uiDeadSources[key];
          src.show = true;
          src.ghost = false;
        }
      } else if (verdict === 'empty') {
        if (key === activeSource) {
          src.ghost = true;                       // тускнеем, но остаёмся на месте
        } else if (src.show !== false) {
          src.show = false;
          src.ghost = true;
          uiDeadSources[key] = true;
        }
      } else {
        return;                                   // unverified — ни жизни, ни смерти
      }
      if (src.show !== showBefore || src.ghost !== ghostBefore) {
        try { self.updateFilter(); } catch (e) {}
        try { self.uiRefreshGhost(); } catch (e) {}
      }
    };

    /** Вердикт из кэша, если свежий (для ранжирования nextSource). */
    this.liveProbeVerdict = function (key, now) {
      var c = liveProbeCache[key];
      if (!c) return '';
      if (c.v === 'ok' && (now - c.t) < LIVE_PROBE_OK_TTL) return 'ok';
      if (c.v === 'empty' && (now - c.t) < LIVE_PROBE_EMPTY_TTL) return 'empty';
      return '';
    };

    // ══ SKAZ-MANIYA-059 E2: авто-переключение мёртвого активного (doesNotAnswer) ══
    // uiListEmpty («источник пуст/не отвечает») → modern-note + обратный отсчёт 6с
    // → changeSource(nextSource). Гейт maniya_auto_switch (default on); анти-thrash
    // ≤2 авто-свитча на карточку; ручной выбор юзера отменяет таймер (changeSource).

    this.autoSwitchPlan = function () {
      if (!Z01_UI_OK) return null;
      if (uiPolling) return null;
      if (autoSwitchCount >= LIVE_SWITCH_LIMIT) return null;
      if (!liveAutoSwitchEnabled()) return null;
      liveAutoSwitchCancel();          // новый пустой источник → свежий отсчёт
      return { sec: LIVE_SWITCH_SECONDS };
    };

    this.autoSwitchTick = function (line, plan) {
      var self = this;
      if (autoSwitchTimer) { clearInterval(autoSwitchTimer); autoSwitchTimer = null; }
      autoSwitchNote = line;
      var left = plan.sec;
      var render = function () {
        if (!autoSwitchNote) return;
        try { autoSwitchNote.text(Lampa.Lang.translate('maniya_auto_switch').replace('{sec}', left)); }
        catch (e) {}
      };
      render();
      autoSwitchTimer = setInterval(function () {
        left -= 1;
        if (left <= 0) {
          clearInterval(autoSwitchTimer);
          autoSwitchTimer = null;
          autoSwitchNote = null;
          try { self.autoSwitchDead(); } catch (e) {}
          return;
        }
        render();
      }, 1000);
    };

    this.autoSwitchDead = function () {
      autoSwitchCount += 1;
      var next = this.nextSource();
      if (!next) return;   // кандидатов нет — остаёмся на ноте, дальше только вручную
      this.changeSource(next);
    };

    function liveAutoSwitchCancel() {
      if (autoSwitchTimer) { clearInterval(autoSwitchTimer); autoSwitchTimer = null; }
      autoSwitchNote = null;
    }

    /** Следующий источник: 'ok' по live-пробе > knownQuality > серверный порядок
     *  (index ASC из кард-модели). Только показанные, не активный. */
    this.nextSource = function () {
      var self = this;
      var now = Date.now();
      var ok = [];
      var rest = [];
      Lampa.Arrays.getKeys(sources).forEach(function (key) {
        if (key === activeSource || !sources[key] || sources[key].show === false) return;
        if (self.liveProbeVerdict(key, now) === 'ok') ok.push(key);
        else rest.push(key);
      });
      var pick = function (list) {
        list.sort(function (a, b) {
          var byQuality = liveQualityRank(sources[b]) - liveQualityRank(sources[a]);
          if (byQuality) return byQuality;
          var ia = sources[a].index == null ? 1e9 : Number(sources[a].index);
          var ib = sources[b].index == null ? 1e9 : Number(sources[b].index);
          return ia - ib;
        });
        return list.length ? list[0] : null;
      };
      return pick(ok) || pick(rest);
    };

    this.updateFilter = function () {
      filter.set('sort', filterSources.map(function (key) {
        return {
          title: sourceLabel(sources[key]),
          source: key,
          selected: key === activeSource,
          ghost: !sources[key].show
        };
      }));
      filter.chosen('sort', [sourceLabel(sources[activeSource])]);
    };

    // ── SKAZ-like UI (T040): каркас .z01 (hero + чипы + список) ──
    // Эквивалент onlines.js uiFrame: scroll → .z01 → [.z01__hero, .z01__rows, .z01__list].
    // SKAZ-MANIYA-041: ui.root модульный и ПЕРЕЖИВАЕТ activity фильмов. Проверка
    // parent() не годится — старый скролл предыдущего фильма ещё в DOM, и на втором
    // фильме новый скролл не получал каркас → «всё пропадает». Привязываемся к
    // scroll-элементу КОНКРЕТНОГО компонента (ui.attachedScroll): новый фильм =
    // новый scroll → clear + повторный append.
    this.uiFrame = function () {
      if (!ui.root) {
        ui.root = $('<div class="z01"></div>');
        ui.heroBox = $('<div class="z01__hero"></div>');
        ui.rows = $('<div class="z01__rows"></div>');
        ui.list = $('<div class="z01__list"></div>');
        ui.root.append(ui.heroBox).append(ui.rows).append(ui.list);
      }
      // SKAZ (onlines.js uiFrame): переприкрепляем, если root УЖЕ выпал из DOM
      // (наш reset() в loadVideos делает scroll.clear() — root отсоединяется, и
      // проверка только attachedScroll не замечает этого → items рисуются в
      // невидимый root → «карточка пропала / ничего не находит»). Второе условие —
      // новый activity (новый scroll) → повторное append.
      if (ui.attachedScroll !== scroll || !ui.root.parent().length) {
        ui.attachedScroll = scroll;
        scroll.clear();
        scroll.append(ui.root);
      }
      ui.heroBox.empty();
      ui.rows.empty();
      ui.list.empty();
      return ui.root;
    };

    /** SKAZ-like панель опроса (onlines.js uiLoadingPanel/uiLoadingText/uiSkeleton):
     *  Заголовок «Опрашиваем источники», строка-прогресс как SKAZ uiLoadingText:
     *  «Опрашиваем источники · Nс», после ответа балансера — «Найдено источников:
     *  {n} · Nс», при ≥12с и percent<100 — « · отвечают медленно». Бар = max(pct,
     *  min(90, sec*7)). Тулбар «ИСТОЧНИК» рисуется СРАЗУ (смена источника работает
     *  во время опроса, как SKAZ), а не только когда баланер вернул модель. */
    this.uiLoadingPanel = function () {
      var self = this;
      if (!Z01_UI_OK) return;
      uiPolling = true;
      uiPollStart = 0;
      uiPollFound = -1;
      uiPollPct = 0;
      if (uiPollTimer !== null) { clearInterval(uiPollTimer); uiPollTimer = null; }
      self.uiFrame();
      ui.heroBox.empty();
      ui.rows.empty();
      ui.list.empty();
      var html = $(
        '<div class="z01-loading">' +
          '<div class="z01-loading__title"></div>' +
          '<div class="z01-loading__text"></div>' +
          '<div class="z01-loading__bar"><div style="width:0%"></div></div>' +
        '</div>' +
        '<div class="z01-skeleton">' +
          '<div class="z01-skeleton__row"><div class="z01-skeleton__thumb"></div><div class="z01-skeleton__body"><div class="z01-skeleton__line"></div><div class="z01-skeleton__line z01-skeleton__line--short"></div></div></div>' +
          '<div class="z01-skeleton__row"><div class="z01-skeleton__thumb"></div><div class="z01-skeleton__body"><div class="z01-skeleton__line"></div><div class="z01-skeleton__line z01-skeleton__line--short"></div></div></div>' +
          '<div class="z01-skeleton__row"><div class="z01-skeleton__thumb"></div><div class="z01-skeleton__body"><div class="z01-skeleton__line"></div><div class="z01-skeleton__line z01-skeleton__line--short"></div></div></div>' +
        '</div>'
      );
      html.find('.z01-loading__title').text(Lampa.Lang.translate('maniya_polling_start'));
      ui.list.append(html);
      uiPollBar = ui.list.find('.z01-loading__bar>div');
      uiPollText = ui.list.find('.z01-loading__text');

      this.uiLoadingText();
      uiPollTimer = setInterval(function () {
        uiPollStart += 1;
        self.uiLoadingText();
      }, 1000);
      this.loading(false);
      Lampa.Controller.enable('content');
      // Селектор «ИСТОЧНИК» живёт и на polling-экране: switch источника доступен
      // сразу (было: селектор появлялся только после ответа балансера → «первое
      // открытие висит, нельзя сменить источник»). Переключение → changeSource →
      // loadVideos рисует свежую polling-панель, цикл закрыт.
      if (activeSource && sources[activeSource]) self.uiToolbar();
      // WATCHDOG: если балансер долго молчит (нет сети/сервер занят) — через
      // 15с снимаем панель и показываем статический реестр (не весим вечно).
      uiPollDeadline();
    };

    /** SKAZ uiLoadingText (onlines.js 1311): текст = found?«Найдено источников:
     *  {n}»:«Опрашиваем источники» + « · Nс»; slow-нота при ≥12с и percent<100;
     *  бар = max(ui_load_percent, min(90, sec*7)). Панель отвязана от DOM —
     *  опрос завершён, таймер снимается (SKAZ uiLoadingText само-стоп). */
    this.uiLoadingText = function () {
      if (!uiPollText || !uiPollText.parent().length) return uiPollStop();
      var text = uiPollFound >= 0
        ? Lampa.Lang.translate('maniya_polling_found').replace('{n}', uiPollFound)
        : Lampa.Lang.translate('maniya_polling_start');
      text += ' · ' + uiPollStart + Lampa.Lang.translate('maniya_sec');
      if (uiPollStart >= 12 && uiPollPct < 100) {
        text += ' · ' + Lampa.Lang.translate('maniya_polling_slow');
      }
      try { uiPollText.text(text); } catch (e) {}
      var percent = Math.max(uiPollPct, Math.min(90, uiPollStart * 7));
      try { uiPollBar.css('width', percent + '%'); } catch (e) {}
    };

    /** Картинка арта: backdrop/постер карточки (hero) или постер item'а. */
    function uiArtPath(kind, path) {
      if (!path) return '';
      if (!Lampa.TMDB || typeof Lampa.TMDB.image !== 'function') return path;
      try {
        return Lampa.TMDB.image(kind + path);
      } catch (e) { return path; }
    }

    /** Целевой элемент для hero-кнопки: первый с прогрессом, иначе первый. */
    function uiPickResume(items) {
      var i;
      for (i = 0; i < items.length; i++) {
        if (items[i].timeline && items[i].timeline.percent > 0) return items[i];
      }
      return items[0];
    }

    /** Hero-карточка (onlines.js uiHero): постер-фон, градиент, мета, ▶, hint, прогресс. */
    this.uiHero = function (items) {
      var self = this;
      // SKAZ-MANIYA-044: hero рисуется ОТ ФИЛЬМА (object.movie), а не от наличия
      // видео — переход на источник без фильма НЕ должен убивать карточку (жалоба
      // юзера). При 0 items ▶ скрывается, арт/название/мета остаются.
      if (!object.movie || (!(object.movie.title || object.movie.name) && (!items || !items.length))) return;
      var movie = object.movie || {};
      if (!ui.hero) {
        ui.hero = $('<div class="z01-hero">' +
          '<div class="z01-hero__bg"><img alt=""></div><div class="z01-hero__shade"></div>' +
          '<div class="z01-hero__body">' +
          '<div class="z01-hero__title"></div><div class="z01-hero__meta"></div><div class="z01-hero__descr"></div>' +
          '<div class="z01-hero__actions"><div class="z01-hero__hint"></div></div>' +
          '<div class="z01-hero__season" style="display:none"></div>' +
          '<div class="z01-hero__progress" style="display:none"></div>' +
          '</div></div>');
      }
      // SKAZ-MANIYA-041: hero-карточка — НЕ одноразовая. ui.hero живёт на
      // модульном уровне (переиспользуется между карточками фильмов), поэтому
      // title/descr/арт обновляем КАЖДЫЙ draw из текущего object.movie — иначе
      // после «Человека-паука» его карточка висит на всех следующих фильмах.
      ui.hero.find('.z01-hero__title').text(movie.title || movie.name || '');
      ui.hero.find('.z01-hero__descr').text(movie.overview || '');
      var art = movie.backdrop_path || movie.poster_path;
      var back = ui.hero.find('.z01-hero__bg');
      var img = ui.hero.find('.z01-hero__bg img');
      back.removeClass('z01-hero__bg--loaded');
      if (art) {
        img.on('load', function () { back.addClass('z01-hero__bg--loaded'); });
        img.attr('src', uiArtPath('t/p/w780', art));
      } else {
        img.removeAttr('src');
      }
      ui.heroBox.append(ui.hero);

      var target = (items && items.length) ? uiPickResume(items) : null;
      var serial = movie.name ? true : false;
      var started = target && target.timeline && target.timeline.percent > 0 && target.timeline.percent < 90;

      var actions = ui.hero.find('.z01-hero__actions');
      actions.find('.z01-btn').remove();
      // SKAZ-MANIYA-044: ▶ есть ТОЛЬКО когда источник дал видео; на пустом
      // источнике hint остаётся без кнопки (селектор рядом — можно сменить).
      if (target) {
        var button = $('<div class="z01-btn z01-btn--main selector"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span class="z01-btn__label"></span></div>');
        var label = Lampa.Lang.translate(started ? 'maniya_continue' : 'maniya_watch');
        if (serial && target && target.episode) label += ' · S' + (target.season || 1) + ' E' + target.episode;
        button.find('.z01-btn__label').text(label);
        button.on('hover:enter', function () { self.play(target); })
          .on('hover:focus', function () { scroll.update($(this).parent(), true); });
        actions.prepend(button);
      }

      var hint = [];
      hint.push((sources[activeSource] && sources[activeSource].name) || activeSource);
      if (target && target.voice_name) hint.push(target.voice_name);
      actions.find('.z01-hero__hint').text(hint.join(' · '));

      var meta = ui.hero.find('.z01-hero__meta').empty();
      var badge = shortQuality((target && (bestQualityLabel(target) || target.quality_label)) || (sources[activeSource] && sources[activeSource].quality_label));
      if (badge) meta.append('<div class="z01-badge">' + escapeHtml(badge) + '</div>');
      if (movie.vote_average) meta.append('<div>★ ' + parseFloat(movie.vote_average + '').toFixed(1) + '</div>');
      var year = ((movie.release_date || movie.first_air_date || '') + '').slice(0, 4);
      if (year) meta.append('<div>' + escapeHtml(year) + '</div>');
      if (target && target.time) meta.append('<div>' + escapeHtml(target.time) + '</div>');

      var progress = ui.hero.find('.z01-hero__progress').empty();
      if (target && target.timeline && target.timeline.percent > 0 && Lampa.Timeline && typeof Lampa.Timeline.render === 'function') {
        progress.show().append(Lampa.Timeline.render(target.timeline));
      } else progress.hide();

      var seasonLine = ui.hero.find('.z01-hero__season');
      if (serial && items.length > 1) {
        seasonLine.text(Lampa.Lang.translate('maniya_items_count').replace('{n}', items.length)).show();
      } else seasonLine.hide();
    };

    /**
     * SKAZ-MANIYA-058: селектор «Источник / Сезон / Озвучка» + раскрытие в pill-чипы
     * (onlines.js uiRows/addChip + uiOptionRow). Чипы «Сезон»/«Озвучка» рисуются
     * как у SKAZ (1806/1811): только когда опций > 1, текст — текущий выбор,
     * клик → uiToggle(type) → .z01-drop рядами опций → uiSwitch(type, index).
     * Данные uiSeasons/uiVoices приходят из ответа /videos (setFilters) — сервер
     * уже умеет season=/voice=, поэтому чипы это чистый клиентский рендер.
     */
    this.uiToolbar = function () {
      var self = this;
      ui.rows.empty();
      var toolbar = $('<div class="z01-toolbar"></div>');

      // Эталон onlines.js addChip: label (маленький, caps) + чип (текст = текущее).
      var addChip = function (key, label, text, opts) {
        opts = opts || {};
        if (label) toolbar.append($('<div class="z01-toolbar__label"></div>').text(label));
        var chip = $('<div class="z01-chip selector"></div>');
        chip.attr('data-z01-focus', key);
        if (opts.badge) chip.append($('<span class="z01-chip__badge"></span>').text(opts.badge));
        chip.append($('<span class="z01-chip__label"></span>').text(text));
        chip.append(chevronSvg());
        if (opts.active) chip.addClass('z01-chip--active');
        chip.on('hover:enter', function () { self.uiToggle(key); })
          .on('hover:focus', function (e) { last = e.target; scroll.update($(e.target), true); });
        toolbar.append(chip);
      };

      var current = sources[activeSource];
      var parts = sourceChipParts(current, activeSource);
      // T052: «✈» = thin direct доказан и играет с устройства (не через /proxy).
      var sourceText = parts.label;
      if (current && current.thin && ThinSkaz.flowOk(activeSource)) sourceText += ' ✈';
      addChip('source', Lampa.Lang.translate('maniya_source'), sourceText, {
        badge: parts.badge,
        active: ui.open === 'source'
      });

      // Сезон — только если источников сезонов > 1 (как SKAZ filter_find.season.length>1).
      if (uiSeasons.length > 1) {
        addChip('season', Lampa.Lang.translate('maniya_season'), this.uiCurrentSeasonTitle(), {
          active: ui.open === 'season'
        });
      }
      // Озвучка — только если озвучек > 1.
      if (uiVoices.length > 1) {
        addChip('voice', Lampa.Lang.translate('maniya_voice'), this.uiCurrentVoiceName(), {
          active: ui.open === 'voice'
        });
      }

      // W3 (D7): «Переход» для длинных списков серий (как SKAZ JUMP_FROM=20,
      // onlines.js 1815-1818): только сериал и серий больше 20.
      if (object.movie && object.movie.name && uiItemsCount > 20) {
        addChip('jump', Lampa.Lang.translate('maniya_jump'), '1–20+', {
          active: ui.open === 'jump'
        });
      }

      ui.rows.append(toolbar);
      if (ui.open === 'source') ui.rows.append(this.uiSourceRow());
      else if (ui.open === 'season') ui.rows.append(this.uiOptionRow('season'));
      else if (ui.open === 'voice') ui.rows.append(this.uiOptionRow('voice'));
      else if (ui.open === 'jump') ui.rows.append(this.uiJumpRow());
    };

    /** W3 (D7): ряд «Переход {n}» по 20 серий (onlines.js uiJumpRow 2096-2116,
     *  но без пейджинга — у нас серии в одном скролле, поэтому клик скроллит). */
    this.uiJumpRow = function () {
      var self = this;
      var row = $('<div class="z01-drop"></div>');
      var from = 1;
      while (from <= uiItemsCount) {
        var to = Math.min(from + 19, uiItemsCount);
        (function (f, t) {
          var c = $('<div class="z01-chip selector"></div>');
          c.attr('data-z01-focus', 'jump:' + f);
          c.append($('<span class="z01-chip__label"></span>').text(f + '–' + t));
          c.on('hover:enter', function () { self.uiJumpTo(f - 1); })
            .on('hover:focus', function (e) { last = e.target; scroll.update($(e.target), true); });
          row.append(c);
        })(from, to);
        from += 20;
      }
      return row;
    };

    /** Текущий сезон (заголовок) для чипа «Сезон», фолбэк — первый из списка. */
    this.uiCurrentSeasonTitle = function () {
      if (activeSeason !== null && uiSeasons.length) {
        for (var i = 0; i < uiSeasons.length; i++) {
          if (String(uiSeasons[i].number) === String(activeSeason)) return uiSeasons[i].title;
        }
      }
      return uiSeasons.length ? uiSeasons[0].title : '';
    };

    /** Текущая озвучка (имя) для чипа «Озвучка», фолбэк — первая из списка. */
    this.uiCurrentVoiceName = function () {
      if (activeVoice !== null && uiVoices.length) {
        for (var i = 0; i < uiVoices.length; i++) {
          if (String(uiVoices[i].index) === String(activeVoice)) return uiVoices[i].name;
        }
      }
      return uiVoices.length ? uiVoices[0].name : '';
    };

    /** Общий аккордеон: раскрытие/закрытие ряда опций (onlines.js uiToggle). */
    this.uiToggle = function (key) {
      if (ui.open === key) ui.open = '';
      else ui.open = key;
      this.uiToolbar();
      Lampa.Controller.enable('content');
    };

    /** SKAZ-MANIYA-058: ряд опций сезона/озвучки в .z01-drop (onlines.js uiOptionRow).
     *  Активный помечается z01-chip--active; клик по другому → uiSwitch → loadVideos
     *  с новым season=/voice= (источник не пересоздаётся, выбор переживает смену). */
    this.uiOptionRow = function (type) {
      var self = this;
      var row = $('<div class="z01-drop"></div>');
      var order = [];
      if (type === 'season') {
        order = uiSeasons.map(function (opt, index) { return { opt: opt, index: index }; });
      } else {
        // W3 (D9): сортируем озвучки по kind (Дубляж → Многоголосый → Двухголосый →
        // Авторский → Оригинал → Субтитры → прочее) — как SKAZ uiOptionRow 2160-2171.
        order = uiVoices.map(function (opt, index) {
          return { opt: opt, index: index, kind: voiceKind(opt.name), rk: voiceKindRank(voiceKind(opt.name)) };
        }).sort(function (a, b) {
          return (a.rk - b.rk) || (a.index - b.index);
        });
      }
      order.forEach(function (entry) {
        var opt = entry.opt;
        var index = entry.index;
        var value = type === 'season' ? opt.number : opt.index;
        var active = type === 'season'
          ? (activeSeason !== null && String(value) === String(activeSeason))
          : (activeVoice !== null && String(value) === String(activeVoice));
        var c = $('<div class="z01-chip selector"></div>');
        c.attr('data-z01-focus', type + ':' + index);
        c.append($('<span class="z01-chip__label"></span>').text(opt.title || opt.name));
        if (active) c.addClass('z01-chip--active');
        (function (v, chip) {
          chip.on('hover:enter', function () {
            if (active) { ui.open = ''; self.uiToolbar(); return; }
            self.uiSwitch(type, v);
          }).on('hover:focus', function (e) { last = e.target; scroll.update($(e.target), true); });
        })(value, c);
        row.append(c);
      });
      return row;
    };

    /** SKAZ-MANIYA-058: выбор сезона/озвучки (onlines.js uiSwitch): значение кладём
     *  в activeSeason/activeVoice, закрываем дроп и перезапрашиваем через loadVideos
     *  (он уже шлёт season=/voice=; загруженное попадает в setFilters → draw).
     *  W3 (D5/D6): сохраняем выбор — предпочитаемая озвучка (kind) и последний сезон. */
    this.uiSwitch = function (type, value) {
      if (type === 'season') {
        activeSeason = value;
        this.seasonMemory(value);
      } else {
        activeVoice = value;
        var name = this.uiCurrentVoiceName();
        var kind = voiceKind(name);
        if (kind && kind !== 'other') Lampa.Storage.set('maniya_voice_pref', kind);
        else Lampa.Storage.set('maniya_voice_pref', '');
      }
      ui.open = '';
      this.loadVideos();
    };

    /** W3 (D6): последний выбранный сезон per movie.id (эталон onlines.js
     *  seasonMemory/z01_season_last 3841-3857, только свой ключ maniya_season_last).
     *  Lampa.Storage.cache — норма, fallback (vm-песочница без cache) — plain get/set. */
    this.seasonMemory = function (number) {
      var all;
      if (typeof Lampa.Storage.cache === 'function') {
        all = Lampa.Storage.cache('maniya_season_last', 7200, {});
      } else {
        all = Lampa.Storage.get('maniya_season_last', {}) || {};
      }
      if (number === undefined) return all[object.movie.id];
      all[object.movie.id] = number;
      Lampa.Storage.set('maniya_season_last', all);
    };
    this.seasonMemoryIndex = function () {
      var wanted = this.seasonMemory();
      if (!wanted) return -1;
      for (var i = 0; i < seasonNumbers.length; i++) {
        if (String(seasonNumbers[i]) === String(wanted)) return i;
      }
      return -1;
    };

    /** W3 (D5): автоприменение сохранённых предпочтений при ПЕРВОМ открытии сериала
     *  на карточке (activeSeason/activeVoice ещё null): озвучка по kind (как SKAZ
     *  skaz_voice_pref, onlines.js 3710-3737) и последний сезон (з01_season_last).
     *  Предпочтение ≠ активного варианта → перезапрос с новым season=/voice=
     *  (перезапроса нет, если memory — уже дефолтный выбор сервера → лишних
     *  запросов нет). Возвращает true, если уже запрошена перезагрузка. */
    this.applyPrefChoices = function () {
      if (!object.movie || !object.movie.name) return false;
      var changed = false;

      if (activeVoice === null && uiVoices.length > 1 &&
          Lampa.Storage.get('maniya_voice_auto', true) !== false) {
        var pref = Lampa.Storage.get('maniya_voice_pref', '');
        for (var v = 0; v < uiVoices.length; v++) {
          if (voiceKind(uiVoices[v].name) === pref) {
            // Дефолтный выбор сервера — первый голос (index 0): он же и есть
            // предпочтение → перезапрос не нужен, просто фиксируем.
            if (String(uiVoices[v].index) !== '0' && String(uiVoices[v].index) !== String(voiceIndexes[0])) {
              activeVoice = uiVoices[v].index;
              changed = true;
            } else {
              activeVoice = uiVoices[v].index;
            }
            break;
          }
        }
      }

      if (activeSeason === null && uiSeasons.length > 1) {
        var idx = this.seasonMemoryIndex();
        if (idx > 0) {
          activeSeason = uiSeasons[idx].number;
          changed = true;
        } else if (idx === 0) {
          activeSeason = uiSeasons[0].number;
        }
      }

      if (changed) {
        var self = this;
        setTimeout(function () { self.loadVideos(); }, 0);
      }
      return changed;
    };

    /** W3 (D7): навигация по длинному списку серий драматургии — чип «Переход»
     *  (onlines.js addChip('jump') 1815-1818 + uiJumpRow 2096-2116). Отличие:
     *  у нас серии рисуются одним скроллом (без пейджинга), поэтому «переход» —
     *  это СКРОЛЛ к нужному куску списка, а не смена страницы. Ряды = по 20 серий. */
    this.uiJumpTo = function (startIndex) {
      if (!ui.list) return;
      var cards = ui.list.find('.z01-card');
      var target = cards.eq(startIndex);
      if (!target.length) return;
      ui.open = '';
      last = target[0];
      scroll.update(target, true);
      this.uiToolbar();
      Lampa.Controller.enable('content');
    };

    /** Раскрытый ряд источников: чипы «бейдж+иконка+имя+●», ghost-скрытые, «Ещё N». */
    this.uiSourceRow = function () {
      var self = this;
      var visible = [];
      var hidden = [];
      filterSources.forEach(function (key) {
        if (key === activeSource || sources[key].show) visible.push(key);
        else hidden.push(key);
      });
      if (uiAllSources) visible = visible.concat(hidden);
      hidden = filterSources.filter(function (key) { return visible.indexOf(key) === -1; });

      var row = $('<div class="z01-drop"></div>');
      visible.forEach(function (key) {
        var info = sources[key];
        var p = sourceChipParts(info, key);
        // T052: «✈» только у активного источника с подтверждённым thin-direct.
        var chipLabel = p.label;
        if (info && info.thin && key === activeSource && ThinSkaz.flowOk(key)) chipLabel += ' ✈';
        var c = $('<div class="z01-chip selector"></div>');
        c.attr('data-z01-focus', 'src:' + key);
        if (info.show === false || info.ghost) c.addClass('z01-chip--ghost');
        if (p.badge) c.append($('<span class="z01-chip__badge"></span>').text(p.badge));
        c.append($('<span class="z01-chip__label"></span>').text(chipLabel));
        if (key === activeSource) c.addClass('z01-chip--active');
        if (info.show !== false) c.append('<span class="z01-chip__dot"></span>');
        (function (k, chip) {
          chip.on('hover:enter', function () {
            if (k === activeSource) { ui.open = ''; self.uiToolbar(); return; }
            ui.open = '';
            self.changeSource(k);
          }).on('hover:focus', function (e) { last = e.target; scroll.update($(e.target), true); });
        })(key, c);
        row.append(c);
      });

      if (!uiAllSources && hidden.length) {
        var more = $('<div class="z01-chip z01-chip--more selector"></div>');
        more.append($('<span class="z01-chip__label"></span>')
          .text(Lampa.Lang.translate('maniya_more_sources').replace('{count}', hidden.length)));
        more.on('hover:enter', function () {
          uiAllSources = true;
          self.uiToolbar();
          Lampa.Controller.enable('content');
        }).on('hover:focus', function (e) { last = e.target; scroll.update($(e.target), true); });
        row.append(more);
      }
      return row;
    };

    /** Item как z01-card (onlines.js uiDraw): thumb+num, бейдж, title, meta ●, time, line. */
    this.uiAppendItem = function (item, index) {
      var self = this;
      item.thumbnail = item.poster || item.thumbnail || '';
      var serial = object.movie && object.movie.name ? true : false;
      var n = serialEpisodeOf(item);
      var badge = shortQuality(bestQualityLabel(item) || item.quality_label || '');
      var meta = [];
      if (item.voice_name) meta.push(item.voice_name);
      if (n > 0) meta.push(Lampa.Lang.translate('maniya_episode') + ' ' + n);
      if (item.time) meta.push(item.time);
      // SKAZ-MANIYA-047: «Осталось …» как в эталоне (onlines.js 2539-2541): видно
      // время к концу, а не только общую длительность («полоска + время сколько
      // идёт» — прямая жалоба юзера на карточке фильма).
      if (item.timeline && item.timeline.percent > 0 && item.timeline.duration > item.timeline.time) {
        meta.push(Lampa.Lang.translate('maniya_left') + ' ' + Lampa.Utils.secondsToTime(item.timeline.duration - item.timeline.time, true));
      }

      var html = $('<div class="z01-card selector">' +
        '<div class="z01-card__thumb"><img alt=""><div class="z01-card__num"></div><div class="z01-card__line"></div></div>' +
        '<div class="z01-card__body"><div class="z01-card__title"></div><div class="z01-card__meta"></div></div>' +
        '<div class="z01-card__side"><div class="z01-card__quality"></div><div class="z01-card__time"></div></div>' +
        '</div>');
      if (!serial) html.addClass('z01-card--file');
      item.__html = html;

      html.find('.z01-card__title').text(item.title || '');
      html.find('.z01-card__meta').html(meta.map(function (part) {
        return '<span>' + escapeHtml(part) + '</span>';
      }).join('<span class="z01-dot">●</span>'));
      html.find('.z01-card__num').text(n > 0 ? (n < 10 ? '0' + n : String(n)) : '');
      html.find('.z01-card__time').text(item.time || '');
      if (badge) html.find('.z01-card__quality').addClass('z01-badge').text(badge);
      else html.find('.z01-card__quality').remove();

      var thumb = html.find('.z01-card__thumb');
      var img = html.find('.z01-card__thumb img');
      // SKAZ-MANIYA-047: полоска прогресса рисуется СРАЗУ (не в on('load') постера —
      // при битой/медленной картинке «полоска на фильме» не должна пропадать).
      if (Lampa.Timeline && typeof Lampa.Timeline.render === 'function' && item.timeline && item.timeline.percent > 0) {
        thumb.find('.z01-card__line').append(Lampa.Timeline.render(item.timeline));
      }
      if (item.poster) {
        img.on('load', function () {
          thumb.addClass('z01-card__thumb--loaded');
        });
        img.on('error', function () { img.attr('src', './img/img_broken.svg'); });
        img.attr('src', item.poster);
      } else {
        thumb.remove();
      }

      html.on('hover:enter', function () { self.play(item); })
        .on('hover:focus', function (event) {
          last = event.target;
          scroll.update($(event.target), true);
        });

      ui.list.append(html);
    };

    this.changeSource = function (key) {
      if (!sources[key]) return;
      // SKAZ-MANIYA-059 E2: ручной выбор юзера всегда побеждает — гасим авто-switch.
      liveAutoSwitchCancel();
      ui.open = '';
      activeSource = key;
      activeUrl = sources[key].url;
      // Разные источники → разные сезоны/озвучки: сбрасываем выбор, чтобы не
      // тащить season=N/voice=M чужого источника в новый (иначе UI покажет
      // несуществующий сезон/голос и «не найдёт» серии).
      activeSeason = null;
      activeVoice = null;
      Lampa.Storage.set('maniya_online_source', key);
      this.updateFilter();
      this.loadVideos();
    };

    this.loadVideos = function () {
      var self = this;
      // T052 ТОНКИЙ КЛИЕНТ: thin-источник, не исчерпали попыток на карточке и
      // базовая среда есть → клиентская lite-ветка (сам ходим в кластер с IP
      // девайса). Любое «нет» ниже → legacy /videos. thinFallback внутри flow
      // ставит thinExhausted=true и вызывает этот же loadVideos ещё раз — теперь
      // гейт ложный → идём старым путём (без рекурсии/зацикливания).
      var thinAtGate = sources[activeSource] && sources[activeSource].thin &&
        !thinExhausted && ThinSkaz.wants(sources[activeSource].slug);
      if (thinAtGate) return this.thinFlow();
      if (!Z01_UI_OK) {
        this.reset();
      } else if (!uiPolling) {
        // SKAZ-MANIYA-043: смена источника/повторная загрузка — НЕ уничтожаем
        // экран (SKAZ doesNotAnswer/перерисовка держат hero+тулбар). Держим
        // каркас + селектор «ИСТОЧНИК» живыми, меняем только список.
        uiPollStop();
        network.clear();
        this.uiFrame();
        this.uiToolbar();
      }
      // Первая загрузка после балансера (uiPolling=true) — панель «Опрашиваем
      // источники / Найдено источников: N» остаётся на экране до ответа /videos:
      // SKAZ ровно так (uiLoadingStop вызывается в uiDraw). Снимается сама в
      // draw()/uiListEmpty() через uiLoadingText (панель отвязана от DOM).
      var url = addMovieParams(activeUrl || trimSlash(MANIYA_API_BASE) + '/videos', object.movie, object);
      if (activeSeason !== null) url = Lampa.Utils.addUrlComponent(url, 'season=' + encodeURIComponent(activeSeason));
      if (activeVoice !== null) url = Lampa.Utils.addUrlComponent(url, 'voice=' + encodeURIComponent(activeVoice));
      requestJson(network, url, function (json) {
        if (json.error === 'subscription_required') return self.empty(json.message);
        self.setFilters(json);
        self.draw(normalizeItems(json));
      }, function () {
        // SKAZ-MANIYA-043: ошибка источника НЕ стирает экран — держим тулбар,
        // юзер видит «Видео не найдено» и может сменить источник (было: empty()
        // → scroll.clear() → «всё пропадает и не возможно изменить источник»).
        self.uiListEmpty(Lampa.Lang.translate('maniya_no_results'), Lampa.Lang.translate('maniya_switch_source'));
      });
    };

    /** T052: клиентская lite-ветка (ThinSkaz.flow). Форма, что отдаёт лист,
     *  — ровно как /videos {items,seasons,voices} → setFilters/draw без правок. */
    this.thinFlow = function () {
      var self = this;
      var key = activeSource;
      var source = sources[key];
      if (!source || !source.url) return null;
      if (!Z01_UI_OK) {
        this.reset();
      } else {
        // Как в loadVideos : НЕ уничтожаем экран — держим hero + тулбар,
        // меняем только список.
        uiPollStop();
        network.clear();
        this.uiFrame();
        this.uiToolbar();
      }
      ThinSkaz.flow({
        key: key,
        slug: source.slug,
        // Кластерный deep-link (row.url), НЕ api_url: liteHostsPairs вытаскивает
        // '/lite/<slug>' из pathname. С VPS-/videos-пути путь был бы '/api/lampa/
        // videos' → базовый запрос на корень → вечный фолбэк (T052-C regression).
        sourceUrl: source.thinUrl || source.url,
        movie: object.movie || {},
        component: object,
        season: activeSeason,
        voice: activeVoice,
        budgetMs: 8000
      }).then(function (resolved) {
        if (!resolved) { self.thinFallback(key); return; }
        // direct доказан (минт первого голоса/серии) → «✈» в источнике.
        ThinSkaz.flowReady(key);
        self.setFilters(resolved);
        self.draw(normalizeItems(resolved));
      }, function () {
        self.thinFallback(key);
      });
    };

    /** T052: провал тонкой ветки → Noty + навсегда (на этой карточке) старый
     *  /videos пробируется как раньше. Битых экранов нет: гейт в loadVideos
     *  теперь false, thinExhausted не сбрасывается до пересоздания компонента. */
    this.thinFallback = function (key) {
      thinExhausted = true;
      ThinSkaz.flowReset(key);
      try { Lampa.Noty.show(Lampa.Lang.translate('maniya_thin_fallback')); } catch (e) {}
      this.loadVideos();
    };

    this.setFilters = function (json) {
      // Канонический Lampa-Filter `filter` с под-фильтрами season/voice — ровно
      // как эталон E-Online (Online/plugin.js this.filter). season/voice это НЕ
      // отдельные типы `filter.set('season'/'voice')`: Lampa рендерит только
      // sort/filter/search, отдельный тип молча не отобразится → «сезоны/озвучки
      // не видны». Значения храним отдельно (seasonNumbers/voiceIndexes), а в
      // onSelect индекс под-элемента (subitem.index) мапится обратно в значение.
      // Порядок как в эталоне: «Озвучка» (Перевод) → «Сезон»; первый пункт — reset.
      var select = [];
      seasonNumbers = [];
      voiceIndexes = [];
      uiSeasons = [];
      uiVoices = [];
      var selectedVoice = '';
      var selectedSeason = '';

      if (json && json.voices && json.voices.length) {
        voiceIndexes = json.voices.map(function (voice) { return voice.index; });
        // SKAZ-MANIYA-058: копия опций для Z01-тулбара (чип «Озвучка») — как
        // filter_find.voice в onlines.js. name для чипа, index для season=/voice=.
        uiVoices = json.voices.map(function (voice, idx) {
          return { name: voice.name || '', index: voice.index != null ? voice.index : idx, title: voice.name || '' };
        });
        var voiceIndex = 0;
        if (activeVoice !== null) {
          for (var j = 0; j < voiceIndexes.length; j++) {
            if (String(voiceIndexes[j]) === String(activeVoice)) { voiceIndex = j; break; }
          }
        }
        selectedVoice = json.voices[voiceIndex].name;
        select.push({
          title: Lampa.Lang.translate('maniya_voice'),
          subtitle: selectedVoice,
          items: json.voices.map(function (voice, index) {
            return { title: voice.name, selected: index === voiceIndex, index: index };
          }),
          stype: 'voice'
        });
      }

      if (json && json.seasons && json.seasons.length) {
        seasonNumbers = json.seasons.map(function (season) { return season.number; });
        // SKAZ-MANIYA-058: копия опций сезонов для Z01-чипа «Сезон» (как filter_find.season).
        uiSeasons = json.seasons.map(function (season) {
          return { number: season.number, title: season.title || Lampa.Lang.translate('maniya_season') + ' ' + season.number };
        });
        var seasonIndex = 0;
        if (activeSeason !== null) {
          for (var i = 0; i < seasonNumbers.length; i++) {
            if (String(seasonNumbers[i]) === String(activeSeason)) { seasonIndex = i; break; }
          }
        }
        selectedSeason = json.seasons[seasonIndex].title || Lampa.Lang.translate('maniya_season') + ' ' + json.seasons[seasonIndex].number;
        select.push({
          title: Lampa.Lang.translate('maniya_season'),
          subtitle: selectedSeason,
          items: json.seasons.map(function (season, index) {
            return {
              title: season.title || Lampa.Lang.translate('maniya_season') + ' ' + season.number,
              selected: index === seasonIndex,
              index: index
            };
          }),
          stype: 'season'
        });
      }

      if (select.length) {
        // Сброс выбора — канонический reset-пункт (эталон E-Online select.push reset).
        select.push({
          title: Lampa.Lang.translate('maniya_reset'),
          reset: true
        });
        filter.set('filter', select);
        // Подпись текущего выбора на кнопке фильтра: «Озвучка: …, Сезон: …»
        // (эталон E-Online this.selected → filter.chosen('filter', select)).
        var labels = [];
        if (selectedVoice) labels.push(Lampa.Lang.translate('maniya_voice') + ': ' + selectedVoice);
        if (selectedSeason) labels.push(Lampa.Lang.translate('maniya_season') + ': ' + selectedSeason);
        filter.chosen('filter', labels);
      }
      // W3 (D5/D6): авто-предпочтения (озвучка по kind, последний сезон) применяются
      // на ПЕРВОМ открытии сериала на карточке — ТОЛЬКО в real-DOM (Z01): чипы
      // есть только там, а в vm-песочнице тестов Storage-заглушка без cache →
      // legacy-ветка строит нативный filter (строки выше) и не трогает это.
      if (Z01_UI_OK) this.applyPrefChoices();
    };

    this.reset = function () {
      network.clear();
      scroll.clear();
      scroll.reset();
      scroll.body().append(Lampa.Template.get('maniya_content_loading'));
    };

    /** Номер серии item'а (episode, либо series для провайдеров без episode). */
    function serialEpisodeOf(item) {
      var n = Number(item.episode);
      if (!isFinite(n) || n <= 0) n = Number(item.series);
      return isFinite(n) ? n : 0;
    }

    /**
     * Сезонные эпизоды TMDB для сериала (эталон Lampac Online/plugin.js
     * getEpisodes): `Lampa.Api.sources.tmdb.get('tv/{id}/season/{n}')`. Имена
     * приходят в языке Lampa пользователя (русский). Свой слой Lampa даёт кэш и
     * api_key — свой секрет не нужен. Ошибка/нет слоя/не сериал → пустой список
     * (названия остаются «как есть», где TMDB не смог — пускай как будет).
     */
    function getSeasonEpisodes(season, callback) {
      var movie = object.movie || {};
      var tmdb_id;
      if (movie.source && movie.source !== 'tmdb' && movie.source !== 'cub') tmdb_id = movie.tmdb_id;
      else tmdb_id = movie.id;
      tmdb_id = Number(tmdb_id);
      if (!isFinite(tmdb_id) || !movie.name) return callback([]);

      var key = tmdb_id + ':s' + season;
      if (seasonEpisodesCache[key]) return callback(seasonEpisodesCache[key]);
      if (!(Lampa.Api && Lampa.Api.sources && Lampa.Api.sources.tmdb && typeof Lampa.Api.sources.tmdb.get === 'function')) {
        seasonEpisodesCache[key] = [];
        return callback([]);
      }
      try {
        Lampa.Api.sources.tmdb.get('tv/' + tmdb_id + '/season/' + season, {}, function (data) {
          var episodes = (data && Array.isArray(data.episodes)) ? data.episodes : [];
          seasonEpisodesCache[key] = episodes;
          callback(episodes);
        }, function () {
          seasonEpisodesCache[key] = [];
          callback([]);
        });
      } catch (e) {
        seasonEpisodesCache[key] = [];
        callback([]);
      }
    }

    this.draw = function (items) {
      var self = this;
      // SKAZ-MANIYA-059 E1: карточка нарисована — фоновый живой re-probe пошёл.
      cardReady = true;
      this.startProbeTick();
      // W3 (D7): количество серий — для чипа «Переход» (>20 → рисуем).
      uiItemsCount = items.length;
      // SKAZ-MANIYA-043: 0 items (источник не отдал видео) — не стираем экран.
      // SKAZ на это показывает note + держит тулбар (можно сменить источник).
      if (!items.length) {
        return this.uiListEmpty(Lampa.Lang.translate('maniya_no_results'), Lampa.Lang.translate('maniya_switch_source'));
      }

      function render() {
        if (Z01_UI_OK) self.uiFrame();
        else scroll.clear();
        items.forEach(function (item, index) {
          // SKAZ-MANIYA-047: timeline/view + time ДО отрисовки — hero (uiPickResume,
          // «Продолжить», полоска, время) и карточка (полоска на постере, время)
          // читают эти поля. object.movie передаём аргументом (draw в скоупе
          // компонента видит `object`, модульная функция — нет).
          applyTimelineModel(item, object.movie);
          if (!item.title) {
            if (item.episode || item.series) {
              item.title = Lampa.Lang.translate('maniya_episode') + ' ' + (item.episode || index + 1);
            } else {
              // Фильм, серий нет — не рисуем «Серия N», что при отсутствии title
              // вводит пользователя в заблуждение. Показываем озвучку/качество/индекс.
              item.title = item.voice_name || bestQualityLabel(item) || String(index + 1);
            }
          } else if (item.episode && item.episode > 0) {
            // Сериал: реальное название серии от провайдера (Filmix episode.title) +
            // номер серии с ведущим нулём: «01 Моря и соль, Пламя» (задача FILMIX-003).
            item.title = ('0' + item.episode).slice(-2) + ' ' + item.title;
          }
          item.info = item.voice_name || bestQualityLabel(item) || sourceLabel(sources[activeSource]);
          item.time = item.time || '';
          item.quality_label = item.quality_label || '';
          item.qualities_html = qualityChips(item);
          item.poster = item.poster || moviePoster(object.movie);
          item.poster_block = item.poster
            ? '<img class="maniya-online-item__poster" src="' + item.poster + '" alt=""/>'
            : '';

          // SKAZ-like UI (T040, modern): карточки/hero/чипы строятся нашими z01-методами
          // (реальный браузер); в vm-песочнице тестов — прежний нативный путь ниже.
          if (Z01_UI_OK) {
            self.uiAppendItem(item, index);
            return;
          }

          var html = Lampa.Template.get('maniya_video_item', item);
          if (!item.qualities_html) html.find('.maniya-online-item__qualities').remove();
          if (item.poster) {
            // E-Online online-prestige__img (Online/plugin.js 1204-1236): onerror→img_broken,
            // onload→loaded, element.thumbnail = img.src — постер/миниатюра уходят в плеер.
            var posterEl = html.find('.maniya-online-item__poster');
            posterEl.on('error', function () {
              posterEl.attr('src', './img/img_broken.svg');
            });
            posterEl.on('load', function () {
              posterEl.addClass('maniya-online-item__poster--loaded');
            });
            item.thumbnail = item.poster;
          } else {
            html.find('.maniya-online-item__poster-block').remove();
          }
          html.on('hover:enter', function () {
            self.play(item);
          }).on('hover:focus', function (event) {
            last = event.target;
            scroll.update($(event.target), true);
          });

          scroll.append(html);
        });

        if (Z01_UI_OK) {
          self.uiHero(items);
          self.uiToolbar();
        }

        self.loading(false);
        Lampa.Controller.enable('content');
      }

      // TMDB-обогащение названий серий: реальные имена (русский) во всех сезонах,
      // где TMDB знает — перекрывают и английский episode.title Filmix, и фолбэк
      // «N серия». Где TMDB не знает имени / слой недоступен / фильм — оставляем
      // как пришло («где нет — пускай как будет»). Номер серии наносится отдельно
      // в render() выше, имя шоу не примешивается никогда.
      var seasonsMap = {};
      items.forEach(function (item) {
        if (item && serialEpisodeOf(item) > 0 && item.season) seasonsMap[item.season] = true;
      });
      var seasonList = Lampa.Arrays.getKeys(seasonsMap);
      if (!seasonList.length || !(object.movie && object.movie.name)) return render();

      var pending = seasonList.length;
      var episodesBySeason = {};
      // SKAZ-MANIYA-039 (T039 §6): TMDB-обогащение имён НЕ должно держать рендер.
      // Если на девайсе Lampa.Api.sources.tmdb.get зависнет (не вызовет ни success,
      // ни error), без дедлайна render() не выполнится никогда → items>0, но пустой
      // экран (наш девайсный симптом). Эталон (onlines.js draw): modern-ветка
      // рендерит uiDraw(items) сразу; classic — getEpisodes для имён, а не гейт.
      // Эдition-таймаут: если обогащение не завершилось — рендерим как есть.
      // (Защита сред без setTimeout — vm-песочница тестов: дедлайн не ставим,
      // полагаемся на fallback-callback самого getSeasonEpisodes.)
      var rendered = false;
      var finish = function () {
        if (rendered) return;
        rendered = true;
        render();
      };
      var enrichDeadline = (typeof setTimeout === 'function') ? setTimeout(finish, 2500) : null;
      seasonList.forEach(function (season) {
        getSeasonEpisodes(season, function (episodes) {
          if (rendered) return;
          episodesBySeason[season] = episodes || [];
          pending -= 1;
          if (pending > 0) return;
          if (enrichDeadline !== null) clearTimeout(enrichDeadline);
          items.forEach(function (item) {
            var n = serialEpisodeOf(item);
            if (!(n > 0)) return;
            var list = episodesBySeason[item.season];
            if (!list || !list.length) return;
            for (var e = 0; e < list.length; e++) {
              if (Number(list[e].episode_number) === n && list[e].name) {
                item.title = list[e].name;
                break;
              }
            }
          });
          finish();
        });
      });
    };

    this.play = function (item) {
      var self = this;

      // T052: тонкая call-серия/голос (maniya-thin://) — устройство само минтит
      // direct (С ип девайса), сервер НЕ минт (иначе wrapper+«долго»). Недолгий
      // Loading; провал/нет direct → как обычный maniya_nolink (фолбэк).
      if (item.method === 'call' && ThinSkaz.isThinCallUrl(item.url)) {
        Lampa.Loading.start();
        ThinSkaz.resolveCall(item, object.movie || {}, object).then(function (json) {
          Lampa.Loading.stop();
          if (!json) { Lampa.Noty.show(Lampa.Lang.translate('maniya_nolink')); return; }
          self.runPlayer(item, json);
        }, function () {
          Lampa.Loading.stop();
          Lampa.Noty.show(Lampa.Lang.translate('maniya_nolink'));
        });
        return;
      }

      // E-Online (Online/plugin.js display→getFileUrl→Player.play): НЕТ предплеерного
      // селектора. Играем дефолтное качество, карта quality уходит в нативный плеер →
      // выбор 1080p/720p/480p/360p внутри плеера. Регрессия «Script error.» устранена.
      if (item.method === 'call') {
        Lampa.Loading.start();
        requestJson(network, item.url, function (json) {
          Lampa.Loading.stop();
          self.runPlayer(item, json);
        }, function () {
          Lampa.Loading.stop();
          Lampa.Noty.show(Lampa.Lang.translate('maniya_nolink'));
        });
      } else {
        this.runPlayer(item, item);
      }
    };

    /** Селектор качества: Lampa.Select.show — ровно тот вызов, что рабочий E-Online/Online.plugin.js. */
    this.chooseQuality = function (item, entries) {
      var self = this;
      openQualitySelect(item, entries, function (sourceItem, stream) {
        self.runPlayer(sourceItem, stream);
      });
    };

    this.runPlayer = function (item, stream) {
      // E-Online toPlayElement + getFileUrl-merge (Online/plugin.js 615-727).
      var json = stream && typeof stream === 'object' ? stream : {};
      var play = {
        title: item.title,
        url: (json.url || item.url || '').trim(),
        quality: json.quality || item.quality,
        subtitles: json.subtitles || item.subtitles,
        segments: json.segments || item.segments,
        hls_manifest_timeout: json.hls_manifest_timeout || item.hls_manifest_timeout,
        headers: json.headers || item.headers,
        timeline: item.timeline,
        season: item.season,
        episode: item.episode,
        voice_name: item.voice_name,
        thumbnail: item.thumbnail,
        callback: item.mark,
        isonline: true
      };

      if (!play.url) return Lampa.Noty.show(Lampa.Lang.translate('maniya_nolink'));

      // primary or reserve → url + url_reserve; дефолтное качество из настроек Lampa.
      orUrlReserve(play);
      setDefaultQuality(play);
      // SKAZ-MANIYA-045: «сначала прямой CDN — если недоступно, через /proxy»:
      // direct-режим (T037, DIRECT_PLAYBACK) отдаёт исходный CDN-URL; если плееру
      // он недоступен (403/CORS/обрыв — видит только клиент), Lampa сам уходит на
      // url_reserve = наш /api/lampa/proxy (механика « or » E-Online). В обычном
      // прокси-режиме URL уже наш → reserve не добавляется (поведение как было).
      // T052: для device-bound wrapper'а кластера (`host/proxy/<token>` из thin-минта
      // с девайса) резерв наш /proxy на VPS = cross-IP 404 (T049) — ядовит, не ставим.
      var clusterWrapper = /\/proxy\//i.test(String(play.url || ''));
      if (!play.url_reserve && isDirectCdnUrl(play.url) && !clusterWrapper) {
        play.url_reserve = proxyUrlFor(play);
      }

      Lampa.Player.play(play);
      Lampa.Player.playlist([play]);
    };

    this.subscriptionRequired = function (message) {
      this.empty(message || Lampa.Lang.translate('maniya_subscription_required'));
    };

    this.empty = function (message) {
      uiPollStop();
      var html = Lampa.Template.get('maniya_empty', {
        title: Lampa.Lang.translate('title_maniya'),
        message: message || Lampa.Lang.translate('maniya_no_results')
      });
      scroll.clear();
      scroll.append(html);
      this.loading(false);
    };

    /** SKAZ-MANIYA-043: «источник пуст/ошибка» в Z01 — экран НЕ уничтожаем
     *  (SKAZ doesNotAnswer: note-строка + живой тулбар «ИСТОЧНИК»). Мёртвый
     *  активный источник → сообщение в списке + селектор для перехода на другой.
     *  Legacy (vm-песочницы) — прежний empty(). */
    this.uiListEmpty = function (message, hint) {
      var self = this;
      if (!Z01_UI_OK) return this.empty(message);
      uiPollStop();
      ui.open = '';
      // SKAZ-MANIYA-059 E2: «источник пуст/не отвечает» — если авто-switch разрешён,
      // планируем обратный отсчёт (как SKAZ doesNotAnswer); иначе прежний статичный hint.
      var plan = this.autoSwitchPlan();
      // SKAZ-MANIYA-044: карточка фильма НЕ пропадает на пустом источнике — hero
      // (арт+название+мета от object.movie, ▶ только при наличии видео) рисуем и
      // при 0 items (SKAZ uiHero строится от фильма, а не от items). uiFrame()
      // ПЕРВЫМ (он чистит heroBox), потом hero — иначе рамка стирает карточку.
      this.uiFrame();
      this.uiHero([]);
      this.uiToolbar();
      var html = $('<div class="z01-note"></div>');
      html.append($('<div class="z01-note__title"></div>').text(message));
      if (plan) {
        var line = $('<div class="z01-note__switch"></div>');
        html.append(line);
        ui.list.append(html);
        this.autoSwitchTick(line, plan);
      } else {
        if (hint) html.append($('<div class="z01-note__hint"></div>').text(hint));
        ui.list.append(html);
      }
      this.loading(false);
      Lampa.Controller.enable('content');
    };

    this.back = function () { Lampa.Activity.backward(); };
    this.pause = function () {};
    this.stop = function () {};
    this.destroy = function () {
      uiPollStop();
      network.clear();
      files.destroy();
      scroll.destroy();
      // T052 STABILITY-004: закрыть ws-сессии, сбросить пинги/таймеры/кэши
      // (иначе на следующей карточке висят старые сессии и orphan-промисы).
      ThinSkaz.destroyAll();
      // SKAZ-MANIYA-059 STABILITY-004: E1/E2 — один глобальный interval + тикер
      // отсчёта, чистим оба, висящие пробы обесцениваем.
      if (liveProbeTimer) { clearInterval(liveProbeTimer); liveProbeTimer = null; }
      liveAutoSwitchCancel();
      liveProbeBusy = false;
      liveTickSeq += 1;
    };
  }

  function addTemplates() {
    Lampa.Template.add('maniya_css', '<style>' +
      '.maniya-online-item{position:relative;border-radius:.3em;background:rgba(0,0,0,.3);padding:1.2em;margin-bottom:1em;display:flex;gap:1em;align-items:flex-start}' +
      '.maniya-online-item__poster-block{flex:0 0 8.5em;border-radius:.4em;overflow:hidden;background:rgba(0,0,0,.25);align-self:stretch;min-height:4.5em}' +
      '.maniya-online-item__poster{display:block;width:100%;height:100%;object-fit:cover}' +
      '.maniya-online-item__body{flex:1 1 auto;min-width:0}' +
      '.maniya-online-item__title{font-size:1.5em}.maniya-online-item__info{margin-top:.5em;opacity:.75}' +
      '.maniya-online-item__qualities{display:flex;flex-wrap:wrap;gap:.4em .5em;margin-top:.55em}' +
      '.maniya-online-item__quality{padding:.12em .65em;border-radius:2em;background:rgba(255,178,62,.16);color:#ffd98f;font-size:.85em;letter-spacing:.02em;line-height:1.35;white-space:nowrap}' +
      '.maniya-online-item.focus::after{content:"";position:absolute;top:-.45em;left:-.45em;right:-.45em;bottom:-.45em;border:.25em solid #fff;border-radius:.6em;pointer-events:none}' +
      '.maniya-online-empty{padding:1.5em;line-height:1.4}.maniya-online-empty__title{font-size:1.8em;margin-bottom:.5em}.maniya-online-empty__message{font-size:1.15em;opacity:.8}' +
      // Мобильная карточка (≤640/≤420): компактная высота как E-Online.
      // Root cause «растянутого» постера: базовый .maniya-online-item__poster-block
      // имеет align-self:stretch + min-height → высота блока = высоте тела карточки
      // (длинный Filmix-заголовок + info + 4 бейджа качества → тело высокое → постер
      // тянется по вертикали). На мобильном отменяем stretch и используем модель
      // Lampac online-prestige__img (plugin.js 2012-2044): фикс. ширина + min-height,
      // картинка absolute cover внутри — ratio блока стабилен, контент его не раздувает.
      // Базовые правила (TV) НЕ тронуты — изменения только в media-запросах.
      '@media (max-width:640px){.maniya-online-item{padding:1em;margin-bottom:.8em;gap:.7em}.maniya-online-item__poster-block{flex:0 0 6em;align-self:flex-start;min-height:5.1em;position:relative}.maniya-online-item__poster{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}.maniya-online-item__title{font-size:1.15em;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}.maniya-online-item__info{margin-top:.4em;font-size:.9em}}' +
      '@media (max-width:420px){.maniya-online-item{padding:.85em;margin-bottom:.6em;gap:.6em}.maniya-online-item__poster-block{flex-basis:5em;min-height:4.2em}.maniya-online-item__title{font-size:1.05em}.maniya-online-item__quality{font-size:.8em}.maniya-online-item__qualities{margin-top:.4em}}' +
      // Кнопка M-ONLINE = ВАРИАНТ СТАНДАРТНОЙ Lampa action-кнопки (.full-start__button):
      // ровно та же геометрия — height 2.8em, border-radius 1em, padding 0 1em,
      // margin-right .75em, font-size 1.3em, flex выравнивание по центру (см. _app.css).
      // Отличается только цветом (оранжевый) и более широким лейблом; глиф «M» удалён.
      '.maniya-online-button{position:relative;height:2.8em;padding:0 1em;width:auto;min-width:0;margin-right:.75em;border-radius:1em;background:linear-gradient(180deg,#ffd98f 0%,#ffb23e 45%,#f58a1b 100%);color:#3a1d02;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 .1em .4em rgba(0,0,0,.3),inset 0 .08em .2em rgba(255,255,255,.45);flex:0 0 auto;font-size:1.3em}' +
      '.maniya-online-button .maniya-online-button__label{font-weight:800;letter-spacing:.04em;text-transform:uppercase;line-height:1;white-space:nowrap}' +
      '.maniya-online-button.focus,.maniya-online-button:hover{background:linear-gradient(180deg,#ffe0a8 0%,#ffc15c 45%,#f79a2e 100%);color:#2a1500;box-shadow:0 0 0 .22em rgba(255,255,255,.7),0 .18em .6em rgba(0,0,0,.4);outline:none}' +
      // Lampa прячет подписи не-фокусных кнопок (.full-start__button span display:none),
      // но наш лейбл — сам текст M-ONLINE, его нужно держать видимым всегда.
      '.full-start-new__buttons .maniya-online-button .maniya-online-button__label,.full-start__buttons .maniya-online-button .maniya-online-button__label{display:block!important;margin-top:0}' +
      // Badge статуса подписки «M-Online». Нативный компонент, flex + wrap:
      // на широком TV — одной строкой, на мобильном переносится на две.
      '.maniya-status{display:flex;flex-wrap:wrap;align-items:center;gap:.5em .7em;margin:.35em 0 1em;padding:.55em .8em;border-radius:.55em;background:rgba(0,0,0,.28);line-height:1.25}' +
      '.maniya-status__badge{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;padding:.2em .65em;border-radius:2em;background:linear-gradient(135deg,#ffd98f 0%,#f58a1b 100%);color:#3a1d02;font-weight:700;letter-spacing:.03em;text-transform:uppercase}' +
      '.maniya-status__text{color:#fff;opacity:.92;white-space:normal}' +
      '.maniya-status--expired{background:rgba(138,32,44,.4)}.maniya-status--expired .maniya-status__badge{background:#d94b58;color:#fff}' +
      '@media (max-width:620px){.maniya-status{font-size:.92em;gap:.4em .55em}}' +
      '@media (max-width:420px){.maniya-status{padding:.5em .65em;margin:.25em 0 .8em}}' +
      // ── SKAZ-like UI (T040): те же классы/раскладка, что в onlines.js Z01UI ──
      '.z01{display:block;width:100%;box-sizing:border-box;padding:0 0 3em .75em}' +
      '.z01-hero{position:relative;overflow:hidden;border-radius:1.2em;margin-bottom:1.7em;background:rgba(255,255,255,.06);min-height:13em;margin-left:-.75em}' +
      '.z01-hero__bg{position:absolute;top:0;left:0;right:0;bottom:0}' +
      '.z01-hero__bg img{display:block;width:100%;height:100%;object-fit:cover;opacity:0;-webkit-transition:opacity .35s;transition:opacity .35s}' +
      '.z01-hero__bg--loaded img{opacity:1}' +
      '.z01-hero__shade{position:absolute;top:0;left:0;right:0;bottom:0;background:-webkit-linear-gradient(left,rgba(10,11,17,.97) 0%,rgba(10,11,17,.9) 36%,rgba(10,11,17,.45) 68%,rgba(10,11,17,.1) 100%);background:linear-gradient(90deg,rgba(10,11,17,.97) 0%,rgba(10,11,17,.9) 36%,rgba(10,11,17,.45) 68%,rgba(10,11,17,.1) 100%)}' +
      '.z01-hero__body{position:relative;padding:2.2em;max-width:64%}' +
      '.z01-hero__title{font-size:2.3em;font-weight:600;line-height:1.15;margin-bottom:.35em;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}' +
      '.z01-hero__meta{display:flex;flex-wrap:wrap;align-items:center;font-size:1.1em;margin-bottom:.7em}' +
      '.z01-hero__meta>*{margin:0 .7em .3em 0;opacity:.8}' +
      '.z01-hero__meta>.z01-badge{opacity:1}' +
      '.z01-hero__descr{font-size:1.05em;line-height:1.45;opacity:.65;margin-bottom:1.2em;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}' +
      '.z01-hero__actions{display:flex;flex-wrap:wrap;align-items:center}' +
      '.z01-hero__hint{font-size:1em;line-height:1.5;opacity:.55;margin:0 0 0 1.3em;max-width:24em;padding:.1em .15em;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}' +
      '.z01-hero__progress{position:relative;height:.3em;width:16em;max-width:100%;border-radius:.3em;background:rgba(255,255,255,.2);margin-top:.9em;overflow:hidden}' +
      '.z01-hero__progress .time-line{display:block !important;height:100%;margin:0;background:none}' +
      '.z01-hero__progress .time-line>div{height:100%;background:#fff}' +
      '.z01-hero__season{font-size:.95em;opacity:.55;margin-top:.8em}' +
      '.z01-badge{display:inline-block;padding:.2em .55em;border-radius:.35em;background:rgba(255,255,255,.18);font-size:.78em;font-weight:600;letter-spacing:.04em;line-height:1.4}' +
      '.z01-btn{position:relative;display:flex;align-items:center;padding:.7em 1.5em;border-radius:2.4em;background:rgba(255,255,255,.12);font-size:1.15em;white-space:nowrap;margin:0 .8em .5em 0}' +
      '.z01-btn>svg{width:1.15em;height:1.15em;margin-right:.6em;flex-shrink:0}' +
      '.z01-btn.focus{background:#fff;color:#000}' +
      '.z01-btn--main{background:rgba(255,255,255,.82);color:#000}' +
      '.z01-btn--main.focus{background:#fff;box-shadow:0 .25em .9em rgba(0,0,0,.45)}' +
      '.z01-section__title{display:flex;align-items:center;font-size:.95em;letter-spacing:.12em;text-transform:uppercase;opacity:.5;margin-bottom:.7em}' +
      '.z01-section__body{display:flex;flex-wrap:wrap;align-items:center}' +
      '.z01-toolbar{display:flex;flex-wrap:wrap;align-items:center;margin-bottom:1em}' +
      '.z01-toolbar__label{font-size:.95em;letter-spacing:.12em;text-transform:uppercase;opacity:.45;margin:0 .9em .7em 0}' +
      '.z01-chip{position:relative;display:flex;align-items:center;padding:.55em 1.1em;border-radius:2em;background:rgba(255,255,255,.07);margin:0 .7em .7em 0;font-size:1.05em;white-space:nowrap;max-width:24em}' +
      '.z01-chip.focus{background:#fff;color:#000}' +
      '.z01-chip--active{background:rgba(255,255,255,.16);box-shadow:inset 0 0 0 .1em rgba(255,255,255,.5)}' +
      '.z01-chip__badge{font-size:.7em;font-weight:600;padding:.2em .45em;border-radius:.35em;background:rgba(255,255,255,.2);margin-right:.6em;line-height:1.4}' +
      '.z01-chip.focus .z01-chip__badge{background:rgba(0,0,0,.12)}' +
      '.z01-chip--more{opacity:.75}' +
      '.z01-chip__label{line-height:1.5;padding:.05em .1em;overflow:hidden;text-overflow:ellipsis}' +
      '.z01-chip>svg{width:1em;height:1em;flex-shrink:0}' +
      '.z01-chip__label+svg{margin-left:.6em;opacity:.6}' +
      '.z01-chip>svg:first-child{margin-right:.55em;opacity:.7}' +
      '.z01-chip--source{font-size:1.15em;padding:.5em 1.1em}' +
      '.z01-chip--ghost{opacity:.5}' +
      '.z01-chip__dot{width:.5em;height:.5em;border-radius:50%;margin-left:.6em;flex-shrink:0;background:#4ade80}' +
      '.z01-drop{display:flex;flex-wrap:wrap;align-items:center;padding:.3em 0 0 1em;margin:0 0 .7em .3em;box-shadow:inset .16em 0 0 rgba(255,255,255,.18)}' +
      '.z01-card{position:relative;display:flex;align-items:center;padding:.7em;border-radius:.9em;background:rgba(255,255,255,.05);margin-bottom:.7em}' +
      '.z01-card.focus{background:#fff;color:#000}' +
      '.z01-card__thumb{position:relative;width:12em;height:6.75em;flex-shrink:0;border-radius:.5em;overflow:hidden;background:rgba(0,0,0,.35)}' +
      '.z01-card__thumb img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;opacity:0;-webkit-transition:opacity .3s;transition:opacity .3s}' +
      '.z01-card__thumb--loaded img{opacity:1}' +
      '.z01-card__num{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;font-size:1.7em;font-weight:600;color:#fff;text-shadow:0 .05em .2em rgba(0,0,0,.7)}' +
      '.z01-card__thumb--loaded .z01-card__num{justify-content:flex-end;align-items:flex-end;font-size:1.1em;padding:0 .5em .35em 0}' +
      '.z01-card__viewed{position:absolute;top:.5em;left:.5em;width:.5em;height:.5em;border-radius:50%;background:#fff;opacity:.85;box-shadow:0 0 0 .16em rgba(0,0,0,.4)}' +
      '.z01-card__line{position:absolute;left:0;right:0;bottom:0;height:.28em;background:rgba(0,0,0,.5)}' +
      '.z01-card__line .time-line{display:block !important;height:100%;margin:0;background:none}' +
      '.z01-card__line .time-line>div{height:100%;background:#fff}' +
      '.z01-card__body{flex:1 1 auto;padding:0 1.2em;min-width:1em;overflow:hidden}' +
      '.z01-card__title{font-size:1.25em;line-height:1.4;margin-bottom:.3em;padding-bottom:.05em;overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}' +
      '.z01-card__meta{font-size:.95em;line-height:1.45;opacity:.6;padding-bottom:.05em;overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}' +
      '.z01-card__meta .z01-dot{margin:0 .5em;opacity:.6}' +
      '.z01-card__side{flex-shrink:0;text-align:right;padding-right:.7em}' +
      '.z01-card__time{font-size:.95em;opacity:.6;margin-top:.4em}' +
      '.z01-card--file .z01-card__thumb{width:12em;height:6.75em}' +
      '.z01-card.focus .z01-card__line .time-line>div{background:#000}' +
      // ── Загрузочная панель опроса (SKAZ onlines.js uiLoadingPanel: .z01-loading + .z01-skeleton) ──
      // SKAZ-MANIYA-044: панель опроса — boxed как у SKAZ (.skaz-loading):
      // padding 1.6em 1.8em, radius 1em, bg rgba(255,255,255,.05), margin-bottom
      // 1.2em; title 1.4em mb .35; text 1.05em op .6 mb 1em; bar .3em bg .14,
      // bar>div #fff (переход width .4s). Тот же «серый тон», что у карточек.
      '.z01-loading{padding:1.6em 1.8em;-webkit-border-radius:1em;border-radius:1em;background:rgba(255,255,255,.05);margin-bottom:1.2em}' +
      '.z01-loading__title{font-size:1.4em;margin-bottom:.35em;color:rgba(255,255,255,.85)}' +
      '.z01-loading__text{font-size:1.05em;opacity:.6;margin-bottom:1em}' +
      '.z01-loading__bar{position:relative;height:.3em;-webkit-border-radius:.3em;border-radius:.3em;background:rgba(255,255,255,.14);overflow:hidden}' +
      '.z01-loading__bar>div{height:100%;width:0;background:#fff;-webkit-transition:width .4s;transition:width .4s}' +
      // SKAZ-MANIYA-043: note «источник пуст» — экран жив, тулбар остаётся.
      '.z01-note{padding:1.2em .2em 2.2em;line-height:1.55}' +
      '.z01-note__title{font-size:1.05em;color:rgba(255,255,255,.8)}' +
      '.z01-note__hint{margin-top:.45em;font-size:.95em;opacity:.55}' +
      '.z01-note__switch{margin-top:.45em;font-size:1em;color:#ffd98f}' +
      '.z01-skeleton{padding:.4em 0}' +
      '.z01-skeleton__row{display:flex;align-items:center;padding:.7em 0}' +
      '.z01-skeleton__thumb{width:12em;height:6.75em;border-radius:.5em;background:rgba(255,255,255,.07);flex-shrink:0;-webkit-animation:z01skeleton 1.2s ease-in-out infinite;animation:z01skeleton 1.2s ease-in-out infinite}' +
      '.z01-skeleton__body{flex:1 1 auto;padding:0 0 0 1.2em}' +
      '.z01-skeleton__line{height:1em;border-radius:.3em;background:rgba(255,255,255,.07);margin-bottom:.8em;-webkit-animation:z01skeleton 1.2s ease-in-out infinite;animation:z01skeleton 1.2s ease-in-out infinite}' +
      '.z01-skeleton__line--short{width:60%}' +
      '@-webkit-keyframes z01skeleton{0%,100%{opacity:1}50%{opacity:.4}}@keyframes z01skeleton{0%,100%{opacity:1}50%{opacity:.4}}' +
      '@media screen and (max-width:580px){' +
      '.z01-hero__body{max-width:100%;padding:1.3em}' +
      '.z01-hero__title{font-size:1.7em}' +
      '.z01-hero__descr{display:none}' +
      '.z01-hero__shade{background:-webkit-linear-gradient(top,rgba(10,11,17,.55) 0%,rgba(10,11,17,.94) 60%);background:linear-gradient(180deg,rgba(10,11,17,.55) 0%,rgba(10,11,17,.94) 60%)}' +
      '.z01-card__thumb{width:8em;height:4.5em}' +
      '.z01-card--file .z01-card__thumb{width:8em;height:4.5em}' +
      '.z01-skeleton__thumb{width:8em;height:4.5em}' +
      // SKAZ-MANIYA-047: справа на телефоне КАЧЕСТВО (FHD/HD/4K) + время раньше
      // прятались целиком (display:none side) — жалоба юзера. Теперь компактная
      // колонка остаётся, бейдж и время читаются на любой ширине.
      '.z01-card__side{flex-shrink:0;text-align:right;padding-right:.4em}' +
      '.z01-card__side .z01-badge{font-size:.64em}' +
      '.z01-card__time{font-size:.82em;margin-top:.25em}' +
      '.z01-card__body{padding:0 .7em}' +
      '.z01-chip{max-width:16em}' +
      '}' +
    '</style>');
    $('body').append(Lampa.Template.get('maniya_css', {}, true));
    Lampa.Template.add('maniya_content_loading', '<div class="online-empty"><div class="broadcast__scan"><div></div></div></div>');
    Lampa.Template.add('maniya_video_item', '<div class="maniya-online-item selector"><div class="maniya-online-item__poster-block">{poster_block}</div><div class="maniya-online-item__body"><div class="maniya-online-item__title">{title}</div><div class="maniya-online-item__info">{info}</div><div class="maniya-online-item__qualities">{qualities_html}</div></div></div>');
    Lampa.Template.add('maniya_empty', '<div class="maniya-online-empty"><div class="maniya-online-empty__title">{title}</div><div class="maniya-online-empty__message">{message}</div></div>');
  }

  function addLang() {
    Lampa.Lang.add({
      title_maniya: { ru: 'Maniya Online — STAGING', en: 'Maniya Online — STAGING' },
      maniya_watch: { ru: 'Смотреть в Maniya Online', en: 'Watch in Maniya Online' },
      maniya_source: { ru: 'Источник', en: 'Source' },
      maniya_season: { ru: 'Сезон', en: 'Season' },
      maniya_voice: { ru: 'Озвучка', en: 'Voice' },
      maniya_reset: { ru: 'Сброс', en: 'Reset' },
      maniya_jump: { ru: 'Переход', en: 'Jump' },
      maniya_quality: { ru: 'Выбор качества', en: 'Select quality' },
      maniya_watch_quality: { ru: 'Смотреть', en: 'Watch' },
      maniya_episode: { ru: 'Серия', en: 'Episode' },
      maniya_no_results: { ru: 'Видео не найдено', en: 'Video not found' },
      // T052: тонкая lite-ветка не смогла (нет bootstrap/CORS/8с-бюджет/wrapper) —
      // юзер видит Noty и старый путь /videos+/proxy работает дальше сам.
      maniya_thin_fallback: { ru: 'Мгновенный источник недоступен — обычная загрузка', en: 'Fast source unavailable — normal loading' },
      maniya_nolink: { ru: 'Не удалось получить ссылку', en: 'Failed to fetch link' },
      maniya_empty_sources: { ru: 'Нет доступных источников', en: 'No available sources' },
      maniya_more_sources: { ru: 'Ещё {count}', en: 'More {count}' },
      maniya_items_count: { ru: 'Вариантов: {n}', en: 'Items: {n}' },
      maniya_continue: { ru: 'Продолжить просмотр', en: 'Continue watching' },
      maniya_left: { ru: 'Осталось', en: 'Left' },
      maniya_server_error: { ru: 'Сервер Maniya Online не отвечает', en: 'Maniya Online server is not responding' },
      maniya_polling_start: { ru: 'Опрашиваем источники', en: 'Polling sources' },
      maniya_polling_found: { ru: 'Найдено источников: {n}', en: 'Sources found: {n}' },
      maniya_polling_slow: { ru: 'отвечают медленно', en: 'responding slowly' },
      maniya_sec: { ru: 'с', en: 's' },
      maniya_switch_source: { ru: 'На текущем источнике нет этого фильма — смените его в списке выше', en: 'No such video on this source — switch it from the list above' },
      // SKAZ-MANIYA-059 E2: строка авто-переключения мёртвого источника (doesNotAnswer).
      maniya_auto_switch: { ru: 'Сменим источник автоматически через {sec}с…', en: 'Auto-switching source in {sec}s…' },
      maniya_subscription_required: { ru: 'Нужна активная подписка Maniya Online', en: 'Active Maniya Online subscription is required' },
      maniya_subscription_error: { ru: 'Не удалось проверить подписку Maniya Online', en: 'Failed to check Maniya Online subscription' }
    });
  }

  function openOnline(movie) {
    Lampa.Activity.push({
      url: '',
      title: Lampa.Lang.translate('title_maniya'),
      component: COMPONENT,
      search: movie.title || movie.name,
      movie: movie,
      page: 1
    });
  }

  // Внутренности кнопки M-ONLINE: ТОЛЬКО текст (без глифа «M»/SVG — он удалён по
  // решению). Геометрия задана CSS `.maniya-online-button` (как у соседних
  // action-кнопок Lampa: height 2.8em, radius 1em, padding 0 1em, margin-right .75em).
  function maniyaButtonPart() {
    return '<span class="maniya-online-button__label">M-ONLINE</span>';
  }

  // === Элемент UI #2 (ELEMENT #2): ACTION-КНОПКА «M» в панели действий кадра ===
  // Требование: НЕ создавать новую кнопку поверх существующей, НЕ overlay, НЕ прятать
  // старую. Изменить СУЩЕСТВУЮЩУЮ первую кнопку (ту, что СЛЕВА от Play в ряду
  // `.full-start-new__buttons`: по референсу `[M] [▶] [🔖] […] [☆]`).
  // Сохраняем сам элемент, его классы/атрибуты(data-action) и обработчик клика —
  // меняем только визуальное содержимое. Если слева от Play кнопки нет (Play «первый»),
  // добавляем СВОЮ «М» первой (приятно, стоит на её месте).
  function addButton(event) {
    if (!event || !event.render) return;
    var root = event.render;
    var row = (root && root.length) ? root.find('.full-start-new__buttons, .fullstart__buttons').first() : $();
    var play = (row && row.length) ? row.find('.button--play, .full-start__play, [data-action="play"]').first() : $();

    function inButton(el) { return el && el.is && (el.is('button, .btn, [data-action]') || el.hasClass('full-button') || el.hasClass('full-start__button') || el.hasClass('full-start-new__button')); }

    var target = null;

    if (play && play.length) {
      // Соседняя (идущая до Play) кнопка = «слева от Play».
      var before = play.prev('.full-button, .full-start__button, .full-start-new__button, button, [data-action]');
      if (before && before.length && inButton(before)) target = before.first();
    }

    if (!target || !target.length) {
      // Play — первая в ряду: слева ничего нет. Тогда вставляем СВОЮ кнопку «М»
      // как первую (она и есть «кнопка слева от Play»).
      var button = $(
        '<div class="full-button selector view--online maniya-online-button" title="Maniya Online" data-action="maniya-source">' +
          maniyaButtonPart() +
        '</div>'
      );
      button = $(Lampa.Lang.translate(button.prop('outerHTML')));
      button.on('hover:enter', function () { openOnline(event.movie); });

      if (play && play.length) play.before(button);
      else if (row && row.length) row.prepend(button);
      else if (root && root.length) root.find('.full-start__button, .full-start-new__button').first().before(button);
      return;
    }

    // Уже оформлена — не трогаем.
    if (target.hasClass('maniya-online-button')) return;

    // Превращаем существующую кнопку в «M» — меняем ТОЛЬКО содержимое/декорации,
    // не сам элемент (классы full-button/бандж, data-action и click остаются).
    target.addClass('maniya-online-button');
    target.attr('title', 'Maniya Online');
    target.html(maniyaButtonPart());
  }

  // Badge статуса подписки «M-Online» на странице фильма/сериала.
  // Данные — из существующего /subscription/check (authorized/active/subscription_text),
  // ничего не хардкодим. Неавторизованный пользователь — badge не показываем.
  function addStatusBadge(event) {
    if (!event || !event.render) return;
    var root = event.render;
    if (root.find && root.find('.maniya-status').length) return;

    var network = new Lampa.Reguest();
    // tz = getTimezoneOffset() (UTC − local, минуты) — бэкенд считает остаток
    // дней по календарю пользователя, а не по UTC (иначе у полуночи теряется день).
    var statusUrl = trimSlash(MANIYA_API_BASE) + '/subscription/check?tz=' + new Date().getTimezoneOffset();
    requestJson(network, statusUrl, function (json) {
      // Неавторизован / подписка не известна — не рисуем ничего (без undefined/NaN).
      if (!json || json.authorized === false || !json.subscription_text) return;

      var badge = $(
        '<div class="maniya-status" role="status">' +
          '<span class="maniya-status__badge">M-Online</span>' +
          '<span class="maniya-status__text"></span>' +
        '</div>'
      );
      badge.find('.maniya-status__text').text(json.subscription_text);
      if (json.active === false) badge.addClass('maniya-status--expired');

      // Над рядом action-кнопок страницы фильма: [M-Online] … <кнопки>.
      // Встраиваем ПЕРЕД рядом кнопок (не внутрь), чтобы не ломать focus/раскладку.
      var row = (root && root.find) ? root.find('.full-start-new__buttons, .fullstart__buttons').first() : $();
      if (row && row.length) row.before(badge);
      else if (root && root.append) root.prepend(badge);
    }, function () {
      // Ошибка сети — просто не показываем badge, страница не ломается.
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SKAZ-MANIYA-052 — ТОНКИЙ КЛИЕНТ (thin client).
  //
  // Минт skaz-плейлистов С VPS даёт `skaz.tv/proxy/<token>` (IP-bound wrapper →
  // «долго» через наш /api/lampa/proxy). Эмуляция E-Online на устройстве: плагин
  // сам проходит lite-цепочку с IP девайса + живой ws-сессией → нода отдаёт
  // direct CDN (vimstream/vkvideo), играет на полной скорости.
  //
  // Аддитивный fast-path: работает ТОЛЬКО для источника с `thin:true` (модель,
  // allowlist SKAZ_THIN_MODULES) И когда bootstrap `enabled`. Вся остальная
  // логика (legacy /videos + /proxy, UI, сериальные сезоны) — в точности как
  // раньше. Любой провал (нет bootstrap / CORS / 8с-бюджет / wrapper в ответе /
  // N-е источники gated off) → автоматический фолбэк: Noty + старый путь.
  // Kill-switch: Lampa.Storage `maniya_thin_off`=1 (без переустановки).
  // Креды (account_email/uid) живут ТОЛЬКО в памяти (TTL из bootstrap), в
  // Storage/localStorage НЕ пишутся. Хосты — только из bootstrap (SSRF-гигиена).
  //
  // Порт: server/src/providers/skaz/{SkazClient,SkazNormalizer,SkazRchClient}.js
  // ═══════════════════════════════════════════════════════════════════════════
  var ThinSkaz = (function () {
    'use strict';

    var BOOTSTRAP_PATH = '/api/lampa/thin/bootstrap';
    var CALL_SCHEME = 'maniya-thin://';
    var CACHE_TTL_MS = 5 * 60 * 1000; // зеркало NAV_CACHE_TTL_MS сервера
    var CACHE_MAX = 512;
    var PING_MS = 50 * 1000; // SKAZ_RCH_KEEPALIVE_MS
    var DEFAULT_BUDGET_MS = 8000;
    var MINT_BUDGET_MS = 2500;
    var BOOTSTRAP_BUDGET_MS = 5000;

    var bootstrap = null;
    var bootstrapPromise = null;
    var flows = {};
    var sessions = {};
    var okKey = '';
    var NO = Promise.resolve(null);

    function log() {
      if (!(typeof window !== 'undefined' && window.MANIYA_THIN_TRACE)) return;
      try {
        var args = Array.prototype.slice.call(arguments);
        args[0] = '[thin] ' + args[0];
        if (window.console && typeof window.console.log === 'function') {
          window.console.log.apply(window.console, args);
        }
      } catch (e) {}
    }

    /** Маска URL для трейса: host + pathname, БЕЗ query (в нём креды/токены). */
    function maskUrl(u) {
      try {
        var parsed = new URL(String(u));
        return parsed.protocol + '//' + parsed.host + parsed.pathname;
      } catch (e) { return '(bad-url)'; }
    }

    function reEscape(text) {
      return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function paramValue(url, key) {
      if (!url) return null;
      var match = String(url).match(new RegExp('[?&]' + reEscape(key) + '=([^&#]+)'));
      return match ? decodeURIComponent(match[1]) : null;
    }

    function paramNumber(url, key) {
      var value = paramValue(url, key);
      if (value == null) return null;
      var num = parseInt(value, 10);
      return isFinite(num) ? num : null;
    }

    function setParam(url, key, value) {
      try {
        var parsed = new URL(url);
        parsed.searchParams.set(key, String(value));
        return parsed.toString();
      } catch (e) { return url; }
    }

    function bareHost(host) {
      return String(host || '').replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }

    /** ws-пара lite-хоста (lite http(s) → ws(s); при наличии — явный ws_host). */
    function wsUrlFor(lite, wsFallback) {
      if (wsFallback && /^wss?:\/\//i.test(wsFallback)) return wsFallback;
      try {
        var parsed = new URL(lite);
        var w = parsed.protocol === 'https:' ? 'wss://' : 'ws://';
        return w + parsed.host;
      } catch (e) { return wsFallback || ''; }
    }

    /** Разбить `primary or reserve` (Lampac / `%20or%20`), как splitOrUrl сервера. */
    function splitOr(value) {
      return String(value || '').split(/\s+or\s+|\s*%20or%20\s*/gi)
        .map(function (u) { return String(u).trim(); })
        .filter(Boolean);
    }

    function isThinCallUrl(url) {
      return String(url || '').indexOf(CALL_SCHEME) === 0;
    }

    /** nws_id: 32 hex (зеркало randomNwsId SkazRchClient; match Lampa.uid(32)). */
    function randomNwsId() {
      var bytes = new Uint8Array(16);
      if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
      } else {
        for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      }
      var out = '';
      for (var j = 0; j < bytes.length; j++) out += (bytes[j] < 16 ? '0' : '') + bytes[j].toString(16);
      return out;
    }

    // ── ws-сессии (зеркало SkazRchClient: Connected → RchRegistry → ack, ping) ──
    function openSession(wsUrl) {
      if (!wsUrl) return null;
      var host = bareHost(wsUrl);
      if (sessions[host] && !sessions[host].closed) return sessions[host];
      if (typeof WebSocket !== 'function') return null;
      var nwsId = randomNwsId();
      var target;
      try {
        var parsed = new URL(wsUrl);
        var scheme = parsed.protocol === 'wss:' ? 'wss:' : 'ws:';
        target = new URL(scheme + '//' + parsed.host + '/nws');
        target.searchParams.set('id', nwsId);
        target.searchParams.set('ver', '1');
      } catch (e) {
        log('session: bad ws url');
        return null;
      }
      var session = { host: host, nwsId: nwsId, ws: null, connId: null, ready: false, ping: null, closed: false };
      try {
        session.ws = new WebSocket(target.toString());
      } catch (e) {
        log('session: open failed');
        return null;
      }
      sessions[host] = session;
      if (session.ws) {
        session.ws.addEventListener('message', function (ev) {
          var data = (ev && ev.data != null) ? String(ev.data) : '';
          if (data.trim() === 'pong') return;
          var msg = null;
          try { msg = JSON.parse(data); } catch (e) {}
          if (!msg || typeof msg !== 'object') return;
          if (msg.method === 'Connected') {
            session.connId = String((msg.args && msg.args[0]) || '').trim() || nwsId;
            try {
              session.ws.send(JSON.stringify({ method: 'RchRegistry', args: [{ host: host, rchtype: 'apk', apkVersion: 0, player: null }] }));
            } catch (e) {}
          } else if (msg.method === 'RchRegistry') {
            if (!session.ready) {
              session.ready = true; log('session: ack', host);
              if (session._onReady) {
                var waiters = session._onReady; session._onReady = [];
                for (var w = 0; w < waiters.length; w++) { try { waiters[w](); } catch (e) {} }
              }
            }
          }
        });
        session.ws.addEventListener('close', function () { teardownSession(session); });
        session.ws.addEventListener('error', function () {});
        session.ws.addEventListener('open', function () {
          if (session.ping === null) {
            session.ping = setInterval(function () {
              if (session.ws && session.ws.readyState === 1) {
                try { session.ws.send('ping'); } catch (e) {}
              }
            }, PING_MS);
          }
        });
      }
      log('session: open', wsUrl);
      return session;
    }

    function teardownSession(session) {
      if (!session || session.closed) return;
      session.closed = true;
      if (session.ping !== null) { clearInterval(session.ping); session.ping = null; }
      if (session._onReady) { var wsDone = session._onReady; session._onReady = []; for (var d = 0; d < wsDone.length; d++) { try { wsDone[d](); } catch (e) {} } }
      if (sessions[session.host] === session) sessions[session.host] = undefined;
    }

    /**
     * Дождаться ack сессии (RchRegistry) перед минтом. Гейт: ждём ТОЛЬКО если
     * ws реально открыт (readyState 1) — на девайсе так; в vm-тестах фейк-ws
     * не открыт → мгновенный `null` (поведение прежнее). По бюджету/провалуй/закрытию
     * возвращаем `null` и минт идёт как раньше (первый play может ретраиться —
     * безопасно). Т052: девайс минтит до ack → токен «тёплый» только пост-ack →
     * первый play умирал с "play interrupted", повторный (после ack) заводился.
     */
    function whenReady(session, ms) {
      if (!session || session.closed) return Promise.resolve(session || null);
      if (session.ready) return Promise.resolve(session);
      if (!session.ws || session.ws.readyState !== 1) return Promise.resolve(session);
      return new Promise(function (res) {
        var fired = false;
        var done = function () { if (!fired) { fired = true; clearTimeout(timer); res(session); } };
        var timer = setTimeout(done, ms);
        session._onReady = session._onReady || [];
        session._onReady.push(done);
      });
    }

    /** Закрыть все ws + таймеры + кэши (STABILITY-004: никаких orphan-промисов). */
    function destroyAll() {
      var k;
      for (k in sessions) if (Object.prototype.hasOwnProperty.call(sessions, k)) {
        var s = sessions[k];
        if (s) {
          teardownSession(s);
          if (s.ws) {
            try { s.ws.close(1000, 'client_shutdown'); } catch (e) {}
            s.ws = null;
          }
        }
        sessions[k] = undefined;
      }
      flows = {};
      okKey = '';
    }

    // ── bootstrap (креды + хосты; креды только в памяти, TTL из ответа) ────────
    function fetchBootstrap() {
      var base = apiOrigin(MANIYA_API_BASE);
      if (!base) return NO;
      if (typeof AbortController !== 'function') return NO;
      var url = base + BOOTSTRAP_PATH;
      var token = ensureToken();
      log('bootstrap', maskUrl(url));
      // Бюджет как у остальных запросов (network.timeout(15000) на /videos):
      // bootstrap завис → flow откатится на legacy, без вечного ожидания.
      var ctrl = new AbortController();
      var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, BOOTSTRAP_BUDGET_MS);
      return fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {}, signal: ctrl.signal })
        .then(function (r) {
          clearTimeout(timer);
          if (!r || !r.ok) return null;
          return r.json().catch(function () { return null; });
        })
        .then(function (b) { return (b && b.enabled === true && b.skaz && b.modules) ? b : null; })
        .catch(function () { clearTimeout(timer); return null; });
    }

    function ensureBootstrap(force) {
      if (!force && bootstrap) return Promise.resolve(bootstrap);
      if (bootstrapPromise) return bootstrapPromise;
      if (typeof fetch !== 'function') return NO;
      bootstrapPromise = fetchBootstrap().then(function (bs) {
        bootstrapPromise = null;
        bootstrap = bs || null;
        if (bs && Number(bs.ttl_s)) {
          var ttl = Number(bs.ttl_s) * 1000;
          var timer = setTimeout(function () { bootstrap = null; }, ttl);
          if (timer && timer.unref) timer.unref();
        }
        return bs;
      });
      return bootstrapPromise;
    }

    function hasModule(list, slug) {
      if (!list || !slug) return false;
      for (var i = 0; i < list.length; i++) {
        if (String(list[i]).trim() === slug) return true;
      }
      return false;
    }

    function disabledByUser() {
      try {
        if (!Lampa || !Lampa.Storage || typeof Lampa.Storage.get !== 'function') return false;
        return String(Lampa.Storage.get('maniya_thin_off', '0')) === '1';
      } catch (e) { return false; }
    }

    /** Тонкий гейт (без bootstrap — bootstrap тянется внутри flow при первой попытке). */
    function wants(slug) {
      if (!slug) return false;
      if (disabledByUser()) return false;
      if (typeof fetch !== 'function') return false;
      if (typeof WebSocket !== 'function') return false;
      if (typeof AbortController !== 'function') return false;
      return true;
    }

    /** Полный гейт: bootstrap загружен, модуль в allowlist, флаг жив. */
    function enabled(slug) {
      if (!wants(slug) || !bootstrap) return false;
      return bootstrap.enabled === true && hasModule(bootstrap.modules, slug);
    }

    function flowOk(key) { return okKey === key; }
    function flowReset(key) { if (okKey === key) okKey = ''; }
    function flowReady(key) { okKey = key; }

    // ── параметры lite-страницы (зеркало SkazProvider.buildPageParams) ────────
    // Канон id: KP(число) → id(число) → TMDB(число) → imdb (последний резерв).
    function canonicalId(movie) {
      var n = function (v) { return /^\d+$/.test(String(v || '').trim()); };
      var kp = String(movie.kinopoisk_id || '').trim();
      if (n(kp)) return kp;
      var id = String(movie.id || '').trim();
      if (n(id)) return id;
      var tmdb = String(movie.tmdb_id || '').trim();
      if (n(tmdb)) return tmdb;
      return String(movie.imdb_id || movie.id || '').trim();
    }

    function titleParam(movie, object) {
      var t = (object && object.clarification) ? (object.search || '') : (movie.title || movie.name || '');
      return String(t || '');
    }

    /** Пары параметров (k=v, URL-encoded) для lite-запроса — серверный whitelist. */
    function pageParams(movie, object) {
      var q = [];
      var id = canonicalId(movie);
      if (id) q.push('id=' + encodeURIComponent(id));
      if (movie.imdb_id) q.push('imdb_id=' + encodeURIComponent(movie.imdb_id));
      if (movie.kinopoisk_id) q.push('kinopoisk_id=' + encodeURIComponent(movie.kinopoisk_id));
      var title = titleParam(movie, object);
      if (title) q.push('title=' + encodeURIComponent(title));
      var original = movie.original_title || movie.original_name || '';
      if (original) q.push('original_title=' + encodeURIComponent(original));
      q.push('serial=' + (movie.name ? 1 : 0));
      var year = String(movie.release_date || movie.first_air_date || '').slice(0, 4);
      if (year) q.push('year=' + encodeURIComponent(year));
      q.push('source=' + encodeURIComponent(movie.source || 'tmdb'));
      return q;
    }

    // ── парсеры lite-страниц (зеркало SkazNormalizer) ────────────────────────
    function parseCardJson(raw) {
      try {
        var card = JSON.parse(raw);
        return (card && typeof card === 'object' && !Array.isArray(card)) ? card : null;
      } catch (e) { return null; }
    }

    function stripHtml(input) { return String(input).replace(/<[^>]*>/g, ''); }

    function nearbyText(html, fromIndex, markerLength) {
      var tail = html.slice(fromIndex + markerLength, fromIndex + markerLength + 400);
      var inline = tail.match(/^\s*>([^<]{1,120})<\/div>/);
      if (inline) {
        var inlineText = stripHtml(inline[1]).trim();
        if (inlineText) return inlineText;
      }
      var nextCard = tail.indexOf('data-json');
      var bounded = nextCard === -1 ? tail : tail.slice(0, nextCard);
      var titled = bounded.match(/videos__(?:item|season)-title[^>]*>\s*([^<]{1,120})<\//);
      if (titled) {
        var titledText = stripHtml(titled[1]).trim();
        if (titledText) return titledText;
      }
      return '';
    }

    function parseCards(html) {
      var items = [];
      if (typeof html !== 'string') return items;
      var re = /data-json\s*=\s*(['"])([\s\S]*?)\1/g;
      var match;
      while ((match = re.exec(html)) !== null) {
        var card = parseCardJson(match[2]);
        if (!card) continue;
        var text = nearbyText(html, match.index, match[0].length);
        if (text && !card._text) card._text = text;
        items.push(card);
      }
      return items;
    }

    function parseVoices(cards, options) {
      var opts = options || {};
      var seen = {};
      var out = [];
      var list = cards || [];
      for (var i = 0; i < list.length; i++) {
        var card = list[i];
        if (!card || card.method !== 'link' || card.similar) continue;
        var t = paramNumber(card.url, 't');
        if (t == null) continue;
        if (!opts.withSeason && paramNumber(card.url, 's') != null) continue;
        var title = String(card._text || card.title || card.translate || ('перевод ' + t)).trim();
        if (seen[title]) continue;
        seen[title] = true;
        out.push({ name: title, t: t, url: String(card.url || ''), index: t });
      }
      return out;
    }

    function parseSeasons(cards) {
      var seen = {};
      var out = [];
      var list = cards || [];
      for (var i = 0; i < list.length; i++) {
        var card = list[i];
        if (!card || card.method !== 'link' || card.similar) continue;
        var number = paramNumber(card.url, 's');
        if (number == null) continue;
        var title = String(card._text || (number + ' сезон')).trim();
        if (seen[number]) continue;
        seen[number] = true;
        out.push({ number: number, title: title });
      }
      return out;
    }

    function hasEpisodes(cards) {
      var list = cards || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].method === 'call' && list[i].s != null && list[i].e != null) return true;
      }
      return false;
    }

    function hasMovieItems(cards) {
      var list = cards || [];
      for (var i = 0; i < list.length; i++) {
        var card = list[i];
        if (card && (card.method === 'play' || (card.method === 'call' && card.s == null && card.e == null))) return true;
      }
      return false;
    }

    function parseEpisodes(cards, seasonNumber) {
      var items = [];
      var list = cards || [];
      for (var i = 0; i < list.length; i++) {
        var card = list[i];
        if (!card || (card.method !== 'call' && card.method !== 'play')) continue;
        if (card.s == null || card.e == null) continue;
        if (seasonNumber != null && Number(card.s) !== Number(seasonNumber)) continue;
        var episode = Number(card.e) || 0;
        items.push({
          method: card.method,
          title: String(card.name || ('Серия ' + episode)).trim(),
          episode: episode,
          season: Number(card.s) || 0,
          stream: String(card.stream || ''),
          url: String(card.url || ''),
          voice_name: String(card.translate || ''),
          quality: undefined,
          subtitles: []
        });
      }
      items.sort(function (a, b) { return (a.episode || 0) - (b.episode || 0); });
      return items;
    }

    /** Ссылка страницы сезона (зеркало SkazProvider.seasonLinkHref). */
    function seasonLinkHref(cards, voice, seasonNumber) {
      var preferT = voice ? voice.t : null;
      var fallback = null;
      var list = cards || [];
      for (var i = 0; i < list.length; i++) {
        var card = list[i];
        if (!card || card.method !== 'link' || card.similar) continue;
        var url = String(card.url || '');
        if (!url) continue;
        var t = paramNumber(url, 't');
        var s = paramNumber(url, 's');
        if (seasonNumber && s && Number(s) === Number(seasonNumber)) {
          if (preferT != null && t != null && Number(t) !== Number(preferT)) return setParam(url, 't', String(preferT));
          return url;
        }
        if (s == null && t != null && !fallback) fallback = url;
      }
      return fallback;
    }

    // ── fetch / URL-утилиты ──────────────────────────────────────────────────
    function fetchText(url, budgetMs) {
      if (!url) return NO;
      if (typeof AbortController !== 'function') return NO;
      var ctrl = new AbortController();
      var budget = Math.max(500, Number(budgetMs) || 4000);
      // Гарантированный settle (STABILITY-004): даже если fetch игнорирует abort
      // и никогда сам не «дойдёт», budget обязан вернуть null — иначе flow повиснет
      // навсегда и thinFallback не вызовется.
      return new Promise(function (resolve) {
        var done = false;
        var timer = setTimeout(function () {
          try { ctrl.abort(); } catch (e) {}
          if (!done) { done = true; resolve(null); }
        }, budget);
        function settle(value) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(value);
        }
        fetch(url, { headers: { accept: '*/*' }, signal: ctrl.signal })
          .then(function (r) {
            if (!r || r.status < 200 || r.status >= 300) return settle(null);
            return r.text().then(settle, function () { settle(null); });
          })
          .catch(function () { settle(null); });
      });
    }

    function withAuth(url, creds) {
      try {
        var parsed = new URL(url);
        if (creds && creds.account_email && !parsed.searchParams.has('account_email')) parsed.searchParams.set('account_email', creds.account_email);
        if (creds && creds.uid && !parsed.searchParams.has('uid')) parsed.searchParams.set('uid', creds.uid);
        return parsed.toString();
      } catch (e) { return url; }
    }

    function appendParams(url, pairs) {
      if (!pairs || !pairs.length) return url;
      var sep = String(url).indexOf('?') >= 0 ? '&' : '?';
      return String(url) + sep + pairs.join('&');
    }

    function absUrl(href, baseLite) {
      if (!href) return '';
      if (/^https?:\/\//i.test(href)) return href;
      if (href.charAt(0) === '/') {
        try {
          var parsed = new URL(baseLite);
          return parsed.protocol + '//' + parsed.host + href;
        } catch (e) { return href; }
      }
      return href;
    }

    /** Пары lite↔ws хостов из bootstrap (SSRF-гигиена: только bootstrap-хосты).
     *  Bootstrap отдаёт только ОРИГИНЫ — путь lite-эндпоинта ('/lite/<slug>')
     *  берём из deep-link источника (sourceUrl, кластерный URL карточки), чтобы
     *  запрос шёл на '…/<path>' с любого хоста пула (ротация зеркал даёт тот же
     *  эндпоинт). Без этого базовый запрос уходит на корень → 404/пусто → вечный
     *  фолбэк (T052-C: found at first end-to-end run). */
    function liteHostsPairs(bs, sourceUrl) {
      var lites = (bs && bs.skaz && bs.skaz.lite_hosts) || [];
      var wss = (bs && bs.skaz && bs.skaz.ws_hosts) || [];
      var path = '';
      try { path = String(new URL(String(sourceUrl)).pathname) || ''; } catch (e) {}
      var pairs = [];
      for (var i = 0; i < lites.length; i++) {
        pairs.push({
          lite: String(lites[i]).replace(/\/+$/, '') + path,
          ws: wsUrlFor(lites[i], wss[i])
        });
      }
      if (!pairs.length && sourceUrl) {
        var origin = apiOrigin(String(sourceUrl));
        if (origin) pairs.push({ lite: origin + path, ws: wsUrlFor(origin, '') });
      }
      // deep-link хост — предпочитаемый (preferred-first), если он в пуле.
      var preferred = '';
      try { preferred = new URL(String(sourceUrl)).host; } catch (e) {}
      if (preferred) {
        for (var p = 0; p < pairs.length; p++) {
          var hostNow = '';
          try { hostNow = new URL(pairs[p].lite).host; } catch (e) {}
          if (hostNow === preferred && p > 0) {
            var pre = pairs.splice(p, 1)[0];
            pairs.unshift(pre);
            break;
          }
        }
      }
      return pairs;
    }

    /** Базовая lite-страница с host-ротацией (зеркало _scanLite: 2xx+контент → стоп). */
    function fetchBasePage(pairs, creds, params, deadline) {
      if (!pairs.length) return NO;
      if (Date.now() > deadline) return NO;
      var entry = pairs[0];
      var rest = pairs.slice(1);
      var url = withAuth(appendParams(entry.lite, params), creds);
      log('lite', maskUrl(url));
      return fetchText(url, Math.max(500, deadline - Date.now())).then(function (html) {
        if (html == null) return fetchBasePage(rest, creds, params, deadline);
        var cards = parseCards(html);
        if (cards.length) return Promise.resolve({ cards: cards, entry: entry });
        return fetchBasePage(rest, creds, params, deadline);
      });
    }

    /** Минт play-дескриптора с устройства: video(без .m3u8/play) + creds + nws_id. */
    function mint(streamUrl, creds, entry, budgetMs) {
      if (!streamUrl) return NO;
      var target = withAuth(streamUrl, creds);
      var jsonUrl = null;
      try {
        jsonUrl = new URL(target);
        jsonUrl.pathname = jsonUrl.pathname.replace(/\.m3u8$/i, '');
        jsonUrl.searchParams.delete('play');
      } catch (e) { jsonUrl = null; }
      if (!jsonUrl) return NO;
      var session = entry && entry.ws ? openSession(entry.ws) : null;
      var doMint = function (s) {
        if (s && s.nwsId && !jsonUrl.searchParams.has('nws_id')) jsonUrl.searchParams.set('nws_id', s.nwsId);
        log('mint', maskUrl(jsonUrl.toString()));
        return fetchText(jsonUrl.toString(), budgetMs).then(function (text) {
          if (text == null) return null;
          var parsed = null;
          try { parsed = JSON.parse(text); } catch (e) { return null; }
          if (parsed && typeof parsed === 'object' && parsed.method === 'play' && String(parsed.url || '').trim()) return parsed;
          return null;
        });
      };
      if (!session || session.ready) return doMint(session);
      return whenReady(session, 1500).then(doMint);
    }

    /**
     * Прямой для тонкого play: абсолютный http(s), НЕ наш API. Включает и
     * `host/proxy/<token>` узла кластера: в thin-потоке такой wrapper минтится
     * С ДЕВАЙСА (мint — клиентский fetch), токен IP-bound к девайсу (T049:
     * same-IP 200) → играбелен напрямую, без нашего /proxy (lordfilm, T052).
     * Наш /api/lampa/proxy и /api/lampa/video(s) отсекаются isDirectCdnUrl
     * (и дублирующей проверкой ниже) — legacy-путь не задевается.
     */
    function isDirectThin(u) {
      var s = String(u || '');
      if (!/^https?:\/\//i.test(s)) return false;
      if (!isDirectCdnUrl(s)) return false;
      if (s.indexOf('/api/lampa/') !== -1) return false;
      return true;
    }

    function cleanQuality(map) {
      if (!map || typeof map !== 'object') return {};
      var out = {};
      for (var label in map) {
        if (!Object.prototype.hasOwnProperty.call(map, label)) continue;
        var value = map[label];
        if (typeof value !== 'string' || !value) continue;
        if (isDirectThin(value)) out[label] = value;
      }
      return out;
    }

    /** Субтитры из дескриптора — через наш /proxy (малые, CORS-безопасно). */
    function normalizeSubs(list) {
      var out = [];
      if (!Array.isArray(list)) return out;
      for (var i = 0; i < list.length; i++) {
        var sub = list[i];
        if (!sub || typeof sub.url !== 'string' || !sub.url) continue;
        out.push({
          label: String(sub.label || sub.title || 'Субтитры').trim(),
          url: proxyUrlFor({ url: String(sub.url).trim(), headers: { origin: 'http://lampa.mx' } })
        });
      }
      return out;
    }

    /** Дескриптор `{method:'play',url,quality,subtitles,segments,…}` → item. */
    function descriptorToItem(descriptor, meta) {
      if (!descriptor || descriptor.method !== 'play') return null;
      var parts = splitOr(descriptor.url);
      var url = parts[0];
      if (!url || !isDirectThin(url)) return null;
      if (parts[1] && isDirectThin(parts[1])) url += ' or ' + parts[1];
      var title = String((meta && meta.title) || 'Оригінал').trim();
      var voiceName = String((meta && meta.voice_name) || '').trim() || title;
      var item = {
        method: 'play',
        title: title,
        url: url,
        quality: cleanQuality(descriptor.quality),
        subtitles: normalizeSubs(descriptor.subtitles),
        segments: descriptor.segments && typeof descriptor.segments === 'object' ? descriptor.segments : undefined,
        hls_manifest_timeout: descriptor.hls_manifest_timeout ? Number(descriptor.hls_manifest_timeout) : undefined,
        voice_name: voiceName,
        type: (meta && meta.type) || 'movie'
      };
      if (meta && meta.season != null) item.season = meta.season;
      if (meta && meta.episode != null) item.episode = meta.episode;
      return item;
    }

    function cardTitle(card) {
      var text = String(card && (card._text || card.title || card.translate || '')).trim();
      return text || 'Оригінал';
    }

    // ── кэш навигации (ТТL; зеркало _navCache сервера) ───────────────────────
    function fingerprint(slug, movie, object) {
      var t = titleParam(movie, object).toLowerCase();
      return slug + '|' + String(movie.id || movie.tmdb_id || '') + '|' + t + '|' + (movie.name ? '1' : '0');
    }

    function cacheSet(fp, entry) {
      if (Object.keys(flows).length >= CACHE_MAX) flows = {};
      flows[fp] = { ts: Date.now(), e: entry };
    }

    function cacheGet(slug, movie, object) {
      var fp = fingerprint(slug, movie, object);
      var hit = flows[fp];
      if (!hit) return null;
      if (Date.now() - hit.ts > CACHE_TTL_MS) { delete flows[fp]; return null; }
      return hit.e;
    }

    // ── flow: клиентская lite-цепочка (bootstrap → лайт → минт direct) ───────
    function flow(opts) {
      var slug = String(opts.slug || '').trim();
      if (!slug) return NO;
      var movie = opts.movie || {};
      var object = opts.component || {};
      var budgetMs = Number(opts.budgetMs) || DEFAULT_BUDGET_MS;
      var started = Date.now();
      var deadline = started + budgetMs;
      var fp = fingerprint(slug, movie, object);

      return ensureBootstrap().then(function (bs) {
        if (!bs || bs.enabled !== true || !bs.skaz || !hasModule(bs.modules, slug)) return null;
        var creds = bs.skaz;
        var pairs = liteHostsPairs(bs, opts.sourceUrl);
        if (!pairs.length) return null;
        var params = pageParams(movie, object);
        return fetchBasePage(pairs, creds, params, deadline).then(function (base) {
          if (!base || Date.now() > deadline) { log('flow: bail base', !!base, Date.now() - deadline); return null; }
          var isSerial = !!(movie.name) || hasEpisodes(base.cards);
          log('flow: cards', (base.cards || []).length, 'isSerial', isSerial);
          if (isSerial) return serialBranch(base, creds, slug, movie, object, opts, fp, deadline);
          return movieBranch(base, creds, slug, fp, deadline);
        });
      });
    }

    // follow-path: серверный MovieHref / postid / seasonLinkTarget (sfx: сезон →
    // &s=) в т-клиент v1 НЕ перенесены. Alloha/lordfilm базовые страницы несут
    // play/call прямо (проверено wire): id-навигация (пост: link → страница → play)
    // бывает у редких slug'ов вне allowlist-скоупа; при её отсутствии parseCards
    // не даёт play/call → _text-фильтр → NO → безопасный фолбэк в legacy /videos.
    function movieBranch(base, creds, slug, fp, deadline) {
      var movieCards = [];
      var cards = base.cards || [];
      var i;
      for (i = 0; i < cards.length; i++) {
        var c = cards[i];
        if (!c || c.similar) continue;
        if (c.method === 'play') movieCards.push({ play: true, card: c });
        else if (c.method === 'call' && c.s == null && c.e == null) movieCards.push({ play: false, card: c });
      }
      var items = [];
      var directPlays = [];
      var voices = [];
      for (i = 0; i < movieCards.length; i++) {
        if (movieCards[i].play) directPlays.push(movieCards[i].card);
        else voices.push(movieCards[i].card);
      }
      // Готовые play-карточки (прямой CDN в URL) — минт не нужен.
      for (i = 0; i < directPlays.length; i++) {
        var cardUrl = String(directPlays[i].url || '');
        if (isDirectThin(cardUrl)) {
          items.push({
            method: 'play',
            title: cardTitle(directPlays[i]),
            url: cardUrl,
            quality: cleanQuality(directPlays[i].quality),
            subtitles: [],
            voice_name: String(directPlays[i].translate || '').trim(),
            type: 'movie'
          });
        }
      }
      if (items.length) return Promise.resolve({ items: items, seasons: [], voices: [] });
      if (!voices.length) return NO;
      // call-голоса: первый минтим (доказать direct), остальные — ленивые call.
      var first = voices[0];
      return mint(first.stream || first.url, creds, base.entry, Math.max(500, deadline - Date.now())).then(function (descriptor) {
        if (!descriptor) return null;
        var title = cardTitle(first);
        var item = descriptorToItem(descriptor, { title: title, voice_name: String(first.translate || '').trim() || title, type: 'movie' });
        if (!item) return null;
        var out = [item];
        for (var v = 1; v < voices.length; v++) {
          out.push({
            method: 'call',
            title: cardTitle(voices[v]),
            voice_name: String(voices[v].translate || '').trim(),
            type: 'movie',
            url: CALL_SCHEME + slug + '/voice/' + v,
            subtitles: []
          });
        }
        cacheSet(fp, { movieCards: voices, creds: creds, entry: base.entry });
        return { items: out, seasons: [], voices: [] };
      });
    }

    function serialBranch(base, creds, slug, movie, object, opts, fp, deadline) {
      var cards = base.cards || [];
      var voices = parseVoices(cards);
      var seasons = parseSeasons(cards);
      var inline = hasEpisodes(cards);
      if (!voices.length && !seasons.length && !inline) return NO;
      var voiceIndex = Number(opts.voice) || 0;
      var chosenVoice = voices.length ? (voices[voiceIndex % voices.length] || voices[0]) : null;
      var seasonNumber = Number(opts.season) || 0;
      if (seasons.length) {
        var found = false;
        for (var s = 0; s < seasons.length; s++) {
          if (Number(seasons[s].number) === seasonNumber) { found = true; break; }
        }
        if (!found) seasonNumber = seasons[0].number;
      }
      var href = seasonLinkHref(cards, chosenVoice, seasonNumber);
      var seasonUrl = href ? withAuth(absUrl(href, base.entry.lite), creds) : '';
      var pagePromise = seasonUrl
        ? fetchText(seasonUrl, Math.max(500, deadline - Date.now())).then(function (html) {
            if (!html) return null;
            return { cards: parseCards(html) };
          })
        : Promise.resolve({ cards: cards });

      return pagePromise.then(function (page) {
        if (!page || Date.now() > deadline) return null;
        var pageCards = page.cards;
        var effectiveVoices = voices.length ? voices : parseVoices(pageCards, { withSeason: true });
        var episodes = parseEpisodes(pageCards, seasonNumber);
        if (!episodes.length) return null;
        var first = episodes[0];
        var eVoice = chosenVoice || (effectiveVoices.length ? effectiveVoices[voiceIndex % effectiveVoices.length] : null);
        var voiceName = String((eVoice && eVoice.name) || '').trim() ||
          String(first.voice_name || '').trim();
        var promise = (first.method === 'play' && isDirectThin(first.stream || first.url))
          ? Promise.resolve('__direct__')
          : mint(first.stream || first.url, creds, base.entry, Math.max(500, deadline - Date.now()));

        return promise.then(function (resolved) {
          var items = [];
          if (resolved === '__direct__') {
            items.push({
              method: 'play',
              title: first.title,
              url: first.stream || first.url,
              quality: cleanQuality(first.quality),
              subtitles: [],
              voice_name: voiceName,
              type: 'serial',
              season: seasonNumber,
              episode: first.episode
            });
          } else {
            var item = descriptorToItem(resolved, {
              title: first.title,
              voice_name: voiceName,
              type: 'serial',
              season: seasonNumber,
              episode: first.episode
            });
            if (!item) return null;
            items.push(item);
          }
          for (var e = 1; e < episodes.length; e++) {
            var ep = episodes[e];
            items.push({
              method: 'call',
              title: ep.title,
              episode: ep.episode,
              season: seasonNumber,
              voice_name: String(ep.voice_name || '').trim() || voiceName,
              type: 'serial',
              url: CALL_SCHEME + slug + '/ep/' + seasonNumber + '/' + ep.episode,
              subtitles: []
            });
          }
          var seasonsList = seasons.map(function (se) { return { number: se.number, title: se.title }; });
          var voicesList = effectiveVoices.map(function (vc, idx) { return { name: vc.name, index: idx }; });
          cacheSet(fp, { serialCards: pageCards, creds: creds, entry: base.entry });
          return { items: items, seasons: seasonsList, voices: voicesList };
        });
      });
    }

    /** Ленивый резолв тонкой call-серии/голоса (на Play, с IP девайса). */
    function resolveCall(item, movie, object) {
      var raw = String((item && item.url) || '');
      if (!isThinCallUrl(raw)) return NO;
      var rest = raw.slice(CALL_SCHEME.length);
      var slug = String(rest.split('/')[0] || '').trim();
      if (!slug) return NO;
      var flowEntry = cacheGet(slug, movie || {}, object);
      if (!flowEntry) { log('call: cache miss', slug); return NO; }
      var voiceMatch = rest.match(/\/voice\/(\d+)$/);
      if (voiceMatch) {
        var cards = flowEntry.movieCards || [];
        var card = cards[Number(voiceMatch[1])];
        if (!card) return NO;
        var vtitle = cardTitle(card);
        return mint(card.stream || card.url, flowEntry.creds, flowEntry.entry, MINT_BUDGET_MS * 2)
          .then(function (descriptor) {
            return descriptorToItem(descriptor, { title: vtitle, voice_name: String(card.translate || '').trim() || vtitle, type: 'movie' });
          });
      }
      var epMatch = rest.match(/\/ep\/(\d+)\/(\d+)$/);
      if (epMatch) {
        var season = Number(epMatch[1]);
        var episode = Number(epMatch[2]);
        var cards2 = flowEntry.serialCards || [];
        var the = null;
        for (var i = 0; i < cards2.length; i++) {
          var cand = cards2[i];
          if (cand && (cand.method === 'call' || cand.method === 'play') && cand.s != null && cand.e != null &&
              Number(cand.s) === season && Number(cand.e) === episode) {
            the = cand;
            break;
          }
        }
        if (!the) return NO;
        var etitle = String(the.name || ('Серия ' + episode)).trim();
        return mint(the.stream || the.url, flowEntry.creds, flowEntry.entry, MINT_BUDGET_MS * 2)
          .then(function (descriptor) {
            return descriptorToItem(descriptor, {
              title: etitle,
              voice_name: String(the.translate || '').trim(),
              type: 'serial',
              season: season,
              episode: episode
            });
          });
      }
      return NO;
    }

    var thinApi = {
      wants: wants,
      enabled: enabled,
      flowOk: flowOk,
      flowReset: flowReset,
      flowReady: flowReady,
      destroyAll: destroyAll,
      ensureBootstrap: ensureBootstrap,
      flow: flow,
      resolveCall: resolveCall,
      // чистые парсеры/хелперы (vm-тесты)
      parseCards: parseCards,
      parseVoices: parseVoices,
      parseSeasons: parseSeasons,
      parseEpisodes: parseEpisodes,
      hasEpisodes: hasEpisodes,
      hasMovieItems: hasMovieItems,
      seasonLinkHref: seasonLinkHref,
      paramValue: paramValue,
      paramNumber: paramNumber,
      canonicalId: canonicalId,
      pageParams: pageParams,
      splitOr: splitOr,
      isThinCallUrl: isThinCallUrl,
      isDirectThin: isDirectThin,
      descriptorToItem: descriptorToItem,
      randomNwsId: randomNwsId,
      // ТЕСТОВЫЕ ХУКИ (только server/test/thin-client.test.js, никогда не вызываются
      // в бою): перезапуск bootstrap-кэша между тестами и ускорение keepalive-таймера.
      _resetState: function () { bootstrap = null; bootstrapPromise = null; flows = {}; okKey = ''; },
      _setPingMs: function (ms) { if (Number(ms) >= 5) PING_MS = Number(ms); }
    };

    return thinApi;
  })();

  function startPlugin() {
    ensureUid();
    ensureToken();
    addLang();
    addTemplates();

    var manifest = {
      type: 'video',
      version: '1.0.1',
      name: 'Maniya Online — STAGING',
      description: 'Плагин Maniya Online для просмотра доступных источников по подписке — STAGING (Тест, сборка ' + window.MANIYA_STAGING_BUILD + ')',
      component: COMPONENT,
      onContextMenu: function () {
        return {
          name: Lampa.Lang.translate('maniya_watch'),
          description: ''
        };
      },
      onContextLauch: function (movie) {
        openOnline(movie);
      }
    };

    Lampa.Manifest.plugins = manifest;
    Lampa.Component.add(COMPONENT, component);

    Lampa.Listener.follow('full', function (event) {
      if (event.type === 'complite') {
        var render = event.object.activity.render();
        addButton({
          render: render,
          movie: event.data.movie
        });
        addStatusBadge({ render: render });
      }
    });

    try {
      if (Lampa.Activity.active().component === 'full') {
        var currentRender = Lampa.Activity.active().activity.render();
        addButton({
          render: currentRender,
          movie: Lampa.Activity.active().card
        });
        addStatusBadge({ render: currentRender });
      }
    } catch (e) {}
  }

  startPlugin();

  // Тестовая ручка для регрессий (server/test/plugin-contract.test.js): vm-заглушка
  // Lampa без Lampa.Select.open воспроизводит «Script error» при вызове
  // openQualitySelect. Экспортируем ТОЛЬКО чистые функции, без доступа к замыканию.
  if (typeof window !== 'undefined') {
    window.MANIYA_LIB = {
      openQualitySelect: openQualitySelect,
      qualityEntries: qualityEntries,
      qualityChips: qualityChips,
      bestQualityLabel: bestQualityLabel,
      moviePoster: moviePoster,
      orUrlReserve: orUrlReserve,
      setDefaultQuality: setDefaultQuality,
      sourceLabel: sourceLabel,
      shortQuality: shortQuality,
      sourceChipParts: sourceChipParts,
      escapeHtml: escapeHtml,
      resolveVideosUrl: resolveVideosUrl,
      // T052: тонкий клиент — чистая логика + хуки для vm-тестов (thin-client.test).
      thinApi: ThinSkaz
    };
  }
})();
