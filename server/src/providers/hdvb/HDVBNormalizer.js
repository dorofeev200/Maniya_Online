// HDVB — перенос Lampac OnlineRUS/HDVB (Controller + Model).
//
// API возвращает List<Video>. Для filter: iframe_url по пути /movie/{tok}/iframe
// (фильм) или /serial/{tok}/iframe (сериал), хост заменяется на init.host
// (fixframe). С iframe-страницы выдираем href / key (csrf) / file; затем POST
// `https://vid11.{href}/playlist/{file}.txt`:
//   - фильм → сразу подписанная m3u8-ссылка (или вторая итерация `"file"`);
//   - сериал → List<Folder> {id, folder:[{episode, id, folder:[{file, title}]}]},
//     где серия ищется по id|episode|title == сезон|серия|перевод.
// Нормализатор — чистый слой: сырые ответы → записи/матрицы воспроизведения.

const PLAYER_FILE_RE = /^\/playlist\//;

export class HDVBNormalizer {
  /** Video[] → записи провайдера. Дедуп по kinopoisk_id (как Lampac SimilarTpl). */
  search(videos, query = {}) {
    if (!Array.isArray(videos)) return [];
    const seen = new Set();
    const records = [];
    for (const video of videos) {
      if (!video || typeof video !== 'object') continue;
      const kinopoisk_id = Number(video.kinopoisk_id || 0) || 0;
      if (kinopoisk_id && seen.has(kinopoisk_id)) continue;
      if (kinopoisk_id) seen.add(kinopoisk_id);
      records.push(this.record(video));
    }
    return records;
  }

  /** Один Video → запись провайдера (movie/serial по type). */
  record(video = {}) {
    const type = String(video.type || '') === 'serial' ? 'serial' : 'movie';
    const kinopoisk_id = Number(video.kinopoisk_id || 0) || 0;
    const title = video.title_ru || video.title_en || '';
    return {
      provider: 'hdvb',
      id: kinopoisk_id ? String(kinopoisk_id) : String(video.id ?? ''),
      title,
      original_title: video.title_en || '',
      year: Number(video.year) || null,
      type,
      kinopoisk_id,
      imdb_id: video.imdb_id || null,
      poster: video.poster || null,
      metadata: {
        title,
        original_title: video.title_en || '',
        year: Number(video.year) || null,
        type,
        poster: video.poster || null,
        kinopoisk_id,
        imdb_id: video.imdb_id || null
      }
    };
  }

  /** iframe-страница → {href, key, file} (как Lampac Rx.Match). */
  extractEmbed(html = '') {
    // Допускаем пробел после двоеточия (`"href": "..."`), как в реальной разметке.
    const href = match(html, /"href"\s*:\s*"([^"]+)"/);
    const key = match(html, /"key"\s*:\s*"([^"]+)"/);
    const file = match(html, /"file"\s*:\s*"([^"]+)"/);
    return { href, key, file, ready: Boolean(href && key && file) };
  }

  /** Очистка file-пути как Lampac: `^/playlist/` → `/`, снять `.txt`. */
  cleanFile(file) {
    return String(file || '').replace(PLAYER_FILE_RE, '/').replace(/\.txt$/, '');
  }

  /**
   * Ответ POST playlist → {m3u8} | {folders} | {nextFile} | {}.
   * Фильм: ссылка с `/index.m3u8`; иначе может быть JSON Folder[] или `"file"`.
   */
  parsePlaylistResponse(text) {
    const body = String(text || '').trim();
    if (!body) return {};
    if (body.includes('/index.m3u8')) return { m3u8: body };
    try {
      const arr = JSON.parse(body);
      if (Array.isArray(arr)) return { folders: arr };
    } catch { /* не JSON-массив */ }
    const file = match(body, /"file":"([^"]+)"/);
    if (file) return { nextFile: this.cleanFile(file) };
    return {};
  }

  /**
   * FINAL-PLAYBACK-GAP-001: свежие фильмы hdvb в POST playlist возвращают не m3u8,
   * а JSON-массив озвучек `[{title, id, translator, file}]` (в отличие от сериальных
   * Folder[] с `folder`). Берём file выбранной озвучки (Дубляж, иначе первой).
   * Локаль для movie: сезонные элементы имеют `folder`, озвучки — `file`.
   */
  voiceFile(folders) {
    if (!Array.isArray(folders) || !folders.length) return '';
    const voices = folders.filter((v) => v && typeof v.file === 'string' && v.file && !v.folder);
    if (!voices.length) return '';
    const dub = voices.find((v) => /дубляж/i.test(String(v.title || '')));
    return this.cleanFile((dub || voices[0]).file);
  }

  /** Серия сериала: file по id сезона, episode и title перевода. */
  episodeFile(folders, seasonId, episode, translator) {
    if (!Array.isArray(folders) || !seasonId || episode === undefined || episode === null) return '';
    const season = folders.find((folder) => folder && String(folder.id) === String(seasonId));
    const episodes = season?.folder;
    if (!Array.isArray(episodes)) return '';
    const episodeFolder = episodes.find((folder) => folder && String(folder.episode) === String(episode));
    const voices = episodeFolder?.folder;
    if (!Array.isArray(voices)) return '';
    const voice = voices.find((folder) => folder && String(folder.title) === String(translator));
    return voice?.file || '';
  }
}

function match(text, re) {
  const m = String(text || '').match(re);
  return m ? m[1].replace(/\\/g, '') : '';
}