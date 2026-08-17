import { HttpError } from '../../errors.js';
import { defaultUserAgent } from '../shared/utils/UserAgent.js';

const DEFAULT_APIHOST = 'https://api.bhcesh.me';
// GAP-013: актуальный Lampac master (Modules/OnlineRUS/Collaps ModInit conf.host)
// ходит на api.luxembd.ws; api.ortified.ws (старый дефолт и то, что отдаёт
// iframe_url поиска) с 2026-08 закрыт на уровне сервера (422 0b для /embed/*).
// Хост переопределяется env COLLAPS_EMBED_HOST (см. .env.example).
const DEFAULT_EMBEDHOST = 'https://api.luxembd.ws';

// Референр/Origin как Lampac ModInit (kinokrad). API возвращает 403 без них.
const DEFAULT_HEADERS = {
  origin: 'https://kinokrad.my',
  referer: 'https://kinokrad.my/',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site',
  accept: '*/*'
};

/**
 * Клиент Collaps — перенос Lampac OnlineRUS/Collaps (Controller/RInvoke).
 *
 * - search(title): `{apihost}/list?token={token}&name=...` → RootSearch
 *   ({results:[{id,name,origin_name,year,poster,type,iframe_url,...}]}).
 * - embed({kinopoisk_id|imdb_id|orid}): перенос Invoke.Embed — HTML-страница
 *   плеера `{embedhost}/embed/{kp|imdb|movie}/{id}`; из неё нормализатор
 *   выдирает source (hls/dasha/dash + audio + cc) или seasons-блок сериала.
 *
 * Embed-хост берём из результата поиска (iframe_url), т.к. apihost отвечает
 * только поиском и не отдаёт embed. Никакой фильтрации — только DTO.
 */
export class CollapsClient {
  constructor(options = {}) {
    this.apihost = trimSlash(options.apihost || process.env.COLLAPS_API_HOST || DEFAULT_APIHOST);
    this.embedHost = trimSlash(options.embedHost || process.env.COLLAPS_EMBED_HOST || DEFAULT_EMBEDHOST);
    this.token = String(options.token || process.env.COLLAPS_TOKEN || '').trim();
    this.headers = { ...DEFAULT_HEADERS, 'User-Agent': defaultUserAgent() };
    this.fetchImpl = options.fetchImpl || fetch;
  }

  enabled() {
    return Boolean(this.token);
  }

  async search(title) {
    if (!this.enabled()) return null;
    const name = String(title || '').trim();
    if (!name) return null;

    const url = new URL('/list', `${this.apihost}/`);
    url.searchParams.set('token', this.token);
    url.searchParams.set('name', name);
    return this.getJson(url);
  }

  /**
   * Достаёт HTML-страницу плеера. Канонические ключи (COLLAPS-FIX-001):
   * kinopoiskId → imdbId → orid. `options.id` НЕ читается как orid — у Maniya это
   * TMDB id, а не collaps-identity (арх-аудит §7.3.2: `/embed/movie/{tmdb}` → 404).
   * Провайдер передаёт только канонические поля (resolveIdentity).
   */
  async embed(options = {}) {
    const kinopoiskId = Number(options.kinopoiskId || options.kp || 0) || 0;
    const imdbId = String(options.imdbId || options.imdb || '').trim();
    const orid = Number(options.orid ?? options.orId ?? 0) || 0;

    const host = options.embedHost || this.embedHost;
    let path;
    if (kinopoiskId > 0) path = `/embed/kp/${kinopoiskId}`;
    else if (imdbId) path = `/embed/imdb/${imdbId}`;
    else if (orid > 0) path = `/embed/movie/${orid}`;
    else return { text: '', embedHost: host };

    const url = new URL(path, `${host}/`);
    return { text: await this.getText(url), embedHost: host };
  }

  async getJson(url) {
    const response = await this.fetchImpl(url, { headers: this.headers });
    if (response.status === 204) return null;
    if (!response.ok) throw this.httpError(response.status);
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async getText(url) {
    const response = await this.fetchImpl(url, { headers: this.headers });
    if (response.status === 204) return '';
    if (!response.ok) throw this.httpError(response.status);
    return response.text();
  }

  /**
   * HttpError с классификацией (COLLAPS-FIX-001 D):
   *  - 404/400/405 → invalid-route (неверная identity/маршрут);
   *  - 403/422/451 → upstream-refusal (host-гейт/rate-limit: контент может быть);
   *  - 5xx → upstream (транзиентный); прочее 4xx → http.
   * Это диагностика для provider_error /videos; глобальная availability-семантика
   * (HARD_REFUSAL_STATUSES) НЕ меняется.
   */
  httpError(status) {
    const kind =
      status === 404 || status === 400 || status === 405 ? 'invalid-route'
      : status === 403 || status === 422 || status === 451 ? 'upstream-refusal'
      : status >= 500 ? 'upstream' : 'http';
    return new HttpError(status, 'collaps_http_error', `Collaps HTTP ${status}`, { kind });
  }
}

function trimSlash(value) {
  return String(value).replace(/\/+$/, '');
}