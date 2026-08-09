/**
 * Нормализатор skaz-кластера: HTML карточек (`videos__item`) → структурные данные.
 *
 * Карточки `data-json='{…}'` — формат Lampac/skaz (тот же, что E-Online):
 * - `{"method":"play", url, quality:{Np:url}, translate, maxquality, title}` — фильм:
 *   прямой CDN-URL (cdnsqu/werkecdn), мапа качеств — играбельные items.
 * - `{"method":"call", url, stream, translate, title, s?, e?, name?}` — поток
 *   требует серверного резолва (`stream` → m3u8). Серии несут `s`/`e`.
 * - `{"method":"link", url, similar?}` — «кнопка»: перевод (t=), сезон (s=)
 *   или похожие тайтлы (`similar:true` — не сезоны, пропускаем).
 *
 * Это 1:1-порт `EoNormalizer` — API совпадает посимвольно; имя класса и
 * комментарии отражают skaz-кластер (без зависимости от E-Online).
 */
export class SkazNormalizer {
  /** Разобрать HTML в массив карточек `{method, url, stream, quality, title, …}`. */
  cards(html) {
    if (!html || typeof html !== 'string') return [];
    const items = [];
    const regex = /data-json\s*=\s*(['"])([\s\S]*?)\1/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const card = parseCardJson(match[2]);
      if (!card) continue;
      const text = nearbyText(html, match.index, match[0].length);
      if (text && !card._text) card._text = text;
      items.push(card);
    }
    return items;
  }

  /**
   * Переводы (method:"link", url содержит t= и similar=false).
   *
   * По умолчанию сбрасываем карточки, несущие `s=` — это сезон-карточки,
   * у которых `t` — просто активный перевод внутри сезона (rezka), а не
   * отдельный голос. Но сериалы skaz-кластера часто двухуровневые: базовая
   * страница даёт только сезоны, а переводы появляются только на странице
   * конкретного сезона (alloha/videoseed/kinopub/…) в виде `link s=<сезон>`
   * с уникальным `t=`. Для таких страниц нужен режим `{ withSeason: true }` —
   * считать переводом любую link-карточку с `t=` (сезоны без перевода `s=`
   * без `t=` и так отсеются).
   */
  voices(cards, options = {}) {
    const seen = new Set();
    const voices = [];
    for (const card of cards || []) {
      if (card.method !== 'link') continue;
      if (card.similar) continue;
      const t = paramNumber(card.url, 't');
      if (t == null) continue;
      // Сезон-карточки rezka тоже несут `&t=<активный перевод>&s=<номер>` —
      // у перевода s быть не должно (кроме явного withSeason-режима).
      if (!options.withSeason && paramNumber(card.url, 's') != null) continue;
      const name = voiceName(card, t);
      const title = String(card._text || card.title || name).trim();
      if (seen.has(title)) continue;
      seen.add(title);
      voices.push({ name: title, t, url: String(card.url || ''), index: t });
    }
    return voices;
  }

  /** Сезоны (method:"link", url содержит s=N и не similar). */
  seasons(cards) {
    const seen = new Set();
    const seasons = [];
    for (const card of cards || []) {
      if (card.method !== 'link') continue;
      if (card.similar) continue;
      const number = paramNumber(card.url, 's');
      if (number == null) continue;
      const title = card._text || `${number} сезон`;
      if (seen.has(number)) continue;
      seen.add(number);
      seasons.push({ number, title });
    }
    return seasons;
  }

  isSerial(html) {
    return /videos__season|serial=1/i.test(String(html || ''));
  }

  hasEpisodes(cards) {
    return (cards || []).some((card) => card.method === 'call' && card.s != null && card.e != null);
  }

  /** Фильм: играбельные items по карточкам `play`/`call` (без s/e). */
  filmItems(cards, query = {}) {
    const items = [];
    for (const card of cards || []) {
      if (card.similar) continue;
      if (card.method === 'play') {
        items.push({
          method: 'play',
          title: cardTitleFromCard(card, query.title),
          url: String(card.url || ''),
          quality: cleanedQuality(card.quality),
          translate: card.translate || card.voice_translate || '',
          voice_name: card.voice_translate || card.translate || '',
          type: 'movie',
          subtitles: []
        });
      } else if (card.method === 'call' && card.s == null && card.e == null) {
        // Поток фильтра — резолв через client в провайдере.
        items.push({
          method: 'call',
          title: card.translate || 'Оригінал',
          stream: String(card.stream || ''),
          url: String(card.url || ''),
          voice_name: card.translate || '',
          type: 'movie',
          subtitles: []
        });
      }
    }
    return items;
  }

  /**
   * Серии: items по карточкам `call`/`play` с полями s/e.
   *
   * Skaz-сериалы дают эпизоды на странице сезона в двух видах:
   * - `call` с s/e (alloha/videoseed) — URL требует серверного резолва;
   * - `play` с s/e (veoveo/solntse/kinopub) — готовый CDN-URL серии, резолв
   *   не нужен (провайдер просто проксирует `url`).
   */
  episodeItems(cards, seasonNumber) {
    const items = [];
    for (const card of cards || []) {
      if (card.method !== 'call' && card.method !== 'play') continue;
      if (card.s == null || card.e == null) continue;
      if (seasonNumber != null && Number(card.s) !== Number(seasonNumber)) continue;
      const episode = Number(card.e) || 0;
      items.push({
        method: card.method,
        title: card.name || `Серия ${episode}`,
        episode,
        season: Number(card.s) || 0,
        stream: String(card.stream || ''),
        url: String(card.url || ''),
        voice_name: card.translate || '',
        quality: undefined,
        subtitles: []
      });
    }
    return items.sort((a, b) => (a.episode || 0) - (b.episode || 0));
  }

  /** Заголовок/постер из карточки для records поиска. */
  recordFromCard(card, query = {}, id) {
    return {
      provider: '',
      id: String(id || query.title || ''),
      title: card.title || query.title || '',
      original_title: query.original_title || '',
      year: query.year || 0,
      type: query.serial ? 'serial' : 'movie',
      poster: '',
      metadata: {
        id: paramNumber(card.url, 'id'),
        imdb_id: paramString(card.url, 'imdb_id'),
        kinopoisk_id: paramString(card.url, 'kinopoisk_id'),
        voice_translate: card.translate || ''
      }
    };
  }
}

/** Числовый query-параметр из URL карточки. */
export function paramNumber(url, key) {
  const value = paramValue(url, key);
  if (value == null) return null;
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) ? num : null;
}

export function paramValue(url, key) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(new RegExp(`[?&]${escapeRegExp(key)}=([^&]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Строковый query-параметр из URL карточки (?key=value). */
export function paramString(url, key) {
  const value = paramValue(url, key);
  return value == null ? '' : String(value);
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function voiceName(card, t) {
  // Для rezka t-переводов название — текст кнопки; иначе — translate.
  return card._text || card.translate || `перевод ${t}`;
}

function cardTitleFromCard(card, fallback = '') {
  // У filmix `title` = «Фильм (Перевод)», а `_text`-кнопка — только перевод
  // («Дубляж [Русский]») — именно его Lampa показывает в карточке источника.
  const name = String(card._text || card.title || card.translate || '').trim();
  return name || fallback;
}

function cleanedQuality(map) {
  const quality = {};
  for (const [label, url] of Object.entries(map || {})) {
    if (url && typeof url === 'string') quality[label] = url;
  }
  return quality;
}

function parseCardJson(raw) {
  try {
    const card = JSON.parse(raw);
    if (card && typeof card === 'object' && !Array.isArray(card)) return card;
  } catch {
    // Некоторые источники кладут в data-json не-JSON (например `null`).
  }
  return null;
}

/**
 * Заголовок карточки (перевод/серия/сезон). Приоритет — инлайн-текст
 * рядом с маркером (кнопка перевода: `data-json='…'>Оригинал …</div>`),
 * затем заголовок внутри карточки `.videos__item-title`/`.videos__season-title`
 * (ищем в узком окне сразу за маркером, не залезая в следующую карточку).
 */
function nearbyText(html, fromIndex, markerLength) {
  const tail = html.slice(fromIndex + markerLength, fromIndex + markerLength + 400);

  const inline = tail.match(/^\s*>([^<]{1,120})<\/div>/);
  if (inline) {
    const text = stripHtml(String(inline[1]).trim());
    if (text) return text;
  }

  // Окно до следующего маркера карточки (или закрывающего </div> корня).
  const nextCard = tail.indexOf('data-json');
  const bounded = nextCard === -1 ? tail : tail.slice(0, nextCard);
  const titled = bounded.match(/videos__(?:item|season)-title[^>]*>\s*([^<]{1,120})<\//);
  if (titled) {
    const text = stripHtml(String(titled[1]).trim());
    if (text) return text;
  }
  return '';
}

function stripHtml(input) {
  return String(input).replace(/<[^>]*>/g, '');
}