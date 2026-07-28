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
      language: normalizeLanguage(item.language || 'ru')
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
        voice: movie.translation
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

  buildStream({ url, quality, voice, title, season, episode }) {
    if (!isHttpUrl(url)) return null;
    return new StreamBuilder()
      .url(this.streamProxy(url))
      .title(title)
      .quality(`${quality}p`)
      .voice(voice)
      .header('Referer', 'https://filmix.my/')
      .build();
  }
}
