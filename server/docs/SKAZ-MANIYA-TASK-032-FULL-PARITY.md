# TASK-SKAZ-MANIYA-032 — MANIYA ONLINE = FULL SKAZ BEHAVIOR ON STAGING + STAGING TEST PLUGIN

Статус: **DONE — staging parity от сервера до плагина подтверждена; PROD НЕ ТРОНУТ**.
Дата: 2026-08-23. VPS: `root@95.85.241.121` (STAGING). PROD `135.106.195.203` — без изменений.

---

## 0. Сводка задания

Перенести полное поведение SKAZ/Lampac Online на staging-инстанс Maniya Online
(Lampa → плагин → discovery → search → external IDs → per-title источника → balancer →
source selector → provider → resolve → playback → сериалы/сезоны/эпизоды → fallback/retry →
кэш → health/show/ghost → UI state). Бренд сохранён: **Maniya Online** (имена провайдеров не переименованы).
Финальный кусок (Phase 17): выделенный STAGING test-плагин на 95.85.241.121 со стабильным URL,
диагностическими endpoint'ами и build-идентификатором.

**ABSOLUTE SAFETY (соблюдено):** все изменения только на 95.85.241.121; PROD 135.106.195.203 не тронут;
DNS PROD не тронут; `plugin.maniya-kvn.online` не переключён. Никакого production deploy (HARD STOP).

---

## 1. Деплой на staging (95.85.241.121)

| Пункт | Значение |
|---|---|
| Дерево сервера | `f771aa56…/78` (== локальное T032-дерево, diff-checked) |
| Пакет | `backup/t032-deploy-package.tgz` (5 файлов: `config.js`, `http.js`, `index.js`, `scripts/generate-staging-plugin.mjs`, regen `server/staging-public/maniya-online-staging.js`) |
| Pre-backup | `backup/t032-code-pre-20260823-083904/` (до замен) |
| Функции | F9 (serial title-only search fix в `SkazProvider.search()` :114 — title-гейт), staging infrastructure |
| .env | `PUBLIC_BASE_URL=http://95.85.241.121`, `MANIYA_STAGING_ENABLED=true`, `MANIYA_STAGING_PLUGIN_BASE=http://95.85.241.121`, `MANIYA_STAGING_BUILD=f771aa56` |
| Пользователь | `staging-test-4f3a9c21e7b64d08a5c2f1e9` (users=4, активен) |
| Сервис | systemd restarted → active + `/health` `{"ok":true}` |

**Важно отметить:** `PUBLIC_BASE_URL` на staging обязан указывать на staging-хост — модель строит
`api_url` из собственной базы клиента (см. §3), любая отсылка на прод-домен исключена по построению.

## 2. Phase 17 — dedicated STAGING test plugin + endpoints

- **Plugin route:** `http://95.85.241.121/staging/4f3a9c21e7b64d08a5c2f1e9.js`
  - короткая ссылка = hex-суффикс токена `staging-test-4f3a9c21e7b64d08a5c2f1e9` (`findUserByShortToken`)
  - отдаётся **только Lampa** (UA-гейт); браузеру → stub «Добавьте плагин в Расширения Lampa.» (PLUGIN-INSTALL-002 семантика)
  - содержимое: полный клиент Maniya Online + `window.MANIYA_ONLINE_TOKEN` (вшит сервером) +
    `window.MANIYA_STAGING_BUILD='f771aa56'`
  - идентичность: манифест **«Maniya Online — STAGING»** (компонент `maniya_online_staging`,
    флаг `maniya_online_staging_plugin_started`); в UI списка источников — имя **«Maniya Online»** (бренд сохранён)
  - автономность: **0 вхождений** `plugin.maniya-kvn.online` в сборке (grep's test: `assert.doesNotMatch`)
  - файл лежит в `server/staging-public/` (вне `publicDir`) → `sendStatic` его НЕ отдаёт (утечки нет)
- **Diagnostic endpoints (только staging, без секретов):**
  - `GET /health` → `{"ok":true,"service":"maniya-online-lampa"}` (был всегда)
  - `GET /api/lampa/health` → зеркало (живой)
  - `GET /version` → `{ok:true, service, version, env, staging:true, build:'f771aa56', model:true}`
  - `GET /api/lampa/version` → то же (живой)
  - все `*version` → 404 когда `MANIYA_STAGING_ENABLED` выключен (подобие PROD)
- **Сборка генератором:** `scripts/generate-staging-plugin.mjs [buildId] [pluginBase]` — читает
  `public/maniya-online.js`, 7 точных замен (API base/компонент/флаг/`MANIYA_STAGING_BUILD`/манифест),
  пишет `server/staging-public/maniya-online-staging.js` (57422 B, base `http://95.85.241.121`).

## 3. Behavioral verify — 4 контрольные карточки (T027-контракт)

Проверено на боксе (localhost → 3000), токен `staging-test-4f3a9c21e7b64d08a5c2f1e9`
(те же 4 карточки, что T027: Мятеж / История игрушек 5 / Интерстеллар / Дом Дракона):

| Карточка | HTTP | model | count* | KinoPub first | ghost | rch | api_url самодостаточен |
|---|---|---|---|---|---|---|---|
| Мятеж | 200 | ✅ | 35 | `skaz-kinopub` @1 S | ✅ | ashdi/kinoukr/eneyida | ✅ |
| История игрушек 5 | 200 | ✅ | 35 | `skaz-kinopub` @1 S | ✅ | ashdi/kinoukr/eneyida | ✅ |
| Интерстеллар | 200 | ✅ | 35 | `skaz-kinopub` @1 S | ✅ | ashdi/kinoukr/eneyida | ✅ |
| Дом Дракона | 200 | ✅ | 33 | `skaz-kinopub` @1 S | ✅ | ashdi/kinoukr/eneyida | ✅ |

*По-карточечный состав совпадает с T027 (35/35/35/33) до варьирования SKAZ-кластера
(`online[]` отдаёт ±1 источник между кэш-пересборками — документированный upstream-флук,
не регрессия Maniya; set ids + порядок + первый shown всегда те же).

- **api_url** — относительные пути `/api/lampa/videos?provider=<id>`: клиент Lampa резолвит их от
  своей базы плагина → при STAGING плагине запросы идут только на `http://95.85.241.121`.
  Прод-домен (`plugin.maniya-kvn.online`, `135.106.195.203`) отсутствует в модели целиком.
- **Static `/sources` = 21** — реестр не тронут (модель живёт только в `/sources/card`).
- **voices/seasons числа** во всех строках (kinopub v4, videoseed v12, rezka v19 на сериале, alloha v7).

## 4. Playback contract (стaging)

| Кейс | HTTP | items | результат |
|---|---|---|---|
| kinopub movie (Мятеж) | 200 | 4 | play/movie url → `http://95.85.241.121/api/lampa/proxy?...` ✅ |
| kinopub serial (Дом Дракона) | 200 | 10 | play/serial url ✅; **3 сезона, 13 голосов** |
| filmix (Мятеж) | 200 | 3 | proxy Range → **206** (`application/vnd.apple.mpegurl`) ✅ |
| static /sources | 200 | 21 | ✅ |
| cache | — | — | cold 8983ms → warm 6ms/4ms, `meta.cached:true` ✅ (TTL кэш, single-flight) |

Сериальный контракт (seasons=3, voices=13) идентичен T027. Пустые items (rch-каналы, upstream) — легитимная пустота, HTTP 200.

## 5. Тесты (регрессия серверной suite)

`cd server && NODE_ENV=test node --test --test-timeout=25000`:

| Показатель | Baseline (T021/прод) | Сейчас |
|---|---|---|
| Всего тестов | 795 | 810 |
| PASS | 787 | 802 |
| FAIL | 1 | 1 (единственный pre-existing: availability-route rutubemovie host-eгress, env-dependent) |
| SKIP | 7 | 7 |

+15 новых: 2× F9 (`skaz-provider.test.js`), 8× staging-routes (`staging-routes.test.js`, порт 3333),
5× staging-disabled (`staging-disabled.test.js`, порт 3399). Базовая парадигма не изменилась.

## 6. Итоговые координаты (Phase 17 форма)

- **STAGING PLUGIN URL:** http://95.85.241.121/staging/4f3a9c21e7b64d08a5c2f1e9.js
- **STAGING API:** http://95.85.241.121/api/lampa
- **STAGING BUILD:** `f771aa56`
- **TEST RESULT:** PASS (server-side полный; UI-сверка — установка плагина в Web Lampa / TV,
  источник в UI показывается как «Maniya Online — STAGING», список источников — «Maniya Online»)
- **PROD URL (plugin.maniya-kvn.online): НЕ ИЗМЕНЁН**
- **PROD SERVER (135.106.195.203): НЕ ИЗМЕНЁН**

**HARD STOP соблюдён: никакого production deploy не выполнялось. STAGING-плагин НЕ переносится на прод.**

## Артефакты

- `backup/t032-deploy-package.tgz` — deploy-пакет (5 файлов, верное дерево)
- `backup/t032-provision-staging.mjs` / on-box `t032-provision.cjs` — идемпотентная провизия (.env + user)
- `backup/t032-code-pre-20260823-083904/` — pre-deploy backup
- `backup/t032-verify-onbox.mjs`, `backup/t032-dump.mjs` — verify-скрипты
- `scripts/generate-staging-plugin.mjs` — генератор staging-сборки
- `server/staging-public/maniya-online-staging.js` — сгенерированная сборка (build f771aa56)
- `server/test/staging-routes.test.js`, `server/test/staging-disabled.test.js` — тесты Phase 17
- `server/test/fixtures/users.json` — staging-пользователь

**STOP. 95.85.241.121 = only staging. Дальнейший шаг (если будет отдельная команда) — DEPLOY TASK-032 TO PROD.**