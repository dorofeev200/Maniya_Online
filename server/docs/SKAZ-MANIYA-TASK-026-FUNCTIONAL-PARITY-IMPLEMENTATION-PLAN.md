# TASK-SKAZ-MANIYA-026 — FULL FUNCTIONAL PARITY IMPLEMENTATION PLAN

- Дата: 2026-08-23
- Формат: forensic implementation plan. **Ни одного изменения кода/deploy/PROD.** Реализация — только после отдельного подтверждения пользователя.
- Статус фазы 0: **СНЯТА** (точка сохранения ниже). Фазы 1–3: **COMPLETE (на базе T018–T025 + живые захваты 2026-08-23).** Фазы 4–11: evidence + PENDING (юзер-девайс) — явно помечено в каждой секции.
- Финальный статус: **PLAN DELIVERED — HARD STOP. Ожидание подтверждения на реализацию.**

---

## PHASE 0 — ТОЧКА СОХРАНЕНИЯ (СНЯТО)

| Пункт | Значение |
|---|---|
| Git HEAD (репо корень) | `2fd2f5c` (`gap-012-veoveo`), последний коммит пред-релиза |
| Рабочее дерево | **Shadow T021 НЕ закоммичен**: `public/maniya-online.js`, `server/src/index.js`, `registry.js`, `SkazClient.js`, `SkazProvider.js`, `proxy.js`, `store.js` + 4 тест-файла — changes |
| Прод fp | `8fc18753…/76` = Golden T020 (sourceModel НЕ задеплоен) |
| Shadow fp | `4ccf46f0…/78` (T021, sourceModel есть) |
| Backups | `backup` branch remote + `backup*` каталоги; env `.env`/`.env.example` присутствуют |
| Rollback-точка | Прод-дерево T020 (8fc18753) == последний задеплоенный релиз; локально Golden-состояние восстановимо `git checkout` из ветки. **Дополнительно: резервный снимок текущего дерева — `git stash` + `git branch backup/t026-point-20260823` (НЕ выполняется без команды).** |

Вывод: при любом сценарии дальнейшей работы точкой отката остаётся прод `8fc18753/76` (playback подтверждён живьём 2026-08-23) и локальный Golden.

---

## PHASE 1 — SKAZ RUNTIME CONTRACT (COMPLETE, база T025 §1a + живой захват 2026-08-23)

Полная wire-цепочка реального SKAZ-плагина на «Мятеже» (доказана console-capture пользователя):

1. `lite/withsearch` (356B bootstrap; nws-токен НЕ получали — `nws_got:false`)
2. `lite/externalids` → переопределение `kinopoisk_id` карточки: 1288445 → **5582050**
3. `lite/events?life=true&<полный кардсет>` (57B handshake/stub)
4. `lite/lifeevents?memkey=<…>&<та же карточка>` (4362B = полная per-title модель)
5. Клиентские параллельные проверки (follow-волна) `lite/filmix`, `kinoukr`, `remux`, `kinogo`, `kinotochka`
6. Клик источника = **`events.url + ?cardParams + auth + nws_id`**, напр. `lite/filmix?id=1288445…`
7. Resolve → **прямой CDN** (werkecdn MP4) → Player — играет (DVO-ru).

**Per-title триггер**: полный кардсет `id` + `source=tmdb` (иначе кластер отдаёт модульный список index=0/show=true). **events-контракт**: `{name,url,index,show,balanser,rch,voices,seasons}`; ABSENT: id/icon/api_url/quality. `events.url` = голый deep-link `http://online{3|8}.skaz.tv/lite/<module>`.

**PENDING (девайс)**: (a) клик-трассы HDRezka/Alloha/VideoSeed/VeoVeo/RCH конткретно (filmix покрыт), (b) search-флоу сериала со стороны SKAZ (следующий пункт), (c) seek/resume.

---

## PHASE 2 — MANIYA RUNTIME CONTRACT (COMPLETE на Shadow-данных + PROD-захват; живой серверный прогон 2026-08-23)

| Этап | Maniya | SKAZ | Парность |
|---|---|---|---|
| discovery | `/api/lampa/sources` (static-21 PROD / sourceModel Shadow) | withsearch bootstrap | форма ≠; набор ≠ |
| card | `/sources/card` → PROD `{id,show}` 768B / Shadow `{items (index,…),meta.model}` | events?life→lifeevents (29 per-title) | контент **параллелен** (проверено ab2) |
| sources list | runtime model-ветка → чипы name/icon/global | онлайн-модель | name/index/ghost/голоса/сезоны — parity (T024) |
| click | `api_url` = `/videos?provider=<id>` | `events.url`+cardParams | **F1: двухпуть** |
| resolve | наш server → SkazProvider → `/proxy` | плагин→кластер→CDN напрямую | оба играют |

Предмет прок пригоне 2026-08-23 (server-side):
- **Сериял HOD**: search(count=1,type=serial,id=411406) → events(25/10, KinoPub#1, rch=1) → kinopub сезон (10 эпизодов, 3 сезона, 13 голосов) → play-эпизоды через наш proxy. **Serial-цепочка server-side РАБОТАЕТ.**
- **Filmix Mutiny**: `/videos` = 3 play-item, качества 1080p/720p/480p, URL = наш `/proxy?url=<werkecdn>`.
- **Rezka Mutiny**: `lite/rezka` → **503**; `hzdr…` слto 404; `fxapi` → 403; row в events = `show:false`. **Кластер отказывает HDRezka в нашей форме на этой карточке.**

---

## PHASE 3 — FIRST DIVERGENCE MATRIX (F1–F10)

Обозначения: ✅ доказано | ⬜ не доказано | 🟡 частично; «влияет» = меняет видимое пользователю поведение.

| # | Поле/слой | SKAZ | Maniya | Доказано | Влияет | Причина/симптом | Файлы | Мин. исправление |
|---|---|---|---|---|---|---|---|---|
| F1 | **`url` runtime-источника** | `events.url`+cardParams→CDN | `api_url`→`/videos→proxy`→тот же CDN | ✅ (T025 живой capture) | играют оба; путь разный | клиентская model-ветка (`url: row.api_url||row.url`) + route/proxy | `public/maniya-online.js` ~512-557; `server/src/index.js` /videos; `proxy.js` | **НЕ чинить** без нового доказательства, что это ломает пользователя. Оба пути дают Player. |
| F2 | `api_url` поле | ABSENT | present | ✅ | нет | extra-поле | maniya-online.js | опционально убрать из payload |
| F3 | `icon` | ABSENT | `'🎬'` fallback | ✅ | вторично (визуал) | клиентский fallback | maniya-online.js:204 | синхронизировать при F7 |
| F4 | extras-чипы (index=null) | нет | Maniya-only natives | ✅ shadow | допустимо (свой канал) | merge native+skaz | sourceModel.js | сохранить как свойство Maniya |
| F5 | `balanser` | есть | есть (эфемерные) | ✅ | нет | — | ephemeral.js | паритет |
| F6 | request-shape `lite/events` | life=true+nws+memkey | plain (без life) | ✅ §1b | контент паритет ✅ | форма запроса | SkazClient | опц. выровнять форму, контент уже верный |
| F6p | **состав источников PROD** | per-title 29 | **static-21 (PROD!)** | ✅ | **ДА — видимое** (TV: 7/10/19 vs 11/14/24) | prod T020 не имеет sourceModel | только деплой Shadow→prod | **задеплоить T021 (sourceModel)** — НЕ в этой фазе |
| F7 | UI-поля Lampa (ghost/«Ещё N»/dim/active/порядок) | — | — | ✅ parity (T024) | нет | нет | — | НИЧЕГО |
| F8 | **HDRezka (429/пусто)** | прямой werkecdn | `/videos→proxy→werkecdn` | 🟡 server 2026-08-23 + T022 TV | **ДА на девайсе** | см. Phase 4 | выше | wire-comparison → вывод |
| F9 | **Serial поиск** | кластер search | наш search() требует id/imdb/kp: `if (!id && !imdb && !kp && !canon) return []` | 🟡 server OK; девайс-elle НЕ зафиксирован | зависит | search-endpoint/ID-mapping | SkazProvider.js:114 | завинчить после девайс-захвата |
| F10 | Continue Watching | клиентский (Lampa storage) | клиентский | ✅ (SKAZ 404-серверного нет; T021) | нет | нет | — | НИЧЕГО |

**Вывод по F1**: T026 запрещает считать F1 причиной пользовательских проблем до доказательства. Доказательства, что двухпуть ломает playback, **нет** — оба пути играли живьём (T025). Единственное доказанное видимое расхождение — **F6p** (прод static-21) — это уже закрытое на Shadow T021, осталось деплой.

---

## PHASE 4 — HDREZKA 429: WIRE-LEVEL (выполнено server-side 2026-08-23)

### Реальные наблюдения (наши автоматические пробы 2026-08-23, READ-ONLY):

| Проба | Результат |
|---|---|
| `lite/rezka` Mutiny, 3 формы карточки | **503** (все) |
| `lite/{hdrezka,hdreziya,hdego}` | 404 |
| `lite/fxapi` | 403 |
| наш `/videos` для `skaz-rezka` | **0 items**, resolve null, `show:false` в events |
| наш `/videos` для `skaz-filmix` | 3 items (1080p/720p/480p), все `play` |
| werkecdn URL (из filmix, наш `streamProxy`) **прямой GET** — 12 вариаций: bare/Origin/Referer/UA/Range/burst-1..6 | **429 100%** (text/html) |
| после burst — следующие пробы | **виснут** (AbortError таймаута) |

### Интерпретация
1. **HDRezka «не работает» НЕ из-за нашего proxy**: кластер сам отвечает 503/пусто для Rezka в нашей форме (`nws`/life-контекст отсутствует — `nws_got:false`). Это отказ **кластерного** модуля, не Maniya. После реального устройства SKAZ-клик lite/rezka должен передать `nws_id` из life-сессии — контраст wire-level с нашим plain-путем — **PENDING (устройство)**.
2. **429 = property CDN-а/edge, не наших заголовков** (доказано: все 12 комбинаций → 429). Подписанный одноразовый путь `/s/FHQS-…` + IP/rate-limit на egress → «Too Many Requests». Не считать «429=проблема провайдера», но и НЕ сказать, что это наша вина по заголовкам: **оба провода дают 429 из наших egress**, а живой Player через SKAZ-NOT-проверен на этих же URL.
3. Контрольный факт: тот же werkecdn **играл** у пользователя (T025, прямые URL из кластер-STREAM в браузере, DVO-ru). Значит дело не в самом домене, а в том, как ото URL получен (one-time signature / binding) и откуда (IP egress).

### Что нужно закрыть (PENDING, устройство)
- Одновременный живой думп: для одной карточки и одного источника — (a) URL, который SKAZ-плагин передал Player-у, и (b) URL, который наш `/videos`+`/proxy` передали Player-у на **том же** CDN — сеть + ответы (status/content-type/length/headers) на каждый. Запуск: DevTools Lampa (lampa.mx), обе плагины, один фильм. Харнесс: снипет из T025 §26 (уже у пользователя) + запрос Network-ответов `*werkecdn*` и `*proxy*`.

---

## PHASE 5 — SERIAL P0 (выполнено server-side 2026-08-23)

Живой прогон **«Дом Дракона»** (serial=1):

| Step | Результат |
|---|---|
| `search({query})` | 1 запись, type=serial, id=411406 |
| `getOnline` (то, что ест sourceModel) | 25 rows / 10 shown, KinoPub первый, rch=1 |
| `videos` kinopub | 10 эпизодов (play), 3 сезона, 13 голосов, proxy-URL |
| resolve call-эпизода | (нет call — kinopub play; alloha/videoseed call-покрыт кодом `serialVideos`/`resolveSerialVideo`) |

**Вывод: серверная сериальная цепочка РАБОТАЕТ.** Кандидаты на реальный девайс-сбой «For Serial ничего не находит»:
- [A] **search-гейт** `SkazProvider.js:114` — `if (!id && !imdb_id && !kinopoisk_id && !canon) return []`. Если Lampa шлёт search-запрос сериала без id (только title+serial), запрос молча пуст. Наш `search()` НЕ использует title fallback. **Гипотеза-кандидат.**
- [B] ID-mapping: если Lampa передаёт `tmdb_id` и `serial=1`, но без `id/imdb/kp` — тоже пусто (см. [A]).
- [C] На девайсе старый PROD (static-21) может иметь другой `{id,show}` для сериалов → чипы есть, с klik пусто. F6p-связанный.

Закрытие: живой поиск сериала в Maniya-плане против SKAZ-плана (оба Lampa, lampa.mx) — сети `search`/`/videos`/`card` ответов для одного сериала + клик-трасса эпизод→play. **PENDING (устройство).**

---

## PHASE 6 — WITHSEARCH 34 SLUG (классификация выполнена — evidence читается)

`lite/withsearch` (200, 337ms, 356B) = массив **34** слагов. Категоризация по назначению (Lampac/кластер semantics + наши пробы):

| Категория | Слаги | Назначение | В Maniya |
|---|---|---|---|
| **rc/rescatcher (RCH-слой)** | `rc/filmix`, `rc/fxapi`, `rc/rhs` | RCH-резолверы для sub-модулей | НЕ добавлять как отдельные чипы (rtе слой, а не источник) |
| **kinopoisk-платформы** | `kinopub`, `kinobase`, `kinoukr`, `kinotochka`, `redheadsound` | источник (кинотеатры) | kinopub/kinotochka есть; kinobase/kinoukr/redheadsound — потенциально новые |
| **фильмы-агрегаторы** | `filmix`, `filmixtv`, `fxapi`, `vdbmovies`, `vcdn`, `videocdn`, `hdvb`, `remux`, `lumex`(×2), `kodik`, `rezka`, `rhsprem`, `collaps`(+`-dash`), `alloha`, `veoveo`, `rutubemovie`, `vkmovie`, `zetflixdb` | источник (CSS) | большинство есть; filmixtv нет (native-каналов) |
| **аниме** | `animevost`, `animego`, `animedia`, `animebesst`, `anilibria`, `aniliberty`, `animelib` | источник (аниме) | НЕТ — аниме-канал вне области текущего accept |
| **torrent** | `pidtor` | torrent-дескриптор | вне (torrent не играем) |

**Правило (T026): не добавлять источник ТОЛЬКО по наличию slug.** Каждый новый slug — только если доказан поиск/карточка/playback (по контракту Phase 1). B настоящий момент кандидаты для **дальнейшего исследования**: kinobase/kinoukr/redheadsound (кинотеатры RU) — проверка per-title на реальных карточках (PENDING живые пробы на паре фильмов).

---

## PHASE 7 — UI / ДИЗАЙН (COMPLETE — parity)

Доказано (T024): ghost ⇔ opacity .5 (Lampa app.js:2327), «Ещё N» = items-line__more, порядок/active/голоса/сезоны — **полная parity**. Единственные видимые отличия: icon-fallback `'🎬'` (клиентский, вторично) и extras-чипы (наш дополнительный канал). **UI CSS не править. На стороне клиентского runtime-кода — только при F7-решении изменить падение иконки/добавить отсутствующие поля (опционально).**

---

## PHASE 8 — CONTINUE WATCHING (COMPLETE — parity)

SKAZ: серверного continue-watching нет (T021: 404), позиция хранится на клиенте (Lampa storage, историчность + resume через Lampa). Maniya — ровно так же (клиентский). Писать серверную систему НЕ нужно. Resume-ключи: Lampa Standard `storage` (сессии) — не дублировать. **PENDING**: один живой тест resume на устройстве (start→exit→reopen→видео продолжает с позиции) в обоих плагинах — подтверждение (девайс).

---

## PHASE 9 — АРХИТЕКТУРНЫЙ ВЫБОР (по секциям, на основании матрицы)

| Участок | Вариант | Факты | Рекомендация |
|---|---|---|---|
| Источники (список) | A сохранить native / B SKAZ-адаптер | F6p — единственное доказанное видимое расхождение | **A** (сейчас) + довести T021 sourceModel до prod (деплой отдельной командой) |
| Клик→playback | C прямой events.url / D /videos wire-compatible | F1 не доказан как причина сбоя; оба пути играют | **D** (оставить /videos+proxy как есть; прокси даёт SSRF-защиту и cookie/header-контроль) |
| HDRezka | E переписать резолвер | Phase 4: 503 на кластере — не наш код | **не менять** до wire-думпа устройства |
| Сериалы | — | Phase 5 server OK; search-гейт [A] кандидат | точечный фикс search-title-fallback — ПОСЛЕ девайс-захвата |
| RCH | сохранить SkazRchClient | живой RCH работал раньше (ashdi HLS) | без изменений |
| Внешние интерфейсы | api_url = эквивалент | поддержка клиентов | сохранить |

---

## PHASE 10 — IMPLEMENTATION PLAN (FILE / CURRENT / CHANGE / WHY / RISK / TEST)

**Реализация НЕ выполняется до отдельного подтверждения.** План ниже — кандидатный, в порядке приоритетов.

| # | FILE | CURRENT | CHANGE | WHY | RISK | TEST |
|---|---|---|---|---|---|---|
| 10.1 | `server/src/providers/skaz/SkazProvider.js` (:114) | `search()` пуст если нет id/imdb/kp | **Добавить title-fallback**: при пустых id — серч via title+serial (как Lampa шлёт) | Кандидат A Phase 5 (не находится сериал без id) | может дать дубль-записи; re-контроль canonicalId | unit: search с {title,serial} → 1 запись |
| 10.2 | `public/maniya-online.js` (:204, :530) | fallback иконки '🎬'; дублирующий api_url | (опц) sync payload к SKAZ (иконка=extras, убрать api_url из source-объекта, оставить в meta) | F2/F3 | регресс клиента | plugin-contract тесты — обновить ожидания |
| 10.3 | `/sources/card` payload (index.js+sourceModel) | Shadow уже model | ничего (готово); prod = деплой T021 | F6p | отдельная команда | — |
| 10.4 | сорт/голоса/сезоны | server-side ok | ничего | — | — | — |
| 10.5 | (после P4 wire-duмп) | /videos rezka 503 | возможность: nws-сессия для резолверов rezka (rc/filmix-паттерн) | F8 | внешний контракт кластера | live-test на Mutiny |
| 10.6 | (после сериал-думп) | — | решить по факту | F9 | — | — |

---

## PHASE 11 — ACCEPTANCE MATRIX (реальные сценарии, PASS = реальный Player playback)

| Сценарий | Источник | SEARCH | CARD | SOURCE LIST | SOURCE CLICK → PLAYBACK | SEEK | RESUME | Статус |
|---|---|---|---|---|---|---|---|---|
| Мятеж (2026) | KinoPub | ✅ | ✅ | ✅ | ✅ (T025, реальный Player) | ⬜ | ⬜ | PASS-частично |
| Мятеж | Filmix | ✅ | ✅ | ✅ | ✅ (T025: MP4 MVO, реальный Player) | ⬜ | ⬜ | PASS-частично |
| Мятеж | HDRezka | ⬜ (503) | ✅ | `show:false` | ⬜ | — | — | **ОТКРЫТО (P4)** |
| История игрушек 5 | alloha/videoseed | ✅ | ✅ | ✅ | ⬜ | — | — | сервер-паритет ok; девайс ⬜ |
| Интерстеллар | filmix (2160p/T20) | ✅ | ✅ | ✅ | ⬜ | — | — | девайс ⬜ |
| Дом Дракона (сериал) | kinopub | ✅ | ✅ | ✅ (3 сезона) | ✅ server resolve | ⬜ | ⬜ | девайс-клик ⬜ |
| Другие сериал | alloha (call) | ✅ | ✅ | ✅ | ⬜ resolve-server ok | ⬜ | ⬜ | девайс ⬜ |
| RCH-канал | kinopub RCH | ✅ | ✅ | ✅ | ✅ (живой RCH раньше) | ⬜ | ⬜ | ✓ пред-данные |
| Continue Watching | любой | — | — | — | — | — | ⬜ | PENDING девайс |

PASS засчитывается только при реальном Player: selected→start→картинка/звук→seek→продолжение. Пункты «девайс ⬜» закрываются живыми прогонами пользователя (lampa.mx, обе плагины).

---

## FINAL RESULT (9 пунктов)

1. **FULL FIRST-DIVERGENCE MATRIX** — см. Phase 3, F1–F10. Доказанные расхождения: F1 (двухпуть, играет), F2/F3 (поле/иконка, вторично), F4 (extras, свой канал), F6p (прод static-21 vs per-title-29 — **единственное видимое**), F8 (HDRezka 503 на кластере + 429 на CDN — открыто), F9 (serial search — кандидат [A]).
2. **ROOT CAUSES** — (i) прод не получил T021 sourceModel (F6p); (ii) HDRezka-кластер отдаёт 503 в нашей без-life форме + one-time werkecdn-URL 429 на наш egress (P4); (iii) search-гейт provider может молча пустовать на сериалах без id (F9-кандидат).
3. **WHAT IS ALREADY CORRECT** — ghost/«Ещё N»/dim/порядок/active/голоса/сезоны (T024); serial-цепочка server-side (P5, live); filmix/KinoPub real playback (T025); continue-watching клиентский (P8); RCH-слой (живой).
4. **WHAT IS WRONG** — прод static-21 (F6p); HDRezka 429/пусто (F8 открыт); потенциальный search-гейт сериалов без id (F9-кандидат; НЕ подтверждён на устройстве).
5. **WHAT MUST BE CHANGED** — довести до деплоя T021 (F6p) отдельной командой; по wire-думпу: резолвер HDRezka через nws-сессию; при подтверждении — search-title-fallback для сериалов.
6. **WHAT MUST NOT BE CHANGED** — UI CSS; клиентский continue-watching; пункт F1 (двухпуть) до доказательства вреда; рабочие провайдеры filmix/kinopub/alloha/videoseed при отсутствии доказанного FIRST DIVERGENCE; RCH-слой; прод-инфраструктура (DNS/.env/nginx/Telegram).
7. **EXACT FILE PLAN** — Phase 10 (10.1–10.6). Первый пункт для реализации после подтверждения: **10.1 search-title-fallback** + деплой T021 отдельной командой.
8. **TEST PLAN** — unit (search fallback, sourceModel fixtures), plugin-contract (обновить ожидания при 10.2), live (P4 wire-duмп, P5 сериал-думп, P8 resume) на lampa.mx обе плагины; регресс suite `cd server && NODE_ENV=test node --test` (текущий: 763/756/1/6 Golden).
9. **ROLLBACK PLAN** — прод Golden `8fc18753/76` (deploy-точка); локальный Golden recover `git checkout`; перед деплоем — полный backup снимок (в `.fpg-shadow`, backup-ветка); откат = re-deploy старый бандл. Ничего из этого не выполняется без отдельной команды.

---

## HARD STOP

Никакого кода не изменено, деплоя нет, PROD не тронут (фаза 0 — только чтение). Подтверждение пользователя на реализацию — обязательно. Ожидание: девайс-думпы P4 (HDRezka wire), P5 (сериал ральные клики), P8 (resume) — основной блокер для финальных решений по F8/F9.

Артефакты: `server/docs/t026/serial-chain.json`, `hdrezka-wire.json`, `filmix-wire.json`, `werkecdn-body.json` (read-only пробы 2026-08-23); `scripts/_t026_serial.mjs`, `_t026_hdrezka.mjs`, `_t026_rezka_probe.mjs`, `_t026_filmix_429.mjs`, `_t026_werkecdn_body.mjs`, `_t026_429_headers.mjs`.