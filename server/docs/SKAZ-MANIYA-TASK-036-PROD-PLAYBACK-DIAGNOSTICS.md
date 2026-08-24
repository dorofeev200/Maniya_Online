# SKAZ-MANIYA-TASK-036 — PROD PLAYBACK DIAGNOSTICS (FIRST BOTTLENECK)

**Статус:** ✅ ДИАГНОСТИКА ЗАВЕРШЕНА, **FIRST BOTTLENECK = НАЙДЕН ЧИСЛАМИ**. PROD НЕ ТРОНУТ
(ни код, ни nginx, ни proxy, ни providers, ни рестарты). STAGING не тронут. **HARD STOP.**
**Дата:** 2026-08-23. **Стенд:** REAL PROD plugin.maniya-kvn.online (135.106.195.203).

## Вывод (одно предложение)

**FIRST BOTTLENECK = сетевой путь PROD-сервер → клиент: пропускная способность одного TCP-
соединения от VPS к клиенту ~0.1–0.2 MB/s** (сырой ssh dd: 0.11 MB/s; `/api/lampa/proxy`:
0.06–0.16 MB/s), при том что:
- VPS-внутренний прогон того же `/proxy` того же URL: **15–21 MB/s** (код/nginx/node стримят на
  полной скорости);
- клиент → тот же CDN НАПРЯМУЮ: **0.9–2.24 MB/s** (в 10–14× быстрее, чем через прокси с этого пути);
- RTT до PROD 45ms, до CDN 82ms, потерь на raw-IP пинге 0% (на hostname 2/15 = 13%).

Это не «сеть вообще медленная» и не наш стек: узкий сегмент — маршрут подписчик ↔ VPS
(egress VPS/ISP-маршрут). Плеер через `/proxy` получает первый байт быстро (TTFB 250–460ms),
но буфер наполняется со скоростью 0.06–0.16 MB/s → «начинает очень медленно или никогда».

## Проблема (жалоба пользователя)
На PROD любой источник на карточке «Форрест Гамп» начинает играть очень медленно или никогда.

## Что измерено (живой wire, карточка gump kp=448 imdb=tt0109830, токен PROD)

### PART A — получение видео (клиент → /videos → провайдер → video URL)
| Источник | /videos | items | method | resolve /video URL |
|---|---|---|---|---|
| skaz-kinopub | **426ms** | 25 | play | proxy → cdntogo (HLS) |
| filmix (native) | **1.03s** | 5 | play | proxy → nl06.cdnsqu 2160p.mp4 |
| skaz-alloha | 0.7s (повтор 10.5s) | 4 | call | resolve 10.8s → proxy → vkvideo.cloud ✅ |
| hdvb | 1.7s | 1 | play | proxy |
| collaps | 0.27s | 1 | play | proxy |
| skaz-zagonka | 0.99s | 15 | play | proxy |
| **rezka (native)** | **21.1s** | 22 | call | **resolve → 404 video_not_found (43ms)** ✗ |
| **kinopub/filmixtv/alloha(натив)/kodil/lumina/rutube** | **~21s единообразно** | **0** | — | **«никогда не начинается»** |

→ PART A двойной сбой: (1) native-источники модели PROD (static-21) висят ~21s и отдают пусто
(контент кластерным путём есть: skaz-kinopub 25, filmix 5, skaz-alloha 4 — т.е. данные ЕСТЬ,
но device выбрал native id); (2) rezka: список 22 карточки за 21s, затем resolve 404.

### PART B — воспроизведение (клиент → /proxy → upstream CDN → первый байт → плеер)
Range 0-8388607 на filmix 2160p.mp4 (свежий URL сразу после /videos, до протухания):
| Путь | CONN | TLS | TTFB | TOTAL | http | bytes | скорость |
|---|---|---|---|---|---|---|---|
| **PROD /proxy #1** | 102ms | — | 448ms | **50010ms** | 206 | 8 380 685 | **0.16 MB/s** |
| PROD /proxy #2 | 97ms | — | 380ms | **120016ms** | 206 | 8 134 669 | **0.06 MB/s** |
| **direct CDN (тот же URL)** | 222ms | — | 506ms | **3565ms** | 206 | 8 388 608 | **2.24 MB/s** |
| PROD /proxy 1MB | 82ms | — | 357ms | 5970ms | 206 | 1 048 576 | **0.17 MB/s** |

Контр-эксперимент — тот же URL через тот же код **с самого VPS**:
| Путь (VPS→VPS) | TTFB | TOTAL | скорость |
|---|---|---|---|
| VPS direct CDN | 176ms | 0.53s | **15.9 MB/s** |
| VPS via 127.0.0.1:3000 proxy | 174ms | 0.55s | **15.4 MB/s** |
| VPS via public proxy | 116ms | 0.39s | **21.4 MB/s** |
| PROD /proxy 64KB | 317ms | — | (мгновенно) |
| PROD /proxy 8MB ранее | 448/380/397ms | 48–120s | 0.06–0.09 MB/s |

Сырой канал клиент↔VPS без HTTP: `ssh dd if=/dev/zero bs=64K count=1024` (8MB) — **76s = 0.11 MB/s**;
два параллельных ssh-dd (32MB) — 28.8MB за 60s ≈ **0.48 MB/s суммарно** (каждый поток ~0.2–0.3,
т.е. НЕ общий лимит полки, а per-connection); прямые пинги: loss 0% (raw IP), RTT 45ms.

## Сопутствующие наблюдения (read-only)
- VPS ресурсы: **CPU 0–0.1%, RAM 6.4GB free, load 0.00, 4 ядра** — не ресурсы.
- nginx: `proxy_buffering off`, `proxy_request_buffering off`, timeouts 300s/3600s — конфиг не давит.
- nginx error.log: наши же Range-пробы «upstream prematurely closed connection» — это НАШИ тесты
  (таймаут curl), не системные.
- Node error: пустой (journalctl за 24ч).
- CDN/upstream с VPS: 15.9 MB/s — CDN не виноват.
- Локальный `server/src/proxy.js`: `upstream.pipe(response)` пассивный стрим, работает 15+ MB/s
  (доказано VPS-тестом) — код не переписывается, не требует правок.

## Числа для отчёта (запрошенные)
- PROD /videos = **0.27–21.1s** (лучшие-худшие источники; работающие 0.4–1.7s, пустые native ~21s).
- provider resolve (alloha) = **10.8s** (vkvideo.cloud); rezka resolve = **404 за 43ms**.
- proxy connect = **~80–100ms**; upstream TTFB (proxy-стеночка) = **250–460ms**.
- первый байт плеера = **250–460ms** (быстро), НО наполнение буфера = **0.06–0.16 MB/s**.
- **FIRST BOTTLENECK = egress-маршрут PROD→клиент: 0.1–0.2 MB/s на соединение**
  (10–14× медленнее прямого CDN; сам /proxy и CDN — 15–21 MB/s).

## Рекомендации НА СЛЕДУЮЩИЙ ШАГ (по отдельной команде, не сейчас) — не выполнено
1. Проверить, не лимитирован ли egress у VPS-провайдера (трафик/скорость) — тариф/маршрут.
2. Замерить с самого реального устройства (Android/Lampa) этот же путь — если там тоже <0.5 MB/s,
   подтверждается маршрут, а не мой бокс.
3. Альтернатива-шэдоу: протестировать раздачу с другого хоста/CDN впереди (/proxy на второй ноге).
4. PART A: native-таймаут ~21s + rezka 404 — отдельным диагностическим прогоном (device wire).

## HARD STOP
Исправлений НЕ вносить без отдельной команды. PROD не изменять. STAGING не трогать.

## Артефакты
`backup/t036-prod-model.mjs`, `t036-prod-videos.mjs`, `t036-prod-resolve.mjs`,
`t036-prod-proxy-timing.mjs`, `t036-prod-partb-throughput.mjs`, `t036-prod-parta.mjs`,
`t036-prod-range-sweep.mjs`, `t036-prod-fresh.mjs`, `t036-prod-quick.mjs`,
`t036-prod-alloha-resolve.mjs`.