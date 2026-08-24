# SKAZ-MANIYA-006 — Production Deploy + Final Production Verification

Дата: 2026-08-21. Тип: **первый Production deployment** Shadow-ACCEPT версии.
Требования TASK-005 (§29: ПРОД-ДЕПЛОЙ — отдельная задача) выполнены: деплой именно **b1f98f8c**,
без изменений кода, с сохранением exact fingerprint.

---

## 1. Pre-deploy snapshot
| Параметр | Значение |
|---|---|
| current production version (до деплоя) | `aee2d9454207...` (100 файлов, старая структура) |
| target version | `b1f98f8ce0b9cfbd7710d5538f6aafb9ac33402640847a2670effb2047924bbf` (76) |
| branch | `gap-012-veoveo` |
| commit | `2fd2f5c0dd62229de85f4750715c9568a6001bf9` (+ uncommitted TASK-002/004 фиксы в дереве) |
| changed files (деплой-сетап) | `server/src/**` + `package.json` + `test/**` + `test-helpers/**` |
| deployment method | clean-replace `server/src` на VPS + `scripts/deploy.sh` (tar-over-ssh, systemd/nginx restart) |
| timestamp | 2026-08-21 15:48–15:50 UTC |

**Условие: TARGET FINGERPRINT == SHADOW ACCEPTED FINGERPRINT — подтверждено (b1f98f8c == b1f98f8c).**

## 2. Backup
- `backup/snapshots/20260821-184800` (fresh, deploy-time): `server/.env` (KODIK_TOKEN ✓), `users.json` (токены ✓). Валидация backup-скрипта: OK.
- VPS-side rollback snapshot: `/opt/maniya-online-rollback-t006/server-pre-t006-20260821-154815.tgz` (полный `server/` до очистки/деплоя).
- Backup source не менялся (штатный `backup-remote.sh`).

## 3. Target version
- **b1f98f8ce0b9cfbd7710d5538f6aafb9ac33402640847a2670effb2047924bbf (76 файлов)** — LOCal == Shadow == Target.
- Shadow-приёмка (TASK-005): ACCEPT; prod не трогался тогда.

## 4. Deployment
- **Legacy TelegramAuth аудит** (read-only): слой признан полностью legacy (REMOVE), обычный Telegram-бот — PRESENT и независим.
  Отчёт: `docs/SKAZ-MANIYA-TASK-006-LEGACY-TELEGRAMAUTH-AUDIT.md`.
- **Clean**: удалены 25 stale-файлов (`telegram-auth/` (10), старые `registry.js`/`SkazClient.js`, `skaz/{index,store}.js`, `.bak-*`, `.pre-tga-*`, `test/eolive-debug.test.js`). Post-clean `src` = 75 файлов, filename-set IDENTICAL локальному.
- **Deploy**: `bash scripts/deploy.sh` → tar-over-ssh в `/opt/maniya-online`, systemd restart `maniya-online` (:3000), nginx `nginx -t` OK, certbot TLS дeployed (plugin.maniya-kvn.online HTTPS). `.env` и `data/` НЕ перезаписаны (прошлый `server/.env` сохранён).

## 5. Fingerprint verification (IMMEDIATE, §7)
- **PROD после деплоя = `b1f98f8c...` (76)** ← exact match Shadow.
- GATE: PASS. STOP+rollback не потребовался.

## 6. Health
- systemd `maniya-online` active; :3000 (pid 469167); `NRestarts=0`.
- HTTPS `/health` → `{"ok":true,"service":"maniya-online-lampa"}`.
- Log: `server_started ... telegram:"enabled"`, `telegram_polling_started` (админы заданы).
- `/api/lampa/sources` гейтится подпиской (403 без токена — ожидаемо).

## 7. Videoseed smoke («Дом дракона» id=94997 S01E01)
- `/videos` 200, items=10; item0 S01E01 method=call → `/api/lampa/video` → 200 method=play →
  `/api/lampa/proxy?url=…/proxy/<hash>.m3u8` → fetch → **HTTP 200 + `#EXTM3U`**.
- **call-url leakage = 0.** PASS.

## 8. Episodes S01E01–S01E03
- S01E01: resolved 200 → proxy m3u8, m3u8 fetch 200 `#EXTM3U`.
- S01E02: resolved 200 → proxy m3u8, 0 leak. S01E03: resolved 200 → proxy m3u8, 0 leak.
- **3/3 resolved, 0 call-url.** PASS.

## 9. SKAZ_ENABLED
- Prod `.env`: `SKAZ_ENABLED=true` — соответствует текущей production configuration. Не менялось.

## 10. Provider smoke (§12/§17)
| Provider | Результат |
|---|---|
| videoseed | call→200 resolved, leak=0 ✓ |
| rezka | direct→proxy, leak=0 ✓ |
| filmix | direct→proxy, leak=0 ✓ (content-variable, UPSTREAM по правилам §17) |
| hdvb | direct card-форма, leak=0 ✓ (content-variable, UPSTREAM §17) |
| kodik | direct→proxy, leak=0 ✓ |
| kinopub | items=0 — **UPSTREAM**: идентичный empty на Shadow (тот же код/VPS, честное сравнение 200/0) |
| alloha | call→200 resolved, leak=0 ✓ |
| veoveo | direct→proxy, leak=0 ✓ |
| kinotochka | direct→proxy, leak=0 ✓ (kvb.cool протухший URL — UPSTREAM §17) |
| collaps | empty `collaps_http_error` — SE-egress NO_SOURCE, UPSTREAM §17 ✓ |

## 11. Unified Balancer (§13)
- Все сквозные цепочки Discovery→Provider→Balancer→Host→Source→Resolve идут через Maniya (proxy/video);
  0 call-url → **нет прямого обхода Balancer**. Per-title availability работает (videoseed/alloha call→resolve на тех же хостах).

## 12. Host-bound (§14)
- videoseed call: gen `plugin.maniya-kvn.online` == res `plugin.maniya-kvn.online`, leaked=no → **PASS**.
- Провайдеры с direct-play: host-bound N/A (0 call-url).

## 13. Cross-query 20× (§15)
- Смесь movie/serial/episode, все провайдеры: **found=16/20, callUrl=0, resolveFail=0, stateLeak=0.**
- 4 empty классифицированы: kinopub ×2 (UPSTREAM, ==Shadow), collaps ×2 (SE-egress, §17). Непредвиденных empty нет.

## 14. Production benchmark 20× videoseed (§16)
- **ok=20/20, empty=0, callurl-leak=0, resolveFail=0, resolved=20.**
- latency p50=76ms, p95=1078ms. Функциональный паритет с Shadow (§8/§19: 20/20, 0 leak). Latency не сравнивается 1:1 (env).

## 15. Provider benchmark (§17)
- videoseed/rezka/filmix/hdvb/kodik/alloha/veoveo/kinotochka — resolve/direct через proxy, leak=0.
- Учтены подтверждённые upstream-особенности: filmix (stale узел), kinotochka (kvb.cool 404), hdvb (content-variable), collaps (SE-egress) — НЕ Maniya-регрессии.

## 16. Regression (§18)
- Suite: **761 тестов / 754 pass / 1 fail / 6 skipped — IDENTICAL baseline (761/754/1/6).**
- Единственный fail = `availability-route.test.js:41` — документированный pre-existing двухслойный rutubemovie egress-timeout (skaz-слой устранён TASK-004; остаточный native egress). Asserts НЕ ослаблялись.

## 17. Monitoring (§19)
- Окно с момента деплоя (15:50 UTC): NRestarts=0, активен без сбоев.
- Сканирование лога: НЕТ 5xx, НЕТ video_not_found, НЕТ unhandled rejection/краша, НЕТ call-url маркеров, НЕТ mass-empty.
- Response-коды: 104×200, 1×403 (ожидаемый auth-гейт). Telegram-bot: `telegram_polling_started`, без ошибок.

## 18. Upstream failures (не Maniya-баги, классифицировано честно)
- **kinopub** items=0 (Дюна2/Матрица/Паразиты): идентичный empty на Shadow (тот же код b1f98f8c, тот же VPS/egress) → UPSTREAM/egress/content. Не регрессия.
- **collaps** `collaps_http_error` / NO_SOURCE: SE-egress (известно GAP-013 / §17). Не регрессия.
- **filmix/kinotochka/hdvb**: подтверждённые upstream/контентные особенности (§17). Не регрессии.

## 19. Rollback
- **НЕ требуется** (все gates PASS). Процедура при необходимости: восстановить `server-pre-t006-...tgz` + `.env/data` из `20260821-184800`, `systemctl restart maniya-online`, health-check `/health` → fingerprint вернётся к `aee2d945...`.

---

## 20. Финальный acceptance

```
TASK-SKAZ-MANIYA-006

TARGET:
b1f98f8ce0b9cfbd7710d5538f6aafb9ac33402640847a2670effb2047924bbf (76)

SHADOW ACCEPTED FINGERPRINT:
b1f98f8ce0b9cfbd7710d5538f6aafb9ac33402640847a2670effb2047924bbf (76)

PRODUCTION FINGERPRINT:
b1f98f8ce0b9cfbd7710d5538f6aafb9ac33402640847a2670effb2047924bbf (76)

VERSION MATCH:
PASS

BACKUP:
PASS (backup/snapshots/20260821-184800 + VPS pre-clean tgz)

HEALTH:
PASS

VIDEOSEED:
PASS (§7 smoke + §8 E01–E03, 0 call-url)

PROVIDERS:
PASS (videoseed/rezka/filmix/hdvb/kodik/alloha/veoveo/kinotochka + kinopub/collaps=UPSTREAM)

UNIFIED BALANCER:
PASS (0 bypass, per-title через Maniya)

HOST-BOUND:
PASS (videoseed gen==res, 0 leak)

CROSS-QUERY:
PASS (20×: callUrl=0, stateLeak=0, empty только классифицированные)

PLAYBACK:
PASS (m3u8 200 #EXTM3U)

REGRESSION:
PASS (761/754/1 pre-existing route:41/6 — identical baseline)

MONITORING:
PASS (0 5xx, 0 crash, telegram enabled)

ROLLBACK:
NO

PRODUCTION:
PASS

NEW BUGS:
0

UPSTREAM ISSUES:
kinopub empty (=Shadow, UPSTREAM); collaps SE-egress; filmix/kinotochka/hdvb контент-переменные (известные)

FINAL STATUS:
ACCEPT
```

### Дополнительно (решение пользователя)
- **LEGACY TELEGRAMAUTH: REMOVE** (намеренно выведен из целевой архитектуры; отсутствие в b1f98f8c — ожидаемое, НЕ version mismatch).
- **NEW TELEGRAM BOT: PRESENT & RUNNING** (`src/telegram/{runner,bot,BotClient}.js`, `telegram_polling_started`, независим от старого TelegramAuth).
- Никаких ручных надстроек поверх b1f98f8c. Никаких hotfix-изменений на production.
- После финального acceptance дополнительных автоматических изменений не производилось.