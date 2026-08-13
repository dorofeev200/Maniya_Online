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
   * Единый резолв записи для streams()/videos(): если в запросе уже есть href —
   * берём напрямую (карточка после поиска); иначе ищем по названию. Возвращает
   * null, если ничего не нашлось.
   *
   * Короткое замыкание ТОЛЬКО на href: голый `id` из карточки Lampa — это
   * TMDB id (напр. 94997), для Rezka бессмысленный. Раньше `href || id`
   * превращал его в запись с href:'' → гард videos()/streams() давал пусто →
   * «видео не найдено» на каждый клик Rezka в UI. Идём через поиск по названию,
   * как остальные провайдеры.
   */
  async resolveRecord(queryOrContext = {}, context = null) {
    const requestContext = context || (queryOrContext?.request || queryOrContext?.query ? queryOrContext : undefined);
    const query = { ...(requestContext?.query || queryOrContext || {}) };

    const href = String(query.href || '').trim();

    if (href) {
      return {
        provider: this.id,
        id: String(query.id || '').trim(),
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
   * Сезон/перевод выбираются с учётом того, что у Rezka у каждого перевода
   * свой набор сезонов (см. pickTranslatorSeason).
   */
  async serialStreams(record, embedInfo, query, streamProxy) {
    const voices = embedInfo.translators || [];
    if (!voices.length) return [];

    const byTranslator = await this.fetchTranslatorEpisodes(record, voices);
    const seasonNumbers = this.unionSeasonNumbers(byTranslator);
    const pick = this.pickTranslatorSeason(byTranslator, voices, query, seasonNumbers);
    if (!pick) return [];

    const referer = this.referer(record);
    const items = [];
    for (const episode of pick.episodes) {
      const payload = await this.client.getStreamEpisode(record.id, pick.translator.id, pick.season, episode.episode, {}, referer);
      const streams = this.normalizer.resolveStreams(payload, {
        premium: this.premium,
        hls: this.hls,
        referer,
        voice: pick.translator.name
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
    const voicesList = voices.map((voice, index) => ({ name: voice.name, index }));
    if (!voices.length) return { items: [], seasons: [], voices: [] };

    const referer = this.referer(record);
    const byTranslator = await this.fetchTranslatorEpisodes(record, voices);

    // seasons = объединение сезонов по всем переводам: у разных озвучек разный
    // набор сезонов (у «Дубляж» только последний сезон, у LostFilm — все),
    // фильтр сезонов должен показывать все доступные, а не только избранного.
    const seasonNumbers = this.unionSeasonNumbers(byTranslator);
    const seasons = seasonNumbers.map((number) => ({ number, title: `${number} сезон` }));

    const pick = this.pickTranslatorSeason(byTranslator, voices, query, seasonNumbers);
    if (!pick) return { items: [], seasons, voices: voicesList };

    const items = [];
    for (const episode of pick.episodes) {
      const payload = await this.client.getStreamEpisode(record.id, pick.translator.id, pick.season, episode.episode, {}, referer);
      const streams = this.normalizer.resolveStreams(payload, {
        premium: this.premium,
        hls: this.hls,
        referer,
        voice: pick.translator.name
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
        season: Number(pick.season),
        episode: Number(episode.episode),
        voice_name: pick.translator.name || '',
        type: 'serial'
      });
    }

    return { items, seasons, voices: voicesList };
  }

  /** Выбранная озвучка: по голосу-индексу из query, иначе первая. */
  pickTranslator(translators, query = {}) {
    const voices = translators || [];
    if (!voices.length) return null;
    const index = Number(query.voice) || 0;
    return voices[index] || voices[0];
  }

  /**
   * Сезоны/серии по всем переводам записи. Rezka отдаёт `get_episodes` только для
   * одного перевода, и у разных переводов разный набор сезонов (например, «Дубляж»
   * может иметь лишь последний сезон, а LostFilm — все). Возвращает Map
   * translator.id → { translator, seasons, episodes } только для переводов с сериями.
   */
  async fetchTranslatorEpisodes(record, translators = []) {
    const results = await Promise.all(
      translators.map((translator) =>
        this.client.getEpisodes(record.id, translator.id).then((source) => ({ translator, source }))
      )
    );
    const out = new Map();
    for (const { translator, source } of results) {
      if (!source || !(source.episodes || []).length) continue;
      out.set(String(translator.id), {
        translator,
        seasons: source.seasons || [],
        episodes: source.episodes || []
      });
    }
    return out;
  }

  /** Объединённый, отсортированный список номеров сезонов по всем переводам. */
  unionSeasonNumbers(byTranslator) {
    return [...new Set(
      [...byTranslator.values()]
        .flatMap((entry) => entry.seasons.map((season) => Number(season.number)))
        .filter(Number.isFinite)
    )].sort((left, right) => left - right);
  }

  /**
   * Перевод + сезон для сериала. Сезон = запрошенный, иначе первый из
   * объединённого списка; перевод = выбранный голос, а если у него нет этого
   * сезона — первый (в порядке списка) перевод, у которого сезон есть.
   */
  pickTranslatorSeason(byTranslator, voices, query = {}, seasonNumbers = []) {
    const requestedSeason = query.season && query.season !== '-1' ? Number(query.season) : NaN;
    const season = Number.isFinite(requestedSeason) && seasonNumbers.includes(requestedSeason)
      ? requestedSeason
      : seasonNumbers[0];
    if (season == null) return null;

    const voiceIndex = Number(query.voice) || 0;
    const preferred = voices[voiceIndex] || voices[0];
    const candidates = preferred ? [preferred, ...voices.filter((voice) => voice !== preferred)] : voices;

    for (const translator of candidates) {
      const entry = byTranslator.get(String(translator.id));
      if (!entry) continue;
      const episodes = (entry.episodes || [])
        .filter((episode) => Number(episode.season) === Number(season))
        .sort((left, right) => Number(left.episode) - Number(right.episode));
      if (episodes.length) return { translator, season, episodes };
    }
    return null;
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