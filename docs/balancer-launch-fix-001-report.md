# BALANCER-LAUNCH-FIX-001 — исправление pinnedHost (availability.js)

Дата: 2026-08-19. 
Статус: **IMPLEMENT** (code + tests, без commit/push/deploy — ждёт отдельного разрешения).

## 1. Подтверждённый MANIYA BUG (BALANCER-LAUNCH-GAP-001)

`/videos` и `/video` не перезапускают availability, но используют `pinnedHost()` для preferred-first ноды. Пин ломался в двух местах:

1. **TTL пина укорачивался до 60с**, если на карточке хоть один источник был скрыт (`pinTtl = hasConfirmedHide ? HIDE_TTL_MS : ttlMs`). Рабочий источник получал короткий TTL из-за чужого HIDE.
2. **Пин не перезаписывался при cache-hit**: `card()` возвращала значение из кэша, не касаясь `pinMap`. Повторное открытие карточки оставляло `/videos` без пина — полный 6-хостовой скан.

## 2. Исправления в `server/src/availability.js`

Оба исправления локальны и не трогают семантику HIDE/SHOW, пробинг, провайдеров или registry.

### 2.1. PIN TTL больше не зависит от `hasConfirmedHide`

**Before:**
```js
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
```

**After:**
```js
for (const row of rows) {
  const pk = `${userUid}|${row.id}`;
  const isFound = row.show === true && row.authoritative && Boolean(row.host)
    && !row.trusted && !row.accsdb;
  if (isFound) {
    pinMap.set(pk, { host: row.host, ts: Date.now(), ttl: ttlMs });
  } else {
    pinMap.delete(pk);
  }
}
```

Скрытие другого балансера больше не укорачивает TTL рабочего пина. Кэш entry по-прежнему использует `hasConfirmedHide ? HIDE_TTL_MS : ttlMs` — это не затронуто.

### 2.2. Cache-hit перезаписывает/продлевает пин

**Before:**
```js
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
```

**After:**
```js
const hit = force ? undefined : cache.get(key);
if (hit && Date.now() - hit.ts < (hit.ttl || ttlMs)) {
  if (hit.sources && Array.isArray(hit.sources)) {
    const now = Date.now();
    for (const row of hit.sources) {
      const pk = `${userUid}|${row.id}`;
      const isFound = row.show === true && row.authoritative && Boolean(row.host)
        && !row.trusted && !row.accsdb;
      if (isFound) {
        pinMap.set(pk, { host: row.host, ts: now, ttl: ttlMs });
      } else {
        pinMap.delete(pk);
      }
    }
  }
  return {
    sources: hit.sources,
    count,
    cached: true,
    elapsedMs: 0,
    hasInconclusive: Boolean(hit.hasInconclusive)
  };
}
```

При любом cache-hit FOUND-ряды перезаписываются с текущим `ts` и `ttl: ttlMs`; не-FOUND ряды вычищают свой пин. Теперь повторное открытие карточки не оставляет `/videos` без пина.

## 3. Регрессионные тесты

Файл: `server/test/availability-launch-fix.test.js` (3 теста).

| # | тест | что проверяет |
|---|---|---|
| 1 | `pinnedHost TTL: FOUND-ряд живёт ttlMs даже когда другой источник скрыт` | При kinopub HIDE пин alloha всё ещё валиден через 90с (больше HIDE_TTL_MS). |
| 2 | `pinnedHost refresh: cache-hit перезаписывает pinnedHost` | После cache-hit на 290с pin продлевается и остаётся валидным на 310с. |
| 3 | `pinnedHost usage: после card() /videos получает preferred host` | pinnedHost возвращает ноду, где availability нашла контент. |

## 4. Результаты прогона тестов

```
✔ pinnedHost TTL: FOUND-ряд живёт ttlMs даже когда другой источник скрыт
✔ pinnedHost refresh: cache-hit перезаписывает pinnedHost
✔ pinnedHost usage: после card() /videos получает preferred host

✔ полный сьют server
℗ tests 747
℗ suites 14
℗ pass 741
℗ fail 0
℗ cancelled 0
℗ skipped 6
℗ todo 0
℗ duration_ms 6241
```

## 5. Live/shadow проверка (§LIVE)

Проведена 2026-08-19 с рабочей парой `SKAZ_ACCOUNT_EMAIL`/`SKAZ_UID` из production-конфига (секреты замаскированы). Проверены три фильма: контрольный пустыш Одиссея 2026 и два контентных — Матрица 1999, Интерстеллар 2014.

### 5.1. Методика

- Вызывался `defaultChecker.card(query, userUid)` — эквивалент `/api/lampa/sources/card`.
- Замерялся `pinnedHost(providerId, userUid)` после MISS и после HIT.
- Для `/videos` вызывался `SkazProvider.videos()` с `query.host = pinnedHost` и без него (очищался nav-cache между прогонами).
- Глобальный `fetch` был обёрнут счётчиком upstream-запросов.
- Для проверки TTL пин ждали 70с после первого вызова и перепроверяли `pinnedHost`.

### 5.2. Результаты

| фильм | availability | show | hide | found | pinnedHost после MISS | cache-hit | pinnedHost после HIT | pins через 70с |
|---|---|---|---|---|---|---|---|---|
| Одиссея 2026 | 36027ms / 107 req | 14 | 3 | 7 | есть (veoveo → 94.249.239.37) | 0ms / 0 req | сохранился | все валидны |
| Матрица 1999 | 19719ms / 101 req | 12 | 5 | 12 | есть (rutubemovie → 94.249.239.63) | 0ms / 0 req | сохранился | все валидны |
| Интерстеллар 2014 | 15419ms / 83 req | 13 | 4 | 13 | есть (alloha → online3) | 1ms / 0 req | сохранился | все валидны |

### 5.3. /videos — WITH pin vs NO pin

| фильм | провайдер | NO pin | WITH pin | разница |
|---|---|---|---|---|
| Одиссея 2026 | skaz-veoveo (pin → 94.249.239.37) | 13380ms / 3 req | 797ms / 1 req | **~16.8× быстрее, запросов в 3× меньше** |
| Матрица 1999 | skaz-rutubemovie (pin → 94.249.239.63) | 3354ms / 1 req | 425ms / 1 req | **~7.9× быстрее** |
| Интерстеллар 2014 | skaz-alloha (pin → online3) | 1458ms / 1 req | 845ms / 1 req | **~1.7× быстрее** |

### 5.4. Проверка критериев

A. **После FOUND pinnedHost существует:** ДА. Для каждого found-источника пин записан.

B. **Cache-hit сохраняет/продлевает пин:** ДА. Повторный `card()` — cache-hit (0–1ms, 0 запросов), все пины на месте.

C. **HIDE другого источника не сокращает TTL пина до 60с:** ДА. Через 70с после первого вызова все pinnedHost всё ещё валидны (у всех трёх фильмов есть HIDE-источники).

D. **`/videos` использует pinnedHost:** ДА. При `query.host` соответствующий провайдер отвечает за 0.4–1.3с вместо 1.5–13с без пина.

E. **Нет повторного полного availability scan перед запуском:** ДА. `/videos` не звонит обратно в `defaultChecker.card()`; он использует только pinnedHost и делает 1 запрос на нужную ноду (veoveo — 1 запрос, без пина — 3 запроса перед тем как найти контент).

F. **Задержка уменьшилась:** ДА. Особенно хорошо видно на Одиссее (проблемный veoveo, pin на 94.249.239.37): 13.4с → 0.8с.

### 5.5. Verdict

**FIX CONFIRMED.** Оба исправления работают live:
- пин не укорачивается HIDE-источниками;
- cache-hit продлевает пин;
- `/videos` использует его и значительно ускоряет запуск.

## 6. Изменённые файлы

- `server/src/availability.js` — 2 исправления (пин TTL, cache-hit refresh).
- `server/test/availability-launch-fix.test.js` — 3 регрессионных теста.
- `docs/balancer-launch-fix-001-report.md` — настоящий отчёт.

## 7. Ограничения / риски

- Кэш entry TTL по-прежнему короткий при `hasConfirmedHide` (60с). Поэтому после 60с карточка пересчитается заново — это ожидаемое поведение. Пин же теперь живёт до пересчёта карточки, и если пользователь откроет карточку повторно до истечения кэша, cache-hit продлит пин.
- Никаких commit/push/deploy в этой волне не делалось.
