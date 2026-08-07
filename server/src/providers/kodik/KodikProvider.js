import { clientIp } from '../../security.js';
import { buildProxyUrl } from '../../proxy.js';
import { Provider } from '../base.js';
import { KodikClient } from './KodikClient.js';
import { KodikNormalizer } from './KodikNormalizer.js';

// Референр по умолчанию — как Lampac ModInit (headers.referer = anilib.me).
const KODIK_REFERER = 'https://anilib.me/';

export class KodikProvider extends Provider {
  static id = 'kodik';
  static title = 'Kodik';

  constructor({ client = null, normalizer = new KodikNormalizer(), ...options } = {}) {
    super(options);
    // Конфиг-проекция через клиента: apiHost/linkHost/playerHost/token/secretToken
    // берутся из options или (для токенов) из env. Без client — создаём реальный.
    this.client = client || new KodikClient({
      apiHost: options.apiHost,
      linkHost: options.linkHost,
      playerHost: options.playerHost,
      token: options.token,
      secretToken: options.secretToken
    });
    this.normalizer = normalizer;
  }

  name() {
    return this.id;
  }

  enabled() {
    return this.client.enabled();
  }

  async search(queryOrContext = {}, context = null) {
    if (!this.enabled()) return [];

    const requestContext = context || (queryOrContext?.request ? queryOrContext : undefined);
    const query = requestContext?.query || queryOrContext || {};
    const title = String(query.title || '');
    const originalTitle = String(query.original_title || query.originalTitle || '');
    const kinopoiskId = Number(query.kinopoisk_id || query.kp || 0) || 0;
    const imdbId = String(query.imdb_id || query.imdb || '');
    const season = Number(query.season || query.s || 0) || 0;

    try {
      const raw = kinopoiskId || imdbId
        ? await this.client.searchByIds({ kinopoiskId, imdbId, season })
        : await this.titleSearch(title, originalTitle);
      return this.records(raw);
    } catch {
      return [];
    }
  }

  async movie(queryOrContext = {}, context = null) {
    return this.recordsByType(queryOrContext, context, 'movie');
  }

  async serial(queryOrContext = {}, context = null) {
    return this.recordsByType(queryOrContext, context, 'serial');
  }

  async getSeasons(item = {}) {
    const seasons = Array.isArray(item?.seasons) ? item.seasons : [];
    if (seasons.length) {
      return seasons.map((season) => ({ number: season.number, title: season.title || `${season.number} сезон` }));
    }
    return Array.isArray(item?.metadata?.seasons) ? item.metadata.seasons : [];
  }

  async getEpisodes(item = {}, seasonNumber = null) {
    const seasons = Array.isArray(item?.seasons) ? item.seasons : [];
    const season = seasons.find((entry) => entry.number === Number(seasonNumber)) || seasons[0];
    if (!season || !Array.isArray(season.episodes)) return [];
    return season.episodes.map((episode) => ({
      number: episode.number,
      title: episode.title || `${episode.number} серия`,
      link: episode.link || ''
    }));
  }

  async getTranslations(item = {}) {
    const aggregated = item?.metadata?.translations;
    if (Array.isArray(aggregated) && aggregated.length) return aggregated.map((title) => ({ title }));
    if (item?.translation?.title) return [{ title: item.translation.title }];
    return [];
  }

  async streams(item, context) {
    const requestContext = context || (item?.request ? item : undefined);
    const query = requestContext?.query || item?.query || item || {};
    const link = String(query.link || query.url || '').trim();
    if (!link) return [];

    try {
      const raw = await this.client.streams(link, {
        ip: requestContext?.request ? clientIp(requestContext.request) : '127.0.0.1'
      });

      const streamProxy = (url) => buildProxyUrl(requestContext, url);
      const id = String(query.id || item?.id || query.link || link);
      const title = String(query.title || item?.title || this.title);
      const type = String(query.type || item?.type || 'movie');

      return this.normalizer.streams(raw).map((stream) => this.streamItem({
        id,
        title,
        type,
        quality: stream.quality,
        voice: 'Оригинал',
        stream: {
          url: streamProxy(stream.url),
          headers: { Referer: KODIK_REFERER }
        },
        subtitles: []
      }));
    } catch {
      return [];
    }
  }

  async videos(context = null) {
    const requestContext = context || {};
    const query = requestContext.query || {};

    try {
      const records = await this.search(query, requestContext);
      if (!records.length) return { items: [], seasons: [], voices: [] };

      // Тип определяется выданной записью (список фильмов Lampac).
      const serials = records.filter((record) => record.type === 'serial');
      const movies = records.filter((record) => record.type === 'movie');

      const streamProxy = (url) => buildProxyUrl(requestContext, url);
      return serials.length
        ? await this.serialVideos(serials, query, requestContext, streamProxy)
        : await this.movieVideos(movies, query, requestContext, streamProxy);
    } catch {
      return { items: [], seasons: [], voices: [] };
    }
  }

  /** Фильм: по одной играбельной записи на озвучку, мапа качеств → прокси. */
  async movieVideos(records, query, requestContext, streamProxy) {
    const items = [];
    for (const record of records) {
      const link = record?.stream?.link || '';
      if (!link) continue;

      const streamModels = await this.streamModels(link, requestContext);
      if (!streamModels.length) continue;

      const voice = String(record.translation?.title || 'Оригинал');
      const quality = {};
      for (const stream of streamModels) quality[stream.quality] = streamProxy(stream.url);

      items.push({
        method: 'play',
        title: voice,
        url: streamProxy(streamModels[0].url),
        quality,
        headers: { Referer: KODIK_REFERER },
        subtitles: [],
        voice_name: voice,
        type: 'movie'
      });
    }
    return { items, seasons: [], voices: [] };
  }

  /** Сериал: items по сериям выбранного сезона + озвучки, фильтры seasons/voices. */
  async serialVideos(records, query, requestContext, streamProxy) {
    const voiceTitles = this.voiceTitles(records);
    const seasons = await this.getSeasons(records[0]);
    if (!seasons.length) return { items: [], seasons: [], voices: [] };

    const seasonNumber = Number(query.season) > 0 && seasons.some((s) => s.number === Number(query.season))
      ? Number(query.season)
      : seasons[0].number;

    const voiceIndex = Number(query.voice) || 0;
    const voiceTitle = voiceTitles[voiceIndex] ?? voiceTitles[0] ?? 'оригинал';
    const record = records.find((r) => (r.translation?.title || 'оригинал') === voiceTitle) || records[0];

    const episodes = await this.getEpisodes(record, seasonNumber);
    const items = [];
    for (const episode of episodes) {
      if (!episode.link) continue;
      const stream = await this.streamModels(episode.link, requestContext);
      if (!stream.length) continue;

      const quality = {};
      for (const item of stream) quality[item.quality] = streamProxy(item.url);

      items.push({
        method: 'play',
        title: `${episode.number} серия`,
        url: streamProxy(stream[0].url),
        quality,
        headers: { Referer: KODIK_REFERER },
        subtitles: [],
        season: seasonNumber,
        episode: episode.number,
        voice_name: voiceTitle,
        type: 'serial'
      });
    }

    const seasonList = seasons.map((s) => ({ number: s.number, title: s.title || `${s.number} сезон` }));
    const voices = voiceTitles.map((name) => ({ name, index: voiceTitles.indexOf(name) }));
    return { items, seasons: seasonList, voices };
  }

  // --- private helpers ---

  /** Резолв потоков ссылки (video-links) → [{quality, url}] с https-нормализацией. */
  async streamModels(link, requestContext) {
    const raw = await this.client.streams(link, {
      ip: requestContext?.request ? clientIp(requestContext.request) : '127.0.0.1'
    });
    return this.normalizer.streams(raw);
  }

  /** Уникальные озвучки по записям выдачи — как цикл переводов в Lampac. */
  voiceTitles(records) {
    const seen = new Set();
    const titles = [];
    for (const record of records) {
      const name = String(record?.translation?.title || 'оригинал');
      if (!seen.has(name)) {
        seen.add(name);
        titles.push(name);
      }
    }
    return titles;
  }

  /**
   * Поиск по названию с фолбэком — как Lampac Controller.Index:
   * сначала original_title, при пустом результате — по title.
   */
  async titleSearch(title, originalTitle) {
    if (!title && !originalTitle) return [];

    const first = originalTitle ? await this.client.searchByTitle({ originalTitle }) : [];
    if (first.length) return first;

    if (title && title !== originalTitle) return this.client.searchByTitle({ title });
    return [];
  }

  records(raw) {
    const items = this.normalizer.search(raw);
    if (!items.length) return [];

    // Агрегированные по всей выдаче метаданные (озвучки, список сезонов).
    const translations = this.normalizer.distinctTranslations(raw);
    const seasons = this.normalizer.distinctSeasons(raw);

    return items.map((item) => ({
      ...item,
      metadata: {
        ...(item.metadata || {}),
        translations,
        seasons
      }
    }));
  }

  async recordsByType(queryOrContext, context, type) {
    const records = await this.search(queryOrContext, context);
    return records.filter((record) => record.type === type);
  }
}

export default KodikProvider;
