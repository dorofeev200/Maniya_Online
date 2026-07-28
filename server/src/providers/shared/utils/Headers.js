import { defaultUserAgent } from './UserAgent.js';

export function buildHeaders(headers = {}) {
  return {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': defaultUserAgent(),
    ...headers
  };
}

export function withReferer(headers, referer) {
  return referer ? { ...headers, Referer: referer } : { ...headers };
}
