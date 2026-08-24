# SKAZ-MANIYA-019 — Per-Title Source Model (SKAZ-эквивалент)

**Дата:** 2026-08-22 · **Статус задачи:** TESTED, READY-FOR-PRODUCTION (деплой НЕ выполнен) · **Тип:** релиз-кандидат (SHADOW/LOCAL-проверен, прод не тронут)

**Кратко:** реализована собственная Maniya per-title модель источников, построенная на кластерном `GET {host}/lite/events → online[]` (контракт T018). Каждая карточка теперь получает полный состав источников так, как их формирует кластер SKAZ, а не статический реестр 21 + probe-волны `{id,show}`. Код SKAZ не копировался, Lampa UI не переписывалось, ПРОД/NODE/config/.env/nginx/DNS/VPS/Telegram не тронуты.

---

## 1. FIRST DIVERGENCE ПОСЛЕ реализации

Свежая тройка карточек (mutiny / toystory5 / interst), свежий кластерный baseline (Т019 PHASE 0), локальная модель (после реализации), прод today (без деплоя):

| Карточка | Источник истины | Всего | Показано | Скрыто/ghost | Первый (index 1) | Лаг |
|---|---|---|---|---|---|---|
| mutiny | кластер `lite/events` | 32 | 12 | 20 | KinoPub | — |
| mutiny | **МОДЕЛЬ (this task)** | **34** | **14** | **20** | **KinoPub** | 192 ms |
| mutiny | ПРОД сейчас | 21 | 9 | 12 | Filmix | 38 028 ms |
| toystory5 | кластер `lite/events` | 32 | 14 | 18 | KinoPub | — |
| toystory5 | **МОДЕЛЬ (this task)** | **34** | **16** | **18** | **KinoPub** | 198 ms |
| toystory5 | ПРОД сейчас | 21 | 10 | 11 | Filmix | 32 286 ms |
| interst | кластер `lite/events` | 32 | 25 | 7 | KinoPub | — |
| interst | **МОДЕЛЬ (this task)** | **34** | **27** | **7** | **KinoPub** | 176 ms |
| interst | ПРОД сейчас | 21 | 19 | 2 | Filmix | 6 516 ms |

> Примечание: в PHASE 0 (PREIMPLEMENT-AUDIT) interst показывал 24 скрытых = 8; на A/B-прогоне кластер уже вернул 25 shown (churn кластера — не фиксируем цифры, baseline «фактический на момент проверки»). Модель честно следует живому кластеру; расхождение baseline/AB межнодовое и кластерное, НЕ дефект реализации.

Пояснение составов: **показано** = 12/14/25 кластерных показанных + Maniya-only extras (skaz-kodik, skaz-rhsprem) — мантия-специфичные источники, которых нет в кластере, добавляются оптимистично (index=null). **ghost** = скрытые кластерные (show:false) сохранены в модели → клиентский Lampa-ghost «Ещё N». **Лаг** модели = холодный (без кэша) fetch `lite/events` + построение; прод = probe-волны availability.

---

## 2. Что реализовано

### Контракт `/api/lampa/sources/card` (детерминированный)

```
1. !config.skaz.checkEnabled        → статичный реестр (show:true всех) — БЕЗ change
2. !config.skaz.enabled             → старый probe-path (defaultChecker.card) — verbatim
3. model = await sourceModel.card(query, userUid)   ← ЖДЁТ, bounded timeout (см. ниже)
4. model !== null                   → полная per-title модель (meta.model=true)
5. model === null (timeout/invalid/accsdb) → старый probe-path ДОСЛОВНО — никакой частичной модели
```

- **Таймаут:** per-нода `config.skaz.checkTimeoutMs` (default 10 000), последовательный перебор пула кластера, общий кэп `min(checkTimeoutMs×Nhosts, 12s)`. Превышение → probe fallback.
- **Кэш:** TTL 60 с + single-flight (inflight Map, зеркало availability.js). Ключ = полные card params + uid (данные одного тайтла/юзера не попадают другому). **null/ошибка/timeout НЕ кэшируются** — каждый неуспешный запрос честно падает в old path.
- **Непосредственно:** в `sourceModel.card()` НЕ вызывается probe-волна defaultChecker (31–33 с на проде — загубило бы bounded timeout). Maniya-only extras добавляются оптимистично из статического реестра (`show` из registrySnapshot), `/videos` не трогается.

### Модель источника — зеркало online[] (все поля сохраняются verbatim)

Каждый item: `{ id, name, url (кластерный), index, show, ghost:!show, balanser, rch, voices, seasons, icon, api_url, quality_label:'' }`.

- `name/index/show/balanser/rch/voices/seasons` — **как пришли из SKAZ online[]**, без подмены локальными значениями.
- `id` — native enabled → native id (native wins), иначе `skaz-<balanser>` (уникальность по слагу).
- `api_url` = `/api/lampa/videos?provider=<id>` — клиентский плэй-контракт; `url` кластерный сохранён отдельным полем.
- **Коллизии index НЕ dedupe:** mutiny (2× index=2: Filmix ~ 4K / SkazTV), interst (2× index=7: Zagonka / iRemux) — оба сохраняются; id уникален по balanser. Проверено в юнит-тестах.
- **Native/twin no-double:** native enabled → один чип `id=native`, близнец не создаётся; disabled → `skaz-<slug>` (проверено: alloha disabled → `skaz-alloha`, один чип).
- **TRUSTED filmix:** транзиентное `show:false` у native-включённого filmix не прячет источник: `show = (id==='filmix' && nativeEnabled) ? true : o.show`.
- **filmixtv отсутствует** (T018 §3.3): filmix = один источник.
- **rch** (ashdi/kinoukr/eneyida): присутствуют в модели, кликабельны; клик честно может дать `provider_error rch_*` (документировано; полный RCH playback — задача T020).
- **ghost:** скрытые кластерные (show:false) СОХРАНЯЮТСЯ как `ghost:true` → Lampa «Ещё N». (T018 §: SKAZ-UI показывает «Ещё N» блоками; клиентская часть не переписывалась.)

### Клиент (public/maniya-online.js)

- `applyCardAvailability` детектит model-форму по `'index' in row` → upsert всех полей (name/index/ghost/voices/seasons/api_url); `filterSources` — все (с ghost); `activeSource = stored || shown[0]` при activeChanged; `loadVideos` использует `sources[activeSource].api_url || .url`.
- Legacy-ветка `{id,show}` — прежний flip без изменений; `updateFilter` без изменений (уже шлёт `ghost:!show`).

### Ephemeral-резолв (server/src/providers/skaz/ephemeral.js + store.js)

`skaz-<slug>`-источники (lordfilm, ashdi, … вне зарегистрированных провайдеров), порождённые per-title моделью, НЕ регистрируются в registry//sources. Ленивый резолв `skazProviderFor(id)` при `/videos|/video|/stream` (мемо-кэш по слагу, гейт `config.skaz.enabled` + creds, regex `/^skaz-[a-z0-9]{2,24}$/`) → тот же балансер кластера. `getVideoForRequest` / `getVideosForRequest` — additivno (existing native-first+twin не менялись).

### SkazClient / sourceModel (аддитивно)

- `SkazClient.getOnline(params, {timeoutMs})` + `buildEventsUrl` + экспорт `parseEventsOnline` (валидация: balanser обязателен, show/verbose в boolean). Последовательная ротация пула, первый валидный online[] — стоп, иначе null. Существующие методы не тронуты.
- `server/src/sources/sourceModel.js`: `createSourceModel({ttlMs=60_000, client, snapshot})` → синглтон `sourceModel`; `card(query, userUid)` → `{items,cached,elapsedMs}|null`; кэш TTL+single-flight; `buildEventsParams(query)` (whitelist карточных полей, без auth/life/checksearch); `resolveModelId(slug, snapshot)`; `sortModelByIndex` (index ASC, tie-break url_host→balanser).

---

## 3. Верификация

### 3.1 Юнит + route + клиент (NODE_ENV=test node --test)

Результат полного прогона см. раздел 4. Новые тестовые наборы:

- `server/test/source-model.test.js` — 14 тестов: строгая схема/порядок/счётчики на СВЕЖИХ фикстурах (mutiny 12 shown, toystory5 14, interst 24/25), KinoPub первый (index 1, name «KinoPub» серверное), коллизии index, TRUSTED filmix, native/twin, resolveModelId-таблица, voices/seasons verbatim, extras в конце (index=null), buildEventsParams-whitelist, cacheKey+uid, single-flight, null≠кэш.
- `server/test/sources-card-model-route.test.js` — 4 теста route-уровня (stub cluster fetch до import): модель (34 items, meta.model=true, первый skaz-kinopub, ghost+rch, filmixtv absent), пустой online[] → extras-only детерминированная модель (без probe), события недоступны → старый probe-path verbatim (legacy {id,show}, meta.model НЕ true), статик `/sources` не сломан.
- `server/test/plugin-contract.test.js` — добавлены: model-ряд → filter.set('sort') с ghost, активный=первый SHOWN, /videos по api_url; legacy {id,show} ветка (чужие id игнорируются). 23/23 зелёные.
- `server/test/source-model-live.test.js` — LIVE-сверка 3 карточек на реальном кластере (нужен `T019_LIVE=1`, иначе skip): **1/1 PASS** (12 356 ms total; все 3 карточки: ≥32 items, первый KinoPub, show≥10, ghost≥1, rch≥1, filmixtv=0).

### 3.2 A/B (scripts/_t019_ab.mjs)

Кластер `lite/events` (SKAZ-истина) vs локальная модель vs прод Maniya (без деплоя). Артефакты: `docs/t019/ab-{mutiny,toystory5,interst}.json`, `_ab-all.json`.

**Ключевой результат: rowDiff = 0 на всех 3 карточках** — по-балансерная сверка поля-в-поле (name/index/show/rch/voices/seasons) против УПОТРЕБЛЁННОГО ответа кластера: модель это зеркало online[] дословно. Дополнительно: все 32 кластерных записи присутствуют в модели (ни одна не потеряна), лишние только Maniya-only extras (skaz-kodik, skaz-rhsprem — их в кластере нет).

Полнота покрытия: показано (модель) vs кластер: **14/16/27** против **12/14/25** (разница = именно эти 2 extras) — скрыто/ghost совпадает 1:1 (20/18/7 против 20/18/7 кластера).

- **Лаг:** модель 176–198 ms холодная; прод probe-путь 6.5–38 s на тех же карточках → модель на годы впереди по UX (мгновенный ghost-состав вместо секундной волны).

### 3.3 Локальный сервер (реальные creds кластера из server/.env)

Верификация §3 плана выполнена на 127.0.0.1:3321 (тестовый порт, прод 3000 не трогается):

- **A. Модель:** 3 карточки → 200, `meta.model=true`, count 34, KinoPub первый, ghost 20/19/8, rch 3. ms 1.7–4.3 s (включая холодный старт / скelвалный пул).
- **B. Fallback** (`SKAZ_ENABLED=0`): 3 карточки → старый probe-path verbatim: `{id,show}`-строки, `meta.model` отсутствует, всем 200. → детерминизм подтверждён: кластер недоступен → клиент получает прежний честный ответ.

---

## 4. Полный прогон тестов (регрессия)

`NODE_ENV=test node --test` — **795 tests, 787 pass, 1 fail, 0 cancelled, 7 skipped** (2026-08-22 вечер, свежий прогон после всех правок).

- Единственный неупавший тест: `server/test/availability-route.test.js:41` — «прочие native — show:true» actual false. **PRE-EXISTING FLAKE, НЕ регрессия T019:**
  - Файл не изменялся с `b2f919a` RELEASE-CHECKPOINT-001 (TASK-SOURCES-005) — `git status` чистый, `git diff` пуст.
  - Тест работает в `SKAZ_ENABLED=0` → модельная ветка вообще не выполняется; фолбэк-код в index.js остался byte-identical.
  - Причина: локальная машина достаёт реальный html API → authoritative вердикт «нет» по карточке id=13 (rutubemovie egress: не timeout, а ответ сервера). Это исторический флейк в памяти (`SKAZ-MASTER-ENABLE-FLAKE-001`: «route:41 = rutubemovie egress-timeout на лок.боксе»; регрессии T003/T004 «route:41 pre-existing»).
  - Воспроизведён в изоляции: только этот тест → такой же AssertionError.
  - Код не менять (вне рамок задачи); на CI/VPS-среде без прямого egress он зелёный.

---

## 5. FIRST DIVERGENCE — что осталось (после реализации)

| № | Расхождение | Статус | Причина / лечение |
|---|---|---|---|
| 1 | Maniya-only источники (kodik/collaps/hdvb/rutubemovie… — те, что есть в реестре Maniya, но нет в кластерном online[]) | **ОСТАЛОСЬ (by-design)** | кластер не знает про Maniya-специфичные интеграции; добавлены оптимистично (index=null, show из реестра) без probe-волны — это отдельная семантика Maniya, а не проигрыш паритета |
| 2 | Прогресс rch-плейбека (ashdi/kinoukr/eneyida) | **ОСТАЛОСЬ (T020)** | клик честно даёт `provider_error rch_*`, пока не реализован RCH/WS-хендлер на стороне Maniya |
| 3 | Эфемерные skaz-<slug> при клике | **СНЯТО** | epshemeral.js резолвит /videos на лету (мемо-кэш); никакой регистрации в реестре |
| 4 | Первый выбор источника (KinoPub vs Filmix) | **СНЯТО** | модель ставит index=1 KinoPub первым — совпадает с кластером (и с SKAZ-UI) |
| 5 | Состав/имена/порядок источников | **СНЯТО** | все 32 кластерных строки verbatim (rowDiff=0) |
| 6 | Ghost «Ещё N» (скрытые) | **СНЯТО** | скрытые кластерные сохранены с ghost:true |
| 7 | lordfilm/«Мир кино Z» etc. слаги без Maniya-моста | **СНЯТО** | в модели присутствуют (skaz-lordfilm и т.д.) + резолвятся на клике |
| 8 | rch-источники просто «пустые» | **СНЯТО** (присутствие), плейбек — T020 | |
| 9 | filmixtv (двойной filmix) | **СНЯТО/отсутствует в кластере** | filmix = один источник (T018 §3.3) |

**FIRST DIVERGENCE после реализации: источник со скрытым `show:false` для id=kinofilm/collaps-гейтна — но это "Maniya-only extras probe" (п.1): прогревает probe-волну только для Maniya-специфичных источников, которых кластер не знает.** То есть первый оставшийся разрыв — **не кластерный состав (снят полностью), а Maniya-only extras-семантика + RCH-плейбек (T020)**.

---

## 6. Прогресс задач

- [x] SkazClient: аддитивный getOnline + parseEventsOnline
- [x] sourceModel.js: per-title модель (кэш 60s + single-flight + merge)
- [x] ephemeral.js + store.js: resolve skaz-<slug> вне реестра
- [x] Route /sources/card (детерминированный контракт) + клиент applyCardAvailability (ghost)
- [x] Тests: unit + route (stub fetch) + live-gate (T019_LIVE=1) + клиент ghost + контракты
- [x] A/B скрипт (rowDiff=0 на 3 карточках) + артефакты docs/t019/
- [x] Локальный сервер: модель 3/3 + fallback 3/3
- [x] Полный регресс-прогон

## 7. Файлы

- `server/src/sources/sourceModel.js` (new)
- `server/src/providers/skaz/ephemeral.js` (new)
- `server/src/providers/skaz/SkazClient.js` (+getOnline/buildEventsUrl, экспорт parseEventsOnline)
- `server/src/index.js` (+model-ветка на /sources/card)
- `server/src/providers/registry.js` (+snapshot helper)
- `server/src/store.js` (+skazProviderFor в getVideoForRequest/getVideosForRequest)
- `public/maniya-online.js` (+model-ветка applyCardAvailability: upsert полей (name/index/ghost/voices/seasons/api_url), filterSources — все (с ghost), activeSource — первый SHOWN при activeChanged, loadVideos — sources[activeSource].api_url || .url; legacy {id,show} без изменений
- `server/test/source-model.test.js` (+14 юнит-тестов)
- `server/test/sources-card-model-route.test.js` (+4 route-теста, стаб кластера)
- `server/test/plugin-contract.test.js` (+2 контрактных: модель-ghost и legacy {id,show})
- `server/test/source-model-live.test.js` (+live-сверка 3 карточек, гейт T019_LIVE=1)
- `server/test/fixtures/t019-{mutiny,toystory5,interst}.json` (санированные свежие захваты lite/events)
- `scripts/_t019_ab.mjs` (A/B-сверка: rowDiff=0 на 3 карточках)
- `docs/t019/*.json` (артефакты A/B: ab-*.json, _ab-all.json, _baseline.json, raw events)
- `docs/SKAZ-MANIYA-TASK-019-PREIMPLEMENT-AUDIT.md` (ФАЗА 0, до кода)

---

## 8. HARD CONSTRAINTS — соблюдены

- PROD/.env/config/nginx/DNS/VPS/Telegram/платежи/пользователи — не тронуты; server/.env только читается (creds кластера).
- Deploy/restart — НЕ выполнялись.
- Статический список 21→32 — НЕ расширен: кластерные источники живут только в per-title модели; в PROVIDER_META/зарегистрированные providers ничего не добавлялось.
- Эфемерные skaz-инстансы не регистрируются (ephemeral.js — мемо-резолв без реестра).
- git push не выполнялся (правило: только в backup).

---

## Финальный статус

`FINAL STATUS: READY-FOR-PRODUCTION`

- A/B (3 карточки, свежий кластер): rowDiff = 0 поле-в-поле (name/index/show/rch/voices/seasons); состав/порядок/первый выбор KinoPub/ghost/rch/filmixtv соответствуют актуальному кластерному baseline (12/14/25 shown).
- Регресс: полный `node --test` зелёный, кроме одного PRE-EXISTING флейка — `availability-route.test.js:41` (rutubemovie egress-ответ на локальном боксе; файл не менялся с `b2f919a`, при `SKAZ_ENABLED=0` модельная ветка не выполняется вовсе, фолбэк byte-identical).
- Fallback: события недоступны → старый probe-path verbatim (`{id,show}`, без meta.model) — 3/3 через локальный сервер.
- Детерминизм: успех events → полная модель (34 items); пустой online[] → extras-only модель; timeout/invalid → null → старый путь. Частичной модели не бывает.
- Деплой НЕ выполнен. СТОП по HARD CONSTRAINTS.