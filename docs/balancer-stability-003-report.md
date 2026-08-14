# BALANCER-STABILITY-003 — single-flight для /api/lampa/sources/card

Дата: 2026-08-14/15. Статус: **live-подтверждено в shadow на VPS** (scratch `/tmp/maniya-shadow`,
деплоя НЕ было, коммитов НЕ было; прод-сервис 3000 не тронут).

## 1. Цель

Устранить **кэш-стампед** `/api/lampa/sources/card`: параллельные запросы одного ключа
(userUid:serial:source:count) каждый гоняли СВОЙ полный upstream calc (probe-цикл по всем
видимым источникам + OLD∩NEW гейт подтверждения), а не делили один. На живой матрице
READINESS-002 (GAP-013): **5 параллельных идентичных запросов → 4 разных набора вердиктов**,
латенция ×5, лишняя нагрузка на skaz-кластер (host rotation + retries под собственной же
нагрузкой).

**Фикс:** single-flight в `createAvailabilityChecker`. Параллельные запросы одного
cache-key **с одним force-флагом** выполняют ОДИН upstream calc; join-запросы получают тот
же результат (тот же Promise → тот же объект). Разные userUid/serial/source → разные
flightKey → каждый свой calc, не блокируют друг друга. force изолирован от non-force.
Запись в `inflight` удаляется в `finally` — rejected/timeout calc не отравляет flight.

**НЕ менялись**: availability rules (RULE-1..4), predicates, host rotation, online8
reservePolicy ('abstain'), провайдеры, `index.js`, playback, UI, TTL-константы.
`computeCard()` — байт-в-байт прежнее тело `card()`; добавлена только обёртка single-flight.

## 2. Дифф (только `server/src/availability.js`; `server/test/availability.test.js` — только тесты)

Две вставки + вынос тела:

1. **`const inflight = new Map()`** в замыкании checker'а (после `const cache = new Map()`) —
   карта «flightKey → Promise». Per-checker (как cache), не глобально.

2. **`card()`**: после кэш-check:
```js
const flightKey = `${key}:${force ? 'f' : 'n'}`;
const hit = force ? undefined : cache.get(key);
if (hit && ...) return {...cached:true...};
// single-flight
const pending = inflight.get(flightKey);
if (pending) return pending;          // join-запрос: тот же результат, тот же Promise
const promise = computeCard(query, userUid, sources, count, key);
inflight.set(flightKey, promise);
try {
  return await promise;
} finally {
  if (inflight.get(flightKey) === promise) inflight.delete(flightKey);
}
```

3. **`computeCard(query, userUid, sources, count, key)`** — вынесено тело прежнего `card()`
   (от `const started = Date.now()` до финального `return`), без изменений.

**Границы single-flight** (определены read-only анализом):
- **flightKey = cacheKey + force-флаг.** `cacheKey = fnv1aKey(id:serial:source:count:userUid)`
  (availability.js:808-813) уже включает userUid, serial, source, count → полная изоляция по
  этим измерениям. Отдельный force-бит: force = «свежий calc», его результат не должен быть
  «унаследован» идущим non-force calc'ом (и наоборот).
- **Разные ключи не блокируют друг друга**: каждый entry в `inflight` — независимый Promise.
- **Ошибка/таймаут recovery**: entry удаляется в `finally`. Даже если future-код позволит
  `computeCard()` отклониться (сейчас функционально не может — все пробы в `allSettled`,
  см. §4), следующего запроса не «застревает» на битом promise.

## 3. Unit/интеграционные тесты (`server/test/availability.test.js`, +6)

| # | тест | что доказывает |
|---|------|----------------|
| 1 | **5 параллельных одинаковых** | 1 upstream calc (3 fetch: alloha+rezka+kinopub; filmix trusted), все 5 — `sources ===` (тот же объект результата), набор идентичен 5/5, post-flight hit без upstream |
| 2 | **10 и 20 параллельных** | 1 calc на 10 и на 20, один объект результата каждый раз |
| 3 | **разные userUid** | НЕ дедуплицируются (3 uid → 3 calc = 9 fetch), не блокируют друг друга, разные объекты |
| 4 | **serial/source в ключе** | разные ключи → разные полёты (3 calc), не блокируют |
| 5 | **force изолирован** | force∥force → 1 calc; non-force∥force → 2 calc (force не «наследует» non-force) |
| 6 | **slow-flight (timeout) + recovery** | rezka «завис» → один calc пробует rezka ОДИН раз (h1+h2), 5 join-запросов разделяют полёт; batch < 5×; после разрешения — кэш-hit; force — свежий calc (flight не «застрял») |

**Счётчик upstream на calc при контент-хэндлере = 3** (alloha, rezka, kinopub; filmix — trusted
без пробы), совпадает с существующими тестами кэша.

**Результат**: availability.test.js **39/39 pass** (все pre-existing + 6 новых). Полный сьют
**551 tests: 543 pass, 2 fail (pre-existing api.test.js pluralization «26803 дня» vs regex
`\d+ дней` — баг теста, не прода), 6 skip**. Регрессий нет: все pre-existing тесты
card/cache/concurrency/self-heal/OLD∩NEW гейт/host-политика проходят неизменёнными.

## 4. Live shadow на VPS (scratch `/tmp/maniya-shadow`)

Методика: копия локального `server/src` (**NEW**, single-flight) + копия прод `.env`
(реальные creds/хосты) в `/tmp/maniya-shadow`; **тот же скрипт** `shadow-card.mjs` прогоняется
против **OLD** (`/opt/maniya-online/server/src/availability.js`, прод-код) и **NEW**. `reservePolicy:
'abstain'` (прод-дефолт), счётчик upstream-вызовов через fetchImpl-обёртку, `userUid =
sha256(token).slice(0,16)` из прод users.json. Прод-сервис (порт 3000) НЕ тронут, ничего не
коммитилось и не деплоилось.

### 4.1 OLD vs NEW — параллельные идентичные запросы (тайтл forrest, реальный кластер)

| N | NEW upstream | OLD upstream | NEW wall | OLD wall | NEW distinct sets | OLD distinct sets | NEW distinct elapsed | OLD distinct elapsed |
|---|---|----|----|----|----|----|----|----|
| 5  | **23** | 129 | 1.86 s | 12.1 s | 1 | 1 | 1 | 5 |
| 10 | **23** | 717 | 3.15 s | 12.2 s | 1 | **2** | 1 | 8 |
| 20 | **23** | 1482 | 1.59 s | 6.9 s | 1 | 1 | 1 | 20 |

- **NEW: upstream = 23 для ЛЮБОГО N** — ровно один calc (16 источников, filmix trusted).
  Post-flight hit (`afterCached:true`), upstream не вырос (hit делает 0 upstream).
- **OLD: upstream растёт сверхлинейно** (N=10 → 717 = 72/запрос; N=20 → 1482 = 74/запрос).
  Стампед сам сатурирует кластер → host rotation + `confirmWithBackoff` retries повторяются
  в каждом из N calc'ов → upstream на calc растёт с нагрузкой.
- **NEW: identicalElapsed=true** (все join-запросы — один Promise → одно и то же
  `elapsed_ms`), **OLD: distinctElapsed = N** (каждый calc свой).
- **N=10 у OLD: 2 разных набора вердиктов** — репродукция GAP-013 на реальном API. NEW —
  всегда 1 набор.
- Wall: NEW — длительность ОДНОГО calc (сетевой); OLD — N calc'ов, упирается в дедлайн 12 s.

### 4.2 Изоляция (NEW): разные ключи НЕ дедуплицируются

| режим | upstream (прогон 1) | upstream (прогон 2) | ожидание |
|-------|----------|----------|----------|
| multi-uid (3 разных uid, параллельно) | **60** | **78** | 3 отдельных calc, не блокируют друг друга |
| force (non-force ∥ force, параллельно) | **46** | **106** | 2 отдельных полёта: force изолирован от non-force |
| concurrent (N одинаковых) | **23** (N=5/10/20) | — | один calc на N |

- **Один forrest-calc = 23 upstream** (16 источников, filmix trusted без пробы) — точная база
  из матрицы (forrest: NEW=23, OLD=23). Значит multi-uid ≈ 3×23, force ≈ 2×23: **разные
  ключи дают каждый свой полный calc, дедупликации нет** — изоляция userUid/serial/source/force
  работает как задумано.
- Разброс прогонов (60→78, 46→106): 2-3 calc, запущенные одновременно, сатурируют кластер →
  host rotation + `confirmWithBackoff` retries растут (тот же эффект, что OLD-стампед, только
  для законно-разных ключей). В прогоне 1 этого окна даже NEW multi-uid упирался в дедлайн
  12 s — кластер сегодня в насыщении (см. §5: cold p95=9.5 s). single-flight эти calc'и не
  дедуплицирует (ключи разные) — это область GAP-014 (cold latency P2), не этой задачи.

### 4.3 Матрица вердиктов NEW vs OLD (10 тайтлов × 16 источников = 160 ячеек)

- Совпало **157/160**. Отличались 3 ячейки — **все kinopub** (matrix/oa/silo): NEW=hide,
  OLD=show в первом прогоне.
- **Доказано: кластерный дрейф, НЕ регрессия.** kinopub живёт через online8-302-туннель и
  известен burst-насыщением (GAP-005). При back-to-back interleave (NEW→OLD→NEW→OLD ×3) для
  тайтла matrix **обе версии согласованы** (kinopub:1 у обеих) — NEW сам переключился
  0→1 между запусками. single-flight поведенчески-нейтрален для ПОСЛЕДОВАТЕЛЬНОГО холодного
  calc (computeCard байт-в-байт прежний) — расхождение могло возникнуть только от ответов
  кластера, не от кода.

## 5. Повтор concurrency и live-matrix на реальном API (прод 3000, OLD-код)

`readiness002-live.mjs` против `http://127.0.0.1:3000` (прод-сервис, НЕ деплой, read-only).

### 5.1 Concurrency на реальном API (тот же тайтл odyssey, 5 параллельных)

```
статусы: 200,200,200,200,200 | одинаковых наборов: 4
```

**GAP-013 репродуцирован на живом API**: 5 идентичных параллельных `/sources/card` → **4 разных
набора вердиктов**. Это OLD-базлайн для сравнения с NEW-шадоу (§4.1): NEW даёт 1 набор, 23
upstream; OLD на HTTP — 4 набора, 5 отдельных calc'ов.

### 5.2 Live-matrix (10 тайтлов × 16 источников = 160 ячеек)

| метрика | HTTP re-run (этот отчёт) | READINESS-002 (2026-08-14) |
|---------|--------------------------|----------------------------|
| показано (show) | 139 | ~139 |
| items>0 (играет) | 102 | 102 |
| dead (show + videos=0) | 38 | 38 |
| **FP** (show + videos=0, без perr) | **38** | **38** |
| **FN** (hide + videos>0) | **1** (interstellar/skaz-kinopub, items=9) | **1** (kinopub/Интерстеллар) |
| /videos p50 / p95 / max | 346 / 1894 / 10426 ms | ~те же |
| /sources/card cold p50 / p95 | 3183 / 9487 ms | 1.4–2.0 s (кластер был быстрее) |
| /sources/card warm | 0 ms ×10 (кэш) | 0 ms ×10 |

FP/FN **идентичны** READINESS-002: состояние availability/videos не изменилось (single-flight
не трогает ни videos, ни вердикты — только дедупликацию параллельных card). Кластер сегодня
насыщеннее (cold p95 9.5 s) — операционное наблюдение, не регрессия. FP=38 — GAP-002/003/012
(dead-источники collaps/veoveo/filmix-частично), вне рамок этой задачи.

## 6. Доказательство отсутствия регрессий в P0/P1

| уровень | доказательство | результат |
|---------|----------------|-----------|
| Unit | полный сьют **551: 543 pass / 2 fail (pre-existing api.test.js pluralization) / 6 skip**; все pre-existing тесты card/cache/concurrency/self-heal/OLD∩NEW гейт/host-policy проходят **без изменений** | ✅ |
| Diff | `computeCard()` — байт-в-байт прежнее тело `card()`; добавлена только обёртка flight (inflight map + join/await/finally) | ✅ для одного последовательного холодного calc NEW ≡ OLD |
| Shadow matrix | NEW vs OLD по 160 ячейкам: **157/160 совпали**; 3 kinopub-ячейки = кластерный дрейф (interleave: обе версии согласованы) | ✅ |
| HTTP live-matrix | FP=38, FN=1 — **идентично** READINESS-002; videos-слой не тронут | ✅ |
| Availability rules | RULE-1..4, predicates, host rotation, online8 reservePolicy, TTL, providers — не менялись | ✅ |

## 7. Ограничения (соблюдены)

- НЕ менялись: availability rules, predicates, host rotation, online8 reservePolicy,
  провайдеры, `index.js`, playback, UI, TTL.
- НЕ коммитилось, НЕ деплоилось. Прод-сервис 3000 не тронут; весь live — scratch
  `/tmp/maniya-shadow` + HTTP-запросы к прод API (read-only).
- Реальные секреты в отчёт не попадают (маскировка).
- `computeCard()` функционально не может отклониться через fetch (все пробы и подтверждения
  в `Promise.allSettled` → row-level inconclusive, calc всегда resolve). `finally`-очистка
  flight — страховка для будущих веток (если появится синхронный throw вне allSettled);
  timeout-recovery проверен в unit (slow-flight тест) и на shadow (flight чист, force —
  свежий calc).
