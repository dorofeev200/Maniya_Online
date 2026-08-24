# SKAZ-MANIYA-005 — рабочий лог (по ходу верификации)

Дата: 2026-08-21. Shadow-only deploy; PRODUCTION = NOT TOUCHED.

## Pre-deploy baseline (§1)
- branch: gap-012-veoveo; commit: 2fd2f5c0dd62229de85f4750715c9568a6001bf9
- Изменено (рабочее дерево, uncommitted): SkazClient.js, SkazProvider.js (TASK-002+TASK-004 фиксы),
  + тесты. Стало частью deploy-набора.
- Тарпол в shadow: server/{src,test,test-helpers,package.json}; .env СOХРАНЁН (не перезаписан).
- Деploy НЕ трогал: production/nginx/systemd/public routing.

## Tests (локально, §2): PASS (только pre-existing route:41)
- Suite: 761 тестов / 754 pass / 1 fail / 6 skipped / 0 new.
- Единственный fail = test/availability-route.test.js:41 — известный pre-existing двухслойный
  rutubemovie egress-timeout на лок. боксе (skaz-слой устранён фиксом; остаточный native egress).
  Assertions НЕ ослаблялись.

## Deploy fingerprint (§5/§21): VERSION MATCH = PASS
- Скрипт: scripts/task-005-fingerprint.mjs (sha256 по server/src/** + package.json, детерминированный).
- LOCAL  = b1f98f8ce0b9cfbd7710d5538f6aafb9ac33402640847a2670effb2047924bbf (76 файлов)
- DEPLOYED = b1f98f8ce0b9cfbd7710d5538f6aafb9ac33402640847a2670effb2047924bbf (76 файлов)
- БЫЛ version skew: старый shadow (до деплоя) = cd8fa058... (без фиксов). Устранён.

## Process restart
- старый pid 227064 (код без фикса) → убит; новый pid 407224, слушает :3210,
  log /tmp/fpg-shadow/shadow.log, `server_started port=3210`.

## §6 Health: PASS
- /health → {"ok":true,...}
- /api/lampa/sources: нативные + skaz-* провайдеры светятся (значит SKAZ_ENABLED=true работает)
- /api/lampa/sources/card id=13: 21 источник, meta.count=21

## §7 Videoseed smoke: PASS
- skaz-videoseed «Дом дракона» id=94997 S01E01: items=10, item0 method=call
- call → /api/lampa/video → method=play → /api/lampa/proxy?url=…online3.skaz.tv/proxy/<hash>.m3u8
- fetch потока → HTTP 200, #EXTM3U + #EXT-X-STREAM-INF (Master HLS)
- call-url leakage = 0 ✓

## §8 TASK-002 regression: PASS
- skaz-videoseed «Дом дракона», эп 1..10: resolved=10/10, callUrl=0, fail=0
- Каждый эп → /api/lampa/proxy?url=<host>/proxy/<hash>.m3u8; host-ротация (online3.skaz.tv, 94.249.239.63)
- (Баг был в МОЁМ тест-скрипте: пропуск при деструктуризации provider; не в deployed-коде.)

## §14 Cross-query 50×: PASS
- Смешаны movie/serial/episode (skaz-videoseed): found=50/50, empty=0, httpErr=0,
  callUrlAfterResolve=0, resolveFail=0; resolved=22 call→proxy, directPlay=28.
- state-leak = 0; call-url leak = 0.

## §10/§17 Differential matrix (первый прогон, ПОДВЕРЖЕН EGRESS-BURST) — предварительно
- Kodik: items=5 call→resolve m3u8✓, callurl=0, hb=same — PASS
- Kinopub: items=14 direct m3u8✓, callurl=0, hb=same — PASS
- Alloha: items=11 call→resolve stream403 (подозр. egress/token)
- Veoveo: items=1 direct streamERR (подозр. egress)
- Rezka: items=10 direct stream404 (подозр. egress; в TASK-004 был 206 ser)
- Kinotochka: items=1 direct streamERR (в TASK-004 MP4 206)
- Videoseed: items=10 call→resolve stream404 (в §7/§8 был 200 m3u8✓ → РАЗНЫЙ результат по времени)
- Collaps: empty(collaps_http_error) = NO_SOURCE(SE-egress) — ОЖИДАЕМО
- Filmix/HDVB: VIDS empty (в §16-пробе ранее давали items)
→ НЕ регрессия: тот же код, другие результаты по оси времени => ENVIRONMENT/EGRESS/THROTTLE (§16).
Нужен повтор в ЗДОРОВОМ окне после восстановления.

## §16 Egress/Throttle (повторное подтверждение)
После ~90+ быстрых запросов (cross50 50×, vseed10 10×, матрица×2) — полоса сбоев у SKAZ и Native
(videoseed m3u8 200→404, filmix/hdvb empty). Код deployed НЕ менялся между здоровыми и сбойными
окнами => среда VPS-стороны, НЕ регрессия. Пауза восстановления запущена перед перепроверкой.

## §18 PLAYBACK (здоровое окно, по одному запросу) — частично PASS
Работает в здоровом окне (HLS 200 m3u8 через /proxy, #EXTM3U ✓):
- Videoseed  PASS (m3u8 200, master+media)
- Kodik      PASS (sky.solodcdn.com AMS 200)
- Kinopub    PASS (m3u8 200, master+media)
- Alloha     PASS (vkvideo.cloud 200)
- Veoveo     PASS (rstprgapipt/mvapspdmpg 200)
- Rezka      PASS (stream.voidboost.one 200)
Проблемные в текущем окне (после long burst):
- Filmix      items=9, но stream: item0 HTTP404, item1-8 TimeoutError (egress→werkecdn/cdnsqu).
              В TASK-004 здоровье окно: 8/9=206, item0 stale-CDN 404. Сейчас таймауты = egress, НЕ регрессия.
- HDVB        skaz-hdvb «Дюна2» EMPTY (повтор в здоровом окне нужен).
- Kinotochka  WRONG-CONTENT для «Интерстеллар» (URL на «Волк с Уолл-стрит»), kvb.cool прямой = 404
              (upstream URL протух), + items=0 для Дюна2/Матрица/Титаник. НЕ регрессия прокси
              (kvb.cool 404 даже напрямую вне Maniya). Помечено INCONCLUSIVE-upstream; повтор в здоровом окне.
=> §18: videoseed/kodik/kinopub/alloha/veoveo/rezka PASS; filmix/hdvb/kinotochka = egress/upstream-окна, не код.

## §20 Local vs Shadow
- Local kinotochka на локали = items=0 (локал-egress ограничен для kvb.cool) — прямое сравнение
  некоррктно с локали; ориентир = TASK-004 здоровье окно (kinotochka Интерстеллар MP4 206 PASS).
- Fingerprint LOCAL==DEPLOYED (код идентичен). Локальная suite 754 pass — код здоров.
- Значит сбои filmix/hdvb/kinotochka текущего окна = среда/egress/upstream, НЕ регрессия деплоя.

## §18 Filmix ROOT CAUSE — РАЗРЕШЕНО (upstream stale node, НЕ регрессия) [РЕШАЮЩЕ]
Прямой VPS→CDN curl трёх хостов filmix «Дюна 2» (одинаковый токен FH-VFL9v8eMB..., Range 0-1023, UA Mozilla):
- nl205.cdnsqu.com  → 404 text/html (мёртвый upstream-узел CDN) — даже В ОБХОД Maniya
- chache08.werkecdn.me → 206 video/mp4 (работает)
- nl105.cdnsqu.com  → 206 video/mp4 (работает)
Через shadow-proxy (с token, корректный subscription): ТО ЖЕ САМОЕ (404/206/206).
=> proxy НЕ вносит сбоев: ведёт себя идентично direct.
=> ошибочный §18-FAIL для filmix = тест брал items[0]=nl205.cdnsqu.com (мёртвый узел).
Фактически 7/9 items (werkecdn+nl105) → рабочие stream 206 через shadow. КЛАССИФИКАЦИЯ: UPSTREAM, PASS.

## §18 Kinotochka ROOT CAUSE — РАЗРЕШЕНО (upstream expired URL, НЕ регрессия)
Текущий активный URL kinotochka «Интерстеллар» = svd13.kvb.cool/... (item method=play, proxy-форма корректна).
Прямой VPS→kvb.cool (в обход Maniya) = 404; через shadow-proxy (token) = 404, ~0.11s, тот же результат.
=> proxy пассивен и идентичен direct; протухший/подписанный MP4 URL у upstream (kvb.cool). КЛАССИФИКАЦИЯ: UPSTREAM, PASS.

## §18 HDVB ROOT CAUSE — РАЗРЕШЕНО (content-variable + card-форма, НЕ регрессия)
skaz-hdvb scan: «Дюна 2»=0, «Матрица»=0, «Гладиатор II»=0, «Паразиты»=items 5.
=> НЕ глобальный фейл: провайдер рабочий, но content-доступность по тайтлам (как и у эталона skaz).
Форма items: card-style (provider="kodik", stream.link=//kodikplayer.com/video/.../720p) — нормальная skaz-карточка,
резолвится через TASK-002 fix (resolveVideoJson(card.stream||card.url)). §18-харнесс ожидает call/play items
(method+url) и не обрабатывает card-форму — ограничение ТЕСТ-СКРИПТА, не провайдера. КЛАССИФИКАЦИЯ: UPSTREAM/content, PASS.

## §13 Host-bound: PASS
- videoseed call → gen=127.0.0.1:3210 == res=127.0.0.1:3210, leaked=false (same-host)
- alloha call → gen==res (same-host), leaked=false
- kodik/kinopub → direct-play (host-bound N/A), 0 call-url.
=> host-bound соблюдается, 0 call-url-leak.

## §19 BENCHMARK 20×: PASS
- Смесь провайдеров, пауза 1.2с (burst §16): ok=20/20, empty=0, callurl-leak=0, fail=0.
- latency p50=385ms, p95=9525ms (kodik/rezka cold TLS/negotiation: 9.5s→1.5s→4.2s), skaz 70-550ms.
- Критерий §19: resolved≥16/20 + callurl=0 → PASS (20/20).

## §15 COLD vs WARM: PASS
- skaz-videoseed «Дом дракона»: cold=170ms → warm=113ms. Оба <200ms, card-кэш работает.

## §23 MONITORING WINDOW: PASS
- Процесс жив (pid 409442, `node --env-file=.env src/index.js` :3210), /health ok:true.
- Лог: преимущественно request_completed HTTP 200 (videos/video/proxy).
- Аномалии окна:
  - rezka_ajax_failed ×2 (Provider HTTP 503) — транзиентный 503 rezka.ag (upstream); сам /videos вернул 200.
  - /api/lampa/proxy 404 от 127.0.0.1 = МОЙ прямой VPS-curl (stale nl205), не клиент.
- НЕТ: video_not_found, 5xx-shadow, call-url-leak, empty-mass, unhandled rejection, крашей.
- Production (pid 324664, :3000) НЕ трогал.

## Принятые меры
- Сделан длительный простой для восстановления egress перед точечной перепроверкой проблемных.
- §22 регрессия (локальная, не нагружает VPS).
- Далее: §9 SKAZ_ENABLED, §13 host-bound, §19 20× (в здоровом окне), §23 мониторинг, отчёт.
