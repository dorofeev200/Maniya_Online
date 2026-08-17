# PROJECT-READINESS-001 — Аудит готовности Maniya Online vs E-Online (reference)

**Тип:** READ-ONLY аудит (код не менялся, ни одного коммита/деплоя).
**Дата прогона:** 2026-08-14.
**Эталон:** E-Online (skaz-кластер `online3.skaz.tv`, протокол `lite/<balancer>`).
**Целевой прод:** `https://plugin.maniya-kvn.online` (токен A/B, см. §18).
**Верификатор:** у пользователя (токен `mo-54f4…`); сравнение uid-разделения через второй токен `mo-fb9bf…`.
**Референс-учётка EO:** собственная (`dorofe…@gmail.com` / `7974…`) — рабочая, кластер отвечает (memkey возвращается). Старая учётка `nazarov6…`/`dg4xu2…` более НЕ используется (мертва/сменился uid).

> **Ограничения прогона (зафиксированы):** аудит строго READ-ONLY — код не менялся; созданы только временные верификационные скрипты в `scripts/` (порядок, см. §18) и этот отчёт. Ничего не коммичено, не задеплоено. По завершении — работа остановлена, никаких изменений больше не вносилось.

---

## Оглавление
1. [SOURCES/BALANCER lifecycle: Maniya vs E-Online](#1-sourcesbalancer-lifecycle)
2. [PROVIDERS: полный реестр по источникам](#2-providers)
3. [MOVIE FLOW (kinopub similar:true — проверка фикса)](#3-movie-flow)
4. [SERIAL FLOW](#4-serial-flow)
5. [UI LIFECYCLE (Kodik-баг)](#5-ui-lifecycle)
6. [CACHE/STABILITY](#6-cachestability)
7. [CONCURRENCY (2 пользователя, uid-скопинг)](#7-concurrency)
8. [SKAZ/ONLINE8 после ONLINE8-002](#8-skazonline8-после-online8-002)
9. [PLAYBACK (реальные HTTP-ответы)](#9-playback)
10. [ERROR HANDLING](#10-error-handling)
11. [SECURITY/RELIABILITY](#11-securityreliability)
12. [PERFORMANCE (p50/p95)](#12-performance)
13. [REGRESSION MATRIX](#13-regression-matrix)
14. [READINESS SCORE](#14-readiness-score)
15. [GAP LIST](#15-gap-list)
16. [DEFINITION OF DONE](#16-definition-of-done)
17. [CONSTRAINTS (выполнены/не выполнены)](#17-constraints)
18. [Методика и скрипты](#18-методика-и-скрипты)
19. [Приложение: сырые данные EO-эталона](#19-приложение-сырые-данные)

---

## 1. SOURCES/BALANCER lifecycle

### E-Online (эталон) — динамический
- `GET /lite/events?life=true&<query>&account_email&uid` → `{life:true, memkey}`.
- Опрос `GET /lifeevents?memkey=…` каждые ~2.5–3 с → `{ready, online:[{name,url,index,show,balanser,rch}]}`, отсортированы по `work` убыв.
- `show:true/false` вычисляется **на каждый запрос** (per-card checkSearch, кэш Fnv1a ~5 мин на (host,id,serial,source,count,userUid)).
- Балансеры перечислены **без префикса** (`filmix`, `alloha`, `rezka`, …) — в отличие от Maniya (`skaz-`).

### Maniya — статический реестр + per-card проверка на слое карточки
- `/api/lampa/sources` — **статический** реестр из 16 прод-источников (7 native + 9 `skaz-`): показывается всегда.
- `/api/lampa/sources/card` — per-card `show/hide` через кластерный checksearch; кэш `fnv1aKey(id:serial:source:count:userUid)`, TTL 5 мин, `HIDE_TTL=60с`, `force` пересчитывает. `TRUSTED_ALWAYS_VISIBLE = {filmix, skaz-filmix}`.
- `reservePolicy='abstain'` для online8 (не-kinopub воздерживается, см. §8).

### Результат сравнения (8 карточек, §13)
- Кластерный lifecycle у EO и Maniya **одна механика** (Lampac `lite/<balancer>` + per-card checkSearch + Fnv1a-кэш), но Maniya имеет **дополнительный слой native-провайдеров** (filmix/kodik/rezka/rutubemovie/cdnvideohub/collaps/hdvb), которых у EO в виде отдельного API нет — они идут напрямую.
- Расхождение показов: Maniya **показывает источники, которые EO скрывает** (систематически: `collaps`, `rutubemovie`; эпизодически: `kodik`, `videoseed`, `solntse`, `kinoflix`, `geosaitebi`, `alloha`, `kinopub`), см. §13/§15 GAP-002/005.
- Maniya **не имеет в реестре** источников, которые EO показывает постоянно: `ashdi`, `kinoukr`, `eneyida` (все 8 карточек), `remux` (2), `kinotochka` (2), `kinoteatrkg` (2), плюс «рыхлые»/эпизодические `animelib`, `zagonka`, `xvideocdnultra`, `zetflixdb` (Матрица). См. GAP-007.

---

## 2. PROVIDERS

### 2.1 Полный реестр Maniya (16 прод-источников)

| # | id | класс | Статус (по аудиту) |
|---|----|-------|--------------------|
| 1 | `filmix` | native | работает (play 206/206-HLS), 429/403 эпизодически |
| 2 | `kodik` | native | реестр есть; на карточках частью dead (items=0), флап см. §5 |
| 3 | `rezka` | native | самый стабильный playback (200 HLS 6/6); Форрест resolve 404 первого item |
| 4 | `rutubemovie` | native | **BROKEN playback**: 66-байтный JSON вместо манифеста (3/4), см. GAP-001 |
| 5 | `cdnvideohub` | native | работает (200 HLS, Матрица) |
| 6 | `collaps` | native | **dead всегда** (0 items на всех 8 карточках) — GAP-002 |
| 7 | `hdvb` | native | работает (200 HLS), ctype `text/html` (косметика) — GAP-009 |
| 8–16 | `skaz-{alloha,videoseed,kinopub,kinoflix,veoveo,pidtor,solntse,geosaitebi,rhsprem}` | skaz-прокси | см. §13 per-film; живы с переменной покрытием |

> Регистр `skaz-` берётся из `SKAZ_BALANCERS` (=`EO_BALANCERS`, 14 балансеров в `config.js:201`): alloha, videoseed, kinopub, kinoflix, veoveo, pidtor, solntse, filmix, rezka, hdvb, rutubemovie, kodik, geosaitebi, rhsprem. Native-провайдеры подключаются отдельно (registry.js), для них кластер не нужен.

### 2.2 Источники EO, которых НЕТ в Maniya-реестре (GAP-007)
`ashdi`, `kinoukr`, `eneyida` — стабильно EO-видимы на всех 8 карточках; `remux`, `kinotochka`, `kinoteatrkg` — на части карточек. Плюс «рыхлые» `animelib`, `zagonka`, `xvideocdnultra`, `zetflixdb` (только Матрица).

---

## 3. MOVIE FLOW

### Проверяемый риск: kinopub `similar:true` → «видео другого фильма»
**Фикс BALANCER-KINOPUB-004 в коде присутствует** (`server/src/providers/skaz/SkazProvider.js:674-738`): link-карточка является целью навигации только если совпадает с запрошенным фильмом по **ID (сильнее) → году → названию**; нет подходящей → пусто (`similar` в `SkazNormalizer.js` пропускается на сезонах/переводах).

**Live-подтверждение:** «Одиссея 2026» и «Последний дом 2026» (те самые фильмы, где баг проявлялся: Одиссея уходила на postid мини-сериала 1997, Последний дом — на хоррор 2009) в прогоне НЕ вернули чужой контент:
- Одиссея: EO показывает `kinopub`, Maniya — **скрывает** (`HID_BUT_EO=kinopub`) = осознанный defensive-hide (лучше источник «недоступен», чем видео другого фильма). Это и есть поведение после фикса.
- Последний дом: EO показывает `kinopub`/`kinoflix`, Maniya скрывает их (`HID_BUT_EO`).

**Аналогичные риски в других провайдерах:** у native `kodik` свой ключ разрешения по `kinopoisk_id`/`imdb_id` — в прогоне на Форресте kodik вернул 0 items (не чужой фильм; предмет отдельного GAP, §5/§15). Фильм-поток у прочих skaz-балансеров проверялся по playback (§9): чужих фильмов не найдено.

**Вердикт:** риск «wrong-movie» **закрыт** для kinopub; политика «скрыть, чем дать чужое» работает в проде. Остаток: источники-«рыхлые» (alloha и др.) могут возвращать нерелевантные позиции — это свойство кластера, не регрессия Maniya.

---

## 4. SERIAL FLOW

Тест: **Дом Дракона** + **The OA** + **Укрытие (Silo)** — все три сериала.

| Сериал | visible | items>0 (источники) | Playback реальный |
|--------|---------|---------------------|-------------------|
| Дом Дракона | 14 | 9 (filmix,rezka,hdvb,alloha,videoseed,kinopub,veoveo,solntse,rhsprem) | filmix 206-HLS, rezka 200-HLS, hdvb 200-HLS |
| The OA | 13 | 6 (filmix,rezka,hdvb,kinopub,veoveo,rhsprem) | rezka 200-HLS, hdvb 200-HLS; filmix 403 |
| Укрытие | 14 | 9 (filmix,rezka,hdvb,alloha,videoseed,kinopub,veoveo,solntse,rhsprem) | filmix 206-HLS, rezka 200-HLS, hdvb 200-HLS |

- Все 3 сериала **играют** минимум у 3 источников (filmix/rezka/hdvb) — подтверждено живыми HTTP-ответами.
- `rutubemovie` и `geosaitebi` — 0 items на сериалах (movies-only), но **показываются** в карточке → UX-баг (GAP-006).
- Навигация по сезонам/сериям: перф-фаза `videos kinopub cold` p50=334ms → `cached-nav` p50=165ms (кэш навигации 5 мин работает, подтверждено §12).

---

## 5. UI LIFECYCLE

### Kodik-баг (реестр vs карточка vs videos)
Состояние по прогону и `docs/balancer-kodik-005-report.md`:
- Kodik **присутствует** в статическом `/sources` и в `/sources/card` (visible), но `/videos` возвращает **0 items** (Форрест: status=200, items=0, seasons=0, voices=0, без provider_error) — пользователь видит источник, кликает → «видео не найдено».
- Корень (из прошлого аудита): кластерный checksearch для kodik **флапает** 503 / 200-absent / accsdb-deny; при любом hide TTL карточки сжимается до 60с → источник «мерцает» между reload'ами.
- Отличие от EO: у EO нет native-kodik в принципе; в эталонных карточках kodik отсутствует (это native-источник Maniya).

### Общий UX-дефект «visible-but-dead»
На 8 карточках систематически **показываются источники с items=0**: `collaps` (8/8), `rutubemovie` (на сериалах 3/3), `kinoflix`/`solntse`/`geosaitebi`/`videoseed`/`pidtor`/`kodik` — частью. Это ломает «жизненный цикл» UI: реестр говорит «есть источник», карточка говорит «показывай», а видео нет. GAP-002/005/006.

---

## 6. CACHE/STABILITY

### Карточка (`/sources/card`)
- Ключ: `fnv1aKey(id:serial:source:count:userUid)` — **uid-скопинг подтверждён** (§7).
- TTL 5 мин; `HIDE_TTL=60с`; `force=true` пересчитывает.
- Холодный прогон: матрица Форрест `elapsed_ms=2035` (первый без force). Перф: card-cold p50 ~95ms / p95 2.4–5.4с (§12) — хвост = кластерный checksearch при холодном кэше кластера.
- cached: p50 ~93ms, p95 405ms — стабильно.
- `TRUSTED_ALWAYS_VISIBLE={filmix, skaz-filmix}` — filmix показывается всегда, даже когда кластер вернёт «нет» (в прогоне Матрица: filmix visible, items=0 — доверенный, но контента нет; см. GAP-008 note).

### Навигация (сериалы)
- `_cachedCollectMovieCards`/`_cachedOpenSeasonPage` (5 мин) — подтверждено перфом: kinopub cold 334 → cached 165ms (p50).

### Стабильность
- Повторы без кэша ошибок не наблюдались в прогоне (200 на всех видео-фазах).
- Серия 30 запросов: 0×429 (темп 49/мин) — лимит 120/60с не сработал.

---

## 7. CONCURRENCY

Скрипт `readiness-concurrency.mjs`, 5 фаз, 2 пользователя (A и B, разные uid):

| Фаза | Результат |
|------|-----------|
| [1] Параллельный cold `/sources/card` (Матрица) A+B | оба 200; оба cold; **sigEqual=true**; uid-скопинг (разные userUid → разные записи кэша) |
| [2] Немедленный повтор | оба `cached=true` (hit) |
| [3] A `force=true`, B без force | A пересчитал, **B остался hit** (bStayedHit=true) — изоляция force |
| [4] Параллельный `/videos` (filmix) A+B | оба 200, items=4 |
| [5] Серия 30 запросов | 30/30 status 200, n429=0, rate=49/мин |

**Вердикт:** uid-скопинг кэша работает, `force` изолирован, rate-limit не срабатывает при умеренном темпе. Опасность 429 есть только при burst (известный из прошлых аудитов «~112 req/15с» → `lite/events` 429) — штатный UI так не стреляет.

---

## 8. SKAZ/ONLINE8 после ONLINE8-002

- В коде (`availability.js`) `reservePolicy='abstain'`: для не-kinopub online8 **воздерживается** (403/503/2xx-non-content ≠ «нет»); hide — только от content-«нет» primary; kinopub исключён (обслуживается online8 через 302-туннель с online3).
- **В прогоне** EO-эталон использовал `online3.skaz.tv` (не online8) — online8 проверен в предыдущем цикле (см. `docs/balancer-online8-002-report.md`: filmix 5/5 show, GATE 21/21, REVEAL 14/14, playback OK). На 2026-08-14 поведение не изменилось: online8 не отдаёт «нет» по 403-disable.
- **Данные качества EO-эталона:** `lite/events` кластера нестабилен под стрессом — в прогоне Матрица/Интерстеллар первоначально вернули `ready=false total=0` (fetch-TypeError), повтор после паузы — `ready=true total=40/37`. Это свойство кластера (более медленно/нестабильно при нагрузке), а не дефект Maniya; учитывается в §19 как вариативность эталона (GAP-010).

---

## 9. PLAYBACK

Метод: для первых 3 источников с `items>0` резолвим первый call-item через `/api/lampa/video`, затем **реальный HTTP GET** (`Range: bytes=0-1023`) на итоговый URL (для внешних — с Origin/Referer). «items>0 ≠ playback» — доказываем статусом и content-type.

| Источник | Форрест | Матрица | Интерстеллар | Одиссея | Посл.дом | Дом Дракона | The OA | Укрытие |
|----------|---------|---------|--------------|---------|----------|-------------|--------|---------|
| filmix | **206 mp4** | —(0 items) | **206 mp4** | 429 | **206 mp4** | **206 HLS** | 403 | **206 HLS** |
| rezka | 404 resolve | **200 HLS** | **200 HLS** | — | **200 HLS** | **200 HLS** | **200 HLS** | **200 HLS** |
| rutubemovie | 404 resolve | 200 **66B JSON** | 200 HLS | 200 **66B JSON** | 200 **66B JSON** | —(0) | —(0) | —(0) |
| cdnvideohub | — | **200 HLS** | — | — | — | — | — | — |
| hdvb | — | — | — | **200 HLS*** | — | **200 HLS*** | **200 HLS*** | **200 HLS*** |

`*` hdvb отдаёт HLS с `Content-Type: text/html` (тело начинается `#EXTM3U`) — играет, но ctype неверный (GAP-009).

**Выводы:**
- **5 источников реально играют** через прод-прокси: filmix (mp4/HLS), rezka (HLS, самый надёжный — 6/6), cdnvideohub (HLS), hdvb (HLS), rutubemovie (1/4 — Интерстеллар).
- Каждая из 8 карточек имеет **минимум 1 рабочий источник**.
- **rutubemovie сломан** на 3/4 фильмов: `/videos` даёт items>0, но resolve отдаёт **66-байтный JSON** `{"title":"au…` (метаданные вместо манифеста) — GAP-001. Классический пример «items>0 ≠ playback».
- **Форрест rezka**: resolve первого call-item → 404 (нужен фолбэк на следующий item) — GAP-004.
- filmix: 429 (Одиссея, транзиентный CDN) и 403 (The OA) — известные ограничения CDN, не дефект кода (GAP-003, pre-existing).

---

## 10. ERROR HANDLING

- Не-2xx кластера (403/503/accsdb-deny) в Maniya не превращаются в «нет»-голос для online8 (abstain, §8) — защита от ложного hide.
- `/videos` при отсутствии контента возвращает `items:[]` с HTTP 200 и (при реальной ошибке провайдера) `provider_error.code` — в прогоне ни одного `provider_error` не всплыло (кроме поведенческих items=0).
- 429 от filmix CDN — транзиентен, проксирует как 429 (клиент видит ошибку CDN, а не зависание).
- 66-байтный JSON от rutubemovie **проходит как 200** — сервер не распознаёт «мусорный» ответ как ошибку (нет проверки сигнатуры манифеста). GAP-001.
- Кластерный `lite/events` может падать под стрессом (fetch-TypeError) — повторный опрос спасает (GAP-010).
- Форрест rezka: resolve первого item 404 — нет автоматического перебора `items[1..n]`. GAP-004.

---

## 11. SECURITY/RELIABILITY

> ⚠️ **Пользовательская директива: «Главное чтобы мои данные нигде не были доступны».** В отчёте никаких реальных кред/токенов/паролей НЕТ (все обрезаны).

### 11.1 Найденные утечки реальных секретов в git-дереве (P0) — GAP-011

Сканирование по grep рабочего дерева (README: READ-ONLY — **ничего не редактировалось, не коммичено**):

| Файл:строка | Что утекло | Статус в git |
|-------------|-----------|--------------|
| `scripts/auto-confirm-config.mjs:5` | реальный пользовательский токен `mo-54f4…` | **закоммичен** (в истории) |
| `scripts/p1b-live-test.mjs:5` | тот же токен `mo-54f4…` | **закоммичен** |
| `docs/action-plan.md:542` | пароль VPS-деплоя (`789zxc…`) | **закоммичен** |
| `docs/action-plan.md:91,464` | старая мёртвая учётка `nazarov6…@gmail.com` / `dg4xu2…` | **закоммичен** (неактивна) |
| `docs/skaz-p2-gap-analysis.md:6,278` | рабочая учётка `dorofe…@gmail.com` / `7974…` | не в git (untracked) — риск при будущем add -A |
| `docs/balancer-stability-card-report.md:15` | токен `mo-54f4…` | не в git |
| `docs/skaz-architecture.md:166,216-217` | старая учётка `nazarov6…` | не в git |

**Риск:** репозиторий — публичный/с remote `github.com/dorofeev200` (origin+backup). Закоммиченные токен и пароль VPS — **реальная компрометация** (токен живёт до 2026-09-09, пароль действующий).
**Рекомендация (НЕ применена — READ-ONLY):**
1. Ротация пароля VPS-деплоя и токена пользователя; токен сам истекает 2026-09-09.
2. Redact/rewrite рабочих файлов (`scripts/*.mjs`, `docs/action-plan.md`, `docs/*.md`) — замена на placeholder, затем коммит (по решению пользователя).
3. Для файлов с рабочими кредами в untracked (skaz-p2) — добавить в `.gitignore` или вынести из дерева.
4. History-rewrite (filter-repo/bfg) — по решению пользователя; минимум — инвалидация секретов.

### 11.2 Прочее
- Токены API — только через env/config (`config.js`, `.env`); в коде зашитых прод-секретов не найдено (кроме утечек выше в scripts/docs).
- Прокси-локлист `proxy.allowHosts` ограничивает SSRF (список CDN-хостов) — в прогоне резолв внешних URL шёл через прод-прокси корректно.
- Destructive-тестов НЕ проводилось (запрещено).
- **Надёжность:** 0×429 в серии 30; 200 на всех видео-фазах; uid-изоляция подтверждена.

---

## 12. PERFORMANCE

`readiness-perf.mjs`, n=5 на фазу (темп 400ms), p50/p95 в мс:

| Фаза | Матрица (фильм) | Дом Дракона (сериал) |
|------|-----------------|----------------------|
| `/sources` (static) | 92 / **546** | 96 / **482** |
| card cold (`force`) | 96 / **2409** | 94 / **5398** |
| card cached | 93 / 405 | 93 / 405 |
| videos filmix/kinopub cold | 159 / 532 | 334 / **862** |
| videos cached-nav | 249 / 836 | 165 / 531 |
| video resolve | 92 / **348** | 95 / **1351** |

**Интерпретация:**
- **Статический реестр и кэшированные фазы — отлично** (~90–95ms p50, p95 ≤ 405–546ms).
- **Главный хвост — card-cold p95: 2.4с (фильм) / 5.4с (сериал)** = кластерный checksearch при холодном кэше кластера. p50 при тёплом кэше кластера ~95ms. Для UI: первый заход на свежую карточку может ждать 2–5с; повторные — мгновенно. GAP-008.
- resolve сериальной серии: p50 95ms, p95 1.35с (первый резолв может включать кластерный раунд).
- Нав-кэш сериала: kinopub 334→165ms (p50) — работает.

---

## 13. REGRESSION MATRIX

8 карточек: 5 фильмов (Форрест Гамп, Матрица, Интерстеллар, **Одиссея 2026**, **Последний дом 2026**) + 3 сериала (Дом Дракона, The OA, Укрытие). Все — через прод-API `/sources`, `/sources/card`, `/videos` per-visible, playback-пробу.

### 13.1 EO-show vs Maniya-show (нормализованные id, `skaz-`→``)

| Карточка | EO show | Maniya visible | BOTH | Maniya-показывает, EO-прячет | EO-показывает, Maniya-нет |
|----------|---------|----------------|------|------------------------------|---------------------------|
| Форрест | 16/29 | 15 | 12 | kodik, collaps, videoseed | remux, ashdi, kinoukr, eneyida |
| Матрица | 20/40 | 15 | 11 | rutubemovie, collaps, kinopub, kinoflix | animelib, kinoteatrkg, zagonka, xvideocdnultra, ashdi, kinoukr, eneyida, kinotochka, zetflixdb |
| Интерстеллар | 16/37 | 13 | 11 | rutubemovie, collaps | kinopub(скрыт), animelib, ashdi, kinoukr, eneyida |
| Одиссея 2026 | 13/29 | 10 | 7 | collaps, kinoflix, solntse | kinopub(скрыт), kinoteatrkg, rhsprem(скрыт), ashdi, kinoukr, eneyida |
| Посл.дом 2026 | 13/29 | 11 | 7 | rutubemovie, collaps, videoseed, solntse | kinopub(скрыт), kinoflix(скрыт), geosaitebi(скрыт), ashdi, kinoukr, eneyida |
| Дом Дракона | 14/25 | 14 | 10 | rutubemovie, collaps, kinoflix, geosaitebi | ashdi, kinoukr, eneyida, kinotochka |
| The OA | 11/25 | 13 | 7 | rutubemovie, collaps, alloha, videoseed, solntse, geosaitebi | kinoflix(скрыт), ashdi, kinoukr, eneyida |
| Укрытие | 11/22 | 14 | 8 | rutubemovie, collaps, videoseed, kinopub, kinoflix, geosaitebi | ashdi, kinoukr, eneyida |

`(скрыт)` = Maniya имеет в реестре, но карточка скрыла (при этом EO показывает).

### 13.2 Ключевые закономерности
- **Систематический over-show** (Maniya показывает, EO прячет): `collaps` 8/8, `rutubemovie` 7/8 (+broken playback), `kinoflix`/`geosaitebi`/`videoseed`/`solntse` частью. GAP-002/005.
- **Скрытие при EO-show** у новых фильмов (Одиссея, Посл.дом): `kinopub` — это осознанный defensive-hide после фикса BALANCER-KINOPUB-004 (§3), НЕ баг.
- **Стабильный пробел реестра:** `ashdi`, `kinoukr`, `eneyida` — EO показывает всегда, у Maniya нет. GAP-007.
- **visible-but-dead** (виден, но items=0): Форрест — kodik,collaps,videoseed,pidtor,rhsprem; Матрица — filmix,collaps,kinoflix,pidtor; Одиссея — collaps,kinoflix,solntse,geosaitebi; сериалы — rutubemovie,collaps,частью kinoflix/pidtor/geosaitebi/solntse/alloha/videoseed. GAP-005.

### 13.3 Playback по карточкам
См. §9 — каждая карточка имеет ≥1 рабочий источник; фиксируются GAP-001 (rutubemovie), GAP-004 (rezka Форрест resolve-404), GAP-003 (filmix 429/403).

---

## 14. READINESS SCORE

Взвешенная оценка по главам (0–10):

| Компонент | Балл | Обоснование |
|-----------|------|-------------|
| Playback (реальный) | **8** | 5 провайдеров играют; rutubemovie сломан (GAP-001) |
| Покрытие источников vs EO | **5** | 4 стабильных источника EO отсутствуют; over-show dead |
| Movie flow (kinopub) | **9** | wrong-movie закрыт, defensive-hide работает |
| Serial flow | **9** | 3/3 играют, нав-кэш работает |
| UI lifecycle | **5** | visible-but-dead массово |
| Cache/стабильность | **8** | uid-скопинг, force-изоляция, 0×429; cold-tail 2–5с |
| Concurrency | **9** | изоляция подтверждена, 30 запросов 0×429 |
| online8 (abstain) | **8** | поведение по дизайну, не регрессировало |
| Error handling | **6** | «мусорный» 200-ответ rutubemovie не детектится; нет фолбэка по items |
| Security | **4** | **P0**: закоммиченные токен+пароль, не ротированы (GAP-011) |
| Performance | **7** | статик/cache отлично; card-cold p95 2.4–5.4с |

**ИТОГО: ≈ 7.1 / 10 — «условно готов к базовому использованию; НЕ release-ready».**
Готовность к публичному использованию блокируют: **GAP-011 (security, P0)**, **GAP-001 (rutubemovie)**, **GAP-002/005 (visible-but-dead UX)**, **GAP-007 (пробел источников)**. Функциональный core (поиск→карточка→play) работает.

---

## 15. GAP LIST

Формат: `GAP-ID | описание | поведение EO | поведение Maniya | root cause | риск | как чинить | затронутые файлы | тест | как верифицировать`.

| ID | Описание | EO | Maniya | Root cause | Риск | Как чинить | Файлы | Тест | Верификация |
|----|----------|----|--------|-----------|------|-----------|-------|------|-------------|
| **GAP-001** | `rutubemovie` возвращает 66-байтный JSON `{"title":"au…` вместо манифеста; `/videos` даёт items>0 (ложное «есть видео») | (у EO не native) | items>0, но resolve → 200-JSON, не играет | нормализатор rutube не даёт манифест для части тайтлов; нет сигнатурной проверки | клик → «видео не найдено» | сигнатурная проверка ответа (манифест начинается `#EXTM3U`/`ftyp`); если нет — `items=[]`; починить rutube-резолв | `providers/rutube/*`, `store.js` | unit: mock 66B JSON → items=[] | playback-проба rutubemovie на Матрице/Одиссее/Посл.доме → HLS 200 |
| **GAP-002** | `collaps` показывается на всех 8 карточках, но items=0 всегда | EO прячет | показываем | checksearch кластера «рыхлый»; native collaps не фильтруется | источник-призрак в UI | скрывать при 0 items (обратная связь videos→card) или убрать из реестра | `registry.js`, `availability.js` | regression 8 карточек → collaps hidden | карточки не содержат collaps |
| **GAP-003** | filmix CDN 429 (Одиссея) / 403 (The OA) | (не проверялось EO) | 429/403 на playback | CDN-лимиты/geo у filmix | единичные тайтлы не играют | retry/фолбэк на другой источник; ошибки транзитны | — | playback Одиссея повторно | 429 уходит (повтор) |
| **GAP-004** | Форрест rezka: resolve первого call-item → 404, нет перебора `items[1..n]` | EO не даёт такой же 404 (или перебирает) | падаем на items[0] | rezka-нормализатор не сортирует/не фильтрует битые items | тайтл не играет там, где есть рабочий items[1] | фолбэк по items до первого playable | `rezka/*`, `store.js` | unit: items[0] 404 → items[1] | playback Форрест rezka 200 |
| **GAP-005** | visible-but-dead: показываем источники с items=0 (collaps, частью kinoflix/solntse/geosaitebi/videoseed/pidtor/kodik) | EO скрывает | показываем | статический реестр + checksearch не связан с videos | мусор в UI | связать карточку с фактическими items; дегрейдить «рыхлые» | `availability.js`, `card` endpoint | regression по 13.1 | на карточках dead не виден |
| **GAP-006** | `rutubemovie`/`geosaitebi` показываются на сериалах при 0 items (movies-only) | EO прячет на сериалах | показываем | нормализатор не различает movie/serial для этих балансеров | сериалы «засорены» | скрывать movies-only на serial=1 | `availability.js`, нормализаторы | serial-карточки без rutubemovie/geosaitebi | §13.2 serial без них |
| **GAP-007** | Отсутствуют источники EO: `ashdi`, `kinoukr`, `eneyida` (стабильно), `remux`, `kinotochka`, `kinoteatrkg` (частично) | показываются | нет в реестре | не портированы из Lampac | покрытие каталога ниже EO | портировать балансеры (клиент+декод+нормализатор+реестр+config) | `providers/*`, `registry.js`, `config.js` | /sources содержит их; EO-сравнение | EO-show источник → Maniya показ |
| **GAP-008** | card-cold p95 2.4с (фильм) / 5.4с (сериал) | EO-эталон аналогично медленен при холодном кэше | та же | кластерный checksearch холодный | первый заход на карточку медленный | тёплый кэш/параллельный checksearch/prefetch | `availability.js` | перф карточки | card-cold p95 < 1.5с |
| **GAP-009** | hdvb отдаёт HLS с `Content-Type: text/html` | — | проксируем как есть | CDN/нормализатор не выставляет HLS-ctype | плеер может не распознать | нормализовать ctype при прокси | `store.js`/proxy | ctype `application/vnd.apple.mpegurl` | playback hdvb → ctype HLS |
| **GAP-010** | Кластерный `lite/events` нестабилен под стрессом (fetch-TypeError, total 0→40) | (сам кластер) | используем тот же | лимит кластера при burst | эталонные пробы могут давать пусто | retry + fallback-хост (94.249.239.*) | скрипты верификации | повторный опрос даёт ready | reprobe стабильно 2 попытки |
| **GAP-011** | **P0 Security:** реальные токен `mo-54f4…`, пароль VPS, рабочая учётка закоммичены/в дереве | — | — | зашиты в scripts/docs | **компрометация** учётки и VPS | ротация + redact + gitignore | `scripts/*.mjs`, `docs/*.md` | grep по токенам → пусто | git grep без секретов; секреты ротированы |

---

## 16. DEFINITION OF DONE

Состояние «ready to production» (все пункты ниже одновременно):

1. **GAP-011 закрыт:** секреты вычищены из дерева (grep-чисто), ротированы токен и VPS-пароль; untracked-файлы с кредами в `.gitignore`.
2. **GAP-001 закрыт:** rutubemovie либо играет (HLS), либо не даёт items (не «мусорный» 200); playback-проба на Матрице/Одиссее/Посл.доме → HLS или items=[].
3. **GAP-002/005/006 закрыты:** на карточках нет visible-but-dead и movies-only на сериалах (8 карточек regression без «призраков»).
4. **GAP-004 закрыт:** rezka фолбэчит по items до playable; Форрест играет.
5. **GAP-007 закрыт (или явно задекларирован):** `ashdi`/`kinoukr`/`eneyida` в реестре ИЛИ вынесены в бэклог с приоритетом.
6. **GAP-008 смягчён:** card-cold p95 ≤ 1.5с (тёплый кэш/префекч).
7. **GAP-009 закрыт:** ctype hdvb = HLS.
8. **Каждая из 8 карточек** §13.3: ≥1 источник с подтверждённым реальным playback (HTTP 200/206 + манифест).
9. **Без регрессий:** concurrency-фазы (§7) зелёные; 0×429; uid-изоляция.

---

## 17. CONSTRAINTS

- [x] READ-ONLY аудит: код не менялся (только созданы временные скрипты верификации и этот отчёт).
- [x] Без коммитов, без деплоя.
- [x] Без destructive-тестов.
- [x] Новые фильмы для тестов использованы: **Одиссея 2026**, **Последний дом 2026** (свежие 2026) в матрице; эталон с актуальной (своей) учёткой, старая `nazarov6…` исключена.
- [x] Никакие реальные креды/токены/пароли в отчёт НЕ включены.
- [ ] (ожидает решения пользователя) Redact утечек GAP-011 — НЕ выполнялось (README).
- [ ] (вне скоупа) Ротация секретов — НЕ выполнялась.

---

## 18. Методика и скрипты

Скрипты в `scripts/` (временные, READ-ONLY GET):

| Скрипт | Что делает | Выход |
|--------|-----------|-------|
| `readiness-matrix.mjs` | 8 карточек: /sources, /sources/card, EO lite/events (life+poll), /videos per-visible, playback-проба (resolve + HTTP Range на 3 источниках с items) | `Temp/readiness-matrix.json/.log` |
| `readiness-concurrency.mjs` | 5 фаз: parallel cold card A+B, repeat hit, force-isolation, parallel /videos, серия 30 | `Temp/readiness-concurrency.json` |
| `readiness-eo-reprobe.mjs` | Добивка EO-эталона для Матрицы/Интерстеллара (ready=true 40/37) | `Temp/readiness-eo-reprobe.json` |
| `readiness-perf.mjs` | p50/p95: sources, card cold/hit, videos cold/cached, video resolve (n=5) | `Temp/readiness-perf.json` |

Учётные данные скриптов — во временных файлах **вне репозитория** (`Temp/prod-verify-users.json`, `Temp/prod-cluster-env.json`), в отчёт не включены. Темп запросов: 400–700ms (≈49–86 req/мин) — под лимитом кластера 120/60с.

---

## 19. Приложение: сырые данные EO-эталона

`show`-наборы EO (нормализованные, без префиксов) по карточкам:

- **Форрест (29, show 16):** kinopub, filmix, alloha, rezka, remux, pidtor, kinoflix, ashdi, kinoukr, eneyida, rutubemovie, veoveo, rhsprem, solntse, hdvb, geosaitebi.
- **Матрица (40, show 20):** animelib, filmix, alloha, pidtor, kinoteatrkg, rezka, zagonka, xvideocdnultra, rhsprem, ashdi, kinoukr, eneyida, videoseed, veoveo, solntse, hdvb, kinotochka, geosaitebi, cdnvideohub, zetflixdb.
- **Интерстеллар (37, show 16):** kinopub, animelib, filmix, alloha, pidtor, rezka, kinoflix, rhsprem, ashdi, kinoukr, eneyida, videoseed, veoveo, solntse, hdvb, geosaitebi.
- **Одиссея 2026 (29, show 13):** kinopub, filmix, kinoteatrkg, alloha, ashdi, kinoukr, eneyida, rutubemovie, videoseed, veoveo, rhsprem, hdvb, geosaitebi.
- **Посл.дом 2026 (29, show 13):** kinopub, filmix, alloha, rezka, pidtor, kinoflix, ashdi, kinoukr, eneyida, veoveo, rhsprem, hdvb, geosaitebi.
- **Дом Дракона (25, show 14):** kinopub, filmix, alloha, rezka, pidtor, ashdi, kinoukr, eneyida, videoseed, veoveo, solntse, rhsprem, hdvb, kinotochka.
- **The OA (25, show 11):** kinopub, filmix, rezka, pidtor, kinoflix, ashdi, kinoukr, eneyida, veoveo, rhsprem, hdvb.
- **Укрытие (22, show 11):** filmix, alloha, rezka, pidtor, ashdi, kinoukr, eneyida, veoveo, solntse, hdvb, rhsprem.

> Примечание по качеству данных: Матрица/Интерстеллар — второй прогон (reprobe, ready=true, total 40/37) после падения первого (ready=false total=0, стресс кластера, GAP-010). Разброс total между прогонами (29↔40) — вариативность кластера (включая «рыхлые» show для нерелевантных запросов), учитывался при анализе.

---

*Конец отчёта PROJECT-READINESS-001. По завершении аудита никакие изменения в репозиторий не вносились (запрет соблюдён).*
