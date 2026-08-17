# BALANCER-SEMANTICS-005-C — KINOPUB FALSE-NEGATIVE / HIDE SEMANTICS
## «Право availability прятать источник по двум подтверждённым 503/timeout checksearch» — проверка по канону E-Online/Lampac

**Дата:** 2026-08-16 (после `docs/balancer-post-w1-remaining-audit.md`)
**Тип:** READ-ONLY аудит Class C (4 kinopub-пары). Код/тесты НЕ менялись, commit/push/deploy НЕ выполнялись.
**Объект:** Аватар/kinopub (FN в r2: show:false при 7 items), Дюна/kinopub (14), Форрест/kinopub (25),
ДД/kinopub (10) + контроль Интерстеллар/kinopub.
**Acceptance criterion (условие задачи):** MANIYA ДОЛЖНА РАБОТАТЬ ПО СЕМАНТИКЕ E-ONLINE/LAMPAC.
E-Online/Lampac = КАНОНИЧЕСКИЙ ЭТАЛОН. Не проектировать новую «идеальную» модель.
**Метод:** перечитка канона `C:\Users\Admin\AppData\Local\Temp\Lampac\Online\OnlineApi.cs` (checkSearch 957-1053),
`Shared\Services\HTTP\Http.cs` (GetSpan/BaseGetReaderAsync), `Online\plugin.js` (startSource/lifeSource/onSelect/parse),
`Modules\OnlinePaid\KinoPub\Controller.cs`+`ModInit.cs`, `Shared\Controllers\BaseOnlineController.cs`; перечитка Maniya
`server/src/availability.js` (probe, confirmWithBackoff, computeCard OLD∩NEW, HIDE_TTL) и `public/maniya-online.js`
(applyCardAvailability/updateFilter/changeSource); **свежие live-пробы** (4 независимых последовательных прогона ×
5 пар, cs+plain, primary+резервная нода, реальные параметры карточек, креды `dorofeevigor20@gmail.com`/`7974327d37`).

---

## 0. Вердикт

# MANIYA HIDE-СЕМАНТИКА ДЛЯ KINOPUB КОРРЕКТНА ПО КАНОНУ — КЛАСС C НЕ ТРЕБУЕТ ФИКСА СЕМАНТИКИ

1. **Канон E-Online прячет источник на ОДНОМ 503/timeout/2xx-empty checksearch** (`OnlineApi.cs:1047`:
   `work=false` → `"show":false`), **без** подтверждения, **без** консультации /videos, **без** ротации хостов,
   и кэширует результат **на 5 минут**.
2. **Maniya строже канона в сторону «не прятать»**: hide только после **двух** подтверждённых «нет»
   (checksearch + прямой lite-page с backoff, ВСЕ хосты). Второй сигнал, нашедший контент, **отменяет hide**
   (`availability.js:1019`). Self-heal — **60 секунд** (HIDE_TTL_MS), в 5 раз быстрее канона.
3. **/videos НЕ участвует в availability ни в одной из систем.** «/videos в тот же период вернул play» не
   отменяет hide-вердикт: это другой сигнал в другое время, и канон принципиально его не читает.
4. **FN Аватара в r2 = настоящее окно двойного 503 кластера** (оба сигнала упали разом на всех нодах), затем
   кластер «выздоровел» → /videos отдал 7 play. **E-Online в этом же окне поступил бы хуже**: один 503 →
   ghost на 5 минут. Maniya скрыл на 60 секунд.
5. **Единственное семантическое расхождение с каноном — Maniya ПОКАЗЫВАЕТ то, что канон прячет**
   (timeout/no-response/смесь → INCONCLUSIVE show:true, `availability.js:777-784`). Это делиберативная
   anti-FN-политика (rule 3), направление Class A, НЕ Class C. Сближение с каноном здесь увеличит FN-риск
   (кейс rutubemovie/Одиссея). Для Class C менять нечего.
6. **Поправка к `balancer-post-w1-remaining-audit.md` §3.2:** канон НЕ «omits» источник при 503/timeout.
   `Http.GetSpan` не бросает исключение на 503/timeout (возвращает `(false, response)` без spanAction) →
   `links[indexList]` БЕЗУСЛОВНО присваивается (`OnlineApi.cs:1047`) со `"show":false` → источник ВКЛЮЧЁН
   в lite/events как ghost. Omit (`code == null`) — только при network-исключении (catch 1049-1052).

---

## 1. Каноническая семантика E-Online/Lampac (полный end-to-end путь)

### 1.1 Путь (что реально делает эталон)

1. **Lampa** открывает карточку → плагин просит `lite/events?life=true` с параметрами карточки
   (id/imdb_id/kinopoisk_id/tmdb_id/title/original_title/year/serial/source/clarification/similar/rchtype).
2. **OnlineApi.Events/checkOnlineSearch** (`OnlineApi.cs:870-921`): для каждого включённого балансера
   (`online[]`) строит `online_url` = `{self}/lite/<balancer>?<параметры карточки>` и вызывает
   **checkSearch** (`OnlineApi.cs:957-1053`) — асинхронно для всех.
3. **checkSearch** (`OnlineApi.cs:972`): `Http.GetSpan(checkuri, timeoutSeconds: 10, spanAction: ...)`.
   - **200 + контент-маркеры** (`data-json=` или `"type":"movie"/"episode"/"season"` или `"rch":true`) →
     spanAction выполняется → `work = true`.
   - **200-пусто / 503 / timeout / 403** → spanAction НЕ выполняется (`Http.cs BaseGetReaderAsync:660-748`:
     не-2xx → `return (false, response)` без action; timeout → исключение перехватывается внутри, возврат
     `(false, internalServerErrorResponse)`) → `work` остаётся `false`.
   - **`links[indexList] = new("...\"show\":{work}...", index, work)`** (`OnlineApi.cs:1047`) — БЕЗУСЛОВНО,
     вне catch. Исключение HTTP-уровня НЕ бросается → строка выполняется всегда для успешного соединения.
     **`show` = `work`**: `true` только для контента, `false` для пусто/503/timeout.
   - **Network-исключение** (DNS/connect, не перехваченное GetSpan) → catch (`OnlineApi.cs:1049-1052`) →
     `links[indexList]` остаётся `null` → `.Where(i => i.code != null)` (`OnlineApi.cs:913-917`) → источник
     **отсутствует** в ответе.
4. **Кэш** (`OnlineApi.cs:893`): результат lite/events кэшируется `memoryCache.Set(memkey, links, 5 минут)`,
   ключ = (id, serial, source, online.Count, user_uid). Повторное открытие карточки в течение 5 минут НЕ
   перезапрашивает кластер — берёт закэшированные show-флаги.
5. **LifeEvents** (`OnlineApi.cs:543-643`): фильтрует `item?.code != null`; sort по `work` desc → источники
   со `show:true` впереди. Все источники (включая show:false) остаются в `online[]`.
6. **Lampa-клиент plugin.js:**
   - `startSource` (`356-383`): `sources[name].show = j.show`; `filter_sources = getKeys(sources)` (все);
     **ghost не авто-выбирается** (`375`: `if (!sources[balanser].show && !object.lampac_custom_select) balanser = filter_sources[0]`).
   - `lifeSource` (`384-465`): строка 432 `ghost: !sources[e].show` — источник со `show:false` **РИСУЕТСЯ
     в списке как ghost (затемнённый)**.
   - `onSelect` ('sort') (`201-205`): **тап по ghost РАБОТАЕТ** — `object.lampac_custom_select = a.source;
     changeBalanser(a.source)` → запрос /videos. Ручной «спасательный» путь к скрытому источнику есть.
   - `parse` (`779-884`): play/call-карточки → видео; одиночный non-similar link → follow; несколько
     similar → `similars()`; ничего → `doesNotAnswer` («видео не найдено»).

### 1.2 Вердикт канона по каждому HTTP-результату checksearch

| HTTP-результат checksearch | work | show в lite/events | Что видит юзер |
|---|---|---|---|
| 200 + data-json/type-маркер | true | `true` | активный источник |
| 200-пусто / `null` / `disable` | false | `false` | ghost (затемнён) |
| 503 (быстрый/медленный) | false | `false` | ghost |
| timeout (10с) | false | `false` | ghost |
| 403 | false | `false` | ghost |
| network-исключение | — | отсутствует | источника нет вовсе |

### 1.3 KinoPub-модуль (канон, `OnlinePaid/KinoPub/Controller.cs`)

- `lite/kinopub` — балансер kinopub; без токена → `OnError("token", 401)`.
- **Нет контента** (`search.Value.id == 0` и нет similars) → `OnError()` → **503**.
- Сбой поиска → `OnError()` → **503**; `ContentTpl` пуст → **503** (`BaseOnlineController.cs:325`).
- Поиск кэшируется 40с (`kinopub:search:...`), пост — 10с.
- **Свойство модуля:** «контента нет» и «поиск не удался» НЕРАЗЛИЧИМЫ (оба 503). Это свойство источника,
  наследуется обеими системами: даже эталон не отличает «у kinopub нет фильма» от «Lime-поиск упал».

---

## 2. Свежие live-пробы (2026-08-16, кластер skaz, 4 независимых последовательных прогона × 5 пар)

Паттерн: каждый прогон = `cs` (checksearch=true, что видит availability) + `plain` (что видит /videos).
cs на резервной ноде в прогонах 1 и 4, на primary в 2-3; plain всегда primary. Таймаут 15с, пауза 1.2с.

| Пара | Прогон | cs (хост) | plain (online3) | Разбор |
|---|---|---|---|---|
| **Аватар** | 1 | 200 **7×play** (резерв) | 200 7×play | оба сигнала FOUND |
| | 2 | 200 7×play (primary) | 200 7×play | FOUND |
| | 3 | **503 @8.1с** (primary) | **200 7×play** | **cs=503, plain=play НА ОДНОМ ХОСТЕ** |
| | 4 | 503 (резерв) | 503 | **окно двойного 503** (условие hide r2) |
| **Дюна** | 1-2 | 200 **14×play** | 200 14×play | FOUND |
| | 3 | **503** | 200 14×play | cs=503, plain=play |
| | 4 | **503** (резерв) | **200 14×play** | 503 per-request, не per-host |
| **Форрест** | 1-2 | 200 **25×play** | 200 25×play | FOUND |
| | 3-4 | **503** | 200 25×play | cs=503, plain=play |
| **ДД** | 1-4 | 200 **3×link** (no play) | 200 3×link | link-режим, детерминирован в этом окне |
| **Интерстеллар** (CTRL) | 1-4 | 200 **4×link similar:true** | 200 4×link | link-режим с similars |

**Выводы пробы:**
1. **Сценарий «checksearch=503 + playable /videos» воспроизводится живьём** у всех трёх play-пар
   (Аватар #3, Дюна #3-4, Форрест #3-4). Это и есть условие acceptance-критерия.
2. **503 — bursty и транзиентен**: прогоны 1-2 → 200, прогоны 3-4 → 503. Скорость ответа 220мс–8.1с —
   и быстрый стабильный 503, и медленный (на грани Maniya-дедлайна 12с).
3. **503 — НЕ per-host**: Аватар #3 cs(online3)=503 при plain(online3)=200 (один хост, разные сигналы/время);
   Дюна #4 cs(резерв)=503 при plain(primary)=200 (разные хосты, тот же окно). 503 кинопуб-поиска —
   свойство кластера/Lime-апстрима (search-кэш 40с протух + апстрим насыщен), не выбор ноды.
4. **Окно hide r2 воспроизведено**: Аватар #4 — ОБА сигнала 503 на обеих нодах → именно здесь Maniya
   (2×503) и канон (1×503) скрыли бы источник; /videos в следующее мгновение вернул бы play.
5. ДД и Интерстеллар сейчас в link-режиме (3×link / 4×link similar) — недетерминизм режима kinopub
   (play ↔ link similar ↔ 503), подтверждён и здесь (ср. §5 остаточного аудита).

---

## 3. State model (как обе системы классифицируют сигнал)

Пять состояний по сигналу кластера:

| Состояние | Определение (сигнал checksearch) | E-Online | Maniya (legacy kinopub) |
|---|---|---|---|
| **FOUND** | 2xx + play/call/link-карточки (`data-json=`/type-маркер) | `show:true` (активен) | `show:true` + пин ноды для /videos |
| **EMPTY** | 2xx без контент-маркеров (пусто/`null`/`disable`) | `show:false` (ghost) | `show:false` (hide, авторитетно; OLD∩NEW подтверждение) |
| **UNAVAILABLE** | не-2xx (503/403/5xx) — быстрый, чистый, без no-response | `show:false` (ghost) | `show:false` (hide только после OLD∩NEW подтверждения) |
| **TRANSIENT** | timeout / no-response / сеть / СМЕШАННЫЙ вердикт (часть «нет» + часть таймаут) | `show:false` (ghost; GetSpan вернул без spanAction) | **`show:true` (INCONCLUSIVE, активен)** ← расхождение |
| **PLAYABLE_CONFIRMED** | /videos (lite-page БЕЗ checksearch) вернул play/call в момент T | не участвует в availability | не участвует в availability; используется ТОЛЬКО как второй сигнал в OLD∩NEW-гейте |

**Переходы:**
- `FOUND → PLAYABLE_CONFIRMED` при клике юзера (или /videos-матрице) — штатный путь.
- `UNAVAILABLE/TRANSIENT (t0) → PLAYABLE_CONFIRMED (t1>t0)` — **окно FN**: обе системы в t0 прячут
  (канон ghost на 5 мин, Maniya hide на 60с), в t1 контент уже есть. Врождено checksearch-архитектуре.
- `* → re-check` по TTL: канон 5 мин, Maniya 60с (HIDE_TTL_MS для hide) / ttlMs 5 мин для show → self-heal.
- Maniya дополнительно: `UNAVAILABLE → FOUND`, если второй сигнал OLD∩NEW нашёл контент
  (`availability.js:1019` `row.show = value.show`) — hide отменяется ДО кэширования.
- Канон: перехода НЕТ — один сигнал, вердикт финализирован на 5 мин.

---

## 4. Таблица сценариев «Scenario | E-Online | Skaz | Maniya | Expected Maniya» (20 сценариев)

Канон E-Online == кластер Skaz (skaz — тот же Lampac-сервер). «Skaz» колонка = фактическое поведение
кластера из проб, где отличается. Identity по provider/balanser ID (`skaz-kinopub`), НЕ display-имени.

| # | Scenario | E-Online | Skaz (кластер, факт) | Maniya (текущая) | Expected Maniya |
|---|---|---|---|---|---|
| 1 | 200 CONTENT (play) | show:true | 200 7-25×play (пробы) | show:true + пин | show:true ✓ |
| 2 | 200 CONTENT (link-only) | show:true → follow/similars на клике | 200 3×link / 4×link-similar | show:true (RULE-1 год-match) | show:true ✓ (follow-семантика — отдельная задача Class B) |
| 3 | 200 EMPTY (пусто/`null`/`disable`) | show:false (ghost) | 200 пусто | hide authoritative (после OLD∩NEW) | show:false ✓ |
| 4 | 503 (быстрый, стабильный) | show:false (1×503, 5 мин) | 503 220-580мс | hide (2×503 + backoff, 60с) | show:false ✓ (строже, быстрее self-heal) |
| 5 | 503 (медленный, ~8с) | show:false | 503 @8.1с (Аватар #3) | hide-кандидат → OLD∩NEW отменяет, если прямой сигнал CONTENT | show:false по канону; Maniya фактически show:true (второй сигнал нашёл контент) — МЯГЧЕ, не хуже |
| 6 | timeout (10с канон / 12с Maniya) | show:false | (в пробах не было чистого timeout) | **show:true INCONCLUSIVE** | **расхождение**: канон ghost; Maniya show (anti-FN, rule 3) |
| 7 | network-исключение | **источник OMITTED** | — | show:true INCONCLUSIVE | **расхождение**: канон omit; Maniya show (rule 3) |
| 8 | A=503 / B=CONTENT (ротация хостов) | 1 хост → зависит от выбора (50% ghost) | Аватар #3: cs=503 plain=200 НА ОДНОМ хосте | probe всех хостов: найдёт CONTENT → show:true | show:true ✓ (Maniya надёжнее канона) |
| 9 | A=EMPTY / B=CONTENT | 1 хост → ghost при пустом | ДД #4: резерв 503, primary 200 | найдёт CONTENT → show:true | show:true ✓ |
| 10 | A=CONTENT / B=EMPTY | 1 хост → show:true при контенте | — | найдёт CONTENT → show:true | show:true ✓ |
| 11 | A=503 / B=503 / C=CONTENT | 1 хост (удача/случайность) | — | продолжит ротацию → C → show:true | show:true ✓ |
| 12 | A=503 / B=503 / C=503 (все) | show:false | Аватар #4: обе ноды 503 | hide после OLD∩NEW подтверждения (60с) | show:false ✓ |
| 13 | checksearch=503 / videos=CONTENT | show:false (не смотрит videos) | Аватар #3, Форрест #3-4 | hide-кандидат; videos НЕ участвует; ghost, manual-tap работает | show:false ✓ (FN врождён, self-heal 60с) |
| 14 | checksearch=CONTENT / videos=EMPTY | show:true → doesNotAnswer на клике | ДД 3×link, /videos=link | show:true, /videos=0 (Class B: RULE-1) | show:true ✓ (follow-задача отдельно) |
| 15 | method=link (non-similar, followable) | show:true → follow | ДД 3×link | show:true, но /videos=0 (нет каскадного follow — Class B) | show:true ✓ (Class B fix отдельно) |
| 16 | method=play (Lime-совпадение) | show:true, playable | 7-25×play | show:true, /videos=play | show:true ✓ |
| 17 | parser-empty (data-json есть, карточки не классифицированы) | show:true (маркер есть) | — | show:true, predicate-inconclusive | show:true ✓ |
| 18 | provider display-name изменился | identity по balanser ID (не name) | — | identity по provider ID | ✓ (не баг) |
| 19 | kinopub «нет контента» (id==0, no similars) | 503 → show:false | 503 `null` | hide | show:false ✓ |
| 20 | kinopub «поиск упал» (Lime 503) | 503 → show:false (неразличимо с #19) | 503 `null` | hide (после подтверждения) | show:false ✓ (свойство модуля) |

**Итог таблицы:** во всех 20 сценариях Maniya либо совпадает с каноном, либо **строже/мягче в пользу
показа** (сценарии 5-9 — надёжнее канона). Обратного случая (Maniya прячет, канон показывает при тех же
ответах кластера) — **НЕТ**. Единственные расхождения 6 и 7 (timeout/network → Maniya show vs канон
ghost/omit) — делиберативная anti-FN-политика rule 3, направление Class A.

---

## 5. Главный вопрос — ответ

> «Имеет ли availability право устанавливать show:false только на основании двух подтверждённых
> 503/timeout checksearch, если тот же provider/balanser в тот же период способен вернуть playable
> items через /videos?»

**ДА. И по канону — не только право, а обязанность, причём с более слабым условием.**

1. **Каноническое основание**: E-Online ставит show:false на ОДНОМ 503 checksearch без подтверждения и
   без /videos (`OnlineApi.cs:1047`, `Http.cs` GetSpan не бросает на 503). Maniya требует ДВА подтверждённых
   «нет» — **строже канона**, то есть прячет МЕНЬШЕ случаев, чем эталон. Нарушения «не прятать работающее»
   относительно канона быть не может.
2. **Архитектурный инвариант**: availability определена через checksearch в момент t0; /videos — другой
   запрос в t1 с другой целью (разрешение контента, не availability). Ни одна система их не связывает.
   Playable /videos в t1 не ретроактивно отменяет вердикт t0 — он доказывает, что источник ВОССТАНОВИЛСЯ
   (или что search-путь и content-путь расходятся). Это врождённо checksearch-архитектуре и разделяется
   эталоном.
3. **Эмпирика**: сценарий воспроизведён живьём (Аватар #3: cs=503@8.1с, plain=200 7×play на том же хосте).
   503 — реальный текущий сигнал кластера (насыщение Lime-поиска / протухание 40с search-кэша), не артефакт
   Maniya. Обе системы скрыли бы в этот момент; эталон — на 5 минут, Maniya — на 60 секунд.
4. **Maniya уже смягчает**: второй сигнал OLD∩NEW, нашедший контент, отменяет hide (`availability.js:1019`).
   Право «прятать по 2×503» реализуется ТОЛЬКО когда оба сигнала независимо сказали «нет» — худший случай,
   который юзер описывает, уже не воспроизводится. FN r2 (Аватар) = окно, где оба сигнала 503 упали разом
   (воспроизведено в пробе #4), а /videos вернул play ПОСЛЕ выздоровления.
5. **Ограничение, общее с эталоном**: у kinopub «контента нет» и «поиск упал» неразличимы (оба 503,
   `KinoPub/Controller.cs` OnError). Даже E-Online не может показать кинопуб в окне 503-поиска. Это
   свойство источника, не дефект Maniya.

---

## 6. ROOT CAUSE → E-ONLINE EXPECTED → MANIYA CURRENT → EXACT DIVERGENCE → MINIMAL FIX → RISKS → TESTS

### 6.1 ROOT CAUSE (Class C, что реально происходит)
Недетерминизм kinopub-поиска на кластере (play ↔ link similar ↔ 503 ↔ 8с-тормоз в разные окна; 40с
search-кэш модуля протухает, Lime-апстрим флапает) + разделение двух проходов во времени
(availability при открытии карточки, /videos при клике). В окне двойного 503 (оба сигнала, все ноды)
обе системы прячут источник; /videos в следующее мгновение играет. Это НЕ ошибка hide-семантики.

### 6.2 E-ONLINE EXPECTED SEMANTICS (эталон)
Один 503/timeout/2xx-empty checksearch → `show:false` (источник ВКЛЮЧЁН как ghost, виден затемнённым,
не авто-выбирается, manual-tap работает) → кэш 5 мин → self-heal по TTL. /videos никогда не участвует.
Network-исключение → omit.

### 6.3 MANIYA CURRENT SEMANTICS
503 (kinopub legacy) → hide только после OLD∩NEW (прямой lite-page с backoff, все хосты); timeout/
сеть/смесь → INCONCLUSIVE show:true (rule 3); 2xx-empty → hide. Confirmed-hide кэш 60с. Клиент рендерит
show:false как ghost (maniya-online.js:555), manual-tap работает (changeSource не блокирует).

### 6.4 EXACT DIVERGENCE (доказанная)
1. **TRANSIENT (timeout/no-response/сеть)**: канон → `show:false`; Maniya → `show:true` (INCONCLUSIVE).
   **Единственное настоящее семантическое расхождение.** Направление — Maniya показывает то, что канон
   прячет (FP-издержка Class A, anti-FN-политика rule 3, задокументирована).
2. **Строгость UNAVAILABLE**: канон 1×503; Maniya 2×503 (подтверждение). Различаются только порогом;
   направление одинаковое.
3. **Self-heal**: канон 5 мин; Maniya 60с. Maniya быстрее (короче FN-окно).
4. **Хосты**: канон 1 хост; Maniya все хосты с ротацией. Maniya надёжнее (сценарии 8-11 таблицы).
5. **Ghost-рендер**: обе системы рисуют ghost и обе позволяют manual-tap. Совпадение.
6. **/videos**: ни в одной не участвует. Совпадение.

**Ключевое следствие: сценария, где Maniya прячет источник, а канон при тех же ответах кластера
показывает, НЕ существует. Class C FN — не расхождение с каноном, а воспроизведение канона с более
коротким окном скрытия.**

### 6.5 MINIMAL CONCEPTUAL FIX
Для Class C **концептуальный фикс не требуется** — семантика hide соответствует канону (строже) или
превосходит его (self-heal). Не предлагается фикс, который заставит Maniya «догонять» канон по строгости
(например, 1×503 → hide): это сузит подтверждение и увеличит FN-риск без выгоды, т.к. канон уже скрывает
в этом классе.

Единственное концептуальное уточнение, если юзер хочет идеального совпадения с эталоном (НЕ рекомендуется
в этой волне): сблизить TRANSIENT с каноном (timeout/сеть → ghost, а не show). Оно убирает FP-издержку
Class A (11 пар), но **возвращает FN работающего источника при транзиентном тормозе** (кейс
rutubemovie/Одиссея: 503+abort при 11 items). Это тот самый компромисс, что разобран в остаточном аудите
§8.6 волна 2 («быстрый стабильный 503 → hide; timeout/смесь → INC show») — полу-сближение, сохраняющее
anti-FN. Отдельная волна, НЕ Class C.

Опциональный UX-штрих (не семантика): в клиенте пометить ghost-источники подсказкой «перепроверить
через минуту» или кнопкой принудительного /videos — manual-tap уже работает, но неочевиден.

### 6.6 REGRESSION RISKS (если реализовать что-либо из 6.5)
- Полное сближение TRANSIENT с каноном: FN rutubemovie-класса (прячем рабочий при 503+abort) — регресс.
- Сузить подтверждение до 1×503: скрытие под одиночным медленным ответом (Аватар #3 cs=503@8.1с) → FN
  без второго сигнала. НЕ делать.
- Трогать W1 (hostOrder/continue-скан/pin/pinMap), online8 abstain, STABILITY-004, GAP-002/005, VEO-015:
  вне scope, риск регресса этих проверенных фиксов. В текущем отчёте НИЧЕГО не меняется.

### 6.7 REQUIRED TESTS (только если волна будет решена; сейчас — предложение)
- unit: kinopub cs=503 + прямой сигнал CONTENT → show:true (hide отменён, `availability.js:1019`) — уже
  покрыто? проверить явным тестом.
- unit: kinopub cs=503 + прямой сигнал 503 (оба, все хосты) → hide на HIDE_TTL_MS.
- unit: timeout/no-response → INCONCLUSIVE show:true (не hide) — уже покрыто.
- unit: 2xx-empty → hide authoritative.
- live: Аватар/kinopub в окне 503 (прогон «оба сигнала 503») → hide; сразу после выздоровления /videos →
  play; повторное открытие карточки → show:true (self-heal ≤ 60с).
- live: Форрест/kinopub cs=503 при plain=25×play → ghost (НЕ активный) по канону; manual-tap → play.

---

## 7. Итог (10 пунктов, как в задании)

1. **ROOT CAUSE Class C:** недетерминизм kinopub-поиска кластера (play ↔ link similar ↔ 503 ↔ 8с) +
   разделение availability (t0) и /videos (t1) во времени. В окне двойного 503 обе системы прячут источник.
2. **Почему FN появляется:** кластер реально 503-ит kinopub-поиск в окне насыщения (Lime-апстрим,
   search-кэш 40с протух); /videos в следующее мгновение отдаёт play. Ни одна система не читает /videos
   для availability — FN врождён checksearch-архитектуре.
3. **Где неправильный state transition:** transition НЕ там, где думалось. Maniya НЕ переводит
   UNAVAILABLE→hide по одному сигналу — он требует два, и второй (CONTENT) отменяет hide. Неправильный
   переход был бы «1×503→hide» — такого в коде нет.
4. **Почему W1 не починил:** W1 синхронизировал host-выбор карточки и /videos (CLUSTER-MISMATCH), но не
   content-вердикт между двумя проходами. Окно двойного 503 — не host-проблема (Аватар #3: оба сигнала на
   одном хосте, 503 у cs и 200 у plain), W1 тут не при чём.
5. **Как ведёт себя оригинал:** один 503 checksearch → `"show":false`, источник ghost (видим, затемнён,
   не авто-выбирается, manual-tap работает), кэш 5 мин. Omit — только при network-исключении. /videos не
   участвует. **Поправка:** остаточный аудит §3.2 («omitted») неверен — источник ВКЛЮЧЁН как ghost.
6. **Правильная каноническая семантика:** 503/timeout/2xx-empty → ghost (show:false), self-heal 5 мин.
7. **Минимальный концептуальный фикс:** для Class C — НЕТ. Maniya уже канон-совместима или лучше. Волна
   «hide по подтверждению» (из остаточного аудита §8.6) — уже реализована в OLD∩NEW; остаётся лишь
   желаемое (опционально) сближение TRANSIENT с каноном — это Class A, отдельная волна.
8. **FP/FN-риски:** текущий код: FN = окно двойного 503 (60с self-heal), FP = INC-show на timeout (rule 3).
   Если сблизить TRANSIENT с каноном: −11 FP, но +FN rutubemovie-класса. Риск-асимметрия: FN хуже FP.
9. **Требуемые тесты:** см. 6.7 (проверка отмены hide вторым сигналом, hide на HIDE_TTL_MS, INC-show на
   timeout, self-heal ≤60с, ghost+manual-tap для Форреста).
10. **Отдельная волна реализации:** любая правка TRANSIENT — отдельная волна по явному решению юзера
    (Class A, не Class C). Трогать W1/abstain/STABILITY-004/GAP-002/005/VEO-015 — нельзя.

---

## 8. Сырые данные (воспроизводимость)

- Live-проба: `C:\Users\Admin\AppData\Local\Temp\post-w1-audit\semantics-c-probe.mjs` +
  `semantics-c-probe-result.json` (4 прогона × 5 пар, cs+plain, primary+резерв).
- Канон: `C:\Users\Admin\AppData\Local\Temp\Lampac\Online\OnlineApi.cs` (checkSearch 957-1053, `links[indexList]`
  1047, кэш 893, LifeEvents 543-643, filter 913-917), `Shared\Services\HTTP\Http.cs` (GetSpan 752-796,
  BaseGetReaderAsync 660-748), `Online\plugin.js` (356-383, 375, 432, 201-205, 779-884),
  `Modules\OnlinePaid\KinoPub\Controller.cs` (OnError 503, кэши 40с/10с), `Shared\Controllers\BaseOnlineController.cs`.
- Код Maniya: `server/src/availability.js` (probe 638-786, deadline-ветка 654-663, legacy финал 777-785,
  confirmWithBackoff 815-823, OLD∩NEW 985-1031, отмена hide 1019, HIDE_TTL_MS 88, deadline 524),
  `public/maniya-online.js` (applyCardAvailability 496-547, updateFilter 549-559, changeSource 561-573).
- Остаточный аудит: `docs/balancer-post-w1-remaining-audit.md` (Class C §5, волны §8.6).

---

## 9. STOP

После этого отчёта никаких других действий не выполнять (условие задачи: «STOP после отчёта»).
Код/тесты не менялись, commit/push/deploy не выполнялись. Никаких implementation changes. Следующая
волна (если юзер решит) — по явному решению.
