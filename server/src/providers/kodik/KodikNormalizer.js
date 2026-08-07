import { normalizeQuality, sortStreamsByQuality } from '../shared/quality.js';

// Типы-фильмы по Lampac: всё из этого списка — фильм, всё остальное — сериал.
const MOVIE_TYPES = new Set([
  'foreign-movie',
  'soviet-cartoon',
  'foreign-cartoon',
  'russian-cartoon',
  'anime',
  'russian-movie'
]);

export function isMovieType(value) {
  return MOVIE_TYPES.has(String(value || '').toLowerCase());
}

export class KodikNormalizer {
  search(raw) {
    const results = Array.isArray(raw) ? raw : (Array.isArray(raw?.results) ? raw.results : []);
    const seen = new Set();
    const items = [];
    for (const item of results) {
      const media = this.media(item);
      if (!media || seen.has(media.id)) continue;
      seen.add(media.id);
      items.push(media);
    }
    return items;
  }

  media(item) {
    const link = item.link || item.player_link || item.iframe_src || '';
    if (!link) return null;

    const type = normalizeType(item.type);
    const translation = normalizeTranslation(item.translation);
    const poster = posterFrom(item);

    return {
      provider: 'kodik',
      id: String(item.id || item.link || item.kinopoisk_id || item.imdb_id || ''),
      title: item.title || item.title_ru || item.name || '',
      original_title: item.title_orig || item.other_title || '',
      year: item.year || null,
      type,
      kinopoisk_id: item.kinopoisk_id || null,
      imdb_id: item.imdb_id || null,
      translation,
      poster,
      seasons: type === 'serial' ? this.seasons(item) : [],
      episodes: this.episodes(item),
      stream: { link },
      metadata: {
        title: item.title || item.title_ru || item.name || '',
        original_title: item.title_orig || item.other_title || '',
        year: item.year || null,
        type,
        poster,
        kinopoisk_id: item.kinopoisk_id || null,
        imdb_id: item.imdb_id || null,
        translation: translation?.title || null
      }
    };
  }

  seasons(item) {
    const seasons = item.seasons || item.material_data?.seasons;
    if (!seasons || typeof seasons !== 'object') return [];
    return Object.entries(seasons).map(([number, season]) => ({
      number: asNumber(number),
      episodes: this.seasonEpisodes(season)
    })).sort((a, b) => a.number - b.number);
  }

  seasonEpisodes(season) {
    const episodes = season?.episodes || season;
    if (!episodes || typeof episodes !== 'object') return [];
    return Object.entries(episodes).map(([number, episode]) => {
      // Значение может быть строкой-ссылкой (Kodik API: номер -> ссылка)
      // либо объектом с полями title/link.
      if (typeof episode === 'string') {
        return { number: asNumber(number), title: `${asNumber(number) || number} серия`, link: episode };
      }
      return {
        number: asNumber(number),
        title: episode?.title || episode?.name || `${asNumber(number) || number} серия`,
        link: episode?.link || episode?.player_link || episode?.iframe_src || ''
      };
    }).sort((a, b) => a.number - b.number);
  }

  episodes(item) {
    if (!item.episodes || typeof item.episodes !== 'object') return [];
    return Object.entries(item.episodes).map(([number, episode]) => ({
      number: asNumber(number),
      title: episode?.title || episode?.name || '',
      link: episode?.link || episode?.player_link || episode?.iframe_src || ''
    })).sort((a, b) => a.number - b.number);
  }

  /**
   * Уникальные названия переводов по набору результатов — как цикл по озвучкам
   * в Lampac Tpl (сериал): name = translation.title ?? "оригинал".
   */
  distinctTranslations(results) {
    const seen = new Set();
    const titles = [];
    for (const item of Array.isArray(results) ? results : []) {
      const name = item?.translation?.title || 'оригинал';
      if (name && !seen.has(name)) {
        seen.add(name);
        titles.push(name);
      }
    }
    return titles;
  }

  /**
   * Уникальные номера сезонов по набору результатов — как список сезонов
   * в Lampac Tpl (s == -1): собираем last_season, пополняя ключами seasons.
   */
  distinctSeasons(results) {
    const numbers = new Set();
    for (const item of Array.isArray(results) ? results : []) {
      if (Number(item?.last_season) > 0) numbers.add(Number(item.last_season));
      for (const key of Object.keys(item?.seasons || {})) {
        const number = asNumber(key);
        if (number > 0) numbers.add(number);
      }
    }
    return [...numbers].sort((a, b) => a - b).map((number) => ({ number, title: `${number} сезон` }));
  }

  /**
   * Разбор ответа video-links: {links: {"480": {Src: url}, ...}} →
   * [{quality, url}] с уникальными качествами, https-нормализацией и
   * сортировкой по убыванию. Segment-ы остаются доступны через segments().
   */
  streams(raw) {
    const links = raw?.links || raw?.data?.links || raw?.result?.links || {};
    const seen = new Set();
    const streams = [];

    for (const [quality, variants] of Object.entries(links)) {
      const normalizedQuality = normalizeQuality(quality);
      if (seen.has(normalizedQuality)) continue;

      const variantList = Array.isArray(variants) ? variants : [variants];
      const url = ensureHttps(variantList.map(streamUrl).find(Boolean));
      if (!url) continue;

      seen.add(normalizedQuality);
      streams.push({ quality: normalizedQuality, url });
    }

    return sortStreamsByQuality(streams);
  }

  segments(value) {
    if (!Array.isArray(value)) return [];
    return value.map((segment) => ({
      title: segment.title || segment.type || 'segment',
      start: Number(segment.start ?? segment.from ?? segment.begin ?? 0),
      end: Number(segment.end ?? segment.to ?? segment.finish ?? 0)
    })).filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start);
  }
}

function normalizeType(value) {
  return isMovieType(value) ? 'movie' : 'serial';
}

function normalizeTranslation(value) {
  if (!value) return null;
  if (typeof value === 'string') return { id: value, title: value };
  return {
    id: String(value.id || value.title || value.name || ''),
    title: value.title || value.name || String(value.id || '')
  };
}

function streamUrl(variant) {
  if (typeof variant === 'string') return variant;
  if (!variant || typeof variant !== 'object') return '';
  return variant.Src || variant.src || variant.link || variant.url || '';
}

function ensureHttps(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  return `https://${url}`;
}

function posterFrom(item) {
  const material = item.material_data || {};
  return material.anime_poster_url || material.drama_poster_url || material.poster_url || null;
}

function asNumber(value) {
  const number = Number.parseInt(String(value), 10);
  return Number.isFinite(number) ? number : 0;
}