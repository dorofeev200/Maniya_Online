import { HttpError } from '../../errors.js';

const DEFAULT_HOST = 'https://rutube.ru';

// Границы поиска: 2 страницы (по 50), кап 120 сырых результатов на один query —
// предсказуемое число HTTP-запросов (поиск «не должен быть бесконтрольным»).
const MAX_PAGES = 2;
const MAX_RESULTS = 120;

/**
 * Клиент RutubeMovie — перенос Lampac Controller.cs (RutubeMovie).
 *
 * - search(query): JSON-поиск фильмов (`api/search/video/?content_type=video&duration=movie`).
 *   Ответ: {current_page, has_next, next, previous, count, results} — идём по `next`
 *   до MAX_PAGES/MAX_RESULTS.
 * - searchAll(queries): несколько вариантов запроса → слитый результат с дедупом по id.
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

  async search(query = '', options = {}) {
    const q = String(query ?? '').trim();
    if (!q) return [];

    const pages = Math.min(Math.max(1, Number(options.maxPages) || MAX_PAGES), MAX_PAGES);
    const cap = Math.min(Math.max(1, Number(options.maxResults) || MAX_RESULTS), MAX_RESULTS);

    const results = [];
    const firstUrl = new URL('api/search/video/', `${this.host}/`);
    firstUrl.searchParams.set('content_type', 'video');
    firstUrl.searchParams.set('duration', 'movie');
    firstUrl.searchParams.set('query', q);

    let url = firstUrl;
    let page = 0;
    while (url && page < pages && results.length < cap) {
      const data = await this.getJson(url);
      const batch = Array.isArray(data?.results) ? data.results : [];
      for (const item of batch) {
        if (results.length >= cap) break;
        results.push(item);
      }
      url = (data?.has_next && typeof data?.next === 'string')
        ? new URL(data.next, this.host)
        : null;
      if (!batch.length) break;
      page += 1;
    }
    return results;
  }

  /** Несколько вариантов запроса → дедуп по id; сбой одного query не роняет остальные. */
  async searchAll(queries = [], options = {}) {
    const seen = new Set();
    const out = [];
    for (const q of queries) {
      let results = [];
      try {
        results = await this.search(q, options);
      } catch {
        continue; // один битый вариант запроса не должен убивать поиск целиком
      }
      for (const item of results) {
        const id = String(item?.id || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(item);
      }
    }
    return out;
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