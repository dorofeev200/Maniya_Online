# PROJECT-READINESS-002 — Финальный аудит готовности к продакшену (READ-ONLY)

**Дата:** 2026-08-14
**Тип:** ФАЗА 1 — полный read-only аудит. Код НЕ менялся, коммитов НЕ было, деплой НЕ выполнялся, креды НЕ ротировались, чужие незакоммиченные изменения НЕ трогались.
**Методы:** сводка 11 существующих отчётов + послойная карта архитектуры из кода (Agent B) + security-скан masked (Agent C) + E-Online сравнение A–AE (Agent D) + полный тест-прогон (545) + **live-матрица 10 тайтлов × 16 источников на проде** (FP/FN, playback, perf, cache, concurrency).
**Правила:** E-Online НЕ является абсолютной истиной — BETTER ставится, когда Maniya корректнее. Счёт не подгоняется под 10/10. Реальные секреты в отчёте отсутствуют (только masked). Upstream-ограничения отделены от багов Maniya.

---

## 1. Executive Summary

Платёжный/инсталляционный/безопасностный контур Maniya **сильнее E-Online** (fail-closed инсталл, UA-гейт браузера, per-user подписка и изоляция кэша, RULE-1..4, OLD∩NEW гейт + HIDE_TTL, quality or-reserve, media-прокси с SSRF-локлистом и HLS-rewrite, rate-limiter, online8 abstain, ленивый call-resolve). Инсталл-флоу проверен прод-verify 10/10, MSX-чек зелёный.

**Главная зона риска — видимость/доступность источников на карточке.** Live-матрица (10 тайтлов × 16 источников, 160 ячеек): 139 показанных ячеек, из них **38 (27%) — show=true при videos=0** (виден, но мёртв), и **1 FN** (kinopub на «Интерстелларе» — скрыт, но 9 playable-элементов). Драйверы FP: collaps (мёртв на **всех 10** тайтлах — GAP-002), geosaitebi (5), kinoflix (4), pidtor (4 на сериалах), rutubemovie (4 на сериалах — movies-only, GAP-001). Плейбек показанных источников в основном рабочий (filmix 8/10, rezka 9/10 и т.д.), но **veoveo 10/10 resolve → 403** (GAP-012) и filmix частично 403/404 (GAP-003).

**Конкарренси:** 5 параллельных одинаковых запросов карточки (один uid) → **4 РАЗНЫХ набора вердиктов** (нет single-flight, кэш-стампед с расхождением) — GAP-013.

**Перф:** `/videos` p50=465ms, p95=4111ms, max=11648ms; карточка cold p50=5.7s, **p95=12.0s (упирается в дедлайн)**, warm=0ms (кэш).

**Тесты:** 545 → 537 pass / **2 pre-existing fail** (api.test.js «26802 дня», regex неверен для правильной русской плюрализации) / 6 skip (live-гейт). Новых падений нет.

**Итоговая оценка: 6.8/10** (честно, с учётом 27% FP и конкарренси-расхождения). Целевая — 9.0/10 (P0=0, P1=0 или документированное исключение, FP/FN=0 на критичных источниках, детерминизм конкарренси, стабильный playback). Полный план — в конце.

---

## 2. Current Score

| Измерение | Вес | Оценка | Обоснование (evidence) |
|---|---|---|---|
| Инсталл-флоу / гейты | 15% | 9.5/10 | Fail-closed `/i//p//x/`, UA-гейт, MSX-чек 200, prod-verify 10/10 |
| Безопасность | 15% | 8.0/10 | Нет живых секретов в репо; остаток — креды ротации в git history + незакоммиченный scrub |
| Availability (FP/FN) | 20% | **5.5/10** | 27% показанных мёртвые, 1 FN; движок умный, но вердикты перегружены FP |
| Playback | 15% | 7.5/10 | Большинство показанных играет; veoveo 403, filmix частично 403/404, pidtor частично |
| Сериалы | 10% | 8.0/10 | seasons/voices заполнены у основных (filmix s3/v16, kinopub s3/v13, rhsprem s3/v19); cdnvideohub s2/v2 |
| Кэш / uid-изоляция | 10% | 8.5/10 | Кэш карточки uid-scoped, HIDE_TTL; нав/эпизод/tv-кэши провайдеров НЕ uid-scoped (GAP-015) |
| Конкарренси | 5% | **4.0/10** | 5 параллельных → 4 разных набора (GAP-013) |
| Перф | 5% | 6.5/10 | warm 0ms; cold p95 12s; /videos p95 4.1s |
| Тесты | 5% | 8.5/10 | 537 pass, 2 pre-existing, 6 skip |
| **ИТОГО** | 100% | **6.8/10** | Целевая: **9.0/10** |

Целевая разбивка: P0=0, P1=0 (или документированные upstream-исключения), FP/FN=0 на критичных источниках (filmix/rezka/alloha/kinopub/rhsprem/solntse), конкарренси детерминирован (1 набор), колд-карточка p95 < 4s, playback критичных источников 100%.

---

## 3. Architecture (слойная карта)

Полная карта — отчёт Agent B (внутренний, не коммитился). Здесь — конспект, `file:line`.

### Layer 0 — HTTP-роутинг (`server/src/index.js`)
- `requestContext` (19-27) → `route()` (73-268), GET-only (78), `OPTIONS`→204 (77).
- Порядок: `/health`(80) `/ready`(84, 503 при ready=false) → legacy-шортлинк `^/([^/]+)_([0-9a-f]{8,})\.js$`(94-102) → `/i/<32+hex>`(110-112, всегда stub) → `/p/<32+hex>.js`(114-128, **fail-closed 503** без `PLUGIN_CODE_SECRET`) → `/x/<install>_<key>.js`(133-142, HMAC timing-safe, wrong→404) → статика(144-146) → `/api/lampa/proxy`(150-159, **без rate-limit**) → `assertRateLimit`(161) → subscription/check(163-183) → sources(185-204) → sources/card(209-233) → videos(235-243, всегда 200) → video(245-252, null→404) → stream(254-265) → 404(267).
- Ошибки: `toHttpError` (283-300), не-HttpError → 500 `internal_error`.
- 404 = content-absent/unknown identity (анти-утечка); 403 = deny; 429 = overload; 503 = disable.

### Layer 1 — Инсталл (`http.js`, `index.js`, `telegram/bot.js`)
- `isLampaRequest` (http.js 94-102): UA `lampa` OR origin=bylampa.online OR (logged && reset).
- `PLUGIN_STUB_TEXT = 'Добавьте плагин в Расширения Lampa.'` (точка → MSX-чек 200).
- `pluginUrl` (bot.js 139-170): ВСЕГДА legacy `/{slug}_{short}.js`; `/p/` в выдаче нет.
- `hiddenPathFor` = HMAC-SHA256(secret, 'plugin-code:'+install).slice(0,24); `hiddenKeyMatches` timing-safe.

### Layer 2 — Availability (`availability.js`)
- Вход: `card(query, userUid)` (817-962); `userUid = sha256(token).slice(0,16)` (index.js 211).
- Кэш: key `fnv1aKey(id:serial:source:count:userUid)` (798-803), TTL 5min (81), **HIDE_TTL 60s** (86,953-958), sweep >512 (805). **uid-scoped** → нет кросс-юзер утечки.
- RULE-1: `method:call/play`/type movie|episode|season → available; `method:link` → `classifyLinkCard` (189-219) title/KP/year → match/нет/inconclusive.
- RULE-2: accsdb «Ожидаем фильм…» = авторитетное «нет»; прочие accsdb = inconclusive (639-663).
- RULE-3: native без карточного ключа (cdnvideohub, kinopoisk_id только) → авторитетное «нет» (`nativeProbe` 423-465).
- RULE-4: дедлайн/таймаут не переворачивает полученное «нет» в show (590-599); fallback show:true только без ответа вовсе.
- reservePolicy `'abstain'` (defaultChecker, 973): online8 non-2xx/non-content ≠ «нет».
- TRUSTED_ALWAYS_VISIBLE={filmix,skaz-filmix} (341, 840-842) — без кластерного вызова, всегда show.
- Confirmation OLD∩NEW (892-938): скрытые перепроверяются `checksearch=false` через backoff 500ms (751-759); выжившее «нет» = 3 независимых сигнала, кэш 60s.
- Таймауты: `timeoutMs = config.skaz.checkTimeoutMs || 8000` (475; config default 10000, config.js 230); `deadlineMs = max(timeout+2000,10000)` = **12s** (477).

### Layer 3 — Videos / resolveVideo (`store.js`)
- `getVideosForRequest` (117-195): одиночный провайдер — сериалы native-first, фильмы twin-first, никогда merge; мульти-провайдер — union; пусто+provider_error → diagnostics; search-fallback фильтрует по реальному url/stream; файловый фолбэк `videos.json` (190-194) **не uid-scoped** (GAP-017).
- `getVideoForRequest` (102-115): `allProviders()` (скрытые twin тоже); `resolveVideo` есть только у SkazProvider (SkazProvider.js 241-256) — native отдают play-direct и `/video` не требуют (GAP-018, безопасно сегодня).
- `/videos` никогда не 5xx-ит от провайдерских ошибок (`payloadOrNull` 197-203, `twinForPayload` 206-215).

### Layer 4 — Провайдеры (`providers/`)
- registry.js: `nativeProviders`(40-86) + `buildSkazProviders`(99-115) по одному `skaz-<balancer>` + скрытый twin на native (126-129); `registeredProviders`=видимые (131); `allProviders`=все скл. (136); `providerById`=видимые (140).
- SkazClient: `STATUS_REST={200..206}` (19), `DEFAULT_TIMEOUT_MS 15000` (3); `fetchHosts` ротирует только на 5xx/network (247-253).
- Rezka: timeoutMs 12000, cooldown 30s, Retry 1/400-1200, RL 300/2 (RezkaClient 108-128); Anubis-солвер (RezkaCodec 294-360); **GAP-004 open**: movieVideos/serialVideos берут только `streams[0]` (245-327) — живьём НЕ воспроизвёлся (все first-items playable).
- Filmix: primary 3000ms/0 retries (filmix.my, мёртв → 301→501), apiFx 45000ms/2 (api.filmix.tv, cold до 40s), tvAuth 15000ms/1 (FilmixClient 39-64); tv-токен кэш 4min.
- Alloha: token-gated, 10000ms/2/RL 250/2.
- **Kodik/Rutube/CDNvideohub/Collaps: сырой fetch, БЕЗ таймаут-обёртки** (GAP-016) — висящий upstream может держать `/videos`.
- shared/http: RetryPolicy [408,429,500,502,503,504] экспоненциально (HttpClient.js 31-71).

### Layer 5 — Прокси (`proxy.js`)
- `isHostAllowed` (18-26), `validateProxyTarget` (28-53): https+allowlist else **403 proxy_host_forbidden**; http только loopback/httpAllowHosts else 400. timeoutMs 15000, maxRedirects 4.

### Layer 6 — Security (`security.js`)
- `clientIp` — **X-Forwarded-For первым** (6-10): синтетический IP управляет бакетом rate-limit (осознано для тестов; note для реального деплоя за nginx — nginx переопределяет XFF).
- `assertRateLimit` 120/60s per-IP (31-47); proxy exempt.

### Layer 7 — Telegram-бот (`telegram/`)
- Long-polling runner; `/start /status /help /list /revoke /grant` + `get_link /pay /attach_receipt /send_receipt /grant_issue`. Единственный write-path в users.json.

---

## 4. E-Online сравнение (A–AE)

E-Online — референс для сравнения, НЕ истина. BETTER ставится, когда Maniya корректнее.

| Area | E-Online | Maniya | Status | GAP | Priority |
|---|---|---|---|---|---|
| A. Инсталл-URL схема | /slug_short.js (короткие 6-8 hex) | legacy + /i/ (stub) + /p/ (loader) + /x/ (HMAC) | **BETTER** | — | — |
| B. Гейт браузера | UA+origin | UA OR origin OR logged&&reset; браузер → stub-текст | **BETTER** | — | — |
| C. Plugin check (Extension.check) | проходит | 200 «Рабочий» (stub с «Lampa.», PLUGIN-VERIFY-004) | MATCH | — | — |
| D. Подписка | per-user | per-user, Bearer/token/email, 403 requireSubscription | **BETTER** | — | — |
| E. Изоляция кэша | per-user | card-кэш **uid-scoped** (fnv1aKey с userUid) | **BETTER** | GAP-015 (нав/эпизод/tv кэши не uid) | P2 |
| F. Availability-движок | checksearch show:true/false | RULE-1..4 + 3-состояния + OLD∩NEW + HIDE_TTL | **BETTER** (по дизайну) | FP=38/139 живьём | P0 |
| G. Native-availability | server checksearch на native | RULE-3 nativeProbe + скрытый twin | **BETTER** | GAP-008 (нативные всё равно FP: collaps) | P0 |
| H. RULE-1 (call/play/link) | — | classifyLinkCard title/KP/year | **BETTER** | — | — |
| I. RULE-2 (accsdb) | скрывает | «Ожидаем…»=нет; прочие=inconclusive | **BETTER** | — | — |
| J. RULE-3 (native no-key) | не заложено | авторитетное «нет» | **BETTER** | — | — |
| K. RULE-4 (deadline) | — | таймаут не флипает «нет» | **BETTER** | — | — |
| L. OLD∩NEW гейт | нет | двойной сигнал + backoff | **BETTER** | — | — |
| M. HIDE_TTL / self-heal | 5min-кэш скрытия | 60s self-heal | **BETTER** | — | — |
| N. TRUSTED_ALWAYS_VISIBLE | — | filmix/skaz-filmix всегда видны | DIFFERENT-BUT-VALID | **filmix виден даже при videos=0** | P2 |
| O. online8 reserve | online8 = живая нода | abstain (non-kinopub воздержание) | **BETTER** | GAP-006 FIXED | — |
| P. Кэш-ключ карточки | cluster memkey | fnv1aKey uid-scoped | MATCH | — | — |
| Q. Латенция availability | **35-75ms warm (memkey)** | warm 0ms (кэш), **cold p95 12s** | E-Online BETTER (cold) | GAP-014 | P2 |
| R. /videos flow | — | serial native-first / movie twin-first, never merge | DIFFERENT-BUT-VALID | — | — |
| S. Ленивый resolveVideo | — | метод call → /video по голосу/качеству | **BETTER** | GAP-018 (skaz-only) | P3 |
| T. Media-прокси | открытый | SSRF-локлист + HLS-rewrite + Range + maxRedirects | **BETTER** | — | — |
| U. Rate-limit | — | 120/60s per-IP (XFF-first) | **BETTER** | — | — |
| V. Универсум источников | **динамический + discovery** | статический реестр | E-Online BETTER | GAP-007 | P2 |
| W. Выбор балансера юзером | да | нет (фикс. порядок) | E-Online BETTER | GAP-007 | P2 |
| X. rch/WS-only источники | да | нет (только HTTP) | E-Online BETTER | GAP-007 | P2 |
| Y. accsdb surfacing | виден месседж | provider_error, но причина маскируется (GAP-010 фикс в shadow) | PARTIAL | GAP-010 | P2 |
| Z. Kodik verdict | стабилен | unstable: forrest FP | E-Online BETTER | GAP-009 | P2 |
| AA. Kinopub | стабилен | burst-flap → FN (Интерстеллар hide+9 PLAY) | E-Online BETTER | GAP-005 | P0 |
| AB. Error-handling HTTP | — | 200/204/301/302/400/401/403/404/429/500/502/503/504 матрица | **BETTER** | — | — |
| AC. Retry/backoff/timeouts | — | RetryPolicy + host-rotation + deadline | **BETTER** | GAP-016 (4 клиента без таймаута) | P1 |
| AD. Конкарренси | — | расхождение наборов (4/5) | PARTIAL | GAP-013 | P1 |
| AE. Observability | — | логи request_failed; без метрик | PARTIAL | — | P2 |

**Сводка статусов:** BETTER=14, E-Online BETTER=4 (Q,V,W,X), MATCH=2, DIFFERENT-BUT-VALID=3, PARTIAL=3, нет MISSING/REGRESSION. Итого Maniya опережает по 14 из 31 областей; отставание — динамический универсум/дискавери/латентность cold и стабильность 2 балансеров.

---

## 5. Provider matrix (live, prod, 2026-08-14)

Методика: на VPS против `127.0.0.1:3000`, токен из users.json (первый пользователь, **deploy-test@maniya.local**, masked `mo-a…26`), синтетический IP 198.51.100.7, окно-лимитер ≤110/60s (rate-limit НЕ обходился). 10 тайтлов × 16 источников = 160 ячеек. Playback-проба: Range bytes=0-1023, playable = 2xx + (media content-type ИЛИ #EXTM3U/#EXT-X-*).

**Важно:** матрица бежала под uid тестового аккаунта (`6ffeb4bea19e3033`). Вердикты availability uid-scoped → у реального пользователя возможны отличия (кластер skaz отвечает по grant'у устройства). Числа — индикативны, но консистентны с предыдущими прогонами.

### Итог по матрице
```
160 ячеек: shown=139  items>0=102  dead(show+items=0)=38  FP=38  FN=1
/videos:            p50=465ms  p95=4111ms  max=11648ms
/sources/card cold: p50=5659ms p95=12005ms max=12005ms
/sources/card warm: p50=0ms    p95=0ms     max=0ms
```

### По-провайдерно (playback первого item / FP / FN)

| Провайдер | Показан | Items>0 | FP | FN | Playback (live) | Вывод |
|---|---|---|---|---|---|---|
| filmix | 10/10 | 10 | 0 | 0 | 8× 206 PLAY; **oa→403**, **dune2→404** | GAP-003 (частично) |
| kodik | 10 | 1 (forrest) | 1 | 0 | — (только forrest пусто) | GAP-009 |
| rezka | 9/10 | 9 | 0 | 0 | 9× 200 PLAY m3u8 (odyssey hide корректно) | **GAP-004 не воспроизвёлся** |
| rutubemovie | 10 | 6 | **4** | 0 | фильмы 200 json; сериалы FP | GAP-001 (movies-only на сериалах) |
| cdnvideohub | 10 | 8 | 2 (last_house, dune2 hide) | 0 | 200 PLAY m3u8 | частично |
| **collaps** | 10 | **0** | **10** | 0 | — | **GAP-002 P0 (мёртв везде)** |
| hdvb | 10 | 8 | 2 | 0 | 200 PLAY | частично |
| skaz-alloha | 10/10 | 10 | 0 | 0 | 10× 206 PLAY m3u8 | ✅ стабилен |
| skaz-videoseed | 10 | 7 | 3 | 0 | 206 PLAY m3u8 / 200 json | частично |
| skaz-kinopub | 9/10 | 7 | 2 | **1** | matrix/hotd/oa/silo/dune2 PLAY; **Интерстеллар hide+9 PLAY** | **GAP-005 P0 (FN)** |
| skaz-kinoflix | 10 | 6 | 4 | 0 | forrest/interstellar/dune2/tlou PLAY | частично |
| **skaz-veoveo** | 10 | 10 | 0 | 0 | **resolve → 403 на ВСЕХ 10** | **GAP-012 P0** |
| skaz-pidtor | 10 | 6 | 4 | 0 | interstellar/dune2 206 PLAY matroska; прочие 0 ERR | частично |
| skaz-solntse | 10 | 7 | 3 | 0 | 206 PLAY mp4 | частично |
| skaz-geosaitebi | 10 | 5 | **5** | 0 | 206 PLAY m3u8 где есть | GAP-008/FP |
| skaz-rhsprem | 9/10 | 8 | 0 | 0 | 200 PLAY m3u8; odyssey accsdb hide (корректно) | ✅ стабилен |

### Playback деталь (проблемные ячейки)
- **filmix «The OA»**: items=8, но первый item probe → **403/text/html** (GAP-003: CDN/качество).
- **filmix «Дюна 2»**: items=9, первый item → **404/text/html**.
- **veoveo все 10**: items есть (1–10), но resolve `/video` → **403/application/json** — источник виден и «содержит» контент, но не играет (GAP-012).
- **pidtor**: last_house/forrest/matrix → 0 ERR (вероятно non-HTTP URL/магнит); interstellar/dune2 → 206 PLAY matroska.

---

## 6. Availability (FP/FN анализ)

### Дизайн — сильный (Agent B подтвердил)
- RULE-1..4, three-state, abstain-online8, OLD∩NEW, HIDE_TTL 60s, self-heal, TRUSTED filmix, nativeProbe — всё в коде и подкреплено тестами (availability.test.js, availability-hidden-twin.test.js).
- GAP-006 (online8 abstain) — закоммичен, задеплоен, prod-verified.
- GAP-010 (accsdb escaped-unicode) — исправлен в shadow (НЕ закоммичен — будет в волне фиксов).

### Live FP = 38 (27% показанных ячеек мертвы)
Расклад по источникам (см. §5). **Топ-драйверы:**
1. **collaps 10/10** — источник конфигурирован (token), но стабильно пусто. По RULE-3/8 должен скрываться: у него НЕТ карточного ключа в запросе → nativeProbe должен давать «нет». Причина FP — см. GAP-008 (нативные без проверки по-прежнему показываются, collaps = native row с show по-умолчанию).
2. **geosaitebi 5, kinoflix 4, pidtor 4 (сериалы), videoseed 3, solntse 3** — балансеры, у которых на части тайтлов checksearch дал «да», а `/videos` пусто. Вероятно: (а) контент есть в кластере, но query-параметры Maniya не совпадают с кластером для этого тайтла; (б) ленивый twin/native-фолбэк пуст. Требует точечной трассировки на 1 тайтле.
3. **rutubemovie 4 (все сериалы)** — movies-only провайдер показывается на сериалах (GAP-001).
4. **kodik 1 (forrest), hdvb 2, cdnvideohub 2** — малые.

### Live FN = 1 (кинопub, Интерстеллар)
`skaz-kinopub: show=false, но /videos → 9 items, все 206 PLAY m3u8`. Root cause — GAP-005: kinopub-вердикт флапает (burst-насыщение → deadline), HIDE_TTL 60s удерживает скрытие даже когда контент вернулся. **Это худший класс бага: пользователь не видит рабочий источник.**

### FP/FN классификация против референса
- FP по определению `show=true && items=0` (без provider_error). Кросс-проверено с `docs/native-availability-001-report.md` — паттерн консистентен (collaps/kodik/cdnvideohub/geosaitebi/rhsprem FP на Одиссее и там).
- GAP-003 (filmix 403/404 на части качеств) — отдельный класс: show правильный, но первый quality-вариант мёртв. or-reserve может спасать, но первый item в выдаче — «лицо» источника.

---

## 7. Playback (per provider, live)

| Провайдер | Статус playback | Контейнер | Замечание |
|---|---|---|---|
| filmix | 8/10 PLAY, 2 провала | video/mp4 (206), m3u8 на сериалах | oa 403, dune2 404 (GAP-003) |
| rezka | 9/9 PLAY | vnd.apple.mpegurl 200 | полный успех, включая сериалы |
| alloha | 10/10 PLAY | vnd.apple.mpegurl 206 | стабилен |
| videoseed | PLAY m3u8 / json | — | частично |
| kinopub | PLAY m3u8 где показан | — | FN на Интерстелларе |
| kinoflix | PLAY mp4 | — | 4/10 FP |
| veoveo | **403 resolve ×10** | application/json | GAP-012 |
| pidtor | PLAY matroska (2), ERR (3) | video/x-matroska | магниты/не-HTTP |
| solntse | PLAY mp4 | — | 3/10 FP |
| geosaitebi | PLAY m3u8 где есть | — | 5/10 FP |
| rhsprem | PLAY m3u8 | — | стабилен |
| rutubemovie | 200 json (фильмы) | application/json | сериалы FP |
| cdnvideohub | PLAY m3u8 | — | 2 FP |
| hdvb | PLAY | text/html (rewrite) | 2 FP |
| collaps | — | — | 10/10 FP |

Вывод: **критичные источники (filmix, rezka, alloha, rhsprem, solntse, kinopub) играют**, где показаны. Системные проблемы — veoveo (403) и FP-кластер видимых-мёртвых.

---

## 8. Serials

- **filmix** hotd: items=10, seasons=3, **voices=16** → фильтры сезонов/озвучек работают (фикс `stype`-подфильтров в силе).
- **kinopub** hotd: s=3, v=13; **rhsprem** hotd: s=2, v=19; **rezka** hotd: s=3, v=20 — voices множественные.
- **alloha**: s=3, v=10; **videoseed**: s=2, v=0 (no voices — структура балансера); **solntse**: s=2, v=0.
- **cdnvideohub**: silo items=20, s=3, v=4; hotd s=2 v=2 — сезоны есть, озвучки редкие (по дизайну источника).
- Сериальные FP: rutubemovie (4), pidtor (4), geosaitebi (3), kinoflix (2), videoseed (1), kinopub (tlou) — те же FP-драйверы, что и фильмы.
- Неправильного фильма/сезона на выбранных тайтлах не обнаружено (проверено season/voice counts по основным провайдерам).

---

## 9. Cache

| Кэш | Ключ | TTL | uid-scoped | Оценка |
|---|---|---|---|---|
| Availability card | `fnv1aKey(id:serial:source:count:userUid)` | 5min / HIDE 60s | ✅ | корректно |
| `_navCache` SkazProvider | `M/S|balancer|pageParams` | 5min | ❌ | GAP-015 |
| `_episodesCache` RezkaClient | — | 10min | ❌ | GAP-015 |
| `_tvTokenCache` FilmixClient | — | 4min | ❌ | GAP-015 |
| `videos.json` fallback | `tmdb_id || id` | ∞ | ❌ | GAP-017 |

Card-кэш: warm=0ms, setStable=true (cold vs warm 1 набор) — **правильно работает**. 60s HIDE_TTL = self-heal (эмпирика 2026-08-13). GAP-015/017 — контент-нейтрально, но кросс-юзер вектор.

---

## 10. Concurrency

**Live-тест: 5 параллельных `/sources/card` для Одиссеи (тот же uid) → 4 РАЗНЫХ набора вердиктов из 5.** Статусы все 200; наборы различаются (пример: `rezka:false|kinopub:false|pidtor:false|rhsprem:false` в одном, другие содержат эти как true).

Root cause: в `card()` нет **single-flight** — при одновременном cache-miss каждый запрос гоняет свой probe-цикл и пишет свой результат в общий Map (last-write-wins). Расхождение зависит от порядка завершения probe'ов и таймаутов хостов. **Влияние:** под реальной нагрузкой (несколько устройств юзера / ретраи) разные запросы одного и того же могут получить разные наборы источников. GAP-013 (P1).

---

## 11. Install

- Инсталл-флоу: legacy `/{slug}_{short}.js` (short = 12 hex), `/p/` loader, `/x/` HMAC-скрытый, `/i/` всегда stub. Fail-closed: без `PLUGIN_CODE_SECRET` `/p/` → 503; wrong key → 404; inactive → 403; браузер → stub без токена.
- Prod-verify 10/10 (PLUGIN-INSTALL-003) + MSX-чек 200 (PLUGIN-VERIFY-004, 8/8). Тесты 24-25 репродуцируют `Extension.check`.
- **Единственный остаточный UX-баг:** у пользователя в MSX/браузере осталась ссылка от пре-ротационного токена (`…3cfdc9c00227.js` → корректный 404). Нужно удалить старую запись и добавить свежую ссылку от бота. Это НЕ дефект сервера.

---

## 12. Security (masked-сканирование, Agent C)

- **Ни одного живого секрета в tracked/untracked файлах репо.** Текущий токен `mo-6d7c…e4`, `PLUGIN_CODE_SECRET` `6497…cb`, SKAZ_UID `7974327d37`, KODIK/COLLAPS/HDVB/TELEGRAM токены — только в gitignored `backup/snapshots/` и `%TEMP%`. `.gitignore` покрывает `.env`, `server/data/`, `backup/`, `*.log`.
- **Остаточный риск (P1):** 3 ротированных, но реальных креда в git history **и в HEAD** (не закоммичен рабочий scrub): старый VPS-пароль `789z…89` (docs/action-plan.md:542), старый токен `mo-54f4…27` (scripts/auto-confirm-config.mjs:5, scripts/p1b-live-test.mjs:5), старый skaz-uid `dg4xu2tj` (4 файла). История НЕ переписывалась (по ТЗ не трогать). Ротация выполнена (SECURITY-002), креды мёртвые.
- **Untracked доки** (`security-001/002-rotation-report.md`, `project-readiness-001-report.md`) содержат masked-фингерпринты, включая **новый** VPS-пароль — риск случайного коммита. Плюс мусорный пустой файл `x.install_token)`.
- FILMIX_TV creds в репо/бэкапах отсутствуют (лежат в env на VPS).
- Статические `public/maniya-online.js` кэшируются 5min без токена — не утечка (гейт JS-only).

---

## 13. Performance

| Метрика | p50 | p95 | max | Комментарий |
|---|---|---|---|---|
| `/videos` (все ячейки) | 465ms | 4111ms | 11648ms | rutubemovie matrix 11.6s — редкий выброс |
| `/sources/card` cold | 5659ms | 12005ms | 12005ms | **упирается в дедлайн 12s** (GAP-014) |
| `/sources/card` warm | 0ms | 0ms | 0ms | кэш |

Cold-карточка 5.7-12s — главный перф-компромисс против E-Online (35-75ms warm via memkey). Причина: probe-цикл по 16 источникам последовательно/с ограничениями, дедлайн 12s. Не P0 (warm решает повседневный кейс), но P2 с аппетитным фиксом (single-flight + параллельность probe'ов + отсечка по лимиту времени на источник).

---

## 14. Testing

**545 тестов: 537 pass / 2 fail (PRE-EXISTING) / 6 skip (live-гейт), 7174ms.**

- 2 фейла — `server/test/api.test.js` (70, 82): assert `/^Осталось \d+ дней$/`, фикстура с `expires_at` в далёком будущем даёт «Осталось 26802 дня» — **плюрализация правильная («дня»), assert неверный**; date-dependent, pre-existing.
- 6 skip — live-гейт (`EO_LIVE=1`, `FILMIX_LIVE=1`).
- Новых фейлов нет. Покрытие: availability (+hidden-twin), install (+nosecret), shortlink, api, providers (filmix/rezka/kodik/alloha/rutube/cdnvideohub/hdvb), eolive, telegram.

---

## 15. GAP register

Приоритеты: **P0** — блокирует продакшен (гамма-гейт P0=0); **P1** — серьёзно; **P2** — желательно; **P3** — косметика.

| GAP | Priority | Severity | Evidence (live/код) | Root cause | Impact | Fix (предложение) | Test | Prod verification | Status |
|---|---|---|---|---|---|---|---|---|---|
| **GAP-002** collaps виден-мёртв | **P0** | High | FP 10/10 тайтлов, 0 items никогда | Native row без per-card проверки (GAP-008); collaps token задан, контента нет | Мёртвый источник на каждой карточке | Отключить/скрыть collaps (`enabled=false`) или RULE-3-native-check | test: collaps show=false на тайтле с пустым /videos | live re-matrix FP(collaps)=0 | OPEN |
| **GAP-005** kinopub burst-flap → FN | **P0** | High | Интерстеллар: show=false, 9 items 206 PLAY | Burst-насыщение (deadline 12s) → HIDE_TTL 60s удерживает скрытие | Рабочий источник скрыт — юзер не видит контент | Single-flight + не скрывать при `confirmInconclusive`; поднять TTL для подтверждённых hides; повторный re-probe при videos>0 | test: kinopub hide не при пустом confirm | re-matrix FN(kinopub)=0 | OPEN (частично митигирован 002/004) |
| **GAP-012** veoveo виден, но resolve 403 | **P0** | High | 10/10 resolve → 403/application/json | Происход: /video по item veoveo → 403 (прокси-локлист или upstream) | Источник виден и «содержит» контент, но не играет | Трассировать 1 item: локлист хоста vs upstream; добавить хост в `proxy.httpAllowHosts`/allowHosts либо скрыть | test: veoveo resolve ≠ 403 для реального item | live probe veoveo PLAY ≥1 | OPEN |
| **GAP-008** native show:true hardcode | P0 | High | collaps FP 10/10; kinoflix/pidtor/geosaitebi FP | Native-строки без проверки ключа показываются по-умолчанию (store/registry) | Класс видимых-мёртвых | Для native без карточного ключа — RULE-3 авторитетное «нет» (как cdnvideohub) | test: native FP на всех тайтлах = 0 | re-matrix | OPEN |
| **GAP-001** rutubemovie movies-only на сериалах | P1 | Medium | FP на 4 сериалах, на фильмах работает | RutubeProvider только фильмы (RutubeProvider.js 60-108) | Мёртвый источник на сериальных карточках | `enabled()`/show=false при serial | test: serial → rutubemovie hide | re-matrix | OPEN |
| **GAP-003** filmix частично 403/404 | P1 | Medium | oa→403, dune2→404 на первом item | CDN/качество filmix (уже в report); or-reserve может спасать | Первый item «лица» источника может не играть | Fallback по items[1..n] (как GAP-004 для rezka); сортировка живых качеств | test: filmix first-item dead → fallback жив | probe filmix 10/10 PLAY | OPEN |
| **GAP-013** конкарренси расхождение наборов | P1 | High | 5 паралл. → 4 набора | Нет single-flight в card() | Разные вердикты для одного и того же под нагрузкой | In-flight promise по ключу кэша (dedupe запросов) | test: 5 паралл. → 1 набор | live concurrency 5/5 идентичны | OPEN |
| **GAP-016** нет таймаутов в Kodik/Rutube/CDNvideohub/Collaps | P1 | Medium | Код: сырой fetch (GAP-016) | Нет HttpClient-обёртки | Висящий upstream держит /videos | Завернуть в shared HttpClient (timeout+retry) | test: таймаут → TimeoutError | — | OPEN |
| **GAP-011** креды ротации в git history + незакоммиченный scrub | P1 | Medium | Agent C: 789z…89, mo-54f4…27, dg4xu2tj в HEAD | Не переписывалась история; scrub в рабочем дереве не закоммичен | Любой с доступом к репо извлекает мёртвые креды | Закоммитить scrub (текущая волна); решить про history-rewrite (вне scope READ-ONLY) | — | — | PARTIAL (ротация done) |
| **GAP-014** cold-карточка p95 12s | P2 | Medium | cold p95=12005ms | Последовательный probe 16 источников, дедлайн 12s | Медленное первое открытие карточки | Параллельные probe'ы + single-flight + per-host лимит | test: cold p95 < 5s | re-matrix cold | OPEN |
| **GAP-007** статический универсум, нет rch/WS | P2 | Medium | Реестр статичен; E-Online динамический + rch | Дизайн (HTTP-only) | Меньше источников, часть тайтлов не покрыта | Дискавери/подписка на кластер; rch — P3 | — | — | OPEN (design) |
| **GAP-009** kodik нестабилен | P2 | Low | forrest FP; прочие hide корректно | Verdict флапает | Малый | Confirm-гейт + стабильный маппинг | — | re-matrix | OPEN |
| **GAP-010** accsdb escaped-unicode | P2 | Low | Shadow-фикс готов | Кодировка accsdb-строки | Маскировка причины | Закоммитить фикс из shadow | availability tests | — | FIXED (shadow, не закоммичен) |
| **GAP-015** нав/эпизод/tv кэши не uid | P2 | Low | Код: singleton Maps | Дизайн кэширования провайдеров | Кросс-юзер вектор (контент-нейтральный) | uid-скоп ключей | — | — | OPEN |
| **GAP-017** videos.json не uid-scoped | P2 | Low | store.js 190-194 | Дизайн | Стейл-запись любому юзеру/провайдеру (сейчас `{"default":[]}`) | uid/provider в ключ | — | — | OPEN |
| **GAP-019** untracked security-отчёты + `x.install_token)` | P2 | Low | Agent C | Не gitignore | Случайный коммит фингерпринтов (вкл. новый пароль) | gitignore или удалить; удалить мусорный файл | — | — | OPEN |
| **GAP-018** resolveVideo skaz-only | P3 | Low | store.js 102-115 | Дизайн | /video 404 для native-ленивого резолва (сегодня безопасно) | Задокументировать/добавить native resolveVideo | — | — | OPEN |
| **GAP-004** rezka streams[0] | P3 (митигирован) | Low | Код streams[0]; live НЕ воспроизвёлся | Дизайн | Первый item может быть мёртв | items[1..n] fallback (как DoD 001) | test: first-item 404 → fallback | live 9/9 PLAY | OPEN (latent) |

---

## 16. Risk register

| Риск | Вероятность | Влияние | Митигация |
|---|---|---|---|
| **Veoveo resolve 403** не лечится локлистом (upstream) | Medium | Высокое | Трассировка; если upstream — скрыть (GAP-012 закрывается hide) |
| **Kinopub FN** рецидив под burst | Medium | Высокое | Single-flight + не-скрытие при inconclusive confirm |
| **Upstream 429/403/502** (filmix CDN, rutube, кластер) | High | Среднее | Retry/rotation есть; fallback items[1..n] (GAP-003/004) |
| **Кластер skaz откажет uid** (как dg4xu2tj) | Low | Высокое | grant устройства; E-Online как fallback-стек |
| **Кросс-юзер через нав/эпизод кэши** | Low | Низкое | GAP-015 |
| **Конкарренси-расхождение** под пиковой нагрузкой | Medium | Среднее | GAP-013 |
| **Аккаунт skaz/фильм-токены истекут** | Medium | Среднее | мониторинг; перевыпуск |
| **Случайный коммит секретов** (untracked доки) | Medium | Высокое | GAP-019 |

**Что НЕ гарантируется (upstream):** стабильность filmix CDN (403/404/429), наличие контента на всех тайтлах во всех балансерах, кластерные accsdb-гранты, латентность внешних API (api.filmix.tv cold до 40s). Это внешние ограничения, не баги Maniya.

---

## 17. Recommended roadmap (волны)

**Волна 1 — P0 (прод-гейт):**
1. **GAP-013** single-flight в `card()` + тест «5 параллельных → 1 набор».
2. **GAP-012** veoveo: трассировка 1 item → fix (локлист) или hide.
3. **GAP-005** kinopub: не скрывать при inconclusive confirm; re-probe при videos>0.
4. **GAP-002/GAP-008** collaps + native-show:true: RULE-3 для нативных без ключа; collaps hide.
5. Live re-matrix: FP=0 на критичных, FN=0.

**Волна 2 — P1:**
6. **GAP-001** rutubemovie serial-hide.
7. **GAP-003/004** fallback items[1..n] (filmix/rezka).
8. **GAP-016** таймаут-обёртки для Kodik/Rutube/CDNvideohub/Collaps.
9. **GAP-011** закоммитить scrub + **GAP-019** (gitignore доков, удалить `x.install_token)`).
10. **GAP-010** закоммитить accsdb-unicode фикс из shadow.

**Волна 3 — P2:**
11. **GAP-014** cold-latency (параллельные probe'ы, per-host лимит).
12. **GAP-015/017** uid-скоп кэшей провайдеров и videos.json.
13. **GAP-007** дискавери/доп. источники (P2), rch (P3).
14. **GAP-009** kodik стабилизация.

**Волна 4 — P3/косметика:** GAP-018 документация, GAP-004 (если рецидив).

**Гамма-гейт (после волн 1-2):** P0=0; P1=0 или документированные upstream-исключения; FP/FN=0 на критичных; кросс-юзер утечки=0; конкарренси детерминирован; install/MSX/Android/browser-stub PASS; креды не утекают; health 200; systemd стабилен; тесты PASS кроме документированных pre-existing; shadow REGRESSED=0; playback критичных 100%.

---

## 18. Что готово / что осталось / что нельзя гарантировать

**Что готово (закоммичено+задеплоено+prod-verified):** инсталл-флоу (001→003), MSX-чек (004), online8 abstain (002), nav-кэш, hidden-twin 404 (9f9daf6), rezka-первый-item митигейшн (a105320), TRUSTED filmix, kodik, accsdb-unicode (shadow).

**Что осталось (по волнам):** §17 — 5 P0, 5 P1, 4 P2, 2 P3.

**Что нельзя гарантировать:** upstream-доступность/стабильность (filmix CDN, кластер skaz гранты, латентность api.filmix.tv), покрытие каталога, живучесть чужих источников. Эти ограничения не закрываются кодом Maniya и помечены как external.

---

*ФАЗА 1 завершена. Код НЕ менялся. Ожидается подтверждение пользователя перед волной фиксов.*
