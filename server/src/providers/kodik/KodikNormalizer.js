import { normalizeQuality, sortStreamsByQuality } from '../shared/quality.js';

export class KodikNormalizer {
  search(raw) {
    const results = Array.isArray(raw?.results) ? raw.results : [];
    return results.map((item) => this.media(item)).filter(Boolean);
  }

  media(item) {
    const link = item.link || item.player_link || item.iframe_src || '';
    if (!link) return null;
    return {
      provider: 'kodik',
      id: String(item.id || item.link || item.kinopoisk_id || item.imdb_id || ''),
      title: item.title || item.title_ru || item.name || '',
      original_title: item.title_orig || item.other_title || '',
      year: item.year || null,
      type: normalizeType(item.type),
      kinopoisk_id: item.kinopoisk_id || null,
      imdb_id: item.imdb_id || null,
      translation: normalizeTranslation(item.translation),
      seasons: this.seasons(item),
      episodes: this.episodes(item),
      stream: { link }
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
    return Object.entries(episodes).map(([number, episode]) => ({
      number: asNumber(number),
      title: episode?.title || episode?.name || '',
      link: episode?.link || episode?.player_link || episode?.iframe_src || ''
    })).sort((a, b) => a.number - b.number);
  }

  episodes(item) {
    if (!item.episodes || typeof item.episodes !== 'object') return [];
    return Object.entries(item.episodes).map(([number, episode]) => ({
      number: asNumber(number),
      title: episode?.title || episode?.name || '',
      link: episode?.link || episode?.player_link || episode?.iframe_src || ''
    })).sort((a, b) => a.number - b.number);
  }

  streams(raw) {
    const links = raw?.links || raw?.data?.links || raw?.result?.links || {};
    const streams = [];

    for (const [quality, variants] of Object.entries(links)) {
      const variantList = Array.isArray(variants) ? variants : [variants];
      for (const variant of variantList) {
        const url = typeof variant === 'string' ? variant : variant?.src || variant?.link || variant?.url;
        if (!url) continue;
        streams.push({
          provider: 'kodik',
          quality: normalizeQuality(quality),
          url,
          headers: {},
          subtitles: []
        });
      }
    }

    return {
      streams: sortStreamsByQuality(streams),
      segments: this.segments(raw?.segments || raw?.data?.segments || raw?.result?.segments)
    };
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
  const raw = String(value || '').toLowerCase();
  if (raw.includes('serial') || raw.includes('anime-serial')) return 'serial';
  return 'movie';
}

function normalizeTranslation(value) {
  if (!value) return null;
  if (typeof value === 'string') return { id: value, title: value };
  return {
    id: String(value.id || value.title || value.name || ''),
    title: value.title || value.name || String(value.id || '')
  };
}

function asNumber(value) {
  const number = Number.parseInt(String(value), 10);
  return Number.isFinite(number) ? number : 0;
}
