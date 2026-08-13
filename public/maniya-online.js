(function () {
  'use strict';

  var MANIYA_API_BASE = 'https://plugin.maniya-kvn.online/api/lampa';
  var COMPONENT = 'maniya_online';
  var PLUGIN_FLAG = 'maniya_online_plugin_started';

  if (window[PLUGIN_FLAG]) return;
  window[PLUGIN_FLAG] = true;

  function trimSlash(value) {
    return (value || '').replace(/\/+$/, '');
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
    var token = Lampa.Storage.get('maniya_token', '') || Lampa.Storage.get('lampac_token', '') || '';

    if (!token) {
      try {
        token = window.localStorage ? (localStorage.getItem('maniya_token') || localStorage.getItem('lampac_token') || '') : '';
      } catch (e) {}
    }

    return token;
  }

  function persistToken(token) {
    token = (token || '').trim();
    if (!token) return '';

    Lampa.Storage.set('maniya_token', token);

    try {
      if (window.localStorage) localStorage.setItem('maniya_token', token);
    } catch (e) {}

    return token;
  }

  function getTokenFromRuntime() {
    if (window.MANIYA_ONLINE_TOKEN) return window.MANIYA_ONLINE_TOKEN;
    if (window.maniya_online_token) return window.maniya_online_token;
    if (window.maniyaOnlineToken) return window.maniyaOnlineToken;
    return '';
  }

  function getQueryParam(name) {
    return readParamFromUrl(location.href, name) || getScriptUrlToken(name);
  }

  function ensureUid() {
    var uid = Lampa.Storage.get('maniya_unic_id', '');
    if (!uid) {
      uid = Lampa.Utils.uid(8).toLowerCase();
      Lampa.Storage.set('maniya_unic_id', uid);
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
   * ЕДИНАЯ отображаемая подпись источника: «🎬 Allo-XA - 4K».
   * icon/quality_label приходят из мета-реестра сервера (meta.js) отдельными
   * полями — эмодзи НЕ вшивается в id/название провайдера, здесь только
   * визуальная склейка. Неизвестный источник → fallback-иконка 🎬.
   * Чистый отображение-слой: сортировка источников (filterSources) не зависит
   * от этой подписи, остаётся стабильной.
   */
  function sourceLabel(source, fallbackName) {
    var name = (source && source.name) || fallbackName || '';
    var icon = (source && source.icon) || '🎬';
    var quality = (source && source.quality_label) || '';
    var label = icon + ' ' + name;
    if (quality) label += ' - ' + quality;
    return label;
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
        self.loadVideos();
      }, function () {
        self.empty(Lampa.Lang.translate('maniya_server_error'));
      });
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

    this.changeSource = function (key) {
      if (!sources[key]) return;
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
        scroll.clear();
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
      seasonList.forEach(function (season) {
        getSeasonEpisodes(season, function (episodes) {
          episodesBySeason[season] = episodes || [];
          pending -= 1;
          if (pending > 0) return;
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
          render();
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
      '@media (max-width:640px){.maniya-status{font-size:.92em;gap:.4em .55em}}' +
      '@media (max-width:420px){.maniya-status{padding:.5em .65em;margin:.25em 0 .8em}}' +
    '</style>');
    $('body').append(Lampa.Template.get('maniya_css', {}, true));
    Lampa.Template.add('maniya_content_loading', '<div class="online-empty"><div class="broadcast__scan"><div></div></div></div>');
    Lampa.Template.add('maniya_video_item', '<div class="maniya-online-item selector"><div class="maniya-online-item__poster-block">{poster_block}</div><div class="maniya-online-item__body"><div class="maniya-online-item__title">{title}</div><div class="maniya-online-item__info">{info}</div><div class="maniya-online-item__qualities">{qualities_html}</div></div></div>');
    Lampa.Template.add('maniya_empty', '<div class="maniya-online-empty"><div class="maniya-online-empty__title">{title}</div><div class="maniya-online-empty__message">{message}</div></div>');
  }

  function addLang() {
    Lampa.Lang.add({
      title_maniya: { ru: 'Maniya Online', en: 'Maniya Online' },
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
      maniya_server_error: { ru: 'Сервер Maniya Online не отвечает', en: 'Maniya Online server is not responding' },
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
      name: 'Maniya Online',
      description: 'Плагин Maniya Online для просмотра доступных источников по подписке',
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
      sourceLabel: sourceLabel
    };
  }
})();
