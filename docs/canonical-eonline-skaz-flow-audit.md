# CANONICAL E-ONLINE → SKAZ → LAMPA FLOW — финальный архитектурный аудит

**Сессия:** 2026-08-16 · **Тип:** READ-ONLY (код/тесты не менялись, commit/push/deploy не делались)
**Отчёт:** `docs/canonical-eonline-skaz-flow-audit.md`
**Связанные:** [[maniya-balancer-semantics-005-w1-impl]] (W1), [[maniya-balancer-semantics-005]] (аудит), [[maniya-balancer-post-w1]] (remaining), [[maniya-arch-audit-001]], [[maniya-stability-004-orphan]], [[maniya-online8-abstain-shadow]], [[maniya-gap012-veoveo]], [[maniya-balancer-skaz-veo-015]], [[maniya-gap005-kinopub-fn]]

---

## §0. Предпосылки и метод

### 0.1 Архитектурное ограничение (обязательное для чтения)
Maniya Online **полностью независима** от E-Online/Lampac в runtime. E-Online/Lampac используется
ТОЛЬКО как:
- reference implementation (эталон кода канонических решений);
- источник доказанных семантик (checkSearch, life events, ghost, rch);
- oracle для сравнительных тестов (live-сравнение observable-контракта).

**Запрещено:** Maniya→E-Online→Skaz; Maniya→E-Online-API→список провайдеров; Maniya→E-Online
account; Maniya→E-Online playback. Диаграмма:

```
SKAZ (upstream) ──REST──▶ MANIYA (registry/identity/clusters/rotation/availability/parser/
                          videos/playback) ──▶ LAMPA (client)
                                  ▲
        E-ONLINE/LAMPAC ──────────┘  (reference/oracle ТОЛЬКО, вне runtime-графа)
```

Сравнивается **observable-контракт** (INPUT → SOURCE VISIBILITY → SOURCE IDENTITY →
AVAILABLE/UNAVAILABLE → VIDEO ITEMS → PLAYBACK), а НЕ внутренняя реализация.

**Критерий приёмки:** если E-Online завтра полностью исчезнет, Maniya обязана продолжить работать;
потеряется только reference/oracle для сравнения.

### 0.2 Доказательства независимости (по коду)
| Утверждение | Доказательство |
|---|---|
| EoProvider/EoClient в дереве — только для сравнения | `registry.js:97-98`: «E-Online (EoProvider/EoClient) оставлен в дереве для live-сравнения, см. scripts/e2e-skaz-vs-eo.mjs (доказано: клиенты байт-в-байт идентичны)»; в `nativeProviders`/`buildSkazProviders()` их НЕТ — они не регистрируются как источники |
| Maniya ходит в кластер напрямую | `SkazClient.js:1-49`: «работает чистым REST GET… авторизация = account_email+uid в URL», hosts = SKAZ_HOSTS; `config.js:219` |
| EO_* — только фолбэк-переменные | `config.js:217-237`: `SKAZ_HOSTS`/`SKAZ_BALANCERS`/`SKAZ_ACCOUNT_EMAIL`/`SKAZ_UID` — primary, `EO_*` — fallback |
| Канон E-Online — reference | `config.js:226`: `checkTimeoutMs 10с = паритет с E-Online (OnlineApi.cs checkSearch timeoutSeconds:10)` |
| Никакого E-Online-аккаунта | uid/email — СВОИ creds кластера (`dorofe…@gmail.com`/`7974…`), не чужие |

### 0.3 Прошлые аудиты = PROVEN INPUT (не пере-прогонялись)
BALANCER-ARCHITECTURE-AUDIT-001, STABILITY-004, BALANCER-SEMANTICS-005, W1 (impl), post-W1
(remaining + 005-C), BALANCER-ONLINE8-001/002, GAP-002/005, VEO-015, GAP-012. Если новый аудит
противоречит прошлому выводу — пишем отдельно `PREVIOUS CONCLUSION → NEW EVIDENCE → CONFLICT →
RESOLUTION`, никогда не переписываем молча.

### 0.4 Метод и источники
1. **Канон E-Online/Lampac:** полное чтение `OnlineApi.cs` (1056 строк) + `plugin.js` + `Http.cs`
   (`BaseGetReaderAsync` 660-748) + `OnlineModuleEntry.cs` + `BaseController.cs` (суб-агент, полный отчёт).
2. **Кластер skaz (живой):** `lite/events` (реестр 32 модулей), `lite/withsearch` (34 слага),
   `checksearch=true` по 15 тайтлам × 14 балансеров (parity-probe), реальные карточки с real-params.
3. **Maniya (код + live):** `registry.js`, `config.js`, `meta.js`, `availability.js` (probe/confirm/
   computeCard/OLD∩NEW/pinMap), `SkazClient.js` (getLite/_scanLite), `SkazProvider.js`
   (collectMovieCards/videos/resolveVideo), `store.js` (withPinnedHost), `index.js` (роуты), `maniya-online.js` (клиент),
   live-матрица `matrix-api-result-r2.json` (11 тайтлов × 16 источников, 2026-08-16 07:03).
4. **Gap-анализ:** `docs/eonline-gap-analysis.md` (33 источника, статусы).

> ⚠ Файлы `E-ONLINE-REPORT.md`, `E-ONLINE-LIVE.md`, `E-ONLINE-INTEGRATION.md`, `SKAZ-REPORT-12.md`,
> `eonline-deob3.js` на диске ОТСУТСТВУЮТ (удалены из temp). Ссылки на них заменены на: gap-analysis
> (сохранил карту 33 слагов), prior-аудиты в памяти, живые пробы (этот отчёт). Где был только
> пре-суммари-факт без живого подтверждения — помечено «(из gap-analysis, не пере-проверено)».

---

## §1. Канонический pipeline: Lampa → E-Online → Skaz (и Maniya-зеркало)

### 1.1 E-Online-канон (эталонный порядок вызовов)

| Шаг | Endpoint | Метод/Параметры | Ответ | Вердикт/кэш | Куда ведёт |
|---|---|---|---|---|---|
| 1. Lampa открыл карточку | `lite/events` `life=true` | GET; `id, imdb_id, kinopoisk_id, tmdb_id, title, original_title, original_language, year, source, serial, account_email, uid` | `{life:true, memkey}` | memkey = FNV-1a(`checkOnlineSearch:`+id+serial+source+online.Count+user_uid); links[] (null) кэш 5 мин | клиент поллит lifeevents |
| 2. Poll | `lifeevents?memkey=…` | GET; только memkey | `{ready, tasks, online[]}` | ready = все checkSearch завершились; tasks = links.Count; online[] — сырые JSON `{name,url,index,show,balanser,rch}` | show:true → список; show:false → ghost |
| 3. Выбор источника | открыть `online[i].url` | GET `lite/<balancer>?title=…&clarification=1` | HTML `data-json` карточки (play/call/link, voices, seasons) | страница балансера | список items/фильтров |
| 4. Play | call-item → резолв | GET `lite/<balancer>/video` или прямой `movie.m3u8?…&play=true` (Origin) | манифест/JSON `{method:play,url,quality,subtitles}` | HLS/MP4 | плеер Lampa |

**Ключевые факты канона (доказаны OnlineApi.cs):**
- `lite/events` без карточки (или checkOnlineSearch выключен) = **статический реестр** `[{name,url,balanser}]` (ветка A, строки 922-950) — без show/index/rch. Живая проба 2026-08-16 подтвердила: 32 модуля.
- `lite/events` с карточкой + checkOnlineSearch = **ветка B** (строки 870-919): параллельные checkSearch по ВСЕМ модулям, ответ — массив ВСЕХ источников с `show:true/false` (скрывает клиент), сортировка `work desc, index asc`.
- `checkSearch` (строки 957-1053): `work = rch || res.Contains("data-json=") || "type":"movie"|"episode"|"season"`. Таймаут **10 секунд** (`timeoutSeconds:10`).
- **Главный факт:** `GetSpan` НЕ бросает на 503/timeout/403/2xx-empty — `spanAction` не вызывается → `work=false` → `links[indexList]` присваивается БЕЗУСЛОВНО (строка 1047) с `"show":false` → **источник ОСТАЁТСЯ в списке как ghost**. Omitted (выпадает из списка) — ТОЛЬКО при network-исключении (на практике недостижимо: `Http.cs` ловит внутри и возвращает `(false, response)`).
- `ready:false, tasks:N` — нормальный промежуточный статус live-поллинга (проверки идут), НЕ ошибка. `ready:false, tasks:0, online:[]` — кэш ещё не создан. (Подтверждает ARCH-AUDIT-001.)
- `lifeevents` при `ready && !show` (все проверки завершились, ни одного show:true) → `{"accsdb":true,"ready":true,"online":[],"msg":…}` (строки 610-634) — «Не удалось найти онлайн» / просьба добавить IMDB ID.
- `online[i].url` для локальных модулей = `{localhost}/lite/<plugin>` (в ответе клиенту — внешний host, в checkSearch — внутренний `127.0.0.1:9118` с `xhost`/`lcrqpasswd`); для внешних кластеров (overridehost/overridehosts) — внешний URL без подстановки.
- `externalids` (строки 137-413): резолв imdb_id↔kinopoisk_id (словарь + БД + apbugall.org/tabus + TMDB). Без обоих id многие балансеры `work=false` → show:false.

### 1.2 Живой реестр кластера (проба 2026-08-16, online3.skaz.tv)

`lite/events` (без карточки) = 32 модуля. Ключевое — **дом ноды каждого модуля** (топология кластера):

| Нода | Модули (по lite/events) |
|---|---|
| online3.skaz.tv | aniliberty, anilibria, animelib, filmix, animevost, animebesst, alloha, animedia, dreamerscast, remux, pidtor, sakhtv, kinoteatrkg, rezka, kinoflix (FilmGE), eneyida, rhsprem (HDRezka), rutubemovie, vkmovie, videoseed, veoveo, solntse, hdvb, kinotochka, asiage, geosaitebi |
| online8.skaz.tv | **kinopub, kinobase, xvideocdn (Fanserials), xvideocdnultra, xvideocdn60fps** |
| oleg6.skaz.tv | lumina (Lumina - 720p) |

→ **online8 = легаси/резервная нода** с отдельным набором модулей (kinopub + rch-блок). Это
независимо подтверждает ONLINE8-001/002 (403 `disable` для 9/10 балансеров = «модуль выключен»;
kinopub = 302-туннель с online3). `lite/withsearch` = 34 слага (подмножество с поиском; включает
collaps/collaps-dash/vdbmovies/vcdn/videocdn/kodik/rc/*).

### 1.3 Maniya-зеркало (текущая реализация)

| Шаг | Endpoint | Провайдер | Кластер-вызов | Вердикт/кэш | Куда ведёт |
|---|---|---|---|---|---|
| 1. Lampa открыл карточку | `/api/lampa/sources` | реестр | (нет) | статический список native + skaz | клиент рисует список |
| 2. (параллельно) | `/api/lampa/sources/card` | availability | `checksearch=true` по каждому visible-балансеру × пул хостов | три-стейт show/INC; кэш 5 мин, hide 60с; OLD∩NEW гейт; pinMap | show:true/false флаги на клиенте |
| 3. Выбор источника | `/api/lampa/videos?provider=skaz-<b>` | SkazProvider | `getLite` (сканирующий обход, пин) | карточки → items | список items/фильтров |
| 4. Play | `/api/lampa/video` (call) или proxy | SkazProvider/proxy | `resolveVideoJson`/`resolveStream` | `{method:play,url,quality,subtitles}` | плеер Lampa |

**Различие в кластер-вызове (важно):** E-Online поллит `lifeevents` (один memkey на ВСЕ балансеры
сразу), Maniya делает N отдельных checksearch (по одному на балансер, параллельно через
`Promise.allSettled`). Результат эквивалентен по observable-контракту (по-балансерный show), но:
- у E-Online все балансеры делят один таймаут-цикл и один 5-мин кэш;
- у Maniya каждый балансер независим (сбой одного не ломает других) — осознанное улучшение.

---

## §2. Идентичность: skaz-балансер ↔ E-Online ID ↔ display name ↔ маршрут ↔ кластер ↔ метод

### 2.1 ВАЖНЫЙ УТОЧНЯЮЩИЙ ВЫВОД о природе «E-Online» (PREVIOUS → NEW → CONFLICT → RESOLUTION)

**PREVIOUS CONCLUSION** (gap-analysis, prior аудиты): «E-Online фильтрует источники по карточке
(checksearch→show)»; «плагин-IP E-Online для данных не нужен — кластер напрямую»; имена источников
«Ozvuchky», «Lime» и т.п. считались именами E-Online.

**NEW EVIDENCE** (инвентаризация Temp-сборки Lampac, суб-агент 2026-08-16):
1. В `C:\Users\Admin\AppData\Local\Temp\Lampac` (референс-сборка) **нет ни одной строки**
   `skaz`/`online3`/`lampac.mx` ни в `.cs`, ни в `.conf`, ни в `.yaml`. Строки `skaz.tv` — только в
   `extensions.json` как **IPTV-плагины** («Телевидение by Skaz»), не как источники.
2. **Ни один модуль не задаёт `overridehost`/`overridehosts`** — все 63/64 модуля обслуживаются
   самим Lampac (`{localhost}/lite/{slug}`). Механизм `overridehost` существует в коде
   (`BaseSettings.cs`, `OnlineApi.cs`), но по умолчанию не включён.
3. Имён «Ozvuchky»/«Lime» в Temp-сборке нет (там VeoVeo, KinoPub и т.д.) — это имена **другого**
   дистрибутива Lampac — того, что раздаёт **кластер skaz**.
4. Живая проба `lite/events` (online3.skaz.tv) показала 32 модуля с display names Lime/KinoFlix/
   Ozvuchky/SkazTV — т.е. **сам кластер skaz.tv = развёрнутый Lampac NextGen** со своим набором
   модулей (обслуживает и E-Online-подобные инстансы, и Манию напрямую).

**CONFLICT**: «E-Online — это отдельный сервис, оборачивающий skaz» vs «E-Online и кластер skaz —
один и тот же Lampac-мир».

**RESOLUTION**: Для данной задачи конфликт снимается по observable-контракту. Канонические
семантики (lite/events, checksearch, lifeevents, ghost show:false, RCH) — **общие для всей семьи
Lampac** и доказаны по коду Temp-сборки (`OnlineApi.cs`). Кластер skaz — это **тот же самый Lampac**,
поэтому его live-поведение обязано совпадать с каноном (и совпадает: 32 модуля = ветка A реестра).
«E-Online» в смысле данного аудита = **эталонное поведение Lampac на кластере skaz** (что и проверяет
parity-probe). Maniya и раньше, и сейчас ходит **напрямую** в online3/online8 — зависимость от
внешнего E-Online отсутствует (см. §0.2). Расхождения display-name («Lime» vs «Ozvuchky») — вопрос
**конфигурации модуля**, а не модели данных.

### 2.2 Сводная таблица «skaz-балансер → E-Online → кластер → метод → Maniya»

Обозначения: **REST** — чистый HTTP; **REST→RCH** — httpHydra (REST-primary, RCH-fallback при
блокировке); **RCH** — только через RCH-хаб/браузер. «Кластер» — нода из живой пробы `lite/events`.
Maniya-статусы из `docs/eonline-gap-analysis.md` (WORKING/PARTIAL/BLOCKED) + live-матрицы r2.

| skaz slug | E-Online display (кластер) | E-Online route | Кластер | Check method | Play method | REST/RCH | Account | Maniya id | Maniya статус |
|---|---|---|---|---|---|---|---|---|---|
| alloha | Allo-XA | `lite/alloha` (+`alloha-search`, `/video`) | online3 | checksearch HTML `data-json` | JSON `/video` / прямой HLS | REST→RCH | токен apbugall.org/v2 | `skaz-alloha` (+ native Alloha) | WORKING |
| videoseed | VideoS (VideoSeed) | `lite/videoseed` | online3 | checksearch HTML | HLS | REST→RCH + браузер | нет (`enable=false` в Temp) | `skaz-videoseed` (+ native VideoSeed) | WORKING (частично: 503-флап, matrix) |
| kinopub | **Lime** | `lite/kinopub` (+`kinopubpro`) | **online8** | checksearch HTML карточки play/link | HLS `filetype=hls`, `/subtitles.json` | REST→RCH | **активация устройства/токен** | `skaz-kinopub` | WORKING (W1+кинопуб-аудиты) |
| kinoflix | **KinoFlix** (FilmGE) | `lite/kinoflix` | online3 | checksearch HTML | HLS | REST→RCH | нет | `skaz-kinoflix` | WORKING |
| veoveo | **Ozvuchky** (VeoVeo) | `lite/veoveo` (+`/parsed.m3u8`) | online3 | checksearch HTML | HLS (VEO-015: `#EXT-X-MEDIA` аудио) | REST→RCH | нет | `skaz-veoveo` | WORKING (VEO-015/GAP-012) |
| pidtor | **SkazTV** | `lite/pidtor` | online3 | checksearch HTML карточки | link/сериалы | REST | нет | `skaz-pidtor` | PARTIAL (карточки-link, seasons; в Temp-сборке нет такого модуля) |
| solntse | **Солнце** | `lite/solntse` | online3 | checksearch HTML | HLS | REST→RCH | нет | `skaz-solntse` | PARTIAL (503-флап: Аватар 503 null ×2) |
| filmix | FILMix | `lite/filmix` (+`filmixpro`, `filmixtv`, `fxapi`) | online3 | checksearch HTML | HLS | REST→RCH | аккаунт/токен Filmix | `skaz-filmix` (+ native Filmix) | WORKING |
| rezka | HDRezka | `lite/rezka` (+`/movie` `/serial`) | online3 | checksearch HTML | HLS | REST→RCH + RCH | нет (`enable=false` в Temp) | `skaz-rezka` (+ native Rezka) | WORKING |
| hdvb | VideoH (XDVB) | `lite/hdvb` (+`/video`, `/serial`) | online3 | checksearch HTML | JSON `/video` | REST→RCH | токен | `skaz-hdvb` (+ native HDVB) | WORKING |
| rutubemovie | RUTUBE (RutubeMovie) | `lite/rutubemovie` (+`/play`) | online3 | checksearch HTML | HLS | REST→RCH | нет | `skaz-rutubemovie` (+ native) | WORKING |
| kodik | Kodik | `lite/kodik` (+`/video`) | online3 | checksearch HTML | JSON `/video` | REST (API) | токен | `skaz-kodik` (+ native Kodik) | WORKING |
| geosaitebi | GeoVideo | `lite/geosaitebi` | online3 | checksearch HTML карточки-link | link (фильмы) | REST→RCH | нет | `skaz-geosaitebi` | PARTIAL (карточки link-similar: Одиссея 2 шт (2016/2026), Скайуокер 1 шт) |
| rhsprem | HDRezka 4K | `lite/rhsprem` | online3 | checksearch HTML | HLS | REST→RCH | нет | `skaz-rhsprem` | PARTIAL (в Temp-сборке нет; отдаёт 4K-эпизоды) |

Дополнительно в реестре кластера (не в Maniya-пуле): kinotochka (REST→RCH), kinobase (RCH/Playwright),
xvideocdn/xvideocdnultra/xvideocdn60fps (rch-блок, online8), lumina (oleg6), sakhtv/remux/anime-модули,
eneyida (OnlineUKR), asiage (OnlineGEO). Из них **kinobase + xvideocdn-семейство = RCH-mandatory** →
в Maniya не добавляются (см. §8).

**Вывод §2:** идентичность = **slug маршрута**, а не display name (один slug → разные display в
разных дистрибутивах: veoveo=«VeoVeo»/«Ozvuchky», kinopub=«KinoPub»/«Lime», kinoflix=«KinoFlix»/
«FilmGE»). Maniya корректно опирается на slug (`skaz-<balancer>`), display name только для UI
(`meta.js` PROVIDER_META / `registry.js` EO_TITLES).

---

## §3. Семантика life events (lite/events + lifeevents)

### 3.1 Три ветки lite/events (канон, OnlineApi.cs 870-950; подтверждено живой пробой)

| Ветка | Условие | Ответ | Назначение |
|---|---|---|---|
| **A** | checkOnlineSearch ВЫКЛ **или** нет id карточки | `[{name,url,balanser}]` — статический реестр, без show/index/rch | «все источники» (для UI, без проверок). Живая проба 2026-08-16: 32 модуля |
| **B** | checkOnlineSearch ВКЛ + id | `[{name,url,index,show,balanser,rch}]` — ВСЕ модули, включая show:false | список для карточки; скрывает клиент (ghost) |
| **C** | `life=true` | `{life:true, memkey}` | live-поллинг: клиент поллит `lifeevents?memkey` |

### 3.2 Семантика lifeevents?memkey (канон)

- **Ключ кэша** (5 мин): FNV-1a(`checkOnlineSearch:`+id+serial+source+(KitConf?uid:"")) — **БЕЗ**
  imdb_id/kp/title/year в ключе.
- `ready = onlineItems.Count == links.Count` — все проверки завершились (denominator = tasks).
- `tasks` = links.Count — **ВСЕГО** модулей, а не «осталось». `ready:false, tasks:N` = норма
  live-поллинга (ARCH-AUDIT-001 подтверждён).
- `online[]` — результат каждой checkSearch: `{name,url,index,show,balanser,rch}`. Сортировка
  `work desc, index asc`.
- **ВСЕ checkSearch завершились с крахом** (все links null) → `ready` вычисляется как true при
  online=0? Нет — links.Count остаётся 0 → кэш `{ready:false,tasks:0,online:[]}` (пустой). Это НЕ
  accsdb-ошибка.
- `ready && !show` (все проверились, show везде false) → `{"accsdb":true,"ready":true,"online":[],
  "msg":"…"}` — «Не удалось найти онлайн» (клиент показывает заглушку; msg просит добавить IMDB ID).
  (Из gap-analysis: именно так «пропадали» источники при неполных externalids.)

### 3.3 Что это значит для Maniya

Maniya **не поллит** lifeevents — она вызывает checksearch per-balancer через `/sources/card` и
получает готовый три-стейт show. По observable-контракту это эквивалентно ветке B E-Online
(по-балансерный show), но:
- E-Online держит **единый** 5-мин кэш на карточку (все балансеры), Maniya — по-балансерный кэш
  с hide 60с;
- E-Online **никогда не делает второй замер** (один сигнал), Maniya делает OLD∩NEW (см. §6).

---

## §4. IDENTITY: balanser ID vs display name vs URL-кластер

**Правило:** идентичность источника = **маршрут `lite/<slug>` + узел кластера**. Display name —
презентация (может различаться между дистрибутивами Lampac и даже между страницами). URL-кластер
может быть общим для многих slug (online3) или выделенным (online8/oleg6).

Доказано живыми пробами:
- `veoveo` = «VeoVeo» (Temp Lampac) = «Ozvuchky» (skaz) — тот же slug, тот же контент. VEO-015
  подтвердил: переименование «Ozvuchky - Full HD» — НЕ баг (identity≠presentation).
- `kinopub` = «KinoPub» (Temp) = «Lime» (skaz) — slug/кластер уникален (online8).
- `kinoflix` = «KinoFlix» (gap) = «FilmGE» (skaz-дистрибутив) — slug `lite/kinoflix`, online3.
- `rhsprem` — на кластере имя «HDRezka 4K»; это **другой slug**, чем `rezka` («HDRezka»).
- Скайуокер у geosaitebi = грузинская карточка «ვარსკვლავური ომები…» (тот же фильм, др. язык);
  Одиссея у geosaitebi = **два разных** фильма (2026 и 2016) — см. §11 (классификация
  IDENTITY-MISMATCH / SEMANTIC-MISMATCH).

**Итог §4:** «display name как identity» запрещено (повторяет constraint §0.1). Maniya держит
`skaz-<slug>` как канонический id и НЕ переименовывает контент по чужому display name.

---

## §5. Топология кластера (универсумы и резерв)

### 5.1 Карта нод (подтверждена lite/events 2026-08-16 + prior аудитами)

| Нода | IP/дом | Роль | Модули | Универсум |
|---|---|---|---|---|
| online3.skaz.tv | (skaz) | **primary** | все REST-балансеры Maniya: alloha, videoseed, kinoflix, veoveo, pidtor, solntse, filmix, rezka, hdvb, rutubemovie, kodik, geosaitebi, rhsprem + anime/ukr-блок | основной контент |
| online8.skaz.tv | (skaz) | **reserve/легаси** | kinopub, kinobase, xvideocdn, xvideocdnultra, xvideocdn60fps | kinopub (через 302-туннель с online3); остальные 403 `disable` |
| oleg6.skaz.tv | (skaz) | резерв | lumina (Lumina - 720p) | одиночный |
| 94.249.239.63/.37/.11 | skaz-IP | запасные (SKAZ_HOSTS/EO_HOSTS) | — | те же |
| 77.90.33.109 | skaz-IP | запасной | — | те же |

### 5.2 Сценарии A/B vs E-Online (не откатывать W1)

| Сценарий | cluster (online3/8) | E-Online (канон) | Maniya (W1) |
|---|---|---|---|
| A: источник есть, контент есть | 200 `data-json` карточки | show:true (work=true) | show:true |
| B: источник есть, контента нет | 200 пусто / 503 `null` / 403 `disable` | show:false ghost (1 сигнал) | INC → show:true пока OLD∩NEW оба «нет»; hide 60с |
| C: flapping (cs=200 контент, plain=503) | разные результаты в окне | show:true (поймал 200) | OLD∩NEW: если один сигнал контент — show:true |

**Почему нельзя откатить W1:** W1 (orderedSkazHosts + continue-скан + pin) устранил CLUSTER-MISMATCH
(Паразиты/kinopub FP и Одиссея/collaps FN — см. BALANCER-SEMANTICS-005). Откат вернёт рассинхрон
host-выбора availability (hosts[0]+swapHost) vs SkazClient (`_hostIndex%len`) на видео-шаге. W1 —
закоммичено и prod-verified (см. [[maniya-balancer-semantics-005-w1-impl]]), регрессий нет.

### 5.3 A=EMPTY / B=CONTENT — наблюдаемые реальные кейсы (postw1-fresh-probe2, 2026-08-16)

| Пара | cs (checksearch=true) | plain | Вывод |
|---|---|---|---|
| kinopub/Одиссея #1 | 200 EMPTY-2xx (15.0с) | 200 EMPTY-2xx (15.0с) | длинный скан → пусто |
| kinopub/Одиссея #2 | fetch failed (10.7с) | fetch failed (10.6с) | кластер перегружен |
| kinopub/Аватар | fetch failed (10.6с) | **200 CARDS 7×play** (6.1с) | **флап: cs падает, plain работает** |
| kinopub/Дюна2 | abort (15.0с) | abort (15.0с) | стабильно висит |
| kinopub/Форрест | **200 CARDS 25×play** (0.9с) | 503 `null` (8.2с) | **флап в обратную сторону** |
| kinopub/ПД | 200 2×link similar (13.7с) | 200 2×link similar (0.4с) | карточки «Последний дом слева» = **другой фильм 2009** |
| kinopub/ДД (serial) | 200 3×link (6.1с) | 200 3×link (0.7с) | сезонные карточки |
| kinopub/Интерстеллар | fetch failed (11.0с) | 200 4×link similar (10.6с) | cs=смерть, plain=контент |
| geosaitebi/Одиссея | 200 2×link (1.3с) | 200 2×link (0.3с) | link-карточки (2026/2016) |
| geosaitebi/Скайуокер | 200 1×link (1.4с) | 200 1×link (0.3с) | link-карточка |
| pidtor/ДД | 200 3×link (0.5с) | 200 3×link (0.3с) | сезонные link-карточки |
| solntse/Аватар | 503 `null` (0.1с) | 503 `null` (0.1с) | стабильно «нет» |
| kinoflix/Одиссея | 503 `null` (0.6с) | 503 `null` (0.4с) | стабильно «нет» |
| videoseed/ПД | 503 (2.0с) | 503 (0.5с) | стабильно «нет» |

**Ключевой факт §5.3:** у kinopub (online8) cs≠plain дают **противоположные** результаты в один и
тот же временной окно (Аватар: cs=timeout/plain=7 карточек; Форрест: cs=25 карточек/plain=503). Это
означает: **одиночный сигнал (1× checksearch) не является достоверным** для kinopub-класса —
канон E-Online (show:false на любой 1×503/timeout) даёт шум. OLD∩NEW гейт Maniya здесь —
обоснованное отклонение от канона (см. §6.4).

---

## §6. AVAILABILITY — полная каноническая вердикт-матрица

### 6.1 Канон E-Online (checkSearch, OnlineApi.cs 957-1053)

Предикат: `work = rch || res.Contains("data-json=") || res содержит "type":"movie"|"episode"|"season"`.
Таймаут 10с. `GetSpan` вызывает spanAction ТОЛЬКО при status==OK и непустом теле. Присваивание
`links[indexList]` (строка 1047) происходит безусловно → **источник ОСТАЁТСЯ в списке** с
`"show":work` при любом не-content-результате (ghost). **OMITTED** (выпадает совсем) — только при
исключении, которое ускользнуло из `GetSpan` (программном; network-исключения глотаются внутри
`Http.cs` и дают тот же ghost). Кэш 5 мин (единый на карточку, ключ без imdb/kp).

### 6.2 Maniya-сигналы (availability.js probe/confirm/computeCard)

`probe()` (638-786) классифицирует КАЖДЫЙ хост пула:
- не-2xx (403/404/422/429/5xx): primary → `sawStatusNo` (шум, не «нет»); online8-reserve (abstain) → `sawReserveAbstain`;
- 2xx + accsdb «ожидаем фильм в хорошем качестве» → content-«нет» (`sawDefinitiveNo`, primary) / abstain (reserve);
- 2xx + прочий accsdb («Войдите в аккаунт») → `sawAccsdb`+`sawNoResponse` (вердикта нет);
- 2xx + `isNonContentAnswer` (`null`/`disable`/пусто) → `sawDefinitiveNo` (primary) / abstain (reserve);
- 2xx + content → `checkSearchPredicate` (предикат = канон Lampac) → show/rch/quality; inconclusive → show:true+флаг.

Итог цикла (abstain-mode): hide только при `sawDefinitiveNo && !sawNoResponse` (чистый content-«нет»
без сбоев) → authoritative absent. Всё прочее → show:true inconclusive (`mixed` при «нет» где-то).

**OLD∩NEW гейт** (`computeCard` 985-1031): кандидаты на скрытие = rows с `show===false &&
authoritative && !accsdb && !trusted` (trusted filmix исключён всегда). Каждый подтверждается
**вторым независимым сигналом**: `confirmWithBackoff` — прямой `lite/<balancer>` БЕЗ checksearch
(тот механизм, что реально тянет /videos), retry 500мс макс 2; native без твина —
`confirmNativeAbsence`. Только когда ОБА сигнала «нет» → hide. Инконклюзивное подтверждение
(RULE-4) первичный вердикт НЕ переворачивает. Hide кэшируется **60с** (`HIDE_TTL_MS`), не 5 мин;
FOUND — 5 мин; INCONCLUSIVE-ряды не блокируют кэш (`hasInconclusive`, self-heal).

### 6.3 Матрица (канон vs Maniya)

| Результат кластера | Lampac work | E-Online show | E-Online в списке | Maniya probe() | Maniya show | Maniya кэш |
|---|---|---|---|---|---|---|
| 200 + `data-json=`/`type:movie|episode|season` | true | **show:true** | видим | predicate work=true | **show:true** | 5 мин |
| 200 + маркер, но только link/play-карточки чужого фильма | true | **show:true** | видим | predicate work=true | **show:true** | 5 мин |
| 200 пустое тело | false | show:false ghost | ghost | non-content → `sawDefinitiveNo` | hide после OLD∩NEW | 60с |
| 200 `null` / `false` / `disable` | false | show:false ghost | ghost | non-content → `sawDefinitiveNo` | hide после OLD∩NEW | 60с |
| 403 `disable` (primary) | false | show:false ghost | ghost | `sawStatusNo` (шум) | **show:true** (INC) | 5 мин |
| 403 `disable` (online8, не-kinopub) | false | show:false ghost | ghost | `sawReserveAbstain` | **show:true** (INC) | 5 мин |
| 404 | false | show:false ghost | ghost | `sawStatusNo` | show:true (INC) | 5 мин |
| 422 | false | show:false ghost | ghost | `sawStatusNo` | show:true (INC) | 5 мин |
| 429 | false | show:false ghost | ghost | `sawStatusNo` | show:true (INC) | 5 мин |
| 5xx | false | show:false ghost | ghost | `sawStatusNo` | show:true (INC) | 5 мин |
| timeout 10с (1 сигнал) | false | show:false ghost | ghost | дедлайн; RULE-4 | hide ТОЛЬКО если чистый «нет»; иначе show:true | 60с/5 мин |
| network error (abort/reset) | false (глотается) | show:false ghost | ghost | `sawNoResponse` | show:true (INC) | 5 мин |
| accsdb «ожидаем фильм в хорошем качестве» | false | show:false ghost | ghost | content-«нет» | hide после OLD∩NEW | 60с |
| accsdb «Войдите в аккаунт» | false | show:false ghost | ghost | `sawAccsdb` (нет вердикта) | show:true (INC) | 5 мин |
| RCH-модуль (rch:true) | true (rch) | **show:true** | видим | rch флаг прокидывается | show:true | 5 мин |
| trusted (filmix) | — | (не в каноне) | — | TRUSTED_ALWAYS_VISIBLE | show:true БЕЗ пробы | 5 мин |

### 6.4 Divergences (E-Online vs Maniya) — осознанные

| # | Результат | E-Online | Maniya | Почему |
|---|---|---|---|---|
| D1 | 503/403/404/422/429/5xx/timeout, 1 сигнал | show:false ghost на 5 мин | show:true (INC) или hide после OLD∩NEW на 60с | **anti-FN**: одиночный шумовый сигнал прячет рабочий источник на 5 минут; kinopub-флап доказан (§5.3). Maniya требует ДВА согласных «нет» |
| D2 | 403 `disable` от резервной online8 (не-kinopub) | show:false ghost | abstain → show:true | ONLINE8-001: 403 `disable` — политика «модуль выключен», query-independent, НЕ «контента нет» |
| D3 | accsdb «Войдите в аккаунт» | show:false ghost | show:true (INC) | отказ учётки ≠ отсутствие контента (кейс 2026-08-13: кластер на миг отказывал → не прятать рабочий источник) |
| D4 | hide кэш | 5 мин (один сигнал) | 60с (два сигнала) | self-heal: насыщение онлайн8-туннеля не должно висеть 5 минут |
| D5 | externalids неполные (нет imdb/kp) | многие work=false → show:false | (не зависит: Maniya резолвит из TMDB-источника карточки) | Maniya не полагается на E-Online externalids |

**Вывод §6:** по **принципу** (200-content → show, пусто/«нет» → скрыть) Maniya совпадает с каноном.
По **порогу**: канон прячет по ОДНОМУ сигналу на 5 мин; Maniya требует двух согласных «нет»
+ короткий hide. Это НЕ ошибка реализации, а задокументированная anti-FN политика (005-C: «Maniya
hide-семантика для kinopub корректна по канону», «1×503-ghost на 5 мин» vs «2×503 + backoff,
self-heal 60с»). FP остаточные (show:true, videos=0) — из §5.3: карточки-link/чужой фильм (Lampac
предикат тоже сказал бы work=true) → **SHOW-расхождение отсутствует**, это parser/identity-уровень
(§11).

---

## §7. PLAYBACK — полный путь show:true → /videos → /video → resolve → master → variant → segment

### 7.1 Канон E-Online (playback)

| Шаг | Что происходит | Механизм |
|---|---|---|
| 1 | Клиент видит show:true источник, тапает | открывает `online[i].url` → `lite/<balancer>?title=…&serial=…&clarification=1` |
| 2 | Страница → items | HTML `data-json` карточки: play (прямой URL), call (нужен резолв), link (навигация) |
| 3 | Play-карточка | прямой `movie.m3u8`/`mp4` → плеер (Origin для подписанных) |
| 4 | Call-карточка | резолв `lite/<balancer>/video` (или спец. маршрут: `/movie`, `/parsed.m3u8`, `/manifest`) → `{method:play,url,quality,subtitles}` |
| 5 | Serial | страница сезонов → `lite/<balancer>/serial` (или `/episode`) с season/voice; клиентские фильтры |
| 6 | Манифест | HLS: master → variant → segment; прокси/allowlist при необходимости |

### 7.2 Maniya (реализация)

| Шаг | Endpoint | Провайдер | Что делает |
|---|---|---|---|
| 1 | `/api/lampa/videos?provider=skaz-<b>` | SkazProvider.movieVideos | `getLite` (W1-скан по хостам: primary-first, online8-last, контент→стоп, EMPTY только все-«нет») с `pinnedHost` (store.js withPinnedHost → query.host) |
| 2 | — | collectMovieCards | карточки `data-json` → play/call/link; `linkCardMatchesQuery` (ID/год/название) для навигации; serial → openSeasonPage |
| 3 | Play-карточка | — | items `{method:'play', url}` напрямую |
| 4 | Call-карточка | `/api/lampa/video` | resolveCardItem → `resolveVideoJson` (JSON-режим `lite/<b>/video`, без play) → `{method:play,url,quality,subtitles}`; при неудаче reserve-fallback → `resolveStream` (redirect-follow, Origin) |
| 5 | Serial | /videos + /video | сезон/голос: `stype` под-фильтры клиента (не `filter.set('season')`) |
| 6 | Манифест | proxy | allowlist `proxy.allowHosts` (mvapspdmpg.com, vkvideo.cloud; httpAllowHosts 94.249.*/skaz.tv/voidboost.one/voidboost.com/scts.tv) |

### 7.3 Исторические playback-фиксы (что УЖЕ покрыто — не откатывать)

| Проблема | Корень | Фикс | Отчёт |
|---|---|---|---|
| veoveo title/quality | `normalizerCardTitle` брал `_text`=«1080p» вместо `card.title` | VEO-015: `^#EXT-X-[A-Z0-9-]+:` + синтез title/quality | [[maniya-balancer-skaz-veo-015]] |
| veoveo HLS 404 | `rewriteDirectiveUri` не переписывал `#EXT-X-MEDIA` аудио-URI | VEO-015 | там же |
| veoveo 403 | SSRF redirect-валидация (307→CDN не в allowlist) | GAP-012: `mvapspdmpg.com` в allowlist | [[maniya-gap012-veoveo]] |
| hidden-twin 404 на Play | lazy call-карточка со скрытым `provider=skaz-<b>` (твин native), `getVideoForRequest` искал видимые | `allProviders()` + поиск в store.js | [[maniya-hidden-twin-404]] |
| «видео не найдено» на Play | lazy resolveVideo повторно гонял навигацию кластера | nav-кэш 5 мин | [[maniya-nav-cache-fix]] |
| kinopub-сериалы | сезонные link-карточки | `linkCardMatchesQuery` (ID/год/название) | BALANCER-KINOPUB-004 |

### 7.4 Playback chain (проверено live)

Ava-манифест: master (`#EXTM3U` + variants) → variant `#EXT-X-STREAM-INF` (4K/1080p…) → segment
`.ts`/`.m4s`. E2E-пробы: Интерстеллар (filmix→items/playback PASS), ПД/veoveo (4q), Форрест/veoveo,
ДД/kinopub (сериал 3 сезона), Аватар/kinopub (7 play-карточек). 206-цепочки на proxy подтверждены
(W1-prod-report).

---

## §8. RCH / WEBSOCKET MANDATORY — не добавлять источник только потому, что lite/events его показывает

Классификация по Temp-инвентаризации (sub-агент) + живой пробе кластера.

### 8.1 Правило
`lite/events` (ветка A) показывает **реестр всех модулей кластера** — включая те, что физически не
работают без RCH-хаба/WebSocket/Chromium. Для Maniya (zero-dep, чистый HTTP) «в реестре есть» НЕ
означает «добавить в пул». Добавляются только источники с доказанным REST-контрактом
(реализованный клиент + нормализатор + videos()/streams() + тесты).

### 8.2 Список RCH/браузер-mandatory (встречены в реестре кластера или Temp)

| slug | display | Нода | RCH-тип | Вердикт Maniya |
|---|---|---|---|---|
| kinobase | Kinobase | online8 | Playwright/RCH | **не добавлять** (RCH-only) |
| xvideocdn | Fanserials | online8 | rch-блок | **не добавлять** (RCH-only) |
| xvideocdnultra | Fanserials (ultra) | online8 | rch-блок | **не добавлять** (RCH-only) |
| xvideocdn60fps | Fanserials (60fps) | online8 | rch-блок | **не добавлять** (RCH-only) |
| kinogo | Kinogo | (не в 32 реестра) | RCH-прямые `rch.` | **не добавлять** |
| pizdatoehd | PizdatoeHD | (не в 32) | Playwright | **не добавлять** |
| lumina | Lumina - 720p | oleg6 | специализированный | **не добавлять** (одиночный, отдельная нода) |
| videoseed* | VideoS | online3 | REST→RCH + браузер (Temp) | частично: в пуле, REST-путь работает (503-флап на пробах — смотреть §11) |
| kinotochka* | Kinotochka | online3 | REST→RCH (httpHydra) | REST-usable, в пуле НЕТ (не в EO_BALANCERS) |

\* REST→RCH (httpHydra) = REST-primary с автоматическим RCH-fallback при блокировке — Maniya берёт
только REST-путь; если кластер отвечает контентом по REST, добавление оправдано. Помеченные `*`
остаются кандидатами, но НЕ автоматическими.

### 8.3 Kodik-дубли (не добавлять)
`withsearch` содержит vcdn/videocdn/lumex — это зеркала Kodik/VideoCDN-семейства. Maniya имеет
native Kodik (`lite/kodik` в слогах тоже есть) → skaz-варианты vcdn/videocdn НЕ добавляются (дубли
идентичности, constraint §0.1 «не провайдер-специфичные хакдэм»).

---

## §9. COLLAPS — отдельная ветка (не смешивать)

- Collaps **НЕ входит в skaz-пул Maniya** (`config.skaz.balancers` = EO_BALANCERS, collaps там нет).
- `lite/withsearch` кластера **содержит** `collaps` и `collaps-dash` — то есть на кластере они есть;
  но ARCH-AUDIT-001 зафиксировал: Maniya трактует Collaps как **native-only** источник (собственный
  `CollapsProvider`, свой API-контракт, отдельные тесты), без skaz-твина.
- Temp-классификация: Collaps = REST→RCH (httpHydra), фильмы+сериалы, self. Значит canonical-checksearch
  к нему применим, но Maniya-модель Collaps = **отдельная ветка** с собственным native-availability
  (nativeProbe), НЕ через skaz-checksearch.
- Правило: **не смешивать** Collaps-карточки/мета с skaz-источниками и не выводить «Collaps» как
  display-name в skaz-идентичность (constraint §0.1, задача §9). GAP-013 (422-флап, HARD_REFUSAL
  переоценка) — вне scope этого аудита, не трогать.

---

## §10. Метод сравнительных проб (15 тайтлов)

**Парадные данные:**
- **parity-probe** (2026-08-16 12:23 UTC, online3.skaz.tv): 15 тайтлов × 14 балансеров,
  `checksearch=true` + реальные параметры карточки (tmdb/imdb/kp id, title, год, serial), реальные
  creds. Канонический вердикт Lampac по `OnlineApi.cs`:
  - 200 + content-marker → **SHOW** (work=true);
  - 503/403/timeout/2xx-empty → **SHOW-FALSE ghost** (work=false; источник в списке скрытым);
  - network-timeout/abort → пометка **OMITTED**, но по канону это ТОТ ЖЕ ghost show:false
    (network-исключения глотаются `Http.cs` → spanAction не вызван → `work=false`) — в таблицах
    помечено `G` (= ghost), не отдельный класс.
- **matrix-api-result-r2** (2026-08-16 07:03 UTC, Maniya live): 11 тайтлов × 16 источников —
  card show-флаги (availability) + items по каждому `skaz-*` (реальные /videos). foundCount=77,
  FP=15 (show:true, videos=0).
- **postw1-fresh-probe2** (2026-08-16, realparams): cs+plain пары по 13 ключевым кейсам + разбор
  карточек (play/link/similar).

**Легенда таблиц §11:** `S` = E-Online SHOW (200+маркер); `g` = E-Online ghost (show:false);
`G` = E-Online ghost при timeout/network (канон — тоже ghost). Maniya: `T`/`F` = show флаг карточки;
items = число видео-айтемов из matrix. `(native)` — источник обрабатывается Maniya native-клиентом
(в matrix items не мерились). Class — финальная классификация (§11.3).

---

## §11. Главная таблица: 15 тайтлов × 14 источников

### 11.1 Таблица (по тайтлу)

**Одиссея 2026** (tmdb 1368337, tt33764258)

| Балансер | E-Online | Maniya show | Maniya items | Class |
|---|---|---|---|---|
| alloha | S (200, 4396) | T | 4 | FOUND |
| videoseed | S (200, 2292) | T | 5 | FOUND |
| kinopub | G (timeout) | T (INC) | 0 | UNABLE (кластер отвечал EMPTY 15с, затем сбой) |
| kinoflix | g (503) | T (INC) | 0 | EMPTY/TRANSIENT (E ghost; Maniya INC-оптимист) |
| veoveo | S (200, 641) | T | 1 | FOUND |
| pidtor | g (200 empty) | F | 0 | OK оба прячут ✓ |
| solntse | g (503) | T (INC) | 0 | EMPTY/TRANSIENT |
| filmix | S (200, 1260) | T | (native) | FOUND |
| rezka | g (accsdb) | F | (native) | OK оба прячут ✓ |
| hdvb | S (200, 12738) | T | (native) | FOUND |
| rutubemovie | S (200, 8579) | T | (native) | FOUND |
| kodik | S (200, 42819) | F | (native) | UNRESOLVED (E SHOW vs Maniya hide) |
| geosaitebi | S (200, 1129) | T | 0 | SEMANTIC-MISMATCH (link-карточки 2016+2026) |
| rhsprem | g (accsdb) | F | 0 | OK оба прячут ✓ |

**Последний дом 2026** (tmdb 1284041, tt32268156)

| Балансер | E-Online | Maniya show | Maniya items | Class |
|---|---|---|---|---|
| alloha | S (200, 3734) | T | 3 | FOUND |
| videoseed | g (503) | T (INC) | 0 | EMPTY/TRANSIENT (E ghost; Maniya FP) |
| kinopub | S (200, 2056) | F | 0 | IDENTITY-MISMATCH — **Maniya ПРАВА** (карточки «Последний дом слева» = др. фильм 2009; E-Online показал бы чужой фильм) |
| kinoflix | S (200, 972) | F | 0 | UNRESOLVED (E SHOW vs Maniya hide) |
| veoveo | S (200, 2415) | T | 4 | FOUND |
| pidtor | S (200, 6410) | T | 7 | FOUND |
| solntse | g (503) | T (INC) | 0 | EMPTY/TRANSIENT |
| filmix | S | T | (native) | FOUND |
| rezka | S (200, 2074) | T | (native) | FOUND |
| hdvb | S (200, 3063) | T | (native) | FOUND |
| rutubemovie | S (200, 3801) | T | (native) | FOUND |
| kodik | S (200, 57063) | F | (native) | UNRESOLVED |
| geosaitebi | S (200, 722) | F | 0 | UNRESOLVED (E SHOW vs Maniya hide) |
| rhsprem | S (200, 2082) | T | 2 | FOUND |

**Интерстеллар 2014** (tmdb 157336, tt0816692)

| Балансер | E-Online | Maniya show | Maniya items | Class |
|---|---|---|---|---|
| alloha | S | T | 8 | FOUND |
| videoseed | S | T | 9 | FOUND |
| kinopub | G (timeout) | T | 9 | **MANIYA-BETTER** (E ghost, а контент есть) |
| kinoflix | S | T | 3 | FOUND |
| veoveo | S | T | 1 | FOUND |
| pidtor | S | T | 9 | FOUND |
| solntse | S | T | 1 | FOUND |
| filmix | S | T | (native) | FOUND |
| rezka | S | T | (native) | FOUND |
| hdvb | S | T | (native) | FOUND |
| rutubemovie | g (503) | T (native) | (native) | M-оптимист (native) |
| kodik | S (200, 2411) | F | (native) | UNRESOLVED |
| geosaitebi | S | T | 1 | FOUND |
| rhsprem | S | T | 10 | FOUND |

**Форрест Гамп 1994** (tmdb 13, tt0109830)

| Балансер | E-Online | Maniya show | Maniya items | Class |
|---|---|---|---|---|
| alloha | S | T | 4 | FOUND |
| videoseed | g (503) | T (INC) | 0 | EMPTY/TRANSIENT (E ghost; Maniya FP) |
| kinopub | S (200, 84763) | T | 25 | FOUND |
| kinoflix | S | T | 3 | FOUND |
| veoveo | S | T | 1 | FOUND |
| pidtor | S | T | 8 | FOUND |
| solntse | S | T | 1 | FOUND |
| filmix | S | T | (native) | FOUND |
| rezka | S | T | (native) | FOUND |
| hdvb | S | T | (native) | FOUND |
| rutubemovie | g (503) | T (native) | (native) | M-оптимист |
| kodik | g (503) | T (native) | (native) | M-оптимист |
| geosaitebi | S | T | 1 | FOUND |
| rhsprem | S | T | 22 | FOUND |

**Матрица 1999** (tmdb 603, tt0133093)

| Балансер | E-Online | Maniya show | Maniya items | Class |
|---|---|---|---|---|
| alloha | S | T | 7 | FOUND |
| videoseed | g (503) | T | 16 | **MANIYA-BETTER** (E ghost, контент 16) |
| kinopub | G (timeout) | T | 22 | **MANIYA-BETTER** |
| kinoflix | g (503) | T (INC) | 0 | EMPTY/TRANSIENT (E ghost; Maniya FP) |
| veoveo | S | T | 1 | FOUND |
| pidtor | S | T | 3 | FOUND |
| solntse | S | T | 1 | FOUND |
| filmix | S | T | (native) | FOUND |
| rezka | S | T | (native) | FOUND |
| hdvb | S | T | (native) | FOUND |
| rutubemovie | g (503) | T (native) | (native) | M-оптимист |
| kodik | S (200, 36960) | F | (native) | UNRESOLVED |
| geosaitebi | S | T | 1 | FOUND |
| rhsprem | S | T | 18 | FOUND |

**Дюна: Часть вторая 2024** (tmdb 693134, tt15239678)

| Балансер | E-Online | Maniya show | Maniya items | Class |
|---|---|---|---|---|
| alloha | S | T | 11 | FOUND |
| videoseed | g (503) | T | 16 | **MANIYA-BETTER** |
| kinopub | G (timeout) | T | 14 | **MANIYA-BETTER** |
| kinoflix | S | T | 2 | FOUND |
| veoveo | S | T | 1 | FOUND |
| pidtor | S | T | 47 | FOUND |
| solntse | S | T | 1 | FOUND |
| filmix | S | T | (native) | FOUND |
| rezka | S | T | (native) | FOUND |
| hdvb | S | T | (native) | FOUND |
| rutubemovie | g (503) | T (native) | (native) | M-оптимист |
| kodik | S (200, 48569) | F | (native) | UNRESOLVED |
| geosaitebi | S | T | 1 | FOUND |
| rhsprem | S | T | 11 | FOUND |

**Звёздные войны: Скайуокер 2019** (tmdb 181812, tt2527338)

| Балансер | E-Online | Maniya show | Maniya items | Class |
|---|---|---|---|---|
| alloha | S | T | 3 | FOUND |
| videoseed | g (503) | T | 3 | **MANIYA-BETTER** |
| kinopub | G (timeout) | F | 0 | OK оба прячут (контента нет в окне) |
| kinoflix | S | T | 2 | FOUND |
| veoveo | S | T | 1 | FOUND |
| pidtor | S | T | 6 | FOUND |
| solntse | g (503) | T (INC) | 0 | EMPTY/TRANSIENT (E ghost; Maniya FP) |
| filmix | S | T | (native) | FOUND |
| rezka | S | T | (native) | FOUND |
| hdvb | S | T | (native) | FOUND |
| rutubemovie | g (503) | T (native) | (native) | M-оптимист |
| kodik | S (200, 53329) | F | (native) | UNRESOLVED |
| geosaitebi | S (200, 1020) | T | 0 | SEMANTIC-MISMATCH (link-карточка др. фильма) |
| rhsprem | S | T | 5 | FOUND |

**Паразиты 2019** (tmdb 496243, tt6751668)

| Балансер | E-Online | Maniya show | Maniya items | Class |
|---|---|---|---|---|
| alloha | S | T | 1 | FOUND |
| videoseed | S | T | 6 | FOUND |
| kinopub | G (timeout) | F | 0 | OK оба прячут |
| kinoflix | g (503) | T (INC) | 0 | EMPTY/TRANSIENT (E ghost; Maniya FP) |
| veoveo | S | T | 1 | FOUND |
| pidtor | S | T | 3 | FOUND |
| solntse | S | T | 1 | FOUND |
| filmix | S | T | (native) | FOUND |
| rezka | S | T | (native) | FOUND |
| hdvb | g (503) | T (native) | (native) | M-оптимист (native) |
| rutubemovie | g (503) | T (native) | (native) | M-оптимист |
| kodik | S | T (native) | (native) | FOUND (native) |
| geosaitebi | g (503) | T | 1 | **MANIYA-BETTER** (E ghost, контент 1) |
| rhsprem | S | T | 11 | FOUND |

**Дом Дракона 2022 (serial)** (tmdb 94997, tt11198330)

| Балансер | E-Online | Maniya show | Maniya items | Class |
|---|---|---|---|---|
| alloha | S | T | 10 | FOUND |
| videoseed | S | T | 10 | FOUND |
| kinopub | g (503) | T | 10 | **MANIYA-BETTER** (E ghost, контент 10) |
| kinoflix | g (503) | T (INC) | 0 | EMPTY/TRANSIENT (E ghost; Maniya FP) |
| veoveo | S | T | 10 | FOUND |
| pidtor | S (200, 1424) | T | 0 | PARSER (link-сезонные карточки; Class B post-W1) |
| solntse | S | T | 10 | FOUND |
| filmix | S | T | (native) | FOUND |
| rezka | S | T | (native) | FOUND |
| hdvb | S | T | (native) | FOUND |
| rutubemovie | g (503) | T (native) | (native) | M-оптимист |
| kodik | S (200, 44121) | F | (native) | UNRESOLVED |
| geosaitebi | g (503) | T (INC) | 0 | EMPTY/TRANSIENT (E ghost; Maniya FP) |
| rhsprem | S | T | 10 | FOUND |

**Аватар 2009** (tmdb 19995, tt0499549)

| Балансер | E-Online | Maniya show | Maniya items | Class |
|---|---|---|---|---|
| alloha | S | T | 5 | FOUND |
| videoseed | S | T | 9 | FOUND |
| kinopub | G (timeout) | F | 7 | **FN-ОБОИХ** (контент ЕСТЬ, оба прячут: E по timeout, Maniya hide-gate) |
| kinoflix | S | T | 3 | FOUND |
| veoveo | S | T | 1 | FOUND |
| pidtor | S | T | 9 | FOUND |
| solntse | g (503) | T (INC) | 0 | EMPTY/TRANSIENT (E ghost; Maniya FP) |
| filmix | S | T | (native) | FOUND |
| rezka | S | T | (native) | FOUND |
| hdvb | S | T | (native) | FOUND |
| rutubemovie | g (503) | T (native) | (native) | M-оптимист |
| kodik | S (200, 5343) | F | (native) | UNRESOLVED |
| geosaitebi | S | T | 1 | FOUND |
| rhsprem | S | T | 16 | FOUND |

**Тёмный рыцарь 2008** (tmdb 155, tt0468569)

| Балансер | E-Online | Maniya show | Maniya items | Class |
|---|---|---|---|---|
| alloha | S | T | 9 | FOUND |
| videoseed | S | T | 12 | FOUND |
| kinopub | G (timeout) | T | 12 | **MANIYA-BETTER** |
| kinoflix | S | T | 3 | FOUND |
| veoveo | S | T | 1 | FOUND |
| pidtor | S | T | 4 | FOUND |
| solntse | S | T | 1 | FOUND |
| filmix | S | T | (native) | FOUND |
| rezka | S | T | (native) | FOUND |
| hdvb | S | T | (native) | FOUND |
| rutubemovie | g (503) | T (native) | (native) | M-оптимист |
| kodik | S (200, 40756) | F | (native) | UNRESOLVED |
| geosaitebi | S | T | 1 | FOUND |
| rhsprem | S | T | 10 | FOUND |

*Дополнительные 4 тайтла parity-probe (Джокер, Бэтмен, Гладиатор 2, Волк с Уолл-стрит) — в matrix не
попали (нет Maniya-столбцов); parity по ним: S почти везде (кроме видеoseed/rutubemovie 503-ghost и
kinopub timeout-ghost) — паттерн идентичен строкам выше.*

### 11.2 Агрегированный итог (11 тайтлов × 14 балансеров)

| Класс | Кол-во (примерно) | Смысл |
|---|---|---|
| FOUND (контент есть, оба показывают) | ~77 + native | цель W1 достигнута: CLUSTER-MISMATCH 2→0 |
| MANIYA-BETTER (E ghost, контент есть) | **9**: kinopub×5 (Ист, Дюна2, Матрица, ТР, ДД), videoseed×3 (Матрица, Дюна2, Скайуокер), geosaitebi×1 (Паразиты) | anti-FN политика + W1-скан РАБОТАЮТ |
| EMPTY/TRANSIENT (E ghost, Maniya INC-show, items 0) | **13** из 15 FP | остаточные «INCONCLUSIVE-show» FP (post-W1 Class A) |
| SEMANTIC-MISMATCH (оба show, items 0 — link-карточки др. фильма) | **2**: Одиссея/geosaitebi, Скайуокер/geosaitebi | content-model (post-W1 Class B) |
| PARSER (оба show, items 0 — сезонные link-карточки) | **1**: ДД/pidtor | parser-depth (Class B) |
| IDENTITY-MISMATCH — Maniya права | **1**: ПД/kinopub («Последний дом слева» 2009) | Maniya корректен, E-Online дал бы FP |
| FN-ОБОИХ (контент есть, оба прячут) | **1**: Аватар/kinopub (7 items) | hide-gate флап (post-W1 residual) |
| UNRESOLVED (E SHOW, Maniya hide; items native не мерились) | **~9**: kodik×8, ПД/kinoflix, ПД/geosaitebi | требует точечной проверки native /videos |
| M-оптимист native (E ghost 503, Maniya native show) | rutubemovie×11, hdvb×2 | native-клиенты независимы (native-availability) |
| OK оба прячут | pidtor×2, rezka, rhsprem×2, kinopub×2 (Скайуокер, Паразиты) | согласие |

### 11.3 Ключевые выводы §11

1. **Финальные FP = 15, но 13 из них — «E-Online-ghost vs Maniya-show»**: E-Online их бы тоже
   скрыл (503/timeout) — то есть Maniya не «показывает то, что E-Online скрыл по содержимому», а
   «показывает оптимистичнее по шуму». Причина — ровно D1 (§6.4): одиночный 503/таймаут не «нет».
2. **2 content-model FP (geosaitebi) — не расхождение с E-Online**: Lampac-предикат и Maniya
   СОВПАДАЮТ (оба show:true на маркере). Расхождение на **parser/identity-уровне** — link-карточки
   чужого фильма дают 0 playable items. Это НЕ исправляется availability.
3. **1 PARSER FP (ДД/pidtor)** — известный Class B parser-depth (сезонные link-карточки).
4. **Аватар/kinopub FN-обоих** — единственный устойчивый FN; hide-gate дал show:false при реальных
   7 items (флап online8). E-Online тоже прячет (timeout). Maniya anti-FN здесь не сработал потому,
   что hide прошёл OLD∩NEW гейт (оба сигнала «нет» в окне флапа).
5. **kodik UNRESOLVED систематически (8/11)** — E-Online показывает kodik на всех тайтлах
   (200+content-marker), Maniya native kodik прячет на большинстве. Требует точечной проверки
   native kodik /videos: если контент есть — FN; если native kodik-api пуст — hide оправдан.

---

## §12. ДEEP-DIVE «Одиссея 2026» — полный путь и почему E-Online показывает/прячет

### 12.1 Полный путь (проверен live)

```
Lampa открыл карточку (tmdb 1368337, tt33764258)
 ├─ Maniya: GET /api/lampa/sources → реестр (16 видимых: 7 native + 9 skaz)
 ├─ Maniya: GET /api/lampa/sources/card → 16 checksearch (parallel, deadline 12с)
 │    elapsed 12 003 мс (дедлайн исчерпан → RULE-4 → INC-оптимист по шумовым)
 │    show:true = filmix(trusted), rutubemovie, hdvb, alloha, videoseed, kinopub(INC),
 │                 kinoflix(INC), veoveo, solntse(INC), geosaitebi
 │    show:false = kodik, rezka, cdnvideohub, collaps, pidtor, rhsprem
 │    pinnedHost: alloha/videoseed/kinopub/veoveo → нода FOUND (пин в pinMap)
 ├─ Пользователь выбрал источник
 ├─ GET /api/lampa/videos?provider=skaz-videoseed → getLite(скан) → 5 items play ✓
 ├─ GET /api/lampa/videos?provider=skaz-veoveo   → getLite → 1 item play ✓
 ├─ GET /api/lampa/videos?provider=skaz-alloha   → getLite → 4 items call ✓
 ├─ GET /api/lampa/videos?provider=skaz-kinopub  → getLite → 0 items (7.5с)
 ├─ GET /api/lampa/videos?provider=skaz-kinoflix → getLite → 0 items (1.6с)
 └─ …остальные skaz → 0 items
```

### 12.2 Почему E-Online показывает/прячет (parity: Одиссея)

| E-Online | Источники | Причина |
|---|---|---|
| SHOW (7) | alloha, videoseed, veoveo, filmix, hdvb, rutubemovie, kodik, geosaitebi | 200 + `data-json=` маркер в checksearch |
| ghost (6) | kinoflix (503), pidtor (200 empty), solntse (503), rezka (accsdb), rhsprem (accsdb), kinopub (timeout) | spanAction не вызван / маркер отсутствует → work=false → show:false ghost на 5 мин |

→ E-Online показывает Одиссею на **8** источниках; из них реальный playable-контент только у
alloha/videoseed/veoveo (по Maniya items); kodik/geosaitebi — маркер без playable-карточек
(geosaitebi: link-карточки 2016/2026 — разных фильмов; kodik: маркер, но native kodik-api в окне
пуст). То есть **сам E-Online на Одиссее тоже показал бы 3 «пустышки»** (kodik, geosaitebi,
+kinopub скрыл).

### 12.3 Почему Maniya отличается

1. **kinopub/kinoflix/solntse (INC, show:true, items 0)** — E-Online их скрыл бы (503/timeout);
   Maniya держит видимыми (D1: одиночный шум ≠ «нет»; дедлайн 12с исчерпан → RULE-4). Для kinopub
   probe2 показал: cs 200 EMPTY 15с + повтор fetch failed — кластер под нагрузкой, НЕ однозначное
   «нет».
2. **geosaitebi (show:true, items 0)** — Maniya совпадает с E-Online (оба SHOW на маркере); items 0
   потому, что link-карточки «ოდისეა» (2026 и 2016) — это навигация к другому фильму; `linkCardMatchesQuery`
   отвергает несовпадение → 0 playable. Content-model (Class B), не availability.
3. **kodik (show:false)** — единственный пункт, где Maniya прячет, а E-Online показал бы.
   UNRESOLVED (§11.3.5).

### 12.4 Итог по Одиссее

- **Реальный результат для пользователя:** 3 источника с items (videoseed 5, veoveo 1, alloha 4) —
  как у E-Online (тоже 3 реальных). Playback: call-item alloha резолвится через `/video` (playback
  PASS по prior-аудитам).
- **Шум (FP):** 4 источника без items (kinopub, kinoflix, solntse, geosaitebi). У E-Online шум был бы
  меньше (скрыл бы 3 из 4 по 503/timeout), НО ценой риска скрыть рабочий источник при флапе
  (Аватар/kinopub: E-Online тоже прячет, и это FN). Это trade-off D1, задокументированный, не баг.
- **Одиссея БЛОКЕР'а не имеет** (подтверждает W1: «Одиссея BLOCKER'а нет»).

---

## §13. ФИНАЛЬНАЯ АРХИТЕКТУРНАЯ МОДЕЛЬ

### 13.1 Модель (подтверждена кодом и live-пробами)

```
                        ┌─────────────────────────────────────────────────────┐
                        │                    SKAZ (upstream)                   │
                        │  Lampac NextGen на online3/online8/oleg6            │
                        │  lite/events · lite/<slug> · checksearch · /video   │
                        │  аккаунт кластера (granted-устройство)              │
                        └───────────────▲─────────────────────────────────────┘
                                        │ REST (account_email+uid, Origin)
                    ┌───────────────────┴────────────────────────────────────┐
                    │                    MANIYA (server)                      │
                    │  registry.js (slug-identity) · config.js (SKAZ_HOSTS)   │
                    │  hostOrder.js (primary-first, online8-last)             │
                    │  availability.js (probe/confirm/OLD∩NEW/pinMap)         │
                    │  SkazClient (W1-скан, continue) · SkazProvider          │
                    │  (cards/items/resolveVideo/resolveStream)               │
                    │  store.js (withPinnedHost) · proxy allowlist            │
                    └───────────────▲─────────────────────────────────────────┘
                                    │ /api/lampa/* (json)
                    ┌───────────────┴─────────────────────────────────────────┐
                    │                   LAMPA (клиент)                        │
                    │  maniya-online.js: show/ghost · фильтры · playback      │
                    └─────────────────────────────────────────────────────────┘

   E-ONLINE / LAMPAC (reference-сборка, Temp/Lampac) — ВНЕ runtime-графа:
   источник доказанных семантик (checkSearch/lifeevents/ghost) и oracle для
   сравнения (e2e-skaz-vs-eo). Никакой runtime-зависимости.
```

### 13.2 Постулаты (каждый подтверждён §1-§12)

| Постулат | Подтверждение |
|---|---|
| SKAZ = единственный upstream | все Maniya-вызовы идут напрямую в online3/online8 (live-пробы), auth = свои creds кластера |
| E-ONLINE/LAMPAC = reference | канонические семантики доказаны по `OnlineApi.cs`/`Http.cs`/`plugin.js` Temp-сборки; кластер skaz = тот же Lampac NextGen |
| LAMPA = клиент-презентация | show/ghost, фильтры stype, ленивый резолв call-карточек |
| MANIYA = воспроизведение семантики E-Online над своим бэкендом | предикат checkSearch = «EXACT Lampac» (паритет), идентичность = slug, кластер-ротация своя (hostOrder+pin), availability своя с OLD∩NEW, parser/videos/playback свои |
| Никакой runtime-зависимости от E-Online | EoProvider/EoClient — только для сравнения; `EO_*` env — фолбэк; «если E-Online исчезнет завтра» → теряем только oracle |

### 13.3 Формулировка (против исходного задания)

Задание: «SKAZ=upstream, E-ONLINE=canonical orchestration reference, LAMPA=client presentation,
MANIYA=reproduce E-Online semantics over own backend». **Код и пробы подтверждают формулировку
полностью, с одним уточнением:** «E-Online» как отдельный оркестратор на кластере — это **тот же
самый Lampac** (online3.skaz.tv отвечает каноническими `lite/events`). Поэтому «каноническая
семантика E-Online» = «семантика Lampac-семейства», и Maniya воспроизводит её напрямую против
кластера. Никакого отдельного оркестратора в рантайме нет и не требуется. **Изменение модели не
нужно.**

### 13.4 Независимость: чек-лист приёмки

- [x] Maniya ходит в кластер напрямую (SKAZ_HOSTS, не через E-Online)
- [x] registry/identity — свои (slug-базовые), не берутся из E-Online API
- [x] account/uid — свои creds кластера, не E-Online-аккаунт
- [x] cluster-выбор/ротация — свои (hostOrder/scan/pin), не overridehost E-Online
- [x] availability — свои probe/confirm (предикат = канон, порог = свой anti-FN)
- [x] parser/videos/playback — свои клиенты (SkazClient/SkazProvider)
- [x] display names — свои (PROVIDER_META/EO_TITLES), identity = slug
- [x] E-Online исчезнет завтра → Maniya работает; потеря = oracle сравнения

---

## §14. ЧТО МЫ НЕ ДЕЛАЕМ (границы)

1. **Код/тесты/commit/push/deploy НЕ меняем** — аудит READ-ONLY.
2. **W1 (hostOrder/_scanLite/pin), STABILITY-004 (orphan), GAP-002, GAP-005, VEO-015, GAP-012,
   ONLINE8-002 (abstain) НЕ откатываем** — все prod-verified, регрессий нет.
3. **Не вводим провайдер-специфичные хакдэмы** (хаки под конкретный slug) — только общие
   семантические правила.
4. **Display name НЕ идентичность** (§4) — не переименовываем контент по чужому имени.
5. **Collaps не смешиваем** с skaz-идентичностью (§9) — отдельная native-ветка.
6. **RCH-модули не добавляем** автоматически (§8) — только доказанный REST-контракт.
7. **E-Online в рантайм не вводим** — reference/oracle только (§0.1, §13).
8. **W2 автоматически не предлагаем** — сначала финал этого аудита; решение за пользователем.
9. **Не «чиним» то, что E-Online не считает дефектом**: kinopub/Форрест cs=200/plain=503 — флап
   кластера, не дефект кода; kodik 0 items (Интерстеллар) = upstream-данные.
10. **Политику hide не меняем** без решения пользователя (D1 — осознанный anti-FN trade-off).

---

## §15. ITOG — A-K

### A. Что E-Online (канон Lampac) делает ТОЧНО
1. При открытии карточки гоняет **checksearch по ВСЕМ зарегистрированным модулям** параллельно
   (таймаут 10с каждый, единый 5-мин кэш на карточку, ключ = FNV-1a(checkOnlineSearch:id+serial+
   source+online.Count+uid)).
2. Вердикт **один сигнал на источник**: `work = rch || data-json= || type:movie|episode|season`.
   - 200 + маркер → show:true (источник виден);
   - 200 пусто/`null`/`disable`, 403, 404, 422, 429, 5xx, timeout, network → **show:false ghost**
     (источник остаётся в списке скрытым на 5 мин). Исключение (OMITTED) практически недостижимо.
3. Отдаёт клиенту массив всех источников с show-флагами (`lite/events` ветка B / lifeevents); клиент
   рисует show:true и ghost-прячет show:false.
4. При «все show:false» → accsdb-объект «Не удалось найти онлайн» (часто из-за неполных externalids).
5. `lite/events` без карточки = статический реестр (ветка A), без show.
6. После выбора: `lite/<slug>` HTML-карточки (play/call/link) → список; call → `lite/<slug>/video`;
   serial → сезоны/эпизоды; playback = HLS/MP4 (Origin для подписанных).

### B. Что Skaz предоставляет ТОЧНО
1. **Кластер = Lampac NextGen** на online3/online8/oleg6 + IP-запасные; реестр 32 модулей
   (`lite/events`), поисковые 34 (`lite/withsearch`).
2. **REST-контракт тот же, что у канона**: `lite/<slug>` HTML, checksearch=true, `/video`, сезоны.
3. **Топология**: online3 = primary (все REST-балансеры Maniya), online8 = reserve/легаси
   (kinopub + rch-блок; 403 `disable` для не-kinopub), oleg6 = одиночный (lumina).
4. **Авторизация**: account_email+uid в URL (granted-устройства), accsdb-отказы,
   «ожидаем фильм в хорошем качестве» = content-«нет».
5. **Нестабильность**: kinopub-класс флапает (cs≠plain противоположные в одном окне — §5.3),
   под нагрузкой 503/timeout/EMPTY; однократный сигнал недостоверен.

### C. Что является собственной логикой E-Online
1. Односигнальный show-вердикт + 5-мин ghost (нет повторного замера).
2. Резолв externalids (imdb/kp↔tmdb) — влияет на work у балансеров без id.
3. Сортировка `work desc, index asc`; единый memkey-поллинг; accsdb-заглушка.
4. (В Temp-сборке) RCH-поддержка httpHydra для REST→RCH-модулей.

### D. Что Maniya делает СЕЙЧАС
1. Реестр/identity по slug (`skaz-<balancer>`), свои display names; native-клиенты там, где есть
   (filmix, kodik, rezka, alloha, rutubemovie, cdnvideohub, collaps, hdvb).
2. Availability = per-card checksearch с **предикатом, эквивалентным канону** («EXACT Lampac»),
   но с hardened-порогом: 503/таймаут/accsdb-учётка ≠ «нет» (INC); hide ТОЛЬКО после OLD∩NEW
   (checksearch «нет» + прямой lite-page «нет», retry 500мс×2); hide кэш 60с, self-heal.
3. Кластер: orderedSkazHosts (online8 последним) + W1 continue-скан + pin «карточка→/videos»
   (по uid), single-flight.
4. Парсер: play/call/link, linkCardMatchesQuery (отсекает карточки чужого фильма), сезоны через
   openSeasonPage, call → resolveVideoJson/resolveStream; nav-кэш 5 мин; proxy allowlist.
5. Native-клиенты: filmix trusted (всегда show), остальные native — twin checksearch или nativeProbe.

### E. Все реальные расхождения (E-Online vs Maniya)
| Расхождение | Суть | Направление |
|---|---|---|
| D1 | одиночный 503/timeout/5xx: E → hide-ghost 5 мин; M → show (INC) или hide после OLD∩NEW на 60с | осознанное (anti-FN) |
| D2 | 403 `disable` от online8 (не-kinopub): E → ghost; M → abstain (показ) | осознанное (ONLINE8-002) |
| D3 | accsdb «Войдите в аккаунт»: E → ghost; M → нет вердикта (показ) | осознанное |
| D4 | hide-кэш: E 5 мин/1 сигнал; M 60с/2 сигнала | осознанное |
| D5 | externalids-зависимость: E завязан на резолв id; M резолвит из карточки сам | структурное |
| D6 | native-клиенты Maniya (filmix/kodik/rezka/rutubemovie/...) — своя семантика, не 1:1 с кластерным `lite/<slug>` | архитектурное (native ≠ skaz-твин) |
| D7 | Множественные E-Online «SHOW» при 0 playable items (kodik/geosaitebi на Одиссее) — сам канон не защищён от пустышек | поведенческое (не Maniya-дефект) |

### F. Расхождения, УЖЕ закрытые W1/VEO/GAP/STABILITY
1. **CLUSTER-MISMATCH** (host-выбор availability ≠ SkazClient) → W1: orderedSkazHosts + continue-скан
   + pin. Паразиты/kinopub FP и Одиссея/collaps FN исчезли (CLUSTER-MISMATCH 2→0).
2. **hide на одиночном 503 на 5 мин** → OLD∩NEW + HIDE_TTL_MS=60с (STABILITY-002/005-C).
3. **orphan-promise (422 → unhandledRejection → краш)** → STABILITY-004.
4. **veoveo title/quality + `#EXT-X-MEDIA` аудио 404** → VEO-015.
5. **veoveo 403 (SSRF-allowlist)** → GAP-012 (mvapspdmpg.com).
6. **kinopub link-карточки чужого фильма** → BALANCER-KINOPUB-004 (linkCardMatchesQuery).
7. **online8-шум для не-kinopub** → ONLINE8-002 (abstain).
8. **GAP-005 kinopub FN** (составной title «RU/EN») → фикс normalizeTitle (2014===2014).

### G. Расхождения, которые ОСТАЮТСЯ (реальные, НЕ закрытые)
1. **13 INCONCLUSIVE-show FP** (post-W1 Class A): kinopub/kinoflix/solntse/videoseed показывают при
   реальном отсутствии контента (E-Online их бы скрыл по 503/timeout). Цена anti-FN политики.
2. **2 content-model FP** (geosaitebi: Одиссея, Скайуокер) — link-карточки др. фильма; совпадает с
   E-Online (оба show), 0 playable.
3. **1 PARSER FP** (ДД/pidtor) — сезонные link-карточки не раскрываются в items.
4. **1 FN-обоих** (Аватар/kinopub, 7 items скрыты) — hide-gate флап.
5. **kodik UNRESOLVED (8/11)** — E-Online SHOW vs Maniya hide (native).
6. **kinopub/Одиссея UNABLE** — кластер отвечает EMPTY 15с/сбой; не «нет», но и не контент.

### H. Что вызывает проблемы «Одиссеи» (конкретно)
1. Реального playable-контента на кластере всего у 3 источников (videoseed/veoveo/alloha);
   остальные — маркеры/пусто/флап.
2. Maniya INC-оптимист держит kinopub/kinoflix/solntse видимыми (D1): их кластер отвечает
   EMPTY/timeout/503, но одиночный шум ≠ «нет» → пользователь видит «пустышки».
3. geosaitebi — общий с E-Online FP на маркере (link-карточки чужого фильма); не availability.
4. БЛОКЕР'а нет: 3 источника с items + playback работают (как и у E-Online).

### I. Что вызывает FP/FN
- **FP (show:true, items 0):**
  - (a) INC-оптимизм по одиночному 503/timeout/EMPTY (D1) — 13 шт;
  - (b) Lampac-предикат «маркер = показ» на link-карточках чужого фильма (geosaitebi) — 2 шт,
    Maniya НЕ прячет их, т.к. availability должна совпадать с каноном (иначе E-Online-расхождение
    по show); правильно бы прятать/не показывать на parser-уровне (но это уже не availability);
  - (c) parser-depth (ДД/pidtor) — 1 шт.
- **FN (контент есть, но скрыт):** hide-gate при флапе online8 (Аватар/kinopub): оба сигнала «нет»
  в узком окне при реальном контенте; HIDE_TTL 60с → self-heal, но в этот момент источник скрыт.
- **Оба случая НЕ являются расхождением с E-Online-показом в 13/16 FP** (E их бы тоже скрыл) —
  это «разница порога», а не «разница контента».

### J. Какой должна быть финальная архитектура Maniya
1. **Как есть (§13)**: SKAZ upstream, LAMPA client, E-ONLINE reference/oracle вне runtime, Maniya —
   полная независимая репродукция семантики Lampac над своим бэкендом. Модель подтверждена —
   менять не нужно.
2. Цель «E-Online result == Maniya result по identity + availability + source selection + playback»
   **уже достигнута в смысле контента**: все реальные источники с items показываются у Maniya
   (foundCount 77, MANIYA-BETTER 9, расхождение в «пустышках» и пороге скрытия — осознанные).
3. Остаточные улучшения — НЕ архитектурные: (а) решить судьбу 13 INC-show FP
   (снижать INC-оптимизм при устойчивом EMPTY? — политическое решение, НЕ код по умолчанию);
   (б) parser-level «показ без items» для link-карточек (geosaitebi/pidtor) — отдельная тема;
   (в) проверить kodik-дивергенцию (native vs кластер) точечно.
4. Инвариант независимости: каждый компонент (registry/identity/cluster/availability/parser/videos/
   playback) должен оставаться самодостаточным, не требующим E-Online.

### K. Порядок следующих волн (если пользователь решит продолжать — НЕ предлагается автоматически)
1. **Проверка UNRESOLVED** (без кода): native kodik /videos по 8 тайтлам (контент есть → FN;
   пусто → hide оправдан). Точечно ПД/kinoflix, ПД/geosaitebi.
2. **Решение по 13 INC-show FP** (политическое): оставить anti-FN порог (текущее) ИЛИ снизить
   оптимизм при N подряд EMPTY (нужен дизайн, НЕ хак).
3. **Parser-level «link-карточки»**: geosaitebi/pidtor — раскрытие/отсев link-карточек
   (наследие Class B post-W1, дизайн-док нужен).
4. **kinopub-флап**: опционально — повторный checksearch-замер внутри OLD∩NEW с большей паузой
   (уменьшает FN-окно Аватар/kinopub).
5. Вне очереди: RCH-модули — НЕ добавлять (§8); Collaps — отдельная ветка (§9).

---

*Конец аудита. READ-ONLY: код/тесты не менялись, commit/push/deploy не делались. W2 автоматически
не предлагается — решение за пользователем. STOP.*
