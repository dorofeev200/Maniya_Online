import { buildProxyUrl } from '../../proxy.js';
import { Provider } from '../base.js';
import { HDVBClient } from './HDVBClient.js';
import { HDVBNormalizer } from './HDVBNormalizer.js';

/**
 * Провайдер HDVB — перенос Lampac OnlineRUS/HDVB.
 *
 * Фильм: API → iframe → POST playlist → подписанная m3u8 (через наш прокси).
 * Сериал: API окончательно.Video[] с переводами (serial_episodes) → выбор
 * сезона/перевода → iframe → POST playlist (List<Folder>) → выбор серии по
 * id|episode|title перевода → POST → m3u8.
 *
 * Подписанная ссылка привязана к IP запрашивающего (наш VPS): если PLAYSLIST
 * POST идёт с того же хоста, что и прокси-фетч m3u8 — играет (сегменты без
 * заголовков).
 */
export class HDVBProvider extends Provider {
  static id = 'hdvb';
  static title = 'HDVB';

  constructor({ enabled = true, apihost, frameHost, token, referer, client = null, normalizer = null, ...options } = {}) {
    super(options);
    this.enabledFlag = enabled;
    this.client = client || new HDVBClient({ apihost, frameHost, token, referer });
    this.normalizer = normalizer || new HDVBNormalizer();
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
    try {
      const data = await this.fetchData(query);
      return this.normalizer.search(data, query);
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

  /** Основной вход → play-записи + фильтры сезонов/озвучек. */
  async videos(context = {}) {
    if (!this.enabled()) return { items: [], seasons: [], voices: [] };
    const requestContext = context || {};
    const query = requestContext.query || {};
    const streamProxy = (url) => buildProxyUrl(requestContext, url);

    try {
      const data = await this.fetchData(query);
      const isSerial = Number(query.serial) === 1;
      const pool = data.filter((v) => v && v.type === (isSerial ? 'serial' : 'movie'));
      if (!pool.length) return { items: [], seasons: [], voices: [] };

      return isSerial
        ? await this.serialVideos(pool, query, streamProxy)
        : await this.movieVideos(pool[0], query, streamProxy);
    } catch {
      return { items: [], seasons: [], voices: [] };
    }
  }

  async movieVideos(video, query, streamProxy) {
    const iframePath = pathOf(video.iframe_url);
    if (!iframePath) return { items: [], seasons: [], voices: [] };

    const embed = await this.playlist(iframePath);
    if (!embed.ready) return { items: [], seasons: [], voices: [] };

    const m3u8 = await this.resolvePlaylist(embed, null);
    if (!m3u8) return { items: [], seasons: [], voices: [] };

    const voice = String(video.translator || '').trim();
    return {
      items: [{
        method: 'play',
        type: 'movie',
        title: query.title || video.title_ru || video.title_en || '…',
        url: streamProxy(m3u8),
        quality: { auto: streamProxy(m3u8) },
        headers: {},
        subtitles: [],
        voice_name: voice,
        sound: voice ? [voice] : []
      }],
      seasons: [],
      voices: voice ? [{ name: voice, index: 0 }] : []
    };
  }

  async serialVideos(pool, query, streamProxy) {
    const seasons = this.collectSeasons(pool);
    if (!seasons.length) return { items: [], seasons: [], voices: [] };

    const seasonNumber = Number(query.season > 0 && seasons.some((s) => s.number === Number(query.season))
      ? query.season
      : seasons[0].number);

    const voicePool = pool.filter((v) => v.serial_episodes?.some((s) => s.season_number === seasonNumber));
    if (!voicePool.length) return { items: [], seasons, voices: [] };
    const voices = voicePool.map((v, i) => ({ name: String(v.translator || `Озвучка ${i + 1}`), index: i }));

    let voiceIndex = Number(query.voice);
    if (!Number.isInteger(voiceIndex) || voiceIndex < 0 || voiceIndex >= voicePool.length) voiceIndex = 0;
    const record = voicePool[voiceIndex];
    const translator = String(record.translator || '').trim();

    const items = await this.serialItems(record, seasonNumber, translator, query, streamProxy);

    return { items, seasons, voices };
  }

  /** Все серии выбранного сезона/перевода — каждый эпизод → m3u8. */
  async serialItems(record, seasonNumber, translator, query, streamProxy) {
    const iframePath = pathOf(record.iframe_url);
    if (!iframePath) return [];

    const embed = await this.playlist(iframePath);
    if (!embed.ready) return [];

    const listText = await this.client.postPlaylist({
      href: embed.href,
      file: this.normalizer.cleanFile(embed.file),
      key: embed.key,
      origin: this.frameOrigin()
    });
    const parsed = this.normalizer.parsePlaylistResponse(listText);
    if (!Array.isArray(parsed.folders)) return [];

    const seasonInfo = (record.serial_episodes || []).find((s) => s.season_number === seasonNumber);
    const episodes = Array.isArray(seasonInfo?.episodes) ? seasonInfo.episodes : [];

    const items = [];
    for (const episode of episodes) {
      const file = this.normalizer.episodeFile(parsed.folders, seasonNumber, episode, translator);
      if (!file) continue;
      const m3u8 = await this.resolvePlaylist(embed, file);
      if (!m3u8) continue;
      items.push({
        method: 'play',
        type: 'serial',
        title: `${episode} серия`,
        url: streamProxy(m3u8),
        quality: { auto: streamProxy(m3u8) },
        headers: {},
        subtitles: [],
        voice_name: translator || 'По умолчанию',
        season: seasonNumber,
        episode
      });
    }
    return items;
  }

  /** iframe GET + extract → embed {href, key, file, ready}. */
  async playlist(iframePath) {
    const html = await this.client.iframe(iframePath);
    return this.normalizer.extractEmbed(html);
  }

  /**
   * POST playlist → m3u8 (с 2-й итерацией для movie). episodeFile — необязательный
   * file конкретной серии (иначе file из iframe).
   *
   * FINAL-PLAYBACK-GAP-001: свежие фильмы возвращают JSON-массив озвучек
   * `[{title,id,translator,file}]` вместо прямого m3u8. После nextFile-итерации
   * при наличии voice-массива берём Дубляж (voiceFile) и делаем финальный POST.
   */
  async resolvePlaylist(embed, episodeFile) {
    const post = (file) => this.client.postPlaylist({
      href: embed.href,
      key: embed.key,
      file: this.normalizer.cleanFile(file),
      origin: this.frameOrigin()
    });
    let text = await post(episodeFile || embed.file);
    let parsed = this.normalizer.parsePlaylistResponse(text);
    if (parsed.nextFile) {
      text = await post(parsed.nextFile);
      parsed = this.normalizer.parsePlaylistResponse(text);
    }
    if (!parsed.m3u8 && Array.isArray(parsed.folders)) {
      const voiceFile = this.normalizer.voiceFile(parsed.folders);
      if (voiceFile) {
        text = await post(voiceFile);
        parsed = this.normalizer.parsePlaylistResponse(text);
      }
    }
    return parsed.m3u8 || '';
  }

  /** Хост плеера: для Origin/Referer playlist POST (fixframe origin). */
  frameOrigin() {
    return this.client.frameHost;
  }

  /** Список сезонов из всех записей (без озвучек), по возрастанию. */
  collectSeasons(pool) {
    const seen = new Set();
    for (const v of pool) {
      for (const s of v.serial_episodes || []) {
        const n = Number(s.season_number);
        if (Number.isInteger(n) && n > 0) seen.add(n);
      }
    }
    return [...seen].sort((a, b) => a - b).map((number) => ({ number, title: `${number} сезон` }));
  }

  // --- helpers ---

  async fetchData(query) {
    const kinopoiskId = Number(query.kinopoisk_id || query.kp || 0) || 0;
    const title = String(query.title || query.original_title || '').trim();
    const data = await this.client.videos({ kinopoiskId, title });
    let list = Array.isArray(data) ? data : [];
    // HDVB-TITLE-ONLY-001: title-only (kp=0) может вернуть пусто, хотя фильм есть
    // в апстриме под оригинальным названием («Гладиатор II» → 0, «Gladiator II» → 3).
    // Ретрай с original_title только при пустом первичном поиске — не ослабляет
    // фильтры (не расширяет по подобию), год по-прежнему отбирает preferYear.
    if (!kinopoiskId && !list.length) {
      const originalTitle = String(query.original_title || '').trim();
      if (originalTitle && originalTitle !== title) {
        const retry = await this.client.videos({ kinopoiskId: 0, title: originalTitle });
        if (Array.isArray(retry)) list = retry;
      }
    }
    return kinopoiskId ? list : this.preferYear(list, query);
  }

  /**
   * FINAL-PLAYBACK-GAP-001: title-поиск hdvb не фильтрует по году и часто отдаёт
   * первым «севфильм» («Матрица» → «Матрица: Воскрешение» 2021, «Интерстеллар» →
   * «блуждающие земляне» 2019). Lampac в kp=0-ветке показывает список кандидатов;
   * здесь при наличии query.year делаем ближайший выбор — записи с совпадающим
   * годом вперёд, прочие сохраняют порядок. Без года — прежнее поведение (первая).
   */
  preferYear(records, query) {
    const year = Number(query.year) || 0;
    if (!year || !records.length) return records;
    const match = records.filter((v) => Number(v?.year) === year);
    if (!match.length) return records;
    return [...match, ...records.filter((v) => Number(v?.year) !== year)];
  }

  async recordsByType(queryOrContext, context, type) {
    const records = await this.search(queryOrContext, context);
    return records.filter((record) => record.type === type);
  }

  /** url → StreamItem (простывка подписанной m3u8 через прокси). */
  async streams(item = {}, context) {
    if (!this.enabled()) return [];
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
      stream: { url: streamProxy(mediaUrl), headers: {} },
      subtitles: []
    })];
  }
}

function pathOf(url) {
  try { return new URL(url).pathname; } catch { return ''; }
}

export default HDVBProvider;