import { searchNameTo } from '../shared/normalize/searchNameTo.js';

// Слова-исключения из выдачи поиска (перенос RutubeMovie.Index из Lampac).
const EXCLUDE_WORDS = ['трейлер', 'trailer', 'премьера', 'обзор', 'сезон', 'сериал', 'серия', 'серий'];

/**
 * Чистый слой: сырые результаты Rutube-поиска → записи провайдера.
 * Перенос всех фильтров Lampac RutubeMovie.Index: нормализованное название
 * содержит поисковое, год ±1, duration > 3000, категория 4, не скрытые флаги.
 */
export class RutubeNormalizer {
  constructor({ searchTitle = '', year = 0 } = {}) {
    this.searchTitle = searchTitle;
    this.year = Number(year) || 0;
  }

  with({ searchTitle = '', year = 0 } = {}) {
    this.searchTitle = searchTitle;
    this.year = Number(year) || 0;
    return this;
  }

  searchResults(results = []) {
    const searchTitle = this.searchTitle;
    const year = this.year;
    if (!searchTitle || !year) return [];

    const out = [];
    for (const movie of results) {
      if (!movie || typeof movie !== 'object') continue;

      const name = searchNameTo(movie.title);
      if (!name || !name.includes(searchTitle)) continue;

      const hasYear = [year, year + 1, year - 1].some((y) => y > 0 && name.includes(String(y)));
      if (!hasYear) continue;

      if (!(Number(movie.duration) > 3000)) continue;
      if (EXCLUDE_WORDS.some((word) => name.includes(word))) continue;
      if (Number(movie.category?.id) !== 4) continue;
      if (movie.is_hidden || movie.is_deleted || movie.is_adult || movie.is_locked || movie.is_audio || movie.is_paid || movie.is_livestream) continue;

      out.push(this.normalizeSearchItem(movie));
    }
    return out;
  }

  normalizeSearchItem(movie = {}) {
    return {
      provider: 'rutubemovie',
      id: String(movie.id || ''),
      title: movie.title || null,
      original_title: null,
      year: this.year,
      poster: movie.thumbnail_url || movie.thumbnailUrl || null,
      duration: Number(movie.duration) || 0,
      type: 'movie'
    };
  }
}