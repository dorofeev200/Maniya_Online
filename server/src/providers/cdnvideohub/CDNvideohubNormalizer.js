// CDNvideohub (VideoHUB) — перенос Lampac OnlineRUS/CDNvideohub.
//
// API-контракт:
//   playlist: {host}/api/v1/player/sv/playlist?pub=12&aggr=kp&id={kp}
//     → RootObject {titleName, isSerial, items:[{season, episode, voiceStudio, voiceType, vkId}]}
//   video:    {host}/api/v1/player/sv/video/{vkId} → текст, срез "hlsUrl":"..."
//
// Сервис ключуется ТОЛЬКО по kinopoisk_id (поиска по названию нет) — провайдер
// отвечает только когда у карточки есть kp. Нормализатор — чистый слой:
// RootObject → запись провайдера + уникальные озвучки/сезоны/серии.

export class CDNvideohubNormalizer {
  /**
   * RootObject playlist → [record] (0 или 1). Запись несёт сырые items,
   * из которых videos() строит play-записи, и дублирует базовые поля в metadata.
   */
  records(root, query = {}) {
    const items = Array.isArray(root?.items) ? root.items : [];
    if (!items.length) return [];

    const kinopoiskId = Number(query.kinopoisk_id || query.kp || 0) || 0;
    if (!kinopoiskId) return []; // провайдер работает только по kp

    const type = Boolean(root.isSerial) ? 'serial' : 'movie';
    const title = String(query.title || root.titleName || '');
    const originalTitle = String(query.original_title || query.originalTitle || '');
    const year = Number(query.year || query.year) || null;

    const record = {
      provider: 'cdnvideohub',
      id: String(kinopoiskId),
      title,
      original_title: originalTitle,
      year,
      type,
      kinopoisk_id: kinopoiskId,
      items,
      isSerial: Boolean(root.isSerial),
      metadata: {
        title,
        original_title: originalTitle,
        year,
        type,
        kinopoisk_id: kinopoiskId,
        poster: null
      }
    };
    return [record];
  }

  /** Уникальные названия озвучек (voiceType) по items — как цикл переводов Lampac. */
  voices(root) {
    const seen = new Set();
    const titles = [];
    for (const item of Array.isArray(root?.items) ? root.items : []) {
      const name = String(item?.voiceType || 'Оригинал');
      if (name && !seen.has(name)) {
        seen.add(name);
        titles.push(name);
      }
    }
    return titles;
  }

  /** Уникальные сезоны по items (встречающиеся season) → [{number, title}]. */
  seasons(root) {
    const numbers = new Set();
    for (const item of Array.isArray(root?.items) ? root.items : []) {
      const number = asNumber(item?.season);
      if (number > 0) numbers.add(number);
    }
    return [...numbers].sort((a, b) => a - b).map((number) => ({ number, title: `${number} сезон` }));
  }

  /** Уникальные серии выбранного сезона → [{number, title}]. */
  episodes(root, seasonNumber = 0) {
    const seen = new Set();
    const episodes = [];
    const season = Number(seasonNumber) || 0;
    for (const item of Array.isArray(root?.items) ? root.items : []) {
      if (season > 0 && Number(item?.season) !== season) continue;
      const number = asNumber(item?.episode);
      if (number > 0 && !seen.has(number)) {
        seen.add(number);
        episodes.push({ number, title: `${number} серия` });
      }
    }
    return episodes.sort((a, b) => a.number - b.number);
  }
}

function asNumber(value) {
  const number = Number.parseInt(String(value), 10);
  return Number.isFinite(number) ? number : 0;
}
