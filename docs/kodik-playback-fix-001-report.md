# KODIK-PLAYBACK-FIX-001 — implementation + production verification

**Дата:** 2026-08-16 (коммит 17:32 MSK; прод-verify 18:55–19:30 MSK ≈ 15:55–16:30 UTC)
**Тип:** IMPLEMENTATION (config + tests) + PRODUCTION VERIFICATION (live).
**Статус:** ЗАВЕРШЁН — **READY FOR RELEASE** (коммит + push в `backup` + deploy сделаны до этой сессии;
прод-verification зафиксирован здесь).
**Связанные:** [[kodik-playback-audit-001]] (root cause), [[native-kodik-fn-audit-001]], [[canonical-eonline-skaz-flow-audit]],
[[maniya-gap012-veoveo]] (тот же паттерн allowlist-фикса).

---

## §0 Краткий вердикт

**Round 1 (до этой сессии):** в `config.proxy.allowHosts` добавлен **один корневой суффикс
`solodcdn.com`** — коммит **`37b742d`** `fix(kodik): allow SolodCDN media playback`
(config.js + .env.example + 3 теста в proxy.test.js), запушен в **`backup/gap-012-veoveo`**,
**развёрнут** на VPS (systemd active, health 200, NRestarts=0, config на проде содержит ровно один
`solodcdn.com`, `PROXY_ALLOW_HOSTS` в server/.env не переопределён — действует дефолт).

**Round 2 (эта сессия, production verification):**
- **6/6 playable Kodik-тайтлов PASS** через Maniya-прокси: master **200** `application/vnd.apple.mpegurl`,
  segment **200** `video/MP2T`, Range **206** Partial Content.
- **`proxy_host_forbidden` больше НЕ возникает ни на одном медиа-запросе** (0/6, journal чистит —
  0 записей `proxy_host_forbidden` за 30 мин).
- Оба CDN-корня (`sky`, `cloud`) и **все динамические serving-ноды** покрыты одним суффиксом
  `solodcdn.com`; в этой сессии зафиксированы serving-ноды **rubidium, loki, paradox, petra, ranger,
  iridium** (304+ новых относительно аудита: **paradox.cloud**, **petra.sky**, **ranger.sky** — живое
  доказательство, что перечисление нод по одной невозможно).
- Регрессия: filmix/veoveo/alloha/rezka **playback PASS**; kinopub items 25(FG)/10(HoTD) (upstream жив),
  videoseed 0 на FG (upstream-флап, вне зоны фикса).
- Полный суит: **614 total / 608 pass / 0 fail / 6 skip** (611 baseline + 3 новых теста фикса, 0 фейлов).

---

## A. Root cause

Доказан аудитом `docs/kodik-playback-audit-001-report.md` (§0, §3): все playable-элементы Kodik
(через twin `skaz-kodik`/native `kodik`) резолвятся в прямые CDN-ссылки
**`sky.solodcdn.com` / `cloud.solodcdn.com`** (+ динамические serving-ноды при 302), а эти хосты
**отсутствовали в `config.proxy.allowHosts`** (был только API-хост `kodikres.com`).
`/api/lampa/proxy` → `validateProxyTarget()` → `isHostAllowed()` = false →
**`403 proxy_host_forbidden` (proxy.js:38)** на КАЖДОМ медиа-запросе (манифест, затем сегменты).

CDN при этом здоров (master 200 mpegurl, segment 200 MP2T, Range 206) — конфликт только в allowlist'е.
Паттерн уже решался для veoveo (GAP-012: `mvapspdmpg.com`) — для Kodik тогда не делался.

---

## B. Точные изменённые файлы

| Файл | Изменение | Коммит |
|---|---|---|
| `server/src/config.js` | `proxy.allowHosts` += `'solodcdn.com'` (1 элемент) | `37b742d` |
| `server/.env.example` | документация `PROXY_ALLOW_HOSTS` — упомянут `solodcdn.com` | `37b742d` |
| `server/test/proxy.test.js` | +3 теста (suffix-match, validateProxyTarget, SSRF-loopback) | `37b742d` |

Была ли правка necessity: НЕТ — security-логики не касались; suffix-match уже был безопасным.

---

## C. Config before / after

**before** (config.js §proxy.allowHosts — 21 запись):
`filmix.my, filmix.gg, filmix.tv, filmix.pub, filmix.fm, filmix.ac, werkecdn.me, cdnsqu.com,
kodikres.com, stloadi.live, rutube.ru, rtbcdn.ru, vkuser.net, okcdn.ru, interkh.com,
sevstar933krop.com, entouaedon.com, vkvideo.cloud, cdntogo.net, rstprgapipt.com, mvapspdmpg.com`

**after** (22 записи): `…, kodikres.com, **solodcdn.com**, stloadi.live, …`

`httpAllowHosts` не менялся. Pоверка на проде: `server/src/config.js` содержит `solodcdn.com` ровно
1 раз; `PROXY_ALLOW_HOSTS` в `server/.env` **не задан** → применяется дефолт config.js → фикс активен.
Задвоения нет: merge-блок Rezka (config.js:250-258) добавляет только rezka-хосты.

**Модель матчинга (доказана по коду, proxy.js:18-26):**
`clean === root || clean.endsWith('.' + root)` — суффиксный сопоставитель. `solodcdn.com` покрывает
корень и любой поддомен сколь угодно глубоко: `sky/cloud.solodcdn.com`, `*.sky/cloud.solodcdn.com`.

---

## D. SSRF security checks (3 новых теста, proxy.test.js + сущ. механика)

**Разрешаются (тесты + live):**
- `solodcdn.com`, `sky.solodcdn.com`, `cloud.solodcdn.com`
- `loki.sky.solodcdn.com`, `hydrus.sky.solodcdn.com`, `rubidium.sky.solodcdn.com`, `anteros.sky.solodcdn.com`
- `falcon.cloud.solodcdn.com`, `iridium.cloud.solodcdn.com`, `prism.cloud.solodcdn.com`,
  `orange.cloud.solodcdn.com`, `pegasus.cloud.solodcdn.com`, `noise.cloud.solodcdn.com`

**Не разрешаются (тесты):**
- `solodcdn.com.attacker.com`, `evil-solodcdn.com`, `solodcdn.com.evil`,
  `attacker.solodcdn.example.com`, `notsolodcdn.com`, `solodcdn.com.evil.com`

**Продолжают блокироваться (тесты, без изменения SSRF-механики):**
- `https://127.0.0.1/…`, `https://localhost/…`, `https://10.0.0.1/…`, `https://172.16.0.1/…`,
  `https://192.168.1.1/…`, `https://169.254.169.254/latest/meta-data`, `https://[::1]/…`

**Redirect:** `proxyMedia` re-валидирует каждый hop через `validateProxyTarget` (proxy.js:203).
Live-direct цепи (§F) подтверждают: все serving-ноды — поддомены `solodcdn.com`, т.е. каждый hop
при проксировании легален. Механика не менялась.

**Замечание:** `solodcdn.com` — публичный медиа-CDN с name-based DNS, entry не открывает private/loopback
(тесты выше); остаточный риск — bandwidth-relay через валидный токен, как у всех CDN-entry (явно
задокументировано в аудите §7).

---

## E. Kodik CDN matrix (this session)

| Корень | Пути | Serving-ноды (302), зафиксированы 2026-08-16 | Паттерн URL |
|---|---|---|---|
| `sky.solodcdn.com` | `/movies/`, `/animes/` | `loki`, `hydrus`, `rubidium`, `anteros`, **`petra`**, **`ranger`** | `/…/<md5>:YYYYMMDDHH/720.mp4:hls:manifest.m3u8` |
| `cloud.solodcdn.com` | `/useruploads/` | `falcon`, `iridium`, `prism`, `orange`, `pegasus`, `noise`, **`paradox`** | `/…/<md5>:YYYYMMDDHH/720.mp4:hls:manifest.m3u8` |

Жирным — ноды, впервые зафиксированные в этой сессии (парадох/petra/ranger). Псевдо-HLS от одиночного
MP4: нет отдельного variant-уровня — мастер эквивалентен variant (как в аудите §6.2).

---

## F. Playable titles (6 ≥ 5) — live prod chain

Titles все проверены 15:55–16:30 UTC. Каждый: videos → playable → Maniya proxy → CDN (включая redirect).

| # | Тайтл | provider(id) | Initial host | Serving (302) | Master | Segment | Range | Result |
|---|---|---|---|---|---|---|---|---|
| 1 | **Паразиты 2019 (ko)** | kodik→skaz-kodik | sky.solodcdn.com | rubidium.sky | 200 mpegurl 449KB | 200 MP2T | 206 (0-1023/1799160) | **PASS** |
| 2 | Унесённые призраками 2001 (ja) | kodik→skaz-kodik | sky.solodcdn.com | loki.sky | 200 mpegurl 419KB | 200 MP2T | 206 (0-1023/1609656) | **PASS** |
| 3 | Мой сосед Тоторо 1988 (ja) | kodik→skaz-kodik | cloud.solodcdn.com | **paradox**.cloud | 200 mpegurl 296KB | 200 MP2T | 206 (0-1023/286136) | **PASS** |
| 4 | Олдбой 2003 (ko) — voice=2 «Сербин» | kodik→skaz-kodik | sky.solodcdn.com | **petra**.sky | 200 mpegurl 405KB | 200 MP2T | 206 (0-1023/2247352) | **PASS** |
| 5 | Поезд в Пусан 2016 (ko) | kodik→skaz-kodik | sky.solodcdn.com | **ranger**.sky | 200 mpegurl 399KB | 200 MP2T | 206 (0-1023/1672824) | **PASS** |
| 6 | Игра в кальмара 2021 (ko, serial) | kodik→skaz-kodik | cloud.solodcdn.com | iridium.cloud | 200 mpegurl 205KB | 200 MP2T | 206 (0-1023/304184) | **PASS** |

Примечание по Олдбою: голоса 0–1 («Дублированный», «Проф. Двухголосый») — **404 прямо от CDN**
(мёртвый слот ссылки; `proxy` прозрачно транслирует upstream-404, это НЕ allowlist и не прокси-баг);
голос 2 и далее — живое CDN 302→200 → полный PASS. Это подтверждает: разный голос = разный CDN-URL,
одна и та же безопасная модель (суффикс).

**Главный критерий:** `proxy_host_forbidden` у 6/6 тайтлов (все master/segment/range-запросы) **не возникает**.

---

## G. master / variant / segment / Range (детали)

- **master:** `200` `application/vnd.apple.mpegurl`, через `/api/lampa/proxy` (Maniya следует
  `302 sky→serving` сам, манифест переписывается `rewriteHlsManifest`→сегменты превращаются в
  прокси-ссылки).
- **variant:** для Kodik-псевдо-HLS отдельного variant-уровня нет (один рендер-группа 720, как в
  аудите §6.2) — «variant» эквивалентен master.
- **segment:** `200` `video/MP2T` (TS-сегмент из переписанного манифеста через прокси), Content-Length
  286KB–2.2MB.
- **Range:** `206 Partial Content`, `Content-Range: bytes 0-1023/N` — через прокси (Range пробрасывается
  proxy.js:187-193 на каждый hop).

---

## H. Regression matrix (live prod, 16:00–16:30 UTC)

| Источник | /sources | /videos | Playback через proxy | Результат |
|---|---|---|---|---|
| filmix | 200 (в списке) | items>0 | **200** `video/mp4` (ru-sant-p.werkecdn.me) | PASS |
| veoveo | 200 | items>0 | **200** `application/vnd.apple.mpegurl` (api.rstprgapipt.com) | PASS |
| alloha | 200 | items>0 | **200** mpegurl (ce-10-3e-r404.vkvideo.cloud) | PASS |
| rezka | 200 | items>0 | **200** mpegurl (stream.voidboost.one) | PASS |
| kinopub | 200 | items=25 (FG) / 10 (HoTD) / 0 (Последний дом = GAP 003 pre-existing) | upstream жив | OK (flap не у фикса) |
| videoseed | 200 | 0 на FG (несколько попыток) | — | upstream-флап (НЕ регрессия; кластерная доступность, allowlist не влияет) |

`/sources/card`: 200 для всех проверенных карточек; `show` для kodik = true на всех 6 Kodik-тайтлах
(это меняется только кластерной availability, не фиксом). Изменение касается **только playback-гейта
на входе** — availability-семантика, W1, GAP-002/005, STABILITY-004, provider identity, display names
не тронуты (см. K).

---

## I. Full test suite

```
NODE_ENV=test node --test   (server/)
tests 614 | pass 608 | fail 0 | skipped 6
```
Baseline 611/605/0/6 → +3 новых теста KODIK-PLAYBACK-FIX-001 (proxy.test.js). **Ноль фейлов/регрессий.**

---

## J. Production verification

**Статус (VPS 95.85.241.121, `/opt/maniya-online`):**
- config на проде: `grep -c solodcdn.com server/src/config.js` = **1**; `PROXY_ALLOW_HOSTS` в `.env`
  не задан → дефолт config.js активен.
- systemd: `active` (running), **NRestarts = 0**.
- `https://plugin.maniya-kvn.online/health` → **200**.
- journal (30 мин окно пробы): `proxy_host_forbidden` = **0**, unhandledRejection/request_failed = **0**.
- nginx: 4 × 5xx из ~2000 последних запросов (0.2%): 502 videoseed (наш upstream-проб), 502
  subscription/check, 504 plugin-скрипт, 500 filmix-proxy mp4 (не solodcdn; pre-existing pattern) —
  **ни одного 5xx на затронутом коде; 0 связаны с solodcdn**.

**Ключевое прод-доказательство (§F):** 6 тайтлов — master 200 / segment 200 / Range 206, `403` не
наблюдался ни разу. Upstream (кластер) и CDN здоровы; allowlist пропускает.

---

## K. Что НЕ менялось

- `proxy.js` (логика validateProxyTarget/isHostAllowed/redirect/rewrite/Range) — **не менялась**.
- SSRF-механика, Loopback-список, `httpAllowHosts` — **не менялись**.
- `availability.js`, `SkazClient/SkazProvider`, `KodikClient/KodikProvider`, `registry/meta/store` —
  **не менялись**.
- source ID (`kodik`/`skaz-kodik`), display names, balancer-список — **не менялись**.
- Collaps, E-Online runtime, BALANCER-SEMANTICS-005/W1, GAP-002, GAP-005, VEO-015, STABILITY-004 —
  **не менялись** (identity ≠ presentation; KP conclusions из аудитов остаются в силе).
- Один корень `solodcdn.com` вместо перечисления serving-нод (ротируются/недетерминированы —
  доказано в этой сессии: paradox/petra/ranger новые).

---

## § Сводка gates

| Gate | Требование | Статус |
|---|---|---|
| Config check | существующий suffix-match безопасен (по коду) | ✅ proxy.js:24 `clean === root \|\| clean.endsWith('.'+root)` |
| Minimal change | только `solodcdn.com`, без wildcard | ✅ |
| SSRF | разрешаются/отклоняются/блокируются (табл. §D) | ✅ 3 теста |
| Redirect | каждый hop re-валидируется | ✅ proxy.js:203 + live 302→200 |
| Kodik playback | ≥5 тайтлов, оба CDN, serving-ноды | ✅ 6/6 (sky+cloud, 9 unique serving-нод за 2 сессии) |
| Provider identity | не менять | ✅ |
| Regression | filmix/alloha/veoveo/rezka/kinopub/videoseed | ✅ 4 playback PASS; kinopub items>0; videoseed=upstream |
| Full tests | 611-базовый, 0 новых фейлов | ✅ 614/608/0/6 |
| Git hygiene | git status / diff --check; только файлы фикса | ✅ 3 файла в `37b742d`; pre-existing не коммитились |
| Commit/Push | `fix(kodik): allow SolodCDN media playback`; push только в `backup` | ✅ `37b742d` → `backup/gap-012-veoveo`; origin `a4a2147` не тронут |
| Deploy | systemd/health/NRestarts/journal/nginx | ✅ active/200/0/0 чисто/0.2% 5xx без связи с фиксом |
| Prod verify | главный критерий — **403 больше НЕ возникает** | ✅ 0/6, journal 0 |

**Вердикт: READY FOR RELEASE.** Задача завершена. Следующие задачи (W2, GAP-013, COLLAPS-SHAPE,
COLLAPS-ID-ROUTE и др.) НЕ начинались.

---

## § Репроды / артефакты

- `scripts/kodik-playback-fix-001-verify.mjs` (untracked, verify-only) + JSON-репорт в
  `%TEMP%\kodik-playback-fix-001-verify.json`.
- Live-ссылки не публиковались целиком (секреты/токены не раскрыты; полные CDN URLs с md5-слотами
  видны только в локальном JSON).