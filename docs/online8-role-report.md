# BALANCER-ONLINE8-001 — Роль online8.skaz.tv в системе балансеров

Дата: 2026-08-14. Статус: **исследование, read-only**. Изменений кода/конфига/policy
НЕ вносилось, коммитов/деплоев НЕ было. Все live-пробы — с VPS (root@95.85.241.121),
реальные creds из `/opt/maniya-online/server/.env`, пауза ≥3 с между запросами (429).
Дополнено 14.08 после обрыва связи (сессия прервалась до финализации): §2.2 —
персистентность `_hostIndex` и TTL выбранного хоста (пункт 1); §3.7 — полная
per-balancer деталь пункта 3 (title / kp / imdb / rch / latency). Выводы не изменились.

## 0. TL;DR

**online8.skaz.tv — легаси-нода с выключенными модулями.** Из наших 10 балансеров она
реально обслуживает только **kinopub** (200, method:play, 25 карточек). Для остальных 9
отвечает единообразным **403 с телом `disable`** (7 байт) — это **политика ноды
«модуль выключен»**, а НЕ «контент отсутствует». Доказано: в том же окне online3 отдаёт
рабочие карточки по тем же тайтлам (filmix 5×play, rezka 22×call, rhsprem 22×call,
alloha 4×call, kinoflix 3×play, geosaitebi 1×link), а 403 `disable` от online8 приходит
**одинаково** и для реального id, и для фейк-id (query-independent → модульный вердикт).

Единственное место, где 403 `disable` online8 может навредить, — `availability.js probe()`,
который учитывает любой не-2xx как «нет»-голос, не читая тело. В playback-контуре
(`SkazClient`) 403 не является финальным ответом: ротация уходит на следующий хост
(self-heal), поэтому на воспроизведение online8 не влияет.

## 1. Метод

1. Статический анализ: `SkazClient.js`, `availability.js`, `config.js`, `registry.js`,
   `EoClient.js`, `skaz-architecture.md`, `balancer-001-audit.md`.
2. Live-пробы на VPS (read-only): 10 балансеров × 2 ноды (online3/online8), одна карточка
   (Форрест Гамп id=13, checksearch=true) + фейк-контроль (id=999999998) + прямая
   lite-page без checksearch + `lite/withsearch` (реестр ноды) + EO-референс
   (`lite/events?life=false`). ~50 запросов, все 200/302/403/503, 429 не возникало.

## 2. Пункт 1 — как устроен пул хостов (static analysis)

### 2.1 Две РАЗНЫЕ host-политики в одном коде

| Подсистема | Пул хостов (config.skaz.hosts по умолчанию) | Роль online8 |
|---|---|---|
| **`SkazClient`** (videos/playback, `SkazProvider`) | `[online3, online8, 94.249.239.{63,37,11}, 77.90.33.109]` | **2-й**, round-robin: `_hostIndex` инкрементится в `buildLiteUrl` каждый вызов → ~1/6 запросов стартует на online8 |
| **`availability.js` probe** (card-видимость) | `reorderHosts(...)` → `[online3, .63, .37, .11, 77.90, online8]` | **ПОСЛЕДНИЙ**, резерв (`isReserveHost` = `host.includes('online8')`) |

`config.skaz.hosts` = `list('SKAZ_HOSTS', list('EO_HOSTS', <дефолт>))`; на VPS ни
`SKAZ_HOSTS`, ни `EO_HOSTS` не заданы → действует дефолт. `SkazProvider` передаёт
клиенту `hosts: config.skaz.hosts` без реордера. `EoClient` (легаси) держит отдельно
`DEFAULT_HOSTS = [94.249.*]` и `SKAZ_HOSTS = [online3, online8]`.

### 2.2 SkazClient — ротация (playback, self-heal мимо 403)

- `fetch()` возвращает Response **только для `STATUS_REST = {200,201,202,203,204,206}`**.
  403/503/302-redir-glob/сеть → `null` → `fetchHosts` переходит к следующему хосту.
- `_hostTargets(url)` = `[url как есть]` + остальные хосты пула (старт от текущего хоста
  ротации, каждый хост ровно один раз). Значит, когда round-robin выбрал online8 и та
  ответила 403 `disable`, запрос автоматически уходит на .63 → .37 → .11 → 77.90 → online3.
- **Вывод: в playback-контуре 403 `disable` online8 безвреден** — это один лишний hop
  (~30–150 мс) при ~17% запросов, финальный контент приходит с primary.
- **`_hostIndex` сохраняется на время жизни процесса.** `SkazProvider` — singleton,
  собран один раз при загрузке модуля (`registry.js`: `allSkazProviders =
  buildSkazProviders()` на верхнем уровне), `_hostIndex` — поле экземпляра `SkazClient`,
  инкрементируется в каждом `buildLiteUrl` (один вызов на один запрос `getLite`).
  Между запросами счётчик НЕ сбрасывается — ротация монотонна.
- **TTL у выбранного хоста НЕТ.** Хост «действует» ровно один запрос: следующий запрос
  уже стартует на следующем хосте пула (round-robin, ~1/6 стартов на online8). Никакого
  sticky-окна / time-based валидности выбранного хоста в `SkazClient` нет — в отличие от
  availability (5-мин memkey-кэш вердикта), playback-контур решает по каждому запросу.

### 2.3 availability.js probe — ротация (единственное место ущерба)

- `hosts[0]` = online3 (после реордера). `probe()` идёт по хостам:
  - 2xx content-bearing → предикат (авторитетно, стоп);
  - 2xx «нет» (null/disable/false/not found) и **не-2xx (403/404/503/5xx)** → «нет» на
    ЭТОЙ ноде → следующий хост;
  - таймаут/сеть/accsdb(кроме «Ожидаем фильм...») → вердикта нет → следующий хост.
- Итог: если хоть один хост не ответил → inconclusive (показ). Иначе, когда **все хосты
  ответили «нет»** → authoritative absent (hide).
- **Критично: `probe()` не читает тело не-2xx-ответа.** 403 `disable` от online8
  учитывается ровно как «нет», неотличимо от честного «контента нет».
- Проверка карточки kinopub идёт через 302-туннель: `fetchHost` следует редиректам
  (дефолт fetch `redirect:'follow'`), online3 → online8. Сатурация online8 (503) бьёт и
  по карточке kinopub, и по OLD-навигации — это «класс 2» `balancer-002-report.md`.

## 3. Live-пробы — результаты

### 3.1 Матрица online3 vs online8 (Форрест Гамп id=13, checksearch=true, 2026-08-14)

| балансер | online3 | online8 | первая data-json карточка (online3 / online8) |
|---|---|---|---|
| filmix | 200 content:5 | **403 `disable`** | play / — |
| rezka | 200 content:22 | **403 `disable`** | call / — |
| rhsprem | 200 content:22 | **403 `disable`** | call / — |
| videoseed | 503 (пусто) | **403 `disable`** | — |
| kinopub | 302 → online8 | **200 content:25** (в др. окне 503/16с) | play / play |
| alloha | 200 content:4 | **403 `disable`** | call / — |
| kodik | 503 (пусто) | 503 (пусто) | — |
| kinoflix | 200 content:3 | **403 `disable`** | play / — |
| rutubemovie | 503 (8с) | **403 `disable`** | — |
| geosaitebi | 200 content:1 | **403 `disable`** | link («ფორესტ გამპი») / — |

Фейк-контроль (id=999999998): online8 вернул **те же 403 `disable`** для
filmix/rezka/rhsprem/videoseed, что и для реального id → **query-independent**,
модульный (не контентный) вердикт.

### 3.2 Тело 403 и headers

- `online8/lite/filmix` → **403, body = `"disable"`** (ровно 7 байт),
  `content-type: text/html; charset=utf-8`, lat ~30–150 мс (мгновенный отказ, не таймаут).
- Совпадает с `balancer-002-postdeploy-shadow-report.md`: «online8.skaz.tv → 403 disable
  (filmix ВЫКЛЮЧЕН на ноде)».

### 3.3 Реестр online8 (`lite/withsearch`, 33 модуля)

`alloha, aniliberty, anilibria, animebesst, animedia, animego, animelib, animevost,
collaps, collaps-dash, filmix, filmixtv, fxapi, hdvb, kinobase, kinopub, kinotochka,
kinoukr, kodik, lumex, rc/filmix, rc/fxapi, rc/rhs, redheadsound, remux, rezka, rhsprem,
rutubemovie, vcdn, vdbmovies, veoveo, videocdn, vkmovie`

Наши 10: **filmix, rezka, rhsprem, kinopub, alloha, kodik, rutubemovie — В реестре**;
**videoseed, kinoflix, geosaitebi — НЕ в реестре** (модуля на ноде нет вовсе).

### 3.4 Прямая lite-page без checksearch (то, что тянет OLD videos())

`online8`: kinopub → **200** method:play; filmix/rezka/rhsprem/alloha/kinoflix/
rutubemovie/geosaitebi/videoseed → **403 `disable`**; kodik → **503 пусто**.

### 3.5 kinopub-туннель (единственный из наших, кого online8 обслуживает)

- `online3/lite/kinopub` → **302** на `http://online8.skaz.tv/lite/kinopub?...` (auth в URL).
- follow → **200**, len 84513, карточки method:play.
- В первом окне пробы online8 kinopub напрямую ответила **503 через 16 с** (сатурация),
  во втором — **200 за 202–485 мс**. Легаси-нода флапает нагрузкой.

### 3.6 EO-референс (это окно, `lite/events?life=false`, Forrest)

show = `[Filmix ~ 4K, Ashdi, UAkino, Eneyida, HDRezka ~ 4K]`, hide = `[KinoPub, Lumex,
Kinoteatr.kg, Alloha, Rezka, Kinobase, iRemux, Fanserials, SkazTV, xVideoCDN (Ultra),
xVideoCDN (60/120fps), FilmGE, Rutube, VK Видео, Videoseed, VeoVeo, Солнце, HDVB,
Kinotochka, AsiaGe, Geosaitebi, Мир кино Z, UaKino]`. Отличается от окна
`balancer-stability-card-report.md` (там было 9 show) — **кластер меняет вердикты между
окнами**; внутри 5-минутного memkey-кэша стабилен.

### 3.7 Пункт 3 — полная per-balancer деталь (title / kp / imdb / rch / latency)

Повторная read-only проба после обрыва связи (тот же Форрест Гамп id=13, checksearch=true,
20 запросов + карточные структуры, пауза ≥3 с). Дополняет §3.1 отсутствовавшими колонками:

| балансер | нода | status | lat, мс | len, Б | body | n | method | title (первая карточка) |
|---|---|---|---|---|---|---|---|---|
| filmix | o3 | 200 | 492 | 5 973 | data-json | 5 | play | Форрест Гамп (Многоголосый, P - [4К, RU]) |
| filmix | o8 | 403 | 142 | 7 | `disable` | 0 | — | — |
| rezka | o3 | 200 | 483 | 22 375 | data-json | 22 | call | Форрест Гамп (Дубляж) |
| rezka | o8 | 403 | 69 | 7 | `disable` | 0 | — | — |
| rhsprem | o3 | 200 | 1 061 | 22 463 | data-json | 22 | call | Форрест Гамп (Дубляж) |
| rhsprem | o8 | 403 | 57 | 7 | `disable` | 0 | — | — |
| videoseed | o3 | 503 | 357 | 0 | пусто | 0 | — | — |
| videoseed | o8 | 403 | 90 | 7 | `disable` | 0 | — | — |
| kinopub | o3 | 200* | 5 208 | 84 513 | data-json | 25 | play | Форрест Гамп (Многоголосый (Позитив-Мультимедиа)) |
| kinopub | o8 | 200 | 292 | 90 804 | data-json | 25 | play | Форрест Гамп (Многоголосый (Позитив-Мультимедиа)) |
| alloha | o3 | 200 | 175 | 5 021 | data-json | 4 | call | Форрест Гамп (Профессиональный многоголосый) |
| alloha | o8 | 403 | 54 | 7 | `disable` | 0 | — | — |
| kodik | o3 | 503 | 198 | 0 | пусто | 0 | — | — |
| kodik | o8 | 503 | 334 | 0 | пусто | 0 | — | — |
| kinoflix | o3 | 200 | 495 | 3 821 | data-json | 3 | play | Форрест Гамп (Русский) |
| kinoflix | o8 | 403 | 54 | 7 | `disable` | 0 | — | — |
| rutubemovie | o3 | 503 | 8 070 | 4 | body `null` | 0 | — | — |
| rutubemovie | o8 | 403 | 57 | 7 | `disable` | 0 | — | — |
| geosaitebi | o3 | 200 | 836 | 652 | data-json | 1 | link | ფორესტ გამპი |
| geosaitebi | o8 | 403 | 56 | 7 | `disable` | 0 | — | — |

\* o3 kinopub = 200 через 302-туннель на online8 (fetch `redirect:follow`; 5.2 с = редирект +
загрузка легаси-ноды). o8 kinopub напрямую — 200/292 мс.

**kp/imdb — во всех 20 ответах отсутствуют.** Структура первых карточек:
- filmix (play): keys `method,url,quality,translate,maxquality,title`; url = CDN-ссылка
  (cdnsqu.com), id-полей нет;
- rezka (call): keys `method,url,stream,translate,title`; url = `lite/rezka/movie?...&id=763&t=56`
  — внутренний id ноды, НЕ kp/imdb;
- geosaitebi (link): keys `method,url,similar,year,details,title`; url = тот же lite-запрос,
  kinopoisk_id в url НЕТ.
→ колонки kp/imdb честно пусты («если есть» → кластер их не присылает).

**rch — ни в одной из 20 проб** (`"rch":true` отсутствовал в этом окне).

**Latency — ключевой сигнал классификации:** 403 `disable` от online8 = **54–142 мс** на
всех 9 балансерах (мгновенный модульный отказ, НЕ таймаут и НЕ сатурация). Контентные 200
на o3 — 175–1 061 мс. Сатурационные 503 — o3 rutubemovie 8 070 мс, kodik 198/334 мс.
→ 403 `disable` — решение политики ноды, не перегрузка.

## 4. Пункты 4 и 8 — классификация ответов online8

| Класс | Наблюдение | Есть ли в ответе online8 |
|---|---|---|
| 1. Источник не существует (нет нигде) | — | **Не подтверждено ни для кого из наших 10.** Для filmix/rezka/rhsprem/alloha/kinoflix/geosaitebi контент есть на online3 в том же окне |
| 2. online8 не обслуживает этот балансер | 403 `disable` для 9/10 (7 в реестре-но-выключены, 3 не в реестре) | **Да** — это и есть ответ |
| 3. online8 временно недоступен (сатурация) | kinopub 503/16с→200/485мс; kodik 503 пусто | **Да** (503) |
| 4. online8 ответил authoritative absence | — | **Не подтверждено.** Единственный содержательный ответ online8 — kinopub 200. «Нет» для остальных — модульный disable, а не контент-вердикт |

**Различает ли ответ «не поддержан нодой» vs «контент отсутствует» — ДА:**

| Ответ | Сигнал |
|---|---|
| 403 + тело `disable` | Модуль выключен/отсутствует на ноде (**node-policy**, query-independent) |
| 2xx + первая строка `null`/`not found` | Контента нет **на этой ноде** (query-dependent) |
| 503 + пустое тело | Сатурация / нет ответа — вердикта нет |
| 302 | Туннель на другую ноду (следовать) |

**Но текущий код НЕ потребляет это различие**: `probe()` читает только status,
тело не-2xx игнорирует → 403 `disable` и честное 2xx-«нет» дают один и тот же «нет»-голос.

## 5. Пункт 5 — verify кейсов из stability-отчёта

Флапающие 4 (filmix/rezka/rhsprem/videoseed) — **403 `disable` от online8 подтверждён
live** в этом окне. Механизм из `balancer-stability-card-report.md` (§2): в «плохих»
прогонах primary отвечают 503/медленно → ротация доходит до online8 (последний резерв)
→ 403 `disable` «закрывает» вердикт в unanimous-«нет» → hide, хотя контент на primary
есть (доказано: filmix 200 play/5, rezka 200 call/22, rhsprem 200 call/22 в том же окне).
Смягчения (OLD∩NEW гейт, confirmWithBackoff, HIDE_TTL_MS=60с) сокращают ущерб, но не
убирают корень: **оба сигнала могут пройти через одну и ту же ротацию до online8.**

Также подтверждён «класс 2» `balancer-002-report.md`: контент kinopub живёт на online8
(302-туннель с online3); сатурация легаси-ноды флапает и карточку kinopub, и OLD-навигацию.

## 6. Пункт 6 — использует ли E-Online online8

- **EoClient.skazHosts = [online3, online8]** — EO-клиент ходит на online8 для
  skaz-ссылок (kinopub-туннель; контент kinopub там реально живёт).
- Серверный checksearch EO (`lite/events`) считает вердикт на своей стороне. Show EO для
  filmix/rezka/rhsprem идёт **с primary-нод** (на online8 эти модули выключены), т.е. в
  EO-show для этих балансеров online8 **не участвует**. Это ровно та роль, которую
  Maniya тоже должна давать online8: «только те модули, что на ней реально живут».
- Расхождения нашего внешнего checksearch с EO-серверным (у нас geosaitebi 200, EO hide;
  у нас rezka 200, EO «Rezka» hide при EO «HDRezka ~ 4K» show) — известный
  fidelity-gap (`balancer-002-postdeploy-shadow-report.md` §6), к online8 отношения не имеет.

## 7. Пункт 7 — что НЕ делать

**403/503 от online8 НЕ считать автоматически «источник не работает».** Доказано:
в одном окне online8 → 403 `disable`, online3 → 200 play/call по тому же тайтлу.

## 8. Пункт 9 — таблица balancer | online3 | online8 | meaning | authoritative?

| балансер | online3 (это окно) | online8 (это окно) | meaning | authoritative? | EO (это окно) |
|---|---|---|---|---|---|
| filmix | 200 content (play) | 403 `disable` | нода не обслуживает (в реестре, выключен) | **НЕТ** | show (Filmix ~ 4K) |
| rezka | 200 content (call) | 403 `disable` | нода не обслуживает (в реестре, выключен) | **НЕТ** | hide «Rezka» / show «HDRezka ~ 4K» (два модуля) |
| rhsprem | 200 content (call) | 403 `disable` | нода не обслуживает (в реестре, выключен) | **НЕТ** | нет в EO этого окна |
| videoseed | 503 пусто | 403 `disable` | нода не обслуживает (НЕ в реестре) | **НЕТ** (o3 503 = транзиент) | hide (Videoseed) |
| kinopub | 302 → online8 → 200 | **200 content (play)**, иног. 503/16с | **реально живёт на online8** (туннель) | **ДА**, когда отвечает | hide (KinoPub) [в др. окне show] |
| alloha | 200 content (call) | 403 `disable` | нода не обслуживает (в реестре, выключен) | **НЕТ** | hide (Alloha) |
| kodik | 503 пусто | 503 пусто | не обслуживается нодами кластера (работает native-контуром) | — | нет в EO |
| kinoflix | 200 content (play) | 403 `disable` | НЕ в реестре ноды | **НЕТ** | нет в EO этого окна [в др. окне hide] |
| rutubemovie | 503 (8с) | 403 `disable` | нода не обслуживает (в реестре, выключен) | **НЕТ** (o3 503 = транзиент) | hide (Rutube) |
| geosaitebi | 200 content (link) | 403 `disable` | НЕ в реестре ноды | **НЕТ** | hide (Geosaitebi) |

## 9. Пункт 10 — рекомендация

Варианты (обсуждаются, **ни один не применён** — policy не трогалась):

- **(а) Оставить как есть.** 403-`disable` продолжает считаться «нет»-голосом; смягчение
  — OLD∩NEW гейт + backoff + HIDE_TTL 60с. Плюс: ноль изменений. Минус: флап 4 слагов
  сохраняется (источник может прятаться до 60 с), каждый «нет» гоняет дорогой
  confirmWithBackoff.
- **(б) Не считать 403 с телом `disable` от резервной ноды авторитетным «нет».** В
  `probe()`: для не-2xx с телом `disable`/`disabled` — «нода не обслуживает» (skip,
  НЕ `sawDefinitiveNo`), как accsdb-«учётка» уже трактуется особым образом (RULE-2).
  Тело не-2xx малое (≤ ~60 байт), чтение дешёвое. Убирает корень флапа (unanimous-«нет»
  возможен только от контентных нод). Затрагивает только `availability.js probe()`.
- **(в) Исключить online8 из пула availability вовсе.** Легаси-универсум; но kinopub
  живёт на online8 — проверка всё равно дойдёт до неё через 302-туннель (redirect
  follow), так что контент не теряется. Минус: теряется «последний резерв» при падении
  всех primary.
- **(г) (б) + оставить online8 в конце как чистый резерв** на случай падения primary.

**Рекомендация: (б) + (г).** Это минимальное изменение (только `availability.js`),
устраняющее именно доказанный корень (403 `disable` ≠ контент-нет), сохраняет online8
как последний резерв и не трогает playback-контур (там уже self-heal). Подтверждение
телом `disable` — query-independent и не зависит от окна кластера, в отличие от
503-флапов.

## 10. Ограничения

- Снимок одного окна (2026-08-14): кластер меняет вердикты между окнами (EO show менялся
  9→5; kinopub online8 503→200). Внутри окна выводы устойчивы (403 `disable` детерминирован).
- Пробы шли с VPS (ASN VPS). Другие ASN/geo могут видеть другой баланс нод.
- Ничего не менялось: online8 host-policy, predicates, `index.js`, TTL — без изменений.
- Временные скрипты на VPS удалены. Локальные scratch-скрипты (`scripts/online8-*.mjs`)
  удалены из рабочего дерева (никаких следов в git).
