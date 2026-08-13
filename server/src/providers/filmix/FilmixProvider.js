import { config } from '../../config.js';
import { Provider } from '../base.js';
import { buildProxyUrl, tokenFromRequest } from '../../proxy.js';
import { isHttpUrl } from '../shared/utils/Url.js';
import { normalizeQuality } from '../shared/normalize/QualityNormalizer.js';
import { normalizeVoice } from '../shared/normalize/VoiceNormalizer.js';
import { FilmixClient } from './FilmixClient.js';
import { FilmixNormalizer } from './FilmixNormalizer.js';

const FILMIX_STREAM_HEADERS = { Referer: 'https://filmix.my/' };

export class FilmixProvider extends Provider {
  static id = 'filmix';
  static title = 'Filmix';

  constructor({ client = null, normalizer = null, token = '', pro = config.filmix.pro, hls = config.filmix.hls, enabled = config.filmix.enabled, host, tvHost, streamProxy = (url) => url, ...options } = {}) {
    super(options);
    this.enabledFlag = Boolean(enabled);
    this.pro = pro;
    this.hls = hls;
    this.hideFree720 = !token;
    this.client = client || new FilmixClient({
      token, host, tvHost,
      tvUser: config.filmix.tvUser,
      tvPassword: config.filmix.tvPassword
    });
    this.normalizer = normalizer || this.createNormalizer(streamProxy);
  }

  createNormalizer(streamProxy = (url) => url) {
    return new FilmixNormalizer({
      pro: this.pro,
      hls: this.hls,
      streamProxy,
      hideFree720: this.hideFree720
    });
  }

  name() {
    return this.id;
  }

  enabled() {
    return this.enabledFlag;
  }

  async search(queryOrContext = {}, context = null) {
    const requestContext = context || (queryOrContext?.request ? queryOrContext : undefined);
    const query = requestContext?.query || queryOrContext || {};

    const title = String(query.title || '');
    const originalTitle = String(query.original_title || query.originalTitle || '');
    const year = String(query.year || '');
    const clarification = query.clarification ? 1 : 0;

    // PRIMARY: api.filmix.tv/api-fx/list (FilmixTV.Search) — единственный живой поиск.
    // searchByExternalIds (story={kp/imdb}) удалён по итогам FILMIX-001: story-поиск по
    // внешним id отдаёт несвязанные тайтлы (tt0109830 → «Демонолог»), полезных
    // результатов нет, а два пустых параллельных запроса только добавляют latency.
    const byTitle = await this.client.search({ title, originalTitle, clarification, year }, requestContext);

    const seen = new Set();
    const records = [];
    for (const item of byTitle.items) {
      const record = this.normalizer.normalizeSearchItem(item);
      if (!record.id || seen.has(String(record.id))) continue;
      seen.add(String(record.id));
      records.push({ provider: this.id, ...record });
    }
    return records;
  }

  searchMovie(query = {}, context = null) {
    return this.search({ ...query, type: 'movie' }, context);
  }

  searchSeries(query = {}, context = null) {
    return this.search({ ...query, type: 'serial' }, context);
  }

  async resolveCard(postId, context = null) {
    if (postId === undefined || postId === null || postId === '') return null;
    return this.client.card(postId, context);
  }

  detectType(card) {
    if (Array.isArray(card?.player_links?.movie) && card.player_links.movie.length) return 'movie';
    if (card?.player_links?.playlist) return 'serial';
    return 'movie';
  }

  async streams(item, context) {
    const requestContext = context || (item?.request ? item : undefined);
    const query = requestContext?.query || item?.query || {};
    const id = String(item?.id || query.id || '').trim();
    if (!id) return [];

    const title = String(item?.title || query.title || this.title);

    // PRIMARY: browser-API api-fx video-links (Lampac FilmixTV.VideoLinks). Возвращает
    // готовые ссылки, работает на api.filmix.tv живьём (FILMIX-001: HTTP 200), без учётки
    // — анонимно, с учёткой — Bearer. Карточный путь filmix.my/api/v2/post сейчас мёртв
    // (301→501), поэтому это единственный источник стримов.
    const links = typeof this.client.videoLinks === 'function'
      ? await this.client.videoLinks(id, requestContext)
      : null;
    if (links) return this.streamsFromLinks(id, title, links, (url) => buildProxyUrl(requestContext, url), query);

    // FALLBACK: filmix.my/api/v2/post (Lampac Filmix) — на случай восстановления mirror.
    const card = await this.client.card(id, requestContext);
    if (card) return this.cardStreamItems(id, query, title, card, requestContext);
    return [];
  }

  cardStreamItems(id, query, title, card, requestContext) {
    const type = this.detectType(card);
    const normalizer = this.createNormalizer((url) => buildProxyUrl(requestContext, url));
    const toStreamItems = (streams) => streams.map((stream) => this.streamItem({
      id,
      title,
      type,
      quality: stream.quality,
      voice: stream.voice,
      stream: {
        url: stream.url,
        headers: stream.headers
      },
      subtitles: stream.subtitles || []
    }));

    if (type === 'movie') return toStreamItems(normalizer.movieStreams(card));

    const playlist = card.player_links.playlist || {};
    const seasonKey = query.season && query.season !== '-1'
      ? String(query.season)
      : String(Object.keys(playlist)[0] || 1);
    const voiceIndex = Number(query.voice) || 0;
    const episodes = normalizer.episodes(card, seasonKey, voiceIndex, title);

    return episodes.flatMap((episode) => toStreamItems(episode.streams));
  }

  async videos(context = null) {
    const requestContext = context || {};
    const query = requestContext.query || {};
    const records = await this.search(context);
    if (!records.length) return { items: [], seasons: [], voices: [] };

    const selectedId = String(query.id || '').trim();
    const record = (selectedId && records.find((item) => String(item.id) === selectedId))
      || this.pickRecord(records, query)
      || records[0];
    if (!record?.id) return { items: [], seasons: [], voices: [] };

    const streamProxy = (url) => buildProxyUrl(requestContext, url);

    // PRIMARY: browser-API api-fx video-links (Lampac FilmixTV.VideoLinks) — живой источник
    // стримов. Карточный путь ниже остаётся только как fallback.
    const links = typeof this.client.videoLinks === 'function'
      ? await this.client.videoLinks(record.id, requestContext)
      : null;
    if (links) return this.videosFromLinks(links, query, streamProxy);

    // FALLBACK: filmix.my/api/v2/post (Lampac Filmix) — на случай восстановления mirror.
    const card = await this.client.card(record.id, requestContext);
    if (card) return this.videosFromCard(card, record, query, streamProxy);
    return { items: [], seasons: [], voices: [] };
  }

  videosFromCard(card, record, query, streamProxy) {
    const normalizer = this.createNormalizer(streamProxy);
    const type = this.detectType(card);
    const title = String(record.title || query.title || this.title);

    if (type === 'movie') return this.movieVideos(card, normalizer);

    const voices = normalizer.voices(card);
    const seasons = normalizer.seasons(card).map((season) => ({ number: season.number, title: season.title }));
    const seasonKey = query.season && query.season !== '-1'
      ? String(query.season)
      : String(Object.keys(card.player_links.playlist || {})[0] || 1);
    const voiceIndex = Number(query.voice) || 0;
    const voiceName = voices[voiceIndex] || '';

    const seasonNumber = seasonKey === '-1' ? 1 : Number(seasonKey);
    const items = normalizer.episodes(card, seasonKey, voiceIndex, title).map((episode) => {
      const first = episode.streams[0];
      return {
        method: 'play',
        title: episode.title,
        url: first?.url || '',
        quality: qualityMap(episode.streams),
        headers: first?.headers || {},
        subtitles: first?.subtitles || [],
        season: seasonNumber,
        episode: episode.number,
        voice_name: voiceName,
        type: 'serial'
      };
    });

    return { items, seasons, voices: voices.map((name, index) => ({ name, index })) };
  }

  videosFromLinks(links, query, streamProxy) {
    return Array.isArray(links)
      ? this.movieVideosFromLinks(links, streamProxy)
      : this.serialVideosFromLinks(links, query, streamProxy);
  }

  movieVideosFromLinks(tracks, streamProxy) {
    const items = [];
    for (const track of tracks || []) {
      const files = this.allowedFiles(track.files);
      if (!files.length) continue;
      const sorted = [...files].sort((left, right) => qualityRank(right.quality) - qualityRank(left.quality));
      const voiceName = normalizeVoice(track.voiceover);
      const first = sorted[0];
      items.push({
        method: 'play',
        title: voiceName || 'Озвучка',
        url: streamProxy(first.url),
        quality: qualityMapFromFiles(sorted, streamProxy),
        headers: { ...FILMIX_STREAM_HEADERS },
        subtitles: [],
        voice_name: voiceName,
        type: 'movie'
      });
    }
    return { items, seasons: [], voices: [] };
  }

  serialVideosFromLinks(data, query, streamProxy) {
    const voiceKeys = Object.keys(data || {});
    const voices = voiceKeys.map((key) => normalizeVoice(key)).filter(Boolean);
    const seasonNumbers = [...new Set(voiceKeys.flatMap((key) =>
      Object.values(data[key] || {}).map((season) => Number(season.season)).filter(Number.isFinite)
    ))].sort((left, right) => left - right);
    const seasons = seasonNumbers.map((number) => ({ number, title: `${number} сезон` }));

    const seasonKey = query.season && query.season !== '-1'
      ? String(query.season)
      : String(seasonNumbers[0] || 1);
    const voiceIndex = Number(query.voice) || 0;
    const voiceName = voices[voiceIndex] || '';
    const seasonContainer = data[voiceKeys[voiceIndex]] || {};
    const seasonEntry = seasonContainer[`season-${seasonKey}`] || seasonContainer[seasonKey] || null;
    const episodes = Object.values(seasonEntry?.episodes || {})
      .sort((left, right) => Number(left.episode) - Number(right.episode));

    const items = episodes.map((episode) => {
      const files = this.allowedFiles(episode.files);
      const sorted = [...files].sort((left, right) => qualityRank(right.quality) - qualityRank(left.quality));
      const first = sorted[0];
      // Filmix api-fx отдаёт реальное название серии в episode.title. Пробрасываем
      // его в UI без потери (FILMIX-003); пустой title → фолбэк «N серия».
      const realTitle = String(episode.title || '').trim();
      return {
        method: 'play',
        title: realTitle || `${Number(episode.episode) || 0} серия`,
        url: first?.url ? streamProxy(first.url) : '',
        quality: qualityMapFromFiles(sorted, streamProxy),
        headers: { ...FILMIX_STREAM_HEADERS },
        subtitles: [],
        season: Number(seasonKey) || 1,
        episode: Number(episode.episode) || 0,
        voice_name: voiceName,
        type: 'serial'
      };
    });

    return { items, seasons, voices: voices.map((name, index) => ({ name, index })) };
  }

  streamsFromLinks(id, title, links, streamProxy, query = {}) {
    const items = [];
    const pushFile = (file, voiceName, type) => {
      for (const allowed of this.allowedFiles(file.files || [])) {
        items.push(this.streamItem({
          id,
          title,
          type,
          quality: normalizeQuality(String(allowed.quality)),
          voice: voiceName,
          stream: {
            url: streamProxy(allowed.url),
            headers: { ...FILMIX_STREAM_HEADERS }
          },
          subtitles: []
        }));
      }
    };

    if (Array.isArray(links)) {
      for (const track of links) {
        pushFile({ files: track.files }, normalizeVoice(track.voiceover), 'movie');
      }
      return items;
    }

    // Сериал: один голос (как карточный путь) и, если задан, выбранный сезон.
    const voiceKeys = Object.keys(links || {});
    const voiceIndex = Number(query.voice) || 0;
    const seasonKey = query.season && query.season !== '-1' ? String(query.season) : null;
    const seasonContainer = links[voiceKeys[voiceIndex]] || {};
    for (const seasonEntry of Object.values(seasonContainer)) {
      if (seasonKey && String(seasonEntry.season) !== seasonKey) continue;
      for (const episodeEntry of Object.values(seasonEntry?.episodes || {})) {
        pushFile({ files: episodeEntry.files }, normalizeVoice(voiceKeys[voiceIndex]), 'serial');
      }
    }
    return items;
  }

  allowedFiles(files = []) {
    const seen = new Set();
    return (files || [])
      .filter((file) => file && isHttpUrl(file.url) && Number.isFinite(Number(file.quality)))
      .filter((file) => {
        const key = String(file.quality);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  movieVideos(card, normalizer) {
    const byVoice = new Map();
    for (const stream of normalizer.movieStreams(card)) {
      const key = stream.voice || '';
      if (!byVoice.has(key)) byVoice.set(key, []);
      byVoice.get(key).push(stream);
    }

    const items = [];
    for (const [voice, streams] of byVoice) {
      const sorted = [...streams].sort((left, right) => qualityRank(right.quality) - qualityRank(left.quality));
      const first = sorted[0];
      items.push({
        method: 'play',
        title: voice || 'Озвучка',
        url: first.url,
        quality: qualityMap(sorted),
        headers: first.headers,
        subtitles: first.subtitles,
        voice_name: voice,
        type: 'movie'
      });
    }
    return { items, seasons: [], voices: [] };
  }

  pickRecord(records, query = {}) {
    const normalize = (value) => this.client.normalizeSearchName(value);
    const title = normalize(query.title);
    const original = normalize(query.original_title || query.originalTitle);
    const year = Number(query.year) || null;

    const scored = records.map((record) => {
      let score = 0;
      const recordTitle = normalize(record.title);
      const recordOriginal = normalize(record.original_title);
      if (title && (recordTitle === title || recordOriginal === title)) score += 3;
      if (original && (recordOriginal === original || recordTitle === original)) score += 3;
      if (year && Number(record.year) === year) score += 1;
      return { record, score };
    });

    const best = scored.sort((left, right) => right.score - left.score)[0];
    return best && best.score > 0 ? best.record : null;
  }

  getCard(postId, context = null) {
    return this.client.card(postId, context);
  }

  async getStreams(postId, metadata = {}, context = null) {
    const card = typeof postId === 'object' ? postId : await this.client.card(postId, context);
    return this.normalizer.toStreamItems(card, metadata);
  }

  async getVoices(postId, seasonNumber = null, context = null) {
    const card = typeof postId === 'object' ? postId : await this.client.card(postId, context);
    return this.normalizer.voices(card, seasonNumber);
  }

  async getQualities(postId, options = {}, context = null) {
    const card = typeof postId === 'object' ? postId : await this.client.card(postId, context);
    return this.normalizer.qualities(card, options);
  }

  async getSeasons(postId, context = null) {
    const card = typeof postId === 'object' ? postId : await this.client.card(postId, context);
    return this.normalizer.seasons(card);
  }

  async getEpisodes(postId, seasonNumber, voiceIndex = 0, title = null, context = null) {
    const card = typeof postId === 'object' ? postId : await this.client.card(postId, context);
    return this.normalizer.episodes(card, seasonNumber, voiceIndex, title);
  }
}

function qualityRank(quality) {
  const parsed = Number.parseInt(String(quality || ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function qualityMap(streams = []) {
  const qualityByUrl = {};
  for (const stream of streams) {
    if (stream.quality && stream.url) qualityByUrl[stream.quality] = stream.url;
  }
  return qualityByUrl;
}

function qualityMapFromFiles(files = [], streamProxy = (url) => url) {
  const qualityByUrl = {};
  for (const file of files) {
    if (file.quality && file.url) qualityByUrl[normalizeQuality(String(file.quality))] = streamProxy(file.url);
  }
  return qualityByUrl;
}

export default FilmixProvider;