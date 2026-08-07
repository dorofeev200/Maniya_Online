import { HttpError } from '../../errors.js';
import { defaultUserAgent } from '../shared/utils/UserAgent.js';

const DEFAULT_APIHOST = 'https://apivb.com';
const DEFAULT_FRAMEHOST = 'https://vid1733431681.entouaedon.com';
const DEFAULT_REFERER = 'https://movielab.one/';

// Заголовки для GET iframe-страницы (как Lampac ModInit: referer расшифровывается
// из `encrypt:kwwsv=22prylhode1rqh2` → https://movielab.one/). Без него нода
// отвечает 404 на /movie|/serial/{token}/iframe.
const IFRAME_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'sec-fetch-dest': 'iframe',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'cross-site'
};

/**
 * Клиент HDVB — перенос Lampac OnlineRUS/HDVB (Controller + ModInit).
 *
 * - videos({title|kinopoiskId}): `{apihost}/api/videos.json?token=...&title=...`
 *   (или `&id_kp=...`) → List<Video> (movie: type=="movie", iframe_url;
 *   serial: type=="serial", serial_episodes:[{season_number, episodes:[short]}]).
 * - iframe(path): GET iframe-страницы на stream-хосте (fixframe: pathname из
 *   iframe_url + init.host) — нода требует referer movielab.one.
 * - postPlaylist({href, file, key, origin}): POST `https://vid11.{href}/playlist/
 *   {file}.txt` с csrf; фильм → подписанная m3u8-ссылка, сериал → List<Folder>.
 *
 * Один DTO-слой: никакой бизнес-логики, только HTTP + сырые ответы.
 */
export class HDVBClient {
  constructor(options = {}) {
    this.apihost = trimSlash(options.apihost || process.env.HDVB_API_HOST || DEFAULT_APIHOST);
    this.frameHost = trimSlash(options.frameHost || process.env.HDVB_FRAME_HOST || DEFAULT_FRAMEHOST);
    this.token = String(options.token || process.env.HDVB_TOKEN || '').trim();
    this.referer = String(options.referer || process.env.HDVB_REFERER || DEFAULT_REFERER);
    this.fetchImpl = options.fetchImpl || fetch;
    this.iframeHeaders = { ...IFRAME_HEADERS, 'Referer': this.referer, 'User-Agent': defaultUserAgent() };
  }

  enabled() {
    return Boolean(this.token);
  }

  /** Поиск/получение Video[] по названию или kinopoisk_id. */
  async videos(options = {}) {
    if (!this.enabled()) return null;
    const kinopoiskId = Number(options.kinopoiskId || options.kp || 0) || 0;
    const title = String(options.title || '').trim();

    const url = new URL('/api/videos.json', `${this.apihost}/`);
    url.searchParams.set('token', this.token);
    if (kinopoiskId > 0) url.searchParams.set('id_kp', String(kinopoiskId));
    else if (title) url.searchParams.set('title', title);
    else return null;

    return this.getJson(url);
  }

  /** GET iframe-страницы по пути (pathname из iframe_url) на stream-хосте. */
  async iframe(path) {
    const url = new URL(String(path || ''), `${this.frameHost}/`);
    const response = await this.fetchImpl(url, { headers: this.iframeHeaders });
    if (!response.ok) throw new HttpError(response.status, 'hdvb_http_error', `HDVB iframe HTTP ${response.status}`);
    return response.text();
  }

  /** POST playlist → m3u8 (фильм) или Folder[] (сериал). */
  async postPlaylist(options = {}) {
    const href = String(options.href || '').trim();
    const file = String(options.file || '').trim();
    if (!href || !file) return null;

    const url = `https://vid11.${href}/playlist/${file}.txt`;
    const origin = String(options.origin || this.frameHost);
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        accept: '*/*',
        origin,
        referer: `${origin}/`,
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'x-csrf-token': String(options.key || ''),
        'User-Agent': defaultUserAgent()
      },
      body: ''
    });
    if (!response.ok) throw new HttpError(response.status, 'hdvb_http_error', `HDVB playlist HTTP ${response.status}`);
    return response.text();
  }

  async getJson(url) {
    const response = await this.fetchImpl(url, { headers: { 'User-Agent': defaultUserAgent() } });
    if (response.status === 204) return null;
    if (!response.ok) throw new HttpError(response.status, 'hdvb_http_error', `HDVB HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
}

function trimSlash(value) {
  return String(value).replace(/\/+$/, '');
}
