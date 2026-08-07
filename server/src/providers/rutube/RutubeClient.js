import { HttpError } from '../../errors.js';

const DEFAULT_HOST = 'https://rutube.ru';

/**
 * Клиент RutubeMovie — перенос Lampac Controller.cs (RutubeMovie).
 *
 * - search(): JSON-поиск фильмов (`api/search/video/?content_type=video&duration=movie`).
 * - playOptions(linkid): JSON play/options → `video_balancer.m3u8`.
 *
 * Никакой фильтрации/декоада — только fetch и отдача сырых DTO клиенту.
 */
export class RutubeClient {
  constructor(options = {}) {
    this.host = trimSlash(options.host || process.env.RUTUBE_HOST || DEFAULT_HOST);
    this.fetchImpl = options.fetchImpl || fetch;
  }

  enabled() {
    return true;
  }

  async search({ title = '', year = 0 } = {}) {
    if (!title) return [];

    const url = new URL('api/search/video/', `${this.host}/`);
    url.searchParams.set('content_type', 'video');
    url.searchParams.set('duration', 'movie');
    url.searchParams.set('query', `${title} ${year}`);

    const data = await this.getJson(url);
    return Array.isArray(data?.results) ? data.results : [];
  }

  async playOptions(linkid) {
    if (!linkid) throw new HttpError(400, 'rutube_link_required', 'Rutube linkid is required');

    const url = new URL(`api/play/options/${encodeURIComponent(String(linkid))}/`, `${this.host}/`);
    url.searchParams.set('no_404', 'true');
    url.searchParams.set('referer', '');
    url.searchParams.set('pver', 'v2');
    url.searchParams.set('client', 'wdp');

    const data = await this.getJson(url);
    return String(data?.video_balancer?.m3u8 || '').trim();
  }

  async getJson(url) {
    const response = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new HttpError(response.status, 'rutube_http_error', `Rutube HTTP ${response.status}`);
    return response.json();
  }
}

function trimSlash(value) {
  return String(value).replace(/\/+$/, '');
}