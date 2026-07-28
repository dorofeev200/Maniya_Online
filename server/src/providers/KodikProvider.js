import { HttpClient } from './shared/http/HttpClient.js';
import { RateLimiter } from './shared/http/RateLimiter.js';
import { RetryPolicy } from './shared/http/RetryPolicy.js';
import { normalizeLanguage } from './shared/normalize/LanguageNormalizer.js';
import { SeasonBuilder } from './shared/streams/SeasonBuilder.js';
import { EpisodeBuilder } from './shared/streams/EpisodeBuilder.js';
import { StreamBuilder } from './shared/streams/StreamBuilder.js';
import { buildUrl } from './shared/utils/Url.js';

export class KodikProvider {
  constructor({ token = '', baseUrl = 'https://kodikapi.com', httpClient = null } = {}) {
    this.name = 'kodik';
    this.token = token;
    this.httpClient = httpClient || new HttpClient({
      baseUrl,
      provider: this.name,
      retryPolicy: new RetryPolicy(),
      rateLimiter: new RateLimiter({ intervalMs: 250, maxConcurrent: 2 })
    });
  }

  search(params = {}) {
    return this.httpClient.get(this.withToken('/search', params));
  }

  translations(params = {}) {
    return this.httpClient.get(this.withToken('/translations/v2', params));
  }

  withToken(path, params) {
    return buildUrl(path, { token: this.token, ...params });
  }

  mapStream(item = {}) {
    return new StreamBuilder()
      .url(item.link || item.url)
      .title(item.title || item.translation?.title)
      .quality(item.quality)
      .voice(item.translation?.title || item.voice)
      .build();
  }

  mapEpisode(episode = {}) {
    const builder = new EpisodeBuilder()
      .number(episode.number || episode.episode)
      .title(episode.title);

    for (const stream of episode.streams || []) builder.stream(this.mapStream(stream));
    return builder.build();
  }

  mapSeason(season = {}) {
    const builder = new SeasonBuilder()
      .number(season.number || season.season)
      .title(season.title);

    for (const episode of season.episodes || []) builder.episode(this.mapEpisode(episode));
    return builder.build();
  }

  mapItem(item = {}) {
    return {
      ...item,
      provider: this.name,
      language: normalizeLanguage(item.language),
      stream: item.link || item.url ? this.mapStream(item) : undefined,
      seasons: Array.isArray(item.seasons) ? item.seasons.map((season) => this.mapSeason(season)) : undefined
    };
  }
}
