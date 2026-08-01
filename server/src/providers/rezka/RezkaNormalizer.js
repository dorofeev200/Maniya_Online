import { normalizeLanguage } from '../shared/normalize/LanguageNormalizer.js';
import { normalizeQuality } from '../shared/normalize/QualityNormalizer.js';
import { normalizeVoice } from '../shared/normalize/VoiceNormalizer.js';
import { EpisodeBuilder } from '../shared/streams/EpisodeBuilder.js';
import { SeasonBuilder } from '../shared/streams/SeasonBuilder.js';
import { StreamBuilder } from '../shared/streams/StreamBuilder.js';

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeType(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('serial') || text.includes('series') || text.includes('show')) return 'serial';
  return 'movie';
}

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).map(([key, item]) => ({ id: key, ...(item && typeof item === 'object' ? item : { title: item }) }));
}

function normalizeGenres(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function normalizeSubtitles(value) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries
    .map((subtitle) => ({
      url: subtitle?.url || subtitle?.link || subtitle?.src || null,
      title: subtitle?.title || subtitle?.label || subtitle?.language || subtitle?.lang || '',
      language: normalizeLanguage(subtitle?.language || subtitle?.lang)
    }))
    .filter((subtitle) => subtitle.url);
}

function normalizeCookies(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.entries(value)
    .filter(([, item]) => item !== undefined && item !== null && item !== '')
    .map(([key, item]) => `${key}=${item}`)
    .join('; ');
}

export class RezkaNormalizer {
  normalizeSearchItem(item = {}) {
    return {
      id: item.id || item.slug || item.link || null,
      title: item.title || item.name || null,
      original_title: item.original_title || item.originalTitle || item.original_name || null,
      year: item.year ? Number(item.year) : null,
      type: normalizeType(item.type || item.kind || item.category),
      language: normalizeLanguage(item.language || item.lang),
      poster: item.poster || item.poster_url || null,
      translation: item.translation || null,
      description: item.description || item.overview || null,
      genres: normalizeGenres(item.genres || item.genre),
      runtime: item.runtime || item.duration || null
    };
  }

  normalizeCard(card = {}) {
    const normalized = this.normalizeSearchItem(card);
    return {
      ...normalized,
      seasons: this.normalizeSeasons(card),
      translations: this.normalizeTranslations(card),
      qualities: this.normalizeQualities(card)
    };
  }

  normalizeSeasons(payload = {}) {
    return normalizeList(payload.seasons || payload.playlist || payload.series).map((season) => this.normalizeSeason(season));
  }

  normalizeSeason(season = {}) {
    const builder = new SeasonBuilder()
      .number(asNumber(season.number || season.season || season.id))
      .title(season.title || season.name || '');

    for (const episode of normalizeList(season.episodes || season.items || season.playlist)) {
      builder.episode(this.normalizeEpisode(episode));
    }
    return builder.build();
  }

  normalizeEpisode(episode = {}) {
    const builder = new EpisodeBuilder()
      .number(asNumber(episode.number || episode.episode || episode.id))
      .title(episode.title || episode.name || '');

    for (const stream of this.collectStreams(episode)) {
      builder.stream(this.normalizeStream(stream));
    }
    return builder.build();
  }

  normalizeStream(stream = {}, defaults = {}) {
    const headers = { ...(defaults.headers || {}), ...(stream.headers || {}) };
    const referer = stream.referer || stream.referrer || defaults.referer || defaults.referrer || 'https://rezka.ag/';
    const cookie = normalizeCookies(stream.cookies || defaults.cookies || headers.Cookie);
    const builder = new StreamBuilder()
      .url(stream.url || stream.link || stream.src || '')
      .title(stream.title || stream.translation || defaults.title || defaults.translation || '')
      .quality(stream.quality || stream.q || stream.label || defaults.quality || '')
      .voice(stream.voice || stream.translation || defaults.voice || defaults.translation || '')
      .header('Referer', referer);

    for (const [name, value] of Object.entries(headers)) builder.header(name, value);
    if (cookie) builder.header('Cookie', cookie);
    for (const subtitle of normalizeSubtitles(stream.subtitles || defaults.subtitles)) builder.subtitle(subtitle);
    return builder.build();
  }

  normalizeStreams(payload = {}, defaults = {}) {
    const streamDefaults = {
      ...defaults,
      headers: { ...(defaults.headers || {}), ...(payload?.headers || {}) },
      cookies: payload?.cookies || defaults.cookies,
      subtitles: payload?.subtitles || defaults.subtitles,
      referer: payload?.referer || payload?.referrer || defaults.referer || defaults.referrer,
      voice: payload?.voice || payload?.translation || defaults.voice || defaults.translation,
      translation: payload?.translation || defaults.translation,
      quality: payload?.quality || defaults.quality
    };
    const streams = [];
    for (const entry of this.collectStreams(payload)) {
      const normalized = this.normalizeStream(entry, streamDefaults);
      if (normalized.url) streams.push(normalized);
    }
    return streams;
  }

  collectStreams(payload = {}) {
    const streams = [];
    for (const key of ['streams', 'variants', 'files', 'links']) {
      for (const entry of normalizeList(payload?.[key])) streams.push(entry);
    }
    if (payload?.url || payload?.link || payload?.src) streams.push(payload);
    return streams;
  }

  normalizeTranslations(payload = {}) {
    const translations = [];
    for (const entry of normalizeList(payload?.translations || payload?.voices)) {
      translations.push({
        id: entry.id || entry.slug || null,
        title: entry.title || entry.name || entry.translation || null,
        voice: normalizeVoice(entry.voice || entry.translation || entry.title || ''),
        language: normalizeLanguage(entry.language || entry.lang)
      });
    }
    return translations;
  }

  normalizeQualities(payload = {}) {
    const qualities = [];
    for (const entry of normalizeList(payload?.qualities || payload?.quality)) {
      const quality = normalizeQuality(entry.quality || entry.label || entry.name || entry.title || entry.id || entry);
      if (quality) qualities.push(quality);
    }
    return [...new Set(qualities)];
  }
}
