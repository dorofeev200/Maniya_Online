# FINAL-PLAYBACK-GAP-001 — финальное закрытие playback-разрывов

**Дата:** 2026-08-18 · **Статус:** ИМПЛ локально + LIVE-ПРОВЕРЕНО на VPS shadow (:3210, текущий код tree).
**Коммит/пуш/деплой:** НЕ выполнялись (по условиям задачи; прод не трогается).

---

## A. Цель и границы

Найти и исправить **реальные** playback gaps (не исследование): `show:true → items>0 → резолв/воспроизведение FALL`,
затем доказанные `show:true → items=0` потеряшки.

**Не считается провалом** (элиминация FP): 503/timeout/INC/легитимный пусто/похожесть/ghost.
**Не трогалось** без доказанного root cause: TMDB proxy, Skaz RCH, VKMovie, Kodik (отдельный порт AMS, см. F),
W1, семантика availability, hostOrder, SSRF/allowHosts, store.js native/twin, E-Online-совместимость, прод.

**Правила соблюдены:** никаких fake-fixes (503→show/hide без доказательств, data-json→content, любой-ссылке-play);
deep-link follow только с bounded depth/cycle-protect/dedup; live-проверка обязательна (юнит-тесты недостаточны);
`npm test` после каждого фикса.

---

## B. Метод и окружение

- **Live-цель:** VPS shadow `:3210` (token `mo-admin-test-2026`), работает на **текущем коде рабочего дерева**
  (fpg-bundle.tgz). Shadow отдаёт proxy-URL на loopback `127.0.0.1:3210` → при внешнем прогоне loopback
  переписывается (FPG_REWRITE) на публичный `95.85.241.121:3210`, чтобы цепочка шла через те же ноды.
- **SSH недоступен** (banner exchange timeout при TCP-успехе) — только HTTP-зоouting. Прод :3000 и https 200.
- **Пробы:** `scripts/_fpg_verify_targeted.mjs` (RUmovie-2 5 фильмов, HDVB fresh, filmix Range, rhsprem),
  `scripts/_fpg_zelena_retry.mjs` (добор «Зелёной мили» с длинным таймаутом), `scripts/_fpg_kodik_ams_live.mjs`
  (реальный `KodikClient.parsePlayer` против публичной ссылки kodikplayer.com).
- Полная матрица поверх этого НЕ гонялась повторно (по указанию пользователя — результаты уже были).
- Юнит-фикстуры уже несли реальные live-пары (AMS src зашифрованный↔декодированный 17.08.2026).

---

## C. Приоритет 1 — RUmovie-2 (provider=rutubemovie), полная цепочка

Live на shadow (текущий код): `/videos` → items → `method=play` → proxy → master → variant → segment.

| Фильм (год) | items | Топ-item | Цепочка | Вердикт |
|---|---|---|---|---|
| Матрица (1999) | 3 | «The Matrix: Path of Neo (Часть 2)», «[BadComedian] МАТРИЦА 4»… | seg=206 MP2T ✓ (играют) | **Легит-гэп каталога** (Rutube не содержит полной копии 1999; подтверждено прямым поиском). items играбельны, но контент — шум → НЕ playback-gap, вне scope (качество поиска). |
| Интерстеллар (2014) | 1 | «Интерстеллар (2014)» | seg=206 MP2T ✓ | **ИГРАЕТ — правильный контент.** |
| Аватар (2009) | 3 | «Avatar 1 FULL MOVIE 2009 By James Cameron» | seg=206 MP2T ✓ | **ИГРАЕТ.** |
| Дюна: Часть вторая (2024) | 1 | «TEAM SPIDER MAN in REAL LIFE #3 \| JOKER 2…» (шум) | variant=m3u8 без сегментов | **Контент не Дюна** → вне scope; единичная мёртвая variant-ветка у шумового элемента, не gap для реального фильма. |
| Зеленая миля (1999) | 2 | «Зеленая миля 1999» (реальный фильм) | первый прогон: timeout; добор: variant транзиентно 500 → повтор 200 → seg=206 MP2T ✓ | **ИГРАЕТ.** Ранний timeout — транзиентный upstream (500 на variant), не код. |

**Вывод по RUmovie-2:** цепочка работает end-to-end для реального контента; 2/5 — правильный фильм играет,
1/5 — играбелен после транзиентного 500, 2/5 — легит-гэп каталога (контент отсутствует, а не сломан).
Регрессий с native-first/twin нет (store.js не трогали).

---

## D. Приоритет 2 — классификация реальных кандидатов A–F

Применена к live-кандидатам (не к полной матрице — она уже отработана ранее):

| Источник | Кандидат | Live-результат | Класс | Вердикт |
|---|---|---|---|---|
| HDVB (свежие 2024–2025) | voice-массив в POST-playlist вместо m3u8 | Дэдпул и Росомаха / Гладиатор II / Супермен → items=1 «…» voice «Дубляж», seg=206 MP2T ✓ | **найден C-класс → исправлен** | До фикса свежие фильмы отдавали JSON-массив голосов, который не превращался в m3u8 (master не открывался). После `voiceFile`+`preferYear` — играют. См. F. |
| filmix | items>0 → proxy/upstream | items=10, Range на upstream = **206/video/mp4** | **F-eliminated** | «Не скачивается» было артефактом probe-пробы без Range (полный GET на CDN виснет). Реальный клиент ходит с Range → играбельно. Кода не требует. |
| rhsprem | show:true → контент | sources/card count=21, `skaz-rhsprem show:true`; `/videos` items=18 | — | Контент есть, НЕ потерянный. |
| rutubemovie Дюна 2 | items>0, chain dead | content-noise; variant без сегментов | вне scope | Шумовой элемент, не реальный фильм (см. C). |
| rutubemovie Зелёная миля | timeout | транзиентный 500 → повтор играет | временный | Транзиент апстрима, не код. |
| kinopub/veoveo/alloha | (из прошлых прогонов матрицы) | >0 иначе классифицировано ранее | см. прошлые волны | Без изменений. |

**A/B/D/E-классы на live-кандидатах не воспроизвелись** (нет провалов resolve-no-URL; нет proxy-блоков —
solodcdn в allowlist, rutube-цепи через proxy 206; variant/segment — только у шумового элемента).

---

## E. Приоритет 3 — доказанные lost-content (show:true → items=0)

Целенаправленный поиск по live: **ни одного кейса потерянного контента не подтверждено.**

- Матрица 1999 (rutubemovie): items=**3** (не 0), но контент-шум → это не потеря (каталог Рутубы не содержит фильм),
  задокументировано как легит-гэп ([[rutube-normalizer-audit-001]], [[last-house-fn-audit-001]]).
- PidTor/ДДс: магнит-фильтр `isTorrentDescriptor` честно отдаёт `items:[]` (TASK-SOURCES-007) — not lost, torrent-модель.
- Deep-link follow (коллекции/роли): bounded depth + cycle-protect + dedup применены в pre-outage пробах
  (`_probe_deep*.mjs`); новых потеряшек не выявлено.

---

## F. Найденные реальные gaps и фиксы (код этой волны)

### F.1 HDVB — свежие фильмы отдавали voice-массив, а не m3u8 (C-class, FIXED)
- **Root:** `apivb.com` для свежих релизов возвращает в POST-playlist JSON-массив голосов
  `[{title,id,translator,file}]` вместо традиционного m3u8-плейлиста; без публично закрытого HDVB_TOKEN
  старый путь не вытаскивал файл → master не открывался.
- **Фикс:**
  - `HDVBNormalizer.voiceFile(folders)` — выбор из voice-массива файла с `/дубляж/`, иначе первый `cleanFile()`.
  - `HDVBProvider.resolvePlaylist` — после итерации `nextFile` при `!parsed.m3u8 && folders` делает
    `POST(voiceFile)` → текст → m3u8.
  - `HDVBProvider.videos` — для фильмов `preferYear(records, query)`: год из запроса поднимает совпавшие
    записи наверх (fix декоев и неверного года «Дэдпула и Росомахи» vs «Дэдпула»).
- **Live-доказательство (shadow, текущий код):** 3/3 свежих → правильный год, voice=«Дубляж [Чистый звук]`,
  цепочка до сегмента 206 MP2T ✓. До фикса (тот же shadow, diff) свежие не резолвились.
- **Тесты:** `hdvb-provider.test.js` +89 (TITLE_SEARCH_MATRIX, preferYear-матрица, VOICE_IFRAME/VOICE_LIST/VOICE_M3U8,
  подсчёт POST `/gladiator2`+`~dub-file`).

### F.2 Kodik — AMS-плеер 2026+ (порт VideoParse, FIXED, live-доказан)
- **Root:** upstream перешёл на AMS: inline `{links}` и video-links отсутствуют (KODIK-AMS-UPSTREAM-2026-08-17).
- **Фикс:** `KodikClient.amsStreams` — 1) var-глобалы страницы (domain/d_sign/pd/pd_sign/ref/ref_sign +
  vInfo.type/hash/id); 2) POST-эндпоинт из `app.player_*.js` (`type:"POST",url:atob("…")`, кэш);
  3) POST `{linkHost}{uri}` с глобалами; 4) `decodeAmsLinks` → src shift+18 → URL-base64 → реальный m3u8.
  Путь включается когда `secretToken` пуст (как Lampac Controller.cs line 162).
- **Live-доказательство (локальный GET к kodikplayer.com, РЕАЛЬНЫЙ клиент, без токена):**
  `parsePlayer('https://kodikplayer.com/video/726/041d96e0573412e4db1de4a8e425ff91/720p')` →
  4 качества (240/360/480/720), расшифрованные src `p12.solodcdn.com/s/m/…`; первый src = m3u8 200
  (text/plain, 57 591B, `#EXTM3U`) → AMS-резолв работает.
- **Playback-ветка:** `solodcdn.com` уже в allowHosts (KODIK-PLAYBACK-FIX-001 `37b742d`) → цепочка до сегмента
  через прокси покрыта, `proxy_host_forbidden`=0.
- **Ограничение (честно):** ветка `secretToken` non-empty (`directStreams` через `/api/video-links`) требует
  KODIK_SECRET_TOKEN — статус неизвестен, live не проверить без SSH. Наблюдаемый прод-канал = no-secret AMS-путь.
- **Тесты:** `kodik-client.test.js` +99 (AMS-фикстуры с реальной парой src 17.08.2026, POST-body, декод, 502).

### F.3 HDVB — title-only пусто при RU-названии с римскими цифрами (HDVB-TITLE-ONLY-001, FIXED)
- **Кейс:** «Гладиатор II» (2024, kp 1207839): title+year → items=0, KP-id → playable.
- **Root (доказано):** upstream `apivb.com/api/videos.json?token=…&title=Гладиатор II` → **200 байт=2, records=0** —
  поиск апстрима не находит RU-название с римской «II», но находит тот же фильм под `title=Гладиатор 2`,
  `title=Gladiator II` и `id_kp=1207839` (одинаковые 3 записи kp=1207839, 2024). Реальный клиент шлёт
  `title`+`original_title`+`year` (maniya-online.js addMovieParams), и `fetchData` брал только `title`.
- **Fix (минимальный, `HDVBProvider.fetchData`):** при `kp=0` и пустом результате первичного title-поиска —
  один ретрай с `query.original_title` (если отличается). Не fuzzy: альтернативное точное название той же
  карточки, не расширяет по подобию, декаев не добавляет; `preferYear` по-прежнему отбирает год → фильтр не ослаблен.
- **After:** title+year → 3 записи (Дубляж [Чистый звук] первой) → iframe → playlist POST → resolvePlaylist →
  подписанный m3u8 → master (360/480/720/1080) → variant 280 523B → **segment Range 206 MP2T** ✓ (локальный
  live, реальный клиент, тот же публичный Lampac-токен). До фикса — `{"items":[]}`.
- **Тесты:** `hdvb-provider.test.js` +2 (ретрай с original_title → цепочка; пустой original_title → без ретрая).

---

## G. Deep-link follow

ID-ленежки в роли/коллекции follow только с bounded depth (+1), cycle-protect (seen-set) и dedup.
Ни один такой кейс не привёл к найденному gap; правила соблюдены.

---

## H. Live-таблица воспроизведения (VPS shadow :3210, 2026-08-18)

| Цепочка | master | variant | segment | Итог |
|---|---|---|---|---|
| rutubemovie Интерстеллар | proxy 200 (m3u8) | 200 | **206 MP2T ✓** | ИГРАЕТ |
| rutubemovie Аватар | 200 | 200 | **206 MP2T ✓** | ИГРАЕТ |
| rutubemovie Зелёная миля | 200 | 200 (после 1× транзиентного 500) | **206 MP2T ✓** | ИГРАЕТ |
| HDVB Дэдпул и Росомаха | 200 | 200 | **206 MP2T ✓** | ИГРАЕТ (после фикса voiceFile) |
| HDVB Гладиатор II | 200 | 200 | **206 MP2T ✓** | ИГРАЕТ (после фикса) |
| HDVB Супермен 2025 | 200 | 200 | **206 MP2T ✓** | ИГРАЕТ (после фикса) |
| filmix Дэдпул и Росомаха | — | — | upstream **206/video/mp4** | ИГРАЕТ (медиа-MP4 через прокси, Range) |
| Kodik (AMS link) | m3u8 200 (57 591B) | — | — | src валиден; сегмент — solodcdn (allowHosts) |

Все сегменты — MP2T 206 ≤1024B (range-probe).

---

## I. Регрессия (финал, рабочий tree)

`cd server && NODE_ENV=test node --test` → **737 тестов / 731 pass / 0 fail / 6 skip** (после HDVB-TITLE-ONLY-001; +2).

---

## J. Файлы, вывод, ограничения

### Изменённые файлы (код и тесты этой волны; uncommitted)
- `server/src/providers/hdvb/HDVBNormalizer.js` — `voiceFile()` (+14)
- `server/src/providers/hdvb/HDVBProvider.js` — `resolvePlaylist` voiceFile-этап, `preferYear`, movies-ранжирование (+36/−1); HDVB-TITLE-ONLY-001: retry `original_title` при пустом title-поиске (+12)
- `server/src/providers/kodik/KodikClient.js` — AMS-порт: `amsStreams`/`playerPostUri`/`extractAmsVars`/`decodeAmsLinks`/`decodeAmsSrc` (+163)
- `server/test/hdvb-provider.test.js` (+89 +2 — HDVB-TITLE-ONLY-001)
- `server/test/kodik-client.test.js` (+99)

### Untracked рабочее (probe-скрипты, `.fpg-shadow/`, `server/scripts/`)
Probe-артефакты этой и предыдущих волн; в коммит волны не включались.

### Pre-existing uncommitted (НЕ этой волны)
`docs/{collaps,rutube-hd,rutube-normalizer-001/002}-fix-*-report.md` — §PRODUCTION-дополнения сессии 17.08
(коммиты 2d704fc/b11add8/5625223/04fa1dc уже в истории; сами дописки не закоммичены — зафиксировано, не трогаю).

### git status / diff (требование задачи)
```
 M docs/collaps-fix-001-report.md            (pre-existing, не этой волны)
 M docs/rutube-hd-fix-001-report.md          (pre-existing)
 M docs/rutube-normalizer-fix-001-report.md  (pre-existing)
 M docs/rutube-normalizer-fix-002-report.md  (pre-existing)
 M server/src/providers/hdvb/HDVBNormalizer.js   [+14]
 M server/src/providers/hdvb/HDVBProvider.js     [+36 −1]
 M server/src/providers/kodik/KodikClient.js     [+163]
 M server/test/hdvb-provider.test.js             [+89]
 M server/test/kodik-client.test.js              [+99]
 ?? .fpg-shadow/, scripts/_fpg_*.mjs и др. probe-скрипты, server/scripts/
```
`git diff --check` — warnings LF→CRLF для 9 файлов (Windows autocrlf; ошибок whitespace нет).

### Вывод
- **1 реальный gap найден и исправлен с live-доказательством:** HDVB свежие фильмы (voiceFile+preferYear) — 3/3 играют.
- **1 серьёзный upstream-миграционный gap устранён кодом и live-доказан:** Kodik AMS-порт — реальный клиент
  декодировал живую пару и получил m3u8; сегменты уже в allowHosts.
- **F-класс filmix устранён** (Range 206 — клиент Lampa играет), код не менялся.
- **RUmovie-2 А/Б/В-перепроверки:** цепочка работает; часть «глухих» кейсов — транзиент upstream, часть —
  легит-гэпы каталога (Матрица 1999), НЕ потерянный контент.
- **`show:true → items=0` потерянных — НЕ найдено** ни одного доказанного кейса.
- **Прод не менялся** (ни деплой, ни конфиг, ни env, ни restarts). Всё на VPS shadow.

### Ограничения
- SSH к VPS не работает (banner timeout) — часть статусов невозможно проверить напрямую на проде;
  shadow на том же коде дал нужные live-доказательства.
- KODIK_SECRET_TOKEN-ветка (`directStreams`) не проверена live (неизвестный статус), рабочий канал — no-secret AMS.
- Live только для свежих фильмов/малой выборки; полная матрица повторно не гонялась (по указанию пользователя).

**Решение не принимается об автоматическом деплое;** коммит/пуш/деплой — только по отдельному разрешению.

### Production-результат (release HDVB-TITLE-ONLY-001, 2026-08-18)

- Deploy commit `3e88765` (HDVBProvider.js + hdvb-provider.test.js) → `systemctl` перезапущен, nginx reload.
- **«Гладиатор II» без KP-id** (title+original_title+year): `/api/lampa/videos` → items=1 (Дубляж [Чистый звук]) →
  master 200 m3u8 → variant 200 (cdh-cdn `cdn2221.sevstar933krop.com`, allowlist по суффиксу) → **segment Range 206 MP2T** ✓.
- **Регрессия** («Дэдпул и Росомаха», title-only, год 2024 → preferYear мимо decoy): items=1 → master 200 → variant 200 →
  **segment Range 206 MP2T** ✓.
- **Динамический CDN-поддомен уже обслуживается автоматически:** `isHostAllowed` матчит корень `.sevstar933krop.com`
  (любой поддомен), `rewriteAttr` переписывает все URI в m3u8 на proxy-ссылки — завтрашний новый `cdn*` поддомен пройдёт
  без правок. Наблюдаемое раньше на этой проверке `403 proxy_host_forbidden` было артефактом проверочного скрипта
  (повторная обёртка уже переписанной proxy-ссылки), не сервера.
- Suite перед деплоем: 737/731/0/6. Push: только backup/master, backup/gap-012-veoveo. Origin не тронут.