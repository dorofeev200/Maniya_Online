import { buildProxyUrl } from '../../proxy.js';
import { HttpError } from '../../errors.js';
import { Provider } from '../base.js';
import { CollapsClient } from './CollapsClient.js';
import { CollapsNormalizer } from './CollapsNormalizer.js';
import { searchNameTo } from '../shared/normalize/searchNameTo.js';

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
    } catch (error) {
      // COLLAPS-FIX-001 (D): один HTTP-отказ НЕ равен «видео отсутствует».
      // 422/403/451 = host-гейт/rate-limit (контент может быть, egress закрыт);
      // 404 = неверный маршрут/identity; сеть/5xx = транзиентный сбой. Возвращаем
      // классификацию в provider_error — настоящий EMPTY (пустой parse) НЕ сюда.
      return { items: [], seasons: [], voices: [], provider_error: classifiedError(error) };
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

  /**
   * Embed-запрос по ЕДИНОЙ identity-модели (COLLAPS-FIX-001 A/B/ID-ROUTE).
   *
   * explicit-ключи карточки (kp/imdb/orid) — прямой маршрут. query.id — НЕ
   * collaps-identity (это TMDB id), он НЕ участвует в маршруте: иначе
   * `/embed/movie/{tmdb}` детерминированно даёт 404 (арх-аудит §7.3.2).
   * Если явных ключей нет (title-only-карточка) — берём ТУ ЖЕ запись, что
   * дал search (show:true): videos() больше не угадывает фильм заново,
   * shape-расхождение «search found → videos пусто» устранено.
   */
  async embed(query, requestContext) {
    requestContext = requestContext || (query?.request ? query : undefined);
    const identity = await this.resolveIdentity(query, requestContext);
    if (!identity) return { text: '', embedHost: '' };

    try {
      return await this.client.embed({
        kinopoiskId: identity.kinopoiskId,
        imdbId: identity.imdbId,
        orid: identity.orid,
        embedHost: identity.embedHost || query.embedHost || undefined
      });
    } catch (error) {
      // Классификация до проброса: клиент вешает kind в details (см. CollapsClient),
      // здесь гарантируем наличие details для videos()/recordByKeys().
      throw ensureClassified(error);
    }
  }

  /**
   * Каноническая identity Collaps: явные kp/imdb/orid → иначе поиск по названию
   * и выбор лучшего совпадения (bestMatch). Возвращает однородный объект.
   */
  async resolveIdentity(query = {}, requestContext = null) {
    const kinopoiskId = Number(query.kinopoisk_id || query.kp || 0) || 0;
    const imdbId = String(query.imdb_id || query.imdb || '').trim();
    const orid = Number(query.orid || 0) || 0;
    if (kinopoiskId || imdbId || orid) {
      return { kinopoiskId, imdbId, orid, embedHost: query.embedHost };
    }

    const title = String(query.title || '').trim();
    if (!title) return null;

    const root = await this.client.search(title);
    const match = this.bestMatch(root, query);
    if (!match) return null;

    return {
      kinopoiskId: Number(match.kinopoisk_id || 0) || 0,
      imdbId: match.imdb_id || '',
      orid: Number(match.id || 0) || 0,
      embedHost: match.embedHost || ''
    };
  }

  /**
   * Лучшее совпадение из результатов поиска: нормализованный title/оригинальное
   * название + год (если задан) + наличие kinopoisk_id / iframe_url. Display-name
   * в identity НЕ участвует (вообще, а не только здесь).
   */
  bestMatch(root, query = {}) {
    const results = Array.isArray(root?.results) ? root.results : [];
    if (!results.length) return null;

    const queryTitle = searchNameTo(String(query.title || ''));
    const year = Number(query.year || 0) || 0;

    let best = null;
    let bestScore = -1;
    for (const item of results) {
      const name = searchNameTo(String(item.name || item.origin_name || ''));
      const origin = searchNameTo(String(item.origin_name || ''));
      let score = 0;
      if (queryTitle && (name === queryTitle || (origin && origin === queryTitle))) score += 3;
      else if (queryTitle && (name.includes(queryTitle) || (origin && origin.includes(queryTitle)))) score += 1;
      if (year > 0 && Number(item.year) === year) score += 2;
      if (Number(item.kinopoisk_id || 0) || 0) score += 1;
      if (item.iframe_url) score += 1;
      if (score > bestScore) { bestScore = score; best = item; }
    }
    return best;
  }

  /** По ключу карточки → запись провайдера для movie()/serial(). */
  async recordByKeys(query, request) {
    const identity = await this.resolveIdentity(query, request);
    const { text } = await this.embed(query, request);
    const parsed = this.normalizer.parseEmbed(text, query);
    if (!parsed.movie && !parsed.seasons.length) return null;

    const type = parsed.movie ? 'movie' : 'serial';
    const url = parsed.movie?.url || parsed.seasons[0]?.episodes[0]?.url || '';
    const title = parsed.movie?.title || parsed.seasons[0]?.title || query.title || '';

    const deadline = {
      provider: 'collaps',
      id: String(identity?.orid || identity?.kinopoiskId || 0),
      orid: Number(identity?.orid || 0) || 0,
      kinopoisk_id: Number(identity?.kinopoiskId || 0) || null,
      imdb_id: identity?.imdbId || query.imdb_id || null,
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

/** Классификация ошибки коллапса для provider_error (COLLAPS-FIX-001 D). */
function classifiedError(error) {
  const base = {
    kind: 'error',
    message: String((error && error.message) || error).slice(0, 100)
  };
  if (error instanceof HttpError) {
    const kind = typeof error.details?.kind === 'string' ? error.details.kind : httpKind(error.statusCode);
    return { ...base, kind, status: error.statusCode, code: error.code };
  }
  return base;
}

/**
 * Кто виноват в HTTP-отказе collaps:
 *  - 404 (и 400/405) — неверный маршрут/identity (`/embed/movie/{tmdb-id}`);
 *  - 403/422/451 — host-гейт/rate-limit (контент ЕСТЬ, egress/деплой закрыт — GAP-002);
 *  - 5xx/прочее — транзиентный отказ апстрима.
 * НЕ затрагивает глобальную availability-семантику (HARD_REFUSAL_STATUSES) — это
 * только диагностика коллапса в ответе /videos.
 */
function httpKind(status) {
  if (status === 404 || status === 400 || status === 405) return 'invalid-route';
  if (status === 403 || status === 422 || status === 451) return 'upstream-refusal';
  if (status >= 500) return 'upstream';
  return 'http';
}

/** Гарантировать details.kind на HttpError (если клиент ещё не классифицировал). */
function ensureClassified(error) {
  if (error instanceof HttpError && !error.details?.kind) {
    error.details = { ...(error.details || {}), kind: httpKind(error.statusCode) };
  }
  return error;
}

export default CollapsProvider;