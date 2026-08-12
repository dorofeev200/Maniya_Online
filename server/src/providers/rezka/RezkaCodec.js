import { createHash } from 'node:crypto';

/**
 * Чистые функции протокола HDRezka (без сети) — контракт из Lampac
 * `Modules/OnlinePaid/Rezka/Service.cs` и `AnubisFast.cs`.
 *
 * Поле `url` из `get_movie`/`get_stream` — base64 с мусором (`#h`, `//_//`,
 * trashList). После `decodeBase64` получаем
 * `[1080p]https://... or [720p]https://... ,[480p]https://...`
 * (` or ` = резервная ссылка, `,` = качества).
 */

// Trash-токены из Lampac Service.cs (trashListBase / trashListOld).
const TRASH_LIST_BASE = [
  'JCQhIUAkJEBeIUAjJCRA', 'QEBAQEAhIyMhXl5e', 'IyMjI14hISMjIUBA',
  'Xl5eIUAjIyEhIyM=', 'JCQjISFAIyFAIyM='
];

const TRASH_LIST_OLD = [
  'QEA=', 'QCM=', 'QCE=', 'QF4=', 'QCQ=', 'I0A=', 'IyM=', 'IyE=',
  'I14=', 'IyQ=', 'IUA=', 'ISM=', 'ISE=', 'IV4=', 'ISQ=', 'XkA=',
  'XiM=', 'XiE=', 'Xl4=', 'XiQ=', 'JEA=', 'JCM=', 'JCE=', 'JF4=',
  'JCQ=', 'QEBA', 'QEAj', 'QEAh', 'QEBe', 'QEAk', 'QCNA', 'QCMj',
  'QCMh', 'QCNe', 'QCMk', 'QCFA', 'QCEj', 'QCEh', 'QCFe', 'QCEk',
  'QF5A', 'QF4j', 'QF4h', 'QF5e', 'QF4k', 'QCRA', 'QCQj', 'QCQh',
  'QCRe', 'QCQk', 'I0BA', 'I0Aj', 'I0Ah', 'I0Be', 'I0Ak', 'IyNA',
  'IyMj', 'IyMh', 'IyNe', 'IyMk', 'IyFA', 'IyEj', 'IyEh', 'IyFe',
  'IyEk', 'I15A', 'I14j', 'I14h', 'I15e', 'I14k', 'IyRA', 'IyQj',
  'IyQh', 'IyRe', 'IyQk', 'IUBA', 'IUAj', 'IUAh', 'IUBe', 'IUAk',
  'ISNA', 'ISMj', 'ISMh', 'ISNe', 'ISMk', 'ISFA', 'ISEj', 'ISEh',
  'ISFe', 'ISEk', 'IV5A', 'IV4j', 'IV4h', 'IV5e', 'IV4k', 'ISRA',
  'ISQj', 'ISQh', 'ISRe', 'ISQk', 'XkBA', 'XkAj', 'XkAh', 'XkBe',
  'XkAk', 'XiNA', 'XiMj', 'XiMh', 'XiNe', 'XiMk', 'XiFA', 'XiEj',
  'XiEh', 'XiFe', 'XiEk', 'Xl5A', 'Xl4j', 'Xl4h', 'Xl5e', 'Xl4k',
  'XiRA', 'XiQj', 'XiQh', 'XiRe', 'XiQk', 'JEBA', 'JEAj', 'JEAh',
  'JEBe', 'JEAk', 'JCNA', 'JCMj', 'JCMh', 'JCNe', 'JCMk', 'JCFA',
  'JCEj', 'JCEh', 'JCFe', 'JCEk', 'JF5A', 'JF4j', 'JF4h', 'JF5e',
  'JF4k', 'JCRA', 'JCQj', 'JCQh', 'JCRe', 'JCQk'
];

// Строгий base64: Lampac использует TryFromBase64String, который кидает на
// мусоре. Node lenient, поэтому валидируем round-trip.
function b64decode(value) {
  const input = String(value ?? '').replace(/\s+/g, '');
  if (!input) return null;
  if (/[^A-Za-z0-9+/=]/.test(input)) return null;

  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  const buffer = Buffer.from(padded, 'base64');
  if (buffer.length === 0) return null;

  const canonical = buffer.toString('base64').replace(/=+$/, '');
  if (canonical !== input.replace(/=+$/, '')) return null;
  return buffer.toString('utf8');
}

/**
 * `data` — закодированный `url` (начинается с `#`). Снимает префикс, удаляет
 * trash-токены и `//`-разделители, декодирует base64 → `[quality]url,...`.
 */
export function decodeBase64(data) {
  if (typeof data !== 'string' || !data.startsWith('#')) return String(data ?? '');

  // 1) снимаем префикс `#h`, вычилаем trashListBase
  let working = data.slice(2);
  for (const trash of TRASH_LIST_BASE) {
    working = working.split(`//_//${trash}`).join('');
  }
  let decoded = b64decode(working);
  if (decoded != null) return decoded;

  // 2) остаточный мусор вида `//xxx_//` + `//_//`
  working = working.replace(/\/\/[^/]+_\/\//g, '').replace(/\/\/_\/\//g, '');
  decoded = b64decode(working);
  if (decoded != null) return decoded;

  // 3) последний проход по trashListOld
  working = data.slice(2).replace(/\/\/_\/\//g, '');
  for (const trash of TRASH_LIST_OLD) {
    working = working.split(trash).join('');
  }
  working = working.replace(/\/\/[^/]+_\/\//g, '').replace(/\/\/_\/\//g, '');
  decoded = b64decode(working);
  return decoded != null ? decoded : String(data ?? '');
}

// Даунгрейд качества из Lampac getStreamLink (realq).
const REAL_QUALITY = {
  '2160p': '2160p',
  '1440p': '1440p',
  '1080p Ultra': '1080p',
  '1080p': '720p',
  '720p': '480p',
  '480p': '360p',
  '360p': '360p'
};

function normalizeQualityLabel(label) {
  // "1080р" (кириллица) и лишние пробелы → нормализуем
  return String(label || '').trim().toLowerCase().replace(/р/g, 'p');
}

function asHls(url, hls) {
  if (url.endsWith('.m3u8')) return url;
  return hls ? `${url}:hls:manifest.m3u8` : url;
}

/**
 * `[quality]url,...` (после decodeBase64) → упорядоченный список
 * `{ quality, url }`. Берём первую ссылку каждого качества (резерв ` or `
 * опускаем — подключается при недоступности основной). Опции: premium
 * (включает 4K/2K/1080p Ultra), hls (дописывает `:hls:manifest.m3u8`),
 * http (https→http).
 */
// Алиасы качества: Rezka иногда метит 4K/2K вместо 2160p/1440p (Lampac getLink).
const QUALITY_ALIASES = {
  '2160p': ['2160p', '4k', '4к'],
  '1440p': ['1440p', '2k', '2к'],
  '1080p': ['1080p', '1080p ultra']
};

function qualityMatches(entryQuality, want) {
  const aliases = (QUALITY_ALIASES[want] || [want]).map(normalizeQualityLabel);
  return aliases.includes(entryQuality);
}

export function getStreamLink(encoded, opts) {
  return getStreamLinks(decodeBase64(encoded), opts);
}

export function getStreamLinks(decoded, { premium = false, hls = true, http = false } = {}) {
  if (!decoded) return [];

  // Формат: `[quality]url,[quality]url,...` (иногда с пробелом после запятой).
  const entries = [];
  const re = /\[([^\]]+)\]\s*[\s\S]*?(?=\[[^\]]+\]|$)/g;
  let m;
  while ((m = re.exec(String(decoded)))) {
    const quality = normalizeQualityLabel(m[1]);
    const url = (m[0].replace(/\[[^\]]+\]\s*/, '').replace(/,\s*$/, '') || '').trim();
    if (quality && url) entries.push({ quality, url });
  }

  const preferred = premium
    ? ['2160p', '1440p', '1080p Ultra', '1080p', '720p', '480p', '360p']
    : ['1080p', '720p', '480p', '360p'];

  const result = [];
  for (const want of preferred) {
    const entry = entries.find((e) => qualityMatches(e.quality, want));
    if (!entry) continue;

    // Первая ссылка качества (резерв ` or ` опускаем — подключается при недоступности).
    const primary = entry.url.split(' or ')[0].trim();
    if (!/^https?:\/\//i.test(primary)) continue;

    let url = asHls(primary, hls);
    if (http) url = url.replace(/^https:/, 'http:');
    result.push({ quality: REAL_QUALITY[want] || want, url });
  }
  return result;
}

// --- HTML-парсинг (поиск, embed, episodes) ---

/**
 * Парсинг HTML поиска (`/search/?do=search...`). Блоки `b-content__inline_item`.
 * Режем по `"b-content__inline_item"` (с кавычками), как Lampac — иначе
 * `b-content__inline_item-cover`/`-link` дробят блок посередине.
 */
export function parseSearchHtml(html) {
  const items = [];
  const blocks = String(html || '').split('"b-content__inline_item"').slice(1);
  for (const block of blocks) {
    const link = block.match(/<a\s+[^>]*href=["']([^"']+\.html)["']/);
    if (!link) continue;

    // Название — из text-контента якоря на .html (без вложенных тегов;
    // `[^<]` отбрасывает cover-якорь с <img>, оставляя ссылку заголовка),
    // фолбэк — на alt постера.
    const titleAnchor = block.match(/<a\s+[^>]*href=["'][^"']+\.html["'][^>]*>([^<]{1,160})<\/a>/);
    const title = (titleAnchor ? titleAnchor[1].trim() : '')
      || (block.match(/<(?:img|source)\b[^>]*\balt=["']([^"']+)["']/) || [])[1] || '';
    if (!title) continue;

    const year = (block.match(/\b(19|20)\d{2}\b/) || [])[0] || null;
    const poster = (block.match(/<(?:img|source)\b[^>]*\bsrc=["']([^"']+)["']/) || [])[1] || null;
    const serial = /\b(?:cartoons|series|animation|serials)\//.test(block);
    items.push({ href: link[1], title, year, poster, serial });
  }
  return items;
}

/** Из href вида `.../26246-something.html` → id. */
export function extractItemId(href) {
  const m = String(href || '').match(/(\d+)-[^/]*\.html$/);
  return m ? m[1] : null;
}

/**
 * Embed HTML (`/{href}.html`) → `{ id, isSerial, translators, cdnStreams, favs }`.
 * `translators` = `{ name: id }` из `data-translator_id`.
 * `cdnStreams` = base64-поток из `"id":"cdnplayer","streams":"..."` (фильм без
 * переводов), либо null.
 * `favs` = значение `id="ctrl_favs" value="..."` (требуется для get_movie AJAX).
 *
 * Для фильмов секция переводчиков изолируется как в Lampac:
 * `ctrl_token_id` → `translators-list` → только этот блок. Если `ctrl_token_id`
 * на странице нет (старые фикстуры/нетипичная вёрстка) — ищем по всему HTML.
 */
export function parseEmbedHtml(html) {
  const source = String(html || '');
  const isSerial = /data-season_id=|\.initCDNSeriesEvents\(/.test(source);

  // Область поиска переводчиков: для фильмов — секция translators-list
  // (как Lampac Embed: split ctrl_token_id → split translators-list);
  // для сериалов — весь HTML (парсинг и так находит).
  let contentSection = source;

  if (!isSerial) {
    const ctrlParts = source.split('ctrl_token_id');
    if (ctrlParts.length > 1) {
      const tlParts = ctrlParts[1].split('translators-list');
      if (tlParts.length > 1) {
        contentSection = tlParts[1];
      }
    }
  }

  // favs — из контентной секции (для фильмов — внутри translators-list,
  // для сериалов — со всей страницы). Lampac Tpl извлекает его там же,
  // где ищет переводчиков.
  const favsMatch = contentSection.match(/id="ctrl_favs"\s+value="([^"]*)"/);
  const favs = favsMatch ? favsMatch[1] : '';

  const translators = {};
  // Охватываем весь элемент переводчика (внутри могут быть вложенные теги),
  // затем выдираем из него видимый текст.
  const re = /data-translator_id="(\d+)"[^>]*>([\s\S]*?)<\/[a-z]+>/g;
  let m;
  while ((m = re.exec(contentSection))) {
    const id = m[1];
    const name = (m[2] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (name && !Object.values(translators).includes(id)) translators[name] = id;
  }

  // cdnStreams — ищется по всему HTML (не только в секции переводчиков).
  const cdn = source.match(/"id":"cdnplayer",\s*"streams":"([^"]+)"/);
  const cdnStreams = cdn ? cdn[1].replace(/\\/g, '').trim() : null;

  return {
    id: extractItemId(source.match(/<link\s+rel="canonical" href="([^"]+)"/)?.[1] || ''),
    isSerial,
    translators,
    cdnStreams,
    favs
  };
}

/** `get_episodes` → `{ seasons:[{number,title}], episodes:[{season,episode,title}] }`. */
export function parseEpisodesHtml(seasonsHtml, episodesHtml) {
  const seasons = [];
  const reSeason = /data-tab_id="(\d+)"[^>]*>([^<]+)</g;
  let m;
  while ((m = reSeason.exec(String(seasonsHtml || '')))) {
    seasons.push({ number: Number(m[1]), title: (m[2] || '').trim() });
  }

  const episodes = [];
  const reEp = /data-season_id="(\d+)"[^>]*data-episode_id="(\d+)"[^>]*>([^<]+)</g;
  while ((m = reEp.exec(String(episodesHtml || '')))) {
    episodes.push({
      season: Number(m[1]),
      episode: Number(m[2]),
      title: (m[3] || '').trim()
    });
  }
  return { seasons, episodes };
}

/** `subtitle` HTML → `[{ label, url }]` (формат `[label]https://...vtt`). */
export function parseSubtitleHtml(html) {
  const subs = [];
  const re = /\[([^\]]+)\](https?:\/\/[^\s,'"]+\.vtt)/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    subs.push({ label: m[1].trim(), url: m[2].trim() });
  }
  return subs;
}

// --- Anubis (SHA-256 PoW) ---

export function hasAnubisChallenge(html) {
  return /anubis_challenge/i.test(String(html || ''));
}

/** difficulty = число старших нулевых бит хэша (AnubisFast.HasRequiredDifficulty). */
function hasDifficulty(hashBytes, difficulty) {
  const fullZero = Math.floor(difficulty / 2);
  for (let i = 0; i < fullZero; i += 1) {
    if (hashBytes[i] !== 0) return false;
  }
  if (difficulty % 2 === 1) {
    return (hashBytes[fullZero] & 0xf0) === 0;
  }
  return true;
}

/**
 * Решение Anubis: nonce, где SHA256(randomData + nonce) имеет `difficulty`
 * старших нулевых бит. Возвращает `{ id, response, nonce }` либо null.
 * Node-эквивалент AnubisFast.SolveAsync (алгоритм `fast`).
 */
export function solveAnubisChallenge(html) {
  const source = String(html || '');
  const mC = source.match(/\bid\s*=\s*["']anubis_challenge["'][^>]*>([^<]+)/);
  if (!mC) return null;

  let payload;
  try {
    payload = JSON.parse(mC[1].trim());
  } catch {
    return null;
  }

  const ch = payload?.challenge;
  const rules = payload?.rules;
  if (rules?.algorithm !== 'fast') return null;
  if (!ch?.id || !ch?.randomData) return null;
  const difficulty = Number(rules?.difficulty);
  if (!Number.isInteger(difficulty) || difficulty <= 0 || difficulty > 32) return null;

  const prefix = Buffer.from(ch.randomData, 'utf8');
  let nonce = 0n;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const nonceStr = String(nonce);
    const hash = createHash('sha256')
      .update(Buffer.concat([prefix, Buffer.from(nonceStr, 'utf8')]))
      .digest();
    if (hasDifficulty(hash, difficulty)) {
      return { id: ch.id, response: hash.toString('hex'), nonce: nonceStr };
    }
    nonce += 1n;
    if (nonce > 0xffffffffn) return null;
  }
}

/** pass-challenge URL (AnubisFast.Result.BuildPassUrl). */
export function buildPassChallengeUrl(siteOrigin, challenge, redir) {
  const params = new URLSearchParams({
    id: challenge.id,
    response: challenge.response,
    nonce: challenge.nonce,
    redir: redir || '',
    elapsedTime: '1'
  });
  return `${siteOrigin}/.within.website/x/cmd/anubis/api/pass-challenge?${params.toString()}`;
}
