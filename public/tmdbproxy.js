(function () {
  'use strict';

  // TMDB-PROXY-FIX-001: Maniya TMDB relay — клиентская подмена Lampa.TMDB.api /
  // Lampa.TMDB.image, чтобы TMDB-трафик (API + постеры) шёл через Maniya и клиенту
  // без VPN не нужно было ходить на api.themoviedb.org / image.tmdb.org напрямую.
  // Модель — эталон Lampac Modules/Proxy/TmdbProxy/plugin.js.
  //
  // Совместимость с уже установленным TMDB-прокси (TMDB PROXY COMPATIBILITY):
  //   • guard/marker (window.MANIYA_TMDB_PROXY + метки на функциях) → повторная
  //     загрузка/повторная установка плагина НЕ оборачивает методы повторно,
  //     бесконечная цепочка обёрток невозможна ни при каком порядке загрузки;
  //   • когда Lampa-переключатель proxy_tmdb ВКЛЮЧЁН — Maniya возвращает СВОЙ URL
  //     НАПРЯМУЮ и НЕ вызывает то, что было под нами → нет цепочки «прокси внутри
  //     прокси» (один хоп до Maniya, дальше сервер сам идёт в TMDB);
  //   • когда proxy_tmdb ВЫКЛЮЧЕН — делегируем СОХРАНЁННОЙ функции (родной Lampa
  //     или пользовательский TMDB-плагин, который был до нас) — его логика не
  //     ломается, а Maniya просто не активен в этом режиме;
  //   • перехватываются ТОЛЬКО Lampa.TMDB.api / Lampa.TMDB.image. Обычные
  //     HTTP-запросы Lampa, Skaz, Lampac, Kinopub, Rutube, VKMovie и прочие
  //     провайдеры не затрагиваются
  //   (это НЕ перехват сети — мы меняем только два метода построения URL).

  if (!window.Lampa || !Lampa.TMDB) return;
  if (window.MANIYA_TMDB_PROXY) return;
  window.MANIYA_TMDB_PROXY = true;

  var HOST = 'https://plugin.maniya-kvn.online';
  var API_BASE = HOST + '/api/lampa/tmdb/api/3/';
  var IMG_BASE = HOST + '/api/lampa/tmdb/img/';

  var ORIGINAL_API = Lampa.TMDB.api;
  var ORIGINAL_IMAGE = Lampa.TMDB.image;

  function proxyEnabled() {
    try {
      var store = Lampa.Storage;
      var value = typeof store.field === 'function'
        ? store.field('proxy_tmdb')
        : (typeof store.get === 'function' ? store.get('proxy_tmdb', '') : '');
      return !!value;
    } catch (e) {
      return false;
    }
  }

  function readToken() {
    try {
      var stored = Lampa.Storage.get('maniya_token', '') || Lampa.Storage.get('lampac_token', '') || '';
      if (stored) return stored;
    } catch (e) {}
    try {
      if (window.MANIYA_ONLINE_TOKEN) return window.MANIYA_ONLINE_TOKEN;
    } catch (e) {}
    return '';
  }

  function readEmail() {
    try {
      return Lampa.Storage.get('account_email', '');
    } catch (e) {
      return '';
    }
  }

  /** Служебные account-параметры (token/account_email) — как Lampac-эталон; сервер выкинет их перед апстримом. */
  function account(url) {
    url = String(url || '');
    var token = readToken();
    if (token && url.indexOf('token=') === -1) {
      url = Lampa.Utils.addUrlComponent(url, 'token=' + encodeURIComponent(token));
    }
    var email = readEmail();
    if (email && url.indexOf('account_email=') === -1) {
      url = Lampa.Utils.addUrlComponent(url, 'account_email=' + encodeURIComponent(email));
    }
    return url;
  }

  /** Отбрасывает возможный абсолютный origin, оставляет только путь+query. */
  function tmdbPath(url) {
    return String(url || '').replace(/^https?:\/\/[^/]+/i, '');
  }

  function wrap(method, base) {
    var original = method === 'api' ? ORIGINAL_API : ORIGINAL_IMAGE;
    var wrapped = function (url) {
      if (proxyEnabled()) return account(base + tmdbPath(url));
      return typeof original === 'function' ? original(url) : account(base + tmdbPath(url));
    };
    try {
      Object.defineProperty(wrapped, '__maniya_tmdb', { value: true });
    } catch (e) {}
    return wrapped;
  }

  Lampa.TMDB.api = wrap('api', API_BASE);
  Lampa.TMDB.image = wrap('image', IMG_BASE);
})();