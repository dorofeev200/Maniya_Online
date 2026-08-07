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

export function qualityAllowed(quality, { pro = false, hideFree720 = false } = {}) {
  if (pro) return true;
  if (hideFree720 && quality > 480) return false;
  return quality <= 720;
}

function parseMovieQualities(link) {
  const text = String(link || '');
  return movieQualities.filter((quality) => text.includes(`${quality},`));
}

function isDashUrl(url) {
  const text = String(url || '');
  return /\.mpd(?:$|\?)/i.test(text) || /\/dash(?:\/|$)/i.test(text) || /dash/i.test(text);
}

function extractQualities(source = {}, fallbackLink = null) {
  if (!source || typeof source !== 'object') return [];
  if (Array.isArray(source.qualities)) {
    return source.qualities
      .map((quality) => Number(quality))
      .filter((quality) => !Number.isNaN(quality));
  }
  if (Array.isArray(source.quality)) {
    return source.quality
      .map((quality) => Number(quality))
      .filter((quality) => !Number.isNaN(quality));
  }
  return parseMovieQualities(source.link || source.url || source.dash || source.dashUrl || source.dash_url || source.dashLink || source.dash_link || source.mpd || fallbackLink || '');
}

function collectDashVariantUrls(source = {}, fallbackLink = null) {
  if (!source || typeof source !== 'object') return [];

  const seen = new Set();
  const values = [];
  const push = (value) => {
    if (typeof value === 'string' && value && !seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  };

  const pushDash = (value) => {
    if (typeof value === 'string' && value && isDashUrl(value)) {
      push(value);
    }
  };

  pushDash(source.dash);
  pushDash(source.dashUrl);
  pushDash(source.dash_url);
  pushDash(source.dashLink);
  pushDash(source.dash_link);
  pushDash(source.mpd);

  if (source.type === 'dash' || source.kind === 'dash' || source.format === 'dash') {
    pushDash(source.url);
  } else if (typeof source.url === 'string' && source.url && isDashUrl(source.url)) {
    pushDash(source.url);
  }

  if (Array.isArray(source.sources)) {
    for (const item of source.sources) {
      if (typeof item === 'string') {
        pushDash(item);
      } else if (item && typeof item === 'object') {
        pushDash(item.url);
        pushDash(item.link);
        pushDash(item.dash);
        pushDash(item.dashUrl);
        pushDash(item.dash_url);
        pushDash(item.dashLink);
        pushDash(item.dash_link);
        pushDash(item.mpd);
      }
    }
  }

  if (fallbackLink && typeof fallbackLink === 'string' && isDashUrl(fallbackLink)) {
    push(fallbackLink);
  }

  return values;
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

function dedupeStreams(streams = []) {
  const seen = new Set();
  return streams.filter((stream) => {
    if (!stream || typeof stream !== 'object') return false;
    const payload = {
      url: stream.url || '',
      title: stream.title || '',
      quality: stream.quality || '',
      voice: stream.voice || '',
      season: stream.season ?? '',
      episode: stream.episode ?? '',
      headers: stream.headers && typeof stream.headers === 'object' ? Object.fromEntries(Object.entries(stream.headers).sort(([left], [right]) => left.localeCompare(right))) : {},
      subtitles: Array.isArray(stream.subtitles) ? [...stream.subtitles] : []
    };
    const key = JSON.stringify(payload);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    const streams = [];
    const primaryLink = movie.link;
    const primaryQualities = extractQualities(movie, primaryLink);

    for (const quality of primaryQualities) {
      if (!qualityAllowed(quality, this)) continue;
      const stream = this.buildStream({
        url: expandMovieLink(primaryLink, quality, this),
        quality,
        voice: movie.translation
      });
      if (stream) streams.push(stream);
    }

    for (const variantUrl of collectDashVariantUrls(movie, primaryLink)) {
      const dashQualities = extractQualities({ ...movie, link: variantUrl }, primaryLink);
      for (const quality of (dashQualities.length ? dashQualities : [null])) {
        if (!qualityAllowed(quality, this)) continue;
        const stream = this.buildStream({
          url: variantUrl,
          quality,
          voice: movie.translation
        });
        if (stream) streams.push(stream);
      }
    }

    for (const backup of Array.isArray(movie.backup) ? movie.backup : []) {
      if (!backup || typeof backup !== 'object') continue;
      const backupQualities = extractQualities(backup, backup.link);
      for (const quality of backupQualities) {
        if (!qualityAllowed(quality, this)) continue;
        const stream = this.buildStream({
          url: expandMovieLink(backup.link, quality, this),
          quality,
          voice: backup.translation || movie.translation
        });
        if (stream) streams.push(stream);
      }
      for (const variantUrl of collectDashVariantUrls(backup, backup.link)) {
        const dashQualities = extractQualities({ ...backup, link: variantUrl }, backup.link);
        for (const quality of (dashQualities.length ? dashQualities : [null])) {
          if (!qualityAllowed(quality, this)) continue;
          const stream = this.buildStream({
            url: variantUrl,
            quality,
            voice: backup.translation || movie.translation
          });
          if (stream) streams.push(stream);
        }
      }
    }

    for (const reserve of Array.isArray(movie.reserve) ? movie.reserve : []) {
      if (!reserve || typeof reserve !== 'object') continue;
      const reserveQualities = extractQualities(reserve, reserve.link);
      for (const quality of reserveQualities) {
        if (!qualityAllowed(quality, this)) continue;
        const stream = this.buildStream({
          url: expandMovieLink(reserve.link, quality, this),
          quality,
          voice: reserve.translation || movie.translation
        });
        if (stream) streams.push(stream);
      }
      for (const variantUrl of collectDashVariantUrls(reserve, reserve.link)) {
        const dashQualities = extractQualities({ ...reserve, link: variantUrl }, reserve.link);
        for (const quality of (dashQualities.length ? dashQualities : [null])) {
          if (!qualityAllowed(quality, this)) continue;
          const stream = this.buildStream({
            url: variantUrl,
            quality,
            voice: reserve.translation || movie.translation
          });
          if (stream) streams.push(stream);
        }
      }
    }

    return dedupeStreams(streams);
  }

  normalizeEpisode(number, episode = {}, seasonNumber, title = null) {
    const builder = new EpisodeBuilder().number(Number(number)).title(`${number} серия`);
    const qualities = [...extractQualities(episode, episode.link)]
      .filter((quality) => qualityAllowed(Number(quality), this))
      .sort((a, b) => Number(b) - Number(a));

    for (const quality of qualities) {
      builder.stream(this.buildStream({
        url: expandEpisodeLink(episode.link, quality, this),
        quality,
        voice: episode.translation,
        title,
        season: seasonNumber === '-1' ? 1 : Number(seasonNumber),
        episode: Number(number)
      }));
    }

    for (const variantUrl of collectDashVariantUrls(episode, episode.link)) {
      const dashQualities = [...extractQualities({ ...episode, link: variantUrl }, episode.link)]
        .filter((value) => qualityAllowed(Number(value), this))
        .sort((a, b) => Number(b) - Number(a));
      for (const quality of (dashQualities.length ? dashQualities : [null])) {
        builder.stream(this.buildStream({
          url: variantUrl,
          quality,
          voice: episode.translation,
          title,
          season: seasonNumber === '-1' ? 1 : Number(seasonNumber),
          episode: Number(number)
        }));
      }
    }

    for (const backup of Array.isArray(episode.backup) ? episode.backup : []) {
      if (!backup || typeof backup !== 'object') continue;
      for (const quality of [...extractQualities(backup, backup.link)]
        .filter((value) => qualityAllowed(Number(value), this))
        .sort((a, b) => Number(b) - Number(a))) {
        builder.stream(this.buildStream({
          url: expandEpisodeLink(backup.link, quality, this),
          quality,
          voice: backup.translation || episode.translation,
          title,
          season: seasonNumber === '-1' ? 1 : Number(seasonNumber),
          episode: Number(number)
        }));
      }
      for (const variantUrl of collectDashVariantUrls(backup, backup.link)) {
        const dashQualities = [...extractQualities({ ...backup, link: variantUrl }, backup.link)]
          .filter((value) => qualityAllowed(Number(value), this))
          .sort((a, b) => Number(b) - Number(a));
        for (const quality of (dashQualities.length ? dashQualities : [null])) {
          builder.stream(this.buildStream({
            url: variantUrl,
            quality,
            voice: backup.translation || episode.translation,
            title,
            season: seasonNumber === '-1' ? 1 : Number(seasonNumber),
            episode: Number(number)
          }));
        }
      }
    }

    for (const reserve of Array.isArray(episode.reserve) ? episode.reserve : []) {
      if (!reserve || typeof reserve !== 'object') continue;
      for (const quality of [...extractQualities(reserve, reserve.link)]
        .filter((value) => qualityAllowed(Number(value), this))
        .sort((a, b) => Number(b) - Number(a))) {
        builder.stream(this.buildStream({
          url: expandEpisodeLink(reserve.link, quality, this),
          quality,
          voice: reserve.translation || episode.translation,
          title,
          season: seasonNumber === '-1' ? 1 : Number(seasonNumber),
          episode: Number(number)
        }));
      }
      for (const variantUrl of collectDashVariantUrls(reserve, reserve.link)) {
        const dashQualities = [...extractQualities({ ...reserve, link: variantUrl }, reserve.link)]
          .filter((value) => qualityAllowed(Number(value), this))
          .sort((a, b) => Number(b) - Number(a));
        for (const quality of (dashQualities.length ? dashQualities : [null])) {
          builder.stream(this.buildStream({
            url: variantUrl,
            quality,
            voice: reserve.translation || episode.translation,
            title,
            season: seasonNumber === '-1' ? 1 : Number(seasonNumber),
            episode: Number(number)
          }));
        }
      }
    }

    const builtEpisode = builder.build();
    return {
      ...builtEpisode,
      streams: dedupeStreams(builtEpisode.streams)
    };
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
    const normalizedQuality = quality == null ? null : (Number.isFinite(Number(quality)) ? `${quality}p` : quality);
    return new StreamBuilder()
      .url(this.streamProxy(url))
      .title(title)
      .quality(normalizedQuality)
      .voice(voice)
      .header('Referer', 'https://filmix.my/')
      .build();
  }
}
