import { config } from './config.js';
import { registeredProviders, twinFor } from './providers/registry.js';
import { HttpError } from './errors.js';
import { orderedSkazHosts, isReserveHost } from './providers/skaz/hostOrder.js';

/**
 * BALANCER-002 — per-card source availability (`/api/lampa/sources/card`).
 *
 * Копия динамики E-Online/Lampac (см. docs/balancer-001-audit.md §6): вместо
 * статического реестра — параллельный `checksearch=true` по каждому видимому
 * skaz-балансеру, предикат «карточка есть» (data-json/type/rch), кэш 5 минут.
 *
 * Отличия от SkazClient (намеренные, не трогаем существующую videos()-логику):
 * - ЕДИНЫЙ per-card availability для native + skaz + СКРЫТЫЙ твин (BALANCER-002
 *   POST-DEPLOY, docs/balancer-002-postdeploy-report.md §7): «native → всегда
 *   show:true» УБРАНО. native с hidden twin проверяется через свой twin-балансер
 *   (тот же skaz-checksearch, что использует E-Online для этого балансера) —
 *   твин в ответ не попадает (без дублей в UI), но его вердикт решает
 *   видимость native; native БЕЗ твина (cdnvideohub, collaps) — native search-level
 *   probe: пустой результат при НАЛИЧИИ карточного ключа → «нет» (show:false),
 *   отсутствие ключа / ошибка / таймаут / неоднозначный результат → inconclusive
 *   → показываем. `provider.videos()`/`resolveVideo()`/store.js НЕ менялись —
 *   availability определяет только видимость, не воспроизведение;
 * - TRUSTED_ALWAYS_VISIBLE — provider-specific исключение: filmix — доверенный
 *   источник (playback проверен; публичный lite/filmix checksearch НЕ воспроизводит
 *   внутренний checkSearch E-Online; E-Online стабильно его показывает) → всегда
 *   show:true без пробы. Остальные native/skaz/twin — per-card как выше. Другим
 *   провайдерам правило НЕ распространяется (каждому — отдельное доказательство);
 * - предикат checkSearch — ТОЧНЫЙ как в Lampac OnlineApi.cs:975
 *   (`work = rch || data-json= || "type":"movie|episode|season"`), а НЕ
 *   `isUsablePage` (rch-ответ в E-Online считается ДОСТУПНЫМ, у нас — тоже,
 *   но только как диагностика: такие источники в видимый список не входят);
 * - хосты: primary (online3 + 94.249.*) первыми, online8 — РЕЗЕРВ в конце
 *   (легаси-нода, другой плагин-универсум, docs/balancer-001-audit.md §4);
 * - 2xx content-bearing ответ авторитетен (стоп); 2xx «нет источника»
 *   (null/disable/false/not found) и не-2xx (403/404/503/5xx) — кластер ОТВЕТИЛ
 *   «нет» → хост ниже; таймаут/сеть/accsdb (ответа нет / отказ учётки) — вердикта
 *   НЕТ → показываем оптимистично (не прячем рабочий источник из-за транзиентного
 *   тормоза кластера или отказа авторизации: accsdb — «Войдите в аккаунт», это
 *   НЕ доказательство отсутствия контента);
 * - каждый балансер изолирован (Promise.allSettled): сбой одного не ломает других.
 *
 * Кэш: Fnv1a(id:serial:source:count:uid) — как memkey Lampac, TTL 5 мин, lazy sweep
 * ≤512 (конвенция SkazProvider._navCache). BALANCER-STABILITY-002: INCONCLUSIVE-ряды
 * (таймаут/сеть) НЕ блокируют кэширование — карточка кэшируется всегда, с сохранением
 * фактического вердикта каждой строки (AVAILABLE/UNAVAILABLE/INCONCLUSIVE — три разных
 * состояния, `inconclusive`-флаг остаётся в ряду); на hit возвращается тот же набор.
 * Entry с inconclusive помечается hasInconclusive → НЕ definitive (self-heal по TTL/force).
 * Подтверждённый «нет» кэшируется КОРОЧЕ (HIDE_TTL_MS = 60с): даже три согласных
 * «нет» под окном насыщения не должны висеть на рабочем источнике 5 минут — self-heal.
 *
 * КРИТИЧЕСКИЙ ГЕЙТ (SHADOW/COMPARE): «нет» от checksearch — только гипотеза, её
 * подтверждаем прямым lite-page (без checksearch) — тем механизмом, что реально играет
 * контент (OLD videos()). Источник прячем только при «нет» от ОБОИХ сигналов. Причина:
 * поиск умеет флакать под нагрузкой кластера (у kinopub контент на online8 через
 * 302-туннель; под 18-ю параллельными запросами online8 на миг отвечал 503/null, хотя
 * OLD videos() находил items — провал OLD∩NEW гейта, Run 4). Подтверждённый «нет»
 * дополнительно перепроверяется с retry-with-backoff (confirmWithBackoff) — окно
 * насыщения успевает отойти; выживший «нет» = три независимых сигнала. Подтверждённые
 * ряды помечаются `confirmed` (и `retried` при повторе) и кэшируются на HIDE_TTL_MS.
 *
 * NATIVE-AVAILABILITY-002 (docs/native-availability-001-report.md — 4 доказанных false-positive):
 *   RULE-1  Предикат извлекает data-json-карточки и различает контент по method/type:
 *           `method:call/play` или type movie/episode/season → доступен; `method:link` —
 *           сравнение title/KP/год с запрошенным фильмом: совпало → доступен, ЧУЖОЙ
 *           title/KP/год → authoritative «нет»; данных недостаточно → inconclusive (показ).
 *           Substring `data-json=` УБРАН: similar-link-карточка на ДРУГОЙ тайтл
 *           (kodik → «Бесконечная Одиссея капитана Харлока», kinopub → сериал 1997) — не контент.
 *   RULE-2  accsdb с msg «Ожидаем фильм в хорошем качестве...» = «контента пока нет» →
 *           authoritative «нет» (как non-content хост); прочие accsdb — по-прежнему
 *           «вердикта нет» (inconclusive, показ).
 *   RULE-3  native без карточного ключа (cdnvideohub: key ТОЛЬКО kinopoisk_id, которого в
 *           реальном Lampa-запросе НЕТ, а кластерного балансера нет) → authoritative «нет»,
 *           а НЕ вечный inconclusive-show.
 *   RULE-4  Дедлайн/таймаут НЕ переворачивают полученное «нет» в показ: fallback show:true —
 *           только когда definitive ответа вообще не было. «Нет» от ЧИСТОГО ответа всех
 *           хостов сохраняется даже при исчерпании дедлайна (инконклюзивное подтверждение
 *           не переворачивает первичное «нет»). СМЕШАННЫЙ вердикт (часть хостов «нет» +
 *           часть не ответила) = действительно inconclusive → показ (защита рабочих
 *           источников: rutubemovie 503+abort, но 11 items).
 */

const TTL_MS = 5 * 60 * 1000;
// Подтверждённый «нет» (двойная проверка) кэшируется КОРОЧЕ: даже с retry окно
// насыщения online8-туннеля умеет отвечать «нет» на оба сигнала разом, и скрытие
// живого источника должно self-heal за минуту, а не висеть 5 минут (эмпирический
// кейс 2026-08-13: OLD items>0, а NEW скрыл на 5 мин после тяжёлого shadow-прогона).
const HIDE_TTL_MS = 60 * 1000;
const DEFAULT_HOST = 'http://online3.skaz.tv';
const NON_CONTENT_FIRST_LINE = new Set(['null', 'disable', 'false', 'not found']);

// BALANCER-SEMANTICS-005-W1 (фикс (a)): порядок пула переехал в общий
// hostOrder.js `orderedSkazHosts` (online8 ПОСЛЕДНИЙ) — ОДИН источник правды
// для карточки (здесь) и SkazClient.getLite (/videos). Раньше reorderHosts
// применялся только в availability, а клиент брал сырой config.skaz.hosts
// (online8 ВТОРОЙ) → карточка и /videos обходили ноды в разном порядке.
// isReserveHost импортируется из того же модуля (нужен probe: abstain-политика
// online8, BAALANCER-ONLINE8-002).

/** Сопоставимы ли названия по алфавиту (кириллица↔кириллица / латиница↔латиница). */
function comparableScripts(a, b) {
  const aCyr = /[Ѐ-ӿ]/.test(String(a));
  const bCyr = /[Ѐ-ӿ]/.test(String(b));
  const aLat = /[a-z]/i.test(String(a));
  const bLat = /[a-z]/i.test(String(b));
  return (aCyr && bCyr) || (aLat && bLat);
}

/** Нижний регистр, без пунктуации/пробелов (для сравнения названий). */
function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Извлечь все data-json-карточки из HTML-ответа кластера. Реальные тела Lampac
 * используют `data-json="{...}"` с кавычками (иногда `data-json='{...}'` или
 * экранированные сущности), поэтому значение ищется сбалансированными скобками
 * с учётом строк и экранирования — кавычки атрибута не ломают парсинг.
 */
function extractDataJsonCards(html) {
  const cards = [];
  const raw = String(html || '');
  let pos = 0;
  while (true) {
    const idx = raw.indexOf('data-json', pos);
    if (idx === -1) break;
    const brace = raw.indexOf('{', idx + 'data-json'.length);
    if (brace === -1 || brace > idx + 200) { pos = idx + 9; continue; }
    let depth = 0;
    let inStr = false;
    let strQ = '';
    let closed = -1;
    for (let j = brace; j < raw.length; j += 1) {
      const c = raw[j];
      if (inStr) {
        if (c === '\\') { j += 1; continue; }
        if (c === strQ) inStr = false;
        continue;
      }
      if (c === '"' || c === "'") { inStr = true; strQ = c; continue; }
      if (c === '{') depth += 1;
      else if (c === '}') { depth -= 1; if (depth === 0) { closed = j; break; } }
    }
    if (closed === -1) { pos = idx + 9; continue; }
    const value = raw.slice(brace, closed + 1);
    pos = closed + 1;
    let parsed = null;
    try { parsed = JSON.parse(value); }
    catch {
      try {
        // HTML-сущности (data-json="{&quot;method&quot;:...}") — декодируем и пробуем снова.
        parsed = JSON.parse(value
          .replace(/&quot;/g, '"').replace(/&#34;/g, '"')
          .replace(/&apos;/g, "'").replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
      } catch { parsed = null; }
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cards.push(parsed);
    else cards.push({ __unparsed: true });
  }
  return cards;
}

/** Идентификаторы из url link-карточки (реальные kp/imdb, не эхо параметров запроса). */
function linkTargetIds(url) {
  let kp = 0;
  let imdb = '';
  try {
    const parsed = new URL(String(url || ''));
    kp = Number(parsed.searchParams.get('kinopoisk_id') || parsed.searchParams.get('kp') || 0) || 0;
    imdb = String(parsed.searchParams.get('imdb_id') || '').trim().toLowerCase();
  } catch { /* url не парсится — идентификаторов нет */ }
  return { kp, imdb };
}

/**
 * RULE-1: классификация link-карточки против запрошенного фильма.
 *  - совпавший KP/IMDb/title → контент;
 *  - чужой KP/IMDb/title/год → другой фильм (definitive absent);
 *  - данных недостаточно → inconclusive.
 */
function classifyLinkCard(card, query) {
  const cardTitle = normalizeTitle(card.title);
  const cardYear = Number(card.year) || 0;
  const { kp, imdb } = linkTargetIds(card.url);

  const qKp = Number(query.kinopoisk_id || query.kp || 0) || 0;
  const qImdb = String(query.imdb_id || query.imdb || '').trim().toLowerCase();
  const qYear = Number(query.year) || 0;
  const qTitle = normalizeTitle(query.title);
  const qOriginalTitle = normalizeTitle(query.original_title);

  // Идентификаторы: чужой → чужой фильм; совпавший → контент.
  if (kp && qKp && kp !== qKp) return 'absent';
  if (imdb && qImdb && imdb !== qImdb) return 'absent';
  if (kp && qKp && kp === qKp) return 'content';
  if (imdb && qImdb && imdb === qImdb) return 'content';

  // Title (только сопоставимые алфавиты): точное совпадение → контент; чужой → чужой фильм.
  const titleText = qTitle || qOriginalTitle;
  const comparable = cardTitle && titleText && comparableScripts(cardTitle, titleText);
  const titleMatch = comparable && (cardTitle === qTitle || cardTitle === qOriginalTitle);
  if (titleMatch) return 'content';

  // Составной title «RU / EN» (GAP-005): части сравниваются ПО ОТДЕЛЬНОСТИ, а не склейкой
  // normalizeTitle («интерстелларinterstellar» ≠ «интерстеллар»). Часть ТОЧНО совпала с
  // запрошенным названием И год совпал → контент. Нужно для kinopub-link-карточек без
  // kp/imdb (только postid), где реальная карточка искомого фильма имеет составной title.
  // Точное равенство частей (а не подстрока) сохраняет защиту от decoy-карточек:
  // «Наука Интерстеллар / The Science of Interstellar» и «Последний дом слева / …»
  // частями не совпадают и остаются absent даже при совпавшем годе.
  const compoundParts = String(card.title || '')
    .split('/')
    .map((part) => normalizeTitle(part))
    .filter(Boolean);
  if (compoundParts.length > 1) {
    const partMatched = compoundParts.some(
      (part) => part === qTitle || part === qOriginalTitle
    );
    if (partMatched && cardYear > 0 && qYear > 0 && cardYear === qYear) return 'content';
  }

  if (comparable && !titleMatch) return 'absent';

  // Год: чужой → чужой фильм; совпал → контент (слабое совпадение, но по ТЗ RULE-1).
  const yearKnown = cardYear > 0 && qYear > 0;
  if (yearKnown && cardYear !== qYear) return 'absent';
  if (yearKnown && cardYear === qYear) return 'content';

  return 'inconclusive';
}

/**
 * RULE-1: предикат checkSearch (основа Lampac OnlineApi.cs:975), но вместо substring
 * `data-json=` — извлечение карточек и разбор method/type. `method:call/play` или
 * type movie/episode/season → доступен; `method:link` → сравнение с запрошенным фильмом
 * (classifyLinkCard); карточек нет → «нет» на этой ноде; карточка есть, но не
 * классифицирована → inconclusive (показываем). `rch` — как в Lampac («доступен»).
 * Вердикт: 'content' | 'absent' | 'inconclusive'.
 */
export function checkSearchPredicate(text, query = {}) {
  const raw = String(text || '');
  const rch = /"rch"\s*:\s*true/i.test(raw);

  const cards = extractDataJsonCards(raw);
  let sawContent = false;
  let sawAbsent = false;
  let sawInconclusive = false;
  for (const card of cards) {
    if (card.__unparsed) { sawInconclusive = true; continue; }
    const method = String(card.method || '').toLowerCase();
    const type = String(card.type || '').toLowerCase();
    if (method === 'play' || method === 'call' || ['movie', 'episode', 'season'].includes(type)) {
      sawContent = true;
    } else if (method === 'link') {
      const verdict = classifyLinkCard(card, query);
      if (verdict === 'content') sawContent = true;
      else if (verdict === 'absent') sawAbsent = true;
      else sawInconclusive = true;
    } else {
      sawInconclusive = true;
    }
  }
  // Тело целиком — bare JSON-объект карточки (без data-json-обёртки), только если у него
  // есть method: play/call → контент; link → classifyLinkCard (чужой фильм → «нет»);
  // без method (accsdb/ошибка) → как раньше, карточек нет → «нет» на этой ноде.
  if (cards.length === 0 && /^\s*\{/.test(raw)) {
    let top = null;
    try { top = JSON.parse(raw); } catch { top = null; }
    if (top && typeof top === 'object' && !Array.isArray(top)) {
      const method = String(top.method || '').toLowerCase();
      const type = String(top.type || '').toLowerCase();
      if (method === 'play' || method === 'call' || ['movie', 'episode', 'season'].includes(type)) {
        sawContent = true;
      } else if (method === 'link') {
        const verdict = classifyLinkCard(top, query);
        if (verdict === 'content') sawContent = true;
        else if (verdict === 'absent') sawAbsent = true;
        else sawInconclusive = true;
      }
    }
  }

  const typeMarker = raw.includes('"type":"movie"')
    || raw.includes('"type":"episode"')
    || raw.includes('"type":"season"');

  let work;
  let verdict;
  if (rch || sawContent || typeMarker) {
    work = true;
    verdict = 'content';
  } else if (sawInconclusive) {
    // Карточка есть (data-json или bare-JSON), но не классифицирована — вердикта нет.
    work = true;
    verdict = 'inconclusive';
  } else {
    // Карточек нет вовсе — «нет источника» на этой ноде (authoritative).
    work = false;
    verdict = 'absent';
  }

  let quality = '';
  const qMark = raw.match(/<!--q:([^>]+)-->/);
  if (qMark) quality = String(qMark[1]).trim();
  else if (raw.includes('"2160p"') || raw.includes('2160p')) quality = '2160p';
  else if (/\bHDR\b/i.test(raw)) quality = 'HDR';

  return { work, rch, quality, verdict };
}

/** Запрос сериала (та же сигнатура, что SkazProvider.serialQuery). */
export function isSerialQuery(query = {}) {
  const serial = String(query.serial ?? '').trim();
  return serial === '1' || serial === 'true' || serial === 'yes'
    || String(query.type || '').toLowerCase() === 'serial'
    || String(query.serial_type || '').toLowerCase() === 'serial';
}

/** Fnv1a-32 → строка → base64url (как memkey Lampac). Ключ кэша, не крипто. */
export function fnv1aKey(text) {
  const input = String(text || '');
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Buffer.from(String(hash >>> 0)).toString('base64url');
}

/**
 * TRUSTED_ALWAYS_VISIBLE — provider-specific policy (docs/balancer-002-shadow-report.md §10
 * вариант A; финальный отчёт docs/balancer-002-trusted-always-visible-report.md).
 *
 * Filmix считается доверенным стабильным источником Maniya и НЕ проходит per-card
 * availability:
 *  - playback filmix уже проверен (live: play-карточки 2160p/HLS через прокси);
 *  - публичный `lite/filmix` checksearch НЕ воспроизводит внутренний checkSearch
 *    E-Online: filmix/Seven-Per-Cent — кластер честно отвечает «нет» на всех формах
 *    и всех хостах (503/403 disable/пусто), при этом EO-плагин на той же ноде через
 *    свой lite/events стабильно отвечает «есть» (расхождение источников истины,
 *    docs/balancer-002-postdeploy-shadow-report.md §6);
 *  - E-Online стабильно показывает filmix при свежих проверках.
 * Скрывать filmix из-за false-negative availability считается неправильным →
 * всегда show:true.
 * Другим провайдерам правило НЕ распространяется (каждому — отдельное доказательство).
 * `provider.videos()`/`resolveVideo()`/playback НЕ затрагиваются — доступность решает
 * только видимость.
 */
// Фильм-источник «Filmix» может светиться как native `filmix` (обычный случай) либо,
// если native выключен (нет токена), как видимый skaz-близнец `skaz-filmix` — политика
// покрывает ОБЕ формы: это один и тот же Filmix-провайдер, не отдельное исключение.
export const TRUSTED_ALWAYS_VISIBLE = new Set(['filmix', 'skaz-filmix']);

/** Подпадает ли источник под TRUSTED_ALWAYS_VISIBLE (trusted → всегда видим). */
export function isTrustedAlwaysVisible(providerId) {
  return TRUSTED_ALWAYS_VISIBLE.has(String(providerId || ''));
}

/**
 * NATIVE-PROBE — per-card availability для native-провайдера БЕЗ скрытого твина
 * (cdnvideohub, collaps; docs/balancer-002-postdeploy-report.md §5.2, §7).
 *
 * Правила (безопасность на стороне «показать», как в checkBalancer):
 *  - карточного ключа нет: noKeyVerdict='absent' (cdnvideohub, RULE-3) → «нет»
 *    (authoritative); у прочих → inconclusive → show;
 *  - поиск нашёл контент                              → show (authoritative);
 *  - поиск вернул пусто ПРИ НАЛИЧИИ ключа             → «нет» (authoritative);
 *  - сеть/HTTP-ошибка/таймаут/неоднозначный результат → inconclusive → show.
 *
 * НЕ ходим через provider.search(): он глотает ошибки в [] (cdnvideohub.search
 * try/catch вокруг playlist, collaps.search try/catch вокруг поиска) — пустой []
 * неотличим от сетевой ошибки, и по нему прятать нельзя. Вместо этого дергаем
 * глубокие методы (client.playlist / recordByKeys / client.search), которые
 * БРОСАЮТ на сетевой/HTTP-ошибке (HttpError), и ловим сами → вердикта нет.
 * Fallback (незнакомый native) — provider.search() с ключом карточки: []+ключ →
 * «нет»; риск глотания транзиентных ошибок ограничен OLD∩NEW гейтом и
 * HIDE_TTL self-heal.
 */
export const NATIVE_PROBES = {
  // Ключуется ТОЛЬКО по kinopoisk_id: без kp сервис не отвечает (поиска по названию нет).
  // RULE-3: реальный Lampa-запрос kinopoisk_id НЕ содержит (nginx-лог; docs/
  // native-availability-001-report.md §2.3), кластерного балансера для пробы нет
  // (lite/videohub=404, lite/cdnvideohub=503/null) → без kp провайдер не может дать
  // контент для ЭТОЙ карточки → noKeyVerdict='absent' (authoritative «нет», а не вечный
  // inconclusive-show).
  cdnvideohub: {
    hasKey: (query) => Boolean(Number(query.kinopoisk_id || query.kp || 0) || 0),
    noKeyVerdict: 'absent',
    async present(provider, query) {
      const kp = Number(query.kinopoisk_id || query.kp || 0) || 0;
      const root = await provider.client.playlist(kp); // бросает HttpError на ошибке
      return Boolean(Array.isArray(root?.items) && root.items.length);
    }
  },
  // Карточные ключи: kp → imdb → orid (recordByKeys) или поиск по названию.
  collaps: {
    hasKey: (query) => Boolean(
      Number(query.kinopoisk_id || query.kp || 0) || 0
      || String(query.imdb_id || query.imdb || '').trim()
      || Number(query.orid || query.id || 0) || 0
      || String(query.title || '').trim()
    ),
    async present(provider, query, requestContext) {
      const cardKey = Number(query.kinopoisk_id || query.kp || 0) || 0
        || String(query.imdb_id || query.imdb || '').trim()
        || Number(query.orid || query.id || 0) || 0;
      if (cardKey) {
        // recordByKeys: embed-страница → запись или null; бросает HttpError на ошибке.
        const record = await provider.recordByKeys(query, requestContext);
        return Boolean(record);
      }
      // Только название: поиск по списку. Пустой results = «нет».
      const root = await provider.client.search(String(query.title || '').trim()); // бросает на ошибке
      return Boolean(root && Array.isArray(root.results) && root.results.length);
    }
  }
};

function genericCardKey(query = {}) {
  return Boolean(
    String(query.id ?? '').trim()
    || String(query.tmdb_id ?? '').trim()
    || String(query.imdb_id ?? query.imdb ?? '').trim()
    || String(query.kinopoisk_id ?? query.kp ?? '').trim()
    || String(query.title ?? '').trim()
  );
}

// GAP-002: детерминированный отказ контент/embed-хоста (напр. geo/IP-гейт
// `/embed/*` → 422 у collaps). Это операционный факт «из этого деплоя контент
// недоступен», а НЕ транзиентная сетевая ошибка → authoritative «нет» вместо
// inconclusive-показа. 5xx/таймаут/ECONNRESET/ECONNREFUSED/DNS намеренно НЕ входят:
// они оставляют inconclusive (см. nativeProbe catch). Без provider-specific хардкода:
// применимо к любому native-провайдеру, чей контент-хост ответил жёстким отказом.
const HARD_REFUSAL_STATUSES = new Set([403, 422, 451]);

/**
 * Вердикт native-пробы по дедлайну карточки. Возвращает
 * { show, authoritative, inconclusive?, status, reason, error? } — совместимо
 * с probe() (для единого гейта card()).
 */
export async function nativeProbe(provider, query, requestContext, deadline) {
  const id = String(provider?.id || '?');
  const probe = NATIVE_PROBES[id];
  const label = `native:${id}`;
  const attempt = (promise) => {
    const remaining = Math.max(0, deadline - Date.now());
    if (remaining <= 0) {
      // STABILITY-004: дедлайн исчерпан, но `promise` уже ЗАПУЩЕН (аргумент attempt()
      // — это вызов async-функции, он стартует сразу). Нам его результат больше не
      // нужен (attempt всё равно reject'ится «deadline»), но без rejection-consumer
      // его поздний reject (например HttpError 422/403 от probe.present) станет
      // unhandledRejection и УРОНИТ Node-процесс (live: journald 17:34:25,
      // HttpError: Collaps HTTP 422 → exit status=1 → systemd restart). Безопасный
      // no-op catch: вердикт в этой ветке не меняется (attempt не отдаёт его наружу),
      // реальные ошибки не скрываются (они и не доходили бы никуда) — гасим только
      // «никому не нужный» rejection, чтобы процесс пережил поздний reject.
      promise.catch(() => {});
      return Promise.reject(new Error(`${label} deadline`));
    }
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout`)), remaining);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  };
  try {
    if (probe) {
      if (!probe.hasKey(query)) {
        // RULE-3: провайдер без карточного ключа. noKeyVerdict='absent' (cdnvideohub:
        // key ТОЛЬКО kinopoisk_id, в реальном запросе его нет) → authoritative «нет», а
        // НЕ inconclusive-show. Прочие (collaps — ключи kp/imdb/orid/title есть всегда,
        // фактически не попадает) — как раньше: no-key → inconclusive → показ.
        if (probe.noKeyVerdict === 'absent') {
          return { show: false, authoritative: true, status: 0, reason: 'no-key' };
        }
        return { show: true, authoritative: false, inconclusive: true, status: 0, reason: 'no-key' };
      }
      const present = await attempt(probe.present(provider, query, requestContext));
      return { show: Boolean(present), authoritative: true, status: 0, reason: present ? 'found' : 'absent' };
    }
    // Fallback для неизвестного native: search() с ключом карточки.
    if (!genericCardKey(query)) {
      return { show: true, authoritative: false, inconclusive: true, status: 0, reason: 'no-key' };
    }
    const results = await attempt(provider.search(query, requestContext));
    const present = Array.isArray(results) && results.length > 0;
    return { show: Boolean(present), authoritative: true, status: 0, reason: present ? 'found' : 'absent' };
  } catch (error) {
    // GAP-002: детерминированный отказ контент/embed-хоста (403/422/451) —
    // authoritative «нет» (host-block). Не транзиентный сбой: это стабильный
    // гео/IP-гейт хоста против egress-IP деплоя. Существующий OLD∩NEW-гейт
    // подтверждает второй пробой (confirmNativeAbsence) и прячет НА HIDE_TTL_MS —
    // self-heal: как только доступ к хосту восстановится, следующий probe
    // вернёт found → источник снова видим (без ручного включения).
    if (error instanceof HttpError && HARD_REFUSAL_STATUSES.has(error.statusCode)) {
      return {
        show: false, authoritative: true, status: error.statusCode,
        reason: 'host-block', error: String((error && error.message) || error).slice(0, 60)
      };
    }
    // Сеть/HTTP/таймаут/дедлайн/5xx/прочие 4xx — вердикта нет: показываем (не прячем рабочий).
    return {
      show: true, authoritative: false, inconclusive: true, status: 0,
      reason: 'error', error: String((error && error.message) || error).slice(0, 60)
    };
  }
}

/**
 * Создать checker availability. Опции перекрывают config.skaz (для тестов/скриптов).
 */
export function createAvailabilityChecker(options = {}) {
  const hosts = orderedSkazHosts(options.hosts || config.skaz.hosts || []);
  const accountEmail = String(options.accountEmail || config.skaz.accountEmail || '').trim();
  const uid = String(options.uid || config.skaz.uid || '').trim();
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || config.skaz.checkTimeoutMs || 8_000;
  // Дедлайн всей проверки: без него dead-кластер = хосты × таймаут (до ~48с).
  const deadlineMs = options.deadlineMs || Math.max(timeoutMs + 2_000, 10_000);
  const ttlMs = options.ttlMs || TTL_MS;
  // Пауза перед повторной пробой подтверждения «нет»: окно насыщения
  // online8-туннеля успевает отойти (эмпирически ~0.5с хватало, 2026-08-13).
  const backoffMs = options.backoffMs || 500;
  // BALANCER-ONLINE8-002 (SHADOW-режим, по умолчанию ВЫКЛЮЧЕН): политика голоса
  // резервной легаси-ноды online8 для НЕ-kinopub балансеров.
  //   'legacy'  — текущее поведение (byte-identical): не-2xx (403 `disable`/503) и
  //               2xx-non-content online8 считаются «нет»-голосом.
  //   'abstain' — фикс (док. BALANCER-ONLINE8-001 §9-б/г): для не-kinopub online8
  //               ВОЗДЕРЖИВАЕТСЯ — быстрый 403 `disable`/503 легаси-ноды это политика
  //               ноды «модуль выключен», а НЕ «контента нет»; hide требует
  //               content-«нет» от primary (2xx-non-content / accsdb-«Ожидаем фильм»).
  //               Kinopub НЕ затрагивается (реально живёт на online8, rule 8).
  // Три-стейт сохранён: show при отсутствии content-«нет» — inconclusive
  // (authoritative:false, hasInconclusive, self-heal по TTL), не permanent show:true.
  const reservePolicy = options.reservePolicy || 'legacy';
  const cache = new Map();

  // BALANCER-STABILITY-003: single-flight. Параллельные запросы ОДНОГО cache-key
  // (uid:serial:source:count) с ОДНИМ force-флагом выполняют ОДИН upstream calc
  // (Promise.allSettled probe-цикл + OLD∩NEW гейт), остальные join-запросы получают
  // ТОТ ЖЕ результат. Разные ключи (userUid/serial/source) — разные entries, не
  // блокируют друг друга. force изолирован от non-force (отдельный flightKey): по
  // семантике force = «свежий calc», его результат не должен быть «унаследован»
  // идущим non-force calc'ом и наоборот. Entry удаляется в finally — rejected/timeout
  // calc не отравляет flight (следующий запрос пересчитает).
  const inflight = new Map(); // flightKey → Promise<card result>

  // BALANCER-SEMANTICS-005-W1 (§2.4): пин «карточка → /videos». Авторитетно
  // найденная нода (row.host authoritative FOUND) запоминается per-userUid|providerId;
  // /videos и /video стартуют с неё (preferred-first). TTL = TTL кэш-entry того же
  // ряда; любой не-FOUND вердикт рекомпута чистит пин. uid-скоупед (кэш availability
  // и так uid-скоупед — STABILITY-003): разные юзеры могут иметь разные granted-ноды.
  const pinMap = new Map(); // `${userUid}|${providerId}` → { host, ts, ttl }

  /**
   * GET URL с таймаутом (бюджет ≤ остатка до дедлайна). Возвращает Response для
   * ЛЮБОГО HTTP-статуса (503/404 — кластер ОТВЕТИЛ), null — только когда ответа
   * НЕТ вовсе (таймаут/сеть): это два разных сигнала (см. checkBalancer).
   */
  async function fetchHost(url, deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const budget = Math.min(timeoutMs, remaining);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budget);
    try {
      const response = await fetchImpl(url, {
        headers: { accept: '*/*' },
        signal: controller.signal
      });
      return response || null;
    } catch {
      return null; // таймаут/сеть — ответа НЕТ (не путать с 503 «нет источника»)
    } finally {
      clearTimeout(timer);
    }
  }

  /** Первая строка — «нет источника» (null/disable/false/not found) на этом хосте. */
  function isNonContentAnswer(text) {
    const firstLine = String(text).trim().split(/\r?\n/, 1)[0].toLowerCase();
    return NON_CONTENT_FIRST_LINE.has(firstLine);
  }

  /**
   * Собрать URL `lite/<balancer>?<card>` (auth в URL). `checksearch=true` — поиск
   * (предикат Lampac); без него — прямой lite-page карточки (то, что реально тянет
   * OLD videos()). Второй сигнал для подтверждения «нет» (см. confirmAbsence).
   */
  function buildUrl(balancer, query, checksearch) {
    const url = new URL(`${hosts[0] || DEFAULT_HOST}/lite/${balancer}`);
    const params = {
      id: String(query.id ?? query.tmdb_id ?? ''),
      imdb_id: String(query.imdb_id ?? ''),
      kinopoisk_id: String(query.kinopoisk_id ?? ''),
      title: String(query.title ?? ''),
      original_title: String(query.original_title ?? ''),
      original_language: String(query.original_language ?? ''),
      serial: isSerialQuery(query) ? 1 : 0,
      year: String(query.year ?? ''),
      source: String(query.source || 'tmdb')
    };
    if (checksearch) params.checksearch = 'true';
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    if (accountEmail) url.searchParams.set('account_email', accountEmail);
    if (uid) url.searchParams.set('uid', uid);
    return url.toString();
  }

  function swapHost(url, nextHost) {
    try {
      const parsed = new URL(url);
      parsed.host = String(nextHost).replace(/^https?:\/\//, '').replace(/\/+$/, '');
      return parsed.toString();
    } catch {
      return url;
    }
  }

  /**
   * Проба одного балансера: хост-ротация (primary → online8-резерв), стоп-правила.
   * `checksearch=true` — поиск (предикат Lampac); `false` — прямой lite-page карточки.
   * Вердикты:
   *  - 2xx content-bearing → предикат (авторитетно, стоп);
   *  - 2xx «нет источника» (null/disable/false/not found) и не-2xx (403/404/503/5xx) —
   *    кластер ОТВЕТИЛ «нет» на этой ноде → следующий хост (балансер живёт на другой);
   *  - таймаут/сеть (ответа НЕТ) → вердикта нет: НЕ прячем, показываем оптимистично.
   *    Иначе транзиентный тормоз кластера скрывал рабочий источник (провал OLD∩NEW
   *    гейта в live-сверке: kinopub/27190 под 18-ю параллельными запросами).
   * Возвращает { show, rch, quality, status, host, authoritative, inconclusive? }.
   */
  async function probe(balancer, query, deadline, checksearch) {
    if (!hosts.length) return { show: false, rch: false, quality: '', status: 0, host: '', authoritative: false };
    const base = buildUrl(balancer, query, checksearch);
    let lastStatus = 0;
    let lastHost = '';
    let sawDefinitiveNo = false; // хоть один хост ответил content-«нет» (2xx-non-content/accsdb-ожидаем; в legacy и не-2xx)
    let sawNoResponse = false;   // хоть один хост не ответил (таймаут/сеть)
    let sawAccsdb = false;       // хоть один хост отказал учётке (accsdb) — вердикта нет
    // BALANCER-ONLINE8-002: сигналы abstain-политики (только при reservePolicy='abstain'
    // и balancer !== 'kinopub'). Резервная нода (online8) для не-kinopub ВОЗДЕРЖИВАЕТСЯ:
    // её быстрый 403 `disable`/503/2xx-non-content — политика ноды «модуль выключен», а
    // НЕ «контента нет» → не даёт «нет»-голос (док. BALANCER-ONLINE8-001 §9-б/г).
    const newMode = reservePolicy === 'abstain' && balancer !== 'kinopub';
    let sawStatusNo = false;     // primary ответил не-2xx (403/503/5xx) — статусный шум, не вердикт
    let sawReserveAbstain = false; // online8 ответил (403/503/2xx-non-content/accsdb-ожидаем) — воздержался
    for (let index = 0; index < hosts.length; index += 1) {
      if (Date.now() >= deadline) {
        // RULE-4: «нет» от ЧИСТОГО ответа хостов (без no-response) при исчерпании
        // дедлайна НЕ переворачиваем в показ. Смешанный вердикт / вовсе нет ответа →
        // действительно inconclusive → показываем (транзиентный тормоз не прячет
        // рабочий источник).
        if (sawDefinitiveNo && !sawNoResponse) {
          return { show: false, rch: false, quality: '', status: lastStatus, host: lastHost, authoritative: true, verdict: 'absent', timedOut: true };
        }
        return { show: true, rch: false, quality: '', status: lastStatus, host: lastHost, authoritative: false, inconclusive: true, timedOut: true };
      }
      const target = index === 0 ? base : swapHost(base, hosts[index]);
      const host = index === 0 ? hosts[0] : hosts[index];
      const response = await fetchHost(target, deadline);
      if (!response) {
        sawNoResponse = true;
        lastHost = host;
        continue;
      }
      lastStatus = response.status;
      lastHost = host;
      // Не-2xx — кластер ответил (503/404/403/5xx): «нет источника» на ЭТОЙ ноде.
      if (!(response.status >= 200 && response.status < 300)) {
        if (newMode) {
          // Не-2xx — статусный шум, НЕ content-вердикт (rule 3: 503/таймаут online8 не
          // доказывает отсутствие; primary 503/403 — сатурация кластера, не «нет»).
          // Резервная нода с выключенным модулем отвечает 403 `disable` одинаково для
          // реального и фейк-id (query-independent) → воздерживается. Primary не-2xx →
          // sawStatusNo (не прячем, но помечаем mixed — три-стейт сохранён).
          if (isReserveHost(host)) sawReserveAbstain = true;
          else sawStatusNo = true;
          continue;
        }
        sawDefinitiveNo = true;
        continue;
      }
      const text = await response.text().catch(() => null);
      if (text == null) {
        sawNoResponse = true;
        continue;
      }
      // accsdb. RULE-2: «Ожидаем фильм в хорошем качестве...» = «контента пока нет»
      // (кластер честно сообщает: источник добавит позже) → «нет» на ЭТОЙ ноде (как
      // не-2xx, продолжаем ротацию). Прочие accsdb-отказы («Войдите в аккаунт
      // Настройки - Синхронизация») — отказ учётной записи, а НЕ «источника нет»:
      // вердикта нет, как при таймауте/сети. Отказ авторизации не доказывает
      // отсутствие контента; прятать по нему — скрывать рабочий источник
      // (эмпирический кейс 2026-08-13: кластер на миг отказывал учётке → закэшированный
      // hide на 5 минут при OLD items>0). Следующий хост может ответить контентом
      // (авторитетно) или тоже accsdb (→ inconclusive ниже).
      if (String(text).trim().startsWith('{') && /"accsdb"\s*:\s*true/i.test(String(text))) {
        // msg приходит в escaped-unicode («Ож...»), regex по сырому телу
        // не видит кириллицу → декодируем msg из JSON перед проверкой шаблона
        // (иначе шаблон «Ожидаем фильм...» никогда не сматчится в живых ответах).
        let msg = String(text);
        try {
          const parsed = JSON.parse(String(text));
          if (parsed && typeof parsed.msg === 'string' && parsed.msg) msg = parsed.msg;
        } catch { /* остаёмся на сыром тексте */ }
        if (/ожидаем\s+фильм\s+в\s+хорошем\s+качестве/i.test(msg)) {
          // Content-«нет» (RULE-2): primary → authoritative «нет»; online8 (abstain) →
          // воздерживается (модуль выключен — тот же 403-профиль, см. isNonContentAnswer).
          if (newMode && isReserveHost(host)) {
            sawReserveAbstain = true;
          } else {
            sawDefinitiveNo = true;
          }
          lastHost = host;
          continue;
        }
        sawAccsdb = true;
        sawNoResponse = true;
        lastHost = host;
        continue;
      }
      // 2xx «нет источника» на хосте → следующий хост (как не-2xx).
      if (isNonContentAnswer(text)) {
        // online8 (abstain): 2xx `null`/`disable` — та же политика «модуль выключен»,
        // что и 403 `disable` (query-independent) → воздерживается, не «нет».
        if (newMode && isReserveHost(host)) {
          sawReserveAbstain = true;
        } else {
          sawDefinitiveNo = true;
        }
        continue;
      }
      // 2xx content-bearing — авторитетно: предикат, стоп. RULE-1: предикат возвращает
      // вердикт; inconclusive (карточка есть, но не классифицирована) — «вердикта нет» →
      // показываем (authoritative=false, inconclusive=true).
      const predicate = checkSearchPredicate(text, query);
      return {
        show: predicate.work,
        rch: predicate.rch,
        quality: predicate.quality,
        status: response.status,
        host,
        authoritative: predicate.verdict !== 'inconclusive',
        ...(predicate.verdict === 'inconclusive' ? { inconclusive: true, reason: 'predicate-inconclusive' } : {})
      };
    }
    // BALANCER-ONLINE8-002 (abstain): hide возможен ТОЛЬКО от content-«нет» primary
    // (sawDefinitiveNo, 2xx-non-content/accsdb-ожидаем) — rule 2. Статусный шум
    // (primary 503/403 = sawStatusNo) и воздержание online8 (sawReserveAbstain) не
    // дают «нет»-голос → show/inconclusive (rule 3, три-стейт rule 4). Чистый
    // content-«нет» без no-response → authoritative absent (rule 5/6: primary-вердикт
    // авторитетен; online8 без авторитетного контента не переворачивает его, rule 7).
    if (newMode) {
      if (sawDefinitiveNo && !sawNoResponse) {
        return { show: false, rch: false, quality: '', status: lastStatus, host: lastHost, authoritative: true, verdict: 'absent' };
      }
      return {
        show: true, rch: false, quality: '', status: lastStatus, host: lastHost,
        authoritative: false, inconclusive: true,
        ...(sawDefinitiveNo || sawStatusNo || sawReserveAbstain ? { mixed: true } : {}),
        ...(sawAccsdb ? { accsdb: true } : {})
      };
    }
    // Все хосты без content-вердикта.
    // RULE-4: показываем оптимистично ТОЛЬКО когда definitive ответа НЕТ вовсе (ни
    // одного «нет» от кластера — всё таймауты/сеть/accsdb-учётка). Чистый «нет» (все
    // хосты ответили) → authoritative absent (прячем). СМЕШАННЫЙ вердикт (часть «нет» +
    // часть no-response) → действительно inconclusive → показываем: неполный скан не
    // должен прятать рабочий источник (эмпирика: rutubemovie/Одиссея 503+abort, но
    // 11 items — docs/native-availability-001-report.md §2).
    if (sawNoResponse) {
      return {
        show: true, rch: false, quality: '', status: lastStatus, host: lastHost,
        authoritative: false, inconclusive: true,
        ...(sawDefinitiveNo ? { mixed: true } : {}),
        ...(sawAccsdb ? { accsdb: true } : {})
      };
    }
    return { show: false, rch: false, quality: '', status: lastStatus, host: lastHost, authoritative: true, verdict: 'absent' };
  }

  /** checksearch-проба (поиск, предикат Lampac) — основной сигнал. */
  async function checkBalancer(balancer, query, deadline) {
    return probe(balancer, query, deadline, true);
  }

  /**
   * Подтверждение «нет» от checksearch прямым lite-page (без checksearch) — тем самым
   * механизмом, что реально играет контент (OLD videos()). КРИТИЧЕСКИЙ ГЕЙТ (SHADOW/
   * COMPARE): источник прячем только когда ОБА сигнала ответили «нет». Один сигнал
   * (search) умеет флакать под нагрузкой — у kinopub контент живёт на online8 через
   * 302-туннель, и под 18-ю параллельными запросами online8 на миг отвечал 503/null,
   * хотя OLD videos() находил items (провал OLD∩NEW в live-сверке, Run 4).
   */
  async function confirmAbsence(balancer, query, deadline) {
    return probe(balancer, query, deadline, false);
  }

  /**
   * Подтверждение с retry-with-backoff: «нет» от прямого lite-page перепроверяем
   * после паузы backoffMs. Мотивация (рецидив §10, 2026-08-13, дважды за час):
   * под тяжёлым параллельным шумом ОБА сигнала (checksearch + прямой lite-page)
   * флакают «нет» разом через online8-302-туннель, хотя OLD videos() находит items.
   * Один такой ряд кэшировался на 5 минут → рабочий источник «исчезал». Повторная
   * проба через паузу даёт кластеру отойти от насыщения; выживший «нет» = три
   * независимых «нет» (search + 2× direct) — настоящий absent. `retried` — флаг
   * для диагностики (shadow-отчёт), в вердикт не входит.
   */
  async function confirmWithBackoff(balancer, query, deadline, attempt = 1) {
    const value = await confirmAbsence(balancer, query, deadline);
    const hide = value.show === false && value.authoritative && !value.inconclusive && !value.accsdb;
    if (!hide || attempt >= 2) return { value, retried: attempt > 1 };
    // До дедлайна осталось мало — пауза не уложится, оставляем первичный вердикт.
    if (deadline - Date.now() < backoffMs + 200) return { value, retried: false };
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    return confirmWithBackoff(balancer, query, deadline, attempt + 1);
  }

  /**
   * Подтверждение «нет» от native-пробы повторной пробой после backoffMs
   * (аналог confirmWithBackoff для skaz): транзиентный сбой провайдера успевает
   * отойти; выживший «нет» = два независимых «нет» — настоящий absent.
   */
  async function confirmNativeAbsence(provider, query, requestContext, deadline, attempt = 1) {
    const value = await nativeProbe(provider, query, requestContext, deadline);
    const hide = value.show === false && value.authoritative && !value.inconclusive;
    if (!hide || attempt >= 2) return { value, retried: attempt > 1 };
    if (deadline - Date.now() < backoffMs + 200) return { value, retried: false };
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    return confirmNativeAbsence(provider, query, requestContext, deadline, attempt + 1);
  }

  /** Видимые источники: native (единый per-card availability) + видимые skaz-балансеры. */
  function resolveSources() {
    const rows = [];
    for (const provider of registeredProviders()) {
      if (!provider.enabled()) continue;
      if (String(provider.id).startsWith('skaz-')) {
        rows.push({ id: provider.id, balancer: provider.balancer || '', native: false });
      } else {
        const twin = twinFor(provider.id);
        rows.push({
          id: provider.id,
          native: true,
          provider,
          // У native с hidden twin доступность решает twin-балансер (checksearch
          // того же балансера, что использует E-Online); без твина — native-проба.
          balancer: twin ? twin.balancer : '',
          twinBalancer: twin ? twin.balancer : ''
        });
      }
    }
    return rows;
  }

  function cacheKey(query, userUid, count) {
    const id = String(query.id || query.tmdb_id || query.imdb_id || query.kinopoisk_id || query.title || '').trim();
    const serial = isSerialQuery(query) ? 1 : 0;
    const source = String(query.source || 'tmdb');
    return fnv1aKey(`${id}:${serial}:${source}:${count}:${userUid}`);
  }

  function sweep() {
    if (cache.size <= 512) return;
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now - entry.ts >= (entry.ttl || ttlMs)) cache.delete(key);
    }
  }

  /**
   * Availability по карточке. Возвращает
   * { sources: [{id, show, native?, rch?, quality?, status, host?}], count, cached, elapsedMs }.
   *
   * BALANCER-STABILITY-003: single-flight. Параллельные запросы одного ключа
   * (cacheKey → userUid:serial:source:count) с одним force-флагом разделяют ОДИН
   * upstream calc; join-запросы получают тот же результат (тот же Promise). Разные
   * userUid/serial/source → разные ключи → не блокируют друг друга (каждый свой calc).
   * force — отдельный flight (по семантике force = «свежий calc», не делится с
   * non-force). Итог: под нагрузкой (несколько устройств/ретраев одного юзера на
   * одну карточку) upstream-вычисление выполняется один раз, а не N раз с
   * расходящимися вердиктами (кэш-стампед из live-матрицы READINESS-002: 5 паралл. →
   * 4 разных набора).
   */
  async function card(query = {}, userUid = '', force = false) {
    const sources = resolveSources();
    const count = sources.length;
    const key = cacheKey(query, userUid, count);
    const flightKey = `${key}:${force ? 'f' : 'n'}`;

    const hit = force ? undefined : cache.get(key);
    if (hit && Date.now() - hit.ts < (hit.ttl || ttlMs)) {
      return {
        sources: hit.sources,
        count,
        cached: true,
        elapsedMs: 0,
        hasInconclusive: Boolean(hit.hasInconclusive)
      };
    }

    // Single-flight: идущий calc для этого ключа — присоединяемся (тот же результат).
    const pending = inflight.get(flightKey);
    if (pending) return pending;

    const promise = computeCard(query, userUid, sources, count, key);
    inflight.set(flightKey, promise);
    try {
      return await promise;
    } finally {
      // Удаляем только если это НАШ entry (join-запрос уже вернул pending выше и не
      // дошёл сюда). Rejected/timeout calc не отравляет flight: finally снимает entry,
      // следующий запрос делает свежий calc.
      if (inflight.get(flightKey) === promise) inflight.delete(flightKey);
    }
  }

  /** Вычисление вердиктов по карточке (probe-цикл + OLD∩NEW гейт + кэш). Один calс. */
  async function computeCard(query, userUid, sources, count, key) {
    const started = Date.now();
    const deadline = started + deadlineMs;
    const settled = await Promise.allSettled(sources.map((source) => {
      // TRUSTED_ALWAYS_VISIBLE (filmix, native или видимый skaz-filmix): доверенный
      // источник — playback проверен, его checksearch-сигнал недостоверен
      // (false-negative, docs/balancer-002-postdeploy-shadow-report.md §6) → всегда
      // show:true БЕЗ пробы. Остальные native/skaz — per-card ниже.
      if (isTrustedAlwaysVisible(source.id)) {
        return Promise.resolve({ show: true, authoritative: true, trusted: true });
      }
      if (source.native) {
        // ЕДИНЫЙ per-card availability для native (BALANCER-002 POST-DEPLOY):
        // native с hidden twin — проверка через twin-балансер (skaz-checksearch,
        // тот же сигнал, что E-Online); native без твина — native search-level
        // probe (nativeProbe). Хардкода «native всегда show:true» больше нет.
        if (source.twinBalancer) return checkBalancer(source.twinBalancer, query, deadline);
        if (source.provider) return nativeProbe(source.provider, query, { query, request: { headers: {} } }, deadline);
        return Promise.resolve({ show: true, authoritative: false, inconclusive: true });
      }
      return checkBalancer(source.balancer, query, deadline);
    }));

    const rows = settled.map((result, index) => {
      const source = sources[index];
      if (result.status === 'rejected') {
        return {
          id: source.id, show: true, native: source.native, authoritative: false,
          inconclusive: true, status: 0, host: '', balancer: source.balancer,
          ...(source.twinBalancer ? { twinBalancer: source.twinBalancer } : {})
        };
      }
      const value = result.value || {};
      return {
        id: source.id,
        show: Boolean(value.show),
        native: source.native,
        authoritative: Boolean(value.authoritative),
        balancer: source.balancer,
        ...(source.twinBalancer ? { twinBalancer: source.twinBalancer } : {}),
        ...(value.inconclusive ? { inconclusive: true } : {}),
        ...(value.rch !== undefined ? { rch: value.rch } : {}),
        ...(value.quality ? { quality: value.quality } : {}),
        ...(value.status !== undefined ? { status: value.status } : {}),
        ...(value.host ? { host: value.host } : {}),
        ...(value.accsdb ? { accsdb: true } : {}),
        ...(value.trusted ? { trusted: true } : {}),
        ...(value.reason ? { reason: value.reason } : {}),
        ...(value.error ? { error: value.error } : {})
      };
    });

    // КРИТИЧЕСКИЙ ГЕЙТ (SHADOW/COMPARE) — ТЕПЕРЬ И ДЛЯ NATIVE: «нет» от первого
    // сигнала — только гипотеза, подтверждаем вторым независимым сигналом. skaz и
    // native-с-твином — прямым lite-page балансера (row.balancer = твин; тот же
    // механизм, что реально тянет OLD videos()); native без твина — повторной
    // native-пробой (confirmNativeAbsence). Прячем источник ТОЛЬКО когда ОБА
    // сигнала ответили «нет»; если второй нашёл карточку (или таймаутнул —
    // вердикта нет), источник видим. Ряды, прошедшие подтверждение, помечаем
    // confirmed (диагностика в shadow).
    const eligible = rows
      .map((row, index) => ({ row, index }))
      // trusted (TRUSTED_ALWAYS_VISIBLE) исключён из гейта «нет» в явном виде:
      // show:true детерминирован политикой и не может быть перевернут
      // подтверждающим сигналом (defense-in-depth, инвариант «trusted → видим»).
      .filter(({ row }) => row.show === false && row.authoritative && !row.accsdb && !row.trusted);
    if (eligible.length) {
      const confirmations = await Promise.allSettled(eligible.map(({ row, index }) => {
        const source = sources[index];
        if (source.native && source.provider && !source.twinBalancer) {
          return confirmNativeAbsence(source.provider, query, { query, request: { headers: {} } }, deadline)
            .then(({ value, retried }) => ({ index, value, retried }));
        }
        return confirmWithBackoff(row.balancer, query, deadline)
          .then(({ value, retried }) => ({ index, value, retried }));
      }));
      for (const settledConfirm of confirmations) {
        if (settledConfirm.status === 'rejected') continue; // сбой подтверждения — оставляем первичный вердикт
        const { index, value, retried } = settledConfirm.value;
        const row = rows[index];
        // RULE-4: инконклюзивное подтверждение (дедлайн исчерпан / сеть — вердикта НЕТ)
        // не переворачивает первичное authoritative «нет» в показ: fallback show:true по
        // timeout — только когда definitive ответа не было вовсе. Здесь первичный вердикт
        // definitive («нет» от ЧИСТОГО ответа кластера) → оставляем его; ряд помечаем
        // inconclusive (НЕ definitive, BALANCER-STABILITY-002) → entry кэшируется на
        // HIDE_TTL_MS с hasInconclusive; по TTL/force появившийся контент вернёт
        // источник. Мотивация — docs/native-availability-001-report.md §2.4:
        // kinoflix/pidtor/solntse «Одиссеи» подтверждённо отсутствуют, но исчерпание
        // card-дедлайна (12 004мс > 10 000мс) превращало их в show:true.
        if (value.inconclusive) {
          row.inconclusive = true;
          row.confirmInconclusive = true;
          continue;
        }
        row.show = Boolean(value.show);
        row.authoritative = Boolean(value.authoritative);
        if (value.rch !== undefined) row.rch = value.rch;
        if (value.quality) row.quality = value.quality;
        if (value.status !== undefined) row.status = value.status;
        if (value.host) row.host = value.host;
        if (value.accsdb) row.accsdb = true;
        if (value.reason) row.reason = value.reason;
        if (value.error) row.error = value.error;
        if (retried) row.retried = true;
        row.confirmed = true;
      }
    }

    const elapsedMs = Date.now() - started;

    // BALANCER-STABILITY-002: INCONCLUSIVE-ряды НЕ блокируют кэш. Сохраняем фактический
    // вердикт каждой строки (AVAILABLE/UNAVAILABLE/INCONCLUSIVE — три различных
    // состояния, `inconclusive`-флаг остаётся в ряду; на hit возвращается тот же набор,
    // ничего не сворачивается в show:true/false). Entry с inconclusive помечается
    // hasInconclusive → НЕ definitive: по TTL/force следующий запрос перепроверит и
    // сможет получить новый вердикт (self-heal). Подтверждённый «нет» (двойная проверка
    // + retry) кэшируется КОРОТКО (HIDE_TTL_MS): даже три согласных «нет» под окном
    // насыщения online8-туннеля не должны висеть на рабочем источнике 5 минут —
    // self-heal за минуту (кейс 2026-08-13: OLD items>0, NEW скрыл на 5 мин).
    const hasInconclusive = rows.some((row) => row.inconclusive);
    const hasConfirmedHide = rows.some((row) => row.show === false);

    // BALANCER-SEMANTICS-005-W1 (§2.4): пин «карточка → /videos» пишем ПАРАЛЛЕЛЬНО
    // кэшу rows (тот же вердикт, тот же TTL). Авторитетный FOUND-ряд (show+authoritative
    // с host, не trusted-хардкод, не accsdb) → пин ноды на TTL этого же entry;
    // любой другой вердикт (dated ""/absent, show:false, na, inconclusive) → пин удаляем.
    // Ключ = userUid|providerId: разные юзеры (granted-устройства разных аккаунтов
    // skaz) — разные ноды; trusted-ряды (filmix) пина не имеют (host нетипично).
    // TTL зеркалирует кэш (HIDE_TTL_MS при скрытии, ttlMs иначе) — устаревший пин
    // сам истекает и не может вечно блокировать ротацию (§8.7).
    const pinTtl = hasConfirmedHide ? HIDE_TTL_MS : ttlMs;
    for (const row of rows) {
      const pk = `${userUid}|${row.id}`;
      const isFound = row.show === true && row.authoritative && Boolean(row.host)
        && !row.trusted && !row.accsdb;
      if (isFound) {
        pinMap.set(pk, { host: row.host, ts: Date.now(), ttl: pinTtl });
      } else {
        pinMap.delete(pk);
      }
    }

    cache.set(key, {
      ts: Date.now(),
      sources: rows,
      ttl: hasConfirmedHide ? HIDE_TTL_MS : ttlMs,
      hasInconclusive
    });
    sweep();

    return { sources: rows, count, cached: false, elapsedMs, hasInconclusive };
  }

  // BALANCER-SEMANTICS-005-W1 (§2.4): чтение пина. Устаревший (ts+ttl < now) пин
  // удаляется на чтении — preferred-first не превращается в жёсткий keep-on-host.
  // Возврат: host строкой или null. Вызывается ТОЛЬКО при живом context.userUid
  // (иначе uid не соотносим с кэшем карточки).
  function pinnedHost(providerId, userUid_) {
    if (!userUid_) return null;
    const pk = `${userUid_}|${providerId}`;
    const entry = pinMap.get(pk);
    if (!entry) return null;
    if (Date.now() - entry.ts >= entry.ttl) {
      pinMap.delete(pk);
      return null;
    }
    return entry.host || null;
  }

  return { card, checkBalancer, confirmAbsence, checkSearchPredicate, pinnedHost };
}

/** Singleton для продакшна/скриптов (config.skaz + реальный fetch).
 * reservePolicy:'abstain' — BALANCER-ONLINE8-002 (принято 2026-08-14): online8
 * (легаси-нода) для не-kinopub ВОЗДЕРЖИВАЕТСЯ (403 `disable`/503/2xx-non-content
 * ≠ «нет»), hide только от content-«нет» primary. Shadow: 29/29 gate, REGR=0.
 * Kinopub вне абстаина (rule 8). Опция-дефолт внутри остаётся 'legacy' — любой
 * другой создатель checker'а получает прежнее поведение. */
export const defaultChecker = createAvailabilityChecker({ reservePolicy: 'abstain' });

export default defaultChecker;
