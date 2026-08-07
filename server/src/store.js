import { readFile } from 'node:fs/promises';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { validateToken } from './security.js';
import { registeredProviders } from './providers/registry.js';

async function readJson(filePath, fallback) {
  if (!filePath) return fallback;
  try {
    const content = await readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return fallback;
  }
}

function bearerToken(context) {
  const authorization = context.request?.headers?.authorization || '';
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

export async function findUserByRequest(context) {
  const users = await readJson(config.usersFile, []);
  const rawToken = context.query.token || bearerToken(context);
  const token = rawToken ? validateToken(rawToken) : '';
  const email = String(context.query.account_email || '').trim().toLowerCase();

  if (!token && !email) return null;

  return users.find((user) => {
    if (token && user.token === token) return true;
    if (email && user.email && user.email.toLowerCase() === email) return true;
    return false;
  }) || null;
}

export function isSubscriptionActive(user) {
  if (!user || !user.active) return false;
  if (!user.expires_at) return true;
  return new Date(user.expires_at).getTime() > Date.now();
}

export async function requireSubscription(context) {
  const user = await findUserByRequest(context);
  if (!isSubscriptionActive(user)) {
    throw new HttpError(403, 'subscription_required', 'Нужна активная подписка Maniya Online');
  }
  return user;
}

export async function getVideosForRequest(context) {
  const selected = String(context.query.provider || '').trim().toLowerCase();
  const providers = registeredProviders().filter((provider) => provider.enabled() && (!selected || provider.id === selected));
  const videoProviders = providers.filter((provider) => typeof provider.videos === 'function');

  // Один провайдер с расширенным контрактом videos() — отдаём payload
  // с играбельными items и фильтрами сезонов/озвучек.
  if (providers.length === 1 && videoProviders.length === 1) {
    try {
      const payload = await providers[0].videos(context);
      if (payload && Array.isArray(payload.items) && payload.items.length) {
        return { items: payload.items, seasons: payload.seasons || [], voices: payload.voices || [] };
      }
    } catch {
      // Ломается конкретный провайдер — не рвём весь запрос,
      // а уходим на поисковые записи/файл-фолбэк ниже.
    }
  } else if (videoProviders.length > 0) {
    // Несколько провайдеров (или источник без videos()): склеиваем играбельные
    // items со всех, кто умеет videos(). Фильтры не общие — отдаём пустыми.
    const payloads = await Promise.all(videoProviders.map(async (provider) => {
      try {
        return await provider.videos(context);
      } catch {
        return null;
      }
    }));
    const items = payloads.filter(Boolean).flatMap((payload) => (Array.isArray(payload.items) ? payload.items : []));
    if (items.length) return { items, seasons: [], voices: [] };
  }

  const searchProviders = providers.length ? providers : registeredProviders().filter((provider) => provider.enabled());
  const groups = await Promise.all(searchProviders.map(async (provider) => {
    try {
      return await provider.search(context);
    } catch {
      return [];
    }
  }));
  const providerItems = groups.flat();
  if (providerItems.length > 0) return { items: providerItems, seasons: [], voices: [] };
  if (!config.videosFile) return { items: [], seasons: [], voices: [] };

  const videos = await readJson(config.videosFile, { default: [] });
  const key = String(context.query.tmdb_id || context.query.id || '').trim();
  return { items: videos[key] || videos.default || [], seasons: [], voices: [] };
}
