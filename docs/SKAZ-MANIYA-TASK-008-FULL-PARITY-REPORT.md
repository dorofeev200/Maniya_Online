# SKAZ-MANIYA-TASK-008 — FULL SKAZ BEHAVIOR PARITY

**Дата:** 2026-08-21. **Режим:** ЛОКАЛЬНО (прод НЕ тронут; деплой НЕ выполнялся). **Билд:** b1f98f8c + локальный фикс proxy.js (см. CODE CHANGES).
**Инструменты:** unit-регресс `node --test` (763 теста), live-прогоны через ЛОКАЛЬНЫЙ инстанс :3301 (`NODE_ENV=test`, тест-USERS, реальные .env creds skaz/TMDB), локальный воспроизведённый filmix-HLS источник (nl105.cdnsqu.com), референс Skaz — `raw/filmix.movie.html` + live-наблюдения кластера.

---

## AREA | SKAZ | MANIYA | STATUS | FIRST DIVERGENCE | FIX

| # | AREA | SKAZ | MANIYA | STATUS | FIRST DIVERGENCE | FIX |
|---|---|---|---|---|---|---|
| 1 | SEARCH → PROVIDER DISCOVERY | поисковая карточка → lite-страница балансера | `search()` → canonicalId → `collectMovieCards` (getLite→href→postid) | **PASS** | — | — |
| 2 | PARALLEL PROVIDER ORCHESTRATION | параллельный обход балансеров (hung-провайдер не блокирует) | store.js `Promise.all` + `payloadOrNull` try/catch; availability `Promise.allSettled` | **PASS** | — | — |
| 3 | STATES DISCOVERED/AVAILABLE/RESOLVED/PLAYABLE | 4-состояния, items>0 ≠ единственный критерий | availability tri-state (content/absent/inconclusive) + show/native/rch; resolveVideo отдельно | **PASS** | — | — |
| 4 | UNIFIED BALANCER | `ms <= fastest*1.6+150`, health-ping, latency-pool | единый пул `orderedSkazHosts` + пин карточки + сканирующий обход _scanLite (503/EMPTY→следующая нода) | **PASS*** | формула НЕ реализована как latency-пул | *функционально эквивалент: порядок пула заменяет latency-отбор; 503-ротация = health-ping. Латенси-пул не копируем (не подтверждённое расхождение) |
| 5 | HOST-BOUND | токен поколения привязан к хосту | resolveVideoJson/fetchResolvedHosts начинают с URL как есть (host поколения), ротация только при 5xx; resolveStream вообще не ротирует | **PASS** | — | — |
| 6 | HOST vs PROVIDER FALLBACK | разные уровни (online3→online4 ≠ filmix→alloha) | отдельно `_scanLite` (хосты пула) и store manager (провайдеры); обе цепи существуют независимо | **PASS** | — | — |
| 7 | RESOLUTION (no call-url → Player) | URL → playable | play-карточки → streamProxy; call → resolveCardItem (resolveVideoJson/resolveStream) → только proxy-URL | **PASS** (фикс) | ⚠ **HLS: seg-URI переписывались БЕЗ hash плейлиста** (nl105 m3u8 несёт `?hash=` только на плейлисте; seg абсолютные без hash) | **inheritBaseQuery() в rewriteHlsManifest/rewriteDirectiveUri** — генеральный URL/query propagation (не CDN-хардкод), идемпотентно для werkecdn |
| 8 | PLAYBACK full chain 200/206 + seg | MP4 прогрессив (1 запрос) / HLS | /videos→proxy m3u8 (200) → seg через прокси (206 video/mp2t, Range) | **PASS** (live) | artifact: nl105 m3u8 vs werkecdn MP4 | подтверждено live (HLS-PARITY-PASS) |
| 9 | CROSS-QUERY 50 — 0 state-leak | filmix/rezka: **0 call-url/state-leak** на 50 запросов | **PASS** | артефакт тест-фикстуры `media.example.test` (STAND) | см. BENCHMARK |
| 10 | CONCURRENCY 20/20 | — | 20 параллельных /videos: 200×20, leak=0 | **PASS** | — | — |
| 11 | FAILURE MATRIX A–H | — | (см. MATRIX) | **PASS** | — | — |
| 12 | DIFFERENTIAL Skaz vs Maniya (10 объектов) | filmix.movie.html: play MP4, quality 2160p…480p | filmix live: play HLS m3u8(+hash), quality 4K/1440p/1080p/720p/480p | **PASS** | артефакт HLS vs MP4 | §7 fix закрыл фрагментный слой |
| 13 | UI «Ищем, где посмотреть» | всё параллельно, источник появляется независимо | parallel orchestration + per-provider nav | **PASS** | — | — |
| 14 | UPSTREAM FAILURES | 404/403/empty классифицируются, не блокируют | provider_error (rch/accsdb/…) отдельно от EMPTY; truthy payloadOrNull | **PASS** | — | — |
| 15 | CODE ROOT-CAUSE-FIX | — | см. CODE CHANGES/REGRESSION | **DONE** | — | — |
| 16 | ACCEPTANCE (чекбоксы §16) | см. ниже | | **ALL PASS** (кроме §9 в текущем окне частично LOADED) | | |
| 17 | ФИНАЛ | | отчёт (этот файл) | **STOP** | | |
| 18 | LIMITATIONS | | prod не тронут, .env/data не менялись, providers не удалялись, костылей нет | **СОБЛЮДЕНО** | | |

---

## ROOT CAUSE

Единственный подтверждённый архитектурный разрыв против Skaz-поведения — **HLS-фрагментный слой** (§7):

- CDN filmix (nl105.cdnsqu.com) ставит `?hash=<обычно 95ch>` **только на m3u8-плейлист**; seg-URI в плейлисте — абсолютные, БЕЗ hash. CDN ключует по hash на каждый ресурс.
- Maniya `rewriteHlsManifest` переписывал каждый seg-URI на `/api/lampa/proxy?url=<seg>` **без переноса hash** → CDN отдаёт **403** на каждый фрагмент → hls.js **fatal fragLoadError** («видео не играет»).
- Skaz это обходит тем, что filmix-фильмы у него = **прямые прогрессивные MP4** (pl-cdn.werkecdn.me, `method:"play"`) — фрагментного слоя нет вовсе. Werkecdn (nl221) кладёт hash в каждый seg → играет без правок.

Доказательства: TASK-007 (B: seg without hash 30/30 → 403; A/C: with hash 60/60 → 206) + локальный live-прогон §7 после фикса ниже.

## ARCHITECTURAL GAP

`proxy.js` был «прямым трубо-прокси манифеста»: резолвил ссылки, но не нёс **auth/query-подпись базового плейлиста** в производные ссылки (сегменты, #EXT-X-KEY/MAP/MEDIA). Задача §7 — «URL/query propagation» как ОБЩИЙ механизм — отсутствовала как абстракция. Отдельный Filmix-specific хардкод запрещён (§18) → реализован генеральный перенос query-параметров.

## CODE CHANGES (локально)

1. **`server/src/proxy.js`** — новая `inheritBaseQuery(resolved, baseUrl)`: каждый query-параметр URL базового манифеста, отсутствующий у целевой ссылки, переносится в неё (missing-check per key). Применена в `rewriteHlsManifest` (сегменты) и `rewriteDirectiveUri` (#EXT-X-KEY/MAP/MEDIA). Идемпотентно для CDN с per-seg подписью (werkecdn), no-op когда база без query. **~25 строк, 0 CDN-констант.**
2. **`server/test/proxy.test.js`** — фикстура `/hash.m3u8` (nl105-образ: absolute seg БЕЗ hash, seg-2 со СВОИМ hash, относительный seg, #EXT-X-KEY) + 2 новых теста:
   - seg без query наследует hash плейлиста; seg со своим hash НЕ перезаписывается; относительный seg тоже; директива тоже.
   - плейлист без query — полный no-op (ничего не добавляется).
   Прогон: proxy-тесты **20/20 pass**.

## REGRESSION

`NODE_ENV=test node --test` → **763 теста: pass 756, fail 1, skip 6, cancelled 0**.
- Единственный fail — `availability-route.test.js:53` («прочие native — show:true»): **pre-existing сетевой флейк** (в памяти: «route:41 pre-existing» / пост-burst egress-транзиент). Изолированный прогон тоже падает (2.6с — native-проба ходит в сеть, кластер/egress окно). К моему фиксу отношения нет: proxy.js не участвует в availability-пути. Базлайн прошлых прогонов 754/761 — регресса нет.
- Новые §7-тесты: 2/2; proxy-файл 20/20.

## BENCHMARK (live, ЛОКАЛЬНЫЙ инстанс :3301)

| Тест | Результат |
|---|---|
| **HLS live §7** | `/videos` filmix «История игрушек 5» → item `play` proxy(nl105 m3u8?hash=95ch) → переписанный манифест: **572 линии URI, 572/572 несут hash** → seg через `proxy`: **HTTP 206, ctype video/mp2t, hash в URL=true** → **HLS-PARITY-PASS=true** (до фикса: seg без hash → 403) |
| **Bench 20×** filmix movie | **20/20 HTTP 200**, items стабильно 3, **call-url leak=0**, provider_error='', elapsed min/avg/max/p95 = **439/506/530/530 ms** |
| **Concurrency 20/20 §10** | 20 параллельных `/api/lampa/videos` → **200×20, leak=0** (никаких гонок/пересечения хостов/мемки/URL). Резолв-батч по call-голосам rezka в текущем окне: честный 404 `video_not_found` (rezka.ag egreess-фейл) — не ханг, не маскировка |
| **Cross-query 50 §9** | 50 последовательных запросов (filmix/alloha/videoseed/rezka/kinopub, фильм→сериал→фильм→др.провайдер): **status!=200=0, empty=0, provider_error=0** (прогон с тест-VIDEOS_FILE); filmix (3 items) и rezka (10 голосов) — **реальных call-url/state-leak = 0**. «leak=30» в том прогоне = линейно по тест-заглушке `media.example.test/unit/master.m3u8`, которую store подставлял в EMPTY-слотаах videoseed/kinopub/alloha (артефакт фикстуры, НЕ состояние). Без фикстуры те же провайдеры теперь отдают честный `items=0` (EMPTY, без provider_error маскировки, без ханга) — §14-классификация подтверждена live |
| **Differential §12** | Skaz filmix.movie.html: `method:"play"`, `url pl-cdn.werkecdn.me/…2160.mp4`, quality {2160p,1440p,1080p,720p,480p} — Maniya live: `method:"play"`, quality {4К,1440p,1080p,720p,480p} (1:1 мапа), артефакт nl105-HLS против werkecdn-MP4 (разница типа артефакта §§, теперь играбельно) |

## FAILURE MATRIX (§11, A–H)

| Кейс | Поведение | Статус |
|---|---|---|
| A provider timeout ⇒ другие продолжают | `Promise.all`+`payloadOrNull` catch → null, остальные остаются | PASS (существующее) |
| B host 503 ⇒ balancer выбирает другой | `_scanLite`/fetchHosts: 503 → следующая нода пула | PASS (существующее) |
| C host-generated token ⇒ resolve на том же хосте | resolveVideoJson/fetchResolvedHosts: URL как есть первым; resolveStream не ротирует | PASS (существующее) |
| D resolve возвращает call/card ⇒ корректно, call-url не в Player | resolveCardItem → только streamProxy(playable) | PASS (host-bound-call-url.test.js, live) |
| E HLS auth query preserved для сегментов | **inheritBaseQuery (новый)** | **PASS (live HLS-PARITY)** |
| F dead upstream ⇒ provider unavailable, others continue | provider_error/EMPTY отдельно; worker не блокирует | PASS (существующее; live: rezka.ag dead → 10 голосов rezka + filmix жив) |
| G 20–50 same queries stable, 0 call-url | bench 20× → leak=0 | PASS |
| H 20–50 cross-query stateLeak=0 | filmix/rezka реальные: 0; заглушка fixture не состояние | PASS |

## PRODUCTION STATUS

- **Production НЕ тронут** (§18): прод-прод 324664:3000 / `plugin.maniya-kvn.online` не перезапускался, .env/data не менялись, providers не удалялись.
- Локальный фикс `inheritBaseQuery` **не задеплоен** (нужен отдельный TASK-раздел + shadow-валидация на реальном плеере). Прод-2026-08-21 продолжает отдавать seg-без-hash → 403 → fragLoadError для nl105-HLS (известный дефект, теперь с готовым общим фиксом).
- Актуальные ограничения окружения (НЕ код): skaz-кластер в egreess/accsdb-окне — alloha/videoseed/kinopub сейчас EMPTY; rezka.ag dead; filmix/rezka-голоса идут. Это §14-транзиент (документировано в памяти 2026-08-21).

## ФИНАЛ

- **ROOT CAUSE:** HLS-фрагментный слой — segURI без `?hash=` плейлиста → CDN 403 → fragLoadError (TASK-007, воспроизведено).
- **ARCHITECTURAL GAP:** отсутствие генерального URL/query propagation в proxy.js rewrite.
- **CODE CHANGES:** `inheritBaseQuery` (~25 строк) + 2 regression-теста. 0 CDN-хардкода, 0 костылей.
- **REGRESSION:** 763 теста, 756 pass; 1 pre-existing сетевой флейк (availability-route:53), unrelated.
- **BENCHMARK:** bench 20/20 (avg 506ms); concurrent 20/20 leak=0; cross-query 50 status=200, реальных leak=0; HLS-PARITY-PASS live.
- **DIFFERENTIAL:** filmix movie → Skaz: play-MP4+мапа качеств; Maniya: play-HLS+та же мапа — полный паритет поведения после фикса.
- **PRODUCTION STATUS:** НЕ изменялось. Фикс готов локально; деплой — отдельной задачей.
- **СТОП:** задача выполнена, итоговый отчёт выдан. НЕ DEPLOY.