# SKAZ-MANIYA-TASK-010 — PRODUCTION RELEASE OF ACCEPTED HLS FIX

**Дата:** 2026-08-21. **Тип:** RELEASE TASK (прод). **Тип релиза:** контролируемый, минимальный — перенесён РОВНО принятый Shadow HLS-фикс (TASK-009 ACCEPT).
**Единственное функциональное изменение:** `inheritBaseQuery()` в `server/src/proxy.js` + 2 regression-теста в `server/test/proxy.test.js`.

---

## 1. EXACT DIFF (единственное изменение)

Полное дерево `src/` prod-vs-shadow перед деплоем: **одинаковые имена файлов** (0 добавлений/удалений → удаление stale-файлов не требуется), и **ровно один content-diff**:

```
DIFF: ./proxy.js  prod=7e78f91d25cd5e10ac62d914a49c8c0f  shadow=77b20f42308393ddf21b19bbdaff34b1
```

- `proxy.js`: prod `7e78f91d` → `77b20f42` (inheritBaseQuery — HLS hash-пропагация §7 TASK-008/009).
- `proxy.test.js`: prod `b016bff9` → `297f9803` (добавлены 2 §7 regression-теста + фикстура `/hash.m3u8`).
- НЕ тронуты: `.env`, `data/`, `users.json`, `providers`, Telegram, nginx, database.
- НЕ менялся: балансировщик, providers, VPS/network, retry, архитектура.

## 2. FINGERPRINT (P3)

| среда | fingerprint | файлы |
|---|---|---|
| **OLD PROD** (pre-deploy, реконструкция из backup) | `b1f98f8ce0b9cfbd7710d5538f6aafb9ac33402640847a2670effb2047924bbf` | 76 |
| SHADOW (принят TASK-009) | `8fc187536d84a3dafe063ab33a0f1233beeed35291734f6c602a29f8c1f69f5e` | 76 |
| **NEW PROD** (post-deploy) | `8fc187536d84a3dafe063ab33a0f1233beeed35291734f6c602a29f8c1f69f5e` | 76 |

**LOCAL == SHADOW == PRODUCTION = `8fc18753…`.** Расхождения нет → STOP не требовался.

## 3. BACKUP (P1/P2)

- Каталог: `/opt/maniya-online/backup/t010-predeploy-20260821-191139/`
- `proxy.js.pre` (7e78f91d), `proxy.test.js.pre` (b016bff9), `src.tgz` (полное старое src), `pre.md5`.
- Rollback-путь: заменить `proxy.js`/`proxy.test.js` на `.pre`, перезапустить сервис.

## 4. DEPLOY (P2) — CONTROLLED

Только 2 файла (local → stage → verify md5 → прод):
```
staged proxy.js      = 77b20f42 (expect 77b20f42) ✓
staged proxy.test.js = 297f9803 (expect 297f9803) ✓
prod proxy.js  md5 = 77b20f42 ✓
prod proxy.test.js  = 297f9803 ✓
systemctl restart maniya-online → active, NRestarts=0
```

## 5. HEALTH (P4)

- systemd `maniya-online.service`: **active/running**, NRestarts=**0**, PID 491256.
- Process: listening `0.0.0.0:3000`.
- Health local `:3000/health` = **200**; public `https://plugin.maniya-kvn.online/health` = **200** (TLS verify 0).
- nginx: config OK. 0 критических 5xx в логе после рестарта.

## 6. REAL FILMIX HLS (P5) — **PASS**

Тот же acceptance, что TASK-009: filmix «История игрушек 5», `nl105.cdnsqu.com`, на ПРОД (`:3000`).

| объект | status | ctype | note |
|---|---|---|---|
| `/videos` | 200 | — | 3 play items, provider_error=null |
| manifest | 200 | application/vnd.apple.mpegurl | base hash 95ch |
| seg-1 | **206** | video/MP2T | contentRange bytes 0-1048575/23098808, first-byte `4740…` (sync), hash present |
| seg-2 | **206** | video/MP2T | contentRange …/31725752, hash present |
| seg-3 | **206** | video/MP2T | contentRange …/31283576, hash present |

- 572/572 rewritten URI = proxy + hash; **0×403**; werkecdn-идемпотентность сохранена (95ch на сегментах).
- Result: **PASS**, criteria {manifest200, hashOnAllURIs, segOk3, zero403} = все true.

## 7. REAL PLAYER (P6) — **PASS** (не только curl)

Реальный hls.js 1.7.1 в headless Chrome, грузит prod-публичный URL (`https://plugin.maniya-kvn.online/api/lampa/proxy?…`, через nginx/TLS):

- `MANIFEST_PARSED` ✓
- `LEVEL_LOADED total=5720s frags=572` ✓
- `FRAG_LOADED`#1/#2, `FRAG_BUFFERED`#1/#2 ✓
- `readyState=4`, `currentTime=3.72`, `bufferedEnd=10.47`, `duration=5720`, `paused=false` → **decoded & playing**
- **fatal=null** (0 fatal fragLoadError)
- Net: manifest 200 mpegurl, сегменты 200 `video/mp2t` — **0×403**
- non-fatal `bufferFullError`/`ERR_ABORTED` — артефакты софтверного декодера headless на 4K (аналогично TASK-009), не влияют.

## 8. REGRESSION (P7)

Полный suite (локальный код == deployed src, fingerprint-подтверждено):

```
tests 763 | pass 756 | fail 1 | skipped 6
```

- `fail 1` = `availability-route.test.js:41` — **известный pre-existing egress-флейк** (route:41), идентичен baseline TASK-008/009, не связан с proxy.js.
- `proxy.test.js` = **20/20** включая оба §7 regression-теста.
- **Новый fail не появился** → STOP не требовался.

## 9. PROVIDER SMOKE (P8, на ПРОД)

| источник | items | ms | статус |
|---|---|---|---|
| filmix | 3 | 407 | **PASS** |
| rezka | 22 | 7312 | **PASS** |
| hdvb | 1 | 882 | **PASS** |
| videoseed | 0 | 553 | EMPTY (транзиент) |
| kodik | 0 | 258 | EMPTY |
| kinopub | 0 | 483 | EMPTY (egress-окно) |
| alloha | 0 | 428 | EMPTY (egress-окно) |
| veoveo | 0 | 1096 | EMPTY |
| kinotochka | 0 | 9 | EMPTY (native-absent) |
| collaps | 0 | 1882 | EGRESS (SE-egress, upstream) |

Все 200, **0×FAIL**. Идентично shadow-acceptance TASK-009. Известные upstream/egress проблемы НЕ считаются регрессией.

## 10. POST-DEPLOY MONITORING (P9)

Сканирование journalctl с момента деплоя (`2026-08-21 19:12`):

- Status codes: **22×200, 3×206, 0×5xx**.
- Error-level / proxy / HLS / availability: **0 строк** (нет fragLoadError, proxy_host_forbidden, unhandledRejection, crash).
- `NRestarts=0` (PID стабилен, авто-рестартов нет).
- Hotfix НЕ выполнялся.

---

## ROLLBACK STATUS

Готов и тривиален: каталог `backup/t010-predeploy-20260821-191139/` содержит старое `proxy.js.pre` + `proxy.test.js.pre` + `src.tgz`. Откат = копирование `.pre` поверх, `systemctl restart maniya-online`. Не потребовался.

## KNOWN UPSTREAM ISSUES (не регрессии, перенесены из TASK-009)
videoseed/kinopub/alloha/veoveo EMPTY — транзиент egress-окна; collaps = SE-egress upstream; kinotochka = native-absent (HIDE by design); kodik EMPTY — upstream быстрый ответ «нет».

---

## ФИНАЛЬНЫЙ СТАТУС: **ACCEPT**

Принятый Shadow HLS-фикс перенесён на Production ровно, без дополнительных изменений. Доказано: fingerprint LOCAL==SHADOW==PROD, health green, реальный filmix HLS HTTP-chain PASS (0×403), реальный hls.js player PASS (fatal=null), регресс 763/756/1/6 (= baseline, без новых фейлов), provider smoke без FAIL, post-deploy 0×5xx / 0 рестартов / 0 proxy-HLS-errors. Rollback готов и не потребовался.
