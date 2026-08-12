import { Provider } from '../base.js';
import { buildProxyUrl } from '../../proxy.js';
import { RezkaClient } from './RezkaClient.js';
import { RezkaNormalizer } from './RezkaNormalizer.js';

export class RezkaProvider extends Provider {
  static id = 'rezka';
  static title = 'Rezka';

  constructor({ client = null, normalizer = null, premium = false, hls = false, enabled = true, baseUrl, login, password, ...options } = {}) {
    super(options);
    this.enabledFlag = Boolean(enabled);
    this.premium = Boolean(premium);
    this.hls = Boolean(hls);
    this.client = client || new RezkaClient({ baseUrl, login, password, premium: this.premium });
    this.normalizer = normalizer || new RezkaNormalizer();
  }

  name() {
    return this.id;
  }

  enabled() {
    return this.enabledFlag;
  }

  /**
   * Поиск по названию. Сигнатура как у Filmix: первый аргумент может быть
   * прямым query-объектом либо request-context'ом с полем `query`.
   */
  async search(queryOrContext = {}, context = null) {
    const requestContext = context || (queryOrContext?.request || queryOrContext?.query ? queryOrContext : undefined);
    const query = requestContext?.query || queryOrContext || {};
    const title = String(query.title || '').trim();
    if (!title) return [];

    try {
      const html = await this.client.searchHtml({
        query: title,
        clarification: query.clarification ? 1 : 0
      });
      if (!html) return [];

      const seen = new Set();
      const records = [];
      for (const record of this.normalizer.normalizeSearchItems(html)) {
        if (!record.id || seen.has(String(record.id))) continue;
        seen.add(String(record.id));
        records.push({ provider: this.id, ...record });
      }
      return records;
    } catch {
      return [];
    }
  }

  searchMovie(query = {}, context = null) {
    return this.search({ ...query, type: 'movie' }, context);
  }

  searchSeries(query = {}, context = null) {
    return this.search({ ...query, type: 'serial' }, context);
  }

  pickRecord(records, query = {}) {
    const title = String(query.title || '').trim().toLowerCase();
    const year = Number(query.year) || null;

    let best = null;
    let bestScore = 0;
    for (const record of records) {
      let score = 0;
      const recordTitle = String(record.title || '').toLowerCase();
      if (title && (recordTitle === title || recordTitle.includes(title))) score += 3;
      if (year && Number(record.year) === year) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = record;
      }
    }
    return bestScore > 0 ? best : null;
  }

  /**
   * Единый резолв записи для streams()/videos(): если в запросе уже есть
   * href/id — берём напрямую, иначе ищем по названию. Возвращает null, если
   * ничего не нашлось.
   */
  async resolveRecord(queryOrContext = {}, context = null) {
    const requestContext = context || (queryOrContext?.request || queryOrContext?.query ? queryOrContext : undefined);
    const query = { ...(requestContext?.query || queryOrContext || {}) };

    const id = String(query.id || '').trim();
    const href = String(query.href || '').trim();

    if (href || id) {
      return {
        provider: this.id,
        id,
        href,
        title: String(query.title || this.title),
        year: query.year ? Number(query.year) : null,
        type: query.type || 'movie'
      };
    }

    const records = await this.search(query, requestContext);
    if (!records.length) return null;

    const record = this.pickRecord(records, query) || records[0];
    return record || null;
  }

  /** Embed-страница записи → нормализованная карточка (или null). */
  async embed(record) {
    const html = await this.client.page(record.href);
    return html ? this.normalizer.normalizeEmbed(html) : null;
  }

  async streams(item = {}, context = null) {
    const requestContext = context || (item?.request ? item : undefined);
    const query = requestContext?.query || item?.query || {};

    try {
      const record = item && (item.id || item.href)
        ? {
            provider: this.id,
            id: String(item.id || query.id || ''),
            href: String(item.href || query.href || ''),
            title: String(item.title || query.title || this.title),
            year: item.year || (query.year ? Number(query.year) : null),
            type: item.type || query.type || 'movie'
          }
        : await this.resolveRecord(query, requestContext);
      if (!record?.href) return [];

      const embedInfo = await this.embed(record);
      if (!embedInfo) return [];

      // Источник истины по типу — embed (data-season_id / initCDNSeriesEvents),
      // а не запрос: сериал по id/href без type не должен уходить как 'movie'.
      record.type = embedInfo.isSerial ? 'serial' : 'movie';

      const streamProxy = (url) => buildProxyUrl(requestContext, url);
      return embedInfo.isSerial
        ? this.serialStreams(record, embedInfo, query, streamProxy)
        : this.movieStreams(record, embedInfo, query, streamProxy);
    } catch {
      return [];
    }
  }

  /**
   * Фильм: StreamItem на каждое качество потока выбранной озвучки.
   */
  async movieStreams(record, embedInfo, query, streamProxy) {
    const translator = this.pickTranslator(embedInfo.translators, query);
    if (!translator) return [];

    const referer = this.referer(record);
    const payload = await this.fetchMovieStreams(record, translator, embedInfo.cdnStreams, embedInfo.favs, referer);
    const streams = this.normalizer.resolveStreams(payload, {
      premium: this.premium,
      hls: this.hls,
      referer,
      voice: translator.name
    });

    return streams.map((stream) => this.streamItem({
      id: String(record.id),
      title: record.title || this.title,
      type: record.type || 'movie',
      quality: stream.quality,
      voice: stream.voice,
      stream: { url: streamProxy(stream.url), headers: stream.headers },
      subtitles: stream.subtitles
    }));
  }

  /**
   * Сериал: StreamItem[] по сериям выбранного сезона + озвучки.
   */
  async serialStreams(record, embedInfo, query, streamProxy) {
    const translator = this.pickTranslator(embedInfo.translators, query);
    if (!translator) return [];

    const source = await this.client.getEpisodes(record.id, translator.id);
    const seasonNumber = this.pickSeason(source, query);
    if (seasonNumber == null) return [];

    const seasonEpisodes = (source?.episodes || [])
      .filter((episode) => Number(episode.season) === Number(seasonNumber));

    const referer = this.referer(record);
    const items = [];
    for (const episode of seasonEpisodes) {
      const payload = await this.client.getStreamEpisode(record.id, translator.id, seasonNumber, episode.episode, {}, referer);
      const streams = this.normalizer.resolveStreams(payload, {
        premium: this.premium,
        hls: this.hls,
        referer,
        voice: translator.name
      });
      for (const stream of streams) {
        items.push(this.streamItem({
          id: String(record.id),
          title: `${episode.episode} серия`,
          type: record.type || 'serial',
          quality: stream.quality,
          voice: stream.voice,
          stream: { url: streamProxy(stream.url), headers: stream.headers },
          subtitles: stream.subtitles
        }));
      }
    }
    return items;
  }

  async videos(context = null) {
    const requestContext = context || {};
    const query = requestContext.query || {};

    try {
      const record = await this.resolveRecord(query, requestContext);
      if (!record?.href) return { items: [], seasons: [], voices: [] };

      const embedInfo = await this.embed(record);
      if (!embedInfo) return { items: [], seasons: [], voices: [] };

      const streamProxy = (url) => buildProxyUrl(requestContext, url);
      return embedInfo.isSerial
        ? this.serialVideos(record, embedInfo, query, streamProxy)
        : this.movieVideos(record, embedInfo, query, streamProxy);
    } catch {
      return { items: [], seasons: [], voices: [] };
    }
  }

  /** Фильм: по одной играбельной записи на озвучку, мапа качеств → прокси. */
  async movieVideos(record, embedInfo, query, streamProxy) {
    const voices = embedInfo.translators || [];
    if (!voices.length) return { items: [], seasons: [], voices: [] };

    const referer = this.referer(record);
    const items = [];
    for (const translator of voices) {
      const payload = await this.fetchMovieStreams(record, translator, embedInfo.cdnStreams, embedInfo.favs, referer);
      const streams = this.normalizer.resolveStreams(payload, {
        premium: this.premium,
        hls: this.hls,
        referer,
        voice: translator.name
      });
      if (!streams.length) continue;

      const first = streams[0];
      const quality = {};
      for (const stream of streams) quality[stream.quality] = streamProxy(stream.url);

      items.push({
        method: 'play',
        title: translator.name || 'Озвучка',
        url: streamProxy(first.url),
        quality,
        headers: first.headers,
        subtitles: first.subtitles,
        voice_name: translator.name || '',
        type: 'movie'
      });
    }
    return { items, seasons: [], voices: [] };
  }

  /** Сериал: items по сериям выбранного сезона, фильтры seasons/voices. */
  async serialVideos(record, embedInfo, query, streamProxy) {
    const voices = embedInfo.translators || [];
    if (!voices.length) return { items: [], seasons: [], voices: [] };

    const translator = this.pickTranslator(voices, query);
    const source = await this.client.getEpisodes(record.id, translator.id);
    if (!source) return { items: [], seasons: [], voices: [] };

    const seasonNumber = this.pickSeason(source, query);
    if (seasonNumber == null) return { items: [], seasons: [], voices: [] };

    const seasonEpisodes = (source.episodes || [])
      .filter((episode) => Number(episode.season) === Number(seasonNumber));
    const referer = this.referer(record);

    const items = [];
    for (const episode of seasonEpisodes) {
      const payload = await this.client.getStreamEpisode(record.id, translator.id, seasonNumber, episode.episode, {}, referer);
      const streams = this.normalizer.resolveStreams(payload, {
        premium: this.premium,
        hls: this.hls,
        referer,
        voice: translator.name
      });
      if (!streams.length) continue;

      const first = streams[0];
      const quality = {};
      for (const stream of streams) quality[stream.quality] = streamProxy(stream.url);

      items.push({
        method: 'play',
        title: `${episode.episode} серия`,
        url: streamProxy(first.url),
        quality,
        headers: first.headers,
        subtitles: first.subtitles,
        season: Number(seasonNumber),
        episode: Number(episode.episode),
        voice_name: translator.name || '',
        type: 'serial'
      });
    }

    const seasons = (source.seasons || [])
      .map((season) => ({ number: Number(season.number), title: season.title || `${season.number} сезон` }));
    const voicesList = voices.map((voice, index) => ({ name: voice.name, index }));

    return { items, seasons, voices: voicesList };
  }

  /** Выбранная озвучка: по голосу-индексу из query, иначе первая. */
  pickTranslator(translators, query = {}) {
    const voices = translators || [];
    if (!voices.length) return null;
    const index = Number(query.voice) || 0;
    return voices[index] || voices[0];
  }

  /** Сезон из `seasons` (один либо переданный в query), иначе первый из серий. */
  pickSeason(source, query = {}) {
    const seasonNumbers = [...new Set((source?.seasons || []).map((season) => Number(season.number)))];
    if (seasonNumbers.length) {
      const requested = Number(query.season);
      if (seasonNumbers.includes(requested)) return requested;
      return seasonNumbers[0];
    }
    const episodeSeasons = [...new Set((source?.episodes || []).map((episode) => Number(episode.season)))];
    return episodeSeasons.length ? episodeSeasons.sort((a, b) => a - b)[0] : null;
  }

  /** Embed-URL записи — используется и как Referer к потокам, и как ключ кэша. */
  referer(record) {
    if (String(record?.href || '').startsWith('http')) return record.href;
    return `${this.client.baseUrl}/${String(record?.href || '').replace(/^\/+/, '')}`;
  }

  /**
   * Поток фильма: канонический путь get_movie (отдаёт url + subtitle).
   * cdnStreams (base64 из embed) — фолбэк, когда AJAX недоступен (гео/блок).
   * favs из embed (ctrl_favs) обязателен для Rezka get_movie.
   */
  async fetchMovieStreams(record, translator, cdnStreams, favs, referer) {
    const payload = await this.client.getStreamMovie(record.id, translator.id, { favs: favs || '' }, referer);
    if (payload) return payload;
    if (cdnStreams) return { success: true, url: cdnStreams, subtitle: '' };
    return null;
  }
}

export default RezkaProvider;