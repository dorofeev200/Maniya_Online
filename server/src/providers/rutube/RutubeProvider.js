import { buildProxyUrl } from '../../proxy.js';
import { Provider } from '../base.js';
import { RutubeClient } from './RutubeClient.js';
import { RutubeNormalizer } from './RutubeNormalizer.js';
import { searchNameTo } from '../shared/normalize/searchNameTo.js';

// Только фильмы (ModInit выключает провайдера для serial).
const VOICE = 'Оригинал';

/**
 * Провайдер RutubeMovie — перенос Lampac OnlineRUS/RutubeMovie.
 *
 * Фильм только: поиск по Rutube-API, потоки — adaptive HLS (quality "auto")
 * из `api/play/options/{linkid}` → `video_balancer.m3u8`, через наш прокси.
 */
export class RutubeProvider extends Provider {
  static id = 'rutubemovie';
  static title = 'Rutube';

  constructor({ enabled = true, host, client = null, normalizer = null, ...options } = {}) {
    super(options);
    this.enabledFlag = enabled;
    this.client = client || new RutubeClient({ host });
    this.host = this.client.host;
    this.normalizer = normalizer || new RutubeNormalizer();
  }

  name() {
    return this.id;
  }

  enabled() {
    return Boolean(this.enabledFlag);
  }

  async search(queryOrContext = {}, context = null) {
    if (!this.enabled()) return [];

    const { title, year } = this.parseQuery(queryOrContext, context);
    const searchTitle = searchNameTo(title);
    if (!searchTitle || !year) return [];

    try {
      const raw = await this.client.search({ title, year });
      return this.normalizer.with({ searchTitle, year }).searchResults(raw);
    } catch {
      return [];
    }
  }

  async movie(queryOrContext = {}, context = null) {
    return (await this.search(queryOrContext, context)).filter((record) => record.type === 'movie');
  }

  async serial() {
    return []; // Rutube — только фильмы.
  }

  /** Play options → играбельная запись `{method:'play'}` одной качественной "auto". */
  async videos(context = null) {
    const requestContext = context || {};
    const query = requestContext.query || {};

    try {
      const records = await this.search(query, requestContext);
      if (!records.length) return { items: [], seasons: [], voices: [] };

      const streamProxy = (url) => buildProxyUrl(requestContext, url);
      const items = [];
      for (const record of records) {
        const m3u8 = await this.client.playOptions(record.id);
        if (!m3u8) continue;
        items.push(this.playItem(record, m3u8, streamProxy));
      }
      return { items, seasons: [], voices: [] };
    } catch {
      return { items: [], seasons: [], voices: [] };
    }
  }

  async streams(item = {}, context) {
    if (!this.enabled()) return []; // eslint-disable-line
    const requestContext = context || (item?.request ? item : undefined);
    const query = requestContext?.query || item?.query || item || {};
    const linkid = String(query.id || item?.id || '').trim();
    if (!linkid) return [];

    try {
      const m3u8 = await this.client.playOptions(linkid);
      if (!m3u8) return [];

      const streamProxy = (url) => buildProxyUrl(requestContext, url);
      return [this.streamItem({
        id: linkid,
        title: String(query.title || item?.title || this.title),
        type: 'movie',
        quality: 'auto',
        voice: VOICE,
        stream: {
          url: streamProxy(m3u8),
          headers: { Referer: `${this.host}/` }
        },
        subtitles: []
      })];
    } catch {
      return [];
    }
  }

  // --- private helpers ---

  playItem(record, m3u8, streamProxy) {
    return {
      method: 'play',
      title: record.title,
      url: streamProxy(m3u8),
      quality: { auto: streamProxy(m3u8) },
      headers: { Referer: `${this.host}/` },
      subtitles: [],
      voice_name: VOICE,
      type: 'movie'
    };
  }

  parseQuery(queryOrContext, context) {
    const requestContext = context || (queryOrContext?.query ? queryOrContext : undefined);
    const query = requestContext?.query || queryOrContext || {};
    const title = String(query.title || '');
    const year = Number(query.year || query.year) || 0;
    return { title, year };
  }
}

export default RutubeProvider;