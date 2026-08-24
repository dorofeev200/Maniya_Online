import { config } from '../../config.js';
import { allProviders } from '../registry.js';
import { providerMeta } from '../meta.js';
import { SkazProvider } from './SkazProvider.js';

/**
 * SKAZ-MANIYA-019 — эфемерные skaz-провайдеры (per-title модель).
 *
 * Per-title модель (`sourceModel`) отдаёт чипы с id `skaz-<slug>` для слагов,
 * которых НЕТ в `config.skaz.balancers` (lordfilm, mirkino, ashdi, kinoukr,
 * eneyida, remux, sakhtv/lumex, … — см. PREIMPLEMENT-AUDIT §4). Такие источники
 * НИКОГДА не регистрируются в реестре избранных (registry.js) и не светятся в
 * `/api/lampa/sources`/списках — их карточки живут только в модели карточки.
 * На клике по такому чипу /videos (а потом и Play /api/lampa/video) должны
 * честно попасть в тот же skaz-балансер — для этого store.js резолвит id через
 * `skazProviderFor()`.
 *
 * Правило:
 *  - id = известный зарегистрированный провайдер (всеProviders) → вернуть его
 *    инстанс (стабильность: общий nav-кэш, DI-конструкторы, hidden-близнецы).
 *  - иначе `skaz-<slug>` со slug по regex `/^skaz-[a-z0-9]{2,24}$/` →
 *    memo-эфемерный `SkazProvider` (не в реестре, без поиска в списках).
 *  - гейт `config.skaz.enabled` + creds; иначе — null (как у реестра, eneded()).
 * Размер memo-кэша ограничен простым сбросом при переполнении (эфемерные —
 * временные и дешёвые; nav-кэш каждого ограничен отдельно в SkazProvider).
 */
const EPHEMERAL_ID_RE = /^skaz-[a-z0-9]{2,24}$/;
const MAX_EPHEMERAL = 64;
const ephemeralCache = new Map();

function credsOk() {
  return Boolean(config.skaz?.accountEmail && config.skaz?.uid);
}

/** Отображаемое имя для эфемерного (meta по слагу есть для большинства; fallback — слаг). */
function titleFor(slug) {
  const meta = providerMeta(`skaz-${slug}`);
  return meta?.name || `Maniya · ${slug}`;
}

/** Создать НЕ зарегистрированный инстанс `SkazProvider` для слага. */
export function ephemeralSkazProvider(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!s || !credsOk()) return null;
  return new SkazProvider({
    id: `skaz-${s}`,
    title: titleFor(s),
    balancer: s,
    hosts: config.skaz.hosts,
    accountEmail: config.skaz.accountEmail,
    uid: config.skaz.uid,
    origin: config.skaz.origin,
    show: true
    // rchRegistry/нормализатор/клиент — дефолты конструктора из config.skaz.
  });
}

/** tail-хеш слага для memo-ключ bounds (просто счётчик, детерминизм не нужен). */
let ephemeralStamp = 0;

/**
 * Зарегистрированный провайдер по model id или memo-эфемерный (или null).
 * Гейт `config.skaz.enabled` + creds ДО любого создания. Реестровый приоритет:
 * hidden-близнецы natives (`skaz-filmix` и т.п.) резолвятся на реальный инстанс
 * twin-фоллбэка — их per-title модель не порождает (native wins), но Play со
 * старых кэшей/{id,show} веток обязан работать.
 */
export function skazProviderFor(id) {
  const value = String(id || '').trim().toLowerCase();
  if (!value.startsWith('skaz-')) return null;
  if (!config.skaz?.enabled) return null;
  if (!credsOk()) return null;

  const registered = allProviders().find((p) => p.id === value);
  if (registered) return registered;

  if (!EPHEMERAL_ID_RE.test(value)) return null;
  const slug = value.slice('skaz-'.length);
  let provider = ephemeralCache.get(value);
  if (provider) return provider;

  provider = ephemeralSkazProvider(slug);
  if (!provider) return null;
  ephemeralCache.set(value, provider);
  ephemeralStamp += 1;
  if (ephemeralCache.size > MAX_EPHEMERAL) ephemeralCache.clear();
  return provider;
}

export default skazProviderFor;