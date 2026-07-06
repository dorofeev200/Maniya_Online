import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

async function readJson(name, fallback) {
  try {
    const content = await readFile(path.join(dataDir, name), 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to read ${name}:`, error.message);
    return fallback;
  }
}

export async function findUserByRequest(request) {
  const users = await readJson('users.json', []);
  const token = String(request.query.token || '').trim();
  const email = String(request.query.account_email || '').trim().toLowerCase();

  return users.find((user) => {
    if (token && user.token === token) return true;
    if (email && user.email && user.email.toLowerCase() === email) return true;
    return false;
  });
}

export function isSubscriptionActive(user) {
  if (!user || !user.active) return false;
  if (!user.expires_at) return true;
  return new Date(user.expires_at).getTime() > Date.now();
}

export async function getVideosForRequest(request) {
  const videos = await readJson('videos.json', { default: [] });
  const key = String(request.query.tmdb_id || request.query.id || '').trim();
  return videos[key] || videos.default || [];
}
