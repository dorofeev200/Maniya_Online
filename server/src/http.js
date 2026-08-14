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
 * Отдать плагин для токена (короткая ссылка `/<prefix>_<short>.js`).
 * Вшивает полный токен в window.MANIYA_ONLINE_TOKEN — пользователь вводит
 * короткую ссылку проще длинной `?token=...`.
 */
export async function sendPluginForToken(request, response, token) {
  const pluginPath = path.join(config.publicDir, 'maniya-online.js');
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

/**
 * Страница установки плагина `GET /i/<opaque>` (PLUGIN-INSTALL-001).
 * HTML со ссылкой на реальный JS `/p/<opaque>.js` и кнопкой копирования.
 * НИКОГДА не отдаёт JS и не содержит subscription-токен; Cache-Control no-store
 * (страница привязана к пользователю — кэшировать нельзя).
 */
export function sendInstallPage(request, response, installToken) {
  const pluginUrl = `${config.publicBaseUrl}/p/${String(installToken).toLowerCase()}.js`;
  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>MANIYA ONLINE — установка плагина</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    background: #10151c; color: #e8edf3;
  }
  .card {
    width: 100%; max-width: 460px; background: #1a212b; border: 1px solid #2b3542;
    border-radius: 16px; padding: 24px; box-shadow: 0 8px 24px rgba(0,0,0,.35);
  }
  .brand { font-size: 14px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #7fd1a8; }
  h1 { font-size: 20px; line-height: 1.35; margin: 10px 0 14px; }
  ol { margin: 0 0 18px; padding-left: 20px; font-size: 14px; line-height: 1.7; color: #c6d0dc; }
  .url-wrap { display: flex; gap: 8px; }
  input[readonly] {
    flex: 1; min-width: 0; background: #0e1319; border: 1px solid #33404f; color: #9fd3f5;
    border-radius: 8px; padding: 10px 12px; font-size: 13px; font-family: ui-monospace, Consolas, monospace;
    word-break: break-all;
  }
  button {
    background: #2f9e63; border: none; color: #fff; font-weight: 600; font-size: 14px;
    border-radius: 8px; padding: 10px 16px; cursor: pointer; white-space: nowrap;
  }
  button:active { transform: translateY(1px); }
  #status { margin: 12px 0 0; font-size: 13px; min-height: 18px; }
  #status.ok { color: #7fd1a8; }
  #status.err { color: #e08a8a; }
  .note { margin-top: 16px; font-size: 12px; color: #8b98a8; line-height: 1.6; }
</style>
</head>
<body>
  <main class="card">
    <div class="brand">🎬 MANIYA ONLINE</div>
    <h1>Добавьте плагин в расширения Lampa</h1>
    <ol>
      <li>Нажмите «Скопировать ссылку»</li>
      <li>Откройте Lampa → Настройки → Расширения</li>
      <li>Нажмите «+» и вставьте ссылку</li>
    </ol>
    <div class="url-wrap">
      <input type="text" readonly id="pluginUrl" value="${escapeHtml(pluginUrl)}" aria-label="Ссылка плагина">
      <button id="copyBtn" type="button">Скопировать</button>
    </div>
    <p id="status" role="status"></p>
    <p class="note">Ссылка уникальна и привязана к вашей подписке. Не передавайте её другим.</p>
  </main>
  <script>
    (function () {
      var input = document.getElementById('pluginUrl');
      var btn = document.getElementById('copyBtn');
      var status = document.getElementById('status');
      function setStatus(text, cls) {
        status.textContent = text;
        status.className = cls || '';
      }
      function copy() {
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(input.value).then(function () {
            setStatus('✅ Ссылка скопирована', 'ok');
          }, function () { legacyCopy(); });
        } else {
          legacyCopy();
        }
      }
      function legacyCopy() {
        input.focus();
        input.select();
        input.setSelectionRange(0, input.value.length);
        try {
          document.execCommand('copy');
          setStatus('✅ Ссылка скопирована', 'ok');
        } catch (e) {
          setStatus('⚠ Не удалось скопировать автоматически — выделите ссылку вручную', 'err');
        }
      }
      btn.addEventListener('click', copy);
      input.addEventListener('click', function () { input.select(); });
    })();
  </script>
</body>
</html>`;
  const { headers } = corsHeaders(request?.headers?.origin);
  response.writeHead(200, {
    ...headers,
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(html)
  });
  response.end(html);
}
