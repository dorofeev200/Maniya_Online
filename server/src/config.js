import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(__dirname, '..');
const rootDir = path.join(serverDir, '..');

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const rows = readFileSync(filePath, 'utf8').split(/\r?\n/);

  for (const row of rows) {
    const line = row.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(path.join(rootDir, '.env'));
loadDotEnv(path.join(serverDir, '.env'));

function integer(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function bool(name, fallback = false) {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function list(name, fallback = []) {
  const value = process.env[name];
  if (!value) return fallback;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function resolvePath(value) {
  if (!value) return '';
  if (/^file:\/\//i.test(value)) return fileURLToPath(value);
  if (/^\/[A-Za-z]:\//.test(value)) return value.replace(/^\/([A-Za-z]:)/, '$1');
  return value;
}

export const config = {
  env: process.env.NODE_ENV || 'production',
  host: process.env.HOST || '0.0.0.0',
  port: integer('PORT', 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://plugin.maniya-kvn.online',
  corsOrigins: list('CORS_ORIGINS', ['https://plugin.maniya-kvn.online']),
  rateLimitWindowMs: integer('RATE_LIMIT_WINDOW_MS', 60_000),
  rateLimitMax: integer('RATE_LIMIT_MAX', 120),
  tokenMinLength: integer('TOKEN_MIN_LENGTH', 8),
  usersFile: resolvePath(process.env.USERS_FILE || ''),
  videosFile: resolvePath(process.env.VIDEOS_FILE || ''),
  publicDir: resolvePath(process.env.PUBLIC_DIR || path.join(rootDir, 'public')),
  shutdownTimeoutMs: integer('SHUTDOWN_TIMEOUT_MS', 10_000),
  filmix: {
    enabled: bool('FILMIX_ENABLED', true),
    pro: bool('FILMIX_PRO', false),
    hls: bool('FILMIX_HLS', false),
    host: (process.env.FILMIX_HOST || 'https://filmix.my').replace(/\/+$/, ''),
    tvHost: (process.env.FILMIX_TV_HOST || 'https://api.filmix.tv').replace(/\/+$/, ''),
    token: (process.env.FILMIX_TOKEN || '').trim()
  },
  rezka: {
    enabled: bool('REZKA_ENABLED', true),
    baseUrl: (process.env.REZKA_BASE_URL || 'https://rezka.ag').replace(/\/+$/, ''),
    login: (process.env.REZKA_LOGIN || '').trim(),
    password: process.env.REZKA_PASSWORD || '',
    premium: bool('REZKA_PREMIUM', false),
    hls: bool('REZKA_HLS', false),
    // CDN-хосты Rezka по умолчанию (суффиксное сопоставление в proxy:
    // "voidboost.one" покрывает stream.voidboost.one и т.д.). Расширяется
    // REZKA_ALLOW_HOSTS, если Rezka сменит CDN.
    allowHosts: list('REZKA_ALLOW_HOSTS', ['voidboost.one', 'voidboost.com', 'hdrezka.me'])
  },
  kodik: {
    enabled: bool('KODIK_ENABLED', true),
    apiHost: (process.env.KODIK_API_HOST || 'https://kodik-api.com').replace(/\/+$/, ''),
    linkHost: (process.env.KODIK_LINK_HOST || 'https://kodikres.com').replace(/\/+$/, ''),
    playerHost: (process.env.KODIK_PLAYER_HOST || 'https://kodikplayer.com').replace(/\/+$/, ''),
    // Публичный токен Kodik-info (https://kodik.info/developer/). Без него
    // провайдер скрыт (enabled() = false). Приватный secret_token включает
    // прямой маршрут /api/video-links (HMAC) вместо парсинга плеера.
    token: (process.env.KODIK_TOKEN || '').trim(),
    secretToken: (process.env.KODIK_SECRET_TOKEN || '').trim()
  },
  alloha: {
    enabled: bool('ALLOHA_ENABLED', true),
    // API-хост (поиск/детали). По умолчанию — как в Lampac ModInit.
    apiHost: (process.env.ALLOHA_API_HOST || 'https://apbugall.org/v2').replace(/\/+$/, ''),
    // Linkhost для /direct (стримы) — отдельный хост, на api-хосте /direct 404.
    linkHost: (process.env.ALLOHA_LINK_HOST || 'https://torso-as.stloadi.live').replace(/\/+$/, ''),
    // Bearer-токен для API поиска/деталей (обязателен → TOKEN_REQUIRED без него).
    token: (process.env.ALLOHA_TOKEN || '').trim(),
    // Секретный ключ для /direct. Если не задан — берётся тот же token.
    secretToken: (process.env.ALLOHA_SECRET_TOKEN || '').trim()
  },
  proxy: {
    allowHosts: list('PROXY_ALLOW_HOSTS', ['filmix.my', 'filmix.gg', 'filmix.tv', 'filmix.pub', 'filmix.fm', 'filmix.ac', 'werkecdn.me', 'cdnsqu.com', 'kodikres.com', 'stloadi.live']),
    timeoutMs: integer('PROXY_TIMEOUT_MS', 15_000),
    maxRedirects: integer('PROXY_MAX_REDIRECTS', 4)
  }
};

// CDN-хосты Rezka разрешаем в прокси (дедуп по регистру). Живой CDN-хост
// (из ответа get_movie/get_stream) добавляется сюда на live-валидации.
{
  const extra = [...config.rezka.allowHosts, 'rezka.ag'];
  const merged = [...config.proxy.allowHosts];
  for (const host of extra) {
    const key = String(host).toLowerCase();
    if (!merged.some((entry) => String(entry).toLowerCase() === key)) merged.push(host);
  }
  config.proxy.allowHosts = merged;
}

export function isProduction() {
  return config.env === 'production';
}
