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

function list(name, fallback = []) {
  const value = process.env[name];
  if (!value) return fallback;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
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
  usersFile: process.env.USERS_FILE || path.join(serverDir, 'data', 'users.json'),
  videosFile: process.env.VIDEOS_FILE || path.join(serverDir, 'data', 'videos.json'),
  publicDir: process.env.PUBLIC_DIR || path.join(rootDir, 'public'),
  shutdownTimeoutMs: integer('SHUTDOWN_TIMEOUT_MS', 10_000)
};

export function isProduction() {
  return config.env === 'production';
}
