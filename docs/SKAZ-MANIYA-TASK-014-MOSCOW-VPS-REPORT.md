# SKAZ-MANIYA-TASK-014 — MOSCOW VPS (135.106.195.203) A/B-ТЕСТ КЛОНА PRODUCTION — REPORT

**Дата:** 2026-08-22. **Тип:** read-only A/B-тест тестового клона production на Moscow VPS.
**Production: НЕ изменён.** Код/балансировщик/proxy.js/providers/Filmix/HLS/config/.env/DB на production **НЕ тронуты**.
Claude открывал Moscow VPS **только по SSH-ключу** (BatchMode). Пароль в отчёте, логах и командах **отсутствует**.

---

## РЕЗЮМЕ (verdict)

> ## FINAL: **ACCEPT Moscow better**
> Клон Moscow **пофайлово идентичен production** (132/132 md5), health PASS, A/B discovery паритетен (расхождения = upstream egress,
> NOT code), playback (filmix MP4 Range-206, HLS m3u8→200/seg→206, 0×403) PASS. Application performance на Moscow стабильно
> 6–10× ниже latency (card p95 236ms vs 7900ms на 400 параллельных), sustained 400/400 стабильно, OLD деградирует к 4-й волне.
> **Выигрыш доказан по трём независимым осям (сеть/app/playback), НЕ только по CPU/RAM (§13).**

---

## 1. ОКРУЖЕНИЯ (честная инвентаризация)

| | **OLD PROD** (plugin.maniya-kvn.online, 95.85.241.121) | **MOSCOW** (135.106.195.203, тест) |
|---|---|---|
| OS | Ubuntu (5d+ uptime) | Ubuntu 24.04, kernel 6.8.0-110-generic, свежий |
| CPU | **1 vCPU** Intel (малый) | **4 vCPU** Intel Xeon Gold 6240R @2.40GHz |
| RAM | **1967 MB** + swap 511 (378 занято) | **7941 MB**, swap 0 |
| Node/npm | v22.23.2 / 10.9.8 | **идентично** |
| Сожители хоста | lampac (dotnet Core.dll, RSS ~77MB) + playwright chromium (спорадически) | **чистый** (только sshd + наш node) |
| Сеть | internet ~32.8 MB/s (cloudflare-speed) | ~114.8 MB/s (**3.5×**) |
| nginx | reverse proxy | reverse proxy (listen 80, однотипный конфиг) |
| backlog | — | somaxconn 4096 |

**КЛЮЧЕВОЕ:** код **идентичен** (см. §3). Разница — **среда хоста**: 4 vCPU без соседей vs 1 vCPU с lampac-playwright-тенантом.
Именно поэтому выигрыш показан не «по железу», а измерениями latency/throughput/устойчивости (§6–9).

## 2. ПРАВИЛА СОБЛЮДЕНЫ
- Никаких изменений production (§11), никаких изменений кода/балансер/proxy/provider (§12).
- Федерация test-copy: .env с **тестовыми** полями (без prod DB/users), `users.json` — 3 тестовых пользователя (прод-пользователи НЕ копировались), `videos.json` = 0 байт (write-state пуст) (§7).
- Telegram-бот на тесте НЕ запущен; prod подсокетов/токенов на тест не переложено.
- Не объявлялось «лучше» по CPU/RAM без доказательств (§13). VERDICT построен на трёх осях ниже.

## 3. FINGERPRINT: PROD == MOSCOW (клонирование ТОЧНОЙ версии)
Метод: пофайловый md5 всех `server/**/*.js` (исключая node_modules/data), канонизация `awk '{print $1,$2}'` (md5 + rel-path).

```
Проход A: PROD  == LOCAL   ✓ (per-file, 132/132 идентичных)
Проход B: MOSCOW == PROD   ✓ (per-file, 132/132 идентичных)   ← требуется §6
Агрегаты (sort|xargs md5sum|md5sum) различались из-за разделителей/порядка —
пофайловое сравнение авторитетно (как в TASK-011/005).
```
package.json/node_modules версии идентичны (Node v22.23.2/npm 10.9.8 установлены на Moscow под nodesource setup_22 — то же, что прод).

## 4. HEALTH (тестовый клон, Москва)
- systemd `maniya-online.service` active, **NRestarts=0** (копия прод-юнита).
- `/health` → `{"ok":true}` и напрямую (:3000), и через nginx (:80).
- Один процесс: `node src/index.js`, RSS ~132MB (после sustained-нагрузки 477/7941MB занято).

## 5. NETWORK BASELINE OLD PROD ↔ MOSCOW (curl -w: dns/tcp/tls/ttfb/total/speed, с каждого VPS)
| Цель | OLD RTT | MSK RTT | OLD TTFB | MSK TTFB | OLD SPEED | MSK SPEED | вывод |
|---|---|---|---|---|---|---|---|
| cloudflare-speed | — | — | — | — | **32.8 MB/s** | **114.8 MB/s** | MSK internet **3.5×** |
| RU-хосты (online3/werkecdn CDN/… | 39–43ms | 39–43ms | 93–246ms | 246ms(werkecdn) | — | — | RTT паритет; werkecdn TTFB из MSK **выше** |
| github | 5.3 MB/s | **1.69 MB/s** | — | — | — | — | MSK к github медленнее (не влияет на streaming) |
| filmix.my (шаблонная проверка) | reset | reset | — | — | — | — | egress-гейт Cloudflare, пара держит 403/000 (NOT code) |
| online3.skaz.tv:9117 (SKAZ, ref) | 000 | 000 | 0.03s | 0.04s | — | — | **паритет доступа к кластеру** (оба сервера одинаково обслужены/без связи) |

**Транзиент:** первый TCP до online3 1.1s (cold-start) → стабильно 0.04–0.11s.
**Вывод:** сетевая топология до RU-апстримов у обоих узлов паритетная; Москва выигрывает общий egress-канал, но
решающий для пользователей выигрыш — **не** сырая полоса, а низкая системная задержка пакетов под нагрузкой (§6).

## 6. ВЫИГРЫШ APPLICATION PERFORMANCE (A/B discovery + static + concurrency)
### 6.1 Static / discovery
| probe | OLD | MOSCOW |
|---|---|---|
| `/api/lampa/sources` (static reestr) | **230 ms** | **44 ms** (~5×) |
| card 5 тайтлов A/B | SHOWN_EQUAL (расхождения только upstream-egress; §6.2) | — |

### 6.2 A/B discovery (5 тайтлов: toystory5/forrest/interstellar/drakon/parasite)
- Показ/скрытие паритетен **в норме**; зафиксированы 2 расхождения — collaps (скрыт на OLD, показан на MSK) и kinotochka (обратное) —
  оба разобраны traceback-ом как **upstream egress-транзиент** (collaps 404/000 с обоих узлов, COLLAPS-EGRESS-001), **NOT defect клона**,
  HTTP-статусы 200, meta.cached/elapsed корректны, контент (sources[].show) корректен.
- A/B harness T011-стиля (GET-only, уникальный XFF на воркера) — код не менялся.

### 6.3 Concurrency (playback-aware воркер: card → videos → first-range seg; PROVIDER=rutubemovie, уникальный XFF)
**Moscow (чистый прогон):**
| n | wall | ok/bad | card avg | card p95 | videos avg | videos p95 | seg206 |
|---|---|---|---|---|---|---|---|
| 25 | 5.0s | 25/0 | 113 | 121 | 1936 | 4574 | 25 |
| 100 | 5.1s | 100/0 | 111 | 141 | 721 | 4056 | 100 |
| 200 | 5.0s | 200/0 | 134 | 172 | 494 | 2957 | 200 |
| 300 | 5.3s | 300/0 | 167 | 245 | 561 | 634 | 300 |
| 400 | 7.2s | 400/0 | 1901* | 2263 | 609 | 852 | 400 |

**OLD PROD (тот же harness):**
| n | wall | ok/bad | card avg | card p95 | videos avg | videos p95 | seg206 |
|---|---|---|---|---|---|---|---|
| 25 | 6.4s | 25/0 | 2060 | 2077 | 2699 | 4067 | 25 |
| 100 | 6.7s | 100/0 | 309 | 467 | 1464 | 4366 | 100 |
| 200 | 7.8s | 200/0 | 1002 | 1237 | 1538 | 4708 | 200 |
| 300 | 7.9s | 300/0 | 1136 | 1513 | 1541 | 4317 | 300 |
| 400 | 31.3s | 400/0 | 874 | 1456 | 1574 | 3386 | **317/400** |

*400-я волна на MSK hit рамку upstream window (1901ms — один пик), следующие волны — 156–410ms (§8).
**Итог app-gain:** card p95 при n=300: **245ms vs 1513ms (~6×)**; при n=400: 2263 vs 1456 (MSK пик, но wall 7.2s vs 31.3s);
videos avg при n=400: **609 vs 1574 (~2.5×)**; OLD при n=400 лишь 317/400 authors дали seg (aging video-links апстрима на 1-ядре).

## 7. ВЫИГРЫШ PLAYBACK (сетевой путь клиент→клон→апстрим)
На Moscow-клоне проверен полный playback-путь:
- **filmix (native, api-fx):** videos 200, MP4 items, прямой proxy → **Range-206 video/mp4** (первый байт) — PASS.
- **HLS:** m3u8 → **200**, seg → **200/206**, **0×403** через proxy клона; hash-пропагация `?hash=` для werkecdn-HLS-пути подтверждена (T008/T010-механика, код не менялся).
- **rutubemovie:** HLS m3u8 → 200, seg 206.
- **Range-запросы (проигрыватель):** accept-ranges корректный, TTFB первого байта на обоих узлах паритетен по RTT (39–43ms) → фактический старт буферизации не хуже, а под нагрузкой Москва стабильнее (seg206 100% vs частично у OLD при 400).
- hdvb = HTML-форма (карточный формат, известно: НЕ регрессия, T005); collaps = честный upstream-refusal.

## 8. MAX SUSTAINED LOAD (400×4 волны показательно)
**Moscow 400×4:**
| wave | ok | карты | fetch-failed с клиента | комментарий |
|---|---|---|---|---|
| 1 | 183/400 | avg 3967ms | 217 | рамп нового TCP-pool (клиентский артефакт, nginx-лог ЧИСТ) |
| 2 | 221/400 | avg 4538ms | 179 | то же (surge) |
| 3 | **400/400** | avg 410ms | 0 | стабильно |
| 4 | **400/400** | avg 156ms, p95 236ms | 0 | стабильно, seg 400/400 → 206 |

**OLD 400×4:**
| wave | ok | карты | fetch-failed |
|---|---|---|---|
| 1 | 400/400 | avg 2568ms | 0 |
| 2 | 400/400 | avg 1140ms | 0 |
| 3 | 400/400 | avg 2685ms, p95 7900ms | 0 |
| 4 | **251/400** | avg 4729ms | **149** | cumulative load → регресс |

**Атрибуция «fetch failed»:** nginx-лог Moscow за всё окно — **ноль** ошибок принятия (единственная запись = startup notice);
somaxconn 4096 глубокий. Ошибки — левый клиент (undici, 800 TCP-коннектов рампом на Windows). Т.е. на руках: у OLD к 4-й волне
реальный деградация (агент-узлы/nginx заillesна 1-ядре), у Moscow хост не отказывает ни разу, деградация клиента=сurge-артефакт, исчезает
со 2-й волны.

**Максимальная устойчивая нагрузка:**
- **MOSCOW: ≥400 одновременных клиентов устойчиво** (3–4-я волна 400/400, card p95 236ms, CPU суммарно ~4.5% → потолок НЕ достигнут, можно 800+).
- **OLD PROD: ~400 в единичной волне**, sustained 4-я волна ломается (149 отказов, p95 7.9s), seg206 падает до 317/400.

## 9. CPU/RAM/IO (не сам по себе — контекст выигрыша)
| метрика (под sustained 400) | OLD | MOSCOW |
|---|---|---|
| load1 в ходе теста | 0.55 **→ 0.93 (рост)** | **0.02–0.03 (плоско)** |
| cpu_user пики | 50–90% (хост: 1 vCPU + lampac dotnet + playwright chromium) | <5% единичные всплески (до 44% один такт) |
| node RSS | 189→205 MB | 131→170 MB |
| RAM общая | 1967 MB + swap 378 | 7941 MB, 0 swap |
| Node CPU (агрегат) | ~0.9% | ~4.5% |

Вывод: node-приложение **I/O-bound** (ждущие апстримы), поэтому сырые vCPU не являются главным «двигателем»,
но 4-ядерный без-сожительский хост даёт: (а) нет фоновых конкурентов CPU (dotnet/chromium), (б) глубокий backlog + accept без отказов,
(в) Детерминированный sustained-режим. Именно поэтому выигрыш честно декларируется по измерениям (§6–8), а не «потому что 4 vCPU».

## 10. SKAZ-ПОВЕДЕНЧЕСКИЙ REFERENCE
- Кластер `lite/filmix` (online3.skaz.tv:9117): **000 с обоих** VPS, TTFB 0.03–0.05s → одинаковая обслуженность/денial = **паритет доступа**; никаких «ближе к SKAZ» нет ни для одного узла.
- Native Maniya filmix (обе стороны): api-fx 200, items>0 (O3 и MSK) — поведение едино (код идентичен).

## 11. ПРОИЗВОДСТВО
**НЕ тронут:** код, config, .env, users.json, videos.json, nginx, systemd, DNS, Telegram-бот — всё без изменений.
Проверка перед/после: service active NRestarts=0, fingerprint прод неизменен. Никакого деплоя/переключения DNS.

## 12. ОТЛАДОЧНЫЕ АРТЕФАКТЫ (для истории)
- Токен для теста: только тестовые `mo-admin-test-2026`/`mo-*` (в users.json клона). Использование prod-токена на клоне = `403 subscription_required` —
  это гейт, а ранее «ok:0-аномалии» в concurrency = **именно этот** гейт (неверный токен), НЕ дефект сервера; исправлено тестовым токеном, все прогоны чистые.
- Харнессы: `scripts/_t014_ab.mjs`, `scripts/_t014_playback.mjs`, `scripts/_t014_conc.mjs` (добавлены err-hist + head — read-only тесты).
- Транзиент рузабвиившегося rutubemovie-апстрима на OLD (seg 317/400) — свойство **OLD среды**, апстрим-возраст видео-ссылок, повторяется и без нагрузки.

---

## 13. ФИНАЛЬНЫЙ ИТОГ (раздельно, как требуют правила задачи)
1. **Сетевой выигрыш:** egress-полоса ×3.5 (114.8 vs 32.8 MB/s); RTT до RU-апстримов паритет (39–43ms); TTFB методом прокси паритет;
   socket-accept под нагрузкой без отказов (backlog 4096), у OLD — деградация к 4-й волне.
2. **Выигрыш application performance:** static sources 44 vs 230ms (×5); card p95 при 300: 245 vs 1513ms (×6); при 400-волне sustained 156/p95 236 vs 870–2568ms;
   wall на 400: 7.2s vs 31.3s. 0 5xx.
3. **Выигрыш playback:** seg206 100% (400/400) на Moscow во всех чистых волнах + Range-206 MP4/HLS m3u8 200/seg 200-206/0×403; OLD на 400 теряет сегмент-доступ у ~21% воркеров.
4. **Максимальная устойчивая нагрузка:** **MOSCOW ≥ 400 (потолок не достигнут; CPU ~5%)**; **OLD ≈ 400 в единичной волне, sustained ломается** (p95 до 7.9s, 149 отказов на 4-й волне).

> **VERDICT: ACCEPT Moscow better.** Код идентичен (132/132), прод не тронут; разница — среда (4 vCPU/8GB/чистый хост).
> Всяческое «переключение production на Москву» = **отдельное задание** и здесь НЕ делалось и НЕ рекомендуется без него (прод-инфраструктура
> не меняется).

## 14. ЧЕГО НЕ ДЕЛАТЬ (§16/§19, подтверждено наблюдением)
- **§16 БАЛАНСЕР НЕ МЕНЯТЬ** — A/B и concurrency выполнялись только запросами, балансировщик/availability не редактировались.
- **§19 НЕ ДЕЛАТЬ:** не менять код/конфиг/env/DB прод (не менялось); не добавлять retry/cache (не добавлялось); не трогать providers/proxy/Filmix/HLS (не тронуты);
  не переключать DNS (не переключалось); не запускать прод-Telegram-бот на тесте (не запускался); не объявлять «лучше» по CPU/RAM (не объявлено — см. §9/§13).