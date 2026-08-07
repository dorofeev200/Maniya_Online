import crypto from 'node:crypto';
import { HttpError } from '../../errors.js';

const DEFAULT_API_HOST = 'https://kodik-api.com';
const DEFAULT_LINK_HOST = 'https://kodikres.com';
const DEFAULT_PLAYER_HOST = 'https://kodikplayer.com';

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

  /**
   * Поиск по внешним id — аналог KodikInvoke.Embed(imdb_id, kinopoisk_id, s).
   * Отдельный запрос на kinopoisk_id и/или imdb_id, результаты склеиваются
   * и дедуплицируются по id. season добавляется только в id-запрос.
   */
  async searchByIds({ kinopoiskId = 0, imdbId = '', season = 0 } = {}) {
    if (!this.token) throw new HttpError(503, 'kodik_token_required', 'Kodik token is not configured');

    const normalizedKp = Number(kinopoiskId) || 0;
    const normalizedImdb = String(imdbId || '').trim();
    if (!normalizedKp && !normalizedImdb) return [];

    const base = new URL('/search', `${this.apiHost}/`);
    base.searchParams.set('token', this.token);
    base.searchParams.set('limit', '100');
    base.searchParams.set('with_episodes', 'true');
    if (Number(season) > 0) base.searchParams.set('season', String(season));

    const results = [];
    if (normalizedKp) results.push(...await this.searchUrl(this.withParam(base, 'kinopoisk_id', normalizedKp)));
    if (normalizedImdb) results.push(...await this.searchUrl(this.withParam(base, 'imdb_id', normalizedImdb)));

    return dedupeById(results);
  }

  /**
   * Поиск по названию — аналог KodikInvoke.Embed(title, original_title, clarification):
   * title-параметр берёт original_title первым, with_material_data=true для постеров.
   */
  async searchByTitle({ title = '', originalTitle = '' } = {}) {
    if (!this.token) throw new HttpError(503, 'kodik_token_required', 'Kodik token is not configured');

    const query = String(originalTitle || title || '').trim();
    if (!query) return [];

    const url = new URL('/search', `${this.apiHost}/`);
    url.searchParams.set('token', this.token);
    url.searchParams.set('limit', '100');
    url.searchParams.set('title', query);
    url.searchParams.set('with_episodes', 'true');
    url.searchParams.set('with_material_data', 'true');

    return this.searchUrl(url);
  }

  async searchUrl(url) {
    const data = await this.getJson(url);
    return Array.isArray(data?.results) ? data.results : [];
  }

  withParam(url, key, value) {
    const copy = new URL(url);
    copy.searchParams.set(key, String(value));
    return copy;
  }

  async streams(link, { ip = '127.0.0.1' } = {}) {
    if (!link) throw new HttpError(400, 'kodik_link_required', 'Kodik link is required');
    if (this.secretToken) return this.directStreams(link, ip);
    return this.parsePlayer(link);
  }

  async directStreams(link, ip) {
    // d — как в Lampac Controller.cs: AddHours(4).ToString("yyyyMMddHH"),
    // HMAC-сообщение: link:ip:d.
    const deadline = deadlineFormat(new Date(Date.now() + 4 * 3600 * 1000));
    const signature = crypto.createHmac('sha256', this.secretToken).update(`${link}:${ip}:${deadline}`).digest('hex');
    const url = new URL('/api/video-links', `${this.linkHost}/`);
    url.searchParams.set('link', link);
    url.searchParams.set('p', this.token);
    url.searchParams.set('ip', ip);
    url.searchParams.set('d', deadline);
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

function deadlineFormat(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}`;
}

function dedupeById(results) {
  const seen = new Set();
  return results.filter((item) => {
    if (!item || item.id == null || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
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
