# BALANCER-SEMANTICS-005 — Wave 1: CLUSTER CONSISTENCY (дизайн, НЕ код)

**Статус:** ДИЗАЙН ТОЛЬКО. Код НЕ написан, тесты НЕ менялись, НЕ закоммичено, НЕ задеплоено.
**Дата:** 2026-08-15.
**Scope:** исправить доказанный CLUSTER-MISMATCH между `availability.probe()` (карточка) и `SkazClient.videos()` (/videos).
**Базовый аудит:** `docs/balancer-semantics-005-report.md` (25 секций; §21 каноническая модель, §22 волны).
**Формат:** root cause → целевая модель → таблица BEFORE→TARGET → минимальный список изменений →
сохраняемые правила → тесты → live-проверки → риски → что НЕ менять. Конец — STOP (не переходим к W2).

---

## 0. Резюме (TL;DR)

Доказанный рассинхрон имеет **два независимых корня** (оба подтверждены кодом и live-кейсом Паразиты/kinopub):

1. **(a) РАЗНЫЙ ПОРЯДОК ПУЛА.** `availability.js` переупорядочивает хосты (`reorderHosts` → primary-first, **online8 В КОНЕЦ**), а `SkazClient` получает сырой `config.skaz.hosts` (**online8 на 2-й позиции**). Один и тот же источник обходит ноды в разном порядке в карточке и в /videos.
2. **(b) FAIL-NOT-RETRY в `getLite`.** `availability.probe()` на 2xx-non-content (тело `null`/`disable`/`false`/`not found`) **продолжает** обход хостов; `SkazClient.getLite()` на **первом же 2xx** останавливается и, если тело не-usable (`isUsablePage` = false), возвращает `null` — НЕ пробуя следующие ноды. Один «пустой» кластер = «весь источник пуст».

**Доказанный кейс:** Паразиты/skaz-kinopub — карточка `show:true` (контент найден на non-первой ноде, для kinopub это online8 через 302-туннель), а /videos = EMPTY (SkazClient остановился на первой ноде с 2xx-non-content).

**Целевая модель (одним предложением):** единый порядок пула (общий хелпер, online8 в конце) + единое правило «2xx-non-content → продолжай, контент → стоп» (в `getLite`/`openLiteUrl`), + **пин** — карточка, авторитетно нашедшая контент на ноде X, запоминает `X` (ключ `userUid|providerId`, уже лежит в кэш-ряду как `row.host`), и /videos / /video стартуют с `X` (preferred-first, не жёсткий пин), при недоступности `X` — честная ротация по остальным нодам. EMPTY = **все** ноды ответили content-«нет»; любой timeout/5xx/сеть — НЕ EMPTY (transient/UNABLE).

---

## 1. Точный root cause

### 1.1 Дивергенция (a): порядок пула — `reorderHosts` vs сырой конфиг

| Где | Код | Порядок обхода |
|---|---|---|
| Карточка (`availability.probe`) | `createAvailabilityChecker` → `hosts = reorderHosts(config.skaz.hosts)` (availability.js:523); `buildUrl` = `hosts[0]`; ротация `swapHost(base, hosts[index])` | `[online3, 94.249.63, 37, 11, 77.90, **online8**]` — online8 ПОСЛЕДНИЙ |
| /videos (`SkazClient`) | `buildSkazProviders` → `hosts: config.skaz.hosts` (registry.js:107) → `SkazClient.hosts` **сырой**; `buildLiteUrl` = `hosts[_hostIndex % len]` | `[online3, **online8**, 94.249.63, 37, 11, 77.90]` — online8 ВТОРОЙ |

`reorderHosts` (availability.js:96-103) существует, потому что online8 — легаси-резервная нода (ONLINE8-001/002): для не-kinopub её быстрый `403 disable`/503 — политика «модуль выключен», а не «контента нет». Но это переупорядочение применяется **только** в availability; клиент этого не знает.

**Следствие:** даже без FAIL-NOT-RETRY карточка и /videos физически посещают ноды в разном порядке → «первая нода с контентом» может отличаться (для kinopub: у карточки online8 — последний кандидат, у /videos — 2-й; но из-за (b) /videos может вообще не дойти до неё).

### 1.2 Дивергенция (b): FAIL-NOT-RETRY в `getLite`

`availability.probe` (availability.js:636-784) на **2xx «нет источника»** (`isNonContentAnswer`, first-line `null/disable/false/not found`) **НЕ останавливается** — `sawDefinitiveNo=true; continue` (строки 726-735), идёт на следующий хост. Это то самое правило «один cluster ≠ весь provider».

`SkazClient.getLite` (SkazClient.js:74-88):
```js
const response = await this.fetchHosts(url);   // возвращает ПЕРВЫЙ 2xx, останавливается
if (!response) return null;
const text = await response.text().catch(() => null);
...
return isUsablePage(text) ? text : null;       // 2xx non-usable → null, НЕ пробуем дальше
```
`fetchHosts` (SkazClient.js:247-253) ротирует только на **не-2xx** (5xx/сеть); 2xx — «это „нет источника", а не сбой хоста» (комментарий 245, тест 194-208 закрепляет). Для кластера, где контент живёт на ноде ниже по списку (kinopub → online8), первый же 2xx-non-content на online3 превращает источник в «пустой».

### 1.3 Доказанный кейс: Паразиты/skaz-kinopub (класс B, FP)

| Сигнал | Наблюдение | Механизм |
|---|---|---|
| `/sources/card` | `show:true` | probe обошёл ноды в порядке availability (online8 последний), нашёл content-bearing на non-первой ноде → предикат `work` → FOUND |
| `/videos` | **EMPTY (0 items)** | `getLite` стартовал с online3 (первый хост), получил 2xx-non-content → остановился → `null` |
| Итог | **FP «показываем мёртвое»** | (b) FAIL-NOT-RETRY: «первый 2xx = нет источника» на ноде без контента перечёркивает контент, найденный карточкой на другой ноде |

(Пер-нодовые тела для Паразитов не снимались — см. `balancer-semantics-005-report.md` §24 Q1; вывод о механике (b) следует из того, что /videos EMPTY при карточке FOUND и 2-м положении online8 в клиентском порядке, а кинопуб-контент живёт на online8 — OBSERVED из кейсов Форреста/Дюн.)

### 1.4 Форрест/kinopub флап — тот же корень (транзиентный)

Карточка 3×show + 2×show:false, /videos при этом 25 play. `_hostIndex` ротации клиента инкрементится на каждый `buildLiteUrl` → часть вызовов стартует с online3 (2xx-non-content под нагрузкой) → EMPTY (старое поведение), часть — с online8 → 25 play. Не дефект отдельный, а **симптом того же (b)**: нет «продолжай после 2xx-non-content».

---

## 2. Точная целевая модель cluster-selection

### 2.1 Идентичность (что не смешиваем)

| Слой | Значение | Где живёт | Роль в алгоритме |
|---|---|---|---|
| **provider ID** | `skaz-<slug>` | `SkazProvider.id` (registry.js:104), `row.id` в availability | идентичность источника в /sources, /videos, /video |
| **balancer (slug)** | `kinopub`, `alloha`, … | `SkazProvider.balancer`, `row.balancer`, `SkazClient.balancer` | **ключ всего кластерного выбора** (URL `lite/<balancer>`) |
| **display name** | `Maniya · Lime` | `provider.title` → `/sources.name` (meta/withBrand) | **НЕ участвует** в host/кластер-логике |
| **cluster URL / нода** | `http://online3.skaz.tv` … | `config.skaz.hosts`, `row.host` (кэш availability) | выбор ноды |
| **presentation metadata** | качество/voice-метки (VEO-015) | карточки/items | **НЕ участвует** |

**Инвариант:** алгоритм кластерного выбора оперирует только `balancer` + `hosts` + пин. Ни `name`, ни `title`, ни quality-метка не могут повлиять на выбор ноды (Skaz может переименовать/переставить кластер — выбор не должен зависеть от этого).

### 2.2 Единый порядок пула (фикс (a))

Новый общий модуль `server/src/providers/skaz/hostOrder.js`:

```js
export function orderedSkazHosts(hosts) {
  const primary = [], reserve = [];
  for (const host of hosts) (isReserveHost(host) ? reserve : primary).push(host);
  return [...primary, ...reserve];           // online8 последний
}
export function isReserveHost(host) { return String(host || '').includes('online8'); }
```

- Логика = текущий `reorderHosts` (availability.js:96-103), **перенесена и экспортирована** из нейтрального модуля (НЕ из availability.js — иначе circular import: availability → registry → availability).
- Потребители — **оба** конца: `createAvailabilityChecker` и `SkazClient` (через `SkazProvider`). Один источник правды → карточка и /videos обходят ноды **в одном порядке**.
- `config.skaz.hosts` **не меняется** — порядок применяется при конструировании, а не в конфиге.

### 2.3 Единое правило «2xx-non-content → продолжай» (фикс (b))

В `SkazClient` добавляется сканирующий обход (для `getLite` и `openLiteUrl`), зеркалящий `availability.probe`:

```
обойти ноды пула в порядке 2.2, стартуя с предпочтительной (пин) или hosts[0]:
  2xx, тело usable (isUsablePage=true)  → CONTENT: вернуть HTML, СТОП
  2xx, тело non-usable (null/disable/…; JSON rch/accsdb-«Ожидаем фильм») → nonContent++, продолжай
  accsdb-отказ учётки (прочие msg)      → СТОП: lastAccsdb, вернуть null (credentials, не нода)
  не-2xx / timeout / сеть               → noResponse++, продолжай
исчерпан пул:
  nonContent == len && noResponse == 0  → EMPTY  (все ноды ответили content-«нет»)
  иначе                                  → UNABLE (транзиент: кто-то не ответил; НЕ EMPTY)
```

**Спец-правила заказчика прямо в модели:**

| Сценарий | Вердикт /videos |
|---|---|
| cluster A EMPTY + cluster B CONTENT | **CONTENT** (обход прошёл мимо A) |
| cluster A 503/timeout + cluster B CONTENT | **CONTENT** (не-2xx → продолжай) |
| ВСЕ cluster EMPTY | **EMPTY** (только тогда) |
| timeout/5xx/сеть | **НЕ становится EMPTY** (UNABLE/transient) |

Классификация скана доступна клиенту/провайдеру через `client.lastScan = { nonContent, noResponse, total }` — чтобы `SkazProvider.videos()` отличал «кластер честно сказал нет» (EMPTY) от «кластер не ответил» (UNABLE) и не выдавал второе за первое.

`fetchHosts` (для `discover`/`resolveVideoJson`) **не меняется** — там семантика другая (JSON/withsearch).

### 2.4 Пин: карточка → /videos → /video

**Идея:** кэш availability уже хранит `row.host` — ноду, где **этот** провайдер авторитетно нашёл контент (availability.js:967, 1022). Это и есть согласованный кластер «как решила карточка». Отдаём его /videos и /video как **preferred-first** цель ротации.

- **Запись:** в `computeCard`, при кэшировании rows (availability.js:1044-1049), параллельно ведётся `pinMap: Map<"<userUid>|<providerId>", {host, ts, ttl}>`:
  - `row.show === true && row.authoritative && row.host` (авторитетный FOUND) → `pinMap.set`
  - любой другой вердикт (absent/inconclusive/trusted/accsdb) → `pinMap.delete`
  - TTL = TTL того же entry (HIDE_TTL_MS для подтверждённых hide-рядов, TTL_MS иначе); по TTL/пересчёту пин само-обновляется/удаляется.
- **Чтение:** новый экспорт checker'а `pinnedHost(providerId, userUid)` → `pinMap.get("…")` или `null`. Ключ **uid-скоупед** — разные аккаунты/пользователи могут иметь разные granted-ноды; один и тот же балансер у двух юзеров не перемешивается.
- **Инъекция (server-side):**
  - `/api/lampa/videos` и `/api/lampa/video` (index.js:235-252): после `requireSubscription` → `context.userUid = sha256Hex(user.token).slice(0,16)`.
  - `store.js`: `payloadOrNull`/`twinForPayload`/`getVideoForRequest` перед вызовом провайдера формируют per-provider контекст: `provider.videos({ ...context, query: { ...context.query, ...(host ? { host } : {}) } })` где `host = pinnedHost(provider.id, context.userUid)`. Для twin — по `twin.id`.
  - `SkazProvider.videos`/`resolveVideo` читают `query.host` и пробрасывают в `getLite`/`openLiteUrl` как опцию `{ pinnedHost }`.
- **Валидация:** `SkazClient` принимает пин только если он ∈ нормализованного пула `this.hosts` (конфиг мог смениться) — иначе игнор → обычная ротация.
- **Семантика «preferred-first, не жёсткий пин»:** пин — только стартовая нода для обхода 2.3. Если пин-нода теперь вернула 2xx-non-content/503/timeout → **обход продолжается по остальным нодам** (обратный сценарий заказчика: «videos обязан иметь корректный fallback/retry по ротации кластера, а не возвращать EMPTY»). EMPTY возможен только когда **все** ноды (включая пин) ответили content-«нет».
- **Почему нельзя возвращать EMPTY на провале пина:** пин — оптимизация согласованности, не единственный источник правды. Один провал ноды = транзиент (Форрест/kinopub), а не «источника нет».

### 2.5 Где живёт выбор в каждом пути (сводка до/после)

| Путь | Где выбирается нода СЕЙЧАС | Где будет |
|---|---|---|
| Карточка | `probe`: `hosts[0]` + `swapHost` (reorderHosts-порядок), 2xx-non-content → continue | то же, но порядок из общего `orderedSkazHosts` |
| /videos (фильм) | `getLite`: `hosts[_hostIndex % len]` (сырой порядок), 2xx-non-content → СТОП | `getLite(params,{pinnedHost})`: старт с пина → обход 2.3 (orderedSkazHosts) |
| /videos (сериал) | `openSeasonPage`: `getLite` + `openLiteUrl` (тот же FAIL-NOT-RETRY) | `openLiteUrl(url,{pinnedHost})` — тот же сканирующий обход |
| /video (резолв call) | `_cachedCollectMovieCards`/`_cachedOpenSeasonPage` (нав-кэш, свой поход) | тот же пин → **тот же кластер, что у /videos** (voice/episode-индекс совпадает) |
| Нав-кэш | `_movieNavKey`/`_serialNavKey` = pageParams (без хоста) | **без изменений** (ключ не включает пин; контент карточки от любого хоста тот же) |

### 2.6 Можно ли безопасно переиспользовать результат availability?

**Да, для пина — с оговорками:**
- Только **авторитетный FOUND** (`row.show && row.authoritative && row.host`); НЕ inconclusive, НЕ absent, НЕ trusted-static (у trusted filmix нет host — native-путь, пин не применяется), НЕ accsdb.
- Только в окне TTL того же entry; по пересчёту пин переписывается/очищается (строки 2.4).
- uid-скоупед (кэш availability и так uid-скоупед — STABILITY-003).
- НЕ переиспользуем **вердикт hide/показ** в /videos: /videos НЕ решает скрывать/показывать источник (это остаётся за карточкой). /videos только отдаёт items; EMPTY в /videos = «кластер ответил нет на всех нодах» — согласованный с карточкой факт, но сам по себе не скрывает ничего.

### 2.7 EMPTY vs транзиент — итоговые определения

- **EMPTY (authoritative):** все ноды пула ответили content-«нет» (2xx-non-content / accsdb-«Ожидаем фильм» / не-2xx политики «модуль выключен» в терминах 2.2). Зеркало availability `absent`.
- **CONTENT:** хотя бы одна нода дала usable-страницу → items.
- **UNABLE/transient:** часть нод не ответила (timeout/сеть/5xx) и ни одна не дала контента. НЕ EMPTY, НЕ скрытие, НЕ poison пина. Следующий запрос ротацией найдёт контент, если он появился.

---

## 3. BEFORE → TARGET (реальные кейсы)

> Пометки: **[O]** = наблюдено в live-матрице аудита (§5/§11/§14/§17 отчёта 005); **[M]** = смоделировано целевой моделью (пер-нодовые тела в аудите не снимались — открытый вопрос Q1 §24); **[U]** = не проверялось в этой сессии (открыто, живём честно).
> «cluster A» для кинопуба = online8 (контент-нода, 302-туннель, OBSERVED из Форреста/Дюн); «первая нода» = online3.

| # | Тайтл / provider ID | cluster A | result A | cluster B | result B | CURRENT availability | CURRENT videos | TARGET availability | TARGET videos | Ожидаемый итог |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Паразиты (2019) / skaz-kinopub** | online8 (контент) | CONTENT [O: card FOUND] | online3 (первая нода клиента) | 2xx-non-content [M: остановка getLite] | `show:true` [O] | **EMPTY** [O] | `show:true` (без изменений) | **CONTENT** (пин=online8 → контент сразу) | **класс B → A: CONSISTENT** (главный кейс W1) |
| 2 | **Форрест Гамп (1994) / skaz-kinopub** | online8 | CONTENT (25 play) [O] | online3 | 2xx-non-content под нагрузкой [O: флап] | 3×show + 2×show:false [O] | 25 play (когда ротация на online8), 2×EMPTY [O] | `show:true` (флап уходит) | **CONTENT стабильно** (обход идёт мимо online3-non-content до online8) | класс C→A, флап устранён (тот же корень (b)) |
| 3 | **Дом Дракона (2022) / skaz-kinopub** | online8 | НЕТ контента (честно) [O] | online3 | НЕТ контента [O] | **hide** (authoritative absent) [O] | EMPTY [O] | hide (без изменений) | EMPTY (пина нет → ротация → все ноды «нет») | **CONSISTENT absent** (регрессии нет, FP не создаётся) |
| 4 | **Одиссея (2024) / skaz-collaps** | — | title-only FP [O] | — | — | `show:true` [O] | EMPTY [O] | **без изменений** | без изменений | **ВНЕ SCOPE W1** (другой класс — identity/title-only, не cluster-selection; W3 embed-verify) |
| 5 | **Матрица (1999) / skaz-kinopub** | online8 | CONTENT (22 play) [O] | online3 | — | `show:true` [O] | CONTENT [O] | `show:true` | CONTENT, первый вызов сразу на online8 (без «прогрева» ротацией) | A стабильно A |
| 6 | **Интерстеллар (2014) / skaz-alloha** | alloha-нода | CONTENT (8 call) [O] | прочие | CONTENT (kinopub 9, pidtor 8, rhsprem 10) [O] | `show:true` [O] | CONTENT [O] | `show:true` | CONTENT (пин-first) | A стабильно A |
| 7 | **Дюна (1984) / skaz-kinopub** | online8 | CONTENT (14 play) [O] | — | — | `show:true` [O] | CONTENT [O] | `show:true` | CONTENT (пин-first) | A стабильно A |
| 8 | **Дюна (2021) / skaz-kinopub** | online8 | CONTENT (15 play) [O] | — | — | `show:true` [O] | CONTENT [O] | `show:true` | CONTENT (пин-first) | A стабильно A |
| 9 | **Дюна 2 (2024) / skaz-*** | skaz-нода | CONTENT [O: ранее] | — | — | `show:true` [O] | CONTENT [O: ранее] | `show:true` | CONTENT (пин-first) | A стабильно A |
| 10 | **ЗВС/Скайуокер / skaz-*** | — | card FOUND [O] | — | /videos [U] | `show:true` [O] | /videos не допроверялся [U] | `show:true` | CONTENT (модель; проверить в live) | A (проверить) |
| 11 | **Последний дом (2026) / skaz-veoveo** | veoveo-нода | CONTENT (4 play) [O] | остальные (kinopub/kinoflix/pidtor) | hide верны [O] | `show:true` (veoveo), hide (прочие) [O] | CONTENT [O] | `show:true` (veoveo) | CONTENT; сериальный путь (`openLiteUrl`) — тот же пин/обход | A стабильно A (покрывает serial-путь) |
| 12 | **Аватар (2009) / skaz-kinopub** | online8 | CONTENT (7 play) [O] | — | — | `show:true` [O] | CONTENT [O] | `show:true` | CONTENT (пин-first) | A стабильно A |

**Ключевые инварианты таблицы:**
- Кейс 1 — единственный исправляемый FP (класс B → A).
- Кейс 2 — флап (класс C) устраняется тем же (b).
- Кейс 3 — контроль: пина нет → /videos согласованно EMPTY с hide (не создаём новый FP).
- Кейс 4 — явно вне scope (не трогаем; показываем, что W1 на него не влияет).
- 5-12 — регрессия: класс A остаётся A; единственное изменение поведения — первый вызов /videos сразу попадает на контент-ноду (пин) и обход не останавливается на пустой ноде (continue).

---

## 4. Минимальный список изменений

### Файлы (5 production + 1 тест-файл + новые тесты)

1. **`server/src/providers/skaz/hostOrder.js`** (НОВЫЙ, ~15 строк) — `orderedSkazHosts`, `isReserveHost` (перенос из availability.js:92-103).
2. **`server/src/providers/skaz/SkazClient.js`** — главный фикс:
   - конструктор: `this.hosts = orderedSkazHosts(options.hosts || SKAZ_DEFAULT_HOSTS)` (фикс (a));
   - `getLite(params, { pinnedHost } = {})` и `openLiteUrl(url, { pinnedHost } = {})`: стартовая нода = пин (если ∈ пула) иначе hosts[0]; обход 2.3 (2xx-usable → HTML; 2xx-non-usable → continue; не-2xx/no-response → continue; accsdb → stop+lastAccsdb); `this.lastScan = { nonContent, noResponse, total }`;
   - `fetchHosts`/`fetchResolvedHosts`/`discover`/`resolveVideoJson` — **без изменений**.
3. **`server/src/providers/skaz/SkazProvider.js`**:
   - `videos`/`resolveVideo`: читают `query.host` → проброс `pinnedHost` в `collectMovieCards`/`openSeasonPage` → в `getLite`/`openLiteUrl`;
   - нав-кэш-ключи **без изменений** (пин не входит; контент карточки инвариантен к ноде);
   - `buildResolveUrl` — без изменений (строится из `buildPageParams`, поля whitelist — `host` НЕ утекает клиенту).
4. **`server/src/availability.js`**:
   - `reorderHosts` → импорт `orderedSkazHosts` из hostOrder.js (поведение идентично);
   - `computeCard`: ведение `pinMap` рядом с `cache.set` (пин на authoritative FOUND rows, удаление на прочих);
   - экспорт `pinnedHost(providerId, userUid)` из `createAvailabilityChecker`; `defaultChecker.pinnedHost`.
5. **`server/src/index.js`** — `/videos` (235) и `/video` (245): после `requireSubscription` → `context.userUid = sha256Hex(user.token).slice(0,16)`.
6. **`server/src/store.js`** — `payloadOrNull`/`twinForPayload`/`getVideoForRequest`: per-provider контекст с `query.host = pinnedHost(provider.id, context.userUid)` (для twin — по twin.id); без мутации общего `context`.
7. **`server/src/providers/registry.js`** — без изменений (SkazClient сам упорядочивает; конфиг/названия/идентификаторы не трогаем).

### Тесты

- **`server/test/skaz-client.test.js`** — ПЕРЕЗАПИСАТЬ тест 194-208 («rch/JSON (200) НЕ перебирает хосты») → новое поведение: «2xx-non-usable → следующий хост; все non-usable → null + lastScan EMPTY».
- **`server/test/availability-w1.test.js`** (НОВЫЙ): порядок `orderedSkazHosts` == availability == клиент; `pinnedHost` на authoritative FOUND / null на absent/inconclusive/trusted/accsdb; очистка пина при пересчёте; uid-разделение.
- **`server/test/skaz-provider-w1.test.js`** (НОВЫЙ): пин-first (первый fetch — на пин-ноде); провал пина → ротация по остальным нодам (НЕ EMPTY); все ноды non-content → EMPTY; no-response + non-content → UNABLE (не EMPTY); пин не из пула → игнор; сериальный путь (openLiteUrl) тем же сканом; accsdb → provider_error, ротация не продолжается; `buildResolveUrl` НЕ содержит `host`.

### Что НЕ входит в W1 (обязательно читать §8)

---

## 5. Сохраняемые правила (НЕ трогаем)

1. **Три-стейт availability** (AVAILABLE/UNAVAILABLE/INCONCLUSIVE) — probe и кэш карточки без изменений семантики.
2. **OLD∩NEW гейт** (hide только после checksearch-«нет» + прямой lite-page-«нет» + retry-with-backoff) — `confirmAbsence`/`confirmWithBackoff`/`confirmNativeAbsence` без изменений.
3. **abstain-политика online8** (reservePolicy='abstain', kinopub вне абстаина) — без изменений; `isReserveHost` просто переезжает в hostOrder.js.
4. **HARD_REFUSAL_STATUSES** (403/422/451 → host-block, GAP-002) — без изменений.
5. **STABILITY-003 single-flight**, **STABILITY-004 orphan-catch** — без изменений.
6. **TRUSTED filmix всегда видим** (без пробы) — без изменений; пина у trusted нет (нет host).
7. **accsdb = учётка, не нода** — на любом хосте: СТОП ротации + `lastAccsdb` + `provider_error`; в W1 то же (правило «accsdb → стоп» в обходе 2.3).
8. **Hide решает ТОЛЬКО карточка** — /videos не скрывает/не показывает источники; EMPTY /videos — согласованный факт «все ноды сказали нет», не решение о видимости.
9. **Нав-кэш 5 мин, только непустой, ключ без хоста** — без изменений.
10. **identity ≠ presentation** — выбор ноды по `balancer`+`hosts`+пин; `name`/`title`/quality не влияют.
11. **ROTATION через каждый хост ровно один раз** (`_hostTargets`) — без изменений; пин лишь задаёт стартовую точку.

---

## 6. Обязательные тесты (чек-лист при реализации)

1. **Фикс (b) — клиент:** h1 2xx-non-usable + h2 usable → возвращает HTML h2; h1,h2 non-usable → null + `lastScan={nonContent:2,noResponse:0}`; h1 non-usable + h2 timeout → null + `lastScan={nonContent:1,noResponse:1}` (UNABLE, НЕ EMPTY).
2. **Фикс (a) — порядок:** `orderedSkazHosts(config.skaz.hosts)` даёт online8 последним; порядок availability == порядок клиента (сравнить 6-элементные массивы).
3. **Пин — запись:** authoritative FOUND row → `pinnedHost` возвращает host; absent/inconclusive/trusted/accsdb → null.
4. **Пин — uid:** два userUid → независимые пины.
5. **Пин — TTL/пересчёт:** по рекомпуту с absent-вердиктом пин очищен.
6. **Пин — старт:** `videos` с пином → первый fetch на пин-ноде.
7. **Обратный сценарий:** пин-нода 2xx-non-usable → обход продолжается → контент на следующей → items (НЕ EMPTY).
8. **Все ноды non-content → EMPTY**; **no-response → UNABLE** (нет `provider_error`-absent).
9. **Пин не из пула → игнор**, обычная ротация.
10. **Серийный путь:** `openSeasonPage` с пином → `openLiteUrl` на пин-ноде; seasons/voices/серии не регрессируют.
11. **accsdb** на пин-ноде → stop + `provider_error`, ротация не продолжается.
12. **`buildResolveUrl` не содержит `host`** (секреты/пин не утекают клиенту).
13. **Регрессия:** существующие тесты client/provider/availability/online8/hidden-twin/navigation/store-serial/registry-twin/stability-004 — все зелёные (полный прогон `NODE_ENV=test node --test`).
14. **EoClient/`e2e-skaz-vs-eo`:** сравнение обновить намеренно — SkazClient теперь «впереди» EoClient по EMPTY-случаям (continue), на FOUND-случаях обязано совпадать (иначе регрессия).

---

## 7. Обязательные live-проверки (после деплоя, с VPS)

1. **Паразиты/skaz-kinopub:** 3-5 проб: карточка FOUND → /videos items>0 (было 0). Ответ на Q1 аудита (стабилен или транзиент).
2. **Форрест/kinopub:** 5 проб: /videos CONTENT при любом старте ротации (флап-EMPTY исчез).
3. **Дом Дракона/kinopub:** карточка hide + /videos EMPTY согласованы (пин не создал FP).
4. **Пин-механика:** сервер-лог/трассировка `fetch` — первый запрос /videos для kинопуб-тайтла после карточки идёт на online8.
5. **Без пред-карточки** (клиент на статическом /sources): /videos находит контент чистой ротацией (kinopub — через online8 последним) — не сломан.
6. **Серийный путь:** Последний дом/veoveo, Дом Дракона/veoveo+alloha: сезоны/голоса/серии интактны; resolve серии 200.
7. **Резолв на Play:** item из пин-найденного /videos → /video → 200 play (голос/серия совпадает со списком).
8. **Регрессия матрицы:** 10 фильмов класса A — показ+items сохранились; 16 источников /sources — как было.
9. **Мультиюзер/параллельность:** два тайтла одного provider одновременно, разные пины — без перекрёстного заражения (нет мутации общего клиента).
10. **accsdb:** не грант-аккаунт → `provider_error`, ротация не уходит в бесконечность.

---

## 8. Риски

1. **Пина нет, а kinopub-контент только на online8 (последняя нода).** Без пред-карточки обход 2.3 дойдёт до online8 последним → до 6 HTTP-ходов (латентность). Пин закрывает типичный сценарий (Lampa ходит за карточкой сначала); worst-case — только при статическом /sources и холодной ротации. Приемлемо; не решаем хардкодом.
2. **Пины в нав-кэше.** Кэш непустой, ключ без хоста → контент-карточки от пин-ноды переиспользуются запросом без пина. Безопасно (контент/voice-индексы от любого хоста того же балансера идентичны; аккаунт общий на сервере).
3. **Нет мутации общего `SkazClient`.** Пин передаётся аргументом в каждый вызов — параллельные запросы разных юзеров/тайтлов не перетирают друг друга. Нарушение этого = гонка (обязательный тест 9 в §6).
4. **`continue` на 2xx-non-usable маскирует «модуль выключен на ВСЕХ нодах» как EMPTY.** Это ровно поведение карточки (all-non-content → absent) — согласовано, не регрессия.
5. **Доп. нагрузка на кластер** (чтение тел всех нод на non-content). Ограничено размером пула (6), бюджетом дедлайна (`fetchHost` уже таймаутит по остатку). Следить в live: `/lite/events` не должен задышаться (прошлый лимит ~112 зап/15с — STABILITY-002).
6. **Проверка страницы checksearch vs прямая.** Карточка судит по checksearch-странице, /videos — по прямой lite-странице; на одной ноде они могут расходиться. Пин уменьшает, но не устраняет (остаточный класс C при редких расхождениях ноды). Гейт OLD∩NEW продолжает защищать hide.
7. **`_hostIndex` side-effect пина.** Если пин-вызов всё же инкрементирует `_hostIndex`, не-пин-вызовы сдвигают стартовую ноду (как сегодня). Косметика; при реализации — не инкрементировать на пин-вызове.
8. **EoClient-паритет нарушается намеренно.** EoClient остаётся «старым» (FAIL-NOT-RETRY) — это эталон сравнения, НЕ прод. `e2e-skaz-vs-eo.mjs` перепроверить: FOUND-кейсы обязаны совпадать; EMPTY-кейсы — SkazClient обязан быть согласованным с карточкой, EoClient — нет.

---

## 9. Что НЕ менять (запретный список W1)

- **EoProvider/EoClient** — сравнение-эталон, вне registry, не трогаем.
- **`config.skaz.hosts`** — состав пула не меняем (порядок — на конструкцию).
- **Display names / provider IDs** — `Maniya · …`, `skaz-<slug>`, `EO_TITLES` — не меняем.
- **Предикат checksearch / RULE-1**, **native-probe**, **TRUSTED filmix**.
- **GAP-002** (collaps 422), **GAP-005** (title RU/EN), **GAP-013**, **STABILITY-004**, **ONLINE8-002 abstain**, **VEO-015** (title/quality-метки), **BALANCER-KINOPUB-004** (link-тайтл-фильтр навигации).

- **`_hostIndex`-семантику прочих путей** — сканирующий обход получают ТОЛЬКО `getLite`/`openLiteUrl`; `fetchHosts`/`discover`/`resolveVideoJson` не меняются.
- **«videos=0 → hide»** — hide на /videos НЕ добавляем (прямое требование; hide остаётся за карточкой).
- **Пер-фильм/пер-балансер хардкод** — ничего специфичного для отдельных тайтлов (остаются только существующие политики: kinopub вне абстаина, TRUSTED filmix без пробы, online8-резерв).
- **allowlist/egress** — `proxy.allowHosts`, `api.ortified.ws` не касаемся.
- **Статический /sources / EO_TITLES / display names / provider IDs** — вне W1 (это W5/косметика).
- **origin/remote** — push только в `backup`; origin не трогаем.

---

## 10. Итог (резюме для реализации)

**Точный root cause (две дивергенции, обе доказаны кодом и live):**
1. **Порядок пула разный.** Карточка: `reorderHosts(config.skaz.hosts)` (online8 последний). Клиент /videos: сырой `config.skaz.hosts` (online8 второй).
2. **FAIL-NOT-RETRY.** Карточка продолжает обход на 2xx-non-content; `SkazClient.getLite` останавливается на первом 2xx и при non-usable теле возвращает null, не пробуя другие ноды.

Совместно: карточка находит контент на ноде N, /videos «решает», что источник пуст, остановившись на первой ноде без контента (доказанный FP Паразиты/kinopub, класс B). Флап Форрест/kinopub — тот же корень (b) в транзиентной форме.

**Точная целевая модель cluster-selection:**
- Единый порядок нод `orderedSkazHosts` (online8 последний) — общий для карточки и клиента.
- Единый сканирующий обход `getLite`/`openLiteUrl`: 2xx-usable → CONTENT (стоп); 2xx-non-usable → continue; не-2xx/timeout/сеть → continue; accsdb → стоп + provider_error. EMPTY только когда ВСЕ ноды ответили content-«нет»; любой no-response → UNABLE (НЕ EMPTY). «cluster A EMPTY + cluster B CONTENT → CONTENT».
- Пин: авторитетный FOUND-вердикт карточки сохраняет `row.host` (uid-скоупед, TTL=кэша); /videos и /video стартуют с пина как preferred-first, при его провале — честная ротация по остальным нодам (обратный сценарий), НЕ EMPTY.
- Выбор ноды оперирует только `balancer + hosts + пин`; display name/качество/порядок кластера на него не влияют (identity ≠ presentation).

**Минимальный список изменений:** +hostOrder.js; SkazClient.js (порядок, скан, lastScan); SkazProvider.js (проброс пина); availability.js (pinMap, pinnedHost, reorderHosts→hostOrder); index.js (context.userUid на /videos и /video); store.js (query.host per-provider); тесты (переписать skaz-client.test.js:194-208; новые availability-w1 + skaz-provider-w1). Registry.js, EoClient, config — без изменений.

**Сохраняемые правила:** три-стейт; OLD∩NEW гейт; abstain-online8; HARD_REFUSAL (GAP-002); STABILITY-003 single-flight; STABILITY-004 orphan-catch; TRUSTED filmix; accsdb=учётка; hide решает только карточка; нав-кэш без хоста; rotation-инвариант; identity≠presentation.

**Обязательные тесты (§6, 14 пунктов):** continue-скан, порядок-паритет, пин write/uid/TTL/старт, обратный сценарий «пин упал → ротация → контент», EMPTY vs UNABLE, пин вне пула, serial-путь, accsdb-стоп, no-host-leak из buildResolveUrl, полная регрессия, EoClient-паритет на FOUND-кейсах.

**Обязательные live-проверки (§7, 10 пунктов):** Паразиты/kinopub класс B→A (3-5 проб), Форрест/kinopub флап-EMPTY исчез (5 проб), Дом Дракона/kinopub согласованный absent (без нового FP), трассировка «первый fetch на online8 после карточки», холодная ротация без пред-карточки, сериальный путь (Последний дом/veoveo, Дом Дракона/alloha+veoveo), резолв на Play 200, регрессия матрицы класса A + 16 источников, мультиюзер/параллелизм без гонки, accsdb-диагностика.

**Риски (§8, 8 пунктов):** worst-case латентность без пина (kinopub — online8 последний); нав-кэш с пин-карточками (безопасно); гонка при мутации общего клиента (запрещена явно, тест §6.9); «все ноды выключены» маскируется EMPTY (согласовано с карточкой); доп. запросы к кластеру (следить за /lite/events ~112 зап/15с); остаточный класс C (пин уменьшает, OLD∩NEW страхует); `_hostIndex` side-effect (не инкрементировать на пин-вызове); намеренный разрыв EoClient-паритета (EoClient остаётся эталоном сравнения).

**Что НЕ менять (§9):** EoClient/EoProvider; config.skaz.hosts; display names/IDs/EO_TITLES; предикат RULE-1 / native-probe / TRUSTED filmix; GAP-002/005/013; STABILITY-004; ONLINE8-002 abstain; VEO-015; BALANCER-KINOPUB-004; /videos-hide; пер-фильм хардкод; allowlist/egress; origin/remote (push только `backup`).

---

**STOP. Дизайн W1 (CLUSTER CONSISTENCY) завершён. Код НЕ писался, тесты НЕ менялись, ничего НЕ закоммичено и НЕ задеплоено. Реализация W1 начнётся только по явному решению пользователя. К W2 (soft-hide на /videos) НЕ переходим автоматически.**
