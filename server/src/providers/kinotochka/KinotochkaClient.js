import { HttpError } from '../../errors.js';
import { defaultUserAgent } from '../shared/utils/UserAgent.js';

const DEFAULT_HOST = 'https://kinovibe.vip';

// Заголовки как в Lampac ModInit (Kinotochka) — без них API может 403/пусто.
// Куки для «720p» init.cookie пуст (у Kinotochka cookie не задаётся) — не шлём.
const DEFAULT_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none'
};

// Сезонные страницы в url ответа: «…-5-sezon.html» (Lampac Controller.cs,
// serial-ветка) — так клиент мапит серверные url на номера сезонов.
const SEASON_IN_URL = /-([0-9]+)-sezon/i;

// Плеерный блок страницы фильма: id:"playerjshd", file:"https://…mp4"
// (может быть список качеств через запятую) — Lampac берёт последний непустой.
const PLAYER_FILE = /id:"playerjshd", file:"(https?:\/\/[^"]+)"/i;

// Ссылка на txt-плейлист сезона на странице сериала.
const PLAYLIST_TXT = /file:"(https?:\/\/[^"]+\.txt)"/i;

// DLE-поиск (serial без kinopoisk_id): блоки результатов + название с сезоном.
const DLE_ROW = 'sres-wrap clearfix';
const DLE_SEASON_TITLE = /<h2>([^<]+) (([0-9]+) Сезон) \([0-9]{4}\)<\/h2>/i;
const DLE_ROW_URL = /href="(https?:\/\/[^"]+\.html)"/i;

/**
 * Клиент Kinotochka (kinovibe.vip → cloudflare-refirect на kinovibe.cc) —
 * перенос Lampac OnlineRUS/Kinotochka Controller.cs.
 *
 * - findByKinopoisk(kp): `{host}/api/find-by-kinopoisk.php?kinopoisk={kp}`
 *   → `[{id, url, embed}]` (url — страница фильма/сезона сериала). Пусто, если ничего.
 * - movieFile(urlPage): GET страницы → `id:"playerjshd", file:"…"` → последний
 *   непустой segment после split(",") (список качеств, берём 720p-хвост).
 * - serialSeasons(urls): сезоны из всех url ответа (`-N-sezon`) — как Lampac.
 * - seasonPlaylist(urlPage): GET страницы → `file:"….txt"` → GET txt JSON
 *   `{playlist:[{comment,file}]}` → почищенные серии.
 * - searchByTitle(title): DLE-фолбэк сериала без kinopoisk_id (POST index.php?do=search).
 *
 * Никакой фильтрации/декода — только fetch и отдача сырых DTO клиенту.
 */
export class KinotochkaClient {
  constructor(options = {}) {
    this.host = trimSlash(options.host || process.env.KINOTOCHKA_HOST || DEFAULT_HOST);
    this.headers = { ...DEFAULT_HEADERS, 'User-Agent': defaultUserAgent() };
    this.fetchImpl = options.fetchImpl || fetch;
  }

  enabled() {
    return true;
  }

  /** kp → [{id, url, embed}] (url — то, что дальше парсим, как Lampac root.First). */
  async findByKinopoisk(kinopoiskId) {
    const kp = Number(kinopoiskId) || 0;
    if (!kp) return [];

    const url = new URL('/api/find-by-kinopoisk.php', `${this.host}/`);
    url.searchParams.set('kinopoisk', String(kp));
    const root = await this.getJson(url);
    if (!Array.isArray(root)) return [];
    return root
      .map((item) => ({
        id: Number(item?.id) || 0,
        url: String(item?.url || '').trim(),
        embed: String(item?.embed || '').trim()
      }))
      .filter((item) => item.url);
  }

  /** Страница фильма → файл видео (последний непустой после split(",")). */
  async movieFile(urlPage) {
    const html = await this.getPage(urlPage);
    const match = String(html).match(PLAYER_FILE);
    if (!match) return '';

    let file = '';
    for (const part of match[1].split(',').reverse()) {
      if (!String(part).trim()) continue;
      file = part.trim();
      break;
    }
    return file;
  }

  /** Все url с `-N-sezon` → [{season, url, name}] как цикл сезонов Lampac. */
  serialSeasons(urls) {
    const result = [];
    for (const item of Array.isArray(urls) ? urls : []) {
      const match = String(item?.url || '').match(SEASON_IN_URL);
      if (match && match[1]) {
        result.push({
          season: Number(match[1]),
          url: item.url,
          name: `${match[1]} сезон`
        });
      }
    }
    return result;
  }

  /** Страница сезона → .txt плейлист → [{comment, file}] (почищенные серии). */
  async seasonPlaylist(urlPage) {
    if (!urlPage) return [];
    const html = await this.getPage(urlPage);
    const match = String(html).match(PLAYLIST_TXT);
    if (!match) return [];

    const root = await this.getJson(match[1]);
    const playlist = Array.isArray(root?.playlist) ? root.playlist : [];
    const episodes = [];
    for (const pl of playlist) {
      const comment = String(pl?.comment || '').trim();
      let file = String(pl?.file || '').trim();
      if (!comment || !file) continue;
      // Старый формат `[720,123].mp4` — снять бейдж качества (Lampac regex).
      file = file.replace(/\[[^\]]+,([0-9]+)\]\.mp4$/i, '$1.mp4');
      episodes.push({ comment: comment.split('<')[0].trim(), file });
    }
    return episodes;
  }

  /** DLE-поиск сериала по названию (serial без kinopoisk_id, как Lampac). */
  async searchByTitle(title) {
    const q = String(title || '').trim();
    if (!q) return [];

    const form = new URLSearchParams({
      do: 'search',
      subaction: 'search',
      search_start: '0',
      full_search: '0',
      result_from: '1',
      story: q
    });
    let html;
    const response = await this.fetchImpl(`${this.host}/index.php?do=search`, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    if (response.status === 204) return [];
    if (!response.ok) throw new HttpError(response.status, 'kinotochka_http_error', `Kinotochka HTTP ${response.status}`);

    // reqOk: маркер «>Поиск по сайту<» на странице — как Lampac reqOk.
    html = await response.text();
    if (!String(html).includes('>Поиск по сайту<')) return [];

    const stitle = normalizeForSearch(q);
    const result = [];
    const chunks = String(html).split(DLE_ROW);
    // Первый chunk — до первого блока результата (шапка), пропускаем.
    for (let i = 1; i < chunks.length; i++) {
      const row = chunks[i];
      const titleMatch = row.match(DLE_SEASON_TITLE);
      const urlMatch = row.match(DLE_ROW_URL);
      if (!titleMatch || !urlMatch) continue;
      if (normalizeForSearch(titleMatch[1]) !== stitle) continue;
      const season = Number(titleMatch[3]);
      if (!season) continue;
      result.push({
        season,
        url: urlMatch[1],
        name: `${season} сезон`,
        title: titleMatch[1]
      });
    }
    return result;
  }

  async getPage(url) {
    return this.getText(url, 'kinotochka_page_error');
  }

  async getJson(url) {
    const response = await this.fetchImpl(url, { headers: this.headers });
    if (response.status === 204) return null;
    if (!response.ok) throw new HttpError(response.status, 'kinotochka_http_error', `Kinotochka HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async getText(url, code = 'kinotochka_http_error') {
    const response = await this.fetchImpl(url, { headers: this.headers });
    if (response.status === 204) return '';
    if (!response.ok) throw new HttpError(response.status, code, `Kinotochka HTTP ${response.status}`);
    return response.text();
  }
}

/** SearchNameTo.Convert (Lampac): lowercase, только [0-9a-zа-яё], ё→е, щ→ш. */
export function normalizeForSearch(value) {
  return String(value || '')
    .toLowerCase()
    .split('')
    .filter((c) => /[0-9a-zа-яё]/.test(c))
    .map((c) => (c === 'ё' ? 'е' : c === 'щ' ? 'ш' : c))
    .join('');
}

function trimSlash(value) {
  return String(value).replace(/\/+$/, '');
}