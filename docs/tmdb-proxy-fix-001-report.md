# TMDB-PROXY-FIX-001 — серверный TMDB relay для Maniya (без-VPN доступ Lampa к TMDB)

**Дата:** 2026-08-18 · **Режим:** IMPLEMENTATION (commit/push/deploy **НЕ делались** — STOP)
**Вход:** `docs/tmdb-access-audit-001-report.md` (требования, повторный аудит не проводился). Итоги аудита: TMDB-доступ Lampa состоит из `api.themoviedb.org/3/*` (JSON) и `image.tmdb.org/*` (постеры); ключ — только клиентский (на сервере не хранится); нужен типизированный relay, а не произвольный URL-прокси.
**Scope (изменено):** `server/src/tmdbProxy.js` (новый), `server/src/index.js` (+2 роута), `public/tmdbproxy.js` (новый), `server/test/tmdb-proxy.test.js` (новый), `server/test/api.test.js` (+4 теста). Skaz/RCH, availability.js, store.js, VKMovie/Rutube/Collaps/Kodik/Filmix/Rezka/HDVB/Alloha/VeoVeo, proxy-семантика и allowHosts **НЕ тронуты**.

---

## A. Архитектура (по §8–§10 аудита)

Два **типизированных** маршрута, у которых апстрим-хост **жёстко зашит константой** (модель — эталон Lampac `Modules/Proxy/TmdbProxy/Controller.cs`, но типизированнее: hostname-параметра нет вовсе):

| Маршрут | Апстрим (константа) | Назначение |
|---|---|---|
| `GET /api/lampa/tmdb/api/3/{path}` | `https://api.themoviedb.org/3/{path}` | TMDB JSON API (configuration/search/… ) |
| `GET /api/lampa/tmdb/img/{path}` | `https://image.tmdb.org/{path}` | Постеры/фоны (w92…w780/original) |

- Appears как `/api/lampa/tmdb/...`; query прокидывается **как есть** (`api_key`, `language`, `query`, …) — ключ клиентский, на сервере не хранится и не логируется.
- Служебные ключи Maniya/Lampa (`token`, `uid`, `account_email`, `cub_id`, `origin`, `ref`, `logged`, `reset`) **выбрасываются** перед апстримом (аналог Lampac `SkipQueryKeys`).
- Подписка — как у `/api/lampa/proxy` (`requireSubscription`), **rate-limit не применяется** (каталог постеров шлёт десятки картинок разом — аналог HLS-сегментов).
- Images **стримятся** (pipe, без буферизации), поддерживаются все реальные размеры; старый Safari-UA + `Accept: image/*` → гарантированный `image/jpeg` (эталон `Controller.cs:32-37`).
- Релей-заголовки: `content-type/content-length/content-encoding/cache-control/etag/last-modified/age/expires` + `Access-Control-Allow-Origin: *`; **hop-by-hop (`connection/keep-alive/transfer-encoding/upgrade`) никогда не пробрасываются**.
- Ошибки: статусы апстрима 200/404/401/429/503 пробрасываются как есть; timeout → **504 `tmdb_upstream_timeout`**; ошибка соединения → **502 `tmdb_upstream_error`**; битая цель → **400/403/404 (контролируемые)**. В лог попадает только `route/status/redirects/durationMs` — ни URL, ни query, ни api_key.

## B. SSRF-модель (§10–§14 аудита) — «как не создать SSRF»

1. **Хост не берётся из ввода вообще** — только из константы; любые попытки сменить authority в суффиксе (`//evil.com`, `https://evil.com`, `%2f%2f`, `@`, `..`) попадают в pathname, а не authority.
2. Специальный валидатор **`validateTmdbTarget`**: `https` **строго** + **точное равенство** хоста константе. НЕ переиспользует generic `validateProxyTarget` (у того всегда разрешён http-loopback — для E-Online; для TMDB-relay это была бы SSRF-дыра).
3. Каждый **redirect** проходит ту же проверку (`new URL(location, current)` → validateTmdbTarget); редирект на `evil.com`/`http://127.0.0.1` → 403/400 до какого-либо запроса атакованного хоста.
4. WHATWG-нормализация: dot-сегменты резолвятся в pathname; traversal, выходящий за пределы типизированного префикса, → контролируемый **404 `tmdb_route_not_found`**.
5. Loopback/private/metadata IP недостижимы (https-строгая проверка + точный хост).

## C. Клиентский плагин `public/tmdbproxy.js` (§12–§13 аудита)

Модель — Lampac `TmdbProxy/plugin.js`, но с полной защитой от конфликта с уже установленным пользовательским TMDB-прокси:

- Перехватывает **только** `Lampa.TMDB.api` и `Lampa.TMDB.image`, чтит `Lampa.Storage.field('proxy_tmdb')`;
- включено → возвращает **свой** URL напрямую (`HOST + /api/lampa/tmdb/api/3/` или `/img/` + путь), добавляя `token` (из `maniya_token`/`lampac_token`) и `account_email`;
- выключено → делегирует **сохранённому оригиналу** (нативный Lampa или пользовательский прокси);
- **guard**: `window.MANIYA_TMDB_PROXY` + метка `__maniya_tmdb` на обёртке — повторная загрузка/установка не накапливает обёртки;
- никакого перехвата `Reguest`/`fetch`/XMLHttpRequest — обычный HTTP Lampa (Skaz/Lampac/провайдеры) не затрагивается.

Совместимость (TMDB PROXY COMPATIBILITY, 5 сценариев — покрыто тестами):

| Сценарий | Результат |
|---|---|
| (1) пользовательского прокси нет | Maniya работает (proxy_tmdb on → relay-URL) |
| (2) пользовательский включён | двойной цепочки НЕТ: Maniya при on возвращает свой URL и **не вызывает** пользовательский прокси (1 хоп до Maniya) |
| (3) пользовательский отключён после старта | Maniya продолжает работать: toggle в off/on переключает делегирование/relay без поломки `Lampa.TMDB.api/image` |
| (4) Maniya перезагружается | guard → обёртка НЕ накапливается (reload в том же realm) |
| (5) порядок загрузки | цепочка обёрток ограничена (метки + guard), бесконечный wrapper-цикл невозможен |

## D. Изменённые/новые файлы

- **`server/src/tmdbProxy.js`** (new, ~200 строк) — константы маршрутов/хостов, `isTmdbApiPath/isTmdbImgPath`, `validateTmdbTarget`, `buildTmdbUpstream`, `requestOnce`, `relayHeaders`, `tmdbRelay` (loop redirects + pipe; инжектируемый транспорт для тестов).
- **`server/src/index.js`** — import из tmdbProxy.js; два роута после `/api/lampa/proxy`, до `assertRateLimit` (комментарии с обоснованием).
- **`public/tmdbproxy.js`** (new, ~100 строк) — клиентская подмена api/image с guard/marker и переключателем `proxy_tmdb`.
- **`server/test/tmdb-proxy.test.js`** (new, 16 тестов) — SSRF-гейт/маппинг/query/traversal/инъекция, relay (passthrough, hop-by-hop, redirects в обе стороны, статусы, timeout/connection), плагин (5 сценариев + перехват только api/image).
- **`server/test/api.test.js`** (+4 теста) — 403 без подписки (api+img, включая `//evil.com` variant), `/tmdbproxy.js` → JS для Lampa-UA / stub для браузера.
- config.js / security.js / http.js / store.js / proxy.js / providers — **без изменений**.

## E. Регрессионные тесты §20 (минимально 10 — выполнено 20)

Coverage: https-only + точный хост (SSRF) · маппинг api/3 и img · query passthrough + strip служебных · traversal/`..`/`%2e%2e` (escape → контролируемый 404) · hostname-инъекция `//evil.com`/кодировки · relay 200 passthrough (статус/content-type/cache/ACAO/тело) · hop-by-hop не relay-ятся · redirect same-host ок · redirect evil.com/loopback → 403/400 и без запроса атакованного хоста · статусы 404/429/503 пробрасываются · timeout→504 / error→502 · плагин (прямой relay при on + делегирование нативному при off) · no double-chain с пользовательским прокси · guard при reload · перехват только api/image · API 403 без токена (api+img) · плагин отдаётся по Lampa-гейту.

## F. Live-проверка (temp/shadow, НЕ прод)

Локальная сеть девелоп-машины режет TMDB напрямую (`HTTP 000` на оба хоста — ровно сценарий «клиент без VPN»), поэтому live-прогон выполнен на **shadow-сервере**: staged-копия кода в `/tmp/shadow-tmdb` на VPS (НЕ `/opt/maniya-online`, НЕ деплой), синтетический фикстур-токен `tmdb-shadow-20260818`, порт `127.0.0.1:3871` (loopback), доступ через `ssh -L`-туннель. Ничего публично не выставлялось. Контрольные точки (через туннель):

| Проба | Результат |
|---|---|
| `GET /api/lampa/tmdb/api/3/configuration?token=…` | **401** — реальный ответ TMDB (`status_code:7 Invalid API key`) проброшен как есть: доказана end-to-end достижимость api.themoviedb.org через relay + честный пасстхру (клиент со своим api_key получит 200) |
| `GET /api/lampa/tmdb/api/3/search/movie?language=ru&query=Interstellar&token=…` | **401** (query language/query дошли до апстрима) |
| `GET /api/lampa/tmdb/img/t/p/w92/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg?token=…` | **200 image/jpeg, 5146 B — побайтно идентично прямому запросу с VPS (5146 B)** |
| `GET /api/lampa/tmdb/img/t/p/original/…?token=…` | **200 image/jpeg, 938879 B — побайтно идентично прямому (938879 B)**; 0.94 MB за 1.07s (стрим, без буферизации) |
| Плагин-харнесс (vm) + живой URL через туннель | `tmdbproxy.js` переписывает api→ `/api/lampa/tmdb/api/3/…`, image→ `/api/lampa/tmdb/img/…` (+token/+account_email); оба URL **живо отвечают** (img 200, api 401-пасстхру) |

**Вердикт live:** relay == прямому TMDB по байтам и статусам на всех размерах (w92 → original), api-путь отдаёт реальные ответы апстрима; плагин строит рабочие URL.

## G. SSRF manual probes §25 (10 проб, через туннель)

| Запрос (все с валидным токеном, кроме подписки-гейта) | Результат | Куда реально дошло |
|---|---|---|
| `/api/lampa/tmdb/api/3/https://evil.com` | 401 | фикс. хост api.themoviedb.org (TMDB auth-check) |
| `/api/lampa/tmdb/api/3/%2f%2fevil.com` | 401 | фикс. хост api.themoviedb.org |
| `/api/lampa/tmdb/api/3/..%2fevil` | 404 | фикс. хост api.themoviedb.org |
| `/api/lampa/tmdb/img/t/p/../../../etc/passwd` | 404 | **Maniya** (`tmdb_route_not_found`) — /etc/passwd не отдан |
| `/api/lampa/tmdb/api/3/%2e%2e/evil` | 404 | **Maniya** |
| `/api/lampa/tmdb/api/3/@attacker.com/x` | 401 | фикс. хост api.themoviedb.org |
| `/api/lampa/tmdb/api/3//%2fevil.com` | 401 | фикс. хост api.themoviedb.org |
| `/api/lampa/tmdb/api/3/evil.com.evil.com/x` | 401 | фикс. хост api.themoviedb.org |
| `/api/lampa/tmdb/api/3/configuration` (без токена) | 403 | **Maniya** (subscription_required) |
| `/api/lampa/tmdb/img/t/p/w92/x.jpg` (без токена) | 403 | **Maniya** |

Ни один зондирующий запрос не был направлен на атакующий/внутренний хост: всё висит на фиксированном TMDB-хосте или контролируемом Maniya 403/404.

## H. Полная регрессия (§24)

`cd server && NODE_ENV=test node --test` → **731 tests / 725 pass / 0 fail / 6 skipped** (база 711/705; все новые 20 — зелёные; skaz/vkmovie/rutube/collaps/kodik/proxy-структура и пр. — без изменений).

## I. Уборка scratch/shadow

- Shadow на VPS остановлен по pid, `/tmp/shadow-tmdb` удалён, порт 3871 свободен.
- Локальные temp/probe-файлы удалены; `.env`/токены/секреты не читались и не менялись.

## J. Ограничения / НЕ в scope

- Live api-путь показал 401 (не 200), т.к. на сервере **преднамеренно нет** TMDB-ключа (требование §5 аудита) — клиент Lampa шлёт свой api_key, сервер его проксирует; при реальном ключе будет 200 (для img — уже доказано 200).
- `HEAD` не реализован (не нужен; только GET, § задании).
- Кэш свой не добавлялся — только пасстхру cache-заголовков апстрима.
- Совместимость с пользовательским прокси доказана на уровне vm-тестов (реальная двойная установка в Lampa — при монтаже плагина на устройстве).

## K. Итог

| Метрика | Значение |
|---|---|
| Новый код | `server/src/tmdbProxy.js`, `public/tmdbproxy.js` |
| Точки интеграции | `server/src/index.js` (+2 роута), тесты ✚20 |
| Suite | 731/725 pass / 0 fail / 6 skip |
| API live | конфиг/search — реальные ответы TMDB проброшены (401 без ключа by design); **img w92/original — 200, байт-в-байт = direct** |
| No-VPN | ✓ — клиент без VPN получил реальные TMDB-данные через Maniya (img 200; api — как только клиент приложит свой ключ) |
| SSRF | PASS — 10/10 проб контролируемые; атакующий хост не запрашивается ни разу (в т.ч. redirects) |
| Commit/Push/Deploy | **НЕ выполнялись** |

**TMDB-PROXY-FIX-001 — реализация завершена и проверена (unit + live-shadow + SSRF); готова к ревью; commit/push/deploy — НЕ выполнены.**