import crypto from 'node:crypto';
import { HttpError } from '../../errors.js';

const DEFAULT_API_HOST = 'https://kodikapi.com';
const DEFAULT_LINK_HOST = 'https://kodik.biz';
const DEFAULT_PLAYER_HOST = 'https://kodik.info';

export class KodikClient {
  constructor(options = {}) {
    this.apiHost = trimSlash(options.apiHost || process.env.KODIK_API_HOST || DEFAULT_API_HOST);
    this.linkHost = trimSlash(options.linkHost || process.env.KODIK_LINK_HOST || DEFAULT_LINK_HOST);
    this.playerHost = trimSlash(options.playerHost || process.env.KODIK_PLAYER_HOST || DEFAULT_PLAYER_HOST);
    this.token = options.token || process.env.KODIK_TOKEN || '';
    this.secretToken = options.secretToken || process.env.KODIK_SECRET_TOKEN || '';
    this.fetchImpl = options.fetchImpl || fetch;
  }

  enabled() {
    return Boolean(this.token);
  }

  async search(query) {
    if (!this.token) throw new HttpError(503, 'kodik_token_required', 'Kodik token is not configured');
    const url = new URL('/search', `${this.apiHost}/`);
    url.searchParams.set('token', this.token);
    url.searchParams.set('limit', '100');
    url.searchParams.set('with_episodes', 'true');

    setIfPresent(url, 'title', query.title);
    setIfPresent(url, 'title_orig', query.original_title);
    setIfPresent(url, 'kinopoisk_id', query.kinopoisk_id);
    setIfPresent(url, 'imdb_id', query.imdb_id);
    setIfPresent(url, 'season', query.season);

    return this.getJson(url);
  }

  async streams(link, { ip = '127.0.0.1' } = {}) {
    if (!link) throw new HttpError(400, 'kodik_link_required', 'Kodik link is required');
    if (this.secretToken) return this.directStreams(link, ip);
    return this.parsePlayer(link);
  }

  async directStreams(link, ip) {
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const signature = crypto.createHmac('sha256', this.secretToken).update(`${link}:${ip}:${deadline}`).digest('hex');
    const url = new URL('/api/video-links', `${this.linkHost}/`);
    url.searchParams.set('link', link);
    url.searchParams.set('p', this.token);
    url.searchParams.set('ip', ip);
    url.searchParams.set('d', String(deadline));
    url.searchParams.set('s', signature);
    url.searchParams.set('auto_proxy', 'true');
    url.searchParams.set('skip_segments', 'true');
    return this.getJson(url);
  }

  async parsePlayer(link) {
    const playerUrl = absoluteUrl(link, this.playerHost);
    const html = await this.getText(playerUrl, {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        referer: `${this.playerHost}/`
      }
    });

    const payload = extractPlayerPayload(html);
    if (payload) return payload;

    const apiLink = extractApiLink(html, playerUrl);
    if (!apiLink) throw new HttpError(502, 'kodik_player_parse_failed', 'Unable to parse Kodik player links');
    return this.getJson(apiLink, {
      headers: {
        accept: 'application/json, text/javascript, */*; q=0.01',
        origin: new URL(playerUrl).origin,
        referer: playerUrl,
        'x-requested-with': 'XMLHttpRequest'
      }
    });
  }

  async getJson(url, options = {}) {
    const response = await this.fetchImpl(url, options);
    if (!response.ok) throw new HttpError(response.status, 'kodik_http_error', `Kodik HTTP ${response.status}`);
    return response.json();
  }

  async getText(url, options = {}) {
    const response = await this.fetchImpl(url, options);
    if (!response.ok) throw new HttpError(response.status, 'kodik_http_error', `Kodik HTTP ${response.status}`);
    return response.text();
  }
}

function trimSlash(value) {
  return String(value).replace(/\/+$/, '');
}

function setIfPresent(url, key, value) {
  const normalized = String(value || '').trim();
  if (normalized) url.searchParams.set(key, normalized);
}

function absoluteUrl(link, base) {
  if (/^https?:\/\//i.test(link)) return link;
  return new URL(link, `${base}/`).toString();
}

function extractPlayerPayload(html) {
  const jsonMatch = html.match(/\{\s*"links"\s*:\s*\{[\s\S]*?\}\s*(?:,\s*"segments"\s*:\s*\[[\s\S]*?\])?\s*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function extractApiLink(html, playerUrl) {
  const direct = html.match(/["']([^"']*video-links[^"']*)["']/i)?.[1];
  if (direct) return absoluteUrl(direct.replace(/\\\//g, '/'), playerUrl);

  const ajax = html.match(/["']([^"']*get-video[^"']*)["']/i)?.[1];
  if (ajax) return absoluteUrl(ajax.replace(/\\\//g, '/'), playerUrl);

  return null;
}
