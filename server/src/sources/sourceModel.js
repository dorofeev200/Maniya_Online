import { config } from '../config.js';
import { fnv1aKey, isSerialQuery } from '../availability.js';
import { registrySnapshot } from '../providers/registry.js';
import { providerMeta, PROVIDER_FALLBACK_ICON } from '../providers/meta.js';
import { SkazClient, parseEventsOnline } from '../providers/skaz/SkazClient.js';

/**
 * SKAZ-MANIYA-019 — per-title модель источников (ядро).
 *
 * Авторитет per-title = кластерный `GET {host}/lite/events?<cardParams>`
 * (online[] до 32 записей `{name,url,index,show,balanser,rch,voices,seasons}`).
 * Оверлей на уровне `/sources/card`: модель заменяет статический реестр+probe.
 *
 * КЛЮЧЕВЫЕ РЕШЕНИЯ (PREIMPLEMENT-AUDIT §8):
 * - ВНУТРИ `card()` НЕ вызывается probe-волна defaultChecker.card —
 *   она 31–33 с (замер прод, мутини/toystory5) и разносит bounded timeout
 *   (/sources/card ≥ 12 с). Maniya-only extras добавляются оптимистично со
 *   static-реестром (`show` из registrySnapshot), /videos не трогается.
 * - Кластерная истина: скрытые источники (show:false) СОХРАНЯЮТСЯ в модели
 *   (→ ghost «Ещё N»), НЕ отбрасываются.
 * - id уникален по `balanser` (не index): native enabled → native id (wins),
 *   иначе `skaz-<slug>`; коллизии index (mutiny 2×index2, interst 2×index7)
 *   ПРЕСЕРВУЮТСЯ — оба источника на месте.
 * - Кэш TTL 60 с + single-flight (ключ = полные card params + uid);
 *   null/ошибка/timeout НЕ кэшируются.
 * - Детерминизм: успех events → ПОЛНАЯ модель; неуспех → null (route →
 *   старый probe-path verbatim). Частичной модели не бывает.
 */

/** Whitelist card params для `lite/events` (без account_email/uid — их добавит
 *  SkazClient; без лишних query-параметров клиента, life/checksearch отсутствуют).
 *  Зеркало параметров availability.buildUrl (тот же battle-tested набор). */
export function buildEventsParams(query = {}) {
  const params = {};
  const id = String(query.id ?? query.tmdb_id ?? '');
  if (id) params.id = id;
  const imdb = String(query.imdb_id ?? '');
  if (imdb) params.imdb_id = imdb;
  const kp = String(query.kinopoisk_id ?? '');
  if (kp) params.kinopoisk_id = kp;
  const title = String(query.title ?? '');
  if (title) params.title = title;
  const originalTitle = String(query.original_title ?? '');
  if (originalTitle) params.original_title = originalTitle;
  const originalLanguage = String(query.original_language ?? '');
  if (originalLanguage) params.original_language = originalLanguage;
  const year = String(query.year ?? '');
  if (year) params.year = year;
  params.serial = isSerialQuery(query) ? '1' : '0';
  params.source = String(query.source || 'tmdb');
  return params;
}

/** Разрешить слаг кластера → model id. Native enabled wins (native → native id,
 *  skaz-близнец НЕ создаётся, никакого двойного чипа). Иначе `skaz-<slug>`. */
export function resolveModelId(slug, snapshot) {
  const s = String(slug || '').trim().toLowerCase();
  if (!s) return null;
  if (snapshot?.nativeIdSet?.has(s)) return s;
  return `skaz-${s}`;
}

/** SKAZ-MANIYA-052: тонкий путь для слаг-балансера? Только под флагом (off → PROD-байт). */
function isThinModule(slug) {
  const mods = config.skaz.thin?.modules || [];
  if (!config.skaz.thin?.enabled || !mods.length) return false;
  return mods.includes(String(slug || '').trim());
}

/** Хост из кластерного url (для детерминированного tie-break при index-коллизии). */
function hostOf(url) {
  try {
    return new URL(String(url || '')).host;
  } catch {
    return '';
  }
}

/**
 * Сортировка модели по index ASC со стабильным tie-break url_host → balanser.
 * Коллизии index (mutiny 2×index2, interst 2×index7) НЕ разрешаются в пользу
 * одной записи — обе присутствуют; порядок между ними детерминирован.
 */
export function sortModelByIndex(online) {
  return [...online].sort((a, b) => {
    const ai = Number(a.index) || 0;
    const bi = Number(b.index) || 0;
    if (ai !== bi) return ai - bi;
    const ha = hostOf(a.url);
    const hb = hostOf(b.url);
    if (ha !== hb) return ha < hb ? -1 : 1;
    return a.balanser < b.balanser ? -1 : a.balanser > b.balanser ? 1 : 0;
  });
}

/** Построить модель из валидного online[] (кластер-блок + Maniya-only extras). */
export function buildModel(online, snapshot) {
  const ordered = sortModelByIndex(online);
  const slugSet = new Set(online.map((o) => o.balanser));
  const items = [];
  const seen = new Set();

  for (const o of ordered) {
    const id = resolveModelId(o.balanser, snapshot);
    if (!id || seen.has(id)) continue; // защита от дублей id (слаг уникален → не сработает)
    seen.add(id);
    const isNativeFilmix = id === 'filmix' && snapshot?.nativeIdSet?.has('filmix');
    // Кластерная истина show (ghost = !show); TRUSTED filmix (инвариант
    // availability): транзиентное show:false у filmix не прячет источник.
    const show = isNativeFilmix ? true : o.show === true;
    const meta = providerMeta(id);
    // T052: только под флагом и только для skaz-близнецов (native → без поля).
    const thinFlag = config.skaz.thin?.enabled && String(id).startsWith('skaz-') ? { thin: isThinModule(o.balanser) } : {};
    items.push({
      id,
      name: o.name, // server-side имя (несёт качество/бренд: «Filmix ~ 4K», «Мир кино Z»)
      url: o.url, // кластерный deep-link сохранён (api_url — для клиента)
      api_url: `/api/lampa/videos?provider=${encodeURIComponent(id)}`,
      index: o.index,
      show,
      ghost: !show,
      balanser: o.balanser,
      rch: Boolean(o.rch),
      voices: Number(o.voices) || 0,
      seasons: Number(o.seasons) || 0,
      icon: meta?.icon || PROVIDER_FALLBACK_ICON,
      quality_label: '', // качество в имени (кластерном); local quality_label — только для extras
      ...thinFlag
    });
  }

  // Maniya-only extras: зарегистрированные провайдеры, чей слаг кластер не
  // моделирует для этой карточки (kodik, collaps — natives; rhsprem — skaz-bridge).
  // Оптимистичный show из реестра (БЕЗ probe — АУДИТ §8). В КОНЦЕ, index=null.
  for (const native of snapshot?.natives || []) {
    if (slugSet.has(native.id)) continue; // уже покрыт кластерным набором
    if (seen.has(native.id)) continue;
    seen.add(native.id);
    const meta = providerMeta(native.id);
    items.push({
      id: native.id,
      name: meta?.name || `Maniya · ${native.id}`,
      url: '',
      api_url: `/api/lampa/videos?provider=${encodeURIComponent(native.id)}`,
      index: null,
      show: true,
      ghost: false,
      balanser: '',
      rch: false,
      voices: 0,
      seasons: 0,
      icon: meta?.icon || PROVIDER_FALLBACK_ICON,
      quality_label: meta?.qualityLabel || ''
    });
  }
  // Maniya-only skaz-экстрасы: skaz-зеркала, чей слог кластер НЕ смоделировал
  // для ЭТОЙ карточки (нет в online[]). Кластер-авторитет (T054): слог не в
  // online[] → под эти card-параметры контента у кластера нет → НЕ светить
  // активным чипом, оставить в «Ещё N» (ghost). Иначе static-реестр вечно
  // добавляет «пустые» источники, которых не видит сам SKAZ-клиент.
  // Native-экстрасы выше (собственный серверный контент) — исключение.
  for (const skaz of snapshot?.visibleSkaz || []) {
    if (slugSet.has(skaz.balancer)) continue;
    const id = `skaz-${skaz.balancer}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const meta = providerMeta(id);
    items.push({
      id,
      name: meta?.name || `Maniya · ${skaz.balancer}`,
      url: '',
      api_url: `/api/lampa/videos?provider=${encodeURIComponent(id)}`,
      index: null,
      show: false,
      ghost: true,
      balancer: skaz.balancer,
      balanser: skaz.balancer,
      rch: false,
      voices: 0,
      seasons: 0,
      icon: meta?.icon || PROVIDER_FALLBACK_ICON,
      quality_label: meta?.qualityLabel || ''
    });
  }

  return items;
}

/** Ключ кэша: полные card params (whitelist) + uid — данные одной карточки
 *  одного юзера не попадают другому (рефайнмент #6). */
export function modelCacheKey(query, userUid = '') {
  return fnv1aKey(`${JSON.stringify(buildEventsParams(query))}:${userUid}`);
}

/**
 * Создать per-title model. Опции (DI для тестов):
 *   client    — SkazClient (getOnline); дефолт — событийный клиент из config.skaz
 *   snapshot  — registry-снимок (функция); дефолт registrySnapshot
 *   ttlMs     — TTL кэша (60_000)
 *   timeoutMs — per-нода events таймаут (config.skaz.checkTimeoutMs)
 */
export function createSourceModel(options = {}) {
  const client = options.client || new SkazClient({
    hosts: config.skaz.hosts,
    accountEmail: config.skaz.accountEmail,
    uid: config.skaz.uid,
    origin: config.skaz.origin,
    timeoutMs: options.timeoutMs || config.skaz.checkTimeoutMs || 10_000
  });
  const snapshot =
    typeof options.snapshot === 'function'
      ? options.snapshot
      : (typeof options.snapshot === 'object' && options.snapshot) || registrySnapshot;
  const ttlMs = options.ttlMs || 60_000;
  const timeoutMs = options.timeoutMs || config.skaz.checkTimeoutMs || 10_000;
  const cache = new Map();
  const inflight = new Map(); // single-flight (зеркало availability.js STABILITY-003)

  function sweep() {
    if (cache.size <= 512) return;
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now - entry.ts >= ttlMs) cache.delete(key);
    }
  }

  /** Вычислить модель (кэш-мисс). Возвращает {items, cached, elapsedMs}|null. */
  async function compute(cacheKey2, query, userUid) {
    const started = Date.now();
    const online = await client.getOnline(buildEventsParams(query), { timeoutMs });
    if (online === null) return null; // события кластера недоступны — НЕ кэшируем
    const items = buildModel(online, snapshot());
    cache.set(cacheKey2, { ts: Date.now(), items });
    sweep();
    return { items, cached: false, elapsedMs: Date.now() - started };
  }

  /**
   * Модель по карточке → `{items, cached, elapsedMs}` | null.
   * null = события недоступны (время/ошибка/invalid JSON) — route отдаёт старый
   * probe-path verbatim (никакой частичной модели). Single-flight: параллельные
   * запросы одного ключа разделяют ОДИН upstream events-fetch.
   */
  async function card(query = {}, userUid = '') {
    const key = modelCacheKey(query, userUid);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < ttlMs) {
      return { items: hit.items, cached: true, elapsedMs: 0 };
    }
    const pending = inflight.get(key);
    if (pending) return pending;
    const promise = compute(key, query, userUid);
    inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      if (inflight.get(key) === promise) inflight.delete(key);
    }
  }

  return { card, _cache: cache };
}

/** Singleton для продакшна/скриптов (config.skaz + реальный fetch). */
export const sourceModel = createSourceModel();

export { parseEventsOnline };