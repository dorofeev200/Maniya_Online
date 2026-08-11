# PERF REPORT — Startup Latency E-Online vs Maniya + Fix (lazy resolve)

Дата: 2026-08-11. Метрика: time-to-first-frame аппроксимация (serial chain T0→T6_ttl)
по цепочке **один фильм · один провайдер · одна озвучка · одно качество**.

- Фильм: **Человек-паук: Нет пути домой (2021)**, tmdb 634649 / imdb tt10872600.
- Провайдер: **skaz-alloha** (Allo-XA).
- Озвучка: **HDrezka Studio** (первый голос, `voice=0` — 'одна озвучка').
- Качество: **1080p** (в мастере выбран вариант `RESOLUTION=1920x1080`, иначе первый).
- Хост замера: **VPS 95.85.241.121** (обе цепи с одного хоста, один DNS/сеть до CDN).
- Запусков: **5 на каждую цепь** (≥3 по требованию), медиана.

---

## 1. TEST RESULTS

| Suite | Результат |
|---|---|
| `server/test/skaz-provider.test.js` | **21/21 pass** (0 fail) |
| `server/test/api.test.js` | **13/13 pass** (0 fail) |
| Полный `NODE_ENV=test node --test` | **348 pass · 2 skip · 0 fail** |
| 2 skipped | только live-тесты: `EO_LIVE=1` (матрица балансеров), `FILMIX_LIVE=1` — не регрессии |

---

## 2. ЗАМЕРЫ (median, 5 runs; raw в скобках)

Стадии: T2 — ответ провайдера (lite/videos), T3 — дескриптор, T4 — мастер, T4b — вариант 1080p,
T5 — init, T6 — первый сегмент (ttfb/ttl). SER_TO_FRAME = serial sum до скачивания 1-го сегмента.

### A. E-ONLINE (прямая цепь, без нашего сервера)

| Стадия | Median | Raw |
|---|---|---|
| T2_lite | **136ms** | [259, 134, 136, 136, 137] |
| T3_resolveJson (1 голос) | **136ms** | [181, 136, 132, 135, 138] |
| T4_master | 26ms | [108, 26, 26, 25, 27] |
| T4b_variant | 25ms | [103, 25, 24, 25, 26] |
| T5_init | 25ms | — |
| T6_seg (ttfb / ttl) | 26 / 41ms | [126, 40, 38, 41, 47] |
| **SER_TO_FRAME** | **388ms** | [802, 388, 381, 388, 400] |
| **REQS_TO_FRAME** | **6** | [6,6,6,6,6] |
| Verdict | 5× OK | — |

Всего до первого кадра: lite + videoJSON + master + variant + init + seg = **6 запросов, 388ms**.

### B. MANIYA BEFORE (старый код, eager — prod-деплой /opt/maniya-online, :3000)

| Стадия | Median | Raw |
|---|---|---|
| **T2_videos** | **3975ms** | [4269, 1837, 1690, 4204, 3975] |
| T4_master | 45ms | [215, 29, 29, 45, 48] |
| T4b_variant | 132ms | [243, 132, 87, 136, 104] |
| T5_init | 36ms | — |
| T6_seg (ttfb / ttl) | 31 / 89ms | [146, 89, 75, 103, 60] |
| **SER_TO_FRAME** | **4223ms** | [4913, 2130, 1910, 4523, 4223] |
| **REQS_TO_FRAME** | **5** | [5,5,5,5,5] |
| Verdict | 5× OK | — |

### C. MANIYA AFTER (новый код, lazy resolve — тот же код, инстанс :3100)

| Стадия | Median | Raw |
|---|---|---|
| **T2_videos** | **214ms** | [1385, 186, 214, 263, 187] |
| **T3b_video (ленивый резолв 1 голоса)** | **475ms** | [896, 1984, 422, 475, 437] |
| T4_master | 29ms | [154, 31, 27, 27, 29] |
| T4b_variant | 95ms | [289, 95, 84, 80, 97] |
| T5_init | 30ms | — |
| T6_seg (ttfb / ttl) | 30 / 95ms | [152, 95, 95, 80, 69] |
| **SER_TO_FRAME** | **953ms** | [2930, 2421, 871, 953, 850] |
| **REQS_TO_FRAME** | **6** | [6,6,6,6,6] |
| Verdict | 5× OK | — |

Итого до первого кадра: videos + lazy-video + master + variant + init + seg = **6 запросов, 953ms**.

> Примечание по честности: T3b в AFTER = collectMovieCards (повторный getLite, ~140ms) +
> resolveVideoJson 1 голоса (~136ms) + серверные ходы. 1 лишний запрос вместо 8 последовательных.

---

## 3. СВОДКА СТАРТА ДО ПЕРВОГО КАДРА

| Цепь | Median startup | Requests | Δ vs E-Online |
|---|---|---|---|
| **E-Online (прямой)** | **388ms** | 6 | — |
| **Maniya BEFORE (eager)** | **4223ms** | 5 | +3835ms (+9.9×) |
| **Maniya AFTER (lazy)** | **953ms** | 6 | +565ms (+2.5×), **−3270ms vs BEFORE (4.4×)** |

Фаза списка (пользователю видно до нажатия Play / до выбора голоса):
BEFORE `videos()` = **3975ms** → AFTER **214ms** (**18.6× быстрее**).

---

## 4. ROOT CAUSE МЕДЛЕННОГО СТАРТА

**В `videos()` провайдера все голоса резолвились СЕРИЙНО и заранее.**

Старый код (`movieItemsFromHtml` / цикл по `call`-карточкам):
```
for (voice of cards) { item = await resolveCardItem(voice); … }   // await в цикле
```
Каждый `resolveCardItem` — сетевой roundtrip к дескриптору alloha
(`resolveVideoJson`/`resolveStream`, ~475ms медиана по замерам AFTER T3b).
9 переводов × 475ms ≈ **3.8–4s внутри TTFB одного `/api/lampa/videos`**.

Доказательство числами:
- BEFORE `T2_videos` 3975ms ≈ ленивый baseline (214ms) + **8 лишних голосов × ~470ms ≈ 3760ms**.
- AFTER: резолв ровно одного голоса = **475ms** (T3b) — per-voice цена та же, но ×1.
- Мастер/init/сегмент/CDN во всех трёх цепях ~одинаковы (25–135ms) → **не** являются
  медленным звеном. Прокси-надбавка Maniya на мастер/вариант/сегмент = +60–100ms — постоянная,
  не масштабируется числом голосов.

Второстепенные вклады (остаточный разрыв AFTER 953ms vs E-Online 388ms):
1. `resolveVideo` повторно собирает навигацию (`getLite`) = +1 запрос (~140–200ms). Оптимизация-кандидат:
   кэшировать навигацию/передавать stream-URL клиенту. **Не сделано** (вне скоупа).
2. Прокси-хоп наш сервер→CDN на каждом leg`е (+29→95ms на вариант).
3. Server-side hops/JSON обработка (~30ms).

---

## 5. ЧТО ИСПРАВЛЕНО (lazy resolve) И ЗАПРОСЫ ДО ПЕРВОГО КАДРА

Изменения в рабочем дереве (branch `feature/alloha-provider`, uncommitted):

| Файл | Изменение |
|---|---|
| `server/src/providers/skaz/SkazProvider.js` | `movieVideos`/`serialVideos`: call-карточки уходят в items как **`method:"call"`** с URL `/api/lampa/video?…` (buildResolveUrl) вместо eager-резолва. Новые `resolveVideo`/`resolveMovieVideo`/`resolveSerialVideo`, единая навигация `collectMovieCards`/`openSeasonPage` (voice-индекс/серия сходятся со списком). JSON-дескриптор и фолбэк `resolveStream` сохранены в точке резолва. |
| `server/src/store.js` | `getVideoForRequest(context)` — резолв `method:"call"` item'а (только выбранная карточка). |
| `server/src/index.js` | Новый маршрут `GET /api/lampa/video` (подписка как у других /api/lampa/*; 404 при провайдере без `resolveVideo`). |
| `server/test/skaz-provider.test.js` | Тесты переведены на ленивые call-items + `resolveVideo` (21 test, 0 fail). |
| `server/test/api.test.js` | +2 теста `/api/lampa/video` (403 без токена, 404 для выключенного провайдера). |
| `scripts/startup-latency.mjs` | **Новый** измерительный харнесс (direct vs proxy, обе формы items, 1080p, счётчик запросов). |

Запросы до первого кадра (не изменились принципиально, но ушло 8 последовательных скрытых были внутри одного):
- E-Online: **6** (lite · video · master · variant · init · seg)
- Maniya BEFORE: **5** объектов запросов, но videos() выполнил внутри **9 серийных резолвов** CDN-дескрипторов
- Maniya AFTER: **6** (videos · lazy-video · master · variant · init · seg)

---

## 6. INVENTORY (33 источника) + GAP ANALYSIS

Полная таблица 33 источников со статусами, категоризация WORKING / PARTIAL / MISSING / BLOCKED
и next-implementation order — в **`docs/eonline-gap-analysis.md`** (коммит `b3bd4d8`, обновлён `738d831`).

Сводка:
- **WORKING end-to-end (10)**: alloha, filmix, videoseed, hdvb, kinopub, solntse, rutubemovie (native),
  cdnvideohub (VideoH-аналог), collaps (native), geosaitebi (movie, добавлен 08.08).
- **PARTIAL (5)**: rezka (сериалы ок / фильмы пусто), veoveo (CDN 403 часть), kinoflix (сериалы пусто —
  контента нет на кластере), kodik (аниме-гейт), pidtor (магниты → 502, playback blocked).
- **MISSING в Maniya (3)**: vkmovie (жив, 0 кода, приоритет 1), animelib (follow-кандидат, приоритет 2), vdb (UNKNOWN).
- **BLOCKED/DEAD (15)**: kinobase, turboserial, vk, rutube-404, fancdn, mirage, fanserials, mirkino,
  xvideocdn, hdrezka, aniliberty, animebesst, filmixtv, kinoteatrkg, zagonka (503/403/404; rch/аккаунтные —
  не добавлять в UI).

---

## 7. ВЫВОДЫ

1. **Root cause найден и доказан**: eager серийный резолв всех голосов внутри `videos()`.
2. **Lazy resolve уменьшил старт**: Maniya startup до первого кадра **4223ms → 953ms (4.4×)**, список
   `videos()` **3975ms → 214ms (18.6×)**; E-Online-базовый уровень 388ms достижим ценой ещё +1 запроса
   (кэш навигации resolveVideo).
3. CDN/мастер/прокси ноги не были узким местом; их вклад постоянен и одинаков для обеих цепей.
4. Регрессий нет: полный suite 348 pass / 2 skip / 0 fail; live-прогон lazy-инстанса 5×OK по всем цепям.

---

## 8. PRODUCTION DEPLOY + ФИНАЛЬНЫЙ REPORT (E-Online vs Maniya production)

Деплой разрешён и выполнен **2026-08-11** (targeted: 3 src-файла + 2 теста, md5-сверка 5/5,
`systemctl restart maniya-online`; **`.env`/data/Telegram/HLS-proxy/Alloha-playback не тронуты**).
Backup до деплоя: `/root/maniya-online-pre-lazy-20260811.tar.gz` (VPS).

### Production verification (post-deploy, live на :3000)
- **health/ready**: 200 / `ready:true`; `systemctl active`, NRestarts=0.
- **/api/lampa/videos** (skaz-alloha Spider-Man): 200, **9 items**, все `method:"call"` c URL `/api/lampa/video`
  (лениво), первый голос HDrezka Studio.
- **/api/lampa/video**: 200, дескриптор `method:"play"`, `voice_name:"HDrezka Studio"`, quality
  [1080p/720p/480p/360p], 7 субтитров, `primary or reserve` → мастер через прокси → вариант 1080p
  (1481 сегмент) → сегмент **206 video/mp4**.
- **Голоса 1/2**: Есарев / Украинский — play-дескрипторы, 4 качества.
- **Сериал** (Игра престолов, alloha): items 10, seasons 8, voices 8; episode 1:1 → lazy
  `call` → play-дескриптор `type:serial, season:1, episode:1, voice:"Оригінал"`, quality
  [2160p/1440p/1080p/720p/480p/360p], 9 субтитров.
- **Качества** 1080p/720p/480p/360p: все **200 mpegurl** через прокси.

### Финальные медианы (5 runs, VPS, Spider-Man / skaz-alloha / HDrezka Studio / 1080p)

| Цепь | videos (T2) | Дескриптор | Startup до 1-го кадра | Requests |
|---|---|---|---|---|
| **E-Online (прямой)** | lite 142ms | 138ms | **397ms** | 6 |
| **Maniya BEFORE (prod до деплоя)** | **3975ms** | внутри videos | **4223ms** | 5 (9 скрытых серийных) |
| **Maniya AFTER (production now)** | **206ms** | 529ms | **927ms** | 6 |

Ожидалось: videos ~214ms, startup ~953ms. **Production: 206ms / 927ms — в пределах ожидания. ✓**

- Maniya production startup **в 4.5× быстрее** до-деплойного (4223→927ms), список **в 19.3×** (3975→206ms).
- Разрыв к E-Online (397ms) = +1 повторный lite-запрос в resolveVideo (~150ms) + прокси-хопы
  (~60–100ms) — постоянный, не масштабируется числом голосов.

### Файлы деплоя (production)
- `server/src/index.js`, `server/src/store.js`, `server/src/providers/skaz/SkazProvider.js`
  (md5-сверка с локальным рабочим деревом — 5/5 включая тесты).

### Проверено после деплоя (по требованию)
фильмы ✔ · сериалы ✔ · сезон ✔ · эпизод ✔ · несколько озвучек (HDrezka/Есарев/Украинский) ✔ ·
1080p ✔ · 720p ✔ · 480p/360p ✔ · регресс-тесты 348/350 ✔.

### Следующий шаг
К новым провайдерам НЕ переходим. Отдельная задача (в очереди): адаптивное отображение карточек
источников на мобильных (Lampa-плагин, CSS/компонент карточки).