import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { corsHeaders } from './security.js';

const contentTypes = {
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

export function sendJson(request, response, statusCode, payload, extraHeaders = {}) {
  const body = statusCode === 204 ? '' : JSON.stringify(payload);
  const { headers } = corsHeaders(request?.headers?.origin);
  response.writeHead(statusCode, {
    ...headers,
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders
  });
  response.end(body);
}

export async function sendStatic(request, response, pathname) {
  const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^\.{2,}/, '');
  const filePath = path.join(config.publicDir, safePath === '/' ? 'maniya-online.js' : safePath);

  if (!filePath.startsWith(config.publicDir)) {
    return sendJson(request, response, 403, { error: 'forbidden' });
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return sendJson(request, response, 404, { error: 'not_found' });

    // PLUGIN-INSTALL-002: JS-плагин из статики отдаём только Lampa; браузеру — stub-текст.
    if (path.extname(filePath) === '.js' && !isLampaRequest(request)) {
      return sendPluginStub(request, response);
    }

    const { headers } = corsHeaders(request.headers.origin);
    response.writeHead(200, {
      ...headers,
      'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=300',
      'Content-Length': fileStat.size
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    sendJson(request, response, 404, { error: 'not_found' });
  }
}

/**
 * Отдать плагин для токена (короткая ссылка `/<prefix>_<short>.js` и тестовый
 * `/staging/<short>.js`). Вшивает полный токен в window.MANIYA_ONLINE_TOKEN —
 * пользователь вводит короткую ссылку проще длинной `?token=...`.
 * file/dir — переопределение сборки (MANIYA-STAGING Phase 17: тестовый плагин
 * читается из config.stagingPublicDir, не из publicDir). Default — PROD-сборка.
 */
export async function sendPluginForToken(request, response, token, file = 'maniya-online.js', dir = config.publicDir) {
  const pluginPath = path.join(dir, file);
  let source;
  try {
    source = await readFile(pluginPath, 'utf8');
  } catch (error) {
    return sendJson(request, response, 404, { error: 'plugin_not_found' });
  }
  const body = `/* Maniya Online — подпись токена сервером */\nwindow.MANIYA_ONLINE_TOKEN=${JSON.stringify(token)};\n` + source;
  const { headers } = corsHeaders(request?.headers?.origin);
  response.writeHead(200, {
    ...headers,
    'Content-Type': 'application/javascript; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}

/**
 * Детекция реального Lampa-клиента (PLUGIN-INSTALL-002/003).
 * 1) UA содержит «Lampa» (нативное приложение/AppleTV дописывают версию).
 * 2) Origin-запрос: Lampa web UI (в т.ч. Media Station X = тот же UI в WKWebView)
 *    при загрузке плагина дописывает `?logged=…&reset=…&origin=bylampa.online`
 *    (дискриминатор подтверждён в прод-логах). Обычный браузер, открывший голую
 *    ссылку, эти параметры не шлёт → stub-текст.
 * Обходится подменой UA/добавлением query — это защита «от случайного открытия
 * в браузере», а не крипто-скрытие кода.
 */
export function isLampaRequest(request) {
  const ua = String(request?.headers?.['user-agent'] || '');
  if (/lampa/i.test(ua)) return true;
  const q = new URL(request.url, 'http://x');
  const origin = q.searchParams.get('origin') || '';
  return origin === 'bylampa.online'
      || (q.searchParams.has('logged')
          && q.searchParams.has('reset'));
}

// Завершающая точка обязательна: Lampa Extension.check (PLUGIN-VERIFY-004) тестирует
// тело голого native-fetch по /Lampa\./ — без точки чек на MSX рисовал хардкод «500 Плагин
// не подтверждён », хотя сервер отвечал 200. Stub по-прежнему текст, а не JS.
export const PLUGIN_STUB_TEXT = 'Добавьте плагин в Расширения Lampa.';

/**
 * Заглушка для браузера (PLUGIN-INSTALL-002): открыл плагин-URL в браузере —
 * видишь простой текст, а не исходник JS. Тот же приём, что и у референса
 * (E-Online). `no-store` — ответ привязан к запросу, кэшировать нельзя.
 */
export function sendPluginStub(request, response, status = 200) {
  const { headers } = corsHeaders(request?.headers?.origin);
  response.writeHead(status, {
    ...headers,
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(PLUGIN_STUB_TEXT)
  });
  response.end(PLUGIN_STUB_TEXT);
}

/**
 * Лоадер плагина (PLUGIN-INSTALL-002): маленький JS, инжектящий <script> со
 * скрытого пути `/x/<install>_<key>.js`, где лежит реальный код. В самом лоадере
 * НЕТ ни полного кода, ни subscription-токена. Скрытый путь случайный (HMAC от
 * install_token по серверному секрету) и не выводится из публичного URL.
 */
export function sendPluginLoader(request, response, hiddenUrl) {
  const body = `(function () {
  'use strict';
  var src = ${JSON.stringify(hiddenUrl)};
  var loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    var s = document.createElement('script');
    s.src = src;
    s.async = true;
    document.head.appendChild(s);
  }
  if (window.appready) { load(); }
  else if (window.Lampa && Lampa.Listener) { Lampa.Listener.follow('app', load); }
  else { load(); }
})();
`;
  const { headers } = corsHeaders(request?.headers?.origin);
  response.writeHead(200, {
    ...headers,
    'Content-Type': 'application/javascript; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}
