import { buildProxyUrl } from '../../proxy.js';
import { Provider } from '../base.js';
import { SkazClient } from './SkazClient.js';
import { SkazNormalizer } from './SkazNormalizer.js';

/**
 * Провайдер одного skaz-балансера (filmix/alloha/rezka/videoseed/…).
 *
 * Это 1:1-порт `EoProvider` на SkazClient/SkazNormalizer (E-ONLINE-REPORT §9
 * доказывает: E-Online — просто клиент того же skaz-кластера). Никакой
 * зависимости от E-Online-плагина: весь контур — skaz-REST напрямую.
 *
 * Поток данных:
 * - `videos` — открывает `lite/<balancer>?…` (фильм: карточки play/call;
 *   сериал: кнопки переводов `t=` и сезонов `s=`), раздаёт играбельные items
 *   и фильтры сезонов/озвучек.
 * - `stream` — серверный резолв ссылки потока (`method:"call"` серии/фильма:
 *   `movie.m3u8?…&play=true` → GET с `Origin` → финальный voidboost/skaz m3u8),
 *   наружу — только `buildProxyUrl`.
 *
 * Все media-URL идут через прокси Maniya; наружу никаких чужих m3u8/email/uid.
 */
export class SkazProvider extends Provider {
  constructor(options = {}) {
    super({
      id: options.id,
      title: options.title
    });
    this.show = options.show !== false;
    this.hiddenTwinNative = options.hiddenTwinNative || null;
    this.balancer = String(options.balancer || '').trim();
    this.client = options.client || new SkazClient({
      balancer: this.balancer,
      hosts: options.hosts,
      accountEmail: options.accountEmail,
      uid: options.uid,
      origin: options.origin
    });
    this.normalizer = options.normalizer || new SkazNormalizer();
  }

  name() {
    return this.id;
  }

  enabled() {
    return Boolean(this.client?.enabled?.() && this.balancer);
  }

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

  async movieVideos(query, requestContext, streamProxy) {
    const pageParams = this.buildPageParams(query);
    const html = await this.client.getLite(pageParams);
    if (!html) return { items: [], seasons: [], voices: [] };

    const items = await this.movieItemsFromHtml(html, requestContext, streamProxy);
    if (items.length) return { items, seasons: [], voices: [] };

    // 1) follow-карточка (посительный title-скоринг; rezka/lumina).
    const href = this.movieHref(this.normalizer.cards(html), query);
    if (href) {
      const pageHtml = await this.client.getLite({ ...pageParams, href });
      if (pageHtml) {
        const followed = await this.movieItemsFromHtml(pageHtml, requestContext, streamProxy);
        if (followed.length) return { items: followed, seasons: [], voices: [] };
      }
    }

    // 2) postid-схема Lime (kinopub): карточка → postid → перезапрос.
    const postid = this.postidFromCards(this.normalizer.cards(html));
    if (postid != null) {
      const pageHtml = await this.client.getLite({ ...pageParams, postid: String(postid) });
      if (pageHtml) {
        const postItems = await this.movieItemsFromHtml(pageHtml, requestContext, streamProxy);
        if (postItems.length) return { items: postItems, seasons: [], voices: [] };
      }
    }

    return { items: [], seasons: [], voices: [] };
  }

  postidFromCards(cards) {
    for (const card of cards || []) {
      if (!card || card.method !== 'link') continue;
      const value = paramValueOf(card.url || card.href || '', 'postid');
      if (value == null || value === '') continue;
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  async movieItemsFromHtml(html, requestContext, streamProxy) {
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

    return items;
  }

  movieHref(cards, query = {}) {
    const searched = new Set();
    const needle = searchNeedle(query);
    let best = null;
    let bestScore = -1;

    for (const card of cards || []) {
      if (card.method !== 'link' && !card.method) continue;
      const href = String(card.href || card.url || '').trim();
      if (!href) continue;
      if (searched.has(href)) continue;
      searched.add(href);

      let score = 0;
      for (const token of needle) {
        if (token && href.toLowerCase().includes(token)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = href;
      }
    }
    return best;
  }

  async serialVideos(query, requestContext, streamProxy) {
    const html = await this.client.getLite(this.buildPageParams(query));
    if (!html) return { items: [], seasons: [], voices: [] };

    const cards = this.normalizer.cards(html);

    const inlineEpisodes = this.normalizer.hasEpisodes(cards);

    const voices = this.normalizer.voices(cards);
    const seasons = this.normalizer.seasons(cards);

    if (!voices.length && !inlineEpisodes) {
      return { items: [], seasons: [], voices: [] };
    }

    const voiceIndex = Number(query.voice) || 0;
    const voice = voices[voiceIndex % voices.length] || voices[0] || null;
    let seasonNumber = Number(query.season) || 0;
    if (seasons.length && !seasons.some((entry) => entry.number === seasonNumber)) {
      seasonNumber = seasons[0].number;
    }

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

  async videos(context = null) {
    const requestContext = context || {};
    const query = requestContext.query || {};

    if (!this.enabled()) return { items: [], seasons: [], voices: [] };

    try {
      const streamProxy = (url) => buildProxyUrl(requestContext, url, {
        origin: this.client.origin,
        ref: this.client.origin
      });
      return this.serialQuery(query)
        ? await this.serialVideos(query, requestContext, streamProxy)
        : await this.movieVideos(query, requestContext, streamProxy);
    } catch {
      return { items: [], seasons: [], voices: [] };
    }
  }

  async resolveCardStream(card, requestContext) {
    const raw = String(card.stream || card.url || '').trim();
    if (!raw) return null;
    const final = await this.client.resolveStream(raw);
    return final || null;
  }

  async resolveStream(card, requestContext) {
    const url = String(card.stream || card.url || '').trim();
    if (!url) return null;
    const final = await this.client.resolveStream(url);
    if (!final) return null;
    return final;
  }

  streams(item = {}, context = null) {
    return [];
  }

  normalizerCardTitle(card) {
    return String(
      card._text || card.title || card.translate || card.voice_translate || ''
    ).trim() || 'Оригінал';
  }

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

function cleanedQualityMap(map, proxy) {
  const out = {};
  for (const [label, urlEntry] of Object.entries(map || {})) {
    if (urlEntry && typeof urlEntry === 'string') out[label] = proxy(urlEntry);
  }
  return out;
}

function paramValueOf(url, key) {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get(key);
  } catch {
    return null;
  }
}

function setParam(url, key, value) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(key, value);
    return parsed.toString();
  } catch {
    return url;
  }
}

function searchNeedle(query = {}) {
  const tokens = [];
  for (const key of ['kinopoisk_id', 'imdb_id', 'tmdb_id']) {
    const value = String(query[key] || '').trim();
    if (value) tokens.push(value.toLowerCase());
  }
  const original = String(query.original_title || query.title || '').trim();
  if (original) {
    tokens.push(slugify(original));
    tokens.push(slugify(original).replace(/-?\d+$/, ''));
  }
  const year = String(query.year || '').trim();
  if (year && original) tokens.push(year);
  return tokens.filter(Boolean);
}

function slugify(text) {
  return String(text).toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default SkazProvider;