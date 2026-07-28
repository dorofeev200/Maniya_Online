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

export class RezkaNormalizer {
  normalizeSearchItem(item = {}) {
    return {
      id: item.id || item.slug || item.link || null,
      title: item.title || item.name || null,
      original_title: item.original_title || item.originalTitle || item.original_name || null,
      year: item.year ? Number(item.year) : null,
      type: normalizeType(item.type || item.kind || item.category),
      language: normalizeLanguage(item.language || item.lang),
      poster: item.poster || null,
      translation: item.translation || null
    };
  }

  normalizeSeason(season = {}) {
    const builder = new SeasonBuilder()
      .number(asNumber(season.number || season.season || season.id))
      .title(season.title || season.name || '');

    for (const episode of season.episodes || []) {
      builder.episode(this.normalizeEpisode(episode));
    }
    return builder.build();
  }

  normalizeEpisode(episode = {}) {
    const builder = new EpisodeBuilder()
      .number(asNumber(episode.number || episode.episode || episode.id))
      .title(episode.title || episode.name || '');

    for (const stream of episode.streams || []) {
      builder.stream(this.normalizeStream(stream));
    }
    return builder.build();
  }

  normalizeStream(stream = {}) {
    return new StreamBuilder()
      .url(stream.url || stream.link || stream.src || '')
      .title(stream.title || stream.translation || '')
      .quality(stream.quality || stream.q || '')
      .voice(stream.voice || stream.translation || '')
      .header('Referer', 'https://rezka.ag/')
      .build();
  }

  normalizeStreams(payload = {}) {
    const streams = [];
    for (const entry of Array.isArray(payload?.streams) ? payload.streams : []) {
      const normalized = this.normalizeStream(entry);
      if (normalized.url) streams.push(normalized);
    }
    return streams;
  }

  normalizeTranslations(payload = {}) {
    const translations = [];
    for (const entry of Array.isArray(payload?.translations) ? payload.translations : []) {
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
    for (const entry of Array.isArray(payload?.qualities) ? payload.qualities : []) {
      const quality = normalizeQuality(entry.quality || entry.label || entry.name || '');
      if (quality) qualities.push(quality);
    }
    return [...new Set(qualities)];
  }
}
