# SKAZ-MANIYA-UNIFIED-BALANCER

TASK-SKAZ-MANIYA-003 №9 — единый balancer + «provider→balancer» путь + host-bound URL-правила.
Дата: **2026-08-20**. Только локальный прогон; **деплой/commit/push НЕ выполнялись**.

## 1. ЕДИНЫЙ балансер (все провайдеры через один путь) — ПОДТВЕРЖДЕНО

Архитектура уже единая. Ядро: `createAvailabilityChecker` (`server/src/availability.js`).

**`resolveSources()`** строит ОДИН список источников из `registeredProviders()`:
- `skaz-<balancer>` → строка `{id, balancer, native:false}`;
- native-источник → строка `{id, native:true, provider, twinBalancer}` (twin — если есть скрытый
  skaz-близнец; иначе nativeProbe).

**`computeCard()`** оценивает ВСЕ источники в одном `Promise.allSettled` probe-цикле:
- TRUSTED_ALWAYS_VISIBLE (filmix) → show:true без пробы (trusted, playback был проверен);
- native с twin → `checkBalancer(twin.balancer, …)` — тот же signal, что E-Online;
- native без twin → `nativeProbe(provider, …)` (search-level / или no-instance);
- skaz → `checkBalancer(balancer, …)` (skaz-checksearch, host-scan: content → SHOW, 503/декой → HIDE).

**Вывод №9.a:** host-выбор и вердикт show/hide — **обязанность единого б`alancer`, НЕ провайдера**.
Провайдеры (в т.ч. все 10 обязательных) только производят контент; какой источник показать и с
какого хоста играть решает один `createAvailabilityChecker`. ALL multicluster через один balancer = **ДА**.

## 2. Provider→balancer путь (жизненный цикл карточки → /videos → /video)

1. Карточка: `/api/lampa/sources` → `availability.card(query, uid)` → вердикты по всем источникам.
2. FOUND-row (authoritative show:true + host) → **pinMap** `[uid|providerId] → {host, ts, ttl}`.
3. `/api/lampa/videos` → `store.getVideosForRequest` → для каждого видимого провайдера
   `provider.videos(withPinnedHost(context, provider.id))`.
4. `withPinnedHost` → читает `pinMap[uid|providerId]` → инъектирует `query.host = <host>` (preferred-first
   стартовая нода SkazClient). Хост провайдера A никогда не утекает в B (keyed по providerId).
5. `/api/lampa/video` (ленивый резолв call/play) → `provider.resolveVideo(withPinnedHost(…))` — тот же пин.

**Вывод №9.b:** путь карточка→/videos→/video сквозной и единый, пин «карточка→резолв»
(pinMap→query.host) доставляется через store, не через сам провайдер.

## 3. Host-bound URL-правила

**Инвариант:** `/proxy/<hash>.m3u8` валиден ТОЛЬКО на хосте, сгенерировавшем контент карточки.
`generationHost == resolveHost`.

Как обеспечивается:
- `SkazProvider.collectMovieCards/_cachedCollectMovieCards` и `resolveMovieVideo/resolveSerialVideo`
  резолвят карточку **тем же путём** (pageParams + pinnedHost из `query.host`). Обе стороны обязаны
  сойтись на одной финальной странице карточек одного хоста (голос-индекс ленивого резолва совпадает
  с items в списке).
- `resolveCardItem` → `client.resolveVideoJson(effectiveURL, rchOptions)` — effectiveURL=card.stream||card.url
  (фикс SKAZ-MANIYA-002). `/proxy` отдаёт тот же хост, что держал lite-страницу.
- `_pickHost`/`_scanLite` — ротация с preferred-first: пин не жёсткий, при не-контенте пина или декое
  падает на следующий хост **и там же генерирует и резолвит** (generation==resolve всегда).

**Живая проверка (hdvb, Форрест Гамп 448):**
| pin | resolve `/proxy` | вердикт |
|-----|------------------|---------|
| online3.skaz.tv | online3.skaz.tv | **BOUND ✔** (пин здоров → и навигация, и резолв на нём) |
| online8.skaz.tv | online3.skaz.tv | фоллбэк (online8 legacy без hdvb → контент-хост online3; generation==resolve) |
| 94.249.239.63 | online3.skaz.tv | фоллбэк (аналогично) |

MISMATCH-строки — **НЕ call-url и НЕ потеря привязки**: это корректный host-fallback (пин
preferred-first, не обязательный; контент физически на online3, там и резолвится `/proxy`).
Правило «не резолвить токен хоста A на хосте B без доказательства» соблюдается: доказательство =
у хоста B контент найден тем же сканом, что сгенерировал карточку.

## 4. Отдельно: host-fallback vs provider-fallback
- **Host-fallback** (внутри провайдера/скан-ротация SkazClient): одна и та же пара «карточка→резолв»
  перебирает хосты кластера при не-контенте/декое пина. Suppressed not suppressed.
- **Provider-fallback** (на уровне store/availability): native-first, скрытый skaz-близнец — фоллбэк
  при 0 items native (twinForPayload). Убивает путаницу «один источник дважды».

## 5. Подтверждённые факты (артефакты)
- Host-bound: `C:\tmp\hostbind.mjs` (3 пина hdvb, результат в §3).
- Проверка отсутствия call-url: `C:\tmp\decode_inners.mjs` (videoseed/hdvb/kodik/kinopub/alloha/veoveo
  → `/proxy` или CDN HLS, НИ ОДИН не call-url).
- 10-провайдерный прогон: `C:\tmp\drive_matrix.mjs`; inventory: `C:\tmp\inventory_live3.mjs`.
