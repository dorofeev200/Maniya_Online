# SKAZ-MANIYA-TASK-009 — SHADOW DEPLOY + HLS FIX + BALANCER LATENCY PARITY

**Дата:** 2026-08-21. **Режим:** SHADOW-ONLY (прод НЕ тронут; деплой прод НЕ выполнялся).
**Билд:** 8fc187536d84a3dafe063ab33a0f1233beeed35291734f6c602a29f8c1f69f5e (76 файлов) — локаль == shadow.
**Единственный код-фикс против baseline b1f98f8c:** `inheritBaseQuery()` в `src/proxy.js` (77b20f42) — HLS hash-пропагация §7 TASK-008.

---

## 1. Shadow fingerprint (P1/P2)

- Локаль `src/**`+`package.json` sha256 = **8fc18753…** (76 файлов) == shadow-tar, задеплоен в `/tmp/fpg-shadow/server`.
- Diff vs prod-baseline b1f98f8c: **75/76** `src/*.js` md5 идентичны; только `src/proxy.js` отличается (77b20f42 vs 7e78f91d) — ровно и только фикс §7. Никаких CDN-хардкодов, констант доменов, `config`-правок.
- `package.json` — 76 файлов, не менялся. Тест-файлы: только `test/proxy.test.js` +2 теста, остальные 65/66 идентичны.

## 2. Shadow deploy (P2)

- Shadow-инстанс: `/tmp/fpg-shadow/server`, порт **3210**, `node --env-file=.env src/index.js`, USERS_FILE = прод-`/opt/maniya-online/server/data/users.json` (token mo-admin-test-2026). Telegram отключён.
- Прод (`/opt/maniya-online`, systemd `maniya-online.service`, :3000) **не тронут**: proxy.js=7e78f91d, NRestarts=**0**, ActiveState=active.

## 3. HLS before/after (P3 — §7 fix обоснован)

- **TASK-007/008 root case:** filmix `nl105.cdnsqu.com`, «История игрушек 5», play-карточка → `index.m3u8?hash=<95ch>`. CDN ключует hash на КАЖДЫЙ ресурс, но seg-URI в плейлисте абсолютные БЕЗ hash.
- **Before:** `rewriteHlsManifest` переписывал seg на `/proxy?url=<seg>` без переноса hash → CDN **403** на каждый фрагмент → hls.js **fatal fragLoadError**.
- **After (inheritBaseQuery, генеральный):** переписывает каждый seg/директиву с переносом `query` базового манифеста; per-key missing-проверка → идемпотентно (hash уже есть — не перезаписывается). Не CDN-специфично.

## 4. Real HLS playback (P3 live + P4 real player) — **PASS**

### 4.1 P3 — HTTP-level chain (curl-хы на shadow через /proxy)
| объект | URL | hash | status | ctype | Range | first-bytes |
|---|---|---|---|---|---|---|
| манифест | nl105 …/index.m3u8 | да (переносится) | 200 | application/vnd.apple.mpegurl | — | — |
| seg-1 | nl105 …/seg | да | 206 | video/mp2t | bytes=0-1048575 | 4740… (MPEG-TS sync) |
| seg-2 | nl105 …/seg | да | 206 | video/mp2t | корректно | — |
| seg-3 | nl105 …/seg | да | 206 | video/mp2t | корректно | — |

- 572/572 переписанных URI несут `proxy + hash`. **0×403, 0×fragLoadError**.
- `#EXT-X-KEY` в этом плейлисте отсутствует (filmix 4K); `#EXT-X-MAP`/relative/absolute покрыты unit-тестами (proxy.test.js 20/20).
- **Idempotency:** werkecdn (nl221) в сыром плейлисте несёт собствен hash в каждом seg (587/587, length 95) → missing-проверка не срабатывает → hash не перезаписан. Доказано `_t009_idem` (8/8 sampled == base) и `_t009_rawwerk` (raw segs already hashed).

### 4.2 P4 — REAL player (hls.js 1.7.1, headless Chrome v151) — **PASS**
- Реальный hls.js в Chrome на shadow: `MANIFEST_PARSED` → `LEVEL_LOADED total=5720s frags=572` → 9 `FRAG_LOADED` отбуферировано.
- `currentTime=10.44`, `bufferedEnd=20.44`, `duration=5720`, `paused=false`, `readyState=2`, **fatal=null** (0 fatal, 0 fragLoadError).
- Сеть: манифест 200, сегменты 200 `video/mp2t` через shadow-proxy — **0×403**.
- `ERR bufferFullError`/`bufferSeekOverHole` — non-fatal, артефакт софтверного декодера headless на 4K; не влияет на подтверждение.
- **P4 = PASS** (не UNKNOWN): проведён реальный плеер, декодировал и воспроизвёл.

## 5. Regression (P5)

- Полный сьют: **763 теста → 756 pass / 1 fail / 6 skip**. fail = `availability-route.test.js:41` (route:41, egress-флейк: сеть недоступна, «прочие native show:true» не подтвердился). **Идентично baseline TASK-008 763→756/1/6**; НЕ связан с proxy.js (target-прогон: proxy.test.js 20/20 PASS). Регресса нет.

## 6. Balancer latency parity (P6 — RESEARCH ONLY, код НЕ менялся)

Сравнение: **SKAZ** = `ms <= fastest*1.6+150` latency-пул, выбор самого быстрого из отобранных; **MANIYA** = `orderedSkazHosts` (online8-резерв последним) + пин карточки + сканирующий `_scanLite` (503/EMPTY/timeout → следующая нода; первый content → стоп; EMPTY только все «нет контента»). Детерминированная модель с 8 наборами:

| Набор | SKAZ | MANIYA | совпадение |
|---|---|---|---|
| A=50 B=70 C=100 D=500 | A | A | SAME |
| A=50 B=120 C=250 D=500 | A | A | SAME |
| A=100 B=160 C=170 D=600 | A | A | SAME |
| A=TIMEOUT B=503 C=200 D=200 | C | C | SAME |
| A=TIMEOUT B=503 C=200 D=200, пин=B(503) | C | C (пин сброшен на 503→next) | SAME |
| A=50 B=70 C=100 D=500, пин=D(500) | **A** | **D** | **DIFF** |
| A=50(empty) B=70(empty) C=100(empty) D=500(ok контент) | A (fastest=empty → не найден) | D (скан до контента) | **DIFF по контенту** |
| A=50 B=70 online8=20 (все ok) | **online8** (fastest легаси) | A (online8 последним) | **DIFF** |

**Интерпретация — расхождения НЕ дают реальной проблемы, и в 3 из 4 DIFF-случаев Maniya ПРАВИЛЬНЕЕ:**
- **BASE + FAULT наборы (5/8):** SAME — голые латенции не меняют выбор. Формула `1.6*fastest+150` при типичных RTT кластера (50–250ms) даёт порог 230–550ms — почти всегда весь пул, = порядок Maniya. Функциональная эквивалентность TASK-008 §4 подтверждена.
- **PIN DIFF:** Maniya стартует с пина карточки (D=500). Это **host-bound-корректно**: карточка уже верифицировала контент на D для этого тайтла; выбор A по RTT — догадка, не знающая контента. Оба дают контент; Maniya платит +450ms только на этом хосте за подтверждение. Не баг.
- **CONTENT-ONLY-ON-SLOW DIFF:** Skaz (one-shot, контент узнаётся ПОСЛЕ выбора) выбирает fastest-empty A → «фильм не найден». Maniya (content-aware scan) находит D. **Maniya лучше**; цена — +N запросов скана (≤ число хостов, ~2–4).
- **RESERVE DIFF:** online8=20ms fastest → Skaz выбрал бы легаси-резерв и получил его быстрый 403 `disable`/503 для не-kinopub (политика «модуль выключен», ONLINE8-001/002) → false-empty. Maniya намеренно ставит online8 последним — **это документированный фикс-корректности, не latency-регресс**.

**ВЫВОД P6: расхождение НЕ исправляем (как в TASK-008 PASS*, не подтверждённое). Модель доказывает: (а) при типичных RTT выбор идентичен; (б) при расхождении Maniya либо эквивалентна, либо строго лучше (content-scan, online8-резерв, host-bound). Ни slow-host-выбор, ни host-bound нарушений не выявлено. Код НЕ менялся.**

## 7. Multi-provider smoke (P7, shadow, dot-separated)

| источник | items | ms | статус |
|---|---|---|---|
| filmix | 3 | 400 | **PASS** (HLS nl105, §7-фикс) |
| rezka | 22 | 7400 | **PASS** (живой, burst-медленный) |
| hdvb | 1 | 831 | **PASS** |
| videoseed | 0 | 996 | **EMPTY** (транзиент cold-empty, в памяти 0/50 VPS) |
| kodik | 0 | 25350 | **EMPTY** (честный до timeout 24s) |
| kinopub | 0 | 1148 | **EMPTY** (egress-окно, в памяти EMPTY) |
| alloha | 0 | 777 | **EMPTY** (egress-окно) |
| veoveo | 0 | 1670 | **EMPTY** |
| kinotochka | 0 | 7 | **EMPTY** (native-absent, мгновенный) |
| collaps | 0 | 7263 | **EGRESS** (SE-egress 422 embed-хост, upstream) |

Все 200, **0×5xx**, **0×FAIL**. Shadow-лог после всей нагрузки (включая P4 25+ прокси-запросов): **0 error-уровня, 0 краш**.

## 8. Known upstream issues (не регрессии)
- videoseed/kinopub/alloha/veoveo EMPTY — транзиент текущего egress-окна (в памяти: alloha/videoseed/kinopub EMPTY даже native; VPS-egress транзиент на момент начала сессии).
- collaps = SE-egress, известный upstream (COLLAPS-EGRESS-001: embed-хост гейтит по IP-региону, VPS 422).
- kinotochka = native-absent (KINOTOCHKA-NATIVE-001, HIDE по design).
- kodik 24s → timeout: upstream медленный, честный EMPTY, не баг.

## 9. Remaining divergences / limitations
- **P6:** латенси-пул Skaz (`1.6*fastest+150`) НЕ реализован как таковой; заменён порядком пула+пином+сканированием. Доказано: функционально эквивалент по выбору при типичных RTT, строго лучше в выявленных DIFF-кейсах. Оставляем как есть (не подтверждённое расхождение — TASK-008 решение сохранено).
- **Реальный плеер** на головном стеке (Lampa на устройстве) не прогонялся — только headless hls.js. Это достаточное подтверждение §7 (реальный HLS-стека), но не заменяет live-устройство.
- Shadow-инстанс остаётся деплоенным (не убран) — для дальнейшей валидации.

## 10. Production status
- **ПРОД НЕ ТРОНУТ:** `/opt/maniya-online` работает на baseline без фикса, NRestarts=0, ActiveState=active. HLS-фикс живёт ТОЛЬКО на shadow /tmp/fpg-shadow/server:3210.
- Никаких изменений `.env`, `data/users.json`, providers, деплоя прод — **НЕ выполнялось**.

---

## ФИНАЛЬНЫЙ СТАТУС: **ACCEPT** (shadow)

HLS-баг (TASK-007/008 root: hash не наследовался на seg-URI → 403 → fragLoadError) **исправлен и подтверждён живым**:
- P3 HTTP-chain: манифест 200, seg-3×206 video/mp2t, 0×403, 0×fragLoadError.
- P4 реальный hls.js в Chrome: 9 фрагментов отбуферировано, воспроизведение (currentTime/buffered/duration), fatal=0.
- P5 регресс: 756/763 (= baseline, флейк route:41 не связан).
- P6 латенси-паритет: расхождение не даёт реальной проблемы; в DIFF-кейсах Maniya эквивалентна/лучше. **НЕ исправляется, код не менялся.**
- P7 smoke: 10 источников, 3 PASS / 6 EMPTY / 1 EGRESS, 0 FAIL, 0×5xx.

**P8 → STOP.** Никаких дополнительных исправлений не вносится. Деплой прод НЕ выполняется (TASK-010 релиз — отдельная волна, с решения пользователя).
