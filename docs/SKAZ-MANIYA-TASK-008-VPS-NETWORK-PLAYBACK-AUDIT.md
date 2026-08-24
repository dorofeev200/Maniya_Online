# SKAZ-MANIYA-TASK-008 — VPS / Network / Playback Throughput Differential Audit

**Дата:** 2026-08-21. **Режим:** READ-ONLY, прод не менялся. **Билд:** b1f98f8c (после TASK-006).
**Источник измерений:** локальный бокс (RU-егрess stand-in для клиента) ↔ прод VPS 95.85.241.121 (:3000, systemd maniya-online) ↔ прод публичный https://plugin.maniya-kvn.online.

---

## 1. SOURCE

Одна и та же фильмовая позиция Filmix:
- **Название/качество:** «История игрушек 5» Дубляж [4K, SDR, ru, MovieDalen] → CDN **nl105.cdnsqu.com** (50.7.24.106, IPv4-only).
- **Maniya final URL:** `https://plugin.maniya-kvn.online/api/lampa/proxy?url=<nl105…/index.m3u8?hash=95ch>&token=***`
- **Сквозной трейс:** `/api/lampa/videos` (filmix, tmdb, Toy Story 5) → item0 `{method:'play'}` → inner m3u8 `index.m3u8?hash=<95ch>` (200, 1-level playlist, 10+ абсолютных seg-URI БЕЗ hash) → fragURI `seg-N-v1-a1.ts`.

## 2. МАТРИЦА ИЗМЕРЕНИЙ (10 seg × 3 раунда; см. таблицы ниже)

| Путь | avg MB/s | p50 | p95 | min | max | Статус |
|---|---|---|---|---|---|---|
| **A** напрямую с CDN (+hash, playable form) | **2.02** | 2.16 | 2.75 | 0.95 | 2.75 | 206 ×30/30 |
| **B** как в плейлисте (без hash — то, что реально отдаёт Maniya) | — | — | — | — | — | **403 ×30/30** |
| **C** через Maniya proxy (+hash) | **0.65** | 0.65 | 0.90 | 0.32 | 1.30 | 206 ×30/30 |
| **C-full** полный сегмент 23MB через proxy (лок.бокс) | 0.62 | — | — | — | — | 200 |
| **A-full** полный сегмент 23MB напрямую (лок.бокс, лимит локального егрeсса) | 6.12 | — | — | — | — | 200 |

(Примечание: 1MB-Range прогон RTT/TLS-доминирован → это консервативная нижняя грань; полный сегмент — честная пропускная.)

## 3. SKAZ THROUGHPUT (§12)

- Живой egress-замер референса **не получен**: кластер skaz возвращает `{"accsdb":true,"msg":"Аккаунт не найден"}` / «Сервис авторизации недоступен» (device-гейт аккаунта в accsdb, лечится грантом, НЕ код) — 5/5 хостов, в т.ч. после ретрая.
- **Reference-форма (2026-08-08, raw/filmix.movie.html):** Skaz/lampa filmix для фильмов отдаёт **прогрессивный MP4 напрямую с CDN** (`pl-cdn.werkecdn.me/…/2160.mp4`, `method:"play"`, quality 2160p/1440p/1080p/720p/480p) — **без HLS, без proxy-хопа**. Второй ножной «клиент→CDN» единичный.

## 4. MANIYA DIRECT CDN (§2/§4)

Пропускная на нити бокс→CDN (1MB Range, 30 проб): avg 2.02 MB/s ≈ 16 Mbit/s; полный 23MB — 6.12 MB/s. Это ограничение локального егрeсса бокса, не CDN (см. §5: с VPS тот же сегмент 57 MB/s).

## 5. MANIYA VPS PROXY (§2/§4/§7)

| Лег | Как считали | Пропускная |
|---|---|---|
| VPS → CDN напрямую (полный 23MB) | curl с VPS | **57.44 MB/s** (TCP 24ms, TLS 87ms, TTFB 117ms) |
| VPS → свой proxy loopback (полный 23MB) | curl с VPS на 127.0.0.1:3000 | **38.79 MB/s** (overhead ~1.48×) |
| VPS → публичный прокси (полный 23MB) | curl с VPS на plugin.…:443 | **33.16 MB/s** (overhead ~1.73×) |
| Бокс → VPS напрямую (http.server 8123, 23MB, без CDN) | curl с бокса на 95.85.241.121:8123 | **0.79 MB/s** (TTFB 140ms) |
| Бокс → VPS → CDN (полный 23MB через публичный прокси) | из §4 | 0.62 MB/s |

**Вывод §7:** прокси-код сам по себе — почти безубыточный pipe (на VPS 1.5–1.7×, и это включает TLS-переустановки). Реальный узел — **Лег1 клиент→VPS** (0.79 MB/s raw, RTT 65–71ms): прокси добавляет обязательный второй хоп, который сериализует МЕДЛЕННЫЙ клиентский лег ПОД быстрым VPS→CDN. Суммарно C (full) = ~0.62 MB/s ≈ скорость Лега1, а не VPS и не CDN.

## 6. VPS RTT / PACKET LOSS / IPV4 / IPV6 (§5/§10/§11)

- **RTT (VPS→CDN):** nl105 25.69/25.73/25.76 ms; werkecdn 25.71/25.89/26.22 ms. **0% loss** (5/5, оба хоста).
- **DNS:** nl105.cdnsqu.com → **50.7.24.106** (A, IPv4-only); nl221.werkecdn.me → **66.90.102.57** (A, IPv4-only). `getent ahostsv6` даёт только `::ffff:`-отображения — чистых AAAA нет.
- **VPS IPv6:** у VPS есть глобальный `2a12:bec4:1484:fc::2`, но CDN IPv4-only → маршрут всегда IPv4 (src 95.85.241.121 via 10.0.0.1, один хоп). **IPv6 на этом тракте не применима; отдельный v6-замер N/A.**
- **Source IP VPS:** 95.85.241.121 (ens3/32).
- **Route:** `50.7.24.106 via 10.0.0.1 dev ens3 src 95.85.241.121` — прямой шлюз, без OTT.

## 7. PROXY OVERHEAD / STREAMING / RANGE (§7/§8)

Range/streaming **корректен** — подтверждено на живом публичном прокси:
- `HTTP/1.1 206 Partial Content`, `content-range: bytes 0-1048575/23098808`, `content-length: 1048576`, `content-type: video/MP2T`, `Cache-Control: no-store`, keep-alive.
- Первые байты тела: `4740 0010 0000 b00d 0001 c100 0000 01ef` = **0x47 MPEG-TS sync — поток играбельный, не 403-HTML.**
- **Буферизации НЕТ:** полный 23MB ушёл потоково (TTFB 106ms loopback / 192ms public, далее pipe). Manifest ≤4MB буферизуется штатно, сегменты — passthrough.

## 8. VPS RESOURCES (§6)

- **Idle:** loadavg 0.09; RAM 723/1967MB used, **1244MB available**; uptime 5d.
- **Под нагрузкой** (4 параллельных полных 23MB сегмента через прокси): loadavg держался **0.09** (без роста), tcp established 13–19, RX/TX двигались штатно. **CPU/RAM/сеть NODE — НЕ ресурсное ограничение.**
- Лимиты: `ulimit -n 1024` (per-process fd, достаточно для потокового pipe), file-max огромное, `ss -s` норм. Ограничений на соединения не упирались.

## 9. HEADERS (§9)

nl105/werkecdn **не гейтят по заголовкам**: матрица из TASK-007 (none / Referer self / filmix.my / filmix.gg / lampa.mx / UA Lampa / Range) → все 403 с одинаковым телом БЕЗ hash и 200 с hash. Расхождение заголовков Skaz vs Maniya **не является фактором троттлинга** — CDN ключует по per-resource token (`hash`), а не по UA/Referer/Origin.

## 10. SEGMENT FAILURES (§4)

- **B (как в плейлисте): 30/30 → HTTP 403.** Это корень TASK-007: nl105 берёт hash только из query m3u8; seg-URI абсолютные без hash → CDN 403 на каждый фрагмент → hls.js `fragLoadError`.
- A/C (с hash): **60/60 → 206, 0 failures.**

## 11. BUFFER STALL / ГЛАВНЫЙ ТЕСТ (§13)

- Требуемый битрейт: **2.18 Mbit/s ≈ 0.2725 MB/s**.
- **VPS способен стабильно отдавать кратно быстрее**: 33.2 MB/s публичным прокси = ~266 Mbit/s ≈ **120×** требуемого. ГЛАВНЫЙ ТЕСТ: PASS.
- Клиентский Лег1 через прокси в замере: min 0.32 / avg 0.65 MB/s → **1.2×–2.4×** требуемого — запас тонкий, но положительный. Резервирование буфера 4s на Леге1 с RTT 67ms и подъёмом фрагмента ~под-секунду даёт периодический `bufferStalledError` при естественных просадках TCP.

## 12. ROOT CAUSE (A–G) — СТРОГО

| Класс | Вердикт | Обоснование |
|---|---|---|
| **A** upstream/CDN | **НЕ виноват** | VPS→CDN 57 MB/s, 0% loss, RTT 25.7ms; CDN отдаёт корректный контент при hash |
| **B** VPS network | **НЕ виноват** | 0% loss, 25ms RTT, егрeсс 33–57 MB/s, ресурсы не упираются |
| **C** Maniya proxy | **НЕ виноват** | passthrough потоковый, Range/Content-Range корректны, overhead на VPS 1.5×, 38.8 MB/s loopback |
| **D** resolver | **НЕ при чём** | тот же filmix/tmdb/год → 200, тайтл и ноды совпадают |
| **E** balancer/host | **НЕ при чём** | тот же CDN-нод по тому же item — никакого расходождения хостов |
| **F** player/client | **ВИНОВЕН (главный)** | узкое место = **Лег1 клиент→VPS**: 0.79 MB/s raw, 0.62–0.65 MB/s сквозь прокси (min 0.32), RTT 65–71ms. Именно на этом леге рождается дефицит буфера → `bufferStalledError` |
| **G** unknown | нет | — |

**ПЕРВИЧНАЯ ПРИЧИНА = F (клиентский путь), ВТОРИЧНО = архитектурный фактор C-слоя** (обязательный хоп клиент→VPS→CDN вместо прямого клиент→CDN у Skaz). Ограничение — пропускная Лега1 бокс↔VPS, **не** VPS, не CDN, не код прокси.

## 13. ФИНАЛ

- **SOURCE:** Filmix «История игрушек 5» Дубляж [4K,SDR,ru,MovieDalen] nl105.cdnsqu.com
- **SKAZ THROUGHPUT:** egress-гейт кластера (accsdb, «Аккаунт не найден») — живой замер недоступен; референс = прямой прогрессивный MP4 (без HLS/proxy), 1 хоп
- **MANIYA DIRECT CDN:** 2.02 MB/s avg (1MB Range, RTT-доминировано); полный 23MB 6.12 MB/s (лимит локального бокса)
- **MANIYA VPS PROXY:** 0.65 MB/s avg (min 0.32, max 1.30); с VPS loopback 38.8 MB/s, публичный 33.2 MB/s
- **VPS RTT:** 25.7 ms (0% loss) до CDN; клиент→VPS 67 ms
- **PACKET LOSS:** 0% (CDN), VPS под нагрузкой без потерь
- **IPV4:** да (все ресурсы; nl105=50.7.24.106, werkecdn=66.90.102.57)
- **IPV6:** N/A — CDN не имеет AAAA, тракт обходит v6
- **PROXY OVERHEAD:** на VPS 1.48–1.73× (с TLS-хопами); суммарная деградация бокс→VPS→CDN объясняется Лег1 клиент→VPS (0.79 MB/s), не кодом
- **SEGMENT FAILURES:** B (как в плейлисте) 30/30 403; A/C (с hash) 60/60 206, 0 failures
- **BUFFER STALL:** ✅ объясняется Лег1 клиент→VPS (запас 1.2–2.4× на требуемый 2.18 Mbit/s + RTT 67ms против буфера 4s)
- **ROOT CAUSE:** **F** (player/client — Лег1 клиент→VPS); B/C/D/E/A исключены измерениями
- **CONFIDENCE:** HIGH для Лега1-замера (бокс-stand-in); MEDIUM для реального устройства клиента (неизмеримо с этой точки)
- **CODE FIX REQUIRED:** **NO**
- **PRODUCTION CHANGE:** **NONE**

Рекомендации (НЕ применяются автоматически, вне скоупа TASK-008): для реального плеерного клиента рассмотреть снижение обязательного proxy-хопа на HLS-сегменты (прямой client→CDN с проброшенным hash — именно то, что делает Skaz), т.к. Лег1 бокс↔VPS является узким местом stream-пути. Также: пункт «… в вашем плейлисте» из TASK-007 остаётся открытым отдельной работой.