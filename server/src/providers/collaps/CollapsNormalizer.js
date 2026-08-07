// Collaps — перенос Lampac OnlineRUS/Collaps (NormModel + Invoke.Embed/Tpl).
//
// Search возвращает результаты по названию: {results:[{id,name,origin_name,
// year, poster, type, kinopoisk_id, imdb_id, iframe_url, ...}]}. Embed-страница
// плеера содержит либо блок source (hls/dasha/dash + audio.names + cc) для
// фильма, либо seasons:[{season, episodes:[{episode, hls, dash, audio, cc}]}]
// для сериала. Нормализатор — чистый слой: сырые DTO → записи/матрицы воспроизведения.

const MOVIE_TYPES = new Set([
  'film', 'movie', 'anime', 'anime-film', 'cartoon', 'cartoon-film', 'animation',
  'foreign-movie', 'russian-movie'
]);

export function isMovieType(value) {
  const type = String(value || '').toLowerCase();
  if (MOVIE_TYPES.has(type)) return true;
  // "series"/"serial"/пустой → сериал (остальное считается сериалом, как Lampac).
  return !['series', 'serial', 'tvseries', 'mini-series', 'miniseries', 'tvshow'].includes(type);
}

export class CollapsNormalizer {
  /** RootSearch → записи провайдера (по результатам поиска). */
  search(root, query = {}) {
    const results = Array.isArray(root?.results) ? root.results : [];
    if (!results.length) return [];

    return results.map((item) => this.record(item));
  }

  /** Результат поиска → запись провайдера (movie/serial по type). */
  record(item = {}) {
    const id = Number(item.id || 0) || 0;
    const type = isMovieType(item.type) ? 'movie' : 'serial';

    return {
      provider: 'collaps',
      id: String(id),
      orid: id,
      title: item.name || item.origin_name || '',
      original_title: item.origin_name || '',
      year: Number(item.year) || null,
      type,
      kinopoisk_id: Number(item.kinopoisk_id || 0) || null,
      imdb_id: item.imdb_id || null,
      poster: item.poster || null,
      embedHost: item.iframe_url ? originOf(item.iframe_url) : '',
      metadata: {
        title: item.name || item.origin_name || '',
        original_title: item.origin_name || '',
        year: Number(item.year) || null,
        type,
        poster: item.poster || null,
        kinopoisk_id: Number(item.kinopoisk_id || 0) || null,
        imdb_id: item.imdb_id || null
      }
    };
  }

  /**
   * Парсит HTML embed-страницы → {isSerial, movie, seasons}.
   * Фильм: source с hls/dasha/dash + audio.names + cc.
   * Сериал: seasons[] (season → episodes[] с полями hls/dash/audio/cc).
   */
  parseEmbed(text = '', query = {}) {
    if (!text || typeof text !== 'string') return { isSerial: false, movie: null, seasons: [] };

    if (text.includes('seasons:')) {
      const seasons = this.parseSeasons(text);
      if (seasons.length) return { isSerial: true, movie: null, seasons };
    }
    return { isSerial: false, movie: this.parseMovie(text, query), seasons: [] };
  }

  parseMovie(text, query = {}) {
    const src = this.sourceBlock(text);
    if (!src) return null;

    const hls = matchUrl(src, 'hls');
    const dash = matchUrl(src, 'dash') || matchUrl(src, 'dasha');
    // Однosing источник для фильма — как Lampac: `{config.dash ? dash : hls}`.
    const url = hls || dash;
    if (!url) return null;

    const cc = this.collectCc(src);
    const names = this.collectAudioNames(src);
    const voiceName = names.length ? joinVoice(names) : 'По умолчанию';

    return {
      hls,
      dash,
      url,
      name: query.title || '',
      voicename: voiceName,
      audioNames: names,
      cc
    };
  }

  parseSeasons(text) {
    const array = sliceJsonArray(text, 'seasons:');
    if (!Array.isArray(array)) return [];
    const seasons = [];
    for (const raw of array) {
      const number = Number(raw?.season) || 0;
      const episodes = (Array.isArray(raw?.episodes) ? raw.episodes : [])
        .map((ep) => this.parseEpisode(ep))
        .filter((ep) => ep);
      if (number > 0 && episodes.length) seasons.push({ number, episodes });
    }
    return seasons.sort((a, b) => a.number - b.number);
  }

  parseEpisode(ep = {}) {
    const number = Number(ep.episode) || 0;
    const hls = cleanUrl(ep.hls);
    const dash = cleanUrl((ep.dasha ?? ep.dash));
    if (!number || (!hls && !dash)) return null;
    return {
      number,
      title: String(ep.title || `${number} серия`),
      hls,
      dash,
      url: hls || dash,
      audioNames: Array.isArray(ep.audio?.names) ? ep.audio.names.map(normalizeVoice) : [],
      cc: (Array.isArray(ep.cc) ? ep.cc : []).filter((c) => c && c.url && c.name).map((c) => ({ url: cleanUrl(c.url), name: String(c.name) }))
    };
  }

  /** src сегмент makePlayer → блок source {…} (балансным скобкам). */
  sourceBlock(text) {
    const idx = text.indexOf('source:');
    if (idx < 0) return null;
    const start = text.indexOf('{', idx);
    if (start < 0) return null;
    const endIndex = balancedOf(text, start, '{', '}');
    if (endIndex <= start) return null;
    return text.slice(start, endIndex + 1);
  }

  /** audio.names из source-блока. */
  collectAudioNames(src) {
    if (!src) return [];
    const arr = sliceJsonArray(src, 'names:');
    if (!Array.isArray(arr)) return [];
    return arr.map(normalizeVoice).filter(Boolean);
  }

  collectCc(src) {
    if (!src) return [];
    const arr = sliceJsonArray(src, 'cc:');
    if (!Array.isArray(arr)) return [];
    return arr.filter((c) => c && c.url && c.name).map((c) => ({ url: cleanUrl(c.url), name: String(c.name) }));
  }
}

function matchUrl(src, key) {
  // hls: "..." / dasha?: "..." — разрешаем переменный отступ/кавычки.
  const re = new RegExp(`${key}\\s*:\\s*"(https?://[^"]+)"`);
  const m = src.match(re);
  return m ? cleanUrl(m[1]) : '';
}

function cleanUrl(url = '') {
  const text = String(url || '').trim();
  if (!text) return '';
  return text.replace(/\\u0026/g, '&').replace(/\\/g, '');
}

function normalizeVoice(name) {
  return String(name || '').trim();
}
function joinVoice(names) {
  return names.map(normalizeVoice).filter(Boolean).join(', ');
}

/**
 * Балансные скобки: вернуть закрывающий индекс открывающей скобки (start).
 * Не понять JS-строки с скобками внутри — для JSON-секций достаточно.
 */
function balancedOf(text, start, open, close) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function sliceJsonArray(text, marker) {
  const i = text.indexOf(marker);
  if (i < 0) return null;
  const start = text.indexOf('[', i);
  if (start < 0) return null;
  const end = balancedOf(text, start, '[', ']');
  if (end < 0) return null;
  const raw = text.slice(start, end + 1);
  return parseJsObject(raw);
}

/**
 * Парсит фрагмент embed-страницы (JS object literal, не строгий JSON): ключи
 * объекта могут быть без кавычек (`{ name: "x" }`), лишние запятые в хвостах —
 * как в реальном makePlayer. Сначала строгий JSON, потом поочерёдно:
 * 1) закавычить идентификаторы-ключи `{ name:` → `{ "name":`;
 * 2) убрать trailing-commas; 3) убрать кавычки-экраны.
 */
function parseJsObject(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const quoted = raw.replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, '$1"$2"$3');
    try {
      return JSON.parse(quoted);
    } catch {
      const minified = quoted.replace(/,\s*([\]}])/g, '$1');
      try {
        return JSON.parse(minified);
      } catch {
        return null;
      }
    }
  }
}

function originOf(url) {
  try { return new URL(url).origin; } catch { return ''; }
}