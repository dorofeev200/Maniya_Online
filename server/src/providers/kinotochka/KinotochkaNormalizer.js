// Kinotochka (kinovibe.vip) — перенос Lampac OnlineRUS/Kinotochka.
//
// Сервис ключуется ТОЛЬКО по kinopoisk_id (find-by-kinopoisk.php); для сериалов
// без kp — DLE-поиск по названию (фолбэк как в Lampac Controller.cs). Клиент
// отдаёт сырые DTO (url страниц, playlist), нормализатор раскладывает их в
// записи провайдера и чистые сезоны/серии.

export class KinotochkaNormalizer {
  /**
   * Запись кинопоиск-ответа → запись провайдера (сорт-слой для search()).
   * В зависимости от типа карточки несёт разное содержимое; videos() строит
   * play-записи из полей record.
   */
  movieRecord(urls, query = {}) {
    const item = Array.isArray(urls) && urls.length ? urls[0] : null;
    const kinopoiskId = Number(query.kinopoisk_id || query.kp || 0) || 0;
    const title = String(query.title || '');
    if (!item || (!kinopoiskId && !item.url)) return null;

    return {
      provider: 'kinotochka',
      id: String(kinopoiskId || item.id || item.url),
      title,
      original_title: String(query.original_title || ''),
      year: Number(query.year) || null,
      type: 'movie',
      kinopoisk_id: kinopoiskId,
      url: item.url,
      metadata: {
        title,
        original_title: String(query.original_title || ''),
        year: Number(query.year) || null,
        type: 'movie',
        kinopoisk_id: kinopoiskId,
        poster: null
      }
    };
  }

  serialRecord(seasons, query = {}) {
    const kinopoiskId = Number(query.kinopoisk_id || query.kp || 0) || 0;
    const title = String(query.title || '');
    if (!Array.isArray(seasons) || !seasons.length) return null;

    return {
      provider: 'kinotochka',
      id: String(kinopoiskId || seasons[0].url),
      title,
      original_title: String(query.original_title || ''),
      year: Number(query.year) || null,
      type: 'serial',
      kinopoisk_id: kinopoiskId,
      seasons,
      metadata: {
        title,
        original_title: String(query.original_title || ''),
        year: Number(query.year) || null,
        type: 'serial',
        kinopoisk_id: kinopoiskId,
        poster: null
      }
    };
  }

  /** Сезоны [{season, url, name}] → [{number, title}], по возрастанию (как Maniya). */
  seasons(seasons) {
    return [...seasons]
      .sort((a, b) => a.season - b.season)
      .map((s) => ({ number: s.season, title: `${s.season} сезон` }));
  }

  /** Playlist сезона → [{number, title, url}]. */
  episodes(playlist) {
    const result = [];
    for (const pl of Array.isArray(playlist) ? playlist : []) {
      const match = String(pl.comment || '').match(/^([0-9]+)/);
      if (!match || !pl.file) continue;
      result.push({
        number: Number(match[1]),
        title: pl.comment,
        url: pl.file
      });
    }
    return result;
  }
}