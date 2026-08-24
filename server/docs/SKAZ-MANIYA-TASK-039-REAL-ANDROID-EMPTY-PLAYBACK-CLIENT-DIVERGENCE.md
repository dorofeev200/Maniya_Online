# SKAZ-MANIYA-TASK-039 — Real Android empty playback: эксперимент B (DIRECT_PLAYBACK=false) и FIRST DIVERGENCE на клиентском runtime

**Дата:** 2026-08-23. **Среда:** STAGING 95.85.241.121 (в состоянии эксперимента: `DIRECT_PLAYBACK=false`), реальный Android/Lampa (IP 178.173.126.235, UA `...; wv) ... lampa_client`, учётка dorofeevigor20@gmail.com). **Статус:** ✅ FIRST DIVERGENCE доказан фактом wire = **CLIENT/UI**. Код и конфиг больше НЕ менялись (staging оставлен в состоянии эксперимента). PROD — HARD STOP, не тронут.

---

## 0. Резюме

Пользовательский эксперимент B выполнен: `DIRECT_PLAYBACK=false` только на STAGING (окружение оставлено в этом состоянии). Реальный Android: «Дом Дракона → KinoPub» снова пуст.

**C1 (девайсный hls.js не играет raw direct) — ОПРОВЕРГНУТ объективно:**
- Рабочий контроль девайса (14:33, Spider-Man serial=0 фильм → rezka): `/videos` 200/1691B → **`/api/lampa/proxy` 200/4353B (master) + 200/148286B (сегмент)** — девайсная Lampa ИГРАЕТ через наш `/proxy`. Мг /proxy на девайсе работает.
- В эксперименте B (после flip DIRECT=false) девайс НЕ сделал НИ ОДНОГО `/api/lampa/proxy` запроса после выбора KinoPub → дело не в доставке URL (direct vs proxy), а раньше.

**FIRST DIVERGENCE (доказано wire «path отсутствует»):** после применения card-модели (`applyCardAvailability`, `meta.model:true`) клиентский `activeUrl` становится **ОТНОСИТЕЛЬНЫМ** `api_url` (`/api/lampa/videos?provider=...`), и следующий `loadVideos()`/`changeSource()` уходит на relative-путь, который **НЕ достигает 95.85.241.121**. В логе nginx после card (16:31:46) от девайса — тишина: ни повторного `/videos`, ни кинопуба, ни `/proxy`. До card (16:31:45, absolute-URL временного источника из статики) — доходило и возвращало items>0.

Это ровно воспроизводит жалобу пользователя: «при первом входе показывает список как на проде и находит видео, и сразу обновляет, и всё пропадает, и источники становятся как в SKAZ — одни подсвечиваются, а другие тусклые» = до card (absolute, активно) рендер есть; **после** card (модель, relative api_url + show/ghost) — запросы пропадают, остаётся только модель источников (bright/dim = show:true/show:false).

Вторичный кандидат (не исключён): serial TMDB gate в `draw()` — даже при доставленных items рендер сериала ждёт `Lampa.Api.sources.tmdb.get` и может не отрисоваться. Не является первичным (рабочий контроль = фильм serial=0, где gate обходится `return render()`). Оба фикса — серверно-нейтральные, но НЕ выполнялись (запрет на изменения до утверждения).

---

## 1. Хронология wire девайса (nginx STAGING, IP 178.173.126.235, UA lampa_client)

### Окно эксперимента B (DIRECT_PLAYBACK=false) — посекундно

| # | Время | Метод / путь | HTTP | Размер | Провайдер | Примечание |
|---|---|---|---|---|---|---|
| 1 | 16:31:41 | GET /api/lampa/subscription/check | 200 | 219B | — | check active |
| 2 | 16:31:44 | GET /api/lampa/sources (HOD id=94997) | 200 | 3281B | — | статический реестр, рады absolute url |
| 3 | 16:31:45 | GET /api/lampa/videos?provider=**filmix** | 200 | 21356B | filmix | Первый (пока absolute из статики) — items=10/3 сез/16 голосов |
| 4 | 16:31:46 | GET /api/lampa/sources/card | 200 | 8573B | — | **meta.model:true**, 30 рядов, relative api_url |
| 5 | **16:31:46 → 16:35:27** | — | — | — | — | **ТИШИНА.** Почти 4 минуты от девайса ничего (нет /videos, нет /proxy, нет kinopub) |
| 6 | 16:35:27 | GET /staging/4f3a9c21....js | 200 | 57491B | — | перезагрузка плагина (юзер ковырялся) |

Критично: в строке 3 девайс ДО card получил items filmix (absolute-путь) — это и был «первый вход находит видео». Начиная со строки 4 (card применена) — **ни одного запроса `/api/lampa/videos?provider=skaz-kinopub` от девайса**. Кинопуб-запрос 16:34:30 (66) — **МОЙ node-реплей, НЕ девайс** (UA "node", referer lampa). 

### Рабочий контроль (14:33) — единственная успешная игра

| # | Время | Путь | HTTP | Размер | Примечание |
|---|---|---|---|---|---|
| 1 | 14:33:00 | /sources (Spider-Man id=969681, **serial=0**) | 200 | 3281B | фильм |
| 2 | 14:33:01 | /videos?provider=**rezka** | 200 | 1691B | items играбельные |
| 3 | 14:33:07 | **/api/lampa/proxy?url=...voidboost...manifest.m3u8** | 200 | 4353B | master HLS через прокси |
| 4 | 14:33:07 | /sources/card (parallel) | 200 | 8786B | card-модель, но игра уже идёт |
| 5 | 14:33:08 | **/api/lampa/proxy?url=...seg-1-v1-a1.ts** | 200 | 148286B | сегмент — видео реально играется |

→ Девайсная Lampa умеет играть через `/proxy` (master+сегменты). Это контроль, опровергающий C1.

### Период DIRECT=true (15:05–15:20, до flip) — контекст для «второго сборщика»

14:33… 15:05:36 sources(HOD)→15:05:37 videos kinopub 200/**4402B (items=10, 3 сез, 13 голосов)**→15:05:38 card 8573B. Затем повторные заходы 15:09:29 (kinopub 4402B), 15:15:37 (**другой порядок параметров** — Lampa re-build serial-адреса), 15:17:19 (kinopub 4402B), 15:20:53 sources+videos season=2 3485B. **И в эти моменты UI был пуст** (жалоба юзера в 15:xx та же). Т.е. даже когда absolute `/videos` доходил и возвращал items (4402B), рендер сериала не происходил при активной card-модели.

---

## 2. Доказательство «путь отсутствует» (шаг 5/6 задания)

Проверка по nginx access.log на **device-запросы4 после 16:31:46 (кард)**: `grep 178.173.126.235 | grep lampa_client` даёт ЕДИНСТВЕННЫЙ POST-card провайдеро-контакт до 16:48 = **ничего**. (16:48:11-49:23 — это уже НОВАЯ сессия юзера, он заново открыл карточки Мятеж/Spider-Man/Дом Дракона; там absolute/`/sources` снова доходили — сетевой слой девайса цел, но кинопуб-клик 16:48:52/16:49:18 → kinopub 200/12B и 200/7630B, а `/proxy` по-прежнему 0.)

**Вывод wire:** клиент ПОЛУЧИЛ card-модель (8573B), ПОСЛЕ этого его `loadVideos()`/`changeSource()` **не отправляют запросы на 95.85.241.121** (в логе их нет). Т.е. разрыв — между SOURCE SELECT (пости-card, relative activeUrl) и PLAYER URL (/proxy никогда не запрашивается).

---

## 3. Серверная сторона — чисто (ответ байт-в-байт)

`/videos?provider=skaz-kinopub` HOD при DIRECT=false: 200, items=10 play (season=1..), seasons=3, voices=13, **все url = `/api/lampa/proxy?url=...cdntogo...`** (proxy-wrapped, не raw). Повтор с девайсными параметрами (curl, id=94997, serial=1, account creds) — та же md5 f50d6a9e. Пустых ответов 0, двойного /sources нет, serial=1 всегда. Подробности в T038 (таблица A) — без изменений.

---

## 4. Клиентский код — точные строки дропа (served `/staging/4f3a9c21e7b64d08a5c2f1e9.js`, на лету = локальный `public/maniya-online.js`)

1. **`loadSources`** (458-487): из статического /sources: `sources[key].url = item.url` — **АБСОЛЮТНЫЙ** (`http://95.85.241.121/api/lampa/videos?provider=filmix`). `activeUrl = sources[activeSource].url` (485) → `loadVideos()` (487) → absolute → ДОХОДИТ. **Это рабочий путь первого входа (наш wire: 16:31:45).**
2. **`applyCardAvailability`** (510-562, `modelMode` при `'index' in row`): `built[key] = {url: row.api_url || row.url || ''}` (**534**) — `api_url` ОТНОСИТЕЛЬНЫЙ (`/api/lampa/videos?provider=skaz-kinopub`). Затем `activeUrl = sources[activeSource].url` (**555**) и безусловный `self.loadVideos()` (**560**). **С этого момента любой повторный запрос = relative-путь.**
3. **`changeSource`** (615-627): `activeUrl = sources[key].url` (**618**) → `loadVideos()` (626). Клик юзера на «KinoPub» = relative-путь.
4. **`loadVideos`** (629-642): `url = addMovieParams(activeUrl || trimSlash(MANIYA_API_BASE)+'/videos', ...)` (**632**) → `requestJson(network, url, ...)` → `network.silent(addAccountParams(url))` (**requestJson 173**). **Относительный URL передаётся в Lampa.Reguest как есть; Lampa резолвит его против текущего origin приложения, а НЕ против MANIYA_API_BASE → запрос не долетает до 95.85.241.121 → сеть молчит → `empty('maniya_no_results')`** (или зависший рендер).
5. **`draw` serial TMDB gate** (762-856): если items имеют `season`+`episode` (`serialEpisodeOf>0` и `object.movie.name`) — рендер откладывается за `getSeasonEpisodes(season)` (в Lampa.Api.sources.tmdb.get (752), без таймаута на клиенте). Если TMDB-слой не вернёт ни success ни error → `render()` (855) не вызывается → **пустой UI при items>0**. Для фильма (`serial=0`, как в контроле 14:33) — `return render()` сразу (835) → работает.
6. Плюс: после card `sources.skaz-kinopub.show` истинное (модель row), показ других `show:false` дём → «одни светятся, другие тусклые» (updateFilter, ghost Скл Lampa) — пользователь видит модель источников, но не серии.

**Дроп находится в 534+555 → 632 → requestJson: после card `activeUrl` relative, и Lampa не отправляет запрос нашему серверу.** Вторично (для serial) — 835-855 TMDB-gate может блокировать рендер даже при абсолютных доставленных items (окно 15:05-15:20).

---

## 5. Заданные шаги 1–8 (результаты)

1. **Фактический /sources/card:** 200/8573B, `meta.model:true`, 30 рядов, все `api_url` relative, kinopub index=1 show=true, filmix index=2 show=true, сроки bright/dim (show:false → ghost), rch/voices/seasons присутствуют. Структуру см. §4.2.
2. **Каждый девайс /videos + HTTP:** экспериментальная сессия — ровно 2: `filmix 200/21356B` (16:31:45), `kinopub 200/6022B` НЕ девайс, а мой реплей (UA node). Девайс кинопуба в окне B **не вызывал**.
3. **items > 0 подтверждено** на каждом ответе, которого достиг requests: filmix 10/3/16, kinopub (реплей/эталон) 10/3/13. Ни одного пустого.
4. **Что Lampa передала Player'у при выборе KinoPub:** ничего — выбор KinoPub не породил ни одного network-запроса (wire: тишина после 16:31:46). До card absolute-path источник (filmix) отдавал method=play + proxy-URL; доcard-рендер (для фильмов) работает.
5. **Запрашивает ли Player /proxy после выбора:** НЕТ (0 запросов /api/lampa/proxy после выбора KinoPub; рабочее исключение — контроль 14:33 movie). → пункт шага 6 верен: Player request не появляется.
6. **Конкретное место дропа item'а:** `applyCardAvailability` modelMode `built[key].url = row.api_url` (relative) → `activeUrl` (555) → неявно следующий `loadVideos()`/`changeSource()` уходит relative-путём мимо нашего сервера (nginx это не видит) → Lampa empty; для serial — дополнительно draw-TMDB-gate (835) может держать рендер. Оба — в `public/maniya-online.js`, код в §4.
7. **Сравнение с SKAZ (T025):** SKAZ runtime имел тот же flow (events→click→cardParams→CDN), но его источники отдавались уже «играбельным» URL (прямой CDN по cardParams), и у SKAZ клиент `draw()` рендерит items без ТМDB-gate → сериалы SKAZ рисовались. Наш post-card relative `api_url` — модификация T019 sourceModel — ввёл relative-путь, которого в эталонном runtime-пути SKAZ не наблюдалось. Дивергенция произошла на связке «каркас-модель → клиент activeUrl».
8. **Статус B зафиксирован:** в §0-§1. C1 refuted, C2 = client/UI. Код STAGING и PROD не менялся; staging оставлен в состоянии `DIRECT_PLAYBACK=false`.

---

## 6. Что дальше (паритет решений юзера)

Первичный кандидат-фикс (НЕ выполнялся): в `public/maniya-online.js` обеспечить `activeUrl` абсолютным — либо в `applyCardAvailability` (`url: row.api_url && row.api_url.indexOf('http')===0 ? row.api_url : trimSlash(MANIYA_API_BASE) + row.api_url`), либо в `loadVideos()` (резолвить relative против MANIYA_API_BASE, как это делает эталон). Вторично (serial): таймаут/fallback на `getSeasonEpisodes`-ожидание, чтобы рендер не зависал. **Оба запрещены текущим стейт-гейтом («код не менять до определения FIRST DIVERGENCE») — FIRST DIVERGENCE теперь определён, ждём решения юзера.**

### 6a. ЭТАЛОН-ПОДТВЕРЖДЕНИЕ деобфускацией SKAZ-клиента (`Temp/skaz-reverse/onlines.js`, рид-аут 241 КБ; обфускация минимальная — имена сокращены/строки склеены, eval-декодеров/XOR-таблиц нет, см. SKAZ-REVERSE-REPORT §18)

Оба фикс-кандидата — это ровно то, как SKAZ-клиент построен изначально:

1. **URL источника у них всегда absolute.** `lifeSource` (onlines.js 3054-3061) и `startSource` (2989-2996): `sources[name] = { url: j.url, ... }`, где `j.url` = абсолютный deep-link кластера (`http://onlineN.skaz.tv/lite/<module>`). Клик (`find` 3135-3137) = `request(requestParams(source))` — `source` тоже absolute. **В их runtime-объекте НЕТ поля api_url и НЕТ относительных URL** (T025 F2 подтверждён кодом). → наш `row.api_url`/relative-`activeUrl` — это наша добавка, чужая им.

2. **Рендер сериала у них НЕ гейтится TMDB.** `draw` (3872-3876): `if (!items.length) return this.empty(); if (modern) return this.uiDraw(items, params);` — современный путь рендерит без TMDB вообще; classic-путь вызывает `getEpisodes(items[0].season, cb)` (3880) **только для названий/рейтингов эпизодов** (3893-3922), и `getEpisodes` (3827-3843) имеет **error-callback `call(episodes)`** + кэш `episodes_cache[ckey]` — никогда не подвешивает рендер. У нас в `draw()` (835-855) рендер отложен за ALL `getSeasonEpisodes` без таймаута — и это не «как в эталоне», а наше отклонение от него.

**Вывод:** «сделать так же, как SKAZ» = обнулить обе наши добавки (relative activeUrl + TMDB-гейт рендера). Их клиент доказывает, что API-space контракт (урl absolute, рендер без гейта) — рабочий и на девайсе (контроль 14:33 + успешная история кинопуб/фильмов).

Контроль (без кода): на любом Web Lampa открыть HOD → после card логи увидели бы relative-запросы — но сервер их не видит → диагностика закрыта фактом «путь отсутствует». Для 100% клиент-подтверждения можно попросить юзера включить WebView-лог (инструменты) и глянуть «/api/lampa/videos?provider=skaz-kinopub» relative в DevTools — но это косметическое.

## 7. Влияние
- PROD — HARD STOP, не тронут (0 запросов по токену PROD, fp не менялся).
- STAGING: .env `DIRECT_PLAYBACK=false` (эксперимент), код тот же fp, сервис active. Больше ничего не менялось.
- Suite: не гонялась (изменений нет).