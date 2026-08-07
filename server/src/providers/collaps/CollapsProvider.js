import { buildProxyUrl } from '../../proxy.js';
import { Provider } from '../base.js';
import { CollapsClient } from './CollapsClient.js';
import { CollapsNormalizer } from './CollapsNormalizer.js';

// Референс для потока — поток-референс kinokrad (как Lampac headers_stream).
const STREAM_REFERER = 'https://kinokrad.my/';

/**
 * Провайдер Collaps — перенос Lampac OnlineRUS/Collaps.
 *
 * Поиск по названию (`/list`) → карточки; для выбранной карточки (kp / imdb /
 * orid) — embed-страница, из которой собирается play: фильм — один источник
 * (adaptive HLS/DASH), сериал — по сериям выбранного сезона (озвучки, субтитры).
 * Потоки идут через наш прокси (raw URL работает; x-en-x-кодер Lampac не нужен).
 */
export class CollapsProvider extends Provider {
  static id = 'collaps';
  static title = 'Collaps';

  constructor({ enabled = true, apihost, embedHost, token, client = null, normalizer = null, ...options } = {}) {
    super(options);
    this.enabledFlag = enabled;
    this.client = client || new CollapsClient({ apihost, embedHost, token });
    this.normalizer = normalizer || new CollapsNormalizer();
  }

  name() {
    return this.id;
  }

  enabled() {
    return this.enabledFlag && this.client.enabled();
  }

  async search(queryOrContext = {}, context = null) {
    if (!this.enabled()) return [];

    const requestContext = context || (queryOrContext?.request ? queryOrContext : undefined);
    const query = requestContext?.query || queryOrContext || {};
    const title = String(query.title || '').trim();

    // Без названия — движок уже знает карточку по kp/imdb/orid: вернём её запись.
    if (!title) {
      const record = await this.recordByKeys(query, requestContext);
      return record ? [record] : [];
    }

    try {
      const root = await this.client.search(title);
      return this.normalizer.search(root, query);
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

  /** Embed → play-записи: фильм один источник, сериал по сезонам. */
  async videos(context = null) {
    if (!this.enabled()) return { items: [], seasons: [], voices: [] };
    const requestContext = context || {};
    const query = requestContext.query || {};

    try {
      const { text } = await this.embed(query, requestContext);
      const parsed = this.normalizer.parseEmbed(text, query);
      if (!parsed.movie && !parsed.seasons.length) return { items: [], seasons: [], voices: [] };

      const streamProxy = (url) => buildProxyUrl(requestContext, url);
      return parsed.movie
        ? await this.movieVideos(parsed.movie, query, streamProxy)
        : await this.serialVideos(parsed, query, streamProxy);
    } catch {
      return { items: [], seasons: [], voices: [] };
    }
  }

  /** Фильм: одна play-запись (источник), субтитры + озвучки. */
  async movieVideos(movie, query, streamProxy) {
    if (!movie.url) return { items: [], seasons: [], voices: [] };

    const subtitles = movie.cc
      .filter((cc) => cc.url)
      .map((cc) => ({ name: cc.name, url: streamProxy(cc.url) }));

    return {
      items: [{
        method: 'play',
        title: query.title || '…',
        url: streamProxy(movie.url),
        quality: { auto: streamProxy(movie.url) },
        headers: { Referer: STREAM_REFERER },
        subtitles,
        voice_name: movie.voicename,
        sound: movie.audioNames,
        type: 'movie'
      }],
      seasons: [],
      voices: movie.voicename ? [{ name: movie.voicename, index: 0 }] : []
    };
  }

  /** Сериал: play-записи по сериям выбранного сезона, фильтры seasons/voices. */
  async serialVideos(parsed, query, streamProxy) {
    const seasons = parsed.seasons.map((s) => ({ number: s.number, title: `${s.number} сезон` }));
    if (!seasons.length) return { items: [], seasons: [], voices: [] };

    const seasonNumber = Number(query.season) > 0 && seasons.some((s) => s.number === Number(query.season))
      ? Number(query.season)
      : seasons[0].number;

    const season = parsed.seasons.find((s) => s.number === seasonNumber) || parsed.seasons[0];

    const items = [];
    for (const episode of season.episodes) {
      const voiceName = episode.audioNames.length ? episode.audioNames.join(', ') : 'Оригинал';
      const subtitles = episode.cc.filter((cc) => cc.url).map((cc) => ({ name: cc.name, url: streamProxy(cc.url) }));
      items.push({
        method: 'play',
        title: episode.title,
        url: streamProxy(episode.url),
        quality: { auto: streamProxy(episode.url) },
        headers: { Referer: STREAM_REFERER },
        subtitles,
        voice_name: voiceName,
        sound: episode.audioNames,
        type: 'serial',
        season: seasonNumber,
        episode: episode.number
      });
    }

    return { items, seasons, voices: this.distinctVoices(parsed.seasons) };
  }

  /** Прямое обращение к конкретному media URL → StreamItem (adaptive {auto}). */
  async streams(item = {}, context) {
    if (!this.enabled()) return []; // eslint-disable-line
    const requestContext = context || (item?.request ? item : undefined);
    const query = requestContext?.query || item?.query || item || {};
    const mediaUrl = String(query.url || item.url || '').trim();
    if (!mediaUrl) return [];

    const streamProxy = (url) => buildProxyUrl(requestContext, url);
    const title = String(query.title || item.title || this.title);
    const type = String(query.type || item.type || 'movie');
    const voice = String(query.voice_name || item.voice_name || item.voice || 'Оригинал');

    return [this.streamItem({
      id: mediaUrl,
      title,
      type,
      quality: 'auto',
      voice,
      stream: {
        url: streamProxy(mediaUrl),
        headers: { Referer: STREAM_REFERER }
      },
      subtitles: []
    })];
  }

  async recordsByType(queryOrContext, context, type) {
    const records = await this.search(queryOrContext, context);
    return records.filter((record) => record.type === type);
  }

  // --- private helpers ---

  async embed(query, requestContext) {
    // embedHost из записи (iframe_url) имеет приоритет над дефолтным хоста.
    const embedHost = query.embedHost || undefined;
    return this.client.embed({
      kinopoiskId: query.kinopoisk_id || query.kp,
      imdbId: query.imdb_id || query.imdb,
      orId: query.orid || query.id,
      embedHost
    });
  }

  /** По ключу карточки → запись провайдера для movie()/serial(). */
  async recordByKeys(query, request) {
    const { text } = await this.embed(query, request);
    const parsed = this.normalizer.parseEmbed(text, query);
    if (!parsed.movie && !parsed.seasons.length) return null;

    const type = parsed.movie ? 'movie' : 'serial';
    const url = parsed.movie?.url || parsed.seasons[0]?.episodes[0]?.url || '';
    const title = parsed.movie?.title || parsed.seasons[0]?.title || query.title || '';

    const deadline = {
      provider: 'collaps',
      id: String(query.orid || query.id || query.kinopoisk_id || query.kp || ''),
      orid: Number(query.orid || query.id) || 0,
      kinopoisk_id: Number(query.kinopoisk_id || query.kp) || null,
      imdb_id: query.imdb_id || null,
      title,
      type,
      url,
      // Записи для повторного использования в videos() — reuse parse.
      parsed
    };
    return deadline;
  }

  distinctVoices(seasons) {
    const seen = new Set();
    const voices = [];
    for (const season of seasons) {
      for (const episode of season.episodes) {
        const name = episode.audioNames.length ? episode.audioNames.join(', ') : 'Оригинал';
        const key = name;
        if (!seen.has(key)) { seen.add(key); voices.push({ name, index: voices.length }); }
      }
    }
    return voices;
  }
}

export default CollapsProvider;