import { HttpError } from '../../errors.js';
import { defaultUserAgent } from '../shared/utils/UserAgent.js';

const DEFAULT_HOST = 'https://plapi.cdnvideohub.com';

// Заголовки как в Lampac ModInit (CDNvideohub) — без них API может 403.
const DEFAULT_HEADERS = {
  referer: 'http://lostfilm5.org',
  origin: 'https://player.cdnvideohub.com',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site'
};

/**
 * Клиент CDNvideohub (VideoHUB) — перенос Lampac Controller.cs.
 *
 * - playlist(kp): `{host}/api/v1/player/sv/playlist?pub=12&aggr=kp&id={kp}`
 *   → `{isSerial, items:[{season, episode, voiceStudio, voiceType, vkId}]}` (или null).
 * - videoHls(vkId): `{host}/api/v1/player/sv/video/{vkId}` → адаптивный HLS
 *   из поля `sources.hlsUrl` (срез текста `"hlsUrl":"..."` как в Lampac,
 *   снятие `u0026`→`&` и `\\`). Пусто, если нет потока.
 *
 * Никакой фильтрации/декоада — только fetch и отдача сырых DTO клиенту.
 */
export class CDNvideohubClient {
  constructor(options = {}) {
    this.host = trimSlash(options.host || process.env.CDNVIDEOHUB_HOST || DEFAULT_HOST);
    this.headers = { ...DEFAULT_HEADERS, 'User-Agent': defaultUserAgent() };
    this.fetchImpl = options.fetchImpl || fetch;
  }

  enabled() {
    return true;
  }

  async playlist(kinopoiskId) {
    const kp = Number(kinopoiskId) || 0;
    if (!kp) return null;

    const url = new URL('/api/v1/player/sv/playlist', `${this.host}/`);
    url.searchParams.set('pub', '12');
    url.searchParams.set('aggr', 'kp');
    url.searchParams.set('id', String(kp));
    return this.getJson(url);
  }

  async videoHls(vkId) {
    const id = String(vkId || '').trim();
    if (!id) return '';

    const url = new URL(`/api/v1/player/sv/video/${encodeURIComponent(id)}`, `${this.host}/`);
    const text = await this.getText(url);
    const match = String(text).match(/"hlsUrl":"([^"]+)"/);
    if (!match) return '';
    return String(match[1]).replace(/u0026/g, '&').replace(/\\/g, '');
  }

  async getJson(url) {
    const response = await this.fetchImpl(url, { headers: this.headers });
    if (response.status === 204) return null;
    if (!response.ok) throw new HttpError(response.status, 'cdnvideohub_http_error', `CDNvideohub HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async getText(url) {
    const response = await this.fetchImpl(url, { headers: this.headers });
    if (response.status === 204) return '';
    if (!response.ok) throw new HttpError(response.status, 'cdnvideohub_http_error', `CDNvideohub HTTP ${response.status}`);
    return response.text();
  }
}

function trimSlash(value) {
  return String(value).replace(/\/+$/, '');
}
