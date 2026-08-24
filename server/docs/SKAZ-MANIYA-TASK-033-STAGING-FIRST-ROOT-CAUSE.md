# SKAZ-MANIYA-TASK-033 — STAGING FIRST ROOT CAUSE

**Дата:** 2026-08-23 · **READ-ONLY forensic** · PROD не тронут · код не менялся до установления причины.
**Ограничения задания:** не трогать PROD (135.106.195.203), не менять код до FIRST ROOT CAUSE, не менять названия источников/UI, работа только с staging 95.85.241.121. **HARD STOP** после установления причины.

---

## 0. Сводка

| Ветка | Пользовательский симптом | Диагноз |
|---|---|---|
| **A. WEB** | staging-URL `http://95.85.241.121/staging/4f3a9c21e7b64d08a5c2f1e9.js` «не грузится» | ✅ **НЕ баг / by-design**: обычному браузеру (YaBrowser, curl) отдаётся **stub 60 B** «Добавьте плагин в Расширения Lampa.» по UA-гейту `isLampaRequest` (`server/src/http.js:41`, PLUGIN-INSTALL-002). Web Lampa с корректным origin (bylampa.online) и Android-native Lampa получают полную сборку **57559 B**. Устройство в логах качало 57559 B четыре раза (09:05:07/08/25/26/32, SM-S928B 09:15:33). |
| **B. ANDROID-AUTH** | плагин грузится «Maniya Online — STAGING», внутри **«Подписка Maniya Online не активна»** | 🔴 **FIRST DIVERGENCE**. На устройстве **одновременно установлены ДВА плагина** в один Lampa WebView: старый прод-VIP (`maniya_online`, base `https://plugin.maniya-kvn.online/api/lampa`) и новый staging (`maniya_online_staging`, base `http://95.85.241.121/api/lampa`). Оба пишут и читают **ОБЩИЙ глобал `window.MANIYA_ONLINE_TOKEN`** + одни и те же `Lampa.Storage`-ключи (`maniya_token`, `maniya_unic_id`). Последней загрузилась staging-сборка → затёрла общий глобал на `staging-test-…`. Прод-VIP-плагин при открытии пошёл на **PROD** `subscription/check` с **staging-токеном** → PROD не знает такого юзера → **200 170 B `{active:false, message:"Подписка Maniya Online не активна"}`** — ровно текст жалобы. STAGING-API с тем же токеном **в ту же секунду отвечает 200 219 B `active:true`** — staging-бэкенд здоров. |
| **C. SOURCES** | источников нет / не вызываются | `/sources`** на staging НЕ вызывался устройством ни разу** (единственный `/api/lampa/sources` в логе — от моей VM-пробы 09:19:20, uid=simuid123, не от девайса). Цепочка обрывается в клиенте: видимый UI показал `subscriptionRequired` от PROD-ответа (`active:false`) до/вместо `loadSources`. STAGING standalone-цепочка (VM на served-сборке 57559 + база + токен): check→`active:true`→`/sources` 200 3281 — **staging рабочий**. |

**Первый и единственный FIRST ROOT CAUSE** (для всей жалобы «staging не работает у реального клиента»):

> **Кросс-плагинная утечка токена через общий `window.MANIYA_ONLINE_TOKEN` + общие `Lampa.Storage`-ключи.** Served-сборка staging пишет токен в общий глобал (`/* Maniya Online — подпись токена сервером */ window.MANIYA_ONLINE_TOKEN="staging-test-…";` — самая первая строка файла), а `getTokenFromRuntime()`/`ensureToken()` (`backup/t033-served-staging.js:97-119`) при каждом запросе читают **то, что сейчас лежит в `window`**, а не свой вшитый токен. На устройстве, где поверх работающего прод-VIP-плагина добавили staging, фактические API-запросы одного плагина уходят на базовый хост **другого** плагина с чужим токеном. PROD отвечает `active:false` и **именно этот ответ** рендерится в UI как «Подписка Maniya Online не активна».

---

## 1. A — WEB: почему URL «не грузится»

**Факты из логов staging-бокса (nginx access.log, девайс 178.173.126.235 и др.):**

| время | URL | bytes | UA | вывод |
|---|---|---|---|---|
| 09:15:33 | `/staging/4f3a9c21e7b64d08a5c2f1e9.js` | 57559 | `SM-S928B … Lampa/0.20.4` | полная сборка ✅ |
| 09:05:07–09:13:22 | `/staging/…js` (5×) | 57559 | `lampa_client` (Android) | полная сборка ✅ |
| 09:14:02, 09:14:18 | `/staging/…js` | **60** | `YaBrowser` (обычный браузер) | **stub** |
| 09:46:49 | `/staging/…js` | **60** | `curl/8.14.1` | **stub** |
| 09:46:50 | `/staging/…js` | 57559 | `Mozilla/5.0 Lampa/0.20.4` | полная сборка ✅ |

**Код:** `server/src/http.js:41` — `if (.js && !isLampaRequest(request)) return sendPluginStub(...)`. `isLampaRequest` (`http.js:96-104`): UA содержит `/lampa/i`, **или** `origin=bylampa.online`, **или** есть `logged`+`reset` в query. Обычный браузер ни одно из условий не выполняет → stub 60 B.

**Вывод (A):** «не грузится в браузере» = **работающая защита от ручной установки в браузер**, а не дефект. Любая настоящая Lampa (Web с origin bylampa.online, Android, SM-S928B) получает 57559 B. WEB: **PASS (by-design)**. Пользователю достаточно вставлять URL в раздел «Расширения» Lampa, а не открывать в браузере.

---

## 2. B — ANDROID-AUTH: почему «Подписка Maniya Online не активна»

### 2.1 Что реально происходило на устройстве (178.173.126.235) 23 Aug

**06:28–06:30 — прод-VIP-плагин работал отлично** (PROD-лог):
`subscription/check` (mo-token) → **211?/219**; полный флоу `sources`→`sources/card`→`videos (kodik/rezka)` [200] — т.е. до установки staging ничего не ломалось.

**09:05:07–09:05:32 — юзер ставит staging-плагин** поверх (staging-лог: `staging/…js` 57559 и `vip-kanal-tvv_207711693970.js` 57220 качаются из одного WebView вперемешку).

**09:05:38 — первый расходящийся момент.** Один и тот же момент времени, один IP (178.173.126.235), **одни и те же query-параметры** (`tz=-180&account_email=…&uid=qqxlj0kh&token=staging-test-4f3a9c21…&cub_id=452257384`):

| хост | status | body | active |
|---|---|---|---|
| **STAGING** `95.85.241.121/api/lampa/subscription/check` | 200 | **219 B** | **true** (staging-test юзер есть, план staging-test активен) |
| **PROD** `plugin.maniya-kvn.online/api/lampa/subscription/check` | 200 | **170 B** | **false** → message **«Подписка Maniya Online не активна»** |

Повторения той же пары: 09:05:50, 09:13:03 (и 09:05:43/52, 09:07:12, 09:13:04 — одиночные). **170 B = ровно строка жалобы.** Юзер видел текст, пришедший от **PROD**, потому что свой прод-VIP-плагин после загрузки staging-сборки посылает на PROD **staging-токен**.

### 2.2 Механизм утечки (доказательство)

1. **Обе сборки вшивают токен в одну и ту же глобальную переменную:**
   `public`/build → первая строка файла:
   - prod-VIP `(54779 B / 57220 B)`: `window.MANIYA_ONLINE_TOKEN="mo-fb9bf9397c6ab1f525c7207711693970";`
   - staging `(57559 B)`: `window.MANIYA_ONLINE_TOKEN="staging-test-4f3a9c21e7b64d08a5c2f1e9";`
2. **Оба плагина читают её в рантайме**, а не свой вшитый токен:
   `t033-served-staging.js:97-102` `getTokenFromRuntime()` → `window.MANIYA_ONLINE_TOKEN` → `maniya_online_token` → `maniyaOnlineToken`; `:117-119` `ensureToken()` = `getQueryParam('token') || getTokenFromRuntime() || readStoredToken()`; `:171-172` в `requestJson` токен кладётся и в URL (addAccountParams), и в `Authorization: Bearer`.
3. В одном WebView Lampa скрипты всех установленных плагинов выполняются в **одном `window`**. Кто загрузился последним — тот и перезаписал глобал.
4. Прод-VIP-плагин при `MANIYA_API_BASE=https://plugin.maniya-kvn.online/api/lampa` и `window.MANIYA_ONLINE_TOKEN=staging-test-…` отправляет `subscription/check` на PROD с staging-токеном → **PROD такого юзера не имеет → 170 B active:false**.
5. Staging-плагин при `MANIYA_API_BASE=http://95.85.241.121/api/lampa` с тем же токеном → staging такого юзера знает → **219 B active:true** (в логах это и есть).
6. Хранение тоже общее: `persistToken` пишет `Lampa.Storage.set('maniya_token', …)` (`:88`), `ensureUid` — `maniya_unic_id` (`:109`) — тот же ключ у обоих плагинов. Установка одного перетирает состояние другого.

### 2.3 FIRST DIVERGENCE (первое место, где staging отличается от рабочего PROD)

**Не сервер, не URL установки, не база.** FIRST DIVERGENCE — на **границе сборки↔Lampa**: served-staging-сборка использует **те же общие идентификаторы/глобалы, что и прод-сборка** (`window.MANIYA_ONLINE_TOKEN`, `Lampa.Storage['maniya_token']`, `['maniya_unic_id']`) вместо компонентно-изолированных. Расхождение материализуется, когда LOS осведомлён о последовательности установки: порядок загрузки определяется тем, что юзер ставил последним. Ничто в коде staging не защищает свою подпись токена от клоба конкурирующей сборки. В PROD-окружении одиночный плагин → расхождения не видно.

Первая наблюдаемая точка расхождения (по логам): **09:05:38, `https://plugin.maniya-kvn.online/api/lampa/subscription/check` + `window.MANIYA_ONLINE_TOKEN="staging-test-…"` → 200 170 `{active:false}`**.

---

## 3. C — SOURCES: вызываются ли `/sources` и `/sources/card`

**Факт:** с устройства (uid=qqxlj0kh, cub_id=452257384) **ни разу не пришёл** `/api/lampa/sources` **ни на staging, ни на PROD** после 09:05. Единственный `/api/lampa/sources` в staging-логе за день — **моя VM-проба 09:19:20** (`uid=simuid123`, UA `Lampa/0.20.4 sim`, `id=157372 Интерстеллар`, bytes 3281). PROD `/sources` после 09:05 — только от другого UID (`kelbhzwz`, другое устройство, 08:59).

**Почему не вызываются:**
- Видимый UI показал `subscriptionRequired(json.message)` («Подписка Maniya Online не активна») от **PROD-ответа** 170 B. В клиенте `checkSubscription` (`:449-458`): `if (json.active===false) return self.subscriptionRequired(json.message); next();` → до `loadSources` дело не доходит там, где на экране провал.
- Staging-компонент при этом (по логам 219 active:true) формально был готов вызывать `/sources`, но пользователь видел провальный экран прод-VIP-плагина (либо открыл staging поверх провального состояния — лог не показывает `/sources` от девайса вовсе). Следов `sources/card` от девайса на staging тоже нет.

**Подтверждение, что staging-цепочка сама по себе рабочая (VM-репродукция, READ-ONLY):** VM-хозяин с served-сборкой 57559 + staging-базой + токеном:
`check → 200 219 active:true → /sources → 200 3281` (JSON с массивом источников). Staging-бэкенд исправен; обрыв — клиентский, вызванный утечкой токена в конкурирующий плагин.

---

## 4. D — Три цепочки (пошагово, что реально записано)

### D.1 РАБОЧАЯ эталонная (PROD-девайс, ДО установки staging) — 06:28–06:30
`vip-kanal плагин (maniya_online, base PROD, token mo-fb9bf939)` →
`plugin.maniya-kvn.online/api/lampa/subscription/check` → **200** (активна) →
`sources/… (mo-token)` → `sources/card` → `videos?provider=kodik` / `rezka` → **всё 200**,
плюс весь вчерашний день (22.08) `vip-kanal` (mo-token) на **STAGING**: `subscription/check→sources→videos filmix/skaz-vkmovie/rhsprem→video→proxy hls` — всё 200. **Эталон работает и там, и там.**

### D.2 СЛОМАННАЯ staging-установка (реальный девайс) — 09:05–09:13
1. WebView грузит `staging/…js` (57559) и `vip-kanal…js` (57220) — **оба в один window**.
2. Последней исполнилась staging-сборка → `window.MANIYA_ONLINE_TOKEN = staging-test-4f3a9c21…`.
3. Прод-VIP компонент: `https://plugin.maniya-kvn.online/api/lampa/subscription/check?…&token=staging-test-4f3a9c21…` → **200 170 B `{active:false,message:"Подписка Maniya Online не активна"}`** ← UI юзера.
4. Staging компонент: `http://95.85.241.121/api/lampa/subscription/check?…&token=staging-test…` → **200 219 B `{active:true}`**.
5. `/sources` — **ноль** от девайса (обрыв в (3)/до UI).
(Повторы пары: 09:05:50, 09:13:03 — юзер перезаходил, картина та же.)

### D.3 WEB Lampa
Получает 57559 при корректном origin/UA (см. A). Та же цепочка, что D.2, если на устройстве уже стоит прод-VIP-плагин; на чистом Web Lamp̶a работает (T032 suite 810/802/1/7).

---

## 5. Вторичные наблюдения (НЕ причина жалобы, но зафиксировано)

1. **Staging-бокс отдаёт сборку VIP-канала с PROD-базой:** `GET http://95.85.241.121/vip-kanal-tvv_207711693970.js` → 57220 B, при этом внутри `MANIYA_API_BASE = 'https://plugin.maniya-kvn.online/api/lampa'` (проверено live). Т.е. даже «staging»-раздача vip-плагина ходит в прод-API. Для жалобы на staging-test-плагин неактуально (у него base верный), но для полноты зеркальности — замечание.
2. Prod-сборка vip (54779 B) и staging-раздача vip (57220 B) различаются размером из-за сборки (staging inject/build), но `MANIYA_API_BASE` у обеих = PROD. Staging-раздача НЕ выворачивает base в себя.
3. nginx на staging слушает `plugin.maniya-kvn.online` на 80/443 и проксирует `:3000` (staging-нода) — совпадение имени vhost с ожидаемым, но DNS `plugin.maniya-kvn.online → 135.106.195.203` (PROD), поэтому реальные прод-запросы уходят на PROD-бокс (это и видно в D.2 шаг 3).

---

## 6. Minimal Fix Plan (после подтверждения юзера; сейчас — HARD STOP)

**Цель:** изолировать подпись токена/хранилища по компоненту, чтобы установка staging поверх прод-VIP не перетирала прод-токен и не уводила запросы одного плагина на чужой базовый хост.

| # | Изменение | Файл(ы) | Суть |
|---|---|---|---|
| M1 | **Изоляция токена по компоненту** в served-сборке | build/inject серверной сборки (там, где вшивается `window.MANIYA_ONLINE_TOKEN`) + `public/maniya-online.js` (`getTokenFromRuntime/ensureToken/persistToken`) | Staging-сборка пишет в **свой** глобал (например `window.MANIYA_ONLINE_TOKEN_STAGING`) и читает **в первую очередь свой**, а НЕ общий `window.MANIYA_ONLINE_TOKEN`. Прод-сборка — аналогично, свой. Сторонний токен в общем глобале игнорируется, если вшит/сохранён свой. |
| M2 | **Компонентные ключи Lampa.Storage** | `public/maniya-online.js` (`persistToken` :88, `ensureUid` :109, `readStoredToken`) | `maniya_token_<COMPONENT>`, `maniya_unic_id_<COMPONENT>` — установка одного плагина не трогает состояние другого. |
| M3 | **Операционный шаг на устройстве юзера** | — | Удалить старый прод-VIP-плагин из Lampa перед установкой staging (или ставить на чистую). Без M1-M2 даже после удаления общие ключи останутся; M1-M2 убирают класс, M3 — немедленный сброс. |
| M4 | **(вторично, по желанию)** Base staging-раздачи vip-канала | конфиг staging сборки (где `MANIYA_API_BASE` для vip-канала) | Возможно вшить `http://95.85.241.121/api/lampa` для vip, отдаваемого со staging. Отдельное решение — не обязательно для этой жалобы. |

**Files to change (минимум):** build-инжект сборочного плагина на stage (server + staging-public; передатчик токена) и `public/maniya-online.js` (клиентская изоляция токена/uid). **PROD, юзеры, названия источников, UI — НЕ трогаются.**

---

## 7. Статусы

- **A WEB:** ✅ PASS (stub для браузера — by-design, Web/Android Lampa получают 57559).
- **B ANDROID-AUTH:** 🔴 FAIL, FIRST ROOT CAUSE установлен (**кросс-плагинная утечка токена через общий `window.MANIYA_ONLINE_TOKEN`/`Storage`**; PROD-ответ 170 B — текст жалобы).
- **C SOURCES:** 🔴 не вызываются на staging девайсом (обрыв в клиенте на `subscriptionRequired` от PROD-ответа); staging-цепочка standalone рабочая (VM check→active→sources 200 3281).
- **FIRST DIVERGENCE:** `subscription/check` с staging-токеном на прод-хост `plugin.maniya-kvn.online` → `200 170 {active:false}` в момент 09:05:38, порождённое отсутствием изоляции токена сборки.
- **Fix plan:** M1–M3 обязательны (изоляция токена+uid-ключей, операц. сброс), M4 опционально.
- **HARD STOP:** исправления не вносились. Жду подтверждения юзера.

*Артефакты: `backup/t033-served-staging.js` (57559), `backup/t033-prod-vip.js` (54779), `backup/t033-staging-vip.js` (57220), `backup/t033-vm.mjs`, логи nginx обоих боксов.*