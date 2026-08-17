import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { validateToken } from './security.js';
import { allProviders, registeredProviders, twinFor } from './providers/registry.js';
import { defaultChecker } from './availability.js';

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

/**
 * Поиск пользователя по opaque install-токену (единая ссылка `/p/<install>.js`
 * и скрытый путь `/x/<install>_<key>.js`). ТОЧНОЕ совпадение (не суффикс!):
 * install-токен случайный (crypto.randomBytes, 24 байта) и НЕ выводится из
 * subscription-токена, поэтому частичное совпадение исключено. Минимальная
 * длина — анти-гадалка. PLUGIN-INSTALL-001/002.
 */
export async function findUserByInstallToken(opaque, min = 32) {
  const s = String(opaque || '').toLowerCase().trim();
  if (!/^[0-9a-f]+$/.test(s) || s.length < min) return null;
  const users = await listUsers();
  return users.find((u) => u.install_token && String(u.install_token).toLowerCase() === s) || null;
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

/**
 * Ленивый резолв `method:"call"` item'а (выбранный голос/серия): провайдер
 * возвращает играбельный дескриптор ровно для ОДНОЙ карточки (resolveVideo),
 * не пересчитывая все голоса заранее — это и есть источник медленного
 * старта (eager-резолв 9 голосов ≈ 4.6s → 1 голос ≈ 0.8s).
 */
export async function getVideoForRequest(context) {
  const selected = String(context.query.provider || '').trim().toLowerCase();
  // Ищем среди ВСЕХ провайдеров (включая скрытые skaz-близнецы): twin-first в
  // /videos отдаёт call items от skaz-<balancer>, и Play обязан их резолвить.
  // Запрос с provider=skaz-rezka НЕ должен падать в 404 только потому, что
  // у native-источника есть видимый одноимённый близнец.
  const provider = selected
    ? allProviders().find((p) => p.enabled() && p.id === selected)
    : null;
  if (!provider || typeof provider.resolveVideo !== 'function') {
    return null;
  }
  return provider.resolveVideo(withPinnedHost(context, provider.id));
}

export async function getVideosForRequest(context) {
  const selected = String(context.query.provider || '').trim().toLowerCase();
  const providers = registeredProviders().filter((provider) => provider.enabled() && (!selected || provider.id === selected));
  const videoProviders = providers.filter((provider) => typeof provider.videos === 'function');

  // Один провайдер с расширенным контрактом videos() — отдаём payload
  // с играбельными items и фильтрами сезонов/озвучек.
  if (providers.length === 1 && videoProviders.length === 1) {
    const primaryProvider = videoProviders[0];

    // Native первым (и для сериалов, и для фильмов), skaz-близнец — фоллбэк.
    // FILMIX-004 (сериалы): близнец в serialVideos хардкодит quality:{} и теряет
    // реальные названия серий (episode.title живёт только в native video-links)
    // → «07 N серия» вместо «07 Название реальной серии».
    // RUTUBE-HD-FIX-001 (фильмы): близнец-первая ветка отдавала `method:"call"`
    // карточки skaz-<balancer> раньше рабочего native, а резолв call на кластере
    // возвращал JSON `quality.auto:null` → клиент видел «не удалось получить
    // ссылку» (rutubemovie: lite/rutubemovie почти везде 503/`disable`). Native
    // для фильмов тоже играбелен (link-страницы play с реальными потоками);
    // близнец остаётся фоллбэком, если native не дал items. Никогда не
    // объединяем — либо twin, либо native (без дублей).
    const serialRequest = isSerialRequest(context.query);
    let chosen = null;
    const native = await payloadOrNull(primaryProvider, context);
    if (native?.items?.length) {
      chosen = native;
    } else if (selected) {
      // Близнец — фоллбэк при пустом native. Если близнеца НЕТ (Collaps,
      // COL-7: не Skaz-source), сохраняем native: он может нести
      // provider_error (классификация 422/404 → upstream-refusal/invalid-route),
      // которую нельзя выбрасывать — иначе клиент/availability видит глухое
      // «нет контента» вместо диагностики (collaps-flap, GAP-002).
      chosen = (await twinForPayload(selected, context)) || native || null;
    }
    if (chosen?.items?.length) {
      const body = { items: chosen.items, seasons: chosen.seasons || [], voices: chosen.voices || [] };
      if (chosen.provider_error) body.provider_error = chosen.provider_error;
      return body;
    }
    // Элементов нет, но есть provider_error (accsdb) — отдаём диагностику клиенту.
    if (chosen?.provider_error) {
      return { items: [], seasons: [], voices: [], provider_error: chosen.provider_error };
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

/**
 * BALANCER-SEMANTICS-005-W1 (§2.4): per-provider пин ноды в query.host.
 * Пин — only-by-uid, только когда карточка (availability) авторитетно нашла
 * контент на конкретной ноде (preferred-first, НЕ жёсткий — провал пина ведёт
 * к ротации в SkazClient). Хост провайдера A не может утечь в B: keyed по
 * providerId, контекст-копия не мутирует общий context. Без context.userUid
 * (SCRIPT-вызовы / не /videos) — контекст как был: пина нет, чистая ротация.
 */
function withPinnedHost(context, providerId) {
  if (!context?.userUid || !providerId) return context;
  const host = defaultChecker.pinnedHost(providerId, context.userUid);
  if (!host) return context;
  return { ...context, query: { ...(context.query || {}), host } };
}

async function payloadOrNull(provider, context) {
  try {
    return await provider.videos(withPinnedHost(context, provider.id));
  } catch {
    return null;
  }
}

/** Скрытый skaz-близнец native-провайдера: его videos() или null. */
async function twinForPayload(nativeId, context) {
  const twin = twinFor(nativeId);
  if (!twin || !twin.enabled()) return null;
  try {
    const payload = await twin.videos(withPinnedHost(context, twin.id));
    return payload?.items?.length ? payload : null;
  } catch {
    return null;
  }
}

/** Запрос сериала (та же сигнатура, что SkazProvider.serialQuery). */
function isSerialRequest(query = {}) {
  const serial = String(query.serial ?? '').trim();
  return serial === '1' || serial === 'true' || serial === 'yes'
    || String(query.type || '').toLowerCase() === 'serial'
    || String(query.serial_type || '').toLowerCase() === 'serial';
}
