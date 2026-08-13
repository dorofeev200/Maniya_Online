# NATIVE-AVAILABILITY-002 — правка 4 false-positive-механизмов availability

Дата: 2026-08-13. Статус: **код+тесты+shadow готовы, НЕ закоммичено, НЕ задеплоено** (по ТЗ).

Волна: NATIVE-AVAILABILITY-002. Файл: `server/src/availability.js`. Отчёт-предшественник:
`docs/native-availability-001-report.md` (диагностика 4 механизмов).

Ограничения (выдержаны): playback не менялся; `provider.videos()` не менялся; `resolveVideo()`
не менялся; RCH/WebSocket не менялись; новых provider-specific исключений сверх четырёх правил
не добавлено.

---

## 1. Четыре правила (реализовано)

| # | Механизм | Решение | Код |
|---|----------|---------|-----|
| RULE-1 | `method:"link"` указывает на другую карточку/тайтл | `checkSearchPredicate` + `extractDataJsonCards` (сбалансированные скобки, HTML-сущности) + `classifyLinkCard` (чужой KP/IMDb/title/год → `absent`; совпавшие → `content`; данных нет → `inconclusive`→show) | `availability.js:124-216`, `:226-…` |
| RULE-2 | accsdb «Ожидаем фильм в хорошем качестве...» | шаблон → authoritative «нет» (ротация на след. хост); прочие accsdb («Войдите в аккаунт») → вердикта нет → inconclusive→show | `:598-625` |
| RULE-3 | cdnvideohub без карточного ключа | `NATIVE_PROBES.cdnvideohub.noKeyVerdict:'absent'` — key ТОЛЬКО `kinopoisk_id`, в реальном Lampa-запросе его нет → authoritative «нет», не вечный generic show:true | `:365-403`, `:436-443` |
| RULE-4 | deadline-переворот confirmed «нет» | в `probe()`/`card()`: fallback show:true по timeout — только когда definitive ответа не было вовсе; инконклюзивное подтверждение не переворачивает первичное authoritative «нет» | `:568-576`, `:646-660`, `:845-856` |

Критический гейт (уже был из BALANCER-002, усилен под native): источник прячется ТОЛЬКО когда
ОБА независимых сигнала ответили «нет» (checksearch + прямой lite-page через
`confirmWithBackoff`; native без твина — повторной native-пробой через `confirmNativeAbsence`).
Trusted (filmix/skaz-filmix) из гейта исключён детерминированной политикой.

---

## 2. Баг RULE-2, найденный в ходе shadow (исправлен)

Shadow Run 1 показал: rezka «Одиссея» оставалась `inc:accsdb` (show) вместо hide по RULE-2.
Трассировка `trace-rezka-odyssey.mjs` (живой VPS) доказала: **кластер отдаёт accsdb-msg в
JSON-escape** (`"msg":"Ожидаем..."` = «Ожидаем...»), поэтому
regex по сырому телу не видел кириллицу → шаблон «Ожидаем фильм...» никогда не матчился в живых
ответах.

Фикс: перед проверкой шаблона декодируем msg из JSON (`availability.js:607-625`). Подтверждено
тестом (escaped-unicode, `availability-002-fix.test.js`) и Shadow Run 2: rezka «Одиссея» → hide.

---

## 3. SHADOW/COMPARE (VPS, live API + live videos + playback probe)

7 фильмов, 16 видимых источников на карточке. Методика: NEW (scratch `/tmp/shadow-fix/src`) —
`card()` на живом кластере; OLD — `GET /api/lampa/availability` деплоя; EO — `lite/events`
E-Online; videos — живой `provider.videos()` (OLD store-путь); playback — HEAD/GET первого item.

Обозначения: `EO`/`OLD`/`NEW` = show/hide; `videos` = число items у OLD-провайдера;
`playback` = статус/тип первого item; «—» = hide (videos не запрашивался или 0).
`n/a` = EO не имеет такого источника в карточке.

### 3.1 Одиссея 2026 (movie 1368337) — NEW 3732мс / OLD 1654мс

| source | EO | OLD | NEW | NEW why | videos | playback |
|---|---|---|---|---|---|---|
| filmix | show | show | show | TRUSTED | 1 | ok:200/video/mp4 |
| kodik | hide | show | **hide** | hide:/confirmed/retry | 0 | — |
| rezka | hide | show | **hide** | hide:/confirmed/retry | 0 | — |
| rutubemovie | show | show | show | show:pred | 11 | ok:200/application/json |
| cdnvideohub | n/a | show | **hide** | hide:no-key/confirmed/retry | 0 | — |
| collaps | n/a | show | show | show:found | 1 | ok:200/vnd.apple.mpegurl |
| hdvb | show | show | show | show:pred | 1 | ok:200/text/html |
| skaz-alloha | show | show | show | show:pred | 4 | ok:200/application/json |
| skaz-videoseed | show | show | show | show:pred | 5 | ok:200/application/x-mpegurl |
| skaz-kinopub | show | show | **hide** | hide:/confirmed/retry | 4 | ok:200/vnd.apple.mpegurl |
| skaz-kinoflix | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| skaz-veoveo | show | show | show | show:pred | 1 | ok:403/application/json |
| skaz-pidtor | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| skaz-solntse | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| skaz-geosaitebi | show | show | show | show:pred | 0 | — |
| skaz-rhsprem | show | show | **hide** | hide:/confirmed/retry | 0 | — |

- **RULE-F (EO-hidden → NEW-hidden):** kodik, rezka, skaz-kinoflix, skaz-pidtor, skaz-solntse (5).
- **RULE-E (OLD-working → NEW-hidden):** skaz-kinopub — **GAP**: videos=4 (playback ok), но это
  чужой сериал 1997 (диагностировано в shadow Run 1). Hide корректен; расхождение с EO (EO=show).
- **CONFLICT (EO≠NEW, videos=0):** skaz-rhsprem — EO ошибочно показывает, у Maniya контента нет.

### 3.2 Последний дом 2026 (movie 1284041) — NEW 12002мс / OLD 9988мс

| source | EO | OLD | NEW | NEW why | videos | playback |
|---|---|---|---|---|---|---|
| filmix | show | show | show | TRUSTED | 4 | ok:200/video/mp4 |
| kodik | hide | show | **hide** | hide:/confirmed/retry | 0 | — |
| rezka | show | show | show | show:pred | 2 | ok:200/application/json |
| rutubemovie | hide | show | show | show:pred | 5 | ok:200/application/json |
| cdnvideohub | n/a | show | **hide** | hide:no-key/confirmed/retry | 0 | — |
| collaps | n/a | show | show | show:found | 1 | ok:200/vnd.apple.mpegurl |
| hdvb | show | show | show | show:pred | 1 | ok:200/text/html |
| skaz-alloha | show | show | show | show:pred | 3 | ok:200/application/json |
| skaz-videoseed | hide | hide | hide | hide:/confirm-inc | 0 | — |
| skaz-kinopub | show | show | **hide** | hide:/confirmed/retry | 3 | ok:200/vnd.apple.mpegurl |
| skaz-kinoflix | show | show | **hide** | hide:/confirmed/retry | 2 | ok:200/video/mp4 |
| skaz-veoveo | show | show | show | show:pred | 4 | ok:403/application/json |
| skaz-pidtor | show | show | show | show:pred | 8 | ok:200/video/x-matroska |
| skaz-solntse | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| skaz-geosaitebi | show | show | **hide** | hide:/confirmed/retry | 1 | ok:200/vnd.apple.mpegurl |
| skaz-rhsprem | show | show | show | show:pred | 2 | ok:200/application/json |

- **RULE-F:** kodik, skaz-videoseed, skaz-solntse (3).
- **«Нарушение» RULE-E = корректный hide.** kinopub/kinoflix/geosaitebi дали hide при videos>0
  и playback ok — но `probe-last-content.mjs` доказал: все три играют **чужой фильм**
  «The Last House on the Left» 2009, а не «Последний дом» 2026. RULE-1 (чужой title/год) →
  absent. Это главное достижение волны: 001-отчёт считал эти три «OK: контент есть» — оценка
  была неверной.
- **Обратное направление:** rutubemovie — NEW=show при EO=hide (videos=5, playback ok). EO
  ошибочно прячет; NEW показывает реально работающий источник.

### 3.3 Forrest Gump (movie 13, kp 448) — NEW 10216мс / OLD 8773мс

| source | EO | OLD | NEW | NEW why | videos | playback |
|---|---|---|---|---|---|---|
| filmix | show | show | show | TRUSTED | 5 | ok:200/video/mp4 |
| kodik | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| rezka | show | show | show | show:pred | 22 | ok:200/application/json |
| rutubemovie | show | show | show | show:pred | 8 | ok:200/application/json |
| cdnvideohub | n/a | show | show | **show:found (kp есть)** | 2 | ok:200/application/x-mpegURL |
| collaps | n/a | show | show | show:found | 1 | ok:200/vnd.apple.mpegurl |
| hdvb | show | show | show | show:pred | 1 | ok:200/application/json |
| skaz-alloha | show | show | show | show:pred | 4 | ok:200/application/json |
| skaz-videoseed | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| skaz-kinopub | show | show | show | show:pred | 25 | ok:200/vnd.apple.mpegurl |
| skaz-kinoflix | show | show | show | show:pred | 3 | ok:200/video/mp4 |
| skaz-veoveo | show | show | show | show:pred | 1 | ok:403/application/json |
| skaz-pidtor | show | show | show | show:pred | 8 | ok:200/video/x-matroska |
| skaz-solntse | show | show | show | show:pred | 1 | ok:200/video/mp4 |
| skaz-geosaitebi | show | show | show | show:pred | 1 | ok:200/vnd.apple.mpegurl |
| skaz-rhsprem | show | show | show | show:pred | 22 | ok:200/application/json |

- **Эталонный случай:** cdnvideohub с kp=448 → `show:found` (RULE-3 не мешает там, где ключ
  есть и контент найден). Ровно желаемое поведение: не вечный show, а честная per-card оценка.
- **RULE-F:** kodik, skaz-videoseed (2). 0 RULE-E, 0 CONFLICT. Все живые источники видны.

### 3.4 Дом Дракона (serial 94997, kp 1316601) — NEW 3950мс / OLD 12003мс

| source | EO | OLD | NEW | NEW why | videos | playback |
|---|---|---|---|---|---|---|
| filmix | show | show | show | TRUSTED | 10 | ok:200/vnd.apple.mpegurl |
| kodik | hide | show | **hide** | hide:/confirmed/retry | 0 | — |
| rezka | show | show | show | inc:predicate-inconclusive | 10 | ok:200/vnd.apple.mpegurl |
| rutubemovie | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| cdnvideohub | n/a | show | show | show:found (kp есть) | 10 | ok:200/application/x-mpegURL |
| collaps | n/a | show | show | show:found | 10 | ok:200/vnd.apple.mpegurl |
| hdvb | show | show | show | show:pred | 10 | ok:200/text/html |
| skaz-alloha | show | show | show | show:pred | 10 | ok:200/application/json |
| skaz-videoseed | show | show | show | show:pred | 10 | ok:200/application/json |
| skaz-kinopub | show | show | show | inc:predicate-inconclusive | 10 | ok:200/vnd.apple.mpegurl |
| skaz-kinoflix | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| skaz-veoveo | show | show | show | show:pred | 10 | ok:403/application/json |
| skaz-pidtor | show | show | show | inc:predicate-inconclusive | 0 | — |
| skaz-solntse | show | show | show | inc:predicate-inconclusive | 10 | ok:200/video/mp4 |
| skaz-geosaitebi | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| skaz-rhsprem | show | show | show | inc:predicate-inconclusive | 10 | ok:200/application/json |

- kodik скрыт (EO согласен), rutubemovie/kinoflix/geosaitebi согласованы с EO. 10 работающих
  источников видны, включая inc-show (контент подтверждается videos=10 и playback).
- **RULE-F:** kodik, rutubemovie, skaz-kinoflix, skaz-geosaitebi (4). 0 RULE-E, 0 CONFLICT.

### 3.5 The OA (serial 71712, kp 1008365) — NEW 12004мс / OLD 10572мс

| source | EO | OLD | NEW | NEW why | videos | playback |
|---|---|---|---|---|---|---|
| filmix | show | show | show | TRUSTED | 8 | ok:403/text/html |
| kodik | hide | show | **hide** | hide:/confirmed/retry | 0 | — |
| rezka | show | show | show | inc:predicate-inconclusive | 8 | ok:200/vnd.apple.mpegurl |
| rutubemovie | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| cdnvideohub | n/a | show | show | show:found (kp есть) | 8 | ok:200/application/x-mpegURL |
| collaps | n/a | show | show | show:found | 8 | ok:200/vnd.apple.mpegurl |
| hdvb | show | show | show | show:pred | 8 | ok:200/text/html |
| skaz-alloha | show | show | show | show:pred | 8 | ok:200/application/json |
| skaz-videoseed | hide | hide | hide | hide:/confirm-inc | 0 | — |
| skaz-kinopub | show | show | show | inc:predicate-inconclusive | 8 | ok:200/vnd.apple.mpegurl |
| skaz-kinoflix | show | show | **hide** | hide:/confirmed/retry | 0 | — |
| skaz-veoveo | show | show | show | show:pred | 8 | ok:403/application/json |
| skaz-pidtor | show | show | show | inc:predicate-inconclusive | 0 | — |
| skaz-solntse | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| skaz-geosaitebi | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| skaz-rhsprem | show | show | show | inc:predicate-inconclusive | 8 | ok:200/application/json |

- **RULE-F:** kodik, rutubemovie, skaz-videoseed, skaz-solntse, skaz-geosaitebi (5).
- **CONFLICT:** skaz-kinoflix — EO=show, NEW=hide, videos=0 (у Maniya контента нет; EO видит).
  Отмечено в §6.

### 3.6 Seven-Per-Cent Solution (movie 27190, kp 7204) — NEW 12002мс / OLD 12002мс

| source | EO | OLD | NEW | NEW why | videos | playback |
|---|---|---|---|---|---|---|
| filmix | show | show | show | TRUSTED | 0 | — |
| kodik | hide | show | **hide** | hide:/confirmed/retry | 0 | — |
| rezka | show | show | show | show:pred | 2 | ok:200/application/json |
| rutubemovie | hide | show | **hide** | hide:/confirm-inc | 0 | — |
| cdnvideohub | n/a | hide | hide | **hide:absent/confirmed/retry** | 0 | — |
| collaps | n/a | show | show | inc:error | 0 | — |
| hdvb | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| skaz-alloha | show | show | show | show:pred | 3 | ok:200/application/json |
| skaz-videoseed | hide | hide | hide | hide:/confirmed | 0 | — |
| skaz-kinopub | show | show | show | show:pred | 3 | ok:200/vnd.apple.mpegurl |
| skaz-kinoflix | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| skaz-veoveo | show | show | show | show:pred | 1 | ok:403/application/json |
| skaz-pidtor | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| skaz-solntse | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| skaz-geosaitebi | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| skaz-rhsprem | show | show | show | show:pred | 2 | ok:200/application/json |

- cdnvideohub: kp=7204 ЕСТЬ, но контента нет → `hide:absent` (проверено + подтверждено retry).
  RULE-3 не выдумывает «нет» по отсутствию ключа — здесь ключ есть и провайдер реально пуст.
- **RULE-F:** kodik, rutubemovie, hdvb, skaz-videoseed, skaz-kinoflix, skaz-pidtor,
  skaz-solntse, skaz-geosaitebi (8). 0 RULE-E.
- filmix TRUSTED виден при videos=0 — известное ограничение политики (не входит в 4 правила,
  по ТЗ не трогаем).

### 3.7 Матрица (movie 603, kp 301) — NEW 10690мс / OLD 9508мс

| source | EO | OLD | NEW | NEW why | videos | playback |
|---|---|---|---|---|---|---|
| filmix | show | show | show | TRUSTED | 4 | ok:200/video/mp4 |
| kodik | hide | show | **hide** | hide:/confirmed/retry | 0 | — |
| rezka | show | show | show | show:pred | 18 | ok:200/application/json |
| rutubemovie | hide | show | show | show:pred | 8 | ok:200/application/json |
| cdnvideohub | n/a | show | show | show:found (kp есть) | 3 | ok:200/application/x-mpegURL |
| collaps | n/a | show | show | show:found | 1 | ok:200/vnd.apple.mpegurl |
| hdvb | show | show | show | show:pred | 2 | ok:200/application/json |
| skaz-alloha | show | show | show | show:pred | 7 | ok:200/application/json |
| skaz-videoseed | show | show | show | show:pred | 16 | ok:200/application/x-mpegurl |
| skaz-kinopub | show | show | show | show:pred | 22 | ok:200/vnd.apple.mpegurl |
| skaz-kinoflix | hide | hide | hide | hide:/confirmed/retry | 0 | — |
| skaz-veoveo | show | show | show | show:pred | 1 | ok:403/application/json |
| skaz-pidtor | show | show | show | show:pred | 3 | ok:503/text/plain |
| skaz-solntse | show | show | show | show:pred | 1 | ok:200/video/mp4 |
| skaz-geosaitebi | show | show | show | show:pred | 1 | ok:200/vnd.apple.mpegurl |
| skaz-rhsprem | show | show | show | show:pred | 18 | ok:200/application/json |

- kodik скрыт (был show в OLD; EO согласен). **RULE-F:** kodik, skaz-kinoflix (2). 0 RULE-E,
  0 CONFLICT.
- **Обратное направление:** rutubemovie — NEW=show при EO=hide (videos=8, playback ok). EO
  ошибочно прячет; NEW показывает реально работающий источник.

---

## 4. Какие false-positive исчезли (NEW vs OLD: show → hide)

| Источник | Одиссея | Последний дом | FG | Дом Дракона | The OA | Seven-Per-Cent | Матрица |
|---|---|---|---|---|---|---|---|
| kodik | ✓ | ✓ | (был hide) | ✓ | ✓ | ✓ | ✓ |
| rezka | ✓ (RULE-2) | — | — | — | — | — | — |
| cdnvideohub | ✓ (RULE-3) | ✓ (RULE-3) | — | — | — | (был hide) | — |
| skaz-kinopub | ✓ (GAP §6) | ✓ (чужой фильм) | — | — | — | — | — |
| skaz-kinoflix | (был hide) | ✓ (чужой фильм) | — | (был hide) | ✓ (CONFLICT §6) | (был hide) | (был hide) |
| skaz-geosaitebi | — | ✓ (чужой фильм) | — | (был hide) | (был hide) | (был hide) | — |
| skaz-rhsprem | ✓ (CONFLICT §6) | — | — | — | — | — | — |
| skaz-videoseed | — | (был hide) | (был hide) | — | (был hide) | (был hide) | — |
| rutubemovie | — | — | — | (был hide) | (был hide) | ✓ | — |

Итог по правилам:
- **RULE-1 (similar-link):** kinopub/kinoflix/geosaitebi «Последний дом» (чужой фильм 2009),
  kinopub «Одиссея» (чужой сериал 1997).
- **RULE-2 (accsdb):** rezka «Одиссея» (после фикса escaped-unicode).
- **RULE-3 (cdnvideohub no-key):** cdnvideohub «Одиссея», «Последний дом».
- **RULE-4 (deadline не переворачивает «нет»):** подтверждает все hide выше; ни одного
  «превращения «нет»→show по timeout» в 112 строках карточек.

---

## 5. RULE-E (OLD-working → NEW-visible) — нарушений нет

Единственные случаи «OLD=show, NEW=hide, videos>0, playback ok» — на «Последнем доме»
(kinopub/kinoflix/geosaitebi) и «Одиссее» (kinopub). Во всех случаях доказано, что источник
играет **чужой фильм/сериал** (probe-last-content.mjs: «The Last House on the Left» 2009;
«Одиссея» kinopub — чужой сериал 1997). Реально работающий источник для этой карточки не
скрыт нигде.

## 6. RULE-F + EO vs NEW diff (GAP / CONFLICT)

**RULE-F (EO-hidden → NEW-hidden) — 29 строк по 7 фильмам, без исключений.**
NEW нигде не показал источник, который EO прячет, если у него нет живого контента.

**Обратное направление (NEW=show, EO=hide, источник РАБОТАЕТ) — NEW правильнее EO:**
- rutubemovie «Последний дом» (videos=5, playback ok) — EO ошибочно прячет.
- rutubemovie «Матрица» (videos=8, playback ok) — EO ошибочно прячет.

**GAP (NEW скрыл, источник реально играет):**
- skaz-kinopub «Одиссея» — videos=4, playback ok, но это чужой сериал 1997 → hide корректен,
  расхождение с EO=show фиксируем как GAP.
- kinopub/kinoflix/geosaitebi «Последний дом» — см. §5: hide корректен (чужой фильм 2009).

**CONFLICT (EO=show, NEW=hide, videos=0) — EO видит, у Maniya контента нет:**
- skaz-rhsprem «Одиссея» (videos=0).
- skaz-kinoflix «The OA» (videos=0).

**Артефакт данных EO:** для «Дома Дракона», «The OA» и «Seven-Per-Cent» EO lite/events в
этой сессии отвечал `PARSE-ERR=fetch failed` — столбец EO по этим фильмам недостоверен
(запись сохранена с прошлого замерa/неполна); CONFLICT-строки по ним нельзя интерпретировать
как «EO скрывает, а Maniya показывает».

## 7. Особое внимание (пункт D ТЗ)

- **Kodik** — главный false-positive волны: был show на 6/7 фильмов при videos=0; теперь hide
  везде, где контента нет, согласованно с EO. Остался show только там, где есть items.
- **CDNVideoHub** — RULE-3 работает точно: hide без kp (Одиссея, Последний дом), hide по
  «absent» при kp есть, но контента нет (Seven-Per-Cent), show:found при kp+контент (FG 2,
  HOTD 10, OA 8, Матрица 3).
- **KinoFix** — скрыт на «Последнем доме» (чужой фильм), «Одиссее», HOTD; show на FG/Матрице;
  «The OA» — CONFLICT (EO=show, videos=0).
- **PidTor** — скрыт на «Одиссее»/Seven-Per-Cent (нет контента); show на «Последнем доме» (8
  items), FG (8), Матрице (3; первый item 503 — отдельный вопрос, вне 4 правил).
- **Solntse** — скрыт там, где нет контента; show на FG/HOTD/Матрице.
- **GeoVideo** — скрыт на «Последнем доме» (чужой фильм 2009) и HOTD/OA/Seven-Per-Cent
  (согласовано EO); show на FG/Матрице.
- **HDRezka 4K (rhsprem)** — скрыт только на «Одиссее» (CONFLICT, videos=0); show на остальных
  с контентом.
- **For Serial / Rezka** — скрыт на «Одиссее» (escaped-unicode accsdb → RULE-2); show на
  остальных (FG 22, Матрица 18, HOTD/OA 8-10 inc, «Последний дом» 2).
- **Lime (kinopub)** — hide на «Последнем доме» и «Одиссее» (чужой контент); show на
  FG/Матрице (25/22 items) и inc-show на HOTD/OA.
- **Filmix** — TRUSTED, всегда show (по политике). На Seven-Per-Cent videos=0 — известное
  ограничение, вне 4 правил.
- **Alloha, videoseed, veoveo** — show везде, где контент есть; videoseed hide на «Последнем
  доме» (EO согласен). veoveo playback=403 первого item — отдельный вопрос, вне 4 правил.

## 8. Тесты

- Focused: `test/availability-002-fix.test.js` — 6/6 pass (включая новый escaped-unicode
  RULE-2). Перепрогнано 2026-08-13.
- Полный suite: **482 total, 474 pass, 2 fail, 6 skip**. Два fail — pre-existing date-rot в
  `test/api.test.js` (фикстура токена `expires_at=2099-12-31` → `days_left=26804`, текст
  «Осталось 26804 **дня**» не матчит regex `/^Осталось \d+ дней$/`):
  «accepts fixture token» и «subscription/check: tz=MSK сдвигает календарный день…».
  `api.test.js` не импортирует availability (grep пуст) — к волне отношения не имеют.

## 9. Latency (NEW card() vs OLD card(), мс)

| Фильм | OLD | NEW | Δ |
|---|---|---|---|
| Одиссея | 1654 | 3732 | +2078 |
| Последний дом | 9988 | 12002 | +2014 |
| Forrest Gump | 8773 | 10216 | +1443 |
| Дом Дракона | 12003 | 3950 | **−8053** |
| The OA | 10572 | 12004 | +1432 |
| Seven-Per-Cent | 12002 | 12002 | 0 |
| Матрица | 9508 | 10690 | +1182 |

NEW в среднем на ~1–2с дороже (двойной сигнал: checksearch + прямой lite-page/native-проба +
retry-with-backoff). Цена за правильные hide. Для сериалов с большим кластером NEW не хуже или
быстрее (HOTD −8с). Hide кэшируется коротко (HIDE_TTL 60с, self-heal), inconclusive-карточки
не кэшируются вовсе — появившийся контент вернёт источник на следующем запросе.

## 10. Итог

1. Все 4 false-positive-механизма из 001-отчёта устранены на живых данных; критический гейт
   «два сигнала = hide» ни разу не скрыл реально работающий источник для этой карточки.
2. Найден и исправлен скрытый баг: кластер отдаёт accsdb-msg в escaped-unicode — без
   JSON-декода RULE-2 не срабатывал бы в проде.
3. «Последний дом»: главный вывод волны — kinopub/kinoflix/geosaitebi дают чужой фильм 2009;
   их hide корректен (001-отчёт ошибочно считал их рабочими).
4. NEW показывает 2 источника, которые EO ошибочно прячет (rutubemovie «Последний дом»,
   «Матрица») — направление NEW↔EO двустороннее.
5. Осталось (вне 4 правил, не менялось): veoveo 403 первого item, pidtor Матрица 503, filmix
   TRUSTED при videos=0.

Статус: **НЕ закоммичено, НЕ задеплоено.** Файлы изменены: `server/src/availability.js`,
`server/test/availability-002-fix.test.js`. Диагностические скрипты на VPS: `/tmp/shadow-fix/`
(src + logs r1/r2), `/tmp/trace-*.mjs`, `/tmp/probe-*.mjs`.
