import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findUserByRequest, isSubscriptionActive, getVideosForRequest } from './store.js';
import { sendJson, sendStatic } from './http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');
const publicDir = path.join(rootDir, 'public');
const port = Number(process.env.PORT || 3000);
const publicBaseUrl = process.env.PUBLIC_BASE_URL || 'https://plugin.maniya-kvn.online';

function requestContext(request) {
  const url = new URL(request.url, publicBaseUrl);
  return {
    url,
    query: Object.fromEntries(url.searchParams.entries())
  };
}

async function requireSubscription(context, response) {
  const user = await findUserByRequest(context);

  if (!isSubscriptionActive(user)) {
    sendJson(response, 403, {
      error: 'subscription_required',
      active: false,
      message: 'Нужна активная подписка Maniya Online'
    });
    return null;
  }

  return user;
}

async function route(request, response) {
  if (request.method === 'OPTIONS') return sendJson(response, 204, {});
  if (request.method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' });

  const context = requestContext(request);
  const pathname = context.url.pathname;

  if (pathname === '/health') {
    return sendJson(response, 200, { ok: true, service: 'maniya-online-lampa' });
  }

  if (pathname === '/api/lampa/subscription/check') {
    const user = await findUserByRequest(context);
    const active = isSubscriptionActive(user);

    return sendJson(response, 200, {
      active,
      plan: user?.plan || null,
      expires_at: user?.expires_at || null,
      message: active ? 'Подписка Maniya Online активна' : 'Подписка Maniya Online не активна'
    });
  }

  if (pathname === '/api/lampa/sources') {
    const user = await requireSubscription(context, response);
    if (!user) return;

    return sendJson(response, 200, {
      sources: [
        {
          id: 'main',
          name: 'Maniya Online',
          url: `${publicBaseUrl}/api/lampa/videos?source=main`,
          show: true
        }
      ]
    });
  }

  if (pathname === '/api/lampa/videos') {
    const user = await requireSubscription(context, response);
    if (!user) return;

    return sendJson(response, 200, { items: await getVideosForRequest(context) });
  }

  if (pathname === '/api/lampa/stream') {
    const user = await requireSubscription(context, response);
    if (!user) return;

    const url = String(context.query.url || '').trim();
    if (!url) return sendJson(response, 400, { error: 'missing_url', message: 'Не передана ссылка потока' });

    return sendJson(response, 200, { url, headers: {}, subtitles: [] });
  }

  return sendStatic(response, publicDir, pathname);
}

const server = http.createServer((request, response) => {
  route(request, response).catch((error) => {
    console.error(error);
    sendJson(response, 500, { error: 'internal_error' });
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Maniya Online Lampa server listening on port ${port}`);
});
