import { config } from './config.js';
import { registeredProviders } from './providers/registry.js';

/**
 * BALANCER-002 — per-card source availability (`/api/lampa/sources/card`).
 *
 * Копия динамики E-Online/Lampac (см. docs/balancer-001-audit.md §6): вместо
 * статического реестра — параллельный `checksearch=true` по каждому видимому
 * skaz-балансеру, предикат «карточка есть» (data-json/type/rch), кэш 5 минут.
 *
 * Отличия от SkazClient (намеренные, не трогаем существующую videos()-логику):
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
 * ≤512 (конвенция SkazProvider._navCache). Кэшируем только чистые вердикты: ни одного
 * inconclusive-ряда (таймаут/сеть) — стрессовый момент не фиксируем на 5 минут.
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
 */

const TTL_MS = 5 * 60 * 1000;
// Подтверждённый «нет» (двойная проверка) кэшируется КОРОЧЕ: даже с retry окно
// насыщения online8-туннеля умеет отвечать «нет» на оба сигнала разом, и скрытие
// живого источника должно self-heal за минуту, а не висеть 5 минут (эмпирический
// кейс 2026-08-13: OLD items>0, а NEW скрыл на 5 мин после тяжёлого shadow-прогона).
const HIDE_TTL_MS = 60 * 1000;
const DEFAULT_HOST = 'http://online3.skaz.tv';
const NON_CONTENT_FIRST_LINE = new Set(['null', 'disable', 'false', 'not found']);

/** Хост = «резервная нода» (online8) — переместить в конец пула. */
function isReserveHost(host) {
  return String(host || '').includes('online8');
}

function reorderHosts(hosts) {
  const primary = [];
  const reserve = [];
  for (const host of hosts) {
    (isReserveHost(host) ? reserve : primary).push(host);
  }
  return [...primary, ...reserve];
}

/**
 * Точный предикат checkSearch из Lampac (OnlineApi.cs:975):
 * `work = rch || res.Contains("data-json=") || res.Contains("\"type\":\"movie\"") ||
 *        res.Contains("\"type\":\"episode\"") || res.Contains("\"type\":\"season\"")`.
 * Качество — информативно (для shadow-сравнения), как в Lampac (<!--q:-->/2160p/HDR).
 */
export function checkSearchPredicate(text) {
  const raw = String(text || '');
  const rch = /"rch"\s*:\s*true/i.test(raw);
  const work = rch
    || raw.includes('data-json=')
    || raw.includes('"type":"movie"')
    || raw.includes('"type":"episode"')
    || raw.includes('"type":"season"');

  let quality = '';
  const qMark = raw.match(/<!--q:([^>]+)-->/);
  if (qMark) quality = String(qMark[1]).trim();
  else if (raw.includes('"2160p"') || raw.includes('2160p')) quality = '2160p';
  else if (/\bHDR\b/i.test(raw)) quality = 'HDR';

  return { work, rch, quality };
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
 * Создать checker availability. Опции перекрывают config.skaz (для тестов/скриптов).
 */
export function createAvailabilityChecker(options = {}) {
  const hosts = reorderHosts(options.hosts || config.skaz.hosts || []);
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
  const cache = new Map();

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
    let sawDefinitiveNo = false; // хоть один хост ответил «нет» (статус/2xx-non-content)
    let sawNoResponse = false;   // хоть один хост не ответил (таймаут/сеть)
    let sawAccsdb = false;       // хоть один хост отказал учётке (accsdb) — вердикта нет
    for (let index = 0; index < hosts.length; index += 1) {
      if (Date.now() >= deadline) {
        // Дедлайн карточки — вердикта нет, показываем (транзиентный тормоз не
        // должен прятать рабочий источник).
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
        sawDefinitiveNo = true;
        continue;
      }
      const text = await response.text().catch(() => null);
      if (text == null) {
        sawNoResponse = true;
        continue;
      }
      // accsdb — отказ учётной записи («Войдите в аккаунт Настройки - Синхронизация»),
      // а НЕ «источника нет»: вердикта нет, как при таймауте/сети. Отказ авторизации
      // не доказывает отсутствие контента; прятать по нему — скрывать рабочий источник
      // (эмпирический кейс 2026-08-13: кластер на миг отказывал учётке → закэшированный
      // hide на 5 минут при OLD items>0). Продолжаем ротацию: следующий хост может
      // ответить контентом (авторитетно) или тоже accsdb (→ inconclusive ниже).
      if (String(text).trim().startsWith('{') && /"accsdb"\s*:\s*true/i.test(String(text))) {
        sawAccsdb = true;
        sawNoResponse = true;
        lastHost = host;
        continue;
      }
      // 2xx «нет источника» на хосте → следующий хост (как не-2xx).
      if (isNonContentAnswer(text)) {
        sawDefinitiveNo = true;
        continue;
      }
      // 2xx content-bearing — авторитетно: предикат, стоп.
      const predicate = checkSearchPredicate(text);
      return {
        show: predicate.work,
        rch: predicate.rch,
        quality: predicate.quality,
        status: response.status,
        host,
        authoritative: true
      };
    }
    // Все хосты без content-вердикта. Прячем ТОЛЬКО при явном «нет» от кластера;
    // хоть один no-response (таймаут/сеть/accsdb) = вердикта нет → показываем
    // оптимистично (транзиентный сбой не должен прятать рабочий источник).
    if (sawNoResponse) {
      return {
        show: true, rch: false, quality: '', status: lastStatus, host: lastHost,
        authoritative: false, inconclusive: true,
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

  /** Видимые источники: native (всегда show:true) + видимые skaz-балансеры. */
  function resolveSources() {
    const rows = [];
    for (const provider of registeredProviders()) {
      if (!provider.enabled()) continue;
      if (String(provider.id).startsWith('skaz-')) {
        rows.push({ id: provider.id, balancer: provider.balancer || '', native: false });
      } else {
        rows.push({ id: provider.id, balancer: '', native: true });
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
   */
  async function card(query = {}, userUid = '') {
    const sources = resolveSources();
    const count = sources.length;
    const key = cacheKey(query, userUid, count);

    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < (hit.ttl || ttlMs)) {
      return { sources: hit.sources, count, cached: true, elapsedMs: 0 };
    }

    const started = Date.now();
    const deadline = started + deadlineMs;
    const settled = await Promise.allSettled(sources.map((source) => {
      if (source.native) {
        return Promise.resolve({ id: source.id, show: true, native: true, authoritative: true });
      }
      return checkBalancer(source.balancer, query, deadline);
    }));

    const rows = settled.map((result, index) => {
      const source = sources[index];
      if (result.status === 'rejected') {
        return { id: source.id, show: true, native: source.native, authoritative: false, inconclusive: true, status: 0, host: '', balancer: source.balancer };
      }
      const value = result.value || {};
      return {
        id: source.id,
        show: Boolean(value.show),
        native: source.native,
        authoritative: Boolean(value.authoritative),
        balancer: source.balancer,
        ...(value.inconclusive ? { inconclusive: true } : {}),
        ...(value.rch !== undefined ? { rch: value.rch } : {}),
        ...(value.quality ? { quality: value.quality } : {}),
        ...(value.status !== undefined ? { status: value.status } : {}),
        ...(value.host ? { host: value.host } : {}),
        ...(value.accsdb ? { accsdb: true } : {})
      };
    });

    // КРИТИЧЕСКИЙ ГЕЙТ (SHADOW/COMPARE): «нет» от checksearch — только гипотеза.
    // Подтверждаем прямым lite-page (без поиска) — тем механизмом, что реально тянет
    // OLD videos(). Прячем источник ТОЛЬКО когда ОБА сигнала ответили «нет»; если
    // прямой lite-page нашёл карточку (или таймаутнул — вердикта нет), источник видим.
    // Ряды, прошедшие подтверждение, помечаем confirmed (диагностика в shadow).
    const eligible = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !row.native && row.show === false && row.authoritative && !row.accsdb);
    if (eligible.length) {
      const confirmations = await Promise.allSettled(eligible.map(({ row, index }) =>
        confirmWithBackoff(row.balancer, query, deadline)
          .then(({ value, retried }) => ({ index, value, retried }))
      ));
      for (const settledConfirm of confirmations) {
        if (settledConfirm.status === 'rejected') continue; // сбой подтверждения — оставляем checksearch-вердикт
        const { index, value, retried } = settledConfirm.value;
        const row = rows[index];
        row.show = Boolean(value.show);
        row.authoritative = Boolean(value.authoritative);
        if (value.inconclusive) row.inconclusive = true;
        if (value.rch !== undefined) row.rch = value.rch;
        if (value.quality) row.quality = value.quality;
        if (value.status !== undefined) row.status = value.status;
        if (value.host) row.host = value.host;
        if (value.accsdb) row.accsdb = true;
        if (retried) row.retried = true;
        row.confirmed = true;
      }
    }

    const elapsedMs = Date.now() - started;

    // Кэшируем только чистые вердикты: ни одного inconclusive-ряда (таймаут/сеть).
    // Стрессовый момент кластера не фиксируем на 5 минут — следующий запрос
    // перепроверит и получит свежий вердикт. Подтверждённый «нет» (двойная проверка
    // + retry) кэшируется, но КОРОТКО (HIDE_TTL_MS): даже три согласных «нет» под
    // окном насыщения online8-туннеля не должны висеть на рабочем источнике 5 минут —
    // self-heal за минуту (кейс 2026-08-13: OLD items>0, NEW скрыл на 5 мин).
    if (!rows.some((row) => row.inconclusive)) {
      const hasConfirmedHide = rows.some((row) => row.show === false);
      cache.set(key, {
        ts: Date.now(),
        sources: rows,
        ttl: hasConfirmedHide ? HIDE_TTL_MS : ttlMs
      });
      sweep();
    }

    return { sources: rows, count, cached: false, elapsedMs };
  }

  return { card, checkBalancer, confirmAbsence, checkSearchPredicate };
}

/** Singleton для продакшна/скриптов (config.skaz + реальный fetch). */
export const defaultChecker = createAvailabilityChecker({});

export default defaultChecker;
