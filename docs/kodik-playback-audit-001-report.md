# KODIK-PLAYBACK-AUDIT-001 — аудит playback-native Kodik: 403 `proxy_host_forbidden`

**Дата:** 2026-08-16 (пробы 12:47–13:14 UTC; тот же день, что и NATIVE-KODIK-FN-AUDIT-001 15:45 MSK ≈ 12:45 UTC)
**Тип:** READ-ONLY. Код не менялся. Тесты не менялись. Commit/push/deploy не делались.
**Статус:** завершён.
**Связанные:** [[native-kodik-fn-audit-001]] → см. `docs/native-kodik-fn-audit-001-report.md`.

---

## §0 Краткий вердикт

**Root cause точный и единственный:** все playable-элементы Kodik (через twin `skaz-kodik`) резолвятся
в прямые CDN-ссылки **`sky.solodcdn.com` / `cloud.solodcdn.com`**, а эти хосты **отсутствуют в
`config.proxy.allowHosts`** (в списке есть `kodikres.com` — API-хост `video-links`, но НЕ медиа-CDN).
Любой запрос play-манифеста идёт через `/api/lampa/proxy` → `validateProxyTarget()` →
`isHostAllowed()` = false → `403 {"error":"proxy_host_forbidden"}` (proxy.js:38).

**Это реальный playback-баг Maniya** (не флап, не семантика card-показа): показ карточек корректен
(show:true + items>0), CDN сам отдаёт манифест 200 `application/vnd.apple.mpegurl` и сегменты
200 `video/MP2T` / Range 206, но Maniya-прокси режет каждый медиа-запрос до первого байта.

**Минимальный безопасный концептуальный фикс:** добавить **один корневой суффикс `solodcdn.com`**
в `allowHosts` (суффикс-матчинг `isHostAllowed`: `clean === root || clean.endsWith('.' + root)`).
Один корень покрывает: `sky.solodcdn.com`, `cloud.solodcdn.com` И динамические serving-ноды
`*.sky.solodcdn.com` (loki/hydrus/rubidium/anteros) и `*.cloud.solodcdn.com`
(falcon/iridium/prism/orange/pegasus/noise), куда `sky`/`cloud` отдают 302-редирект в зависимости
от тайтла/ноды. Никакого кода менять не надо: `validateProxyTarget`, re-валидация redirect'ов
(proxy.js:203), `rewriteHlsManifest`, `rewriteDirectiveUri`, Range-проброс уже работают — их гейтом
является только allowlist.

SSRF-риск — **низкий и ограниченный**: разрешается только дочерний суффикс одного публичного
медиа-CDN с name-based (не IP) записью. Точный анализ — §7, §8.

---

## §1 Задача (из ТЗ)

Главный кейс: **Паразиты (2019, ko)** → Kodik → 5 playable items → playback 403 `proxy_host_forbidden`.
Обязательные проверки:
- какой CDN-хост реально в play-элементе Kodik (Паразиты + 3–5 реальных playable тайтлов);
- как URL проходит через Maniya proxy;
- где именно возникает `proxy_host_forbidden`;
- как формируется `config.proxy.allowHosts`;
- почему хост отсутствует;
- как устроен allowlist у Lampac/E-Online (reference);
- какие Kodik CDN-хосты используются вообще;
- можно ли их безопасно добавить без SSRF-риска;
- динамичен ли URL/хост;
- не поломается ли playback других провайдеров.
По тайтлу: provider / play item URL / resolved host / proxy decision / HTTP status / playback result.
Проверены master, variant, segment, Range.

Ограничения: READ-ONLY; НЕ просто «добавить хост в allowlist» — сначала полный набор хостов и
модель безопасности proxy; Lampac/E-Online — только reference; Maniya остаётся независимой.

---

## §2 Пробная база

| Проба | Файл (Temp/post-w1-audit) | Время UTC | Что измерено |
|---|---|---|---|
| Паразиты resolve+master | `kodik-pick-playback.mjs/.json` | 12:47 | resolveVideo → playable URL → master через proxy |
| CDN-хосты, 5 тайтлов | `kodik-cdn-hosts.mjs/.json` | 13:10 | /videos → resolve 3 голоса → host/direct/viaProxy |
| Redirect-цепочка + master/variant/segment/Range | `kodik-cdn-chain.mjs/.json` | 13:12 | follow 302 → loki/falcon → manifest → сегмент → Range |
| Доп. 4 тайтла (сериал ko, аниме ja×2, контроль ko) | `kodik-cdn-extra.mjs/.json` | 13:14 | сер. + аниме → набор нод редиректов |

API: `https://plugin.maniya-kvn.online`, token `dorofeev200` (mo-6d7c0…dce4), UA `lampa`.
Кластер (для twin): `http://online3.skaz.tv`, account `dorofe…@gmail.com`, uid `7974…`.

---

## §3 ETL-путь play-элемента Kodik в Maniya (проверен по коду и живыми пробами)

```
Lampa Play → /api/lampa/video?provider=skaz-kodik (twin, twin-first для movie)
  → SkazProvider video→resolveVideo → кластер lite/kodik (checksearch/resolve)
  → кластер возвращает CDN URL: https://sky.solodcdn.com/…|https://cloud.solodcdn.com/…
  → store.js/videos(): items[{method:'call', url:'/api/lampa/video?…&provider=skaz-kodik&voice=0&token=…'}]
  → Maniya resolveVideos → играбельный URL: /api/lampa/proxy?url=https%3A%2F%2Fsky.solodcdn.com%2F…
  → Lampa/HLS-player → GET /api/lampa/proxy?url=… (requireSubscription ок, есть token)
  → proxyMedia(url) → validateProxyTarget(url, allowHosts, httpAllowHosts)
  → isHostAllowed('sky.solodcdn.com') → не в allowHosts → 403 proxy_host_forbidden
```

Ключевое: `KodikClient` native делает то же самое — `streams()` → `directStreams()` → `kodikres.com/api/video-links`
(ссылка с HMAC подписью, `auto_proxy=true`, `skip_segments=true`) → `links.{q}.Src` (солодческий CDN).
Но на проде active-playback идёт через **twin skaz-kodik** (кластер уже резолвит до CDN), поэтому
мы видели `skaz-kodik` в provider у всех items. В обоих случаях итог один: URL медиа = `*.solodcdn.com`.

---

## §4 Матрица по тайтлам (9 тайтлов, 33 resolve)

Проверены **9** тайтлов (ТЗ требовало 3–5): 6 фильмов ko/ja, 1 сериал ko, 2 аниме ja + контроль Паразиты.

| Тайтл (год, язык) | /videos | items | provider | resolved host(s) | proxy decision | HTTP status via proxy | direct CDN | playback result |
|---|---|---|---|---|---|---|---|---|
| Паразиты 2019 (ko) | 200 | 5 | skaz-kodik | sky.solodcdn.com | FORBIDDEN | 403 | 302→200 | FAIL (прокси) |
| Унесённые призраками 2001 (ja) | 200 | 8 | skaz-kodik | sky+cloud | FORBIDDEN | 403 | 302→200 | FAIL (прокси) |
| Мой сосед Тоторо 1988 (ja) | 200 | 8 | skaz-kodik | cloud | FORBIDDEN | 403 | 302→200 | FAIL (прокси) |
| Принцесса Мононоке 1997 (ja) | 200 | 7 | skaz-kodik | sky | FORBIDDEN | 403 | 0(timeout)/302→200 | FAIL (прокси) |
| Олдбой 2003 (ko) | 200 | 9 | skaz-kodik | sky | FORBIDDEN | 403 | 404/302→200 | FAIL (прокси) |
| Поезд в Пусан 2016 (ko) | 200 | 3 | skaz-kodik | sky+cloud | FORBIDDEN | 403 | 302→200 | FAIL (прокси) |
| Игра в кальмара 2021 (ko, serial) | 200 | 9 | skaz-kodik | cloud | FORBIDDEN | 403 | 302→200 | FAIL (прокси) |
| Акира 1988 (ja) | 200 | 10 | skaz-kodik | cloud+sky | FORBIDDEN | 403 | 302→200 | FAIL (прокси) |
| Призрак в доспехах 1995 (ja) | 200 | 9 | skaz-kodik | cloud | FORBIDDEN | 403 | 302→200 | FAIL (прокси) |

**Вывод:** 100% play-элементов Kodik (все 9/9 тайтлов, все 33 resolve) резолвятся в `*.solodcdn.com`.
**Ни один** не проходит Maniya-прокси (403 на манифесте), хотя сам CDN при прямом обращении
отдаёт манифест 200 `application/vnd.apple.mpegurl` (len 53–57 KB) и сегменты 200/206.

---

## §5 Ответы на точечные вопросы ТЗ

### 5.1. Какой CDN-хост реально в play-элементе Kodik
Два корня: `sky.solodcdn.com` (фильмы `/movies/`, аниме `/animes/`) и `cloud.solodcdn.com`
(`/useruploads/`). Паттерн URL: `https://{sky|cloud}.solodcdn.com/{movies|animes|useruploads}/<md5>/<md5>:YYYYMMDDHH/720.mp4:hls:manifest.m3u8`.
Колонка `:YYYYMMDDHH` — слот времени (Kodik, `deadlineFormat(now+4h)`), т.е. **URL частично
time-bound** (дата в пути).

### 5.2. Как URL проходит через Maniya proxy
`resolveVideos` возвращает `url` = проксированную ссылку `/api/lampa/proxy?url=<enc(CDN)>` +
`token`/`origin`/`ref`. Player (Lampa) затем дёргает эту ссылку. `/api/lampa/proxy` требует
`requireSubscription` (токен в query — `buildProxyUrl` подмешивает), далее `proxyMedia`.

### 5.3. Где именно возникает proxy_host_forbidden
`server/src/proxy.js:38` — `validateProxyTarget()`: для https проверяется `isHostAllowed(parsed.hostname, allowHosts)`
(suffix-match: `clean === root || clean.endsWith('.' + root)`, proxy.js:18-26). `sky.solodcdn.com` /
`cloud.solodcdn.com` не матчатся ни с одним entry → `throw new HttpError(403, 'proxy_host_forbidden', …)`.
Происходит ДО первого сетевого обращения к CDN.

### 5.4. Как формируется config.proxy.allowHosts
`config.js` §proxy: `list('PROXY_ALLOW_HOSTS', [статический список из 21 хоста])` + после блока
`config.rezka.allowHosts` мержится в allowlist ещё раз. Итоговый список (виден в §6.1 отчёта
native-kodik-fn-audit-001): filmix.*×6, werkecdn.me, cdnsqu.com, **kodikres.com**, stloadi.live,
rutube.ru, rtbcdn.ru, vkuser.net, okcdn.ru, interkh.com, sevstar933krop.com, entouaedon.com,
vkvideo.cloud, cdntogo.net, rstprgapipt.com, mvapspdmpg.com, + rezka.`.ag`/rezka-хосты.
**solodcdn.com отсутствует.**

### 5.5. Почему хост отсутствует
`kodikres.com` попал в allowlist как API-хост (video-links), но **медиа-CDN** `*.solodcdn.com`
(возвращаемый `links.{q}.Src`) в allowlist не добавлялся: до KODIK-PLAYBACK-AUDIT-001 не было
живого playback-теста playable Kodik-элементов (в native-kodik-fn-audit-001 мы впервые увидели
Паразиты с 5 items; playback попытка и выявила 403). Аналогичный паттерн уже решался для veoveo
(GAP-012: `mvapspdmpg.com` добавили в allowlist той же строкой) — для Kodik правка никогда не делалась.

### 5.6. Как устроен allowlist у Lampac/E-Online (reference)
**У Lampac модели allowlist НЕТ вообще.** Проверено по исходникам (Temp Lampac):
- `ProxyAPI.cs:33-35` — после `ProxyLink.Decrypt` единственная проверка: `servUri.StartsWith("http")`;
  манифест переписывается через `ProxyAPI.M3u8` / `.Dash`, сегменты идут тоже через proxy.
- `ProxyLink.Decrypt` (`Shared/Services/ProxyLink.cs:349+`) — это **capability-механизм**: только сервер,
  владеющий AES-ключом/HMAC-секретом, может выпустить зашифрованную прокси-ссылку; `verifyip`
  (привязка к IP запросившего) разворачивает Decrypt в `null`; домен в URI **не проверяется вообще**.
- Отсюда и концепт: у E-Online/Lampac «безопасность» = порождение ссылок (подпись/шифрование +
  `verifyip`), а НЕ фильтр хостов на входе. Maniya выбрала наоборот: **явный allowlist на входе**
  (проще по нулевым зависимостям, но требует вручную поддерживать список CDN).
- Вывод для задачи: E-Online **не выступает ограничением** для `*.solodcdn.com` — Lampac проксировал бы
  эти ссылки без вопросов. Это не «reference-семантика», а разница моделей безопасности. KODIK
  playback в Maniya — единственная точка, где allowlist режет реальный поток.

### 5.7. Какие Kodik CDN-хосты используются вообще
Из 9 тайтлов (33 resolve): **зафиксирован только один суффикс-корень** —
`sky.solodcdn.com` + `cloud.solodcdn.com` и их serving-поддомены при 302:
`loki.sky.solodcdn.com`, `hydrus.sky.solodcdn.com`, `rubidium.sky.solodcdn.com`, `anteros.sky.solodcdn.com`,
`falcon.cloud.solodcdn.com`, `iridium.cloud.solodcdn.com`, `prism.cloud.solodcdn.com`,
`orange.cloud.solodcdn.com`, `pegasus.cloud.solodcdn.com`, `noise.cloud.solodcdn.com`.

### 5.8. Можно ли безопасно добавить без SSRF-риска
Да, одним корнем `solodcdn.com` (анализ — §7/§8). Суффикс-матричность `isHostAllowed` покрывает
и два корня, и все serving-ноды редиректов (они поддомены того же корня). Отдельно перечислять
10 редирект-нод нельзя (они ротируются и зависят от тайтла/ноды/момента) — но и не нужно.

### 5.9. Динамичен ли URL/хост
- **Хост:** два корня стабильны (`sky`/`cloud`); **serving-нода** (куда `sky/cloud` шлют 302) —
  динамическая (loki/falcon/hydrus/…/noise), по выбору CDN.
- **URL:** содержит `:YYYYMMDDHH` — слот времени (Kodik expires), и md5-путь. Полный URL time-bound,
  но **имя хоста** в allowlist-U свою rôle не меняет (suffix-match, без port/path).

### 5.10. Не поломается ли playback других провайдеров
Нет (регрессионная матрица — §9). Изменяется только конфиг-список `allowHosts` (подмножество).
Каждый провайдер со своим allowlist-корнем. `solodcdn.com` ни с одним существующим entry не
конфликтует (проверено по списку — дублей/поглощений нет).

---

## §6 Redirect-цепочка, manifest, variant, segment, Range

### 6.1. Redirect-цепочка CDN (живая проба)
```
GET https://sky.solodcdn.com/animes/<md5>/<md5>:2026081620/720.mp4:hls:manifest.m3u8
   → 302 Location: https://loki.sky.solodcdn.com/animes/<md5>/<md5>        (202)
   GET https://loki.sky.solodcdn.com/...
   → 200 application/vnd.apple.mpegurl, len=57591

GET https://cloud.solodcdn.com/useruploads/<uuid>/<md5>:2026081620/720.mp4:hls:manifest.m3u8
   → 302 Location: https://falcon.cloud.solodcdn.com/useruploads/<uuid>/<md5>  (202)
   → 200 application/vnd.apple.mpegurl, len=53784
```
Аналогично для остальных: sky→{loki,hydrus,rubidium,anteros}.sky; cloud→{falcon,iridium,prism,
orange,pegasus,noise}.cloud. **Каждый hop при проксировании re-валидируется** на суффикс-корень
(proxy.js:203) — при едином корне `solodcdn.com` оба хоста матчатся, редиректы легальны.

### 6.2. Master (manifest)
`application/vnd.apple.mpegurl`, псевдо-HLS от одиночного MP4: `720.mp4:hls:manifest.m3u8`
(«transmuxed» HLS: сегменты `seg-N-v1-a1.ts`, TS). Манифест НЕ содержит ни `RESOLUTION=`, ни
вложенных variant-плейлистов — это одна «рендер-группа» качества 720. **variant-уровень отсутствует**
(нет `_hls`-вложенности), поэтому «variant» проверяются как мастер (см. ниже).

### 6.3. Segment
`.../720.mp4:hls:seg-1-v1-a1.ts` — резолвится против base URL (после redirect — против
serving-ноды `loki.sky…`). Прямой GET: **200 `video/MP2T`**, Content-Length 1609656, **accept-ranges: bytes**.

### 6.4. Range
`GET seg-1-v1-a1.ts` с `Range: bytes=0-1023` → **206 Partial Content**, `Content-Range: bytes 0-1023/1609656`.
Range-проброс в proxyMedia уже реализован (proxy.js:187-193: `range` из headers → каждый hop).
После allowlist-фикса плеер получит 206 через прокси.

### 6.5. Через Maniya proxy (текущее состояние)
ВСЕ манифесты/сегменты через `/api/lampa/proxy` → 403 `proxy_host_forbidden` (len 71, JSON).
CDN при этом жив и отдаёт данные — конфликт только в allowlist.

---

## §7 SSRF-анализ добавляемого хоста

Оценка риска **добавить `solodcdn.com`** в `config.proxy.allowHosts`.

1. **Модель безопасности Maniya:** `validateProxyTarget` пропускает https только если `host` ∈
   allowlist (suffix). Разрешённый корень = «можно проксировать только поддомены этого DNS-суффикса».
   SSRF-поверхность после правки: `https://*.solodcdn.com` (два известных корня `sky`/`cloud` +
   их serving-поддомены; путь/path произвольный, но только под этим суффиксом).
2. **Что НЕ расширяется:**
   - Не открываются произвольные интернет-адреса (любой другой хост по-прежнему 403).
   - Нет доступа к внутренним адресам: `solodcdn.com` — публичный CDN Kodik с **name-based DNS**,
     без IP-literal; loopback-rules (`127.0.0.1/localhost/::1`) и http-список не затронуты.
   - Redirect-цепочки ограничены тем же корневым суффиксом (re-валидация на каждом hop).
3. **Что по-прежнему доступно атакующему с валидным токеном:** спамить прокси через
   `/api/lampa/proxy?url=https://sky.solodcdn.com/…` (фактически — качать медиа Kodik через наш
   сервер). Это bandwidth-relay, но не SSRF до приватных сетей; конечный хост — публичный медиа-CDN.
4. **Альтернатива «точнее»:** можно было бы сделать resolve-time allowlist (разрешать только те URLs,
   которые вернул кластер/`KodikClient`, через подписанный маркер), но это структурное изменение
   (новый механизм валидации), а коневой суффикс `solodcdn.com` решает 100% кейсов и повторяет уже
   принятый паттерн GAP-012 (`mvapspdmpg.com`, `werkecdn.me`, `cdnsqu.com` — такие же CDN-суффиксы
   в allowlist).
5. **Остаточный риск:** если когда-либо CDN Kodik переключат на другой хост-суффикс (не solodcdn),
   его надо будет добавить аналогично. Это типичный риск «статического» allowlist и уже задокументирован
   (тот же подход для Rezka §про «живой CDN-хост добавляется на live-валидации», config.js).

**Вердикт:** риск низкий и **концептуально минимальный** — добавление одного публичного CDN-суффикса,
проверенное живыми пробами (9 тайтлов, redirect-цепочки, master/segment/Range), без новых код-путей.

---

## §8 Является ли это реальным playback-багом

**Да.** Это не семантика показа (availability корректен: show:true, items>0 — §0), не флап и не
transient (проверено 25+ запросами в одно окно). Это **playback-гейт Maniya**, срабатывающий на
каждом реальном Kodik-потоке:
- upstream Kodik/кластер отдаёт корректные playable ссылки;
- CDN `*.solodcdn.com` отвечает 200/206;
- Maniya `proxyMedia` не может даже начать поток из-за отсутствия хоста в `allowHosts`.

Отсюда user-видимый симптом: карточка есть, «Видео не найдено» / 403 при Play (как в movie-test
08.08.2026 для Collaps/Rezka/Kodik «видео не найдено»). Для Kodik это диагностировано: не кластер,
не upstream, а наш proxy allowlist.

---

## §9 Регрессионная матрица (если сын применять фикс)

| Область | Влияние фикса (`allowHosts` += `solodcdn.com`) | Комментарий |
|---|---|---|
| Другие провайдеры (filmix×6, veoveo, hdvb, rezka, alloha, sibnet, vkvideo, rutube, ok, anilibria…) | Нет | allowlist only; каждый провайдер со своим корнем; новых хостов не затронуто |
| E-Online-хосты / httpAllowHosts | Нет | отдельный список, не меняется |
| native kodik `video-links` (kodikres.com) | Нет | API-хост уже в allowlist, остаётся |
| Redirect-ревалидация (proxy.js:203) | Покрывает | `*.sky/cloud.solodcdn.com` — поддомены `solodcdn.com` |
| rewriteHlsManifest / rewriteDirectiveUri / Range | Работает | логика не меняется; только становится достижимой |
| card-availability (checkSearchPredicate / withinCatalog / twin) | Нет | не трогается |
| Playback других скрытых провайдеров | Нет | solodcdn ни с кем не конфликтует (список проверен) |
| Тесты суита | Нет изменений тестов | READ-ONLY; если фикс возьмут — конфиг-данные, не код |

---

## §10 ITOG — итоги по ТЗ (A–G)

**A. Точный root cause.**
`resolveVideos` (twin `skaz-kodik`; и native `KodikClient` тоже) отдаёт playable URLs нa
`sky.solodcdn.com` / `cloud.solodcdn.com`; эти хосты отсутствуют в `config.proxy.allowHosts`
(там есть только API-хост `kodikres.com`); `proxyMedia` → `validateProxyTarget` → `isHostAllowed`=false
→ 403 `proxy_host_forbidden` (proxy.js:38) на КАЖДОМ медиа-запросе (манифест, затем сегменты).

**B. Реальный ли это playback bug.** Да, реальный: upstream и CDN здоровы (манифест 200
`application/vnd.apple.mpegurl`, сегменты 200 `video/MP2T`, Range 206), блокирует исключительно
allowlist входного прокси. Показ карточек корректен; баг только на стадии Play. Не transient,
не семантика.

**C. Минимальный безопасный концептуальный фикс.**
Добавить ОДИН корневой суффикс `solodcdn.com` в `config.proxy.allowHosts` (список §proxy,
config.js:239). Suffix-match `isHostAllowed` автоматически покрывает `sky.solodcdn.com`,
`cloud.solodcdn.com` и все динамические serving-ноды (`*.sky.*`, `*.cloud.*`). Кода не требуется:
proxy-механика (re-валидация хопов, HLS/DASH rewrite, Range проброс, buildProxyUrl с token) — уже
готова и тестировалась для других провайдеров. Это ровно тот же паттерн, что GAP-012 для
`mvapspdmpg.com` (veoveo): 1 строка allowlist + (по решению юзера) тесты.

**D. Какие хосты потребуется разрешить.**
Ровно один: **`solodcdn.com`** (суффикс). Развёрнутый список того, что он закрывает (проверено
живыми пробами): корни `sky.solodcdn.com`, `cloud.solodcdn.com`; serving-ноды редиректов
`loki/hydrus/rubidium/anteros.sky.solodcdn.com`, `falcon/iridium/prism/orange/pegasus/noise.cloud.solodcdn.com`.
Отдельно перечислять serving-ноды не нужно (ротируются) и нельзя (недетерминированы) — корень и есть
правильная единица.

**E. SSRF-риск.** Низкий. Открывается только суффикс одного публичного медиа-CDN с name-based DNS;
внутренние адреса/loopback/http-список не затронуты; redirect-цепочки остаются внутри того же
суффикса. Остаточный риск = bandwidth-relay через валидный токен (как у всех CDN-entry в allowlist)
и потенциальная смена CDN-суффикса Kodik в будущем (добавится аналогичной строкой). Альтернативой
(полный запрет доселе неизвестных хостов) был бы resolve-time-подписанный allowlist — структурное
изменение, не обоснованное данным багом.

**F. Регрессионная матрица.** §9. Итог: изменяется только конфиг-список (подмножество allowHosts),
никакого пересечения с хостами других провайдеров/E-Online; логика proxy не меняется; суита тестов
не трогается; если брать фикс — нужны лишь конфиг+ возможные ни-та тесты на вход `solodcdn.com`.

**G. Что НЕ надо менять.**
- proxy.js логику (`validateProxyTarget`, redirect re-валидацию, rewrite, Range) — она корректна.
- availability-предикат / twin-механику / каталог-гейт / классы FP-FN — не относятся к этой проблеме.
- Skaz / Collaps / E-Online runtime — вне scope.
- Maniya остаётся независимой от E-Online (reference использован только чтобы доказать: Lampac
  проксировал бы без allowlist — значит, дело в нашей модели, а не в данных).
- Не менять структуру `video-links` / `directStreams` / `parsePlayer` (native) — они корректы.

---

## §11 Пробы — файлы (для воспроизводимости)

`C:\Users\Admin\AppData\Local\Temp\post-w1-audit\`:
- `kodik-pick-playback.mjs/.json` — Паразиты: resolve → playable URL → master 403.
- `kodik-cdn-hosts.mjs/.json` — 5 тайтлов → CDN-хосты + viaProxy/direct статусы.
- `kodik-cdn-chain.mjs/.json` — redirect-цепочка + manifest (m3u8, no RESOLUTION) + сегмент + Range.
- `kodik-cdn-extra.mjs/.json` — 4 доп. тайтла → ширина набора хостов/reжид.

Все ссылки/GET-запросы READ-ONLY (не мутируют состояние).

---

**Константы для фикса (когда по решению юзера):**
- `config.js` §`proxy.allowHosts` — добавить `'solodcdn.com'`.
- Опционально `.env.example` упомянуть `PROXY_ALLOW_HOSTS` (перезаписывает дефолт — осторожно,
  список полностью задаёт пользователь; в проде дефолт не переопределён, иначе solodcdn не сработает).

STOP после отчёта. Код/тесты/commit/push/deploy — не менялись.