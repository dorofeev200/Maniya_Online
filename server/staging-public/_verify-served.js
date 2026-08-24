/* Maniya Online — подпись токена сервером */
window.MANIYA_ONLINE_TOKEN_STAGING="staging-test-4f3a9c21e7b64d08a5c2f1e9";
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
  window.MANIYA_STAGING_BUILD = '5fb2c9e8';

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
    var seasonEpisodesCache = {};
    // SKAZ-MANIYA-041: процесс балансировки — пока кард-модель (/sources/card)
    // считается, показываем hero + панель «Опрашиваем источники» (SKAZ
    // uiLoadingPanel), БЕЗ тулбара «ИСТОЧНИК» и без статического списка.
    var uiPolling = false;
    var uiPollTimer = null;
    var uiPollStart = 0;
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
      // SKAZ-MANIYA-041: ответ балера пришёл — загрузочную панель убираем,
      // дальше штатный рендер (с тулбаром «ИСТОЧНИК» и сгенерированным списком).
      uiPollStop();
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
            seasons: row.seasons || 0
          };
        });
        sources = built;
        // Все ключи, включая ghost — Lampa сколапсит скрытые под «Ещё N».
        filterSources = Lampa.Arrays.getKeys(sources);
        var shown = filterSources.filter(function (key) { return sources[key].show; });
        if (!shown.length) return self.empty(Lampa.Lang.translate('maniya_empty_sources'));
        var activeChanged = shown.indexOf(activeSource) === -1;
        if (activeChanged) {
          activeSource = shown[0];
          activeSeason = null;
          activeVoice = null;
          Lampa.Storage.set('maniya_online_source', activeSource);
        }
        activeUrl = sources[activeSource].url;
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
      if (ui.attachedScroll !== scroll) {
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
     *  «Опрашиваем источники · Nс» + прогресс-бар + skeleton-строки. БЕЗ тулбара
     *  «ИСТОЧНИК» — селектор появляется только когда баланер вернул модель. */
    this.uiLoadingPanel = function () {
      var self = this;
      if (!Z01_UI_OK) return;
      uiPolling = true;
      uiPollStart = 0;
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

      // SKAZ uiLoadingText: «Опрашиваем источники · Nс», прогресс = max(p, min(90, sec*7)).
      var bar = ui.list.find('.z01-loading__bar>div');
      var text = ui.list.find('.z01-loading__text');
      uiPollTimer = setInterval(function () {
        uiPollStart += 1;
        var pct = Math.min(90, uiPollStart * 7);
        try { bar.css('width', pct + '%'); } catch (e) {}
        try { text.text(uiPollStart + ' ' + Lampa.Lang.translate('maniya_sec')); } catch (e) {}
      }, 1000);
      this.loading(false);
      Lampa.Controller.enable('content');
      // WATCHDOG: если балансер долго молчит (нет сети/сервер занят) — через
      // 15с снимаем панель и показываем статический реестр (не весим вечно).
      uiPollDeadline();
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
      if (!items || !items.length) return;
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

      var target = uiPickResume(items);
      var serial = movie.name ? true : false;
      var started = target.timeline && target.timeline.percent > 0 && target.timeline.percent < 90;

      var actions = ui.hero.find('.z01-hero__actions');
      actions.find('.z01-btn').remove();
      var button = $('<div class="z01-btn z01-btn--main selector"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span class="z01-btn__label"></span></div>');
      var label = Lampa.Lang.translate(started ? 'maniya_continue' : 'maniya_watch');
      if (serial && target && target.episode) label += ' · S' + (target.season || 1) + ' E' + target.episode;
      button.find('.z01-btn__label').text(label);
      button.on('hover:enter', function () { self.play(target); })
        .on('hover:focus', function () { scroll.update($(this).parent(), true); });
      actions.prepend(button);

      var hint = [];
      hint.push((sources[activeSource] && sources[activeSource].name) || activeSource);
      if (target && target.voice_name) hint.push(target.voice_name);
      actions.find('.z01-hero__hint').text(hint.join(' · '));

      var meta = ui.hero.find('.z01-hero__meta').empty();
      var badge = shortQuality(bestQualityLabel(target) || target.quality_label || (sources[activeSource] && sources[activeSource].quality_label));
      if (badge) meta.append('<div class="z01-badge">' + escapeHtml(badge) + '</div>');
      if (movie.vote_average) meta.append('<div>★ ' + parseFloat(movie.vote_average + '').toFixed(1) + '</div>');
      var year = ((movie.release_date || movie.first_air_date || '') + '').slice(0, 4);
      if (year) meta.append('<div>' + escapeHtml(year) + '</div>');
      if (target && target.time) meta.append('<div>' + escapeHtml(target.time) + '</div>');

      var progress = ui.hero.find('.z01-hero__progress').empty();
      if (target.timeline && target.timeline.percent > 0 && Lampa.Timeline && typeof Lampa.Timeline.render === 'function') {
        progress.show().append(Lampa.Timeline.render(target.timeline));
      } else progress.hide();

      var seasonLine = ui.hero.find('.z01-hero__season');
      if (serial && items.length > 1) {
        seasonLine.text(Lampa.Lang.translate('maniya_items_count').replace('{n}', items.length)).show();
      } else seasonLine.hide();
    };

    /** Селектор «ИСТОЧНИК [4K 🌐 Lime ▼]» + раскрытие в pill-чипы (onlines.js uiRows/uiSourceRow). */
    this.uiToolbar = function () {
      var self = this;
      ui.rows.empty();
      var toolbar = $('<div class="z01-toolbar"></div>');
      toolbar.append($('<div class="z01-toolbar__label"></div>').text(Lampa.Lang.translate('maniya_source')));
      var current = sources[activeSource];
      var parts = sourceChipParts(current, activeSource);
      var chip = $('<div class="z01-chip z01-chip--source selector"></div>');
      if (parts.badge) chip.append($('<span class="z01-chip__badge"></span>').text(parts.badge));
      chip.append($('<span class="z01-chip__label"></span>').text(parts.label));
      chip.append(chevronSvg());
      chip.on('hover:enter', function () { self.uiToggleSource(); })
        .on('hover:focus', function (e) { last = e.target; scroll.update($(e.target), true); });
      toolbar.append(chip);
      ui.rows.append(toolbar);
      if (ui.open === 'source') ui.rows.append(this.uiSourceRow());
    };

    this.uiToggleSource = function () {
      if (ui.open === 'source') ui.open = '';
      else ui.open = 'source';
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
        var c = $('<div class="z01-chip selector"></div>');
        c.attr('data-z01-focus', 'src:' + key);
        if (info.show === false || info.ghost) c.addClass('z01-chip--ghost');
        if (p.badge) c.append($('<span class="z01-chip__badge"></span>').text(p.badge));
        c.append($('<span class="z01-chip__label"></span>').text(p.label));
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
      if (item.poster) {
        img.on('load', function () {
          thumb.addClass('z01-card__thumb--loaded');
          thumb.find('.z01-card__line').append(Lampa.Timeline && typeof Lampa.Timeline.render === 'function' && item.timeline && item.timeline.percent > 0 ? Lampa.Timeline.render(item.timeline) : '');
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
      this.reset();
      var url = addMovieParams(activeUrl || trimSlash(MANIYA_API_BASE) + '/videos', object.movie, object);
      if (activeSeason !== null) url = Lampa.Utils.addUrlComponent(url, 'season=' + encodeURIComponent(activeSeason));
      if (activeVoice !== null) url = Lampa.Utils.addUrlComponent(url, 'voice=' + encodeURIComponent(activeVoice));
      requestJson(network, url, function (json) {
        if (json.error === 'subscription_required') return self.empty(json.message);
        self.setFilters(json);
        self.draw(normalizeItems(json));
      }, function () {
        self.empty(Lampa.Lang.translate('maniya_no_results'));
      });
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
      var selectedVoice = '';
      var selectedSeason = '';

      if (json && json.voices && json.voices.length) {
        voiceIndexes = json.voices.map(function (voice) { return voice.index; });
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
      if (!items.length) return this.empty(Lampa.Lang.translate('maniya_no_results'));

      function render() {
        if (Z01_UI_OK) self.uiFrame();
        else scroll.clear();
        items.forEach(function (item, index) {
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

    this.back = function () { Lampa.Activity.backward(); };
    this.pause = function () {};
    this.stop = function () {};
    this.destroy = function () {
      uiPollStop();
      network.clear();
      files.destroy();
      scroll.destroy();
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
      '.z01{display:block;width:100%}' +
      '.z01-hero{position:relative;overflow:hidden;border-radius:1.2em;margin-bottom:1.7em;background:rgba(255,255,255,.06);min-height:13em}' +
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
      '.z01-card__thumb{position:relative;width:10.5em;height:5.9em;flex-shrink:0;border-radius:.5em;overflow:hidden;background:rgba(0,0,0,.35)}' +
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
      '.z01-card--file .z01-card__thumb{width:4.4em;height:4.4em}' +
      '.z01-card.focus .z01-card__line .time-line>div{background:#000}' +
      // ── Загрузочная панель опроса (SKAZ onlines.js uiLoadingPanel: .z01-loading + .z01-skeleton) ──
      '.z01-loading{padding:1.4em 0 .6em}' +
      '.z01-loading__title{font-size:1.05em;letter-spacing:.12em;text-transform:uppercase;opacity:.6;margin-bottom:.8em}' +
      '.z01-loading__bar{position:relative;height:.3em;border-radius:.3em;background:rgba(255,255,255,.12);margin-bottom:.6em;overflow:hidden}' +
      '.z01-loading__bar>div{height:100%;background:linear-gradient(90deg,#ffb23e,#f58a1b);-webkit-transition:width .3s;transition:width .3s}' +
      '.z01-loading__text{font-size:.95em;opacity:.5}' +
      '.z01-skeleton{padding:.4em 0}' +
      '.z01-skeleton__row{display:flex;align-items:center;padding:.7em 0}' +
      '.z01-skeleton__thumb{width:10.5em;height:5.9em;border-radius:.5em;background:rgba(255,255,255,.07);flex-shrink:0;-webkit-animation:z01skeleton 1.2s ease-in-out infinite;animation:z01skeleton 1.2s ease-in-out infinite}' +
      '.z01-skeleton__body{flex:1 1 auto;padding:0 0 0 1.2em}' +
      '.z01-skeleton__line{height:1em;border-radius:.3em;background:rgba(255,255,255,.07);margin-bottom:.8em;-webkit-animation:z01skeleton 1.2s ease-in-out infinite;animation:z01skeleton 1.2s ease-in-out infinite}' +
      '.z01-skeleton__line--short{width:60%}' +
      '@-webkit-keyframes z01skeleton{0%,100%{opacity:1}50%{opacity:.4}}@keyframes z01skeleton{0%,100%{opacity:1}50%{opacity:.4}}' +
      '@media screen and (max-width:580px){' +
      '.z01-hero__body{max-width:100%;padding:1.3em}' +
      '.z01-hero__title{font-size:1.7em}' +
      '.z01-hero__descr{display:none}' +
      '.z01-hero__shade{background:-webkit-linear-gradient(top,rgba(10,11,17,.55) 0%,rgba(10,11,17,.94) 60%);background:linear-gradient(180deg,rgba(10,11,17,.55) 0%,rgba(10,11,17,.94) 60%)}' +
      '.z01-card__thumb{width:7em;height:4.4em}' +
      '.z01-card__side{display:none}' +
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
      maniya_quality: { ru: 'Выбор качества', en: 'Select quality' },
      maniya_watch_quality: { ru: 'Смотреть', en: 'Watch' },
      maniya_episode: { ru: 'Серия', en: 'Episode' },
      maniya_no_results: { ru: 'Видео не найдено', en: 'Video not found' },
      maniya_nolink: { ru: 'Не удалось получить ссылку', en: 'Failed to fetch link' },
      maniya_empty_sources: { ru: 'Нет доступных источников', en: 'No available sources' },
      maniya_more_sources: { ru: 'Ещё {count}', en: 'More {count}' },
      maniya_items_count: { ru: 'Вариантов: {n}', en: 'Items: {n}' },
      maniya_continue: { ru: 'Продолжить', en: 'Continue' },
      maniya_server_error: { ru: 'Сервер Maniya Online не отвечает', en: 'Maniya Online server is not responding' },
      maniya_polling_start: { ru: 'Опрашиваем источники', en: 'Polling sources' },
      maniya_polling_found: { ru: 'Найдено источников: {n}', en: 'Sources found: {n}' },
      maniya_sec: { ru: 'с', en: 's' },
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
      resolveVideosUrl: resolveVideosUrl
    };
  }
})();
