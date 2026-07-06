import { readFile } from 'node:fs/promises';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { validateToken } from './security.js';

async function readJson(filePath, fallback) {
  try {
    const content = await readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return fallback;
  }
}

export async function findUserByRequest(context) {
  const users = await readJson(config.usersFile, []);
  const token = context.query.token ? validateToken(context.query.token) : '';
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
  const videos = await readJson(config.videosFile, { default: [] });
  const key = String(context.query.tmdb_id || context.query.id || '').trim();
  return videos[key] || videos.default || [];
}
