import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { validateToken } from './security.js';
import { registeredProviders, twinFor } from './providers/registry.js';

async function readJson(filePath, fallback) {
  if (!filePath) return fallback;
  try {
    const content = await readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return fallback;
  }
}

export async function writeUsers(users) {
  if (!config.usersFile) throw new HttpError(500, 'users_file_not_configured', 'USERS_FILE не задан');
  await mkdir(path.dirname(config.usersFile), { recursive: true });
  await writeFile(config.usersFile, JSON.stringify(users, null, 2), 'utf8');
}

export async function listUsers() {
  const users = await readJson(config.usersFile, []);
  return Array.isArray(users) ? users : [];
}

/**
 * Поиск пользователя по суффиксу токена для короткой ссылки плагина
 * `/<prefix>_<short>.js`, где `<short>` — последние N hex-символов полного токена.
 * Возвращает пользователя (его полный токен заканчивается на short) либо null.
 * Длина подаваемого суффикса < min шестн. отсекается (анти-гадалка).
 */
export async function findUserByShortToken(short, min = 8) {
  const s = String(short || '').toLowerCase().trim();
  if (!/^[0-9a-f]+$/.test(s) || s.length < min) return null;
  const users = await listUsers();
  return users.find((u) => {
    const t = String(u.token || '').toLowerCase();
    const sep = t.lastIndexOf('-');
    const hex = sep >= 0 ? t.slice(sep + 1) : t;
    return hex.length >= s.length && hex.endsWith(s);
  }) || null;
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
    const primaryProvider = videoProviders[0];
    const twin = selected ? await twinForPayload(selected, context) : null;

    // Сначала skaz-близнец (мультиязычный контур skaz-кластера, качества
    // 2160/1440/1080/720/480). Native — фоллбэк: если близнец не дал ни одного
    // ВАЛИДНОГО item'а (0 после normalization / все стримы битые), отдаём native.
    // Никогда не объединяем — либо twin, либо native (без дублей).
    const chosen = (twin?.items?.length)
      ? twin
      : (await payloadOrNull(primaryProvider, context))
        || twin
        || null;
    if (chosen?.items?.length) {
      return { items: chosen.items, seasons: chosen.seasons || [], voices: chosen.voices || [] };
    }
  } else if (videoProviders.length > 0) {
    // Несколько провайдеров (или источник без videos()): склеиваем играбельные
    // items со всех, кто умеет videos(). Фильтры не общие — отдаём пустыми.
    // Пустой native дополняется своим skaz-близнецом (без дублей).
    const payloads = await Promise.all(videoProviders.map(async (provider) => {
      const payload = await payloadOrNull(provider, context);
      if (payload?.items?.length) return payload;
      return (await twinForPayload(provider.id, context)) || payload;
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
  // Поисковые записи — это МЕТАДАННЫЕ (id/title/poster), у них нет url/stream.
  // Показывать их как «играбельные» items нельзя: клиент получит мёртвые карточки
  // (Filmix при Cloudflare отдавал список фильмов без ссылок). Оставляем только те,
  // где реально есть прямой URL или поток (напр. Lampac-прокси).
  const providerItems = groups.flat().filter((item) => {
    if (!item || typeof item !== 'object') return false;
    if (typeof item.url === 'string' && item.url) return true;
    if (item.stream && typeof item.stream === 'object') return true;
    if (Array.isArray(item.streams) && item.streams.length) return true;
    if (item.method === 'call' && typeof item.url === 'string') return true;
    return false;
  });
  if (providerItems.length > 0) return { items: providerItems, seasons: [], voices: [] };
  if (!config.videosFile) return { items: [], seasons: [], voices: [] };

  const videos = await readJson(config.videosFile, { default: [] });
  const key = String(context.query.tmdb_id || context.query.id || '').trim();
  return { items: videos[key] || videos.default || [], seasons: [], voices: [] };
}

async function payloadOrNull(provider, context) {
  try {
    return await provider.videos(context);
  } catch {
    return null;
  }
}

/** Скрытый skaz-близнец native-провайдера: его videos() или null. */
async function twinForPayload(nativeId, context) {
  const twin = twinFor(nativeId);
  if (!twin || !twin.enabled()) return null;
  try {
    const payload = await twin.videos(context);
    return payload?.items?.length ? payload : null;
  } catch {
    return null;
  }
}
