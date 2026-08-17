import { buildProxyUrl } from '../../proxy.js';
import { Provider } from '../base.js';
import { RutubeClient } from './RutubeClient.js';
import { RutubeNormalizer } from './RutubeNormalizer.js';
import { searchNameTo } from '../shared/normalize/searchNameTo.js';

// Только фильмы (ModInit выключает провайдера для serial).
const VOICE = 'Оригинал';

/**
 * Провайдер RutubeMovie — перенос Lampac OnlineRUS/RutubeMovie.
 *
 * Фильм только: поиск по Rutube-API, потоки — adaptive HLS (quality "auto")
 * из `api/play/options/{linkid}` → `video_balancer.m3u8`, через наш прокси.
 */
export class RutubeProvider extends Provider {
  static id = 'rutubemovie';
  static title = 'Rutube';

  constructor({ enabled = true, host, client = null, normalizer = null, ...options } = {}) {
    super(options);
    this.enabledFlag = enabled;
    this.client = client || new RutubeClient({ host });
    this.host = this.client.host;
    this.normalizer = normalizer || new RutubeNormalizer();
  }

  name() {
    return this.id;
  }

  enabled() {
    return Boolean(this.enabledFlag);
  }

  async search(queryOrContext = {}, context = null) {
    if (!this.enabled()) return [];

    const { title, year, originalTitle } = this.parseQuery(queryOrContext, context);
    const searchKeys = dedupeKeys(title, originalTitle);
    if (!searchKeys.length) return [];

    try {
      // Multi-query: русское + оригинальное название. Сначала — с годом; если в
      // yearful-выдаче НЕТ НИ ОДНОЙ сильной записи (bestScore < STRONG_SCORE) —
      // повтор без года. Год в полях API отсутствует, полная копия может лежать
      // под запросом без него: «Зелёная Миля» 6460с находится по «Зеленая миля»,
      // а не по «Зеленая миля 1999» (там top-2 страниц дают пересказ/реакшн-шоу).
      // Каждый вариант ограничен 2 страницами (RutubeClient.MAX_PAGES).
      const normalizer = this.normalizer.with({ searchKeys, year });
      const yearful = await this.client.searchAll(buildQueries(title, originalTitle, year));
      let records = normalizer.searchResults(yearful);
      if (year > 0 && normalizer.bestScore(yearful) < RutubeNormalizer.STRONG_SCORE) {
        const yearless = await this.client.searchAll(buildQueries(title, originalTitle, 0));
        const relaxed = normalizer.searchResults(yearless);
        if (relaxed.length) records = relaxed;
      }
      return records;
    } catch {
      return [];
    }
  }

  async movie(queryOrContext = {}, context = null) {
    return (await this.search(queryOrContext, context)).filter((record) => record.type === 'movie');
  }

  async serial() {
    return []; // Rutube — только фильмы.
  }

  /** Play options → играбельная запись `{method:'play'}` одной качественной "auto". */
  async videos(context = null) {
    const requestContext = context || {};
    const query = requestContext.query || {};

    try {
      const records = await this.search(query, requestContext);
      if (!records.length) return { items: [], seasons: [], voices: [] };

      const streamProxy = (url) => buildProxyUrl(requestContext, url);
      const items = [];
      for (const record of records) {
        const m3u8 = await this.client.playOptions(record.id);
        if (!m3u8) continue;
        items.push(this.playItem(record, m3u8, streamProxy));
      }
      return { items, seasons: [], voices: [] };
    } catch {
      return { items: [], seasons: [], voices: [] };
    }
  }

  async streams(item = {}, context) {
    if (!this.enabled()) return []; // eslint-disable-line
    const requestContext = context || (item?.request ? item : undefined);
    const query = requestContext?.query || item?.query || item || {};
    const linkid = String(query.id || item?.id || '').trim();
    if (!linkid) return [];

    try {
      const m3u8 = await this.client.playOptions(linkid);
      if (!m3u8) return [];

      const streamProxy = (url) => buildProxyUrl(requestContext, url);
      return [this.streamItem({
        id: linkid,
        title: String(query.title || item?.title || this.title),
        type: 'movie',
        quality: 'auto',
        voice: VOICE,
        stream: {
          url: streamProxy(m3u8),
          headers: { Referer: `${this.host}/` }
        },
        subtitles: []
      })];
    } catch {
      return [];
    }
  }

  // --- private helpers ---

  playItem(record, m3u8, streamProxy) {
    return {
      method: 'play',
      title: record.title,
      url: streamProxy(m3u8),
      quality: { auto: streamProxy(m3u8) },
      headers: { Referer: `${this.host}/` },
      subtitles: [],
      voice_name: VOICE,
      type: 'movie'
    };
  }

  parseQuery(queryOrContext, context) {
    const requestContext = context || (queryOrContext?.query ? queryOrContext : undefined);
    const query = requestContext?.query || queryOrContext || {};
    const title = String(query.title || '');
    const originalTitle = String(query.original_title || '');
    const year = Number(query.year || query.year) || 0;
    return { title, year, originalTitle };
  }
}

/** Уникальные нормализованные ключи сопоставления (рус. + оригинальное название). */
function dedupeKeys(title, originalTitle) {
  const keys = [];
  for (const value of [title, originalTitle]) {
    const key = searchNameTo(value);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** Варианты поискового запроса: рус.+ориг., с годом или без (максимум 2 строки). */
function buildQueries(title, originalTitle, year) {
  const queries = [];
  const candidates = [];
  for (const value of [title, originalTitle]) {
    const text = String(value || '').trim();
    if (text && !candidates.includes(text)) candidates.push(text);
  }
  for (const text of candidates) {
    const query = year > 0 ? `${text} ${year}` : text;
    if (!queries.includes(query)) queries.push(query);
  }
  return queries;
}

export default RutubeProvider;