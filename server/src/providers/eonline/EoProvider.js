import { buildProxyUrl } from '../../proxy.js';
import { Provider } from '../base.js';
import { EoClient } from './EoClient.js';
import { EoNormalizer } from './EoNormalizer.js';

/**
 * Провайдер одного E-Online-балансера (filmix/rezka/videoseed/…).
 *
 * Поток данных (E-ONLINE-REPORT §9, живые E2E):
 * - `videos` — открывает `lite/<balancer>?…` (фильм: карточки play/call;
 *   сериал: кнопки переводов `t=` и сезонов `s=`), раздаёт играбельные items
 *   и фильтры сезонов/озвучек.
 * - `stream` — серверный резолв ссылки потока (`method:"call"` серии/фильма:
 *   `movie.m3u8?…&play=true` → GET с `Origin` → финальный voidboost/skaz m3u8),
 *   наружу — только `buildProxyUrl`.
 *
 * Все media-URL идут через прокси Maniya; наружу никаких чужих m3u8/email/uid.
 */
export class EoProvider extends Provider {
  constructor(options = {}) {
    super({
      id: options.id,
      title: options.title
    });
    this.balancer = String(options.balancer || '').trim();
    this.client = options.client || new EoClient({
      balancer: this.balancer,
      hosts: options.hosts,
      skazHosts: options.skazHosts,
      accountEmail: options.accountEmail,
      uid: options.uid,
      origin: options.origin
    });
    this.normalizer = options.normalizer || new EoNormalizer();
  }

  name() {
    return this.id;
  }

  enabled() {
    return Boolean(this.client?.enabled?.() && this.balancer);
  }

  /**
   * Поиск. E- е-онлайн не отдаёт каталог по пустому title — только
   * карточку конкретного тайтла по `id/imdb_id/title`. Поэтому `search`
   * здесь — зерно: провайдер работает на `videos()` напрямую (запрос уже
   * содержит все параметры фильма). Для записей с первичным ключом —
   * возвращаем готовый record, чтобы source-линии не были пустыми.
   */
  async search(queryOrContext = {}, context = null) {
    if (!this.enabled()) return [];

    const requestContext = context || (queryOrContext?.request || queryOrContext?.query ? queryOrContext : undefined);
    const query = requestContext?.query || queryOrContext || {};
    const id = String(query.id || query.tmdb_id || '').trim();
    const imdbId = String(query.imdb_id || '').trim();
    const kinopoiskId = String(query.kinopoisk_id || '').trim();

    if (!id && !imdbId && !kinopoiskId) return [];

    const record = {
      provider: this.name(),
      id: id || imdbId || kinopoiskId,
      title: String(query.title || this.title),
      original_title: String(query.original_title || ''),
      year: query.year ? Number(query.year) : 0,
      type: this.serialQuery(query) ? 'serial' : 'movie',
      poster: '',
      metadata: {
        id,
        imdb_id: imdbId,
        kinopoisk_id: kinopoiskId
      }
    };
    return [record];
  }

  async movie() {
    return [];
  }

  async serial() {
    return [];
  }

  serialQuery(query = {}) {
    const serial = String(query.serial ?? '').trim();
    return serial === '1' || serial === 'true' || serial === 'yes'
      || String(query.type || '').toLowerCase() === 'serial'
      || String(query.serial_type || '').toLowerCase() === 'serial';
  }

  /**
   * Параметры запроса lite-страницы (одни для фильма и сериала).
   */
  buildPageParams(query = {}) {
    const serial = this.serialQuery(query);
    const params = {
      id: String(query.id ?? ''),
      imdb_id: String(query.imdb_id ?? ''),
      kinopoisk_id: String(query.kinopoisk_id ?? ''),
      title: String(query.title ?? ''),
      original_title: String(query.original_title ?? query.originalTitle ?? ''),
      serial: serial ? 1 : 0,
      year: String(query.year ?? ''),
      source: String(query.source || 'tmdb')
    };
    return params;
  }

  /**
   * Фильм: page с карточками `play`/`call` → играбельные items.
   */
  async movieVideos(query, requestContext, streamProxy) {
    const html = await this.client.getLite(this.buildPageParams(query));
    if (!html) return { items: [], seasons: [], voices: [] };

    const cards = this.normalizer.cards(html);
    const items = [];

    for (const card of cards) {
      if (card.method === 'play') {
        items.push({
          method: 'play',
          title: this.normalizerCardTitle(card),
          url: streamProxy(String(card.url || '')),
          quality: cleanedQualityMap(card.quality, streamProxy),
          translate: card.translate || card.voice_translate || '',
          voice_name: card.voice_translate || card.translate || '',
          type: 'movie',
          subtitles: []
        });
      } else if (card.method === 'call' && card.s == null && card.e == null) {
        const streamUrl = await this.resolveCardStream(card, requestContext);
        if (!streamUrl) continue;
        const voice = card.translate || 'Оригінал';
        items.push({
          method: 'play',
          title: this.normalizerCardTitle(card) || voice,
          url: streamProxy(streamUrl),
          voice_name: voice,
          type: 'movie',
          subtitles: []
        });
      }
    }

    return { items, seasons: [], voices: [] };
  }

  /**
   * Сериал: страница переводов+сезонов → выбранный сезонный page → серии.
   * Сезоны без перевода не могут быть отображены, если на странице нет
   * кнопок `s=` — тогда (разовый случай балансеров) просто пусто.
   */
  async serialVideos(query, requestContext, streamProxy) {
    const html = await this.client.getLite(this.buildPageParams(query));
    if (!html) return { items: [], seasons: [], voices: [] };

    const cards = this.normalizer.cards(html);

    // Сезонный страницы (видео с call-карточками) — если они прямо тут
    // (некоторые балансеры, напр. hdvb), берём сразу, иначе переход по
    // карточкам сезонов/переводоя через openLiteUrl.
    const inlineEpisodes = this.normalizer.hasEpisodes(cards);

    const voices = this.normalizer.voices(cards);
    const seasons = this.normalizer.seasons(cards);

    if (!voices.length && !inlineEpisodes) {
      return { items: [], seasons: [], voices: [] };
    }

    // Выбранные перевод/сезон (из query, иначе первые).
    const voiceIndex = Number(query.voice) || 0;
    const voice = voices[voiceIndex % voices.length] || voices[0] || null;
    let seasonNumber = Number(query.season) || 0;
    if (seasons.length && !seasons.some((entry) => entry.number === seasonNumber)) {
      seasonNumber = seasons[0].number;
    }

    // Для поиска страницы серий нужен «сезон-URL». Карточки сезонов rezka-вида
    // несут `t=<выбранный голос>&s=<номер>` (по умолчанию первый голос).
    const targetHref = this.seasonLinkHref(cards, voice, seasonNumber);
    const pageHtml = targetHref ? await this.client.openLiteUrl(targetHref) : html;
    if (!pageHtml) return { items: [], seasons: [], voices: [] };

    const pageCards = targetHref ? this.normalizer.cards(pageHtml) : cards;
    const episodes = this.normalizer.episodeItems(pageCards, seasonNumber || undefined);

    const items = [];
    for (const episode of episodes) {
      const streamUrl = await this.resolveStream(episode, requestContext);
      if (!streamUrl) continue;
      items.push({
        method: 'play',
        title: episode.title || `${episode.episode} серия`,
        url: streamProxy(streamUrl),
        quality: {},
        subtitles: [],
        season: episode.season,
        episode: episode.episode,
        voice_name: episode.voice_name || voice?.name || '',
        type: 'serial'
      });
    }

    const seasonsList = seasons.map((entry) => ({ number: entry.number, title: entry.title }));
    const voicesList = voices.map((entry, index) => ({ name: entry.name, index }));
    return { items, seasons: seasonsList, voices: voicesList };
  }

  /**
   * Точка входа videos(): определяет фильм/сериал из query, открывает
   * страницу и разрешает дополнительные.
   */
  async videos(context = null) {
    const requestContext = context || {};
    const query = requestContext.query || {};

    if (!this.enabled()) return { items: [], seasons: [], voices: [] };

    try {
      const streamProxy = (url) => buildProxyUrl(requestContext, url);
      return this.serialQuery(query)
        ? await this.serialVideos(query, requestContext, streamProxy)
        : await this.movieVideos(query, requestContext, streamProxy);
    } catch {
      return { items: [], seasons: [], voices: [] };
    }
  }

  /**
   * Резолв call-карточки фильма (`method:"call"` без s/e): открывает
   * stream-URL с Origin → финальный voidboost/skaz m3u8 (или mp4).
   * Вынесен отдельно от resolveStream, т.к. карточка фильма уже несёт
   * `stream`, а не `url` (серийный эпизод — `url`).
   */
  async resolveCardStream(card, requestContext) {
    const raw = String(card.stream || card.url || '').trim();
    if (!raw) return null;
    const final = await this.client.resolveStream(raw);
    return final || null;
  }

  /** Серверный резолв потока call-карточки (эпизод/фильм) для items. */
  async resolveStream(card, requestContext) {
    const url = String(card.stream || card.url || '').trim();
    if (!url) return null;
    const final = await this.client.resolveStream(url);
    if (!final) return null;
    return final;
  }

  streams(item = {}, context = null) {
    // items уже построены проксированными URL в videos();
    // этот путь оставлен для прямого /api/lampa/stream.
    return [];
  }

  // --- helpers ---

  /** Заголовок карточки-перевода/фильма (translate/_text/…) к # */
  normalizerCardTitle(card) {
    return String(
      card._text || card.title || card.translate || card.voice_translate || ''
    ).trim() || 'Оригінал';
  }

  /**
   * URL карточки сезона — с переводом `voice` и сезоном `seasonNumber`.
   * Серии peregrin = обычная лайт-страница: открываем сезон (s=N) в его
   * карточке URL, перевод (t=) подменяем выбранным. Если подходящей карточки
   * нет, пробуем любую карточку перевода (t) без s — там серии первого сезона.
   */
  seasonLinkHref(cards, voice, seasonNumber) {
    const preferT = voice?.t;
    let fallback = null;

    for (const card of cards || []) {
      if (card.method !== 'link' || card.similar) continue;
      const url = String(card.url || '');
      if (!url) continue;
      const t = paramValueOf(url, 't');
      const s = paramValueOf(url, 's');

      if (seasonNumber && s && Number(s) === Number(seasonNumber)) {
        // Точное совпадение сезона — возвращаем его URL (если нужный перевод
        // отличается, подменяем t). НЕ возвращаем fallback — он перевод.
        if (preferT && t && Number(t) !== Number(preferT)) {
          return setParam(url, 't', String(preferT));
        }
        return url;
      }
      if (!s && t && !fallback) fallback = url;
    }
    return fallback;
  }

  buildProxyFor(context, url) {
    return buildProxyUrl(context, url);
  }
}

/** Построить проксированную мапу качеств. */
function cleanedQualityMap(map, proxy) {
  const out = {};
  for (const [label, urlEntry] of Object.entries(map || {})) {
    if (urlEntry && typeof urlEntry === 'string') out[label] = proxy(urlEntry);
  }
  return out;
}

/** Query-параметр из URL. */
function paramValueOf(url, key) {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get(key);
  } catch {
    return null;
  }
}

/** Перезапись query-параметра, сохраняя остальные. */
function setParam(url, key, value) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(key, value);
    return parsed.toString();
  } catch {
    return url;
  }
}

export default EoProvider;