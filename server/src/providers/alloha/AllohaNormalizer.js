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

export class AllohaNormalizer {
  normalizeSearchItem(item = {}) {
    return {
      id: item.id || item.token || null,
      title: item.title || item.name || item.original_title || item.original_name || null,
      original_title: item.original_title || item.original_name || item.name || null,
      year: item.year ? Number(item.year) : null,
      type: normalizeType(item.type || item.category?.slug || ''),
      poster: item.poster || null,
      token: item.token || item.id || null
    };
  }

  normalizeSeasons(payload = {}) {
    const source = payload?.item || payload?.data || payload || {};
    const seasons = Array.isArray(source.seasons) ? source.seasons : [];
    return seasons.map((season) => this.normalizeSeason(season));
  }

  normalizeSeason(season = {}) {
    const builder = new SeasonBuilder()
      .number(asNumber(season.season || season.number || season.id))
      .title(season.title || season.name || '');

    for (const episode of season.episodes || []) {
      builder.episode(this.normalizeEpisode(episode));
    }
    return builder.build();
  }

  normalizeEpisode(episode = {}) {
    const builder = new EpisodeBuilder()
      .number(asNumber(episode.episode || episode.number || episode.id))
      .title(episode.title || episode.name || '');

    for (const translation of episode.translations || []) {
      builder.stream(this.normalizeStream({ title: translation.name || translation.title || '', voice: translation.name || translation.title || '', quality: translation.quality || '' }));
    }
    return builder.build();
  }

  normalizeTranslations(payload = {}) {
    const source = payload?.item || payload?.data || payload || {};
    const translations = Array.isArray(source.translations) ? source.translations : [];
    return translations.map((entry) => ({
      id: entry.id || entry.token || null,
      title: entry.name || entry.title || null,
      voice: normalizeVoice(entry.name || entry.title || ''),
      language: normalizeLanguage(entry.language || entry.lang),
      quality: normalizeQuality(entry.quality || ''),
      uhd: Boolean(entry.uhd)
    })).sort((a, b) => {
      const aRank = a.uhd ? 1 : 0;
      const bRank = b.uhd ? 1 : 0;
      return bRank - aRank || String(a.title || '').localeCompare(String(b.title || ''));
    });
  }

  normalizeQualities(payload = {}) {
    const source = payload?.item || payload?.data || payload || {};
    const translations = Array.isArray(source.translations) ? source.translations : [];
    const explicit = translations
      .map((entry) => normalizeQuality(entry.quality || ''))
      .filter(Boolean);
    const fallback = translations
      .map((entry) => entry.uhd ? '2160p' : null)
      .filter(Boolean);
    return [...new Set([...explicit, ...fallback])];
  }

  normalizeStreams(payload = {}) {
    const sourcePayload = payload?.file || payload || {};
    const hlsSources = Array.isArray(payload?.hlsSources)
      ? payload.hlsSources
      : Array.isArray(sourcePayload?.hlsSource)
        ? sourcePayload.hlsSource
        : [];
    const streams = [];

    for (const source of hlsSources) {
      const qualities = source?.quality || {};
      const reserve = source?.reserve || {};
      for (const [quality, url] of Object.entries(qualities)) {
        const normalized = new StreamBuilder()
          .url(String(url || ''))
          .title(source.title || '')
          .quality(normalizeQuality(quality))
          .voice(source.voice || '')
          .header('Referer', 'https://apbugall.org/')
          .build();
        if (normalized.url) streams.push(normalized);
      }
      for (const [quality, url] of Object.entries(reserve)) {
        const normalized = new StreamBuilder()
          .url(String(url || ''))
          .title(source.title || '')
          .quality(normalizeQuality(quality))
          .voice(source.voice || '')
          .header('Referer', 'https://apbugall.org/')
          .build();
        if (normalized.url) streams.push(normalized);
      }
    }

    return streams;
  }

  normalizeStream(stream = {}) {
    return new StreamBuilder()
      .url(stream.url || stream.link || stream.src || '')
      .title(stream.title || stream.translation || '')
      .quality(stream.quality || stream.q || '')
      .voice(stream.voice || stream.translation || '')
      .header('Referer', 'https://apbugall.org/')
      .build();
  }
}
