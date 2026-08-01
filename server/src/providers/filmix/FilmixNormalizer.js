import { normalizeLanguage } from '../shared/normalize/LanguageNormalizer.js';
import { normalizeQuality } from '../shared/normalize/QualityNormalizer.js';
import { normalizeVoice } from '../shared/normalize/VoiceNormalizer.js';
import { EpisodeBuilder } from '../shared/streams/EpisodeBuilder.js';
import { SeasonBuilder } from '../shared/streams/SeasonBuilder.js';
import { StreamBuilder } from '../shared/streams/StreamBuilder.js';
import { isHttpUrl } from '../shared/utils/Url.js';

const movieQualities = [2160, 1440, 1080, 720, 480];

function toHlsUrl(url) {
  const match = String(url || '').match(/^(https?:\/\/[^/]+)\/s\/([^/]+)\/(.*)$/);
  if (!match || /\/(HDR10p?|HEVC)\//.test(url)) return url;
  return `${match[1]}/hls/${match[3]}/index.m3u8?hash=${match[2]}`;
}

function qualityAllowed(quality, { pro = false, hideFree720 = false } = {}) {
  if (pro) return true;
  if (hideFree720 && quality > 480) return false;
  return quality <= 720;
}

function parseMovieQualities(link) {
  const text = String(link || '');
  return movieQualities.filter((quality) => text.includes(`${quality},`));
}

function expandMovieLink(link, quality, { hls = false } = {}) {
  const expanded = String(link || '').replace(/_\[[0-9,]+\]\.mp4/, `_${quality}.mp4`);
  return hls ? toHlsUrl(expanded) : expanded;
}

function expandEpisodeLink(link, quality, { hls = false } = {}) {
  const expanded = String(link || '').replace('_%s.mp4', `_${quality}.mp4`);
  return hls ? toHlsUrl(expanded) : expanded;
}

function normalizeGenres(item = {}) {
  const value = item.genres || item.genre || item.categories || item.category;
  const genres = Array.isArray(value) ? value : String(value || '').split(/[,/|]+/);
  return [...new Set(genres
    .map((genre) => (typeof genre === 'string' ? genre : genre?.title || genre?.name || genre?.label || genre?.value))
    .map((genre) => String(genre || '').trim())
    .filter(Boolean))];
}

function normalizeRuntime(item = {}) {
  const value = item.runtime ?? item.duration ?? item.time ?? item.duration_minutes ?? item.durationMinutes;
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  const timeMatch = text.match(/^(?:(\d+)\s*:\s*)?(\d+)\s*:\s*(\d+)$/);
  if (timeMatch) {
    const hours = Number(timeMatch[1] || 0);
    const minutes = Number(timeMatch[2]);
    const seconds = Number(timeMatch[3]);
    return hours * 60 + minutes + (seconds >= 30 ? 1 : 0);
  }
  const hoursMatch = text.match(/(\d+)\s*(?:h|час|ч)/i);
  const minutesMatch = text.match(/(\d+)\s*(?:m|min|мин)/i);
  if (hoursMatch || minutesMatch) {
    return Number(hoursMatch?.[1] || 0) * 60 + Number(minutesMatch?.[1] || 0);
  }
  const number = Number.parseInt(text, 10);
  return Number.isFinite(number) ? number : null;
}

function subtitleEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((entry) => [null, entry]);
  if (typeof value === 'object' && (value.url || value.link || value.src || value.file)) return [[null, value]];
  if (typeof value === 'object') return Object.entries(value);
  return [[null, value]];
}

function normalizeSubtitles(source = {}) {
  const value = source.subtitles || source.subtitle || source.subs || source.cc || source.captions;
  return subtitleEntries(value).map(([key, entry]) => {
    const subtitle = typeof entry === 'string' ? { url: entry } : entry;
    const url = subtitle?.url || subtitle?.link || subtitle?.src || subtitle?.file;
    if (!isHttpUrl(url)) return null;
    const language = subtitle.language || subtitle.lang || subtitle.code || key || null;
    return {
      url,
      title: subtitle.title || subtitle.label || subtitle.name || language || null,
      language
    };
  }).filter(Boolean);
}

function episodeMapFromToken(token) {
  if (!token) return {};
  if (Array.isArray(token)) {
    return Object.fromEntries(token.map((item, index) => [String(index + 1), item]));
  }
  return token;
}

export class FilmixNormalizer {
  constructor({ pro = false, hls = false, streamProxy = (url) => url, hideFree720 = false } = {}) {
    this.pro = pro;
    this.hls = hls;
    this.streamProxy = streamProxy;
    this.hideFree720 = hideFree720;
  }

  normalizeSearchItem(item = {}) {
    return {
      id: item.id,
      title: item.title || null,
      original_title: item.original_title || item.original_name || null,
      year: item.year ? Number(item.year) : null,
      poster: item.poster || null,
      language: normalizeLanguage(item.language || 'ru'),
      genres: normalizeGenres(item),
      runtime: normalizeRuntime(item)
    };
  }

  voices(card, seasonNumber = null) {
    const playlist = card?.player_links?.playlist;
    if (!playlist) return [];
    const seasons = seasonNumber == null ? Object.keys(playlist) : [String(seasonNumber)];
    return [...new Set(seasons.flatMap((season) => Object.keys(playlist[season] || {})))].map((voice) => normalizeVoice(voice));
  }

  qualities(card, { seasonNumber = null, voiceIndex = 0, episodeNumber = null } = {}) {
    if (Array.isArray(card?.player_links?.movie)) {
      return [...new Set(card.player_links.movie.flatMap((movie) => parseMovieQualities(movie.link)))]
        .filter((quality) => qualityAllowed(quality, this))
        .map((quality) => normalizeQuality(`${quality}p`));
    }
    const episodes = this.episodesFor(card, seasonNumber, voiceIndex);
    const source = episodeNumber == null ? Object.values(episodes) : [episodes[String(episodeNumber)]].filter(Boolean);
    return [...new Set(source.flatMap((episode) => episode.qualities || []))]
      .filter((quality) => qualityAllowed(Number(quality), this))
      .sort((a, b) => Number(b) - Number(a))
      .map((quality) => normalizeQuality(`${quality}p`));
  }

  seasons(card) {
    return Object.keys(card?.player_links?.playlist || {}).map((seasonNumber) => ({
      ...new SeasonBuilder()
        .number(seasonNumber === '-1' ? 1 : Number(seasonNumber))
        .title(`${seasonNumber === '-1' ? 1 : seasonNumber} сезон`)
        .build(),
      sourceSeason: seasonNumber
    }));
  }

  episodesFor(card, seasonNumber, voiceIndex = 0) {
    const playlist = card?.player_links?.playlist || {};
    const season = playlist[String(seasonNumber)] || {};
    const voiceToken = Object.values(season)[voiceIndex];
    return episodeMapFromToken(voiceToken);
  }

  episodes(card, seasonNumber, voiceIndex = 0, title = null) {
    return Object.entries(this.episodesFor(card, seasonNumber, voiceIndex)).map(([number, episode]) => this.normalizeEpisode(number, episode, seasonNumber, title));
  }

  movieStreams(card) {
    return (card?.player_links?.movie || []).flatMap((movie) => this.normalizeMovie(movie));
  }

  normalizeMovie(movie = {}) {
    return parseMovieQualities(movie.link)
      .filter((quality) => qualityAllowed(quality, this))
      .map((quality) => this.buildStream({
        url: expandMovieLink(movie.link, quality, this),
        quality,
        voice: movie.translation,
        subtitles: normalizeSubtitles(movie)
      }))
      .filter(Boolean);
  }

  normalizeEpisode(number, episode = {}, seasonNumber, title = null) {
    const builder = new EpisodeBuilder().number(Number(number)).title(`${number} серия`);
    for (const quality of [...(episode.qualities || [])].sort((a, b) => Number(b) - Number(a))) {
      if (!qualityAllowed(Number(quality), this)) continue;
      builder.stream(this.buildStream({
        url: expandEpisodeLink(episode.link, quality, this),
        quality,
        voice: episode.translation,
        subtitles: normalizeSubtitles(episode),
        title,
        season: seasonNumber === '-1' ? 1 : Number(seasonNumber),
        episode: Number(number)
      }));
    }
    return builder.build();
  }

  toStreamItems(card, metadata = {}) {
    if (Array.isArray(card?.player_links?.movie) && card.player_links.movie.length) return this.movieStreams(card);
    return this.seasons(card).map((season) => new SeasonBuilder(season).build()).map((season) => ({
      ...season,
      episodes: this.episodes(card, season.sourceSeason || season.number, metadata.voiceIndex || 0, metadata.title || metadata.originalTitle)
    }));
  }

  buildStream({ url, quality, voice, subtitles = [], title, season, episode }) {
    if (!isHttpUrl(url)) return null;
    const builder = new StreamBuilder()
      .url(this.streamProxy(url))
      .title(title)
      .quality(`${quality}p`)
      .voice(voice)
      .header('Referer', 'https://filmix.my/');

    for (const subtitle of subtitles) {
      builder.subtitle(subtitle);
    }

    return builder.build();
  }
}
