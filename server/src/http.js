import { readFile } from 'node:fs/promises';
import path from 'node:path';

const contentTypes = {
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

export function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}

export async function sendStatic(response, publicDir, pathname) {
  const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^\.{2,}/, '');
  const filePath = path.join(publicDir, safePath === '/' ? 'maniya-online.js' : safePath);

  if (!filePath.startsWith(publicDir)) {
    return sendJson(response, 403, { error: 'forbidden' });
  }

  try {
    const content = await readFile(filePath);
    const type = contentTypes[path.extname(filePath)] || 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': type,
      'Access-Control-Allow-Origin': '*',
      'Content-Length': content.length
    });
    response.end(content);
  } catch (error) {
    sendJson(response, 404, { error: 'not_found' });
  }
}
