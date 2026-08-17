import { buildProxyUrl } from '../../proxy.js';
import { Provider } from '../base.js';
import { KinotochkaClient } from './KinotochkaClient.js';
import { KinotochkaNormalizer } from './KinotochkaNormalizer.js';

/**
 * Провайдер Kinotochka (kinovibe.vip) — перенос Lampac OnlineRUS/Kinotochka.
 *
 * Ключуется по kinopoisk_id (find-by-kinopoisk.php → страница фильма → плеерный
 * блок `id:"playerjshd", file:"…"` → прямой MP4). Сериал: url ответа несут
 * сезоны (`-N-sezon`), серии — txt-плейлист страницы сезона. Без kp фильм не
 * отвечает; сериал — DLE-поиском по названию (фолбэк Lampac).
 *
 * Медиа — прямые MP4 (720p) на CDN `*.kvb.cool`; играем через наш прокси
 * (buildProxyUrl) — `kvb.cool` добавляется в proxy.allowHosts автоматически.
 */
export class KinotochkaProvider extends Provider {
  static id = 'kinotochka';
  static title = 'Kinotochka ~ 720p';

  constructor({ enabled = true, host, client = null, normalizer = null, ...options } = {}) {
    super(options);
    this.enabledFlag = enabled;
    this.client = client || new KinotochkaClient({ host });
    this.host = this.client.host;
    this.normalizer = normalizer || new KinotochkaNormalizer();
  }

  name() {
    return this.id;
  }

  enabled() {
    return Boolean(this.enabledFlag);
  }

  async search(queryOrContext = {}, context = null) {
    if (!this.enabled()) return [];

    const requestContext = context || (queryOrContext?.request ? queryOrContext : undefined);
    const query = requestContext?.query || queryOrContext || {};
    const kinopoiskId = Number(query.kinopoisk_id || query.kp || 0) || 0;

    try {
      if (isSerialRequest(query)) {
        const seasons = await this.resolveSeasonLinks(kinopoiskId, query.title);
        const record = this.normalizer.serialRecord(seasons, query);
        return record ? [record] : [];
      }
      if (!kinopoiskId) return [];
      const urls = await this.client.findByKinopoisk(kinopoiskId);
      const record = this.normalizer.movieRecord(urls, query);
      if (!record) return [];
      const file = await this.client.movieFile(record.url);
      return file ? [record] : [];
    } catch {
      return [];
    }
  }

  async movie(queryOrContext = {}, context = null) {
    const records = await this.search(queryOrContext, context);
    return records.filter((record) => record.type === 'movie');
  }

  async serial(queryOrContext = {}, context = null) {
    const records = await this.search(queryOrContext, context);
    return records.filter((record) => record.type === 'serial');
  }

  /** Фильм/сериал → играбельные play-записи + фильтры сезонов/озвучек. */
  async videos(context = null) {
    if (!this.enabled()) return { items: [], seasons: [], voices: [] };
    const requestContext = context || {};
    const query = requestContext.query || {};

    try {
      return isSerialRequest(query)
        ? await this.serialVideos(query, requestContext)
        : await this.movieVideos(query, requestContext);
    } catch {
      return { items: [], seasons: [], voices: [] };
    }
  }

  /** Фильм: одна play-запись «По умолчанию» (плеерный файл страницы). */
  async movieVideos(query = {}, requestContext) {
    const kinopoiskId = Number(query.kinopoisk_id || query.kp || 0) || 0;
    if (!kinopoiskId) return { items: [], seasons: [], voices: [] };

    const urls = await this.client.findByKinopoisk(kinopoiskId);
    const record = this.normalizer.movieRecord(urls, query);
    if (!record) return { items: [], seasons: [], voices: [] };

    const file = await this.client.movieFile(record.url);
    if (!file) return { items: [], seasons: [], voices: [] };

    const streamProxy = (url) => buildProxyUrl(requestContext, url);
    const item = this.playItem({
      title: 'По умолчанию',
      url: streamProxy(file),
      type: 'movie'
    });
    return { items: [item], seasons: [], voices: [] };
  }

  /** Сериал: сезоны из url ответа, серии выбранного сезона — play-записи. */
  async serialVideos(query = {}, requestContext) {
    const kinopoiskId = Number(query.kinopoisk_id || query.kp || 0) || 0;
    const seasonLinks = await this.resolveSeasonLinks(kinopoiskId, query.title);
    if (!seasonLinks.length) return { items: [], seasons: [], voices: [] };

    const seasons = this.normalizer.seasons(seasonLinks);
    const seasonNumber = Number(query.season) > 0 && seasons.some((s) => s.number === Number(query.season))
      ? Number(query.season)
      : seasons[0].number;

    const seasonUrl = (seasonLinks.find((s) => s.season === seasonNumber) || {}).url;
    const playlist = seasonUrl ? await this.client.seasonPlaylist(seasonUrl) : [];
    const episodes = this.normalizer.episodes(playlist);

    const streamProxy = (url) => buildProxyUrl(requestContext, url);
    const items = episodes.map((episode) => this.playItem({
      title: episode.title,
      url: streamProxy(episode.url),
      type: 'serial',
      season: seasonNumber,
      episode: episode.number
    }));

    return { items, seasons, voices: [] };
  }

  /** Резолв видео-URL → StreamItem (для /api/lampa/stream; клиент играет напрямую). */
  async streams(item = {}, context) {
    if (!this.enabled()) return []; // eslint-disable-line
    const requestContext = context || (item?.request ? item : undefined);
    const query = requestContext?.query || item?.query || item || {};
    const file = String(query.file || query.videoId || query.url || item?.file || item?.url || '').trim();
    if (!/^https?:\/\//i.test(file)) return [];

    const streamProxy = (url) => buildProxyUrl(requestContext, url);
    const title = String(query.title || item?.title || this.title);
    const type = String(query.type || item?.type || query.videoType || 'movie');
    const voice = String(query.voice_name || item?.voice_name || item?.voice || 'Оригинал');

    return [this.streamItem({
      id: file,
      title,
      type,
      quality: '720p',
      voice,
      stream: {
        url: streamProxy(file),
        headers: {}
      },
      subtitles: []
    })];
  }

  // --- private helpers ---

  /** Сезон-ссылки: КиноПоиск-ответ (kp) или DLE-поиск по названию (фолбэк). */
  async resolveSeasonLinks(kinopoiskId, title) {
    if (kinopoiskId) {
      const urls = await this.client.findByKinopoisk(kinopoiskId);
      return this.client.serialSeasons(urls);
    }
    return this.client.searchByTitle(title);
  }

  playItem({ title, url, type, season, episode }) {
    return {
      method: 'play',
      title,
      url,
      quality: { '720p': url },
      headers: {},
      subtitles: [],
      sound: [],
      voice_name: 'Оригинал',
      type,
      ...(season ? { season } : {}),
      ...(episode ? { episode } : {})
    };
  }
}

export default KinotochkaProvider;

/** Запрос сериала (та же сигнатура, что store.js/SkazProvider.serialQuery). */
export function isSerialRequest(query = {}) {
  const serial = String(query.serial ?? '').trim();
  return serial === '1' || serial === 'true' || serial === 'yes'
    || String(query.type || '').toLowerCase() === 'serial'
    || String(query.serial_type || '').toLowerCase() === 'serial';
}