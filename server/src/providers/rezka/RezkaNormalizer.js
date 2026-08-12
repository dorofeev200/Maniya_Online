import { normalizeLanguage } from '../shared/normalize/LanguageNormalizer.js';
import { EpisodeBuilder } from '../shared/streams/EpisodeBuilder.js';
import { SeasonBuilder } from '../shared/streams/SeasonBuilder.js';
import { StreamBuilder } from '../shared/streams/StreamBuilder.js';
import {
  extractItemId,
  getStreamLink,
  parseEmbedHtml,
  parseSearchHtml,
  parseSubtitleHtml
} from './RezkaCodec.js';

/**
 * Чистый слой преобразования сырых данных HDRezka → модели SDK провайдера.
 *
 * Вход — только то, что возвращает RezkaClient:
 * - `searchHtml()` → HTML поиска;
 * - `page()` → HTML карточки/embed;
 * - `getEpisodes()` → `{ seasons, episodes }`;
 * - `getStreamMovie()/getStreamEpisode()` → `{ success, url, subtitle, premium, ... }`.
 *
 * Никакой сети, Anubis, cookies, ретраев, конфига. Парсинг идёт через чистые
 * функции RezkaCodec; наружу отдаются модели SDK (записи поиска,
 * SeasonBuilder/EpisodeBuilder/StreamBuilder, переводы).
 */
export class RezkaNormalizer {
  /** HTML поиска → записи поиска (id, href, title, year, poster, type). */
  normalizeSearchItems(searchHtml) {
    return parseSearchHtml(searchHtml).map((item) => this.normalizeSearchItem(item));
  }

  normalizeSearchItem(item = {}) {
    const href = item.href || null;
    return {
      id: extractItemId(href) || item.id || null,
      href,
      title: item.title || null,
      original_title: item.original_title || item.originalTitle || null,
      year: item.year ? Number(item.year) : null,
      poster: item.poster || null,
      type: item.serial ? 'serial' : 'movie',
      language: normalizeLanguage(item.language || 'ru')
    };
  }

  /** Embed HTML → `{ id, isSerial, translators, cdnStreams, favs }`. */
  normalizeEmbed(embedHtml) {
    const embed = parseEmbedHtml(embedHtml);
    return {
      id: embed.id || null,
      isSerial: Boolean(embed.isSerial),
      translators: this.normalizeTranslations(embed.translators),
      cdnStreams: embed.cdnStreams || null,
      favs: embed.favs || ''
    };
  }

  /** `{ name: id }` переводчиков → `[{ name, id }]`. */
  normalizeTranslations(translators = {}) {
    return Object.entries(translators)
      .map(([name, id]) => ({ name: String(name).trim(), id: String(id) }))
      .filter((translation) => translation.name && translation.id);
  }

  /** get_episodes → сезоны с вложенными сериями (SeasonBuilder/EpisodeBuilder). */
  normalizeSeasons(data = {}) {
    const episodes = Array.isArray(data?.episodes) ? data.episodes : [];
    const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
    return seasons.map((season) => {
      const builder = new SeasonBuilder()
        .number(Number(season.number))
        .title(season.title || `${season.number} сезон`);
      for (const episode of episodes) {
        if (String(episode.season) !== String(season.number)) continue;
        builder.episode(this.normalizeEpisode(episode));
      }
      return builder.build();
    });
  }

  normalizeEpisode(episode = {}) {
    return new EpisodeBuilder()
      .number(Number(episode.episode))
      .title(episode.title || `${episode.episode} серия`)
      .build();
  }

  /**
   * Ответ get_movie/get_stream → StreamModel[] (StreamBuilder).
   * Каждая ссылка — Header Referer (для обращений плеера) и общие субтитры.
   */
  resolveStreams(payload = {}, { premium = false, hls = true, referer = '', voice = '', title = '' } = {}) {
    if (!payload || payload.success !== true) return [];
    const subtitles = parseSubtitleHtml(payload.subtitle).map((subtitle) => ({ label: subtitle.label, url: subtitle.url }));
    const links = getStreamLink(payload.url, { premium, hls });
    return links.map((link) => {
      const builder = new StreamBuilder()
        .url(link.url)
        .title(title)
        .quality(link.quality)
        .voice(voice);
      if (referer) builder.header('Referer', referer);
      for (const subtitle of subtitles) builder.subtitle(subtitle);
      return builder.build();
    });
  }

  /** Ответ get_movie/get_stream → `{ quality: url }` (для item.quality в videos()). */
  resolveQualities(payload, { premium = false, hls = true } = {}) {
    if (!payload || payload.success !== true) return {};
    const qualities = {};
    for (const link of getStreamLink(payload.url, { premium, hls })) {
      qualities[link.quality] = link.url;
    }
    return qualities;
  }
}

export default RezkaNormalizer;