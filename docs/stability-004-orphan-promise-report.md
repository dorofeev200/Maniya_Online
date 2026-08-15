# STABILITY-004 — Orphaned Promise / Process Crash Protection

Дата: 2026-08-15. Статус: **READY FOR REVIEW** (реализовано, протестировано, НЕ закоммичено).

---

## 1. Задача (spec)

Изолированная задача: любой уже запущенный async probe-промис обязан иметь безопасный
rejection-handler, чтобы его **поздний** reject не стал `unhandledRejection` и не уронил
Node-процесс. Строго по плану: read-only анализ → root-cause → минимальный фикс →
8+ регрессионных тестов (включая process-level) → полный прогон → stress/burst →
OLD vs NEW (вердикты не меняются) → отчёт → STOP (без commit/push/deploy).

**Явно НЕ решаются этой задачей:** GAP-013 (422-флап / HARD_REFUSAL), Collaps visibility,
Collaps ID route, COLLAPS-SHAPE, изменение availability semantics, изменение OLD∩NEW,
HIDE_TTL, TRUSTED_ALWAYS_VISIBLE, online8 abstain, single-flight, provider logic,
registry, UI, client, Skaz provider, E-Online provider behavior.

---

## 2. Факты — краш ПРОДа (live)

- **journald 17:34:25**: карточка `durationMs:12009` — дедлайн карточки исчерпан на 12 с.
- **`HttpError: Collaps HTTP 422`** в `Object.present (availability.js:418)` — embed-запрос
  к collaps завершился 422 **ПОСЛЕ** того, как `attempt()` уже вернул deadline-reject.
- Итог: unhandled rejection → `exit status=1` → systemd restart через ~5 с → пользователи
  получили **502** на карточке (Дом Дракона / Скайуокер).
- Триггер: burst параллельных карточек под перегрузкой — несколько probe-промисов
  одновременно завершаются после исчерпания своих дедлайнов.

---

## 3. Root cause

В `server/src/availability.js` (nativeProbe, `attempt()`):

```js
const attempt = (promise) => {
  const remaining = Math.max(0, deadline - Date.now());
  if (remaining <= 0) return Promise.reject(new Error(`${label} deadline`)); // ← ОРФАН
  ...
};
```

- `promise` — это **уже запущенный** async-вызов (`probe.present(...)` / `provider.search(...)`
  передаются как результат вызова, аргумент вычисляется ДО входа в `attempt`).
- При `remaining <= 0` attempt возвращал deadline-reject **без прикрепления rejection-consumer
  к `promise`**. Поздний reject этого промиса (например `HttpError 422/403`, timeout, ECONNRESET)
  оставался без обработчика → `unhandledRejection` → краш Node-процесса.
- Ветка `remaining > 0` **безопасна**: `Promise.race([promise, timeout])` прикрепляет
  rejection-handler к обоим промисам (loser-режект потребляется race).

---

## 4. Минимальный фикс (только этот файл изменён в проде)

`server/src/availability.js` — 13 вставок / 1 удаление относительно HEAD `b536466`:

```js
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
```

**Проверка «фикс не меняет вердикт и не прячет ошибки»:**
- Вердикт ветки остаётся ровно тем же `Promise.reject(deadline)` — наружу отдаётся НЕ результат
  `promise`, а deadline-ошибка; `catch(() => {})` никак не влияет на возвращаемое значение.
- Реальные ошибки не скрываются: в этой ветке результат `promise` не доходит ни до кого —
  ни у кого не было бы возможности на него среагировать. Catch — чисто no-op-поглотитель.
- `remaining > 0` (race/timeout) не тронут — семантика таймаута идентична.
- Нет двойного await, нет гонок: catch создаёт производный промис, который отбрасывается.
- OLD∩NEW / single-flight / кэш потребляют вердикт nativeProbe/card — не изменился.
- В коде фикса нет обращений к `name`/`displayName`: идентификаторы (provider id/query)
  используются как и раньше, имена как stable-идентификаторы не задействованы.

---

## 5. Анализ всех подобных паттернов (read-only, классификация A/B/C)

Полный аудит promise-сайтов `server/src` — **это ЕДИНСТВЕННОЕ место класса A**:

**Класс A — орфан (исправлен):**
- `attempt()` в nativeProbe (availability.js), вызывается для `probe.present()` и
  `provider.search()` — единственные sites, где истекающий дедлайн оставлял запущенный
  промис без rejection-consumer.

**Класс B — безопасно (rejection потребляется; проверено, не трогать):**
- `fetchHost`, `probe`/`checkBalancer`/`confirmAbsence`, `confirmWithBackoff`,
  `confirmNativeAbsence` — всегда await/двойное подтверждение с обработкой ошибок.
- Card single-flight (промис в inflight-map) — **всегда awaited** вызывающими сторонами.
- `computeCard` — `Promise.allSettled` (rejection поглощаются).
- Роуты index.js — все промисы awaited.
- proxy `requestOnce`/`collectBody` — awaited inline.
- SkazClient / HttpClient / EoClient / LampacProvider — inline `await` + `try/catch/finally`.
- RateLimiter — resolve-only.
- RezkaProvider:346 — `.then` внутри `Promise.all`.

**Класс C — НЕ промис (отдельная задача, вне scope):**
- `proxy.js:202` — redirect-ветка `upstream.resume()` без прикреплённого `'error'`-listener:
  unhandled stream `'error'` **событие**, не unhandledRejection. См. §12.

---

## 6. Целевые регрессионные тесты

`server/test/stability-004.test.js` — **12 тестов**, env изолирован (все native-провайдеры
выключены, skaz-окружение стабом). Счётчик `orphans` через `process.on('unhandledRejection')`
на уровне тест-процесса.

| # | Тест | Ожидание |
|---|------|----------|
| 1 | late **reject** после deadline | show:true, inconclusive, reason:'error', через 250мс orphans===0 |
| 2 | late **resolve** после deadline | inconclusive, orphans===0 |
| 3 | **HttpError 422** после deadline | inconclusive (НЕ host-block — 422 пришёл после исчерпания), orphans===0 |
| 4 | **HttpError 403** после deadline | inconclusive, orphans===0 |
| 5 | **timeout** после deadline | inconclusive, orphans===0 |
| 6 | **ECONNRESET** после deadline | inconclusive, orphans===0 |
| 7 | normal успешная проба | show:true, authoritative, found — поведение не изменилось |
| 8 | normal пустой embed | show:false, authoritative, absent — вердикт не изменился |
| 9 | normal HttpError 422 **до** deadline | host-block сохранён (status 422) — GAP-002/авторитативность не задеты |
| 10 | normal timeout (remaining>0 → race) | inconclusive, orphans===0 |
| 11 | **process-level**: NEW code | exit 0, `RESULT:error:show=true`, `ORPHANS:0` |
| 12 | **process-level negative control**: OLD pattern | exit 1, stderr `ORPHAN:`, `ORPHANS:1` |

**Результат: 12/12 pass.**

Process-level инфраструктура: `server/test-helpers/stability-004-child.mjs` (NEW),
`stability-004-old-attempt-child.mjs` (negative control), `stability-004-burst-child.mjs`
(burst). Дочерние скрипты лежат ВНЕ `test/` (иначе `node --test` авто-выполнял бы их,
а negative-control намеренно выходит с кодом 1).

---

## 7. Process-level тест

Отдельные дочерние Node-процессы (spawnSync), доказывают поведение на **уровне процесса**,
а не только unit-вызов `.catch`:

- **NEW code** (`stability-004-child.mjs`): коллапс-стаб recordByKeys отвергает `HttpError 422`
  через 150мс, дедлайн уже в прошлом. Итог: **exit 0**, stdout `RESULT:error:show=true` +
  `ORPHANS:0`. Орфана НЕТ, вердикт прежний.
- **Negative control** (`stability-004-old-attempt-child.mjs`): тот же сценарий через старый
  `attempt` (без `.catch`). Итог: **exit 1**, stderr `ORPHAN:Collaps HTTP 422`,
  stdout `ORPHANS:1`. Харнесс **обязан** ловить регрессию — если кто-то вернёт старый паттерн,
  тест 12 упадёт.

---

## 8. Полный прогон

```
NODE_ENV=test node --test
tests  585   (было 573 — ровно +12 новых, без изменений существующих)
pass   579   (было 567 — ровно +12 pass)
fail   0     (было 0)
skip   6     (было 6 — те же, новых пропусков нет)
```

Availability-сьюты отдельно: 86/86 pass. **Регрессий нет.**

---

## 9. Stress / burst тест

`stability-004-burst-child.mjs`: **20 параллельных nativeProbe-вызовов**, дедлайн у всех в
прошлом (`Date.now() - 50`), под каждым — collaps-стаб с **разбросом времени позднего reject**
150–350мс и 6 типов отказа (422/403/500/ECONNRESET/native-timeout/ECONNREFUSED) — имитация
prod-burst, где probe.present() завершается ПОСЛЕ исчерпания дедлайна.

Тот же сценарий гоняется против OLD и NEW через `IMPORT_SRC`.

---

## 10. OLD vs NEW

| Метрика | OLD (HEAD, attempt без catch) | NEW (фикс) |
|---------|-------------------------------|------------|
| Бурст 20 карточек, дедлайн истёк | **20 unhandled rejections** (422/403/500/ECONNRESET/timeout/ECONNREFUSED) | `ORPHANS:0` |
| Выход процесса | **exit 1** (краш — как live journald 17:34:25) | **exit 0** (процесс жив, health 200) |
| Вердикты availability | все inconclusive (reason:'error', show:true) | **идентично** — все inconclusive |

**Вердикты бизнес-решения availability ИДЕНТИЧНЫ**: и OLD, и NEW дали `all-inconclusive`
(`VERDICTS:all-inconclusive` в обоих прогонах). Фикс меняет ТОЛЬКО судьбу позднего
rejection-а процесса, не решение показа. Единственное различие — OLD роняет процесс,
NEW выживает.

---

## 11. Что фикс НЕ меняет

- **НЕ** меняет availability semantics: вердикты (show/authoritative/inconclusive/reason)
  для нормальных проб, дедлайн-веток, host-block 422/403, таймаутов — прежние (тесты 7–10).
- **НЕ** трогает GAP-013 / HARD_REFUSAL_STATUSES: 422 до дедлайна остаётся authoritative
  host-block (тест 9).
- **НЕ** трогает OLD∩NEW / single-flight / кэш / HIDE_TTL: они потребляют вердикт, который
  не изменился.
- **НЕ** трогает display-name логику: имена как stable-идентификаторы нигде в изменённом
  коде не используются (STABILITY-004 не пересекается с identity/presentation-аудитом).

---

## 12. Подобные проблемы, НЕ решённые этой задачей (вне scope)

1. **Класс C — `proxy.js:202`**: redirect-ветка `upstream.resume()` без `'error'`-listener —
   при обрыве апстрима unhandled **stream 'error' событие** (не promise). Отдельная задача,
   другой механизм краша.
2. **GAP-013**: 422-флап и переоценка 422 как authoritative «нет» — отдельный P1-задание
   (semantics, не crash).
3. **Collaps visibility / Collaps ID route / COLLAPS-SHAPE** — отдельные P1 (identity/route).
4. **HIDE_TTL / TRUSTED_ALWAYS_VISIBLE / online8 abstain** — политики показа, не процесс.
5. **single-flight**, provider logic, registry — явно вне этой задачи.

---

## 13. Вердикт по обязательствам

| Проверка | Значение |
|----------|----------|
| Root cause | `attempt()` возвращал deadline-reject без rejection-consumer для уже запущенного probe-промиса → поздний reject = unhandledRejection → краш |
| Fix | `promise.catch(() => {})` перед deadline-reject (availability.js, 13+/1-) |
| Files changed | `server/src/availability.js` (+ тест `stability-004.test.js`, 3 child в `test-helpers/`, этот отчёт) |
| Targeted tests | 12/12 pass |
| Full suite | 585 tests / 579 pass / 0 fail / 6 skip (было 573/567/0/6) |
| Process-level test | NEW exit 0 + ORPHANS:0; negative control exit 1 + ORPHAN — харнесс ловит регрессию |
| Stress test | OLD: 20 unhandledRejection → exit 1; NEW: ORPHANS:0 → exit 0 |
| OLD vs NEW | вердикты availability ИДЕНТИЧНЫ (all-inconclusive); отличается только выживание процесса |
| Production changed? | **NO** |
| Commit? | **NO** |
| Push? | **NO** |
| Deploy? | **NO** |

---

## 14. Безопасность

- В отчёте/коде/тестах нет реальных credentials/токенов (все env-стабы синтетические).
- Временные скрипты с секретами не создавались; scratch-копия OLD (`stability004-old`,
  HEAD-исходник без секретов) удалена.
- VPS/production не тронут; live shadow не требовался (феномен воспроизводится локально).
- `api.ortified.ws` egress не менялся.

---

## 15. Как воспроизвести

```bash
cd server
NODE_ENV=test node --test                                   # 585/579/0/6
NODE_ENV=test node test/stability-004.test.js               # 12/12 (вкл. 2 process-level)
# Burst NEW:
NODE_ENV=test BURST_CARDS=20 BURST_DELAY_MS=100 node test-helpers/stability-004-burst-child.mjs   # ORPHANS:0, exit 0
# Burst OLD (регрессия-проверка харнесса): откатить attempt без catch → ORPHANS:20, exit 1
```

---

## 16. STABILITY-004 — READY FOR REVIEW

Фикс минимален (одна ветка в `attempt()`), изолирован, процесс-уровень доказан и в OLD
(краш воспроизведён 20/20 orphan) и в NEW (0 orphan, exit 0), вердикты availability
идентичны, полный прогон без регрессий. Ничего не закоммичено, не запушено, не задеплоено.
Следующий шаг — по отдельному одобрению: commit → backup, деплой, live-verify.
