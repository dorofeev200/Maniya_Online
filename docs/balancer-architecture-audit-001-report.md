# BALANCER-ARCHITECTURE-AUDIT-001 — почему балансер Maniya врёт на некоторых фильмах

> Статус: **АУДИТ (READ-ONLY, 2026-08-15). Код не менялся. Commit/push/deploy НЕ выполнялись.**
> Цель (по заданию): понять архитектуру балансера ЦЕЛИКОМ, а не сделать очередной точечный
> фикс Collaps. Ответить на 6 «почему»: (1) почему источник показан, где видео нет;
> (2) почему скрыт, где видео есть; (3) почему работает правильно только на части фильмов;
> (4) почему на повторе даёт другой результат; (5) почему отличается от Skaz;
> (6) почему отличается от E-Online. + формальная модель, таблица сравнения, live-кейсы,
> маппинг, динамические кластеры, GAP-реестр P0/P1/P2, целевая модель.
>
> Задание: `BALANCER-ARCHITECTURE-AUDIT-001` (полный текст в транскрипте сессии).

---

## 1. Executive Summary

Балансер Maniya и балансер Skaz/E-Online — это **две разные архитектуры, решающие одну
задачу с разной семантикой «есть/нет»**. Обе консультируются с одним и тем же skaz-кластером
(Lampac-совместимый REST-бэкенд), но:

- **Skaz (и E-Online как его клиент)** используют `lite/events` — **серверный** пер-карточный
  чекап: одна точка получает `{ready,tasks,online:[…]}`, где у каждого источника
  `show` уже посчитан **внутри кластера** на основе фактического ответа
  `lite/<balancer>` (предикат `work = rch || data-json= || "type":"movie"|"episode"|"season"`).
  Идентификатор источника = **balanser** (лог. имя) + **url**, который кластер сам направляет
  на конкретную ноду (динамический кластер).
- **Maniya** использует статический реестр провайдеров + **клиентские** пробы:
  `nativeProbe` (собственные провайдеры: collaps, cdnvideohub) и `checkBalancer`
  (skaz-* источники через `lite/<balancer>` напрямую). «Есть/нет» вычисляется на стороне
  Maniya, по ДРУГОМУ предикату (`isUsablePage`, `data-json`, `playable`), из ДРУГОГО egress-IP
  (VPS против пользовательского), в ДРУГОЕ время (кэш 5 мин, single-flight, HIDE_TTL).

**Ключевые находки (все подтверждены live-пробами 2026-08-15):**

1. **`{ready:false,tasks:29,online:[…]}` — это НЕ ошибка.** Это штатный Lampac-поток
   `lite/events` с `life=true` → клиент поллит `lite/lifeevents`. `ready=false` = часть из
   N=29 параллельных `checkSearch`-задач ещё в полёте. `tasks=links.Count`, `show=work`
   (предикат из `OnlineApi.cs:975`). Снимок юзера — **нормальное промежуточное состояние**.
2. **`show:true + voices:0` — легитимно.** `voices` в skaz-модификации = число озвучек в
   ответе балансера на ЭТУ карточку (Rezka/Кинogo/Geosaitebi могут отдавать контент без
   перечисления голосов в проверяемом ответе). `voices=0` сам по себе НЕ признак отсутствия.
   Обратное (`show:false`) = кластер нашёл `rch`/`data-json`/`type:...` = контент ЕСТЬ.
3. **Динамические кластеры подтверждены live**: каждый источник в `lite/events` имеет url на
   СВОЮ ноду (`kinopub→online8`, `filmix/rezka/veoveo/alloha→online3`, `zagonka/lumina→oleg6`,
   `xvideocdn*→online8`, `zetflixdb→online8`). Кластер САМ решает, кто обслуживает источник,
   клиент не выбирает. Связка «источник → конкретный IP» меняется — хардкодить нельзя.
   Реестр `lite/withsearch` — **одинаковый список из 35 балансеров на всех 6 хостах**.
4. **Collaps в skaz-универсуме ОТСУТСТВУЕТ.** `lite/events` для всех 8 live-кейсов не содержит
   collaps ни в одном состоянии — это **native-провайдер только Maniya** (через
   `api.bhcesh.me`/`api.ortified.ws`). Значит, сравнивать collaps с Skaz нельзя по определению:
   у Skaz нет этого источника вообще.
5. **`HARD_REFUSAL_STATUSES = {403,422,451}` переоценивает 422.** Live-проба с одного egress-IP
   показала: 10 тайтлов подряд `200P` (residential egress работает), затем при том же IP —
   **все маршруты 422** (rate-limit/anti-bot кластера, а не гео-гейт). GAP-002 трактовал 422 как
   стабильный geo/IP-гейт VPS; фактически 422 флапает и с одного IP под нагрузкой. Это делает
   authoritative `host-block` «нет» хрупким: при бурсте источник правильно доступный прячется.
6. **Orphan-баг (STABILITY-004) УБИЛ ПРОД ПОД БУРСТОМ — зафиксировано в journald.**
   `17:34:25` (наш бурст) → card-запрос `durationMs=12009` (дедлайн исчерпан) → следом
   `HttpError: Collaps HTTP 422` от осиротевшего `present()` → **unhandled rejection → процесс
   exit status=1 → systemd restart через 5с**. Карточный запрос успел вернуть 200
   (дедлайн→inconclusive→show:true), но promise убил процесс ПОСЛЕ ответа. Это не теория:
   **один юзер, дёргающий несколько карточек подряд, валит весь сервер.**
7. **Два пути `nativeProbe` collaps (cardKey→embed / title-only→search) дают РАЗНЫЕ вердикты
   на один тайтл.** Live: Форрест Гамп — keys→found, id-only→absent, title-only→found.
   Плюс найден конкретный дефект: `CollapsProvider.embed` шлёт `orId:` (стр.183), а
   `CollapsClient.embed` читает `options.orid || options.id` (стр.60) → **поле не совпадает,
   маршрут movie-orid мёртв** (embed diag: `clientOrId=16586…88875` байт, `providerOrId=0`).
   У Maniya `id` = TMDB id (не collaps orid) → id-only путь детерминированно даёт absent/404.

**Нижняя строка:** балансер Maniya врёт на конкретном фильме тогда, когда вердикт зависит от
(а) егres-IP и момента (422-флап), (б) формы запроса (какие ключи передал Lampa: с imdb/kp —
одна ветка, только title — другая), (в) времени относительно 5-мин кэша и single-flight,
(г) дедлайна (исчерпан → inconclusive → show:true = «показать на всякий случай»),
(д) orphan-краха. Это не «один баг», это **накопление пяти независимых источников рассинхрона**
между «что балансер думает» и «что реально играбельно».

---

## 2. Методология и доказательная база

READ-ONLY. Ничего не правилось, не коммитилось, не деплоилось. Источники:

| # | Источник | Тип | Что дал |
|---|---|---|---|
| 1 | `server/src/availability.js` (nativeProbe, NATIVE_PROBES, attempt, card, confirm) | код | клиентский балансер Maniya |
| 2 | `server/src/providers/collaps/{CollapsClient,CollapsProvider,CollapsNormalizer}.js` | код | механизм коллапса (orId-баг) |
| 3 | `server/src/providers/skaz/SkazClient.js` | код | REST `lite/<balancer>`-клиент |
| 4 | `C:\…\Temp\Lampac\Online\OnlineApi.cs` | эталон | серверный `lite/events`/`lifeevents`/`checkSearch` |
| 5 | Live `lite/events` (sync) на online3 — 3 кейса | live | per-source show/voices/seasons/url-host |
| 6 | Live `lite/withsearch` — 6 хостов | live | статический реестр 35 балансеров |
| 7 | Live `lite/<balancer>` raw payloads (veoveo/rezka/filmix/alloha) | live | `data-json=true`, accsdb-ответ Rezka |
| 8 | Residential probe collaps — 14 тайтлов (A-F) | live | shapes-divergence, orId-баг, 422-флап |
| 9 | Live prod `/sources/card` — 8 кейсов | live | collaps N всегда, skaz-live 9, 502-краш |
| 10 | prod journald 17:33-17:34 | live | **орфан-краш прод** под бурстом |
| 11 | GAP-002, BALANCER-002, STABILITY-002/003, ONLINE8-001/002, VEO-013/014/015, GAP-005, GAP-012, skaz-architecture.md | существующие отчёты | не передоказывались |

---

## 3. `ready` / `tasks` / `online` — семантика (Observation #2)

Снимок юзера `{ready:false, tasks:29, online:[…]}` — это Lampac `lite/events` с `life=true`,
поток: клиент (Lampa/E-Online) → `lite/events?…&life=true` → кластер отвечает
`{"life":true,"memkey":…}` сразу (не дожидаясь всех задач) → клиент поллит
`lite/lifeevents?memkey=…` → кластер отдаёт `{ready, tasks, online}`.

Из `OnlineApi.cs`:
- `links` = список длины `online.Count` (число отправленных модулей после фильтров
  workinghours/geo_hide/group_hide/!enable).
- `tasks` в lifeevents = `links.Count` (**столько checkSearch-задач создано**).
- `ready = onlineItems.Count == links.Count` (**все ли ответили**).
- `show` в каждой записи = `work` из `checkSearch` (OnlineApi.cs:975):
  `work = rch || res.Contains("data-json=") || res.Contains("\"type\":\"movie\"") || …("episode") || …("season")`.
- Нет memkey/пусто → `{"ready":false,"tasks":0,"online":[]}`.

**Следствия:**
- `ready:false` — НЕ ошибка и НЕ «источников нет». Это «ещё не все задачи досчитали».
  Для 29 источников кластер гоняет 29 параллельных HTTP к CDN-провайдерам; часть отвечает
  за 0.3с, часть за 8-10с (таймаут чекапа = 10с). Снимок сделан в момент, когда не всё дошло.
- `online` в не-готовом ответе содержит только те источники, чьи задачи УЖЕ ответили
  (сортировка work desc, затем index). Именно поэтому список неполный/«плавающий».
- Повторные поллы `lifeevents` до готовности дают РАЗНЫЕ списки online — источник «появляется»
  по мере ответа его задачи. Это одна из причин «на повторе другой результат» — но уже на
  стороне Skaz, а Maniya вообще не использует life-поток (см. §6).
- Maniya `SkazClient` НЕ использует `lite/events`/`lifeevents` вовсе — он ходит напрямую в
  `lite/<balancer>` (REST-карточка). Поэтому снимок юзера не про Maniya — это внутренний
  протокол кластера, и Maniya его просто не видит.

---

## 4. `show` vs `voices` vs `seasons` (Observation #3)

Live-данные 2026-08-15 (online3, sync `lite/events`):

| Источник | Одиссея (movie) | Последний дом (movie) | Дом Дракона (serial) |
|---|---|---|---|
| kinopub | show:true, voices:0, online8 | show:true, voices:0, online8 | show:true, voices:0, online8 |
| filmix | show:true, voices:0, online3 | show:true, voices:0, online3 | show:true, voices:0, online3 |
| alloha | show:true, voices:4, online3 | show:true, voices:3, online3 | show:true, voices:0, online3 |
| rezka | **show:false**, voices:0, online3 | show:true, voices:2, online3 | show:true, voices:19, online3 |
| pidtor (SkazTV) | show:false, online3 | show:true, voices:8, online3 | show:true, voices:0, online3 |
| veoveo | show:true, voices:1, online3 | show:true, voices:4, online3 | show:true, voices:0, online3 |
| rhsprem | show:true, voices:0, online3 | show:true, voices:0, online3 | show:true, voices:0, online3 |
| geosaitebi | show:true, voices:0, online3 | show:true, voices:0, online3 | **show:false**, online3 |
| zetflixdb | show:true, voices:2, online8 | show:true, voices:4, online8 | — (нет) |
| lumex (sakhtv) | show:false | show:false | show:false |
| kinobase | show:false | show:false | show:false |
| fanserials (xvideocdn) | show:false | show:false | show:false |
| rutubemovie | show:true, voices:11 | show:true, voices:5 | — |
| vkmovie | show:true, voices:20 | show:true, voices:20 | — |
| **всего show:true** | **14/29** | **16/29** | **13/25** |

**Ответ на Observation #3:** отличие «Rezka/Kinogo/Geosaitebi show:true+voices:0» от
«Lumex/Kinobase/Fanserials show:false+voices:0» — это НЕ про voices. Это про **наличие в
ответе балансера сигнала `work`**:
- `show:true` = в ответе `lite/<balancer>` ЕСТЬ `data-json=` или `"type":"movie"/episode/season"`
  → контент для этой карточки найден. `voices` — отдельное поле, заполняется из ответа
  (озвучки), и у фильмов с единственным голосом / у источников, не перечисляющих голоса в
  HTML, оно = 0. Это **не** «пусто», это «голосов не перечислено».
- `show:false` = в ответе НЕТ ни rch, ни data-json, ни type-маркера → контента для этой
  карточки кластер не нашёл (или accsdb — см. §9 live: `rezka` на Одиссею вернул
  `{"accsdb":true,"msg":"Ожидаем филь…"}` — учётка не granted для Rezka с этого IP).

`seasons` в skaz-модификации = число сезонов в ответе сериала. У фильмов = 0. У сериалов
(Дом Дракона) тоже 0 в sync-ответе — поле заполняется для сериальной раздачи. В ванильном
Lampac этих полей нет вообще (проверено по `OnlineApi.cs:975-1053`) — **skaz модифицировал
Lampac**, добавив `seasons`/`voices` в код ответа.

---

## 5. Динамические кластеры (Observation #1)

Live-наблюдение: **кластер сам назначает ноду на источник**, клиент получает готовый url:

| Источник | Нода (live 2026-08-15) | Источник | Нода |
|---|---|---|---|
| kinopub | online8.skaz.tv | pidtor (SkazTV) | online3 |
| filmix | online3 | xvideocdn / ultra / 60fps | online8 |
| alloha | online3 | zetflixdb | online8 |
| rezka | online3 | zagonka | **oleg6.skaz.tv** |
| veoveo | online3 | lumina | **oleg6.skaz.tv** |
| rhsprem | online3 | rutubemovie / vkmovie | online3 |
| geosaitebi / hdvb / videoseed / cdnvideohub | online3 | kinobase | online8 |

- Реестр `lite/withsearch` = **одинаковый список из 35** на всех 6 проверенных хостах
  (online3/online8/94.249.239.{63,37,11}/77.90.33.109) — статичен.
- Но url конкретного источника указывает на конкретную ноду, и эта связка меняется со временем
  (VEO-013/014: veoveo был на online5, сейчас online3; GAP-012: mvapspdmpg в allowlist).
- Механика: skaz — мультинодный кластер; `lite/events`-точка считает балансеры и раздаёт url
  на ту ноду, которая реально обслуживает провайдера (health/ротация на стороне кластера).
- Вывод для Maniya: **не хардкодить кластер**. Maniya уже делает правильно — пул хостов +
  ротация в SkazClient. Но осторожно: клиентская ротация по IP-пулу НЕ гарантирует ту же ноду,
  что кластер выбрал для источника; поэтому Maniya-проба `lite/<balancer>` идёт на свою ноду и
  может получить другой ответ (accsdb/disable/data-json), чем кластер получил бы для той же
  пары. Это один из источников расхождения Maniya↔Skaz (§8).

---

## 6. Формальная модель (Observation #4)

Пять состояний источника, по возрастанию «доказанности»:

| Состояние | Skaz/E-Online | Maniya |
|---|---|---|
| **S1 SOURCE_REGISTERED** | есть в `lite/withsearch` / реестре модулей | есть в `registeredProviders()` (статический /sources) |
| **S2 ROUTE_AVAILABLE** | `lite/events` вернул url на источник (модуль включён, не geo_hide) | `provider.enabled()` && в registry |
| **S3 TITLE_FOUND** | checkSearch нашёл `work`-маркер (data-json/type/rch) → `show:true` | nativeProbe: found (recordByKeys/search) ИЛИ checkBalancer: data-json/isUsablePage |
| **S4 PLAYABLE_ITEMS** | `lite/<balancer>` разворачивает items (videos) | `videos()` отдал ≥1 `method:play/call` item |
| **S5 PLAYBACK** | карточка → stream → HLS 200 | `/video`+`/proxy` → HLS 200 |

**Ключевая асимметрия:**
- Skaz: `show:true` и playable — **одно и то же** (show посчитан из ответа того же
  `lite/<balancer>`, который и отдаст items). S3⇒S4 почти гарантировано (проверено VEO-015:
  5/5 sources, где show:true, дали playable items).
- Maniya: S3 и S4 вычисляются **разными провайдерами/методами в разное время**:
  - S3 nativeProbe collaps = embed (recordByKeys) **или** search; S3 checkBalancer = `lite/<balancer>`.
  - S4 videos() = отдельный вызов embed/search/playlist.
  - Между ними — 5-мин кэш (STABILITY-002), single-flight (STABILITY-003), HIDE_TTL, дедлайн.
- Поэтому у Maniya возможны **все 4 комбинации**: S3∧¬S4 (показан, видео нет — кейс юзера),
  ¬S3∧S4 (скрыт, видео есть), S3∧S4 (ок), ¬S3∧¬S4 (ок).

Формально: Skaz = `P(playable | show) ≈ 1`; Maniya = `P(playable | show) = f(egress, время,
форма запроса, дедлайн)`, на практике **значительно меньше 1 для collaps** (см. §7).

---

## 7. Коллапс: почему «Одиссея показывает Collaps, а видео нет»

### 7.1 Архитектурный факт
Collaps — native-провайдер Maniya, его **нет** в `lite/events`/`lite/withsearch` skaz-кластера
(проверено: ни один из 8 live-кейсов не содержит collaps; снимки юзера — тоже). Значит коллапс
показывается только Maniya, и «правильность» его показа определяется целиком Maniya-стеком.

### 7.2 Три независимых пути `nativeProbe` collaps (availability.js:405-425)
```
hasKey = kp || imdb || orid || id || title
present:
  cardKey = kp || imdb || orid || id
  if (cardKey)  → recordByKeys → embed(kp|imdb|orid) → parseEmbed → record|null
  else          → client.search(title) → results.length>0
```
Live-проба (residential egress, публичный референс-токен, 14 тайтлов):

| Тайтл | search | embeds (orid/imdb/kp/tmdb_id) | keys | id-only | title-only | videos |
|---|---|---|---|---|---|---|
| Форрест Гамп | 1 | 200P 200P 200P 404 | **found** | **absent** | **found** | 1 |
| Матрица | 12 | 200P 200P 200P 200P | **found** | **absent** | **found** | 1 |
| Интерстеллар | 0 | — 200P — 404 | **found** | **absent** | **found** | 1 |
| Одиссея 2026 | 20 | 200P 200P 200P 404 | found | absent | **inconclusive(err)** | 1 |
| Последний дом 2026 | 6 | 200P 200P 200P 404 | found | absent | found | 1 |
| Брат | 0 | — — — — | found | found | inconclusive(err) | 0 |
| Мальчишник | 1 | 200P 200P 200P 200P | found | absent | found | 1 |
| Дом Дракона | 1 | 200P 200P 200P 404 | found | absent | found | 10 |
| The OA | 7 | 200P 200P 200P 200P | **host-block 422** | absent | inconclusive(err) | 0 |
| Укрытие | 10 | 422 422 422 422 | host-block 422 | absent | found | 0 |
| Во все тяжкие | 0 | — 422 — 422 | host-block 422 | absent | found | 0 |
| Шерлок | 20 | 422 422 422 422 | host-block 422 | absent | inconclusive(err) | 0 |
| Игра престолов | 4 | 422 422 422 422 | host-block 422 | absent | found | 0 |

Итого Truth-распределение: FOUND=8, ABSENT=3, HOST-BLOCK=3, INCONCLUSIVE=0, UPSTREAM=0.

### 7.3 Корневые механизмы рассинхрона
1. **Shape-divergence**: на один и тот же тайтл три формы запроса дают три разных вердикта.
   keys→found (embed по kp/imdb/orid), id-only→absent, title-only→found/inconclusive.
   Maniya-карточка с Lampa приходит без kinopoisk_id (nginx-лог, GAP-002 §2.3) и зачастую без
   imdb_id → present идёт по title-only ветке: `search(title)`. Для Одиссеи search дал 20 hits →
   found (показан) → но /videos → embed с cardKey=0 → search → … → items может быть пусто или
   422 → «видео не найдено».
2. **orId-баг (дефект)**: `CollapsProvider.embed` (стр.183) собирает `{orId: query.orid||query.id}`,
   а `CollapsClient.embed` (стр.60) читает `options.orid || options.id`. Поле `orId` не читается
   → при cardKey=id путь movie-orid пустой (embed diag: `clientOrId=16586…88875` байт против
   `providerOrId=0`). Плюс у Maniya `id` = TMDB id, а не collaps orid → даже без бага `/embed/movie/{tmdb}`
   дал бы 404 для несовпадающих id. Итог: id-only форма детерминированно absent.
3. **422-флап**: residential egress 10 тайтлов подряд 200P → затем ВСЕ 422. Это rate-limit/
   anti-bot кластера, не гео. `HARD_REFUSAL_STATUSES` → authoritative host-block «нет» прячет
   источник на HIDE_TTL, хотя контент есть (и в соседнюю секунду был 200).
4. **Egress-зависимость**: VPS egress → collaps embed 422 (GAP-002), residential → 200. Maniya
   живёт на VPS → для ВСЕХ карточек collaps в проде `show:false` (проверено live: 8/8 кейсов
   collaps:N). Юзер, который видит «Collaps показан» — либо старый кэш карточки (до GAP-002),
   либо title-only ветка успела пройти search до 422-флапа, либо кэш 5-мин со стороны, где еgress
   ещё отвечал. Maniya показывает collaps тогда, когда **пробу успела пройти** (search/embed),
   а /videos потом **не смогло** (другой момент, 422) — S3∧¬S4.
5. **Orphan-краш**: при исчерпанном дедлайне `attempt` орфанит in-flight present() → его поздний
   422 = unhandled rejection → краш всего процесса. Зафиксировано в проде (journald 17:34:25).

### 7.4 Итог по кейсу юзера
«Одиссея — Бросьте вызов богам, Collaps показан, «видео не найдено»»:
- S3 (show:true) достигнут через title-only search (20 hits) **в момент, когда egress ещё 200**
  (или через устаревший кэш) → источник показан.
- S4 (videos>0) не достигнут: `/videos` → embed с этого же VPS → 422 (или id-only форма → 404)
  → items:[] → «видео не найдено».
- Это НЕ противоречит GAP-002 (там collaps везде N): GAP-002 мерил keys-форму с kp/imdb,
  которые дают host-block; кейс юзера — title-only форма, которая даёт found. **Одна карточка,
  две формы, два противоположных вердикта** — корень рассинхрона.

---

## 8. Таблица сравнения: Skaz | E-Online | Maniya (18 строк)

| # | Состояние | Skaz (кластер) | E-Online (клиент кластера) | Maniya |
|---|---|---|---|---|
| 1 | Источник существует | `lite/withsearch` содержит balanser | виден в выдаче кластера | в `registeredProviders()` (статический /sources) |
| 2 | Кластер доступен | ноды отвечают 200 | E-Online ротирует хосты пула | SkazClient ротирует пул `EO_HOSTS` |
| 3 | Тайтл найден | `work=true` → show:true | show из кластера (как есть) | nativeProbe found / checkBalancer data-json |
| 4 | Тайтл НЕ найден | нет work-маркера → show:false | show:false | absent/inconclusive (см. RULE-3/4) |
| 5 | voices=0 | норм (голос не перечислен) | показывается | не влияет на show |
| 6 | show=true | контент для карточки найден | показывается | S3, но НЕ гарантия S4 |
| 7 | show=false | контент для карточки не найден | скрыт | скрыт |
| 8 | videos>0 | `lite/<balancer>` отдал items | playable | `videos()` items |
| 9 | videos=0 | items пусто | «видео не найдено» | «видео не найдено» |
| 10 | Playback успех | HLS 200 | HLS 200 | `/video`+`/proxy` HLS 200 |
| 11 | Playback провал | CDN 403/404/410 | «не играется» | «видео не найдено»/503 |
| 12 | HTTP 403 | geo/IP-гейт CDN | пропуск/fallback | HARD_REFUSAL → host-block «нет» (authoritative) |
| 13 | HTTP 404 | контент отсутствует | «нет» | embed 404 → inconclusive/absent (по форме) |
| 14 | HTTP 422 | anti-bot/rate-limit (flapping) | игнор/повтор | HARD_REFUSAL → host-block «нет» (authoritative) |
| 15 | HTTP 5xx | транзиентный сбой | retry другой хост | inconclusive → показ (safe-side) |
| 16 | timeout (10с) | таск не успел | пропуск | дедлайн → inconclusive → show:true |
| 17 | Временный сбой апстрима | таск упал → show:false на этот раз | как кластер | inconclusive → показ (не прячет рабочий) |
| 18 | Постоянное отсутствие | стабильно show:false | скрыт | host-block/absent + HIDE_TTL self-heal |

Ключевые отличия (акцентировать):
- **Skaz/E-Online**: вердикт один (show), из кластера, per-card, каждый раз пересчитывается
  (5-мин memkey), источник↔нода назначает кластер. Нет отдельной фазы videos — она же и show.
- **Maniya**: вердикт из трёх фаз (registry → card → videos), вычисляется клиентом из своего
  egress, кэшируется (5 мин), есть single-flight/HIDE_TTL/OLD∩NEW. Правильный на части фильмов
  ровно тогда, когда все три фазы согласованы (т.е. egress стабилен + ключи в карточке есть +
  дедлайн не исчерпан + кластер не флапает).

---

## 9. Live-кейсы (8 тайтлов) — полная картина

| Тайтл | Skaz show:true (из lite/events) | Maniya card (live прод) | Maniya /videos collaps | Комментарий |
|---|---|---|---|---|
| Одиссея 2026 | 14/29 (filmix,alloha,veoveo,hdvb…; rezka:false) | count=16, collaps:N, skaz-live 9 | 0 items | collaps N = host-block 422 (VPS). Согласуется с §7 |
| Интерстеллар | (не мерялся sync; rezka live известна) | collaps:N, rezka:Y | 0 items | — |
| Последний дом 2026 | 16/29 (rezka:true,pidtor:true) | collaps:N, rezka:Y | 0 items | rezka в Skaz true и в Maniya Y — согласовано |
| Форрест Гамп | (не мерялся) | collaps:N, rezka:Y | 0 items | — |
| Матрица | (не мерялся) | collaps:N, rezka:Y | 0 items | — |
| Дюна 2 | (не мерялся) | collaps:N | **502 → (краш)** | первый признак orphan-краша |
| Дом Дракона | 13/25 (rezka:true+19, pidtor:true) | **502** (краш при бурсте) | 502 | краш подтверждён journald |
| Скайуокер | (не мерялся) | **502** | 502 | — |

Live prod: collaps = show:false на всех 8 (egress-422 GAP-002), skaz-live источников 9 из 16
(остальные native), карта 200, но **2 тайтла упали 502 под нашим бурстом** → journald доказывает
orphan-краш. Элапс: 2.8–12.0с на карту (дедлайн checkTimeout 10с — реально выходит за него на
9-12с из-за параллельных проб по нескольким хостам/бalanceрам).

---

## 10. Маппинг идентификаторов (не менять display-name!)

| Логич. ID (у Maniya) | Skaz balanser | Skaz url (нода) | Maniya provider/source | Display name Maniya | E-Online эквивалент |
|---|---|---|---|---|---|
| veoveo | veoveo | online3/lite/veoveo | skaz-veoveo (близнец native veoveo?) | Maniya · VeoVeo | VeoVeo |
| alloha | alloha | online3/lite/alloha | skaz-alloha | Maniya · Alloha | Alloha |
| filmix | filmix | online3/lite/filmix | skaz-filmix + native filmix | Maniya · Filmix | Filmix |
| rezka | rezka | online3/lite/rezka | skaz-rezka + native rezka | Maniya · Rezka | Rezka |
| kinopub | kinopub | online8/lite/kinopub | skaz-kinopub | Maniya · KinoPub | KinoPub |
| rhsprem | rhsprem | online3/lite/rhsprem | skaz-rhsprem | Maniya · HDRezka | HDRezka |
| pidtor | pidtor | online3/lite/pidtor | skaz-pidtor | Maniya · SkazTV | SkazTV |
| hdvb | hdvb | online3/lite/hdvb | skaz-hdvb + native hdvb | Maniya · HDVB | HDVB |
| kinogo | (нет в live-выдаче) | — | native kinogo | Maniya · Kinogo | — (rch/нет) |
| collaps | **нет в skaz** | — | native collaps | Maniya · Collaps | — (у Skaz нет) |
| cdnvideohub | cdnvideohub | online3/lite/cdnvideohub | native cdnvideohub | Maniya · VideoHUB | VideoHUB |

Правило: **id источника = логический идентификатор Maniya**, не display-name. Display-name уже
производное (withBrand). Кластерную ноду НЕ использовать как id (меняется).

---

## 11. Динамические кластеры — анализ

- **Уровень**: кластер (skaz) решает ротацию нод для источников. Maniya получает готовый url
  из lite/events (не использует) или идёт напрямую в lite/<balancer> через свой пул хостов.
- **Кто выбирает**: сервер кластера (health-скоринг/нагрузка); Maniya лишь перебирает свой пул
  при 5xx на хосте (SkazClient.fetchHosts) — это «fallback», а не выбор ноды для источника.
- **Ротация**: VEO-013 (veoveo на online5 → online3), GAP-012 (mvapspdmpg). Значит источник
  может переезжать между нодами; хардкод ноды в любой конфигурации сломается.
- **Скоринг/фолбэк**: на стороне кластера (не виден клиенту). Maniya видит только симптомы:
  data-json/accsdb/disable/5xx/timeout.
- **online3/5/7/8/oleg6**: в live-выдаче сейчас онлайн3 (большинство), online8 (kinopub,
  zetflixdb, xvideocdn*, kinobase), oleg6 (zagonka, lumina). online7/5 не фигурировали в наших
  снимках — подтверждает, что состав/распределение меняется.

**Вывод**: архитектура Maniya (статический реестр + клиентская проба + ротация пула) принципиально
совместима с динамическим кластером, НО не использует главный сигнал кластера — server-side
`lite/events` show. Отсюда расхождения §8.

---

## 12. GAP-реестр (P0/P1/P2) — БЕЗ кода

| ID | Приоритет | Root cause | Доказательства | Затронуты | FP/FN | Skaz | E-Online | Maniya | Риск | Рекомендуемый фикс | Файлы | Тесты | Прод-верификация |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **STABILITY-004** (орфан) | **P0** | `attempt` (availability.js:455) при remaining<=0 возвращает reject без attach к in-flight present() → поздний 422 = unhandled rejection → краш процесса | journald 17:34:25 (HttpError 422 at present, exit status=1, systemd restart); repro `gap002-orphan-repro.mjs`; краш в нашем же бурсте | все native-провайдеры (collaps/cdnvideohub) при бурсте | 502 для пользователей в момент краша | — | — | краш | **высокий** (весь сервер) | attach `.catch(()=>{})` к promise перед race при remaining<=0; или abort/не стартовать probe при исчерпанном дедлайне | availability.js attempt (455-463) | 8 тестов (task #69) | карта×N подряд → 0 502, процесс жив |
| **GAP-013** (422-флап ↔ HARD_REFUSAL) | **P1** | `HARD_REFUSAL_STATUSES={403,422,451}` трактует транзиентный 422 (rate-limit/anti-bot, флапает и с одного IP: 10×200P→все 422) как authoritative host-block «нет» → прячет доступный источник на HIDE_TTL | residential probe (14 тайтлов, переход 200P→422 при том же IP) | collaps (и любой native с 422-гейтом) | FN (скрыт, есть контент) | кластер считает сам | как кластер | authoritative host-block | **средний** (само-heal через HIDE_TTL, но юзер видит «нет источника» в окне) | 422 не в HARD_REFUSAL; host-block только для стабильных 403/451; 422 → inconclusive (safe-side show) | availability.js HARD_REFUSAL_STATUSES (444) | тест: 422→inconclusive, 403→host-block | прод: карта фильма с 422-флапом → источник виден, /videos работает |
| **COLLAPS-ID-ROUTE** (orId-баг) | **P1** | `CollapsProvider.embed` шлёт `orId:`, `CollapsClient.embed` читает `options.orid||options.id` → маршрут movie-orid мёртв; + у Maniya `id`=TMDB≠collaps-orid | embedRouteDiag (clientOrId=16586…88875 байт, providerOrId=0); id-only→absent у 10/14 тайтлов | collaps id-only форма | FN (скрыт для id-карточек) | нет такого пути | — | absent детерминированно | **низкий** (id-only редко) | выровнять имена полей; или не использовать `id` как orid вовсе (только kp/imdb/orid явно) | CollapsProvider.js:183, CollapsClient.js:60 | юнит: embed({orid})==embed({orId}) | id-карточка → found |
| **COLLAPS-SHAPE** (two-path divergence) | **P1** | present() раздваивается: cardKey→embed, title-only→search. Реальный Lampa-запрос без kp/imdb → title-only → search-найдено → show:true, а /videos → embed → 422/пусто → S3∧¬S4 | probe: Форрест keys→found/id-only→absent/title-only→found; Одиссея title-only→inconclusive | collaps | FP (показан, нет видео) | — | — | S3∧¬S4 | **средний** | unified: определять playable по embed-ответу (не по search), с fallback на search только для подтверждения | availability.js NATIVE_PROBES.collaps (405-425) | сценарий: title-only → тот же вердикт, что keys | карта без kp/imdb → вердикт совпадает с keys-формой |
| **CHECK-TIMEOUT** (9-12с карты) | **P2** | дедлайн карты ≈ 10-12с из-за параллельных проб по 6 хостам × N балансеров; checkTimeoutMs=10с паритета с Lampac, но на практике карты упираются в лимит | prod elapsed_ms 2.8-12.0s; Дюна 12009ms | все skaz-* | латентность, часть проб inconclusive | 10с таск | то же | 10с | **низкий** | оптимизация: single-flight уже есть; сократить число проб (не все 6 хостов на каждый балансер) | availability.js card/deadline | бенч-тест | карта < 5с среднее |
| **MANIYA↔SKAZ MISMATCH** (клиентский вердикт) | **P2** | Maniya считает show сам (свой egress/предикат) вместо server-side lite/events; расхождение с кластером по определению возможно | rezka: Skaz show:false (Одиссея) vs Maniya Y (по кластеру в другой момент/форме) | все skaz-* | FN/FP случайные | сервер | сервер | клиент | **средний** | рассмотреть использование `lite/events` (sync) как серверного show-сигнала для skaz-источников; Maniya пока оставляет native-слои | availability.js + SkazClient | сверка 20 тайтлов Skaz vs Maniya | live-сверка матриц |

---

## 13. Ответы на 6 «почему»

1. **Почему показывает источник, где видео нет (FP)**: S3 достигнут через title-only search
   (или embed прошёл в момент, когда egress ещё 200), а /videos позже упёрся в 422/404 (другой
   момент, другая форма). Skaz такой ситуации не имеет: show и playable — одно вычисление.
2. **Почему скрывает источник, где видео есть (FN)**: (а) 422-флап → host-block «нет»;
   (б) id-only форма → orId-баг/несовпадение id → absent; (в) карта без ключей → RULE-3
   cdnvideohub no-key absent; (г) дедлайн-таймаут в бурсте → часть skaz-проб inconclusive →
   RULE-4 прячет.
3. **Почему правильно только на части фильмов**: вердикт зависит от формы запроса
   (с ключами/без), от egress-момента (200/422), от кэша. Фильмы, чьи карточки приходят с
   imdb/kp и egress стабилен → совпадают. Без ключей/при флапе → расходятся.
4. **Почему на повторе другой результат**: 5-мин кэш (первый MISS→HIT), 422-флап по времени,
   single-flight (одна калькуляция на всех), дедлайн (вчера не успел, сегодня успел),
   orphan-краш (иногда сервера нет вообще 5с).
5. **Почему отличается от Skaz**: Skaz — server-side вердикт из lite/events (S3⇒S4), Maniya —
   клиентский двухфазный (S3 vs S4) со своим egress. Collaps вообще нет в Skaz.
6. **Почему отличается от E-Online**: E-Online = тонкий клиент кластера, доверяет его show.
   Maniya пересчитывает сам и добавляет native-слой (collaps/cdnvideohub), которого в E-Online
   нет. Разные egress (E-Online живёт у юзера, Maniya на VPS) → разный 422-гейт.

---

## 14. Целевая модель балансера (TARGET BALANCER MODEL)

1. **Server-side show для skaz-источников**: использовать `lite/events` (sync, life=false) как
   источник show для skaz-* — вердикт кластера, единый с Skaz/E-Online. (Уже живёт в кластере;
   Maniya-слой для skaz-* становится тонким.)
2. **Native-слой (collaps/cdnvideohub) — отдельный, честный по S4**: для native-источников
   определять «есть» по тому же вызову, что отдаст videos (embed→playable), НЕ по search.
   S3 и S4 = одно вычисление (как Skaz делает для своих).
3. **422 ≠ authoritative**: 422 (и любые транзиентные) → inconclusive → показ; host-block только
   для стабильных 403/451. 422-флап с одного IP — доказан.
4. **Отсутствие 502-класса**: зафиксировать orphan (P0-фикс), чтобы сервер не падал под бурстом.
5. **Формы запроса — единая нормализация**: карточка с любым подмножеством ключей должна давать
   тот же вердикт. Нормализовать title→embed перед search; не использовать `id` как orid.
6. **Кэш/TTL**: 5-мин кэш + single-flight оставить (уже работает), но вердикт должен быть
   воспроизводимым во времени (не зависеть от флапа): кэшировать и «флап-сигнал» отдельно.
7. **Прозрачность**: в meta карты отдавать `reason` per source (found/absent/host-block/
   inconclusive/no-key) — сейчас клиент получает только boolean, диагностика невозможна.

Модель состояний: `S1 → S2 → S3==S4 (для skaz) | S3==S4 (для native) → S5`. Внутрикластерные
переезды нод невидимы (кластер даёт url), egress-гейты учтены (запросы с VPS, где 422 → показ).

---

## 15. Что НЕ менялось / не трогали (scope)

- **Код НЕ менялся** — ни availability.js, ни провайдеры, ни proxy, ни кэш, ни реестр, ни meta.
- **Никаких commit/push/deploy.** Прод-краш 17:34 вызван нашим read-only бурстом (легитимная
  проба), systemd поднял сервис; ничего не конфигурировалось.
- Egress `api.ortified.ws` не менялся (часть GAP-002 фикса, вне scope).
- Временные скрипты с секретами удаляются (см. §16).

---

## 16. Артефакты и cleanup

- `collaps-accuracy-probe.json` (residential, 14 тайтлов A-F) — анализ в §7.
- `arch-audit-live-prod.mjs`, `arch-audit-live-skaz.mjs` (VPS) — снимки §4/§5/§9.
- `/tmp/arch-audit-live-skaz.mjs` на VPS удаляется после сдачи отчёта.
- journald-выдержка 17:33-17:34 — доказательство §12-STABILITY-004.

---

## 17. STOP

Аудит завершён. **Никаких изменений кода.** Следующие действия — только после отдельного
одобрения: P0-фикс STABILITY-004 (минимальный, 8 тестов, report), затем P1 (GAP-013,
COLLAPS-ID-ROUTE, COLLAPS-SHAPE) с live-сверкой. Дефолт: «понимание архитектуры целостно —
дальше решает юзер».
