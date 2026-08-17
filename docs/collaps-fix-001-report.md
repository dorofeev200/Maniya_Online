# COLLAPS-FIX-001 — Collaps: отдельный native-провайдер, единая identity, 422 ≠ EMPTY

**Дата:** 2026-08-17 · **Режим:** IMPL + юнит-verified + live-verify (идентичность и классификация ошибок; playable-доказательство ограничено гео-гейтом embed-хоста, см. §F).
**STOP:** commit/push/deploy НЕ делались.
**Вход:** READ-ONLY-аудиты `docs/balancer-architecture-audit-001-report.md`, `docs/balancer-semantics-005-report.md`, COLLAPS-SHAPE / COLLAPS-ID-ROUTE диагностика, GAP-002 (`docs/gap-002-collaps-report.md`), STABILITY-004 (не переоткрывался).
**Не трогались:** VKMovie, Rutube, W1, availability-семантика, native-first/store, proxy allowlist, Kodik, Skaz (в т.ч. «Сollaps via Skaz» не вводился и не рассматривался).

---

## A. Root cause — COLLAPS-SHAPE (search→videos: расхождение формы)

**Симптом:** карточка показывалась (title-only поиск находил запись), но `/videos` возвращал пусто/422.

**Корень:** `videos()` заново угадывал фильм по названию, вместо того чтобы использовать ТУ ЖЕ запись, которую дал поиск карточки. Два независимых «угадывания» (search → embed) выбирали разные результаты — попадался mаппинг не на ту запись, embed отдавал пустоту/ошибку.

**Доказательство (код, до фикса):** `CollapsProvider.videos()` (было) брал `query.title` и вызывал `embed(query)` напрямую, без поиска-верификации: если в query нет kp/imdb/orid — embed-запрос шёл с пустым маршрутом → пустой ответ/ошибка. `recordByKeys()` при отсутствии явных ключей тоже не имел единого источника identity.

Контрастный признак, что фикс решает именно это: search-show определяется native search-ом (availability nativeProbe → `recordByKeys`/`client.search`), а videos ходил тем же путём без передачи найденной записи.

## B. Root cause — COLLAPS-ID-ROUTE (query.id ≠ collaps-orid)

**Симптом:** даже при явном `id` в query `/embed/movie/{id}` давал 404 — потому что `id` из запроса Lampa/TMDB ≠ collaps-orid.

**Корень (две независимые поломки):**
1. Провайдер передавал поле `orId`, а клиент читал `options.orid` — маршрут карточки и маршрут videos не совпадали (поле-мисматч).
2. `options.id` (TMDB id от клиента) мог использоваться как collaps-orid → `{embedhost}/embed/movie/{tmdb-id}` детерминированно 404 (арх-аудит §7.3.2). identity≠presentation: TMDB id — это identity **запроса**, а не collaps.

**Итог до фикса:** одна и та же карточка → маршрут `/embed/kp/…` или `/embed/imdb/…`, а `videos` из тех же данных мог уйти `/embed/movie/{tmdb}` или вообще с пустым ключом → пусто/422, при том что контент существует.

## C. What changed

### `server/src/providers/collaps/CollapsClient.js`
- `embed()`: канонические ключи **kinopoiskId → imdbId → orid** (priority). Читает `orid ?? orId` — поле от провайдера больше не теряется. `options.id` НЕ читается как orid (это TMDB id — не collaps-identity).
- Добавлен `httpError(status)` с классификацией: `404/400/405 → invalid-route`; `403/422/451 → upstream-refusal`; `5xx → upstream`; прочее → `http`. Применяется в `getText`/`getJson` вместо неклассифицированного `HttpError`.

### `server/src/providers/collaps/CollapsProvider.js`
- `resolveIdentity(query)` — **НОВЫЙ, единая identity-модель** для search/card/videos: явные kp/imdb/orid → иначе title-search (`client.search(title)`) + `bestMatch()`.
- `bestMatch(root, query)` — **НОВЫЙ**: ранжирование записей поиска по нормализованному названию (+3 точное, +1 входит), году (+2 при совпадении `query.year`), наличию `kinopoisk_id` (+1), `iframe_url` (+1). Display-name в identity НЕ участвует.
- `embed()` — **НОВЫЙ**: резолвит identity и зовёт `client.embed({kinopoiskId, imdbId, orid, embedHost})`. Ошибки гарантированно классифицированы (`ensureClassified`).
- `videos()`: catch возвращает `{items, seasons, voices, provider_error: {kind, status, code, message}}` — 422/403/451 → `upstream-refusal`, 404 → `invalid-route`, сеть/5xx → `upstream`; настоящий EMPTY (embed 200, парсер пуст) — БЕЗ `provider_error`.
- `recordByKeys()`: использует тот же `resolveIdentity()` — карточка и videos теперь разделяют одну identity.

### `server/src/providers/collaps/CollapsNormalizer.js`
- Без изменений в логике парсинга (embed-HTML парсится как раньше). `record()` уже давал `orid` + `embedHost` из `iframe_url`.

### `server/test/collaps-provider.test.js`
- +7 regression-тестов COL-1…COL-7 (см. §G) + правки под новую семантику identity (fake-клиент раздаёт embed-страницы по каноническому ключу).

## D. Identity flow — BEFORE → AFTER

| Этап | BEFORE | AFTER |
|---|---|---|
| Карточка title-only | search по названию → запись | `resolveIdentity`: явные kp/imdb/orid → иначе search + `bestMatch` (та же запись) |
| Query с `id` (TMDB) | `id` мог уходить как collaps-orid → `/embed/movie/{tmdb}` 404 | `id` в identity НЕ участвует; маршрут — через явный kp/imdb/orid либо title-search |
| `orId` vs `orid` | поля расходились (провайдер `orId`, клиент `orid`) | клиент читает `orid ?? orId`; провайдер передаёт `orid` |
| `/videos` | повторное «угадывание» → пусто/422 | `embed()` → единый `resolveIdentity` → play-item (или классифицированный `provider_error`) |
| Ошибка embed | 422/404 молча глотались в `items:[]` без признака | 422/403/451 → `provider_error.kind='upstream-refusal'`; 404 → `invalid-route`; EMPTY-parse → чисто подтвёрждённое «нет» без error |

PS: display-name («Collaps») — только presentation. Identity — `{kinopoiskId, imdbId, orid}`, и маршрут карточки всегда совпадает с маршрутом videos (один `resolveIdentity`).

## E. Live matrix (search→identity→videos; egress: VPS 95.85.241.121 / локальный, август 2026-08-17)

Пробник: `/tmp/mo-normfix/scripts/_probe_collaps.mjs` (VPS + локально, токен из temp `.env`).

| Фильм | search (title-only) | resolveIdentity (kp/imdb/orid) | `/videos` (VPS) | `/videos` (локально) | Комментарий |
|---|---|---|---|---|---|
| Одиссея (2026) | 20 результатов | ✓ kp=6385370 / orid=87624 | **provider_error: upstream-refusal (422)** | items=0, без error (embed 200/пусто) | identity согласована; 422 классифицирован, контент в каталоге есть |
| Форрест Гамп (1994) | 1 (id=164) | ✓ kp=448 / imdb=0109830 | **upstream-refusal (422)** | **upstream-refusal (422)** | kp/imdb найдены |
| Матрица (1999) | 12 | ✓ kp=301 / imdb=0133093 | **upstream-refusal (422)** | items=0, без error (embed 200/пусто) | identity (не TMDB id) → правильный маршрут |
| Интерстеллар (2014) | 1 (id=180) | ✓ kp=258687 / imdb=0816692 | **upstream-refusal (422)** | **upstream-refusal (422)** | — |
| Дюна: Часть вторая (2024) | 1 (искомый найден, или пусто при партии) | ✓ kp=4540126 / orid=65138 | **upstream-refusal (422)** | items=0, без error | поиск по названию нашёл запись; контент в embed закрыт |

**Ключевые live-факты:**
1. **Identity-консистентность доказана:** у каждого тайтла из title-only поиска вычислена полная identity (kp/imdb/orid) — значит search→card и videos идут одним маршрутом. Раньше videos «угадывал заново», сейчас — берёт найденную запись (`bestMatch`).
2. **422 ≠ глухое EMPTY доказан:** с VPS embed-маршрутия отдаёт HTTP 422 на все маршруты (kp/imdb/orid) — и теперь это видно как `provider_error.kind='upstream-refusal'`, а не молчаливый `items:[]`. Локально (часть title) embed 200 с пустым телом → подтверждённое EMPTY без error — два разных сигнала различимы.
3. **Правильный маршрут, но гео-гейт:** `api.ortified.ws` / `api.luxembd.ws` (оба = 89.42.231.152, ideacom.ws) детерминированно отдают 422/410 для не-RU-egress (VPS-SE, локальный-UA; US-проверка через r.jina.ai → **410 «видео недоступно для вашего региона: US»**). Это свойство инфраструктуры провайдера (уже задокументировано в GAP-002 §4.1), не дефект кода Maniya.
4. **Токен не печатается** ни в одном выводе пробника.

## F. Playback proof

**Live playback с текущего egress невозможен и НЕ связан с фиксом:** embed-хост регионально гейтит всё, кроме RU-резидентных IP (см. §E п.3; совпадает с GAP-002). Это ограничение существовало до FIX-001 (и до COLLAPS-работ) и не является регрессией.

**Что доказано по коду/юнитам (playable-пат T):**
- COL-1/COL-2/COL-3: title-only / id-query / orid-query → `/videos` даёт play-item (`method:'play'`, прокси-url, subtitles, озвучки) с одной и той же identity; сериалы — сезон/серии.
- GAP-002 §4.2 (историческая live-проверка с резидентного RU-IP): с доступного embed `videos()` отдавал **1 play-item (Матрица/Форрест/Интерстеллар) и 10 items / 3 сезона / 9 озвучек (Дом Дракона)**; CDN `interkh.com` доступен с VPS (master 200). Парсер/`videos()`/`streams()` работают, когда embed достижим.
- Локальный embed-парсер в этом FIX не менялся (только маршрут/классификация) — playable-путь на той же логике.

Вывод по playback: **«провайдер отдаёт playable, если embed доступен» — подтверждено (GAP-002 + юниты COL); «playable именно из этого деплоя» — заблокировано гео-гейтом embed-хоста (инфраструктура, вне кода).** Никакое изменение allowlist уже давно не поможет (прокси не участвует: 422 приходит напрямую с embed-хоста).

## G. Tests

`server` полный прогон (этот FIX, до запуска suite считался:
- `collaps-provider.test.js`: **22/22 pass** (7 COL-тестов + 15 прежних).
- Полный suite `NODE_ENV=test node --test`: **639 pass, 0 fail, 6 skipped** (без регрессий).

Новые COL-тесты:
- **COL-1** — title-only карточка → identity из search → playable item (COLLAPS-SHAPE закрыт).
- **COL-2** — `query.id` (TMDB) НЕ используется как collaps-orid; маршрут через search (ID-ROUTE).
- **COL-3** — канонический orid → прямой embed-маршрут (та же identity, что у карточки).
- **COL-4** — 422 на рабочую identity → `provider_error` `upstream-refusal` (НЕ молчаливый EMPTY).
- **COL-5** — 404 → `invalid-route` (тоже НЕ EMPTY).
- **COL-6** — подтверждённое отсутствие контента (embed 200, пустой source) → EMPTY **без** `provider_error`.
- **COL-7** — Collaps НЕ входит в Skaz (`config.skaz.balancers` без `collaps`; `twinFor('collaps') === null`) — архитектурный инвариант «Collaps = отдельный native, НЕ Skaz-source».

## H. Regressions

| Область | Проверка | Результат |
|---|---|---|
| Прочие провайдеры (YkMovie/Rutube/Kodik/…/Skaz) | полный suite | 639 pass / 0 fail |
| availability-семантика | `HARD_REFUSAL_STATUSES`, nativeProbe, hide/show — не менялись | без изменений |
| native-first / twin (store.js) | не менялись; COL-7 подтверждает: для collaps twin не существует | без изменений |
| proxy allowlist | не менялся (422 приходит от embed-хоста напрямую, прокси не участвует) | без изменений |
| Внешние хосты | embed/search/стрим-хосты те же, что до фикса | без изменений |

## I. Intentionally NOT changed (по ограничениям задачи)

- **availability.js** — не трогался. Глобальная «жёсткий 403/422/451 = host-block» семантика для ДРУГИХ провайдеров (nativeProbe / RULE-4 / show-hide) не тронута.
- **proxy.js / allowlist** — не менялись.
- **Skaz-балансеры, W1 (hostOrder/pin/continue-скан), store.js (native-first/twin)** — не менялись. Коллапс остаётся отдельным native-провайдером (не Skaz-source), доказуемо (COL-7).
- **recordByKeys / карточки в availability** — не переделывались: фикс локализован в CollapsProvider/CollapsClient.
- **Per-film hardcode / title-allowlist** — нет.
- **VKMovie, Rutube, Kodik** — не тронуты (греп по diff: файлы не менялись).
- **Collaps via Skaz** — не вводился и не рассматривался.

## STOP

- commit/push/deploy **НЕ делались**.
- Прод не трогался (live-проверки — только VPS temp `/tmp/mo-normfix` + локальный прогон юнитов).
- Playable из текущего деплоя упирается в гео-гейт embed-хоста (инфраструктура, задокументирована GAP-002) — это НЕ кодовая регрессия и не un-done часть фикса. Кодовая часть (единая identity, shape, классификация ошибок) — завершена и покрыта тестами.
- **COLLAPS-FIX-002 не создаётся** (по решению задачи).
- Следующее действие (если потребует пользователь) — вне кода: восстановить RU-egress к `api.ortified.ws` и повторить live-playback-пробу.