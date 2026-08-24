import { Provider } from '../base.js';
import { buildPlayUrl, buildProxyUrl } from '../../proxy.js';
import { AllohaClient } from './AllohaClient.js';
import { AllohaNormalizer } from './AllohaNormalizer.js';

export class AllohaProvider extends Provider {
  static id = 'alloha';
  static title = 'Alloha';

  constructor({ client = null, normalizer = null, enabled = true, baseUrl, apiHost, linkHost, token, secretToken, ...options } = {}) {
    super(options);
    this.enabledFlag = Boolean(enabled);
    // Конфиг-проекция: apiHost (поиск), linkHost (/direct), token (Bearer API),
    // secretToken (/direct) приходят из config. Без токена /direct 401 и поиск
    // TOKEN_REQUIRED, поэтому источник скрыт, пока токен не задан.
    this.client = client || new AllohaClient({ baseUrl, apiHost, linkHost, token, secretToken });
    this.normalizer = normalizer || new AllohaNormalizer();
  }

  name() {
    return this.id;
  }

  enabled() {
    // Как у Kodik: источник появляется в списке только когда реально может
    // отдать стрим — т.е. задан secret_token. Иначе поиск падает в 401.
    return this.enabledFlag && Boolean(this.client.token);
  }

  async search(query = {}) {
    const { title, original_title: originalTitle, year, type, imdb, kp, id, request } = query || {};
    const normalizedQuery = {
      title: title || request?.query?.title || '',
      originalTitle: originalTitle || request?.query?.original_title || '',
      year: year || request?.query?.year || '',
      type,
      imdb: imdb || request?.query?.imdb_id || request?.query?.imdb || '',
      kp: kp || request?.query?.kinopoisk_id || request?.query?.kp || '',
      id
    };
    const response = await this.client.search({ ...normalizedQuery, fallback: true });
    return response.items.map((item) => this.normalizer.normalizeSearchItem({ ...item, id: item.id || id }));
  }

  async movie(item = {}) {
    return this.search({ ...item, type: 'movie' });
  }

  async serial(item = {}) {
    return this.search({ ...item, type: 'serial' });
  }

  async getSeasons(item = {}) {
    if (!item?.token && !item?.id) return [];
    const payload = await this.client.details(item.token || item.id);
    return this.normalizer.normalizeSeasons(payload);
  }

  async getEpisodes(item = {}, seasonNumber = null) {
    if (!item?.token && !item?.id) return [];
    const payload = await this.client.details(item.token || item.id);
    const seasons = Array.isArray(payload?.item?.seasons) ? payload.item.seasons : [];
    const season = seasons.find((entry) => entry.season === seasonNumber || entry.number === seasonNumber) || seasons[0] || {};
    return (season.episodes || []).map((episode) => this.normalizer.normalizeEpisode(episode));
  }

  async getTranslations(item = {}) {
    if (!item?.token && !item?.id) return [];
    const payload = await this.client.details(item.token || item.id);
    return this.normalizer.normalizeTranslations(payload);
  }

  async getQualities(item = {}) {
    if (!item?.token && !item?.id) return [];
    const payload = await this.client.details(item.token || item.id);
    return this.normalizer.normalizeQualities(payload);
  }

  async streams(item = {}) {
    if (!item?.token && !item?.id) return [];
    const payload = await this.client.streams({
      token: item.token || item.id,
      translationId: item.translationId || item.t || item.translation || null,
      season: item.season || item.s || null,
      episode: item.episode || item.e || null,
      directorsCut: Boolean(item.directorsCut)
    });
    const streams = this.normalizer.normalizeStreams(payload);
    return streams.map((stream) => this.streamItem({
      id: String(item.id || item.token || ''),
      title: item.title || item.original_title || this.id,
      type: item.type || 'movie',
      quality: stream.quality || 'auto',
      voice: stream.voice || item.voice || '',
      stream: {
        url: stream.url,
        headers: stream.headers
      },
      subtitles: item.subtitles || []
    }));
  }

  /**
   * Играбельные записи для плагина: фильм — по записи на озвучку,
   * сериал — по сериям выбранного сезона. Мапы качеств завёрнуты в прокси,
   * фильтры seasons/voices отдаются для сериалов.
   */
  async videos(context = null) {
    const requestContext = context || {};
    const query = requestContext.query || {};

    try {
      const records = await this.search(query);
      if (!records.length) return { items: [], seasons: [], voices: [] };

      const serial = records.find((record) => record.type === 'serial');
      const movie = records.find((record) => record.type === 'movie');

      const streamProxy = (url) => buildPlayUrl(requestContext, url);
      return serial
        ? await this.serialVideos(serial, query, streamProxy)
        : await this.movieVideos(movie, query, streamProxy);
    } catch {
      return { items: [], seasons: [], voices: [] };
    }
  }

  /** Фильм: по одной играбельной записи на озвучку, мапа качеств → прокси. */
  async movieVideos(record = {}, query, streamProxy) {
    const token = record.token || record.id;
    if (!token) return { items: [], seasons: [], voices: [] };

    const translations = await this.getTranslations(record);
    if (!translations.length) return { items: [], seasons: [], voices: [] };

    const items = [];
    for (const translation of translations) {
      const payload = await this.client.streams({
        token,
        translationId: translation.id ?? null,
        season: null,
        episode: null
      });
      const streams = this.normalizer.normalizeStreams(payload);
      if (!streams.length) continue;

      const first = streams[0];
      const quality = {};
      for (const stream of streams) quality[stream.quality || 'auto'] = streamProxy(stream.url);

      items.push({
        method: 'play',
        title: translation.title || translation.voice || 'Озвучка',
        url: streamProxy(first.url),
        quality,
        headers: first.headers,
        subtitles: [],
        voice_name: translation.voice || translation.title || '',
        type: 'movie'
      });
    }
    return { items, seasons: [], voices: [] };
  }

  /** Сериал: items по сериям выбранного сезона + озвучки, фильтры seasons/voices. */
  async serialVideos(record = {}, query, streamProxy) {
    const token = record.token || record.id;
    if (!token) return { items: [], seasons: [], voices: [] };

    const seasons = await this.getSeasons(record);
    if (!seasons.length) return { items: [], seasons: [], voices: [] };

    const seasonNumber = Number(query.season) > 0 && seasons.some((s) => s.number === Number(query.season))
      ? Number(query.season)
      : seasons[0].number;

    const translations = await this.getTranslations(record);
    if (!translations.length) return { items: [], seasons: [], voices: [] };

    const voiceIndex = Number(query.voice) || 0;
    const translation = translations[voiceIndex] || translations[0];

    const episodes = await this.getEpisodes(record, seasonNumber);
    if (!episodes.length) return { items: [], seasons: [], voices: [] };

    const items = [];
    for (const episode of episodes) {
      if (episode.number == null) continue;

      const payload = await this.client.streams({
        token,
        translationId: translation.id ?? null,
        season: seasonNumber,
        episode: episode.number
      });
      const streams = this.normalizer.normalizeStreams(payload);
      if (!streams.length) continue;

      const first = streams[0];
      const quality = {};
      for (const stream of streams) quality[stream.quality || 'auto'] = streamProxy(stream.url);

      items.push({
        method: 'play',
        title: episode.title || `${episode.number} серия`,
        url: streamProxy(first.url),
        quality,
        headers: first.headers,
        subtitles: [],
        season: seasonNumber,
        episode: episode.number,
        voice_name: translation.voice || translation.title || '',
        type: 'serial'
      });
    }

    const seasonList = seasons.map((s) => ({ number: s.number, title: s.title || `${s.number} сезон` }));
    const voices = translations.map((t, index) => ({ name: t.title || t.voice || 'Озвучка', index }));
    return { items, seasons: seasonList, voices };
  }
}

export default AllohaProvider;
