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
      filter.onSelect = function (type, item) {
        if (type === 'sort') {
          Lampa.Select.close();
          self.changeSource(item.source);
        } else if (type === 'season') {
          activeSeason = item.value;
          self.loadVideos();
        } else if (type === 'voice') {
          activeVoice = item.value;
          self.loadVideos();
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
          sources[key] = {
            name: item.name || key,
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
          title: sources[key].name,
          source: key,
          selected: key === activeSource,
          ghost: !sources[key].show
        };
      }));
      filter.chosen('sort', [sources[activeSource].name]);
    };

    this.changeSource = function (key) {
      if (!sources[key]) return;
      activeSource = key;
      activeUrl = sources[key].url;
      Lampa.Storage.set('maniya_online_source', key);
      this.updateFilter();
      this.loadVideos();
    };

    this.loadVideos = function () {
      var self = this;
      this.reset();
      var url = addMovieParams(activeUrl || trimSlash(MANIYA_API_BASE) + '/videos', object.movie, object);
      if (activeSeason) url = Lampa.Utils.addUrlComponent(url, 'season=' + encodeURIComponent(activeSeason));
      if (activeVoice) url = Lampa.Utils.addUrlComponent(url, 'voice=' + encodeURIComponent(activeVoice));
      requestJson(network, url, function (json) {
        if (json.error === 'subscription_required') return self.empty(json.message);
        self.setFilters(json);
        self.draw(normalizeItems(json));
      }, function () {
        self.empty(Lampa.Lang.translate('maniya_no_results'));
      });
    };

    this.setFilters = function (json) {
      if (json && json.seasons && json.seasons.length) {
        var seasons = json.seasons.map(function (season) {
          return {
            title: season.title || Lampa.Lang.translate('maniya_season') + ' ' + season.number,
            value: season.number,
            selected: activeSeason !== null && String(season.number) === String(activeSeason)
          };
        });
        if (activeSeason === null) seasons[0].selected = true;
        filter.set('season', seasons);
      }

      if (json && json.voices && json.voices.length) {
        var voices = json.voices.map(function (voice) {
          return {
            title: voice.name,
            value: voice.index,
            selected: activeVoice !== null && String(voice.index) === String(activeVoice)
          };
        });
        if (activeVoice === null) voices[0].selected = true;
        filter.set('voice', voices);
      }
    };

    this.reset = function () {
      network.clear();
      scroll.clear();
      scroll.reset();
      scroll.body().append(Lampa.Template.get('maniya_content_loading'));
    };

    this.draw = function (items) {
      var self = this;
      if (!items.length) return this.empty(Lampa.Lang.translate('maniya_no_results'));

      scroll.clear();
      items.forEach(function (item, index) {
        if (!item.title) {
          if (item.episode || item.series) {
            item.title = Lampa.Lang.translate('maniya_episode') + ' ' + (item.episode || index + 1);
          } else {
            // Фильм, серий нет — не рисуем «Серия N», что при отсутствии title
            // вводит пользователя в заблуждение. Показываем озвучку/качество/индекс.
            item.title = item.voice_name || item.quality || String(index + 1);
          }
        }
        item.info = item.voice_name || item.quality || sources[activeSource].name;
        item.time = item.time || '';
        item.quality_label = item.quality_label || '';
        item.qualities_html = qualityChips(item);

        var html = Lampa.Template.get('maniya_video_item', item);
        if (!item.qualities_html) html.find('.maniya-online-item__qualities').remove();
        html.on('hover:enter', function () {
          self.play(item);
        }).on('hover:focus', function (event) {
          last = event.target;
          scroll.update($(event.target), true);
        });

        scroll.append(html);
      });

      this.loading(false);
      Lampa.Controller.enable('content');
    };

    this.play = function (item) {
      var self = this;
      var entries = qualityEntries(item);

      // Если у потока ≥2 варианта качества — показываем нативный селектор (#10);
      // D-pad: Lampa.Select фокусируется кнопками ТВ, выбор = «Смотреть <качество>».
      if (entries.length >= 2) return this.chooseQuality(item, entries);

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

    /** Селектор качества: список вариантов → «Смотреть <label>» (конкретный URL). */
    this.chooseQuality = function (item, entries) {
      var self = this;
      Lampa.Select.open({
        title: item.title || Lampa.Lang.translate('maniya_quality'),
        items: entries.slice().sort(function (a, b) {
          return qualityPriority(b.label) - qualityPriority(a.label);
        }).map(function (entry) {
          return {
            title: Lampa.Lang.translate('maniya_watch_quality') + ' ' + entry.label,
            onSelect: function () {
              Lampa.Select.close();
              self.runPlayer(item, { url: entry.url, quality: item.quality });
            }
          };
        })
      });
    };

    this.runPlayer = function (item, stream) {
      if (!stream || !stream.url) return Lampa.Noty.show(Lampa.Lang.translate('maniya_nolink'));

      var play = {
        title: item.title,
        url: stream.url,
        quality: stream.quality || item.quality,
        subtitles: stream.subtitles || item.subtitles,
        headers: stream.headers,
        timeline: item.timeline,
        season: item.season,
        episode: item.episode,
        voice_name: item.voice_name,
        isonline: true
      };

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
      '.maniya-online-item{position:relative;border-radius:.3em;background:rgba(0,0,0,.3);padding:1.2em;margin-bottom:1em}' +
      '.maniya-online-item__title{font-size:1.5em}.maniya-online-item__info{margin-top:.5em;opacity:.75}' +
      '.maniya-online-item__qualities{display:flex;flex-wrap:wrap;gap:.4em .5em;margin-top:.55em}' +
      '.maniya-online-item__quality{padding:.12em .65em;border-radius:2em;background:rgba(255,178,62,.16);color:#ffd98f;font-size:.85em;letter-spacing:.02em;line-height:1.35;white-space:nowrap}' +
      '.maniya-online-item.focus::after{content:"";position:absolute;top:-.45em;left:-.45em;right:-.45em;bottom:-.45em;border:.25em solid #fff;border-radius:.6em;pointer-events:none}' +
      '.maniya-online-empty{padding:1.5em;line-height:1.4}.maniya-online-empty__title{font-size:1.8em;margin-bottom:.5em}.maniya-online-empty__message{font-size:1.15em;opacity:.8}' +
      '@media (max-width:640px){.maniya-online-item{padding:1em;margin-bottom:.8em}.maniya-online-item__title{font-size:1.25em}}' +
      '@media (max-width:420px){.maniya-online-item{padding:.85em;margin-bottom:.6em}.maniya-online-item__quality{font-size:.8em}}' +
      '.maniya-online-button{position:relative;width:2.2em;height:2.2em;margin-right:.7em;border-radius:50%;background:radial-gradient(circle at 32% 26%,#ffd98f 0%,#ffb23e 42%,#f58a1b 100%);color:#3a1d02;display:flex;align-items:center;justify-content:center;box-shadow:0 .1em .5em rgba(0,0,0,.38),inset 0 .07em .22em rgba(255,255,255,.5);transition:transform .18s cubic-bezier(.34,1.56,.64,1),box-shadow .18s ease;flex:0 0 auto}' +
      '.maniya-online-button::after{content:"";position:absolute;top:-6%;left:-6%;width:112%;height:112%;border-radius:50%;border:.09em solid rgba(255,255,255,.4);box-shadow:inset 0 .06em .35em rgba(255,255,255,.28),inset 0 -.06em .28em rgba(0,0,0,.15);pointer-events:none}' +
      '.maniya-online-button.focus,.maniya-online-button:hover{transform:scale(1.12);box-shadow:0 0 0 .22em rgba(255,255,255,.6),0 .18em .7em rgba(0,0,0,.45);outline:none}' +
      '.maniya-online-button__m{width:1.5em;height:1.5em;position:relative;z-index:1;filter:drop-shadow(0 .05em .12em rgba(0,0,0,.28));display:flex;align-items:center;justify-content:center}' +
      '.maniya-online-button__svg{width:1.5em;height:1.5em;display:block}' +
      '.maniya-online-button__ring{fill:none;stroke:rgba(255,255,255,.55);stroke-width:5;opacity:1}' +
      '.maniya-online-button__glyph{fill:none;stroke:#3a1d02;stroke-width:12.5;stroke-linecap:round;stroke-linejoin:round}' +
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
    Lampa.Template.add('maniya_video_item', '<div class="maniya-online-item selector"><div class="maniya-online-item__title">{title}</div><div class="maniya-online-item__info">{info}</div><div class="maniya-online-item__qualities">{qualities_html}</div></div>');
    Lampa.Template.add('maniya_empty', '<div class="maniya-online-empty"><div class="maniya-online-empty__title">{title}</div><div class="maniya-online-empty__message">{message}</div></div>');
  }

  function addLang() {
    Lampa.Lang.add({
      title_maniya: { ru: 'Maniya Online', en: 'Maniya Online' },
      maniya_watch: { ru: 'Смотреть в Maniya Online', en: 'Watch in Maniya Online' },
      maniya_source: { ru: 'Источник', en: 'Source' },
      maniya_season: { ru: 'Сезон', en: 'Season' },
      maniya_voice: { ru: 'Озвучка', en: 'Voice' },
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

  // Внутренности «M»-кнопки (логотип Maniya Online): кольцо + SVG-глиф «M».
  function maniyaButtonPart() {
    return (
      '<span class="maniya-online-button__m" aria-hidden="true">' +
        '<svg class="maniya-online-button__svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true">' +
          '<circle class="maniya-online-button__ring" cx="50" cy="50" r="47"></circle>' +
          '<path class="maniya-online-button__glyph" d="M21 80V22l29 33 29-33v58"></path>' +
        '</svg>' +
      '</span>'
    );
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
    requestJson(network, trimSlash(MANIYA_API_BASE) + '/subscription/check', function (json) {
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
      version: '1.0.0',
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
})();
