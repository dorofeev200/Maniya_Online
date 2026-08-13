# BALANCER-001 — Аудит: динамический выбор источников (E-Online/Skaz vs Maniya)

Дата: 2026-08-13. Статус: **ЗАВЕРШЁН (research only, код не менялся)**.

Гипотеза: «когда юзер открывает конкретный фильм, Lampa (E-Online) НЕ показывает
статический список из ~33 источников; происходит динамический выбор — запрос к
балансерам, каждый проверяет наличие контента, возвращаются только рабочие,
и список РАЗНЫЙ для разных фильмов».

**Вердикт: гипотеза ПОДТВЕРЖДЕНА** — кодом (Lampac `OnlineApi.cs`) и живыми
замерами против реального skaz-кластера (online3.skaz.tv). С оговорками:
фильтрация серверная (`show:true/false`), клиент рисует нерабочие источники
«призраками», выбор балансера кэшируется на карточку, а сам универсум
проверяемых балансеров зависит от хоста кластера и типа контента (сериал/фильм).

---

## 1. ГРАФ ВЫЗОВОВ E-Online (клиент Lampac + сервер кластера)

Клиент — `Online/plugin.js` (плагин Lampac v1.8.0). Сервер — `Online/OnlineApi.cs`
(Lampac, бэкенд skaz-кластера). «{localhost}» заменяется на хост кластера.

```
Юзер открыл карточку фильма/сериала
  │
  ▼ plugin.js createSource()  (строка 466)
  │   GET lite/events?life=true&id=&imdb_id=&title=&original_title=&serial=0|1
  │       &year=&original_language=&source=tmdb&clarification=&similar=&rchtype=
  │       &account_email=<e>&uid=<uid>                     (requestParams, строка 307)
  │
  ▼ Server OnlineApi.Events()  (строка 653)
  │   • собирает «online» из ВСЕХ OnlineModuleEntry.Modules/ModulesAsync/…
  │     через каждый module.Invoke() + send()  (строки 727–854)
  │     send() = гейт: workinghours, rchtype, geo_hide, group_hide,
  │             язык (clarification для ru/ja/ko/zh), NOT контент
  │   • если ModInit.conf.checkOnlineSearch && id != ""  (строка 870):
  │       memkey = Fnv1a(id : serial : source : online.Count : uid)   (5 мин кэш)
  │       для КАЖДОГО о из online → ПАРАЛЛЕЛЬНЫЙ checkSearch(...)      (строка 897)
  │       если life=true → сразу {life:true, memkey}                   (строка 904)
  │
  ▼ Parallel: checkSearch()  (строка 957)
  │   GET <lite-url-балансера>?…&checksearch=true   (по одному на балансер, таймаут 10с)
  │   work = rch || res.Contains("data-json=")
  │          || "type":"movie" | "type":"episode" | "type":"season"     (строка 975)
  │   quality из <!--q:--> / "2160p" / HDR → суффикс имени            (строки 987–1044)
  │   links[i] = {"name", "url", "index", "show":work, "balanser", "rch"}  (строка 1047)
  │
  ▼ Клиент (life=true): показан loader в фильтре, поллинг каждые 1с
  │   plugin.js lifeSource()  (строка 384)
  │   GET lifeevents?memkey=<m>  (строка 387)
  │     Server LifeEvents()  (строка 543): onlineItems отсортированы
  │       OrderByDescending(work).ThenBy(index) → рабочие ПЕРВЫМИ (строка 570)
  │       ready = onlineItems.Count == links.Count
  │       error {accsdb:true} когда ready && !show (нет ни одного рабочего)
  │     клиент: filter.set('sort', filter_sources.map(e => ({
  │              title: sources[e].name, ghost: !sources[e].show })))  (строка 425)
  │     gou(): resolve когда выбранный балансер show=true ИЛИ любой show=true (строка 389)
  │
  ▼ startSource()  (строка 356): балансер =
  │     online_last_balanser[movie.id]  (кэш выбора на карточку, 3с/3000мс)
  │     || Storage online_balanser (глобальный) || первый источник
  │     если выбранный show=false и НЕ lampac_custom_select → первый источник
  │   source = sources[balanser].url → дальнейший getVideo/getPlayer
  │
  changeBalanser() (строка 298): выбор юзером пишется в online_last_balanser[movie.id]
```

Ключевые факты:
- **Проверка контента — СЕРВЕРНАЯ и ПАРАЛЛЕЛЬНАЯ** (по одному запросу на
  балансер с `checksearch=true`), результат кэшируется 5 минут на
  `(id:serial:source:count:uid)`.
- Клиент **рисует все источники**, но нерабочие — как `ghost` (затемнённые,
  невыбираемые). Автовыбор всегда попадает на первый `show=true`.
- Выбор балансера юзером запоминается **на карточку** (`online_last_balanser`).
- `lite/withsearch` (строка 419) = **статический** discovery-список конфига
  `online.with_search`, НЕ участвует в фильтрации карточки.

## 2. ГРАФ ВЫЗОВОВ SKAZ (поведение балансеров под капотом)

`lite/events` — это «фасад». На деле каждый балансер — самостоятельный lite-модуль
того же Lampac: `lite/<balancer>?id=…&title=…&serial=…` → HTML-страница карточек
(`data-json=` / `<!--q:2160p-->`), по которой checkSearch и решает `work`.
Сериалы — двухуровневая навигация (база → перевод `t=` + сезон `s=` → серии).

## 3. ГРАФ ВЫЗОВОВ MANIYA (текущая реализация)

```
Юзер открыл карточку
  │
  ▼ плагин public/maniya-online.js → GET /api/lampa/sources  (index.js:114)
  │   registeredProviders().filter(enabled)  →  СТАТИЧЕСКИЙ список
  │   (native: filmix, kodik, rezka, alloha, rutube, cdnvideohub, collaps, hdvb
  │    + skaz-<balancer> для каждого из config.skaz.balancers)
  │   Никакой проверки наличия контента НЕТ.
  │
  ▼ юзер выбрал источник → GET /api/lampa/videos?provider=<id>  (index.js:135)
  │   store.js getVideosForRequest() (store.js:103)
  │   ОДИН провайдер: если сериал → native первым, skaz-близнец фоллбэк;
  │   фильм → близнец первым, native фоллбэк (НЕ объединяем — без дублей)
  │
  ▼ SkazProvider.videos() → collectMovieCards/openSeasonPage  (SkazProvider.js)
  │   SkazClient.getLite(params) → GET lite/<balancer>?…&account_email&uid
  │     (SkazClient.js:74)  — ОДИН балансер, БЕЗ checksearch, БЕЗ lite/events
  │   host-ротация ТОЛЬКО на 5xx/network (fetchHosts, строка 247)
  │   200-ответы (в т.ч. «нет контента», accsdb, disable) НЕ ротируются
  │
  ▼ Play: method:"call" → /api/lampa/video → resolveVideo (ленивый, на карточку)
  │   /api/lampa/stream → прокси
```

## 4. СРАВНИТЕЛЬНАЯ ТАБЛИЦА

| Аспект | E-Online (Lampac) | Maniya (сейчас) |
|---|---|---|
| Источник списка | `lite/events` — формируется на КАЖДУЮ карточку | `/api/lampa/sources` — статический реестр |
| Проверка наличия контента | Да: параллельный `checkSearch` по каждому балансеру (`checksearch=true`) | Нет |
| Флаг показа | `show:true/false` на балансер, кэш 5 мин | отсутствует |
| Отрисовка в UI | все источники, нерабочие — ghost (затемнены), автовыбор = первый show=true | все источники равноценны, «мёртвые» молча дают пустой список |
| Память выбора юзера | `online_last_balanser[movie.id]` (на карточку) | глобальный Storage `maniya_source`? (проверить в плагине) |
| Универсум балансеров | live-зависимый: тип контента (serial ± remux/rutubemovie/vkmovie/mirkino), хост кластера | фиксированный `config.skaz.balancers` (19 шт), не сверяется с кластером |
| Ротация хостов | — (сервер сам жёстко на host) | на 5xx/network, но при 200-пустом ответе НЕ меняет источник |
| Агрегация | серверная (memkey → lifeevents), один ответ со всеми | нет агрегации (1 источник → 1 балансер) |

## 5. ДОКАЗАТЕЛЬСТВА (живые замеры, online3.skaz.tv, аккаунт из server/.env)

### 5.1 Статический список (`lite/withsearch`) — 34 слага
`kinotochka, kinobase, kinopub, lumex, filmix, filmixtv, fxapi, redheadsound,
animevost, animego, animedia, animebesst, anilibria, aniliberty, rezka, rhsprem,
kodik, remux, animelib, kinoukr, rc/filmix, rc/fxapi, rc/rhs, vcdn, videocdn,
lumex, collaps, collaps-dash, vdbmovies, hdvb, alloha, veoveo, rutubemovie, vkmovie`

> Это «идеальный» список 34 — а НЕ то, что юзер реально видит.

### 5.2 `lite/events` по 4 фильмам + фейк-контроль (процент show=true РАЗНЫЙ)

| Фильм | Тип | Всего | show=true | show=false | Состав show=true (выборочно) |
|---|---|---|---|---|---|
| A: Дом Дракона (94997) | сериал | 25 | **14** | 11 | kinopub, filmix, alloha, rezka, pidtor, ashdi, kinoukr, eneyida, videoseed, veoveo, solntse, rhsprem, hdvb, kinotochka |
| C: Укрытие/Silo (125988) | сериал | 25 | **14** | 11 | идентично A (оба супер-популярные → совпало) |
| Войны Спасения (204385) | сериал | 25 | **9** | 16 | kinopub, filmix, rezka, kinoflix, ashdi, kinoukr, eneyida, veoveo, rhsprem |
| The OA (71712) | сериал | 25 | **11** | 14 | kinopub, filmix, rezka, pidtor, kinoflix, ashdi, kinoukr, eneyida, veoveo, rhsprem, hdvb |
| B: Форрест Гамп (13) | фильм | 29 | **15** | 14 | kinopub, filmix, alloha, rezka, remux, pidtor, kinoflix, ashdi, kinoukr, eneyida, veoveo, rhsprem, solntse, hdvb, geosaitebi |
| D: нишевый фильм 1976 | фильм | 29 | **8** | 21 | kinopub, filmix, rezka, ashdi, kinoukr, eneyida, veoveo, rhsprem |
| **ФЕЙК-сериал (id 999999999)** | сериал | 22 | **6** | 16 | filmix, rezka, ashdi, kinoukr, eneyida, rhsprem |
| **ФЕЙК-фильм (id 999999998)** | фильм | 26 | **6** | 16 | filmix, rezka, ashdi, kinoukr, eneyida, rhsprem |

Выводы:
1. **Динамика пер-контент ПОДТВЕРЖДЕНА**: у нишевого фильма D только 8 рабочих
   против 15 у Форреста; у сериалов наборы тоже разные (9/11/14). Фейк-контроль
   сужает до «минимума» из 6 «рыхлых» балансеров (filmix, rezka, ashdi, kinoukr,
   eneyida, rhsprem) — они возвращают `data-json=` даже на несуществующий id.
2. **Универсум зависит от типа**: у фильмов +4 модуля (remux, rutubemovie,
   vkmovie, mirkino); у фейков он ещё меньше (22/26 против 25/29) — модули,
   чей `send()` требует корректный год/ключ, не включены.
3. **«Рыхлые» 6 балансеров** всегда показываются рабочими → в E-Online они будут
   всегда, даже для фильма без источников. Это плата за коа́рсную проверку.

### 5.3 Хост-зависимость (КРИТИЧНО для Maniya)

Один и тот же фильм через разные ноды кластера:

| Хост | Форрест Гамп (фильм) | Дом Дракона (сериал) |
|---|---|---|
| online3.skaz.tv | 29 записей, 15 show | 25 записей, 14 show |
| **online8.skaz.tv** | **12 записей, 3 show: kinopub, lift, kinogo** | **10 записей, 3 show: kinopub, lift, kinogo** |
| 94.249.239.63 | 29 записей, 15 show (идентично online3) | 25 записей, 14 show (идентично online3) |

**online8.skaz.tv — ЛЕГАСИ-нода**: у неё другой набор плагинов (lift, kinogo,
bamboo, redheadsound — которых НЕТ на online3/94.249.*; и НЕТ filmix/alloha/rezka/
hdvb). Maniya в пуле хостов содержит online8 вторым (SkazClient/SKAZ_DEFAULT_HOSTS,
config.js:181/209). Если online3 упадёт в 5xx, ротация перебросит на online8 и
**видимое множество источников резко изменится** — источник «пропадает» без
изменения кода/конфига. Это же объясняет часть исторических «источники пропали».

### 5.4 Семантика checksearch (прямой запрос `lite/kinopub` vs `lite/sakhtv`)
- `kinopub?…&checksearch=true` (A, show=true) → HTTP 200, len 1346, содержит
  `data-json=` и `<!--q:2160p-->` → work=true.
- `sakhtv?…&checksearch=true` (A, show=false) → online3 503 / online8 403
  «disable» / 94.249 503 → work=false. Источник «выключен» на ноде.

## 6. ROOT CAUSE / GAP (Maniya)

**Что есть у E-Online, чего НЕТ у Maniya** — один архитектурный слой:

> Per-card проверка наличия контента по всем балансерам
> (`checksearch=true` в параллель, `show:true/false`), поверх статического реестра.

Следствия текущего состояния Maniya:
1. **«Мёртвые» источники светятся в UI.** `config.skaz.balancers` включает
   zagonka, videocdn, lumex, kinobase — они НЕ входят в live-универсум `lite/events`
   (gated: rch/WS/аккаунт/группа) → источник всегда даёт пустой список → юзер
   видит «нет источников» у работающего сервиса. (kodik — исключение: работает
   как native-провайдер отдельным контуром.)
2. **Пропущены живые источники.** ashdi, kinoukr, eneyida, rhsprem стабильно
   `show=true` в замерах, но их НЕТ в `config.skaz.balancers` → не светятся вовсе.
3. **Порядок списка статичен**, не отражает «что реально играется для этой карточки».
4. **Хост-ротация может молча урезать универсум** (см. 5.3, online8).
5. Е-Online дополнительно рисует ghost-призраков и кэширует выбор юзера на карточку —
   у Maniya глобальный выбор без памяти на карточку.

## 7. ПЛАН СЛЕДУЮЩЕЙ ЗАДАЧИ (минимальный слой; НЕ выполнять в этом аудите)

Цель: повторить для Maniya серверную проверку `show` на карточку — без смены
UI-модели плагина (он и так умеет `ghost`/`show`? — проверить при реализации).

**Шаг 1. Сверка реестра с живым кластером (0-риск, быстро).**
- Внести в `config.skaz.balancers`: ashdi, kinoukr, eneyida, rhsprem (+ geosaitebi
  для фильмов); убрать/скрыть zagonka, videocdn, lumex, kinobase (или перевести в
  «скрытые», пока не починен доступ).
- Сейчас источники-без-контента дают пустой `items` → плагин должен их гасить
  (проверить `show`-механику плагина Maniya).

**Шаг 2. Per-card check (`/api/lampa/sources` или новый эндпоинт).**
- Новый эндпоинт, например `GET /api/lampa/sources/card?…` (или расширить
  `/sources` параметрами карточки `id/title/serial/…`), реализует:
  `SkazClient.checksearch` — параллельный GET `lite/<b>?…&checksearch=true`
  (тот же предикат `data-json`/`"type":…`/`rch`), лимит времени ~8–10с,
  кэш 5 мин по `Fnv1a(id:serial:source:count:uid)` (как Lampac), возврат
  `{sources:[{id,name,show,quality}]}`.
- Плагин: по карточке запрашивает `/sources/card`, рисует нерабочие ghost/скрытыми,
  автовыбор = первый show=true, кэширует выбор юзера на карточку.
- Native-провайдеры (filmix/kodik/rezka/alloha/…) НЕ трогать — они работают через
  свои API и показывают реальный контент; для них `show=true` безусловно (или их
  собственный поиск), если не критично.
- Сохранить существующий `getVideosForRequest` fallback (twin/native) без изменений.

**Шаг 3. Учёт хоста.**
- `checksearch` гнать через пул хостов с приоритетом online3/94.249.*; online8 —
  только как последний резерв (или исключить из пула, т.к. легаси-универсум).

**Шаг 4. Тесты.**
- Mock-тесты предиката show, кэша, таймаута; live-тест на 3 карточки (как в §5.2)
  в `test/eolive.test.js`-стиле. Полный прогон `cd server && NODE_ENV=test node --test`.

**Критерии приёмки.**
- Для D-карточки (нишевый) UI показывает только реально работающие источники
  (или корректно гасит остальные) — совпадение с замером §5.2.
- На устройствах: Play с первого рабочего источника без «видео не найдено».
- Регрессия: 200/200 существующих тестов, никаких изменений контракта
  native-провайдеров.

---

### Итог (для resume)
- ГИПОТЕЗА ДИНАМИКИ ПОДТВЕРЖДЕНА (код + live). E-Online показывает не статический
  33-список: сервер параллельно проверяет каждый балансер (`checksearch=true`),
  отдаёт `show:true/false`, клиент гасит нерабочие и помнит выбор на карточку.
- GAP Maniya: статический реестр без per-card проверки → мёртвые источники светятся,
  живые (ashdi/kinoukr/eneyida/rhsprem) отсутствуют, хост-ротация (online8-legacy)
  может молча менять универсум.
- НИЧЕГО не правилось. Отчёт: docs/balancer-001-audit.md.
