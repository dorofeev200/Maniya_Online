import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
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
