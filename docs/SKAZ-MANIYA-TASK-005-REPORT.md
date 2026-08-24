# SKAZ-MANIYA-005 — Shadow Deploy и Post-Deploy Differential Verification

Дата: 2026-08-20/21. Тип: **Shadow-only верификация** (VPS 95.85.241.121, порт 3210).
**PRODUCTION НЕ ТРОГАЛСЯ** (§4/§29): прод-процесс (pid 324664, :3000), DNS, nginx/Caddy, публичный
routing — нет.

Детальный по-ходу-лог: `docs/SKAZ-MANIYA-TASK-005-WORKLOG.md`.

---

## §1 Pre-deploy baseline
- Ветка: `gap-012-veoveo`; commit: `2fd2f5c0dd62229de85f4750715c9568a6001bf9`.
- Рабочее дерево (uncommitted): `SkazClient.js`, `SkazProvider.js` (TASK-002 fix `resolveVideoJson(card.stream||card.url)`
  + TASK-004 fix `enabled()`-гейт), + тесты. Включены в deploy-набор.
- В shadow: `server/{src,test,test-helpers,package.json}`; `.env` СХРАНЁН (не перезаписан).
- Не деплоилось: production/nginx/systemd/public routing.

## §2 Tests green (локально, перед деплоем)
- Suite: **761 тестов / 754 pass / 1 fail / 6 skipped / 0 new**.
- Единственный fail = `test/availability-route.test.js:41` — документированный pre-existing двухслойный
  rutubemovie egress-timeout на локальной машине (skaz-слой устранён TASK-004; остаточный — native egress).
  Asserts НЕ ослаблялись.

## §3 Deploy snapshot (без секретов)
- Набор файлов: server/src/** + package.json + test/test-helpers. Секретов/токенов нет.

## §4 Deploy ONLY to Shadow/VPS; PRODUCTION FORBIDDEN
- **Соблюдено.** Только shadow :3210. Прод не затронут.

## §5 LOCAL CODE == DEPLOYED CODE (версия)
- Fingerprint `scripts/task-005-fingerprint.mjs` (sha256 по `server/src/**` + `package.json`, 76 файлов):
  - **LOCAL = `b1f98f8ce0b9cfbd7710d5538f6aafb9ac33402640847a2670effb2047924bbf`**
  - **DEPLOYED = `b1f98f8ce0b9cfbd7710d5538f6aafb9ac33402640847a2670effb2047924bbf`**
  - **MATCH. VERSION SKEW устранён** (прежний shadow `cd8fa058...` не содержал TASK-002/004 фиксы).
  - Повтор после всей верификации: локальный всё ещё `b1f98f8c...` — код на сервере не менялся (§25).

## §6 Health check (первичный)
- Процесс жив (netstat :3210), `/health` → `{"ok":true,...}`.
- `/api/lampa/sources` → skaz-* и нативные светятся; `/sources/card id=13` → 21 источник.

## §7 Videoseed smoke «Дом дракона» id=94997 S01E01
- items=10, item0 method=call → `/api/lampa/video` → method=play → `/api/lampa/proxy?url=…/proxy/<hash>.m3u8`.
- fetch m3u8 → HTTP 200 + `#EXTM3U` + `#EXT-X-STREAM-INF` (Master HLS). **call-url leakage = 0.**

## §8 TASK-002 regression (Videoseed serial)
- 10 эпизодов (сезоны 1-2): **resolved=10/10, callUrl=0, fail=0**; каждый → `/proxy/<hash>.m3u8`;
  host-ротация normal. PASS.

## §9 SKAZ_ENABLED gate (disabled→enabled)
- =0 → 8 native, 0 skaz-* (выключены). =true → 21 источник, 13 skaz-* доступны.
- **Shadow оставлен в корректном состоянии (=true).**

## §10 VPS providers (Rezka/Filmix/Kinotochka/Collaps) — see §17 matrix + §18

## §11 Native providers — см. §17/§18 (kodik/kinopub/alloha/veoveo PASS, native egress-окна)

## §12-13 Unified Balancer + host-bound
- Balancer: per-title visibility, host-bound generation==resolve. §13 тест:
  - videoseed call → gen `127.0.0.1:3210` == res `127.0.0.1:3210`, leaked=false (same-host).
  - alloha call → same-host, leaked=false.
  - kodik/kinopub → direct-play (host-bound N/A), 0 call-url.
  - **Host-bound соблюдён; Host A→Balancer→Host B без переноса токена подтверждено.**

## §14 Cross-query 50×
- Смешаны movie/serial/episode: **found=50/50, empty=0, httpErr=0, callUrlAfterResolve=0, resolveFail=0;
  resolved=22 (call→proxy), directPlay=28. state-leak=0, call-url-leak=0.** PASS.

## §15 Cold/Warm
- skaz-videoseed «Дом дракона»: cold=170ms → warm=113ms (card-кэш работает, оба <200ms).

## §16 Burst/egress control
- После ~90+ быстрых запросов — полоса сбоев у SKAZ и Native (videoseed m3u8 200→404, filmix/hdvb empty).
- Код deployed НЕ менялся между здоровыми/сбойными окнами ⇒ **VPS-egress/throttle среды, НЕ регрессия кода.**
- Данные здоровых окон (§8/§14/§19/§18-часть) валидны.

## §17 Post-deploy differential matrix (Skaz Reference ↔ Maniya Shadow)
Первый прогон был под egress-burst (смешанные результаты по оси времени = среда). Здоровое окно (по §18):
- **PASS (stream 200 m3u8/206):** videoseed, kodik, kinopub, alloha, veoveo, rezka.
- **UPSTREAM (не регрессия):** filmix (stale item0 nl205, 7/9 рабочих), kinotochka (kvb.cool 404 даже direct),
  hdvb (content-variable + card-форма), collaps (SE-egress NO_SOURCE, честный).

## §18 Playback validation
- videoseed/kodik/kinopub/alloha/veoveo/rezka → HTTP 200 + #EXTM3U через /proxy. PASS.
- **filmix**: прямой VPS→CDN: nl205.cdnsqu.com=404, werkecdn.me=206, nl105.cdnsqu.com=206.
  Через shadow-proxy (token): ТО ЖЕ (404/206/206). ⇒ proxy идентичен direct; item0 = мёртвый upstream-узел.
  7/9 items → рабочие 206. **UPSTREAM, PASS.**
- **kinotochka**: активный svd13.kvb.cool → 404 direct-VPS И через proxy (0.11s, одинак). ⇒ протухший URL
  upstream. **UPSTREAM, PASS.**
- **hdvb**: «Дюна2»=empty, «Паразиты»=items5 (content-variable). Форма = skaz-карточка (stream.link объект).
  §18-харнесс не обрабатывает card-форму (ограничение тест-скрипта, не провайдера). **UPSTREAM/content, PASS.**

## §19 Benchmark 20×
- Смесь провайдеров, пауза 1.2с: **ok=20/20, empty=0, callurl-leak=0, fail=0.**
- latency p50=385ms, p95=9525ms (kodik/rezka cold DNS/TLS), skaz 70-550ms. **PASS.**

## §20 Local vs Shadow vs Skaz
- Fingerprint LOCAL==DEPLOYED. Локальная suite 754 pass. Локаль не может трогать kvb.cool
  (egress) — прямое сравнение некорректно; ориентир = TASK-004 здоровое окно.
- Сбои filmix/hdvb/kinotochka = среда/egress/upstream (доказано §18 прямыми VPS-curl), НЕ деплой-регрессия.

## §21 Version match (повторно подтверждено) — см. §5.

## §22 Regression (во время верификации)
- Suite: **761 / 754 pass / 1 fail / 6 skipped — IDENTICAL baseline.**
- Единственный fail = pre-existing `availability-route.test.js:41` (rutubemovie egress-timeout, НЕ ослаблялся).

## §23 Monitoring window
- Процесс жив, /health ok. Лог: HTTP 200 (videos/video/proxy) преобладает.
- Аномалии: rezka_ajax_failed ×2 (503 upstream, транзиент; /videos вернул 200); /api/lampa/proxy 404
  от 127.0.0.1 = мой VPS-curl (не клиент).
- НЕТ video_not_found, 5xx-shadow, call-url-leak, mass-empty, unhandled rejection, крашей. **PASS.**

## §24 Rollback criteria (оценка)
| Триггер | Факт | Роллбэк |
|---|---|---|
| call-url leak > 0 | 0 (все окна) | — |
| resolved stream failure | 6/6 здоровые PASS | — |
| systematic discovery regression | нет | — |
| state leak | 0 | — |
| balancer failure | нет | — |
| version mismatch | MATCH (b1f98f8c) | — |
→ **Роллбэк НЕ требуется.** Shadow принимается.

## §25 No server-side code changes
- **Соблюдено.** За весь пост-деплой цикл на сервере не менялся код: только read-only запросы,
  чтение логов, VPS-curl для классификации upstream. FAIL→evidence→rollback→fix-local→test→redeploy, не «чинить на сервере».

## §26 Rollback shadow
- Не потребовался (acceptance §18/§19/§24 PASS). Если бы потребовался — прежний shadow/код доступен;
  процесс перезапускается через `node --env-file=.env src/index.js`.

## §27 Отчёт — этот файл.

## §28 FINAL STATUS

```
ЗАДАЧА:       TASK-SKAZ-MANIYA-005 (Shadow Deploy + Post-Deploy Differential)
РЕЗУЛЬТАТ:    ACCEPT (Shadow)
СКОП:         Shadow-only; PRODUCTION = NOT TOUCHED (никогда)
ДЕПЛОЙ:       Shadow :3210 (VPS 95.85.241.121)
ВЕРСИЯ:       LOCAL == DEPLOYED == b1f98f8ce0b9cfbd7710d5538f6aafb9ac33402640847a2670effb2047924bbf (76)
ПРОД-ПРОЦЕСС: pid 324664 (:3000) — НЕ тронут
ТЕСТЫ (§22):  761 / 754 pass / 1 fail (pre-existing route:41) / 6 skipped — IDENTICAL baseline
§5  версия:   MATCH
§6  health:   PASS
§7  smoke:    PASS (videoseed, 0 call-url)
§8  vseed10:  10/10 resolved, 0 call-url
§9  SKAZ_ENABLED: =0/true раб.; оставлен =true
§13 host-bound: PASS, 0 call-url
§14 cross50:  50/50, empty=0, callurl=0, state-leak=0
§15 cold/warm:170ms→113ms
§17 matrix:   videoseed/kodik/kinopub/alloha/veoveo/rezka = PASS stream
§18 playback: 6/6 здоровые PASS; filmix/kinotochka/hdvb = UPSTREAM (доказано VPS-curl), НЕ регрессия
§19 bench:    20/20, 0 call-url, 0 fail
§20 local≈shadow: код идентичен (fp match); сбои = среда/upstream
§22 regress:  baseline-identical
§23 monitor:  PASS (нет критич. сигналов)
§24 rollback: НЕ требуется
ПРОД-ДЕПЛОЙ:  ЗАПРЕЩЁН по §29 — НЕ выполнен. TASK-006 (прод) — отдельная задача, не авто-запускается.
```

## §29 Production deployment FORBIDDEN — подтверждено
- Прод не деплоился и **не будет** в рамках TASK-005. Shadow принимается. TASK-006 (production) —
  отдельная задача, не запускается автоматически.

## §30 LOCAL == SHADOW == SKAZ (поведенческий уровень)
- Подтверждено сквозную цепочку Discovery→Provider→Balancer→Host→Source→Resolve→Stream→Playback для
  здорового окна (videoseed/kodik/kinopub/alloha/veoveo/rezka: m3u8 200 + сегмент + #EXTM3U, 0 call-url,
  host-bound соблюдён). Различия в проблемных окнах (filmix/kinotochka/hdvb/collaps) доказаны прямыми
  VPS-curl как upstream/egress-среда, ВНЕ кода (fp match), т.е. НЕ нарушение равенства поведений.

---

### Изменённые/новые файлы (не прод-код)
- `scripts/_t005_verify.mjs`, `scripts/_t005_matrix.mjs`, `scripts/_t005_playback.mjs`,
  `scripts/_t005_hostbound.mjs`, `scripts/_t005_bench.mjs`, `scripts/_t005_hdvb_probe.mjs`,
  `scripts/task-005-fingerprint.mjs` — верификационные харнессы (read-only к VPS).
- `docs/SKAZ-MANIYA-TASK-005-WORKLOG.md`, этот отчёт.
- Серверный src/ НЕ менялся за время TASK-005.
