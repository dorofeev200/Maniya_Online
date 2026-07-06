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
      requestJson(network, url, function (json) {
        if (json.error === 'subscription_required') return self.subscriptionRequired(json.message);
        self.draw(normalizeItems(json));
      }, function () {
        self.empty(Lampa.Lang.translate('maniya_no_results'));
      });
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
        item.title = item.title || item.text || Lampa.Lang.translate('maniya_episode') + ' ' + (item.episode || index + 1);
        item.info = item.voice_name || item.quality || sources[activeSource].name;
        item.time = item.time || '';
        item.quality_label = item.quality_label || '';

        var html = Lampa.Template.get('maniya_video_item', item);
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
    Lampa.Template.add('maniya_css', '<style>.maniya-online-item{position:relative;border-radius:.3em;background:rgba(0,0,0,.3);padding:1.2em;margin-bottom:1em}.maniya-online-item__title{font-size:1.5em}.maniya-online-item__info{margin-top:.5em;opacity:.75}.maniya-online-item.focus::after{content:"";position:absolute;top:-.45em;left:-.45em;right:-.45em;bottom:-.45em;border:.25em solid #fff;border-radius:.6em;pointer-events:none}.maniya-online-empty{padding:1.5em;line-height:1.4}.maniya-online-empty__title{font-size:1.8em;margin-bottom:.5em}.maniya-online-empty__message{font-size:1.15em;opacity:.8}</style>');
    $('body').append(Lampa.Template.get('maniya_css', {}, true));
    Lampa.Template.add('maniya_content_loading', '<div class="online-empty"><div class="broadcast__scan"><div></div></div></div>');
    Lampa.Template.add('maniya_video_item', '<div class="maniya-online-item selector"><div class="maniya-online-item__title">{title}</div><div class="maniya-online-item__info">{info}</div></div>');
    Lampa.Template.add('maniya_empty', '<div class="maniya-online-empty"><div class="maniya-online-empty__title">{title}</div><div class="maniya-online-empty__message">{message}</div></div>');
  }

  function addLang() {
    Lampa.Lang.add({
      title_maniya: { ru: 'Maniya Online', en: 'Maniya Online' },
      maniya_watch: { ru: 'Смотреть в Maniya Online', en: 'Watch in Maniya Online' },
      maniya_source: { ru: 'Источник', en: 'Source' },
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

  function addButton(event) {
    if (event.render.find('.maniya-online-button').length) return;

    var button = $('<div class="full-start__button selector view--online maniya-online-button"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="82" height="82" rx="20" stroke-width="6"></rect><path d="M38 30L70 50L38 70V30Z" fill="currentColor" stroke="none"></path></svg><span>#{title_maniya}</span></div>');
    button = $(Lampa.Lang.translate(button.prop('outerHTML')));
    button.on('hover:enter', function () { openOnline(event.movie); });
    event.render.after(button);
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
        addButton({
          render: event.object.activity.render().find('.view--torrent'),
          movie: event.data.movie
        });
      }
    });

    try {
      if (Lampa.Activity.active().component === 'full') {
        addButton({
          render: Lampa.Activity.active().activity.render().find('.view--torrent'),
          movie: Lampa.Activity.active().card
        });
      }
    } catch (e) {}
  }

  startPlugin();
})();
