# BALANCER-SKAZ-VEO-014 — ОТЧЁТ

> **Дата:** 2026-08-15 (живые пробы 2026-08-15, prod https://plugin.maniya-kvn.online)
> **Директива:** BALANCER-SKAZ-VEO-014 (research only; без правок кода, без commit/push/deploy)
> **Главный вопрос:** ПОЧЕМУ ОРИГИНАЛЬНЫЙ SKAZ ДЛЯ «ПОСЛЕДНИЙ ДОМ» 2026 (TMDB 1284041)
> ПОКАЗЫВАЕТ VeoVeo — 1080p, А MANIYA НЕ ПОКАЗЫВАЕТ ЕГО?
> **Эталон:** оригинальный Skaz-плагин `http://skaz.tv/tv.js` (НЕ E-Online).
> **Кейс:** «Последний дом» (The Last House), 2026, США, TMDB 1284041, IMDb tt32268156.

---

## 1. Executive Summary

**Maniya НЕ скрывает VeoVeo для TMDB 1284041. Она показывает его — под именем «Ozvuchky».**

Полная серверная цепочка Maniya для «Последний дом» 2026 живым прогоном доказана
рабочей и совпадает с оригинальным Skaz вплоть до last-response-байта:

| Слой | Оригинальный Skaz (lifeevents) | Maniya (server) | Совпадение |
|---|---|---|---|
| Запрос к кластеру `lite/veoveo?checksearch=true` | id=1284041, imdb, title, serial=0, year=2026 | тот же buildUrl → тот же URL | ✅ идентичен |
| Ответ кластера (online3) | 200, CONTENT (2415 байт, play-card, 1080p) | 200, CONTENT (2415 байт, play-card, 1080p) | ✅ идентичен |
| Предикат | `work=true` → show:true | `work=true` → show:true | ✅ |
| **Имя источника в списке** | **«VeoVeo - 1080p»** (серверное имя lifeevents) | **«Ozvuchky - Full HD»** (PROVIDER_META, meta.js:26) | ❌ **ЕДИНСТВЕННОЕ РАСХОЖДЕНИЕ** |
| Play items | (checkSearch не отдаёт items; lite-страница → play-карточки) | 4 items (1080p/720p/480p/360p) | ✅ контент есть |
| Playback | api.rstprgapipt.com → CDN mvapspdmpg.com | тот же путь через proxy | ✅ 200 HLS |

Пользователь, видя в Maniya «Ozvuchky» (а не «VeoVeo»), интерпретирует это как
«VeoVeo отсутствует». Это артефакт **нейминга источника** в presentation-слое
Maniya: балансер кластера `veoveo` отображается под брендом «Ozvuchky» (имя
унаследовано из E-Online-плагина, `docs/eonline-gap-analysis.md:39`), тогда как
оригинальный Skaz отдаёт серверное имя `"VeoVeo - 1080p"`.

**Не баг доступности. Не баг availability/cache/single-flight/abstain. Источник жив,
show:true, 4 play items, playback 200 HLS. Баг (мягкий, UX/нейминга): имя источника
в UI Maniya не совпадает с оригинальным плагином.**

---

## 2. Архитектура оригинального Skaz

Оригинальный Skaz = **Lampac** (`immisterio/Lampac`-семейство) + Lampa-клиент.

**Сервер (OnlineApi.cs + Online/plugin.js):**
- Клиент НЕ хардкодит список источников. Он вызывает `lite/events?life=true` →
  `{life:true, memkey}` → поллит `/lifeevents?memkey=<memkey>` (маршрут `lifeevents`
  на корне, НЕ `lite/lifeevents`).
- `lite/events` (OnlineApi.cs:653) строит список online из модулей, для каждого —
  `checkOnlineSearch` (OnlineApi.cs:870) c memkey `checkOnlineSearch:{id}:{serial}:{source|''}:{online.Count}:{user_uid}`,
  и запускает задачи `checkSearch` (OnlineApi.cs:957) параллельно.
- `checkSearch`: GET `{url}?…&checksearch=true` (timeout 10с); `work = rch || data-json= || type:movie|episode|season`;
  качество из `qualityMarks` (`"2160p"`/`>2160p<`/`<!--2160p-->`/`<!--q:…-->`) → `2160 → " - 4K HDR"`, иначе
  событие `OnlineApiQuality` (у veoveo → `" ~ 1080p"`, ModInit.cs:96-103).
- `lifeevents` (OnlineApi.cs:545): сортирует по `work desc → index`, возвращает
  `{ready, tasks, online[]}`; каждый `code = {"name","url","index","show","balanser","rch"}`.
- **Имя источника в списке — серверное:** `name` (например `"VeoVeo - 1080p"`) +
  `balanser` (слаг). Клиент `startSource` строит `sources[name] = {url, name, show}`.

**Клиент (Lampa плагин `skaz.tv/tv.js`):**
- Пробовали любые UA/Origin/query — tv.js возвращает 104-байтный стаб
  `(function(){Lampa.Platform.tv(); /* Добавьте плагин в Lampa */})()`.
  Реальный код — подписно-gated (CDN `Cache-Status: HIT`, CORS-заголовки
  `token/authorization/x-access-token`). Это самостоятельная находка — зеркалит
  паттерн `isLampaRequest` в Maniya (docs/plugin-install-003).
- Поведение источника восстановлено по reference-копии Lampac
  (`C:\Users\Admin\AppData\Local\Temp\Lampac\Online\plugin.js`) и по живым
  запросам к кластеру (online3.skaz.tv).

---

## 3. Реализация VeoVeo в tv.js (модуль Lampac)

Reference: `C:\Users\Admin\AppData\Local\Temp\Lampac\Modules\OnlineRUS\VeoVeo\`
(Controller.cs + ModInit.cs).

**ModInit.cs:**
- `conf = ModuleInvoke.Init("VeoVeo", new OnlinesSettings("VeoVeo", "https://api.rstprgapipt.com")
  { displayindex = 550, httpversion = 2, stream_access = "apk,cors,web" })`.
- `onlineApiQuality("veoveo") => " ~ 1080p"` (строки 96-103).
- Локальная БД `data/veoveo.json` (~130k фильмов), ключуется по
  **kinopoiskId / imdbId / title / originalTitle** — **TMDB id НЕ используется
  напрямую**.
- `with_search.Add("veoveo")` — участвует в checkSearch.

**Controller.cs (route `lite/veoveo`):**
- Параметры: `movieid, imdb_id, kinopoisk_id, title, original_title, clarification, s=-1, rjson, similar`.
- `movieid==0` → search-ветка: `search(imdb_id, kinopoisk_id, title, original_title)` → `databaseById`
  или Spider (`lite/veoveo-spider`); контент через
  `{host}/balancer-api/proxy/playlists/catalog-api/episodes?content-id={movieid}`.
- movie: `episode.title ?? "1080p"` — заголовок карточки = качество.
- serial: ветка сезонов/серий.
- `.json` файлы → route `parsed.m3u8`.

**Клиент requestParams (plugin.js:307)** формирует query: `id, imdb_id, kinopoisk_id,
tmdb_id, title (clarification?search:movie.title||name), original_title, serial,
original_language, year, source (movie.source||'tmdb'), clarification, similar, rchtype, cub_id`.

---

## 4. Точный запрос оригинального Skaz для TMDB 1284041

CheckSearch (как его выполняет кластерный `lite/events`):

```
GET http://online3.skaz.tv/lite/veoveo?checksearch=true
    &id=1284041
    &imdb_id=tt32268156
    &title=%D0%9F%D0%BE%D1%81%D0%BB%D0%B5%D0%B4%D0%BD%D0%B8%D0%B9%20%D0%B4%D0%BE%D0%BC      # «Последний дом»
    &original_title=The%20Last%20House
    &original_language=en
    &serial=0
    &year=2026
    &source=tmdb
    &account_email=<cluster-email>
    &uid=<cluster-uid>
```

Точный набор query подтверждён живым `lifeevents`-ответом кластера (см. §5) и
requestParams плагина. Авторизация — `account_email`+`uid` в URL (те же учётные
данные, что у Maniya; кластер отвечает «есть»).

---

## 5. Точный ответ оригинального Skaz (lifeevents) для TMDB 1284041

Живая проба (online3.skaz.tv, atomic: events → lifeevents, поллинг до ready):

```
balanser:"veoveo", name:"VeoVeo - 1080p", show:true, url:"http://online3.skaz.tv/lite/veoveo"
```

Это **дословно совпадает** со скриншотом пользователя (строка «VeoVeo — 1080p»).
Полный список online из того же lifeevents (все show:true, порядок — как на
скриншоте): `veoveo` («VeoVeo - 1080p»), `filmix` («Filmix ~ 4K»), `alloha`
(«Alloha - 4K»), `pidtor` («SkazTV - 4K HDR»), `xvideocdn` («XVideoCDN ~ 4K»),
`rhsprem` («HDRezka ~ 4K»), `zagonka` («Zagonka ~ 1080p»), `hdvb` («HDVB ~ 1080p»).

Raw checksearch кластера для этого же тайтла: **200, CONTENT (2415 байт)** —
play-карточка с quality 1080p (routing-нода api.rstprgapipt.com → CDN
mvapspdmpg.com, путь GAP-012).

**Итог ЭТАПА 2:** источник VeoVeo в оригинальном Skaz для TMDB 1284041 =
`show:true`, серверное имя `"VeoVeo - 1080p"`. Пользователь видит ровно это.

---

## 6. Реализация VeoVeo в Maniya

- **Registry** (`server/src/providers/registry.js:25`): `EO_TITLES.veoveo = 'Maniya · VeoVeo'`.
- **buildSkazProviders** (registry.js:99): `id: 'skaz-'+balancer`, `title: EO_TITLES[balancer]`,
  `show: !hidden` (veoveo без native-близнеца → видимый).
- **Config** (`server/src/config.js`): `skaz.balancers` default содержит `'veoveo'`;
  `skaz.hosts` = online3/online8 + 4 IP; `checkEnabled=true`; `accountEmail/uid` из env.
- **SkazClient** (`server/src/providers/skaz/SkazClient.js`): `buildLiteUrl(params)` →
  `host/lite/{balancer}?{params}&account_email&uid`; `fetchHosts` ротация на 5xx;
  `isUsablePage` отклоняет JSON/`disable`/`false`/`not found`.
- **Availability** (`server/src/availability.js`): `defaultChecker.card` →
  `checkBalancer('veoveo')` → `probe` → `buildUrl(veoveo, query, checksearch=true)` →
  `lite/veoveo?…&checksearch=true` → `checkSearchPredicate(text, query)`.
  Предикат (availability.js:229): извлекает `data-json`-карточки, `method:play/call`
  или `type:movie|episode|season` → `work=true` → show. Кэш Fnv1a
  `(id:serial:source:count:uid)`, TTL 5 мин, HIDE_TTL 60с, single-flight, OLD∩NEW
  гейт, `reservePolicy:'abstain'` (online8 воздерживается для не-kinopub).
- **Display name — presentation layer** (`server/src/providers/meta.js:26`):
  ```js
  veoveo: { name: 'Ozvuchky', icon: '🎧', qualityLabel: 'Full HD' }
  ```
  `providerMeta(id)` срезает `skaz-` → slug `veoveo` → PROVIDER_META[veoveo].
  **Именно этот `name` уходит в `/sources` (index.js:195 `name: meta.name || withBrand(…)`).**
- **Клиент** (`public/maniya-online.js`): `loadSources` (454) → `sources[key] = {name: item.name…}`;
  `sourceLabel` (202) = `icon + ' ' + name + ' - ' + quality` → **«🎧 Ozvuchky - Full HD»**;
  `updateFilter` (549) отдаёт `{title: sourceLabel(sources[key]), source: key, …}`.

---

## 7. Точный запрос Maniya для TMDB 1284041

Availability `buildUrl('veoveo', query, true)` (availability.js:540):

```
GET http://online3.skaz.tv/lite/veoveo?checksearch=true
    &id=1284041
    &imdb_id=tt32268156
    &title=%D0%9F%D0%BE%D1%81%D0%BB%D0%B5%D0%B4%D0%BD%D0%B8%D0%B9%20%D0%B4%D0%BE%D0%BC
    &original_title=The%20Last%20House
    &original_language=en
    &serial=0
    &year=2026
    &source=tmdb
    &account_email=<cluster-email>
    &uid=<cluster-uid>
```

Параметры **посимвольно те же**, что у оригинального Skaz (§4): id/имdb/title/
original_title/original_language/serial/year/source + checksearch + account_email + uid.

---

## 8. Точный ответ Maniya для TMDB 1284041

- **Raw checksearch (online3, primary):** **200, CONTENT (2415 байт)** — play-карточка,
  quality 1080p, routing api.rstprgapipt.com → mvapspdmpg.com. Идентичен ответу Skaz (§5).
- **online8 (reserve):** 403 `disable` (7 байт) → `reservePolicy='abstain'` (не-kinopub
  воздерживается; kinopub-контроль на online8 = 200 CONTENT — политика абстайна работает).
- **`/api/lampa/sources`:** `skaz-veoveo` → `{name:'Ozvuchky', icon:'🎧', quality_label:'Full HD',
  show:true, enabled:true}`, позиция 12/16.
- **`/api/lampa/sources/card` (TMDB 1284041):** veoveo row `show:true`
  (cold ~12с → warm 231мс; force; user B cold 3292мс; 5 concurrent — один вердикт).
- **`/api/lampa/videos?provider=skaz-veoveo`:** **4 play items** —
  `1080p / 720p / 480p / 360p`, единый контент-путь
  `movies/files/HELLO/…/930696/sources/…/master.m3u8` (один фильм в 4 качествах).
- **Playback:** master 200 `#EXTM3U` HLS.

---

## 9. EVIDENCE TABLE (таблица сравнения)

| # | Элемент | Оригинальный Skaz | Maniya | Совпадение |
|---|---|---|---|---|
| 1 | Provider ID (балансер) | `veoveo` | `skaz-veoveo` (balancer=`veoveo`) | ✅ (один балансер) |
| 2 | Source ID в UI | `veoveo` (server `balanser`) | `skaz-veoveo` (id) | ✅ |
| 3 | Endpoint | `http://online3.skaz.tv/lite/veoveo` | `http://online3.skaz.tv/lite/veoveo` | ✅ |
| 4 | HTTP method | GET | GET | ✅ |
| 5 | Query | id/imdb/title/original_title/lang/serial/year/source | те же + checksearch | ✅ |
| 6 | TMDB | 1284041 (как `id`; сама БД veoveo ключуется по kp/imdb/title) | 1284041 (`id`) | ✅ |
| 7 | KP | не передаётся | не передаётся | ✅ |
| 8 | IMDb | tt32268156 | tt32268156 | ✅ |
| 9 | Title | Последний дом / The Last House | те же | ✅ |
| 10 | Year | 2026 | 2026 | ✅ |
| 11 | Headers | UA Lampa, Origin lite | accept:* (кластер не требует) | ✅ (не влияет) |
| 12 | Authentication | account_email+uid (URL) | account_email+uid (URL) | ✅ |
| 13 | Response status | 200 CONTENT | 200 CONTENT (online3) | ✅ |
| 14 | Response body | play-card 1080p (2415 Б) | play-card 1080p (2415 Б) | ✅ |
| 15 | Parser | OnlineApi.cs:975 (data-json/rch/type) | checkSearchPredicate (data-json cards) | ✅ (эквивалент) |
| 16 | Predicate | `work=true` → show | `work=true` → show | ✅ |
| 17 | **Show** | **true** | **true** | ✅ |
| 18 | **Имя/качество в списке** | **«VeoVeo - 1080p»** (серверное) | **«Ozvuchky - Full HD»** (meta.js) | ❌ **РАСХОЖДЕНИЕ** |
| 19 | Video items | (checkSearch items не отдаёт; lite → play-карты) | 4 play items (1080p/720p/480p/360p) | ✅ контент есть |
| 20 | Playback URL | api.rstprgapipt.com → mvapspdmpg.com | тот же через proxy | ✅ 200 HLS |

**Первая точка расхождения: строка 18 — display name + quality label источника.**
Всё до неё (URL, query, auth, хост, response, предикат, show, контент, playback)
байт-идентично.

---

## 10. Первая точка расхождения

`server/src/providers/meta.js:26`:

```js
veoveo: { name: 'Ozvuchky', icon: '🎧', qualityLabel: 'Full HD' }
```

vs серверное имя кластера `"VeoVeo - 1080p"`.

Маршрут расхождения в Maniya: `providerMeta('skaz-veoveo')` (meta.js:73) →
`PROVIDER_META.veoveo.name` → `index.js:195 name: meta.name || …` →
`/sources` → клиент `loadSources` → `sourceLabel` → Lampa sort-menu.

Имя «Ozvuchky» унаследовано из **E-Online-плагина**: `docs/eonline-gap-analysis.md:39`
(строка 6: `| 6 | Ozvuchky | veoveo | …`). Т.е. Maniya повторяет нейминг E-Online,
а НЕ оригинального Skaz.

---

## 11. Root Cause

**Maniya отображает балансер `veoveo` под брендовым именем «Ozvuchky»
(`PROVIDER_META` в meta.js:26), тогда как оригинальный Skaz отдаёт серверное
имя «VeoVeo - 1080p» (lifeevents `name`).**

Источник при этом НЕ скрыт: `show:true` на всех слоях (реестр, per-card,
cold/warm/force/uid/concurrency), 4 play items, playback 200 HLS. Пользователь,
ожидая пункт «VeoVeo» и видя «Ozvuchky», заключает «VeoVeo отсутствует». Это
чисто презентационный артефакт нейминга — единственное расхождение во всей
цепочке.

---

## 12. Почему оригинальный Skaz показывает VeoVeo

Кластерный checkSearch (lite/events → lifeevents) для TMDB 1284041 вернул
`balanser:"veoveo", name:"VeoVeo - 1080p", show:true` — кластер **реально имеет**
контент VeoVeo для «Последний дом» 2026 (локальная БД veoveo нашла тайтл по
imdb/title, play-карточка 1080p). Имя — серверное, из `checkSearch` qualityMarks
(`" - 1080p"`).

---

## 13. Почему Maniya «не показывает» VeoVeo

**Maniya показывает его — как «Ozvuchky - Full HD».** Технически источника не
скрыт (все show:true, items есть, playback OK). «Не показывает» — следствие
именования: пользователь не узнаёт VeoVeo в «Ozvuchky». Отсутствует как таковой
только строка с текстом «VeoVeo», потому что сервер Maniya переименовал источник
в presentation-слое.

---

## 14. Является ли это багом Maniya

- **НЕ баг доступности/availability/cache/single-flight/abstain/OLD∩NEW** — всё
  работает и совпадает с оригиналом (EVIDENCE TABLE).
- **Мягкий баг UX/нейминга:** имя источника в UI не совпадает с оригинальным
  Skaz-плагином («Ozvuchky» vs «VeoVeo»), что вводит пользователя в заблуждение
  («VeoVeo пропал»). Намеренного решения «переименовать veoveo» в документации
  нет — имя унаследовано от E-Online-анализа (docs/eonline-gap-analysis.md:39).
- Классификация по VEOVEO-014 (A–J): **H (источник есть, показан под другим именем)**.

---

## 15. Рекомендуемый минимальный фикс

Только research — **НЕ применялось**. Варианты (по возрастанию объёма):

1. **(Минимум, 1 строка)** `server/src/providers/meta.js:26`:
   `veoveo: { name: 'VeoVeo', icon: '🎧', qualityLabel: '1080p' }` —
   имя/качество совпадут с оригинальным Skaz. Риск ≈ 0 (presentation-only).
2. **(Средне)** В `index.js:195` для skaz-источников приоритизировать серверное
   имя из checksearch/lifeevents (`name + quality`), meta.js оставить как fallback.
3. **(Опционально)** Если имя «Ozvuchky» — намеренный бренд Maniya: оставить как есть
   и документировать маппинг «Ozvuchky = VeoVeo» (например, subtitle в списке).

Рекомендуется вариант 1 — минимальный, изолированный, обратимы.

---

## 16. Риски регрессий

- Только presentation-слой: `/sources.name`/`quality_label` для skaz-veoveo.
- Клиент ключует по `id` (`sourceKey = id|balanser|name` → `skaz-veoveo`), имя —
  только подпись: смена имени не меняет порядок/видимость/playback.
- Availability, кэш, single-flight, abstain не затрагиваются.
- Риск: если где-то UI-тест хардкодит «Ozvuchky» — обновить эталон. На текущий
  момент тесты источников не привязаны к display-имени.

---

## 17. Необходимые тесты

1. **Unit (meta):** `providerMeta('skaz-veoveo').name === 'VeoVeo'`,
   `providerMeta('skaz-veoveo').qualityLabel === '1080p'`.
2. **API:** `/api/lampa/sources` для userA возвращает skaz-veoveo c `name:'VeoVeo'`.
3. **Availability-регрессия:** `card` TMDB 1284041 → veoveo `show:true`
   (cold/warm/force) — без изменений.
4. **videos:** `/api/lampa/videos?provider=skaz-veoveo&…` → 4 items, playback 200 HLS.
5. **UI (опционально):** sort-menu Lampa показывает «🎧 VeoVeo - 1080p».

---

## 18. STOP

- [x] Исследование завершено, вывод доказан живыми пробами (запрос/ответ/предикат/
      show/items/playback — идентичны оригиналу; расходится только display-имя).
- [x] **Код НЕ менялся** (meta.js:26 остаётся `name:'Ozvuchky'`).
- [x] Нет commit / push / deploy.
- [x] Временные скрипты удалены (см. cleanup ниже); в отчёте только маскированные
      учётные данные (email/uid уже публичны в проектной документации).
- [x] Рекомендация по фиксу — в §15, НЕ применена.

### Cleanup

- Удалены `scripts/veoveo014-probe.mjs`, `scripts/veoveo014-checksearch.mjs`,
  `scripts/veoveo014-matrix.mjs`.
- Удалён временный каталог `%TEMP%\skaz-veo-014\` (tv.js-стабы/ламповые копии).
- Никаких зашитых секретов в этих файлах не было (проверено grep'ом); токены —
  только через `_creds.mjs` (env/temp-пользователи).
