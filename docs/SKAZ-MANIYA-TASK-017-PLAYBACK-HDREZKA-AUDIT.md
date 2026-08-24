# SKAZ-MANIYA-TASK-017 — FULL PLAYBACK + HDREZKA FAILURE AUDIT

**Дата:** 2026-08-22. **VPS:** Production Moscow `135.106.195.203` (4vCPU/8GB), OLD Amsterdam `95.85.241.121` (только для сравнения).
**Метод:** GET-only диагностика через реальный клиентский путь `plugin.maniya-kvn.online → Moscow`. Код/config/.env/nginx/providers НЕ МЕНЯЛИСЬ.
**Правило соблюдено:** только диагностика; фиксы не предлагаются до доказанного FIRST BOTTLENECK/FIRST DIVERGENCE.

**DETAILS:** `docs/8548057a/t017` — отчёты. **ВСЕГО ТАБЛИЦА** в конце.

---

## ЧАСТЬ 1. BASELINE (Production Moscow)

| Метрика | Значение |
|---|---|
| Служба | active, NRestarts=0 |
| health | 200 |
| egress Mbps (общий) | ~114.8 MB/s (TASK-014) |
| VPS→CDN (vkvideo) | **43–81 MB/s** (замер: 4 сегмента 3.4–5.1 MB, total 0.054–0.076s, HTTP 200) |
| nginx log | 14311 строк 200; error.log чист (только [notice] inherited sockets) |

---

## ЧАСТЬ 2. SYMPTOM A — ViruseProject / VirusProject (stall на TV)

### 2.1 Обнаружение реального источника

Реальный поток TV-пользователя найден:

- **Фильм:** Мятеж (Mutiny, kp id `1288445`, imdb `tt32338669`, 2026).
- **Провайдер (голос):** `skaz-alloha` → голос **«ViruseProject»** (voice index 1). Обнаружен в `/api/lampa/videos?provider=skaz-alloha&id=1288445` (11.0s; 5 call-голосов: HDrezka Studio / ViruseProject / HDrezka Studio.18+ / Оригинальный / Субтитры).
- **Play URL (иначе реальная TV-play ссылка):** `https://plugin.maniya-kvn.online/api/lampa/proxy?url=…97-65-e1-r502.vkvideo.cloud/…/index-f1-v1-a1.m3u8` (получено через `/api/lampa/video` с `voice=1`, 10.6s → `{method:play}`).

Реальное воспроизведение на TV подтверждено логом nginx: запросы `/proxy?url=…vkvideo.cloud` с TV IP `178.173.126.235` на той же сущности (97-65-e1-r502.vkvideo.cloud, Mutiny) в окне сессии.

### 2.2 Характеристика потока (~3.33 Мбит/с, манифест, уровни, сегменты)

| Параметр | Значение |
|---|---|
| Тип | HLS VOD (fMP4), X-EXT-MAP init |
| Master | **1 уровень**: BANDWIDTH=**5209540** (≈5.2 Мбит/с), 1920x960, 23.974 fps, SDR |
| Media | EXT-X-TARGETDURATION 10, MEDIA-SEQUENCE 1 |
| Сегменты | `seg-<N>-f1-v1-a1.m4s`; ~954 шт.; sumDur ≈ **5704 c**; avg ≈ **6.0 с** |
| Фактический битрейт (через прокси, 30 сегментов) | **100.5 MB / 180 c = 4.68 Мбит/с** (VBR; TV показывал ~3.33 Мбит/с hls.js-оценка — соответствует VBR-среднему) |
| ABR-лестница | **НЕТ** — единственный rung в master. hls.js не может снизить качество при нехватке ширины. |

### 2.3 Замеры сегментов (реальный путь TV: клиент→Moscow proxy→vkvideo.cloud)

Через прод-прокси, 30 последовательных сегментов (Mutiny, seg 1–30):

| Метрика | Значение |
|---|---|
| Статусы | 27×200 + 3×timeout (>30 с, status=0) |
| Fetch-время | avg **9.3 с**, p50 **9.0 с**, p95 **23.8 с**, worst **24.3 с** |
| Длительность сегмента | ~6 с |
| **Буферная безопасность** | **6 с / 9.3 с = 0.65 < 1** → плеер не поспевает → bufferNudgeOnStall / fragLoadTimeOut |
| Прямой доступ (CDN vkvideo.cloud, raw URL) | **403 на все 30 сегментов даже с `Origin: http://lampa.mx`** (URL-подпись vkvideo.cloud привязана к CDN-сессии; прямой путь архитектурно закрыт, прокси-хоп обязателен) |

### 2.4 Классификация HTTP 499 (nginx, TV-сессия 178.173.126.235)

| Запрос | Кол-во | Класс |
|---|---|---|
| /api/lampa/videos (rezka) | 68 | **A (клиентский disconnect)**: /videos отвечает 200 только через ~21с, Lampa TV обрывает на ~15с → 499. Статус nginx 499 = «client closed connection» |
| /api/lampa/proxy (vkvideo, cdntogo) | 2 | **A**: Lampa прервала медленный сегмент-ответ (тот же класс, что fragLoadTimeOut) |
| /api/lampa/video, /sources/card | 2 | A (единичные, тот же таймаут-класс) |

- 3 из 72 499 = мои тестовые запросы (token mo-admin-test-2026), остальные 69 — реальный TV.
- nginx log_format не содержит `$request_time`/`$upstream_response_time`, поэтому классификация опирается на: статус 499 (код nginx только для закрытия соединения клиентом — класс A/B), измеренную латентность компаньон-ответов (21с /videos, ~9с proxy-сегменты), отсутствие записей upstream 5xx/502/504 (Server/upstream не обрывали). Category: **A — клиентский disconnect** (та же категория, что `fragLoadTimeOut` fatal=false: hls.js прервал фрагмент, Lampa закрыл соединение).

### 2.5 Разделение плечей (доказательство «клиентская нога»)

| Нога | Замер | Результат |
|---|---|---|
| **VPS→CDN** (vkvideo, с VPS-сервера) | 4 сегмента 3.4–5.1 MB | **200, total 0.054–0.076с, 43–81 MB/s** → не узкое |
| **Клиент→VPS** (локальный → прод proxy) | 30 сегментов | p50 fetch 9.0с на 3.4–5.1 MB → eff **2.9–3.5 Mbps** |
| **Агрегат при параллели** | conc=20 (240 req) | 238 ok, eff **47.8 Mbps** → сервер/CDN/nginx не узкие; пер-коннекшн ~3 Mbps — клиентская нога |

Per-request доказательство: при conc=1 eff 3.1 Mbps, при conc=20 eff 47.8 Mbps. Агрегат растёт кратно, пер-коннекшн остаётся ~3 Mbps → узкое место = **per-connection клиентская нога (ISP/маршрут клиент→Moscow)**, не прокси/nginx/VPS/CDN.

### 2.6 Конкурентная нагрузка (playback-like)

| conc | reqs | ok | timeout | p50 fetch | eff Mbps |
|---|---|---|---|---|---|
| 1 | 24 | 23 | 1 | 9.3с | 3.1 |
| 20 | 240 | 238 | 2 | 11.5с | 47.8 |
| 80 | 320 | 13 | 307 | 11.9с | 3.3 |

- Первый load-тест (800 req, 600с) завис/убит — сам по себе диагностический (последовательный поток сегментов ~9с не успевает за 6с длительности).
- conc=80: CDN/upstream троттлинг на пачке (vkvideo), не сценарий одиночного TV.

### Итог SYMPTOM A

- **FIRST BOTTLENECK:** клиентская нога `клиент→Moscow VPS` (per-connection throughput ~2.9–3.5 Mbps) НИЖЕ фактического битрейта потока 4.68 Mbps; ABR-лестницы нет (1 rung в master) → hls.js не может подстроиться.
- **EVIDENCE:** сегмент fetch p50 9.0с (>6с длительности), buffer safety 0.65; VPS→CDN 43–81 MB/s; conc=1 3.1 vs conc=20 47.8 Mbps; direct CDN 403 (архитектурно закрыт); 499 на TV = client abort.

---

## ЧАСТЬ 3. SYMPTOM B — HDrezka («Видео не найдено или повреждено»)

### 3.1 Воспроизведение (реальный TV-путь)

| Title | /videos provider=rezka | items | skaz-rezka | items |
|---|---|---|---|---|
| Мятеж | 200 **43.8с** | 0 | 200 21.1с | 0 |
| История игрушек 5 | 200 **22.5с** | 4 call | 200 21.0с | 0 |
| Интерстеллар | 200 **31.1с** | 10 call | 200 21.1с | 0 |
| Форрест Гамп | 200 **31.3с** | 22 call | 200 21.9с | 0 |

Все ответы 200 — сервер НЕ ошибается; латентность 21–44с из-за inherent rezka-флоу (native Anubis-PoW + AJAX-цепочка `RezkaClient.js` ANUBIS_VERIFY_COOKIE / `RezkaProvider` resolveRecord→fetchMovieStreams по каждому переводчику).

### 3.2 Полная цепочка 3 контрольных title (sources → availability → resolve → play → proxy → media)

| Title | /videos | /video (resolve) | manifest через proxy | segment через proxy |
|---|---|---|---|---|
| История игрушек 5 | **21.7с** | 0.7с play (voidboost.one HLS) | 0.7с 200 (424KB) | 200 **19.5с** (2.2MB) |
| Форрест Гамп | **21.7с** | 0.7с play | 1.6с 200 (631KB) | 200 **6.8с** (2.7MB) |
| Интерстеллар | **21.7с** | 0.7с play | 2.6с 200 (743KB) | 200 **2.7с** (1.3MB) |

**FIRST DIVERGENCE: `/api/lampa/videos` — единственное звено с латентностью > клиентского таймаута.** Resolve/play/proxy/media мгновенны.

### 3.3 OLD vs Moscow (миграция не виновата)

| Title | OLD | Moscow |
|---|---|---|
| История игрушек 5 | 200 21.2с | 200 21.1с |
| Интерстеллар | 200 21.0с | 200 21.0с |

Идентично → **НЕ регрессия миграции**: inherent upstream-латентность rezka.

### 3.4 Mojibake (артефакт)

В раннем репро 4 call-титула были с `%EF%BF%BD` (двойной UTF-8). В свежем замере 4 title: **0 mojibake**. Артефакт/транзиент upstream-ответа, не корень.

### 3.5 Клиентская сторона

TV показывает «Недоступен или ошибка в адресе» → «HDrezka Studio» → «Видео не найдено или повреждено». Механика: Lampa (TV) обрывает запрос на ~15с → nginx 499 (68 записей на /videos в сессии, см. 2.4) → клиент классифицирует как ошибку источника.

### Итог SYMPTOM B

- **FIRST DIVERGENCE:** `/api/lampa/videos?provider=rezka` отвечает только через **~21с** (upstream inherent: Anubis+AJAX), TV aborts на ~15с → 499 → «Видео не найдено или повреждено».
- **ROOT CAUSE:** комбинация **A×H** (upstream rezka латентность × Lampa client timeout 15с). НЕ регрессия миграции (OLD идентичен).
- **EVIDENCE:** 4-title замер 21.7–43.8с; OLD=MOS 21.0с; цепочка resolve/play/manifest 0.7–2.6с; 68×499 на /videos у TV; skaz-rezka twin тоже 21с+0 items (не спасает).

---

## ЧАСТЬ 4. COMMON ROOT CAUSE

**NO.** Механизмы независимы:
- SYMPTOM A: дефицит пропускной клиентской ноги (2.9–3.5 Mbps) при потоке 4.68 Mbps и без ABR.
- SYMPTOM B: inherent 21с латентность rezka-флоу vs 15с клиентский таймаут Lampa.

Оба проявляются как «замедление в первом хопе после клиента», но причины разные (bandwidth vs latency) и не связаны с миграцией на Moscow (A: VPS↔CDN 43–81 MB/s; B: OLD идентичен).

---

## ФИНАЛЬНЫЙ ВЕРДИКТ

| SYMPTOM | FIRST DIVERGENCE | ROOT CAUSE | EVIDENCE | STATUS |
|---|---|---|---|---|
| A: ViruseProject stall | Поток 4.68 Mbps > eff. per-connection client→Moscow 2.9–3.5 Mbps (segment fetch 9.3с > 6с dur); ABR-лестницы нет | Клиентская нога (ISP/маршрут клиент→Moscow) + single-rung master | VPS→CDN 43–81 MB/s; conc=1 3.1 vs conc=20 47.8 Mbps; direct CDN 403; buffer safety 0.65; 2×499 proxy | ACCEPT |
| B: HDrezka «видео не найдено» | /videos provider=rezka ~21с (upstream) > Lampa timeout 15с → 499 | A×H combo: inherent rezka latency (Anubis+AJAX) × client abort; НЕ миграция | 4-title 21.7–43.8с; OLD=MOS 21.0с; resolve/manifest 0.7–2.6с; 68×499; twin 21с+0 | ACCEPT |

## VIRUSPROJECT

FIRST BOTTLENECK = Клиентская нога client→Moscow VPS (per-connection ~2.9–3.5 Mbps < 4.68 Mbps потока) при отсутствии ABR-лестницы
EVIDENCE = segment fetch p50 9.0с > 6с dur (buffer safety 0.65); VPS→CDN 43–81 MB/s; conc=1 3.1 vs conc=20 47.8 Mbps; direct CDN 403; TV 499 client abort

## HDREZKA

FIRST DIVERGENCE = /api/lampa/videos?provider=rezka отвечает через ~21с (inherent upstream) — превышает Lampa TV timeout ~15с → 499 → «Видео не найдено»
EVIDENCE = 4-title 21.7–43.8с; OLD≡MOS 21.0с (не миграция); resolve/manifest 0.7–2.6с; 68×499 /videos у TV; skaz-rezka twin 21с+0 items

## COMMON ROOT CAUSE

NO (A=bandwidth клиентской ноги, B=upstream latency × client timeout)

## PRODUCTION CHANGES

NONE