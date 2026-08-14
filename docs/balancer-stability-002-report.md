# BALANCER-STABILITY-002 — Fix card cache: INCONCLUSIVE не блокирует кэширование

Дата: 2026-08-14. Статус: **live-подтверждено** (scratch `/tmp/mod-src` на VPS, деплоя НЕ было, коммитов НЕ было).

## 1. Цель

`/api/lampa/sources/card` должен возвращать **стабильный список источников** для одной
карточки в течение TTL. Корень нестабильности (`docs/balancer-stability-card-report.md`):
`card()` кэшировал результат ТОЛЬКО когда ни одна строка не inconclusive
(`if (!rows.some(r => r.inconclusive)) cache.set(...)`). Для «Дома Дракона»
kinopub/pidtor/solntse — всегда inconclusive (предикатный «оптимистичный» show) → кэш
не заполнялся никогда → `cached=false 10/10`, **2 разных набора из 10**, 1.1–5.4 s на
запрос. E-Online стабилен (1 паттерн ×10) потому что кэширует результат безусловно
(кластерный memkey 5 мин).

**Фикс:** INCONCLUSIVE-строки НЕ запрещают кэшировать карточку целиком. Три состояния
(AVAILABLE / UNAVAILABLE / INCONCLUSIVE) остаются различными; в кэш пишется фактический
вердикт каждой строки (`inconclusive`-флаг остаётся в ряду), на hit возвращается тот же
набор. INCONCLUSIVE **не сворачивается** в show:true/false навсегда — entry помечается
`hasInconclusive` → не definitive (self-heal по TTL / force). Политика online8 и predicates
НЕ менялись. OLD∩NEW гейт сохранён.

## 2. Дифф (только `server/src/availability.js`, `index.js` не тронут)

**Было** (кэш только при отсутствии inconclusive):
```js
if (!rows.some((row) => row.inconclusive)) {
  const hasConfirmedHide = rows.some((row) => row.show === false);
  cache.set(key, { ts: Date.now(), sources: rows, ttl: hasConfirmedHide ? HIDE_TTL_MS : ttlMs });
  sweep();
}
return { sources: rows, count, cached: false, elapsedMs };
```

**Стало** (безусловный кэш + tri-state + force):
```js
const hasInconclusive = rows.some((row) => row.inconclusive);
const hasConfirmedHide = rows.some((row) => row.show === false);
cache.set(key, {
  ts: Date.now(),
  sources: rows,                 // фактический вердикт каждой строки, incl. inconclusive
  ttl: hasConfirmedHide ? HIDE_TTL_MS : ttlMs,   // confirmed-hide → 60с (self-heal), иначе 5 мин
  hasInconclusive
});
sweep();
return { sources: rows, count, cached: false, elapsedMs, hasInconclusive };
```

- Сигнатура: `card(query = {}, userUid = '', force = false)` — третий аргумент опционален,
  существующие вызовы `card(query, uid)` не меняются (индекс.js не тронут).
- `const hit = force ? undefined : cache.get(key);` — force пропускает чтение кэша
  (принудительный refresh, запись остаётся → entry обновляется).
- Hit-путь: `{ sources: hit.sources, count, cached: true, elapsedMs: 0, hasInconclusive: Boolean(hit.hasInconclusive) }`.

## 3. Unit-тесты (`server/test/availability.test.js`)

**Переписаны 3 теста**, кодировавших старое «inconclusive → не кэшируем» (`second.cached`
false → **true**, hit сохраняет `inconclusive`/`confirmInconclusive`/`accsdb`, fetches
уменьшены — второй вызов hit без повторного checksearch).

**Добавлены 8 новых тестов:**
1. **MIXED** (available + inconclusive + unavailable в одной карточке) → кэшируется целиком,
   hit возвращает идентичный (id,show)-набор, INCONCLUSIVE и confirmed переживают кэш.
2. **10 последовательных** → 1 MISS + 9 HIT, наборы идентичны 10/10.
3. **userUid** не смешивает кэш (phone2 после phone1 → cached:false).
4. **Отдельные ключи** id / serial 0↔1 / source tmdb↔kinopoisk → MISS (по существующему
   `fnv1aKey(id:serial:source:count:uid)`; season в ключ не входит — как memkey Lampac,
   задокументировано).
5. **TTL** с малым `ttlMs=50ms`: второй вызов hit, после 70ms паузы — MISS.
6. **Self-heal + force**: inconclusive → fake-fetch меняется на content → `card(q,uid,true)`
   → cached:false, новый authoritative show; не-форс после → cached:true с НОВЫМ набором.
7. **OLD∩NEW гейт на hit**: confirmed:true/authoritative переживают кэш.
8. **Hit-метрики**: elapsedMs=0 на hit, source-set hit == miss.

Результат: **33/33 pass** в availability.test.js; полный сьют **483 pass, 2 fail** — те же
2 известных pre-existing date-rot фейла в api.test.js (плюрализация «26802 дня», к правке
не относятся).

## 4. Live-проверка на VPS (scratch `/tmp/mod-src`, реальные creds из server/.env)

Копия реального `server/src` + реальный `.env` в `/tmp/mod-src`; `userUid =
sha256(token).slice(0,16)` как index.js:145. `/opt/maniya-online` НЕ трогался (не деплой).

### 4.1 Латенции и source-set MISS/HIT (чеклист 1, 2, 5, 11, 12)

| карточка | query | MISS (полный check) | HIT | set hit==miss |
|----------|-------|---------------------|-----|---------------|
| Дом Дракона | id=94997 serial=1 | cached=false, **1998 ms**, inc=false | cached=true, **0 ms** | ✅ |
| Одиссея 2026 | id=1368337 | cached=false, **1456 ms**, inc=false | cached=true, **0 ms** | ✅ |
| Последний дом 2026 | id=1284041 | cached=false, **1355 ms**, inc=false | cached=true, **0 ms** | ✅ |
| Forrest Gump | id=13 | cached=false, **1514 ms**, inc=false | cached=true, **0 ms** | ✅ |

Каждая карточка — свой ключ (первый вызов каждой = MISS, подтверждает чеклист 5).

### 4.2 Дом Дракона ×10, свежая uid (чеклист 10)

`cached flags: false,true,true,true,true,true,true,true,true,true` — **1 MISS + 9 HIT**.
**distinct source-sets: 1** (до фикса: **2**). Стабильный список в течение TTL достигнут.

### 4.3 userUid — второй телефон (чеклист 4)

phone2 (другая uid): первый вызов HoTD → **cached=false** (MISS, не смешивает кэш phone1),
второй → cached=true (свой entry). Кэш разделён по `userUid` в ключе.

### 4.4 Отдельные ключи: serial (чеклист 6)

HoTD `serial:0` при закэшированном `serial:1` → **cached=false** (отдельный ключ). Source
tmdb↔kinopoisk и id — unit-покрыты.

### 4.5 Self-heal: force (чеклист 8)

`card(q, uid, true)` → **cached=false** (принудительный свежий checksearch, entry заменён);
следующий не-форс вызов → cached=true с новым вердиктом. INCONCLUSIVE-кэш НЕ definitive —
по TTL (5 мин / 60с для confirmed-hide) или force возможен новый вердикт.

### 4.6 OLD∩NEW гейт (чеклист 9)

На hit у HoTD все 15 скрытых строк сохраняют **confirmed:true** (двойная проверка:
checksearch «нет» + прямой lite-page «нет», с retry-with-backoff) — гейт переживает кэш,
скрытие не «протекает» и не откатывается.

### 4.7 Сравнение с E-Online (тот же кластер, те же creds)

`lite/events?life=false`, HoTD, 10 прогонов (тот же метод, что Mode C отчёта):

| | E-Online | Maniya (после фикса) |
|---|----------|----------------------|
| первый (свежий) | 624 ms | 1998 ms (полный checksearch 14 балансеров) |
| последующие | 35–37 ms (кластерный memkey) | **0 ms** (in-process кэш) |
| distinct наборов ×10 | **1** | **1** |
| статусы | 200 ×10 | — |

Оба стабильны 10/10. EO — за счёт кластерного memkey (5 мин, шарится между EO-клиентами);
Maniya — за счёт in-process кэша (5 мин, per-инстанс), hit даже быстрее (0 ms — без
сетевого round-trip). Наборы EO в этом окне: show → ashdi,eneyida,filmix,kinoukr,rhsprem
(универсум EO включает балансеры, которых у нас нет; из наших слагов общие — filmix,
rhsprem). Сравнение вердиктов по слагам — отдельная задача (online8), здесь не делалось.

## 5. Чеклист 12 пунктов

| # | проверка | статус | где |
|---|----------|--------|-----|
| 1 | MISS = один полный check | ✅ | live 4/4 (cached=false, 1.3–2.0 s) |
| 2 | 2-й запрос = HIT без re-checksearch | ✅ | live 4/4 (cached=true, elapsed=0) |
| 3 | 10 последовательных = одинаковый набор | ✅ | live: 1 distinct set |
| 4 | разные userUid не смешивают кэш | ✅ | live: phone2 → MISS |
| 5 | другой фильм = отдельный ключ | ✅ | live: 4 id, у каждого свой miss/hit |
| 6 | serial/source/uid → отдельные ключи (fnv1a) | ✅ | live serial 1↔0; unit id/serial/source/uid |
| 7 | TTL = 5 минут | ✅ | unit ttlMs=50ms; код 5 мин / HIDE 60с |
| 8 | Self-heal: INCONCLUSIVE не definitive | ✅ | live force → новый вердикт; unit force |
| 9 | OLD∩NEW гейт сохранён | ✅ | live: confirmed:true переживает hit (15/15) |
| 10 | Дом Дракона ×10 стабилен на HIT | ✅ | live: 1 set (было 2) |
| 11 | Одиссея 2026 / Последний дом 2026 / Forrest Gump | ✅ | live: 3/3 MISS→HIT, наборы идентичны |
| 12 | Latency и source-set MISS/HIT | ✅ | live: 1.3–2.0 s vs 0 ms; set 4/4 равны |

## 6. Операционные наблюдения

- **INCONCLUSIVE-путь в этом окне live не проявлялся** (`hasInconclusive=false` у всех
  карточек: кластер отвечал авторитетно, accsdb не срабатывал). Это значит, что в ДАННОМ
  окне даже старая версия закэшировала бы эти карточки. Различие старого/нового поведения
  на inconclusive-нагруженных окнах (главный root-cause кейс из stability-card-report)
  детерминированно покрыто unit-тестами (MIXED, accsdb, timeout) — live невозможно
  форсировать таймаут кластера.
- **Rate-limit кластера**: при burst (~112 checksearch + 10 lite/events за ~15 с из одного
  IP/VPS) online3.skaz.tv ответил на `lite/events` **429**; после 60 с паузы — 200.
  Checksearch-запросы card() при этом проходили (авторитетные confirmed-вердикты).
  Эндпоинт `lite/events` чувствителен к burst; для будущих сравнений — задержки между
  вызовами ≥3 с.
- Вердикты кластера в этом окне отличаются от окна отчёта (2026-08-13): для HoTD почти все
  балансеры — подтверждённый «нет», filmix — trusted show. Состояние кластера колеблется
  между окнами; **внутри TTL список теперь стабилен** — это цель задачи. Разбор «почему
  кластер говорит нет / роль online8» — отдельная задача (online8 investigation), policy
  не менялась.

## 7. Ограничения (соблюдены)

- НЕ менялись: online8 host-policy, predicates (checkSearchPredicate / host rotation),
  `index.js`, TTL-константы.
- НЕ коммитилось, НЕ деплоилось. Всё live — через scratch `/tmp/mod-src` на VPS
  (`/opt/maniya-online` не тронут). Scratch и харнесс удалены после прогона.
- Код-артефакты (правка availability.js + тесты) остаются в рабочем дереве как
  незакоммиченные изменения.
