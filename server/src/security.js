import { config } from './config.js';
import { HttpError } from './errors.js';

const buckets = new Map();

export function clientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return request.socket.remoteAddress || 'unknown';
}

export function corsHeaders(origin) {
  const allowed = !origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin);
  const headers = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };

  if (allowed) headers['Access-Control-Allow-Origin'] = origin || config.corsOrigins[0] || '*';
  return { allowed, headers };
}

export function assertCorsAllowed(request) {
  const origin = request.headers.origin;
  const { allowed } = corsHeaders(origin);
  if (!allowed) throw new HttpError(403, 'cors_forbidden', 'Origin is not allowed');
}

export function assertRateLimit(request) {
  const now = Date.now();
  const ip = clientIp(request);
  const bucket = buckets.get(ip) || { resetAt: now + config.rateLimitWindowMs, count: 0 };

  if (bucket.resetAt <= now) {
    bucket.resetAt = now + config.rateLimitWindowMs;
    bucket.count = 0;
  }

  bucket.count += 1;
  buckets.set(ip, bucket);

  if (bucket.count > config.rateLimitMax) {
    throw new HttpError(429, 'rate_limited', 'Too many requests');
  }
}

export function validateToken(value) {
  const token = String(value || '').trim();
  if (!token) throw new HttpError(401, 'token_required', 'Token is required');
  if (token.length < config.tokenMinLength) throw new HttpError(400, 'token_invalid', 'Token is invalid');
  if (!/^[A-Za-z0-9._:-]+$/.test(token)) throw new HttpError(400, 'token_invalid', 'Token contains unsupported characters');
  return token;
}
