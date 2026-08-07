import { buildProxyUrl } from '../../proxy.js';
import { Provider } from '../base.js';
import { CDNvideohubClient } from './CDNvideohubClient.js';
import { CDNvideohubNormalizer } from './CDNvideohubNormalizer.js';

// Плеер-референр для потока — как Lampac ModInit (stream referer).
const PLAYER_REFERER = 'https://player.cdnvideohub.com';

/**
 * Провайдер CDNvideohub (VideoHUB) — перенос Lampac OnlineRUS/CDNvideohub.
 *
 * Ключуется только по kinopoisk_id: без kp провайдер не отвечает (поиска по
 * названию в API нет). Фильм: по одной play-записи на озвучку (adaptive HLS
 * `{auto}`). Сериал: по серии × озвучка выбранного сезона. Потоки — видео из
 * `video/{vkId}` (`hlsUrl`), через наш прокси.
 */
export class CDNvideohubProvider extends Provider {
  static id = 'cdnvideohub';
  static title = 'CDNvideohub';

  constructor({ enabled = true, host, client = null, normalizer = null, ...options } = {}) {
    super(options);
    this.enabledFlag = enabled;
    this.client = client || new CDNvideohubClient({ host });
    this.host = this.client.host;
    this.normalizer = normalizer || new CDNvideohubNormalizer();
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
    if (!kinopoiskId) return [];

    try {
      const root = await this.client.playlist(kinopoiskId);
      return this.normalizer.records(root, query);
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

  /** Playlist → играбельные play-записи: фильм по озвучкам, сериал по сериям×озвучкам. */
  async videos(context = null) {
    const requestContext = context || {};
    const query = requestContext.query || {};

    try {
      const records = await this.search(query, requestContext);
      if (!records.length) return { items: [], seasons: [], voices: [] };

      const record = records[0];
      const streamProxy = (url) => buildProxyUrl(requestContext, url);
      return record.isSerial
        ? await this.serialVideos(record, query, streamProxy)
        : await this.movieVideos(record, query, streamProxy);
    } catch {
      return { items: [], seasons: [], voices: [] };
    }
  }

  /** Фильм: play-запись на озвучку (первый vkId каждой voiceType), HLS `{auto}`. */
  async movieVideos(record, query, streamProxy) {
    const items = [];
    // По одной записи на озвучку: первый item голоса хранит её hls.
    const voiceIds = new Map();
    for (const item of record.items) {
      const voice = String(item.voiceType || 'Оригинал');
      if (!voiceIds.has(voice) && item.vkId) voiceIds.set(voice, item.vkId);
    }

    for (const [voice, vkId] of voiceIds) {
      const hls = await this.client.videoHls(vkId);
      if (!hls) continue;
      items.push(this.playItem({
        title: voice,
        url: streamProxy(hls),
        voice_name: voice,
        type: 'movie'
      }));
    }
    const voices = [...voiceIds.keys()].map((name) => ({ name, index: [...voiceIds.keys()].indexOf(name) }));
    return { items, seasons: [], voices };
  }

  /** Сериал: по сериям выбранного сезона, на серию по одному play-item на озвучку. */
  async serialVideos(record, query, streamProxy) {
    const seasons = this.normalizer.seasons(record);
    if (!seasons.length) return { items: [], seasons: [], voices: [] };

    const seasonNumber = Number(query.season) > 0 && seasons.some((s) => s.number === Number(query.season))
      ? Number(query.season)
      : seasons[0].number;

    const episodes = this.normalizer.episodes(record, seasonNumber);
    const items = [];
    for (const episode of episodes) {
      // vkId по каждой озвучке выбранной серии (первый голос), как цикл
      // уровней в Lampac (каждый уровень внутри серии = свой видео).
      const voiceIdsForEpisode = new Map();
      for (const item of record.items) {
        if (Number(item.season) !== seasonNumber || Number(item.episode) !== episode.number) continue;
        const voice = String(item.voiceType || 'Оригинал');
        if (!voiceIdsForEpisode.has(voice) && item.vkId) voiceIdsForEpisode.set(voice, item.vkId);
      }

      for (const [voice, vkId] of voiceIdsForEpisode) {
        const hls = await this.client.videoHls(vkId);
        if (!hls) continue;
        items.push(this.playItem({
          title: `${episode.number} серия`,
          url: streamProxy(hls),
          voice_name: voice,
          type: 'serial',
          season: seasonNumber,
          episode: episode.number
        }));
      }
    }

    const voices = this.normalizer.voices(record).map((name) => ({ name, index: this.normalizer.voices(record).indexOf(name) }));
    return { items, seasons, voices };
  }

  /** Резолв видео vkId → StreamItem (adaptive HLS `{auto}`). */
  async streams(item = {}, context) {
    if (!this.enabled()) return []; // eslint-disable-line
    const requestContext = context || (item?.request ? item : undefined);
    const query = requestContext?.query || item?.query || item || {};
    const vkId = String(query.vkId || item?.vkId || '').trim();
    if (!vkId) return [];

    try {
      const hls = await this.client.videoHls(vkId);
      if (!hls) return [];

      const streamProxy = (url) => buildProxyUrl(requestContext, url);
      const title = String(query.title || item?.title || this.title);
      const type = String(query.type || item?.type || query.videoType || 'movie');
      const voice = String(query.voice_name || item?.voice_name || item?.voice || 'Оригинал');

      return [this.streamItem({
        id: vkId,
        title,
        type,
        quality: 'auto',
        voice,
        stream: {
          url: streamProxy(hls),
          headers: { Referer: PLAYER_REFERER }
        },
        subtitles: []
      })];
    } catch {
      return [];
    }
  }

  async recordsByType(queryOrContext, context, type) {
    const records = await this.search(queryOrContext, context);
    return records.filter((record) => record.type === type);
  }

  // --- private helpers ---

  playItem({ title, url, voice_name, type, season, episode }) {
    return {
      method: 'play',
      title,
      url,
      quality: { auto: url },
      headers: { Referer: PLAYER_REFERER },
      subtitles: [],
      sound: [],
      voice_name,
      type,
      ...(season ? { season } : {}),
      ...(episode ? { episode } : {})
    };
  }
}

export default CDNvideohubProvider;