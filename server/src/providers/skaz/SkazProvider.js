import { config } from '../../config.js';
import { buildProxyUrl, tokenFromRequest } from '../../proxy.js';
import { Provider } from '../base.js';
import { SkazClient } from './SkazClient.js';
import { SkazNormalizer } from './SkazNormalizer.js';

/**
 * Кэш навигации кластера (videos → video): финальные карточки, которые videos()
 * уже построил успешным походом в кластер, переиспользуются resolveVideo() на
 * Play вместо повторной навигации getLite→href→postid. Второй независимый поход
 * в flaky-кластер на Play = лишняя латентность («долго думает») + новый шанс
 * сбоя («видео не найдено»). Короткий TTL; кэшируем только непустой результат
 * (пусто = транзиент кластера → следующий запрос ретраит).
 */
const NAV_CACHE_TTL_MS = 5 * 60 * 1000;

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
    this._navCache = new Map();
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
    const { cards } = await this._cachedCollectMovieCards(query);
    const items = [];
    let callIndex = 0;

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
        // ЛЕНИВЫЙ резолв голоса: item уходит в список как `method:"call"`, URL
        // дескриптора затребуется у нашего API только на Play выбранного голоса
        // (resolveVideo → resolveCardItem). Работающий E-Online делает ровно так же:
        // lite-страница → карточки call → резолв выбранного, НЕ всех последовательно.
        const title = this.normalizerCardTitle(card);
        items.push({
          method: 'call',
          title,
          translate: card.translate || card.voice_translate || '',
          voice_name: card.voice_translate || card.translate || '',
          type: 'movie',
          url: this.buildResolveUrl(requestContext, { voice: String(callIndex) }),
          subtitles: []
        });
        callIndex += 1;
      }
    }

    return { items, seasons: [], voices: [] };
  }

  /**
   * Единый навигационный путь фильма для videos() и resolveVideo():
   * getLite → follow href (поиск-карточка) → postid (Lime). Обе стороны
   * ОБЯЗАНЫ сойтись на одной и той же финальной странице карточек, иначе
   * voice-индекс ленивого резолва не совпадёт с items в списке.
   * Возвращает финальные карточки (фильтр-предикат `hasMovieItems`).
   */
  async collectMovieCards(query) {
    const pageParams = this.buildPageParams(query);
    const firstHtml = await this.client.getLite(pageParams);
    let cards = this.normalizer.cards(firstHtml || '');
    if (hasMovieItems(cards)) return { cards };

    // 1) follow-карточка (посительный title-скоринг; rezka/lumina).
    const href = this.movieHref(cards, query);
    if (href) {
      const followed = this.normalizer.cards((await this.client.getLite({ ...pageParams, href })) || '');
      if (hasMovieItems(followed)) return { cards: followed };
    }

    // 2) postid-схема Lime (kinopub): карточка → postid → перезапрос.
    const postid = this.postidFromCards(cards);
    if (postid != null) {
      const postCards = this.normalizer.cards((await this.client.getLite({ ...pageParams, postid: String(postid) })) || '');
      if (hasMovieItems(postCards)) return { cards: postCards };
    }

    return { cards: [] };
  }

  /** Кэш-ключ навигации фильма: pageParams (единый для videos() и resolveVideo()). */
  _movieNavKey(query = {}) {
    return `M|${this.balancer}|${JSON.stringify(this.buildPageParams(query))}`;
  }

  /**
   * collectMovieCards с коротким кэшем: videos() уже сходил в кластер и построил
   * финальные карточки — resolveVideo() на Play берёт их же, а не повторяет
   * getLite→href→postid (второй поход = «долго думает» + «видео не найдено» при
   * флапе кластера). Кэшируем только непустой результат (пусто = транзиент → ретрай).
   */
  async _cachedCollectMovieCards(query = {}) {
    const key = this._movieNavKey(query);
    const hit = this._navCache.get(key);
    if (hit && Date.now() - hit.ts < NAV_CACHE_TTL_MS) return { cards: hit.cards };
    const result = await this.collectMovieCards(query);
    if (result.cards && result.cards.length) {
      this._navCache.set(key, { ts: Date.now(), cards: result.cards });
      this._sweepNavCache();
    }
    return result;
  }

  /** Кэш-ключ навигации сериала: + голос/сезон (openSeasonPage выбирает их). */
  _serialNavKey(query = {}) {
    return `S|${this.balancer}|${JSON.stringify(this.buildPageParams(query))}|v${Number(query.voice) || 0}|s${Number(query.season) || 0}`;
  }

  /** openSeasonPage с тем же кэшем (сериал: videos → resolveSerialVideo). */
  async _cachedOpenSeasonPage(query = {}) {
    const key = this._serialNavKey(query);
    const hit = this._navCache.get(key);
    if (hit && Date.now() - hit.ts < NAV_CACHE_TTL_MS) return hit.nav;
    const nav = await this.openSeasonPage(query);
    if (nav) {
      this._navCache.set(key, { ts: Date.now(), nav });
      this._sweepNavCache();
    }
    return nav;
  }

  _sweepNavCache() {
    if (this._navCache.size <= 512) return;
    const now = Date.now();
    for (const [key, entry] of this._navCache) {
      if (now - entry.ts >= NAV_CACHE_TTL_MS) this._navCache.delete(key);
    }
  }

  /** Прямой резолв `method:"call"` item'а (выбранный голос/серия) → дескриптор. */
  async resolveVideo(context = {}) {
    const requestContext = context || {};
    const query = requestContext.query || {};
    if (!this.enabled()) return null;
    const streamProxy = (url) => buildProxyUrl(requestContext, url, {
      origin: this.client.origin,
      ref: this.client.origin
    });
    try {
      return this.serialQuery(query)
        ? await this.resolveSerialVideo(query, requestContext, streamProxy)
        : await this.resolveMovieVideo(query, requestContext, streamProxy);
    } catch {
      return null;
    }
  }

  async resolveMovieVideo(query, requestContext, streamProxy) {
    const { cards } = await this._cachedCollectMovieCards(query);
    const index = Number(query.voice) || 0;
    const videoCards = cards.filter((card) => card.method === 'call' && card.s == null && card.e == null);
    // Один и тот же предикат/порядок, что и в movieVideos (callIndex).
    const card = videoCards[index] || videoCards[0] || null;
    if (!card) return null;
    const item = await this.resolveCardItem(card, requestContext, streamProxy, { type: 'movie' });
    return item;
  }

  /** URL ленивого резолва: наш API `/api/lampa/video?…` (клиент допишет token). */
  buildResolveUrl(requestContext = {}, extra = {}) {
    const query = requestContext.query || {};
    const url = new URL('/api/lampa/video', config.publicBaseUrl);
    for (const [key, value] of Object.entries(this.buildPageParams(query))) {
      if (value) url.searchParams.set(key, value);
    }
    url.searchParams.set('provider', `skaz-${this.balancer}`);
    for (const [key, value] of Object.entries(extra || {})) {
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    }
    const token = tokenFromRequest(query, requestContext?.request);
    if (token) url.searchParams.set('token', token);
    return url.toString();
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

  movieHref(cards, query = {}) {
    const searched = new Set();
    const needle = searchNeedle(query);
    let best = null;
    let bestScore = -1;

    for (const card of cards || []) {
      if (card.method !== 'link' && !card.method) continue;
      // geosaitebi/animelib-паттерн: у link-карточки нет явного `href`-поля,
      // но в её URL лежит параметр `href=<slug>.html` («KinoPan/AniTrue»).
      // Приоритет: явный card.href → внутренний параметр href → сам card.url.
      const href = String(card.href || '').trim() || hrefParamOf(card.url) || String(card.url || '').trim();
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
    const nav = await this._cachedOpenSeasonPage(query);
    if (!nav) return { items: [], seasons: [], voices: [] };
    const { seasons, voices, seasonNumber, pageCards, voice } = nav;

    const episodes = this.normalizer.episodeItems(pageCards, seasonNumber || undefined);

    const items = [];
    for (const episode of episodes) {
      // `play`-серии (veoveo/solntse/kinopub) — готовый CDN-URL, резолв не нужен;
      // `call`-серии (alloha/videoseed) — ленивый резолв на Play серии
      // (resolveSerialVideo), как в E-Online: НЕ резолвим все серии заранее.
      if (episode.method === 'play') {
        const url = episode.url || episode.stream;
        if (!url) continue;
        items.push({
          method: 'play',
          title: episode.title || `${episode.episode} серия`,
          url: streamProxy(url),
          quality: {},
          subtitles: [],
          season: episode.season,
          episode: episode.episode,
          voice_name: episode.voice_name || voice?.name || '',
          type: 'serial'
        });
      } else {
        items.push({
          method: 'call',
          title: episode.title || `${episode.episode} серия`,
          episode: episode.episode,
          season: episode.season,
          voice_name: episode.voice_name || voice?.name || '',
          type: 'serial',
          url: this.buildResolveUrl(requestContext, {
            voice: String(query.voice ?? 0),
            season: String(episode.season),
            episode: String(episode.episode)
          }),
          subtitles: []
        });
      }
    }

    const seasonsList = seasons.map((entry) => ({ number: entry.number, title: entry.title }));
    const voicesList = voices.map((entry, index) => ({ name: entry.name, index }));
    return { items, seasons: seasonsList, voices: voicesList };
  }

  /**
   * Навигация сериала (база → перевод+сезон → страница сезона). Единый путь
   * для serialVideos() и resolveSerialVideo() — обе должны попасть на ту же
   * страницу сезона, иначе episode-резолв не совпадёт со списком.
   */
  async openSeasonPage(query) {
    const html = await this.client.getLite(this.buildPageParams(query));
    if (!html) return null;

    const cards = this.normalizer.cards(html);
    const inlineEpisodes = this.normalizer.hasEpisodes(cards);
    const voices = this.normalizer.voices(cards);
    const seasons = this.normalizer.seasons(cards);

    // skaz-сериалы двухуровневые: базовая страница часто несёт только
    // сезон-карточки `link s=N` (без `t=`), а переводы и серии появляются
    // только после открытия страницы сезона (alloha/videoseed/kinopub/
    // veoveo/solntse). Если есть сезоны — продолжаем, даже когда голосов
    // на базовой странице нет.
    if (!seasons.length && !voices.length && !inlineEpisodes) return null;

    const voiceIndex = Number(query.voice) || 0;
    const voice = voices.length ? voices[voiceIndex % voices.length] || voices[0] : null;
    let seasonNumber = Number(query.season) || 0;
    if (seasons.length && !seasons.some((entry) => entry.number === seasonNumber)) {
      seasonNumber = seasons[0].number;
    }

    const targetHref = this.seasonLinkHref(cards, voice, seasonNumber);
    const pageHtml = targetHref ? await this.client.openLiteUrl(targetHref) : html;
    if (!pageHtml) return null;
    const pageCards = targetHref ? this.normalizer.cards(pageHtml) : cards;

    // Голоса могут жить только на странице сезона (alloha/kinopub): базовая
    // страница их не показывает. Собираем переводы оттуда, если базовых нет.
    const effectiveVoices = voices.length ? voices : this.normalizer.voices(pageCards, { withSeason: true });

    return { cards, voices: effectiveVoices, seasons, voice, seasonNumber, pageCards };
  }

  /** Ленивый резолв `call`-серии: (voice, season, episode) from query → дескриптор. */
  async resolveSerialVideo(query, requestContext, streamProxy) {
    const nav = await this._cachedOpenSeasonPage(query);
    if (!nav) return null;
    const { pageCards, seasonNumber } = nav;
    const season = Number(query.season) || seasonNumber || 0;
    const episode = Number(query.episode) || 0;
    const card = (pageCards || []).find((c) =>
      (c.method === 'call' || c.method === 'play') &&
      c.s != null && c.e != null &&
      Number(c.s) === season && Number(c.e) === episode
    ) || null;
    if (!card) return null;
    if (card.method === 'play') {
      const url = card.url || card.stream;
      if (!url) return null;
      return {
        method: 'play',
        title: this.normalizerCardTitle(card) || `${episode} серия`,
        url: streamProxy(String(url)),
        quality: {},
        subtitles: [],
        season,
        episode,
        voice_name: card.translate || nav.voice?.name || '',
        type: 'serial'
      };
    }
    return this.resolveCardItem(card, requestContext, streamProxy, {
      type: 'serial',
      season,
      episode,
      title: this.normalizerCardTitle(card) || `${episode} серия`,
      voice: card.translate || nav.voice?.name || ''
    });
  }

  async videos(context = null) {
    const requestContext = context || {};
    const query = requestContext.query || {};

    if (!this.enabled()) return { items: [], seasons: [], voices: [] };

    let result;
    try {
      const streamProxy = (url) => buildProxyUrl(requestContext, url, {
        origin: this.client.origin,
        ref: this.client.origin
      });
      result = this.serialQuery(query)
        ? await this.serialVideos(query, requestContext, streamProxy)
        : await this.movieVideos(query, requestContext, streamProxy);
    } catch {
      result = { items: [], seasons: [], voices: [] };
    }

    // accsdb — ошибка учётной записи: не маскируем как «нет источников».
    if (this.client?.lastAccsdb) {
      result.provider_error = {
        code: 'accsdb',
        message: this.client.lastAccsdb.message
      };
    }

    return result;
  }

  async resolveCardStream(card, requestContext) {
    const raw = String(card.stream || card.url || '').trim();
    if (!raw) return null;
    const final = await this.client.resolveStream(raw);
    return final || null;
  }

  /**
   * Играбельный item из `call`-карточки (фильм или серия). Приоритет —
   * JSON-режим клиента (`/lite/<balancer>/video` без `play`): item несёт
   * мапу качеств, субтитры и reserve-фолбэк «primary or reserve» — ровно то,
   * что видит E-Online/Lampac и чего не хватало single-резолву. Если JSON
   * недоступен — фолбэк на `resolveStream` (RedirectToPlay), как было.
   */
  async resolveCardItem(card, requestContext, streamProxy, overrides = {}) {
    const voice = String(overrides.voice || card.translate || card.voice_translate || '').trim() || 'Оригінал';
    const title = String(overrides.title || this.normalizerCardTitle(card) || voice).trim();

    const json = await this.client.resolveVideoJson?.(card.stream);
    if (json) {
      const pair = splitOrUrl(json.url);
      const primary = pair[0];
      if (!primary) return null;
      const url = pair[1] ? `${streamProxy(primary)} or ${streamProxy(pair[1])}` : streamProxy(primary);
      return {
        method: 'play',
        title,
        url,
        quality: cleanedQualityMap(json.quality, streamProxy),
        subtitles: normalizeSubtitles(json.subtitles, streamProxy),
        segments: json.segments && typeof json.segments === 'object' ? json.segments : undefined,
        hls_manifest_timeout: json.hls_manifest_timeout ? Number(json.hls_manifest_timeout) : undefined,
        translate: String(card.translate || '').trim(),
        voice_name: String(card.voice_translate || card.translate || '').trim() || voice,
        type: overrides.type || 'movie',
        ...(overrides.season != null ? { season: overrides.season } : {}),
        ...(overrides.episode != null ? { episode: overrides.episode } : {})
      };
    }

    const raw = String(card.stream || card.url || '').trim();
    if (!raw) return null;
    const streamUrl = await this.client.resolveStream(raw);
    if (!streamUrl) return null;
    return {
      method: 'play',
      title,
      url: streamProxy(streamUrl),
      voice_name: voice,
      type: overrides.type || 'movie',
      subtitles: [],
      ...(overrides.season != null ? { season: overrides.season } : {}),
      ...(overrides.episode != null ? { episode: overrides.episode } : {})
    };
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

/**
 * Качества из JSON video → мапа «label → прокси-URL». Каждая запись может
 * нести reserve-фолбэк `URL1 or URL2` (ровно как `json.url`) — сплитим тем же
 * `splitOrUrl` и проксируем КАЖДУЮ часть отдельно, склеивая обратно ` or `.
 * Иначе `URL1 or URL2` ушёл бы одним прокси-URL с or-хвостом внутри url-параметра
 * (reserve-ссылка для плеера теряется, работает только на толерантности CDN).
 * Без ` or ` поведение полностью прежнее.
 */
export function cleanedQualityMap(map, proxy) {
  const out = {};
  for (const [label, urlEntry] of Object.entries(map || {})) {
    if (!urlEntry || typeof urlEntry !== 'string') continue;
    const parts = splitOrUrl(urlEntry);
    out[label] = parts.length > 1 ? parts.map((u) => proxy(u)).join(' or ') : proxy(urlEntry);
  }
  return out;
}

/**
 * Фильм-страница «играбельна»: в пред-резолвном виде это play-карточки
 * (готовый CDN-URL) ИЛИ call-карточки без s/e (голоса — ленивый резолв).
 * Тот же предикат, что у items в movieVideos — collectMovieCards и
 * resolveMovieVideo обязаны считать страницу «той же» одинаково.
 */
function hasMovieItems(cards) {
  return (cards || []).some((card) => card.method === 'play'
    || (card.method === 'call' && card.s == null && card.e == null));
}

/**
 * Разбить `primary or reserve` из JSON video. Сепаратор бывает в двух видах:
 * `" or "` (Lampac) и URL-закодированный `%20or%20` (E-Online/skaz). Декадируем
 * ТОЛЬКО сепаратор, тело URL не трогаем.
 */
function splitOrUrl(value) {
  return String(value || '')
    .split(/\s+or\s+|\s*%20or%20\s*/gi)
    .map((u) => String(u).trim())
    .filter(Boolean);
}

/** Субтитры из JSON video (`{method:'link',url,label}`) → item `[{label,url: proxy}]`. */
function normalizeSubtitles(list, proxy) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const sub of list) {
    if (!sub || typeof sub.url !== 'string' || !sub.url) continue;
    out.push({
      label: String(sub.label || sub.title || 'Субтитры').trim(),
      url: proxy(String(sub.url).trim())
    });
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

/** Внутренний `href=<slug>.html` из URL link-карточки (geosaitebi/animelib) или ''. */
function hrefParamOf(value) {
  if (!value) return '';
  try {
    const parsed = new URL(String(value));
    const href = parsed.searchParams.get('href');
    return href == null || href === '' ? '' : String(href);
  } catch {
    return '';
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