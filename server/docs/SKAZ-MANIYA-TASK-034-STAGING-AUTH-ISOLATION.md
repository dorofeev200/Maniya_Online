# SKAZ-MANIYA-TASK-034 — STAGING AUTH ISOLATION (M1 + M2)

**Статус:** ✅ ВЫПОЛНЕНО (staging). **PROD НЕ ТРОНУТ. HARD STOP после тестов — PROD-деплой не выполнялся.**
**Дата:** 2026-08-23. **Сборка staging:** `5fb2c9e8` (local == box, fingerprint совпадает).

## Задача
Исправить staging-изоляцию: PROD и STAGING Maniya Online должны одновременно
находиться в одном WebView Lampa без взаимного перетирания токена (T033 root cause
= кросс-плагинная утечка: общий `window.MANIYA_ONLINE_TOKEN` + общие Storage-ключи).

- **M1** — staging вшивает/читает токен в СВОЙ глобал `MANIYA_ONLINE_TOKEN_STAGING`;
  PROD-глобал `MANIYA_ONLINE_TOKEN` не меняется.
- **M2** — staging использует component-scoped Storage-ключи `maniya_token_staging` /
  `maniya_unic_id_staging`; PROD-ключи `maniya_token` / `maniya_unic_id` не меняются.

## Первопричина (из T033, READ-ONLY форез)
Обе сборки (прод-VIP и staging) на устройстве писали ОДИН `window.MANIYA_ONLINE_TOKEN`
(серверный инжект первой строкой) и ОДНИ Storage-ключи. Загруженная второй (staging)
перетирала глобал прота-плагина → прод-VIP начинал ходить с `token=staging-test-…` →
PROD `/subscription/check` отвечал `200 170 active:false` «не активна».

## Изменения (5 файлов)

### 1. `server/src/http.js` — M1: параметр `tokenGlobal`
`sendPluginForToken(request, response, token, file, dir, tokenGlobal)` — тело использует
`window.${tokenGlobal}=...`. **PROD-вызовы аргумент не передают → default
`'MANIYA_ONLINE_TOKEN'` → поведение PROD байт-в-байт не меняется.**

### 2. `server/src/index.js` — M1: staging-роут инжектит в СВОЙ глобал
```js
return sendPluginForToken(request, response, user.token, 'maniya-online-staging.js',
  config.staging.stagingPublicDir, 'MANIYA_ONLINE_TOKEN_STAGING');
```
Комментарий обновлён (T034 M1).

### 3. `scripts/generate-staging-plugin.mjs` — M2: замены только на выходе сборки
Исходник `public/maniya-online.js` НЕ меняется — правки только в staging-build:
- `getTokenFromRuntime()` → читает ТОЛЬКО `window.MANIYA_ONLINE_TOKEN_STAGING`;
- `'maniya_token'` → `'maniya_token_staging'`;
- `'maniya_unic_id'` → `'maniya_unic_id_staging'`.
Порядок замен важен (функция первой); многострочные from/to — в CRLF (источник CRLF).

### 4. `server/staging-public/maniya-online-staging.js` — перегенерирована сборка
Diff vs pre-T034 (`backup/t034-build-before.js`, 57422 B): **ровно 3 правки** —
build-id `f771aa56→5fb2c9e8` и M2-замены (см. diff ниже). Ничего лишнего.

### 5. `server/test/staging-routes.test.js` — 4 новых регрессионных теста
`Phase 17 — TASK-034 auth isolation (M1 global + M2 Storage)`:
global isolation, storage isolation, subscription flow, sources flow.

### Точный diff сборки (M2)
```
29:   window.MANIYA_STAGING_BUILD = 'f771aa56' → '5fb2c9e8'
71:   Storage.get('maniya_token') → 'maniya_token_staging'
75:   localStorage.getItem('maniya_token') → 'maniya_token_staging'
86:   Storage.set('maniya_token') → 'maniya_token_staging'
89:   localStorage.setItem('maniya_token') → 'maniya_token_staging'
96-98: window.MANIYA_ONLINE_TOKEN / maniya_online_token / maniyaOnlineToken
     → window.MANIYA_ONLINE_TOKEN_STAGING (единственный)
107:  Storage.get('maniya_unic_id') → 'maniya_unic_id_staging'
110:  Storage.set('maniya_unic_id') → 'maniya_unic_id_staging'
```
(Читаемый фолбэк `lampac_token` остаётся — он общий legacy-ключ чужого плагина,
read-only, STAGING/PROD его не пишут; в T033-базе тоже был.)

## Стенд-деплой (ТОЛЬКО staging 95.85.241.121)
- `scripts/generate-staging-plugin.mjs 5fb2c9e8` → `server/staging-public/maniya-online-staging.js`
- Box: src-правки + `.env MANIYA_STAGING_BUILD=5fb2c9e8` + рестарт `maniya-online.service`
- Fingerprint: local `5fb2c9e8 78` == box `5fb2c9e8 78` (деплойнуто то, что собрано)

## Верификация (1–7)

| # | Требование | Результат |
|---|---|---|
| 1 | staging собран | ✅ `5fb2c9e8`, /version → `{staging:true, build:5fb2c9e8, model:true}` |
| 2 | staging плагин загружается | ✅ `http://95.85.241.121/staging/4f3a9c21e7b64d08a5c2f1e9.js` (57491 B Lampa; браузеру stub) — строка 2 `window.MANIYA_ONLINE_TOKEN_STAGING="staging-test-…"` |
| 3 | PROD+STAGING side-by-side в одном WebView | ✅ Node-vm харнесс `backup/t034-side-by-side.mjs`: общий window+Storage+localStorage, порядок загрузки PROD(vip)→STAGING (как T033) |
| 4 | PROD свой токен → свой API; STAGING свой → свой; check active | ✅ см. ниже; `/subscription/check` staging-token → `active:true` «Подписка Maniya Online активна»; `/sources` 200 все источники (filmix/kodik/rezka/…, url → **только** 95.85.241.121); `/sources/card` → `meta.model:true`, 34 per-title items |
| 5 | чистый staging WebView | ✅ staging построен регенизром: прод-ключей в сборке нет (тесты doesNotMatch maniya_token/maniya_unic_id), API base — сам staging |
| 6 | playback хотя бы одного источника | ✅ skaz-kinopub → `/api/lampa/proxy?...` → **HTTP 206** `application/vnd.apple.mpegurl` (HLS), 1027 B манифеста через staging-proxy |
| 7 | PROD endpoint не видит staging-token и наоборот | ✅ харнесс захватил РЕАЛЬНЫЕ URL запросов обоих плагинов (см. ниже) |

### Side-by-side харнесс (общий WebView)
```
window.MANIYA_ONLINE_TOKEN         = "mo-fb9bf9397c6ab1f525c7207711693970"   ← сохранился
window.MANIYA_ONLINE_TOKEN_STAGING = "staging-test-4f3a9c21e7b64d08a5c2f1e9"
Storage: maniya_token=mo-…, maniya_token_staging=staging-test-…  (оба сосуществуют)
Storage: maniya_unic_id=…a, maniya_unic_id_staging=…b (uid раздельны)

drive full/complite → фактические запросы:
  PROD    → plugin.maniya-kvn.online/api/lampa/subscription/check  token=mo-fb9bf939…&uid=f029c2e0
  STAGING → 95.85.241.121/api/lampa/subscription/check             token=staging-test-…&uid=ad99cc6f
  кросс-утечки: 0
```

## Регрессионные тесты (обязательные)
```
NODE_ENV=test node --test  →  tests 814 / pass 806 / fail 1 / skipped 7
```
- +4 (новые T034: global-isolation, storage-isolation, subscription, sources) — все PASS.
- Единственный fail — `availability-route.test.js:41` (cdnvideohub RULE-3, сеть-зависимый).
  **Пре-существующий**: та же сигнатура была в T032 baseline (810/802/1/7 → 814/806/1/7),
  0 регрессий от T034.

## PROD не изменён — подтверждение
- Ни одного обращения/записи на бокс 135.106.195.203 (деплой только на 95.85.241.121).
- `public/maniya-online.js` (прод-исходник) не правился: M2 живёт только в выходе
  сборки, M1 — default-параметр (прод-вызовы вызывают функцию с прежними аргументами).
- Servеd прод-байты из T033 (`backup/t033-prod-vip.js`): `window.MANIYA_ONLINE_TOKEN=mo-…`,
  storage-ключи `maniya_token`/`maniya_unic_id` — без изменений (использованы как инпут
  харнесса, показали прежнее поведение).
- Коммитов/пушей в прод-ветки не делалось.

## Staging URL
`http://95.85.241.121/staging/4f3a9c21e7b64d08a5c2f1e9.js` (вставить в Расширения Lampa)

## Изменённые файлы (deliverable)
- `server/src/http.js` (M1, +8/−3)
- `server/src/index.js` (M1 в staging-роуте)
- `scripts/generate-staging-plugin.mjs` (M2, генератор)
- `server/staging-public/maniya-online-staging.js` (сборка, перегенерирована)
- `server/test/staging-routes.test.js` (+4 регрессионных теста)
Артефакты: `backup/t034-side-by-side.mjs` (харнесс), `backup/t034-staging-served.js`
(served-байты), `backup/t034-build-before.js` (pre-M2).

## HARD STOP
PROD-деплой НЕ выполнялся и не запланирован этой командой. M3 (операционное: убрать
прод-VIP перед установкой staging на устройстве) и M4 (вторичная: вип-сборка stub на
staging-боксе имеет MANIYA_API_BASE=PROD — вне scope T034) — зафиксированы, НЕ делались.