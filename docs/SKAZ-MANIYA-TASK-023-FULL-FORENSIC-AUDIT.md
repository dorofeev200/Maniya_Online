# TASK-SKAZ-MANIYA-023 — FULL SKAZ/LAMPA/BALANCER/PLAYBACK FORENSIC AUDIT

> READ-ONLY аудит. Код/прод/deploy НЕ менялись. Прод-дерево `8fc18753/76` нетронуто.
> Evidence: `docs/t023/probe.json`, `docs/t018/*`, `docs/t019/*`, `docs/t021/*`, `docs/t022/*`,
> `docs/skaz-architecture.md`, shadow-лог `/tmp/t022-shadow/server.log` (VPS).
> Дата: 2026-08-22. Статус в §30.

---

## 1. Executive Summary

- SKAZ = **Lampac-совместимый кластер** `skaz.tv/lite/*`. Никакого промежуточного API нет:
  «SKAZ-плагин» = тонкий браузерный клиент поверх кластера. (доказано: `docs/skaz-architecture.md`, живые GET)
- Пер-тайтл модель источников кластера — **`lite/events`** → JSON `[{name,url,index,show,balanser,rch,voices,seasons}]` (T018-21, 6 нод). Это и есть «новый balancer» (см. §5).
- Discovery глобального списка balancer'ов — **`lite/withsearch`** → JSON из **34 slug** (свежий probe 337ms, §5). **Наш `SkazClient` его не вызывает** — использует статический список 18 + per-title события.
- Авторизация кластера: жёсткая пара `account_email` + `uid` (accsdb), обязательная; `Origin: http://lampa.mx` на манифесты. `X-Kit-AesGcm`/`memkey` НЕ нужны для `lite/*` (доказано E2E).
- **Server-JSON параритет Maniya↔SKAZ подтверждён**: ядро карточки вербатим (порядок/имена/индексы/rch/voices/seasons), единственное структурное отличие — Maniya-only extras в хвосте (A/B, 4 карточки, 0 диффов ядра).
- **UI/runtime параритет НЕ подтверждён**: без Web Lampa DevTools невозможно сравнить runtime source-объекты и рендер чипов. Это MISSING EVIDENCE (§22, §30).
- Итоговый статус: **AUDIT INCOMPLETE — MISSING EVIDENCE** (конкретный список доказательств — §30).

## 2. Current Architecture (Maniya T021, факт)

```
Lampa UI ─▶ maniya-online.js (тонкий клиент, /api/lampa/*)
             ├─ /api/lampa/sources          → статический реестр 21 (натив+skaz)
             ├─ /api/lampa/sources/card     → sourceModel.card() (lite/events, кэш 60с+single-flight,
             │                                 кэп min(10с*N,12с); fallback → probe-path) [модель T021]
             ├─ /api/lampa/videos?provider= → store → провайдер (native | skaz-<slug> эфемерный)
             │                                 → streams() → StreamItem[] → player
             └─ /api/lampa/proxy             → CDN через allowlist (SSRF-гейт, Origin lampa.mx)
Availability: probe-волны (TTL 5мин, negative HIDE_TTL 60с, single-flight, pinMap) — service /sources/card
             в probe-fallback режиме; в model-режиме кластерный `show` является авторитетом.
CW: клиентский localStorage (манiя_* + Lampa Rs.history/SISI). Серверного watch-history нет (прод 404) — эквивалент по построению.
```

## 3. SKAZ Client Architecture (про то, что называли «E-Online»)

- «E-Online»/SKAZ-плагин — браузерный клиент поверх кластера: ротация хостов, discovery `lite/withsearch`, пер-тайтл `lite/events`, разворачивает карточки `method:play|call|link` → поток, RCH по `{"rch":true}` (WS).
- Auth-вставка в каждый URL: `account_email` (хардкод) + `uid` (`Lampa.Storage lampac_unic_id`) — доказано teardown 09.08.
- Обфускация: string-table, decoder (checksum 0xf3481), 1236 строк деоба — итог в `skaz-architecture.md`. **Текущую версию plugin.js для runtime-сравнения не извлекли** (LevelDB Snappy-сжат) → детали клиентского трансформинга = **INCONCLUSIVE** (§22).

## 4. SKAZ Backend Architecture

```
GET {host}/lite/withsearch?account_email&uid          → [34 balanser-slug]   (discovery, 337ms live)
GET {host}/lite/events?<cardParams>&account_email&uid → JSON [events]        (пер-тайтл sources)
GET {host}/lite/<balanser>/movie|serial?...           → HTML data-json       (карточки play/call/link)
GET {host}/lite/rezka/movie.m3u8?...&play=true        → 302 voidboost        (hls)
GET {host}/lite/... → proxy/?url=                      → fallback-прокси     (online8)
auth: accsdb проверяет пару email↔uid; без пары → 200 + {"accsdb":true}
Origin: http://lampa.mx (обязателен на манифесты)
Хосты: пул [online3, online8, 94.249.239.{63,37,11}, 77.90.33.109]; нодная вариация событий = инфра-особенность.
```

## 5. New Balancer (discovery)

| Вопрос | Ответ | Evidence |
|---|---|---|
| Где обнаруживается | `GET HOST/lite/withsearch` | live 200 теперь (337ms, len=356) |
| Что возвращает | JSON-массив slug (34: kinotochka…vkmovie, incl. `rc/filmix`,`rc/fxapi`,`rc/rhs`; lumex×2) | `docs/t023/probe.json` |
| Когда вызывается | плагином при инициализации (по doc 09.08); на каждую карточку — **нет** (пер-тайтл через `lite/events`) | skaz-architecture §6.7 |
| Вызывает ли Maniya | **НЕТ** — статика 18 (`config.skaz.balancers`) | config.js:232, SkazClient |
| Практическое следствие | 34>18: новых slug (kinobase, kinoukr, redheadsound, anime*, rc/*) у Maniya **нет в discovery**, но в событиях карточек они отсутствуют → на контрольных карточках расхождения не видно; при новых тайтлах могут появиться | t018/t021 fixtures |

Сам «новый balancer» (пер-тайтл) = `lite/events`. Контракт записи сводится к `{name,url,index,show,balanser,rch,voices,seasons}`; `index` — порядок, `show` — доступность источника **решает кластер**, клиент только рендерит.

## 6. Source Discovery (по карточке)

`Maniya`/`SKAZ` одинаково: card → `lite/events` (параметры id/imdb_id/kinopoisk_id/title/original_title/serial/year/source=tmdb). Разница:
- SKAZ-плагин берёт URL source из `events.url` (кластерный `lite/<balanser>`).
- Maniya сохраняет `url` как поле, но клиенту отдаёт `api_url=/api/lampa/videos?provider=<id>` (id = native | `skaz-<slug>`). → **два разных пути воспроизведения** (см. §10, §25).

## 7. Source UI (runtime-сравнение) — MISSING EVIDENCE

Что доказано:
- Lampa строит чипы источников из массива runtime `sources[key] = {name, show, ghost, index, …}`; «Ещё N» — из `show===false` (ghost), «Сортировать» — штатный `Lampa.Lang title_filter`, «Видео не найдено» — штатное сообщение при пустых videos.
- Maniya model-ветка (public/maniya-online.js 512-555): детект `'index' in row` → upsert `{name,index,show,ghost,voices,seasons,url:row.api_url||row.url}`; сохраняет ghost; activeSource=stored||shown[0].
- Что НЕ сравнено: runtime-объекты SKAZ-плагина (поля/число), порядок рендеринга чипов, иконки. → **INCONCLUSIVE**, нужен DevTools Web Lampa (§22).

## 8. Availability

- SKAZ: авторство решения «источник доступен» = **кластер** (поле `show` в событиях; эмпирически живой). Клиент не пробует (в событиях уже итог).
- Maniya: две независимые системы:
  1. probe-подсистема (availability.js): волны, TTL 5 мин, negative=60с, single-flight, pin; работает в probe-fallback режиме и для Maniya-only extras;
  2. model-режим: `show` из кластера — авторитет (проверки не дублируются). Отличий на сервере нет; клиентский timeout одинаковый (окно 15с).
- Filmix-invariant: `id==='filmix' && nativeEnabled → show=true` (не прятать из-за macOS/false-negative) — осознанный, не регрессия.

## 9. /videos (одинаковая карточка)

| Метрика | SKAZ-клиент | Maniya |
|---|---|---|
| URL | кластерный `lite/<balanser>/...` (прямо из events.url) | `/api/lampa/videos?provider=<id>` (наш сервер) |
| Провайдер | slug события | id= native | skaz-<slug> → `lite/<balanser>` внутри |
| Голоса/seasons | карточка data-json | voices()/seasons() провайдера |
| Auth/headers | account_email+uid в URL, Origin | у нас creds добавляет SkazClient |
| Секреты в логе | — | запись не ведётся |

`/videos` запрос TV зафиксирован (shadow-лог 19:57-19:59, 200 511-1384ms) — провайдер/карточка по логу неопознаваемы (нет query).

## 10. Provider Resolution

| SKAZ-источник | Maniya провайдер | Тип |
|---|---|---|
| kinopub/filmix/rezka/alloha/videoseed/veoveo/hdvb/rutubemovie/vkmovie/kodik/collaps/kinotochka|zagonka | native (зарегистрированы, свой videos) |
| +zetflixdb/xvideocdnultra/... прочие slug событий | `skaz-<slug>` эфемерный провайдер → `lite/<balanser>` | ephemeral (не в registry) |
| `rc/*` (RCH-варианты) | rchRegistry (клиент RCH) | RCH-слой |

Отображение «slug события ↔ id» = **ядро параритета** (T018/021 basеline). Kodik/Collaps = native Maniya-only extras (всегда в хвосте model, index=null).

## 11. Playback

- Доказано локально (T021 §5): kinopub movie мастер→рендиция→сегмент 200 MP2T; rezka голос→play→сегмент; videoseed 9 play; veoveo 1080p; rutube; kodik fixture; filmix = UPSTREAM/EGRESS (без кредов).
- TV: реальные play-сессии в shadow-лог не завершены (нет proxy-REQ на CDN-сегменты из-за действий пользователя; надо P3/P4 на TV).
- **HTTP 200 сегмента ≠ картинка/звук** — подтверждение только на TV (P3-P6).

## 12. HDRezka (старый симптом «шипящая картинка»)

- Серверно (T021): rezka voice→play→segment 200/254ms, chain работает; симптом «картинки» был снят в T019C/T021 (правильный player/разрешение). 
- Кодеки/mime/TV-рендер на живом TV не проверены → **P4 ОЖИДАЕТ TV** (videos→voice→resolve→manifest→video+audio→seek). При неудаче — FIRST DIVERGENCE с этапом.

## 13. Filmix

- Без FILMIX_TV creds: кластерный `lite/filmix` работает (карточки), нативный api.filmix.tv канал — 403 hasAuth:false (shadow-лог 19:57:53) → **категория H (upstream/egress)+G(auth-отсутствие)**, НЕ дефект Maniya.
- С creds (прод T010/T015) — 206, 0×403. Классификация всех 403/429/egress — по матрице категорий (§18), не «баг».

## 14. Serial / For Serial

- Дом Дракона: model-driven, сезон/серия/голоса отдаются (drake serial показатели: events несут seasons; /videos serial id — T021). TV-проверка — P5.
- «Сериал, который Maniya не находит»: **не назван** пользователем → F-search пункт INCONCLUSIVE. Первое расхождение искать по search→card→serial=1→sources→voices→seasons→episodes→resolve, останавливаясь на нём; НЕ чинить.

## 15. Search

- `lite/fsearch` → **404** (live) — search-эндпоинт кластера не fsearch. Как SKAZ-плагин ищет (Lampa catalog через источник? свой endpoint?) — **UNKNOWN** (нужен Web Lampa).
- Maniya: поиск идёт native (TMDB/каталог Lampa), карточка → sourceModel. Симптом «For Serial ничего не находит» — сравнить на конкретном сериале (P5).

## 16. Continue Watching

- Сервер: продолжений НЕТ (прод cluster /lite/{viewed,history,...} → 404). CW = клиентский `Lampa.Storage` + SISI `Rs.history`/timecode (T021 P-PW; reference Lampac без модуля истории).
- Maniya-плагин трогает только `maniya_*`, не пишет `view_*` → эквивалент по построению; реальное поведение TV (фильм+S01E01, play→exit→reopen→continue) — **P6 ОЖИДАЕТ TV**.

## 17. TV Evidence (дополнительное)

- Shadow-лог 19:57-19:59: install-link → subscription/check → /sources → /sources/card (200; 4/178/3317ms — последний свежий events-фетч ≪15с окна) → /videos (200). IP 178.173.126.235 = home-egress бокса; UA/query в логе нет → «это TV» по логу недоказуемо, только как связка «пользователь жалуется/подтверждает с экрана» (§22 правила). Filmix-предупреждения = EGRESS/UPSTREAM.

## 18. Web Lampa Evidence — MISSING EVIDENCE (обязательная, не заменяется headless)

Что нужно (DevTools):
1. Network: последовательность запросов SKAZ-плагина на карточке (endpoint/парам/URL) и Maniya на той же карточке — sanitized HAR.
2. Console `sources` runtime dump (Lampa.Select state) для обеих: поля каждого source (name/index/show/ghost/url/api_url/icon/voices/seasons) и `filterSources`.
3. Скриншоты чипов «Источник»/«Ещё N» для 4 карточек.
4. `/videos` + resolve для KinoPub/HDRezka/Alloha/VeoVeo — URL/метод/тело (секреты не сохранять).

## 19. SKAZ vs Maniya Differential (доказанное)

| Этап | SKAZ | Maniya | Совпадение |
|---|---|---|---|
| card.json (сервер) | events | model = events verbatim | ✅ (0 diff ядра) |
| extras | нет | native extras в хвосте (index=null) | документированное отличие |
| discovery | withsearch (34) | статика (18) | отличие конфигурации |
| source.url для воспроизведения | кластерный | api_url → наш /videos | сознательное отличие |
| availability | кластер show | probe+кластер show | совместимо |
| search endpoint | UNKNOWN | native catalog | MISSING EVIDENCE |
| runtime объекты | UNKNOWN | modelMode (поля выше) | MISSING EVIDENCE (Web Lampa) |

## 20. FIRST DIVERGENCE Matrix

| Problem | SKAZ | Maniya | First Divergence | Root Cause | Fix? |
|---|---|---|---|---|---|
| Source UI chips | события → чипы | model → чипы | runtime-объект (не подтверждён) | надо Web Lampa | собрать evidence |
| Source order / first | кластер order, KinoPub #1 | тот же order | **нет расхождения на сервере** | — | — |
| ghost / Ещё N | show:false | ghost:!show сохранён | нет (Lampa ghost) | — | — |
| Сортировать/Видео не найдено | штатный Lampa | штатный Lampa (пустоvideo) | не источник-модель | UID/данные | проверить на TV |
| Availability | кластер | probe+кластер | нет (show кластера доверен) | — | — |
| Balancer discovery | withsearch 34 | статика 18 | **withsearch не вызывается** | config/discovery | потом синхр-ть |
| Filmix | карточки кластера | 403 без creds | auth/egress | нет FILMIX_TV creds | creds (не код) |
| HDRezka | voice→hls | та же chain | **нет** (серверно работает) | — | TV P4 |
| Alloha | dynamic token_movie | native alloha | — | — | TV P7 |
| Serial search | UNKNOWN | native catalog | MISSING EVIDENCE | — | user: назвать сериал |
| Seasons/Episodes | data-json | voices/seasons провайдера | — | — | TV P5 |
| Playback | cluster→player | /api/lampa/proxy→player | — | — | TV P3 |
| Continue Watching | клиентский | клиентский (эквивалент) | нет по построению | — | TV P6 |

## 21. T019 Reassessment

- sourceModel построена по `lite/events` контракту, поля вербатим (проверено на 4 карточках/6 нод) — **предположение подтверждено на серверном уровне**.
- Неполнота возможна в: (а) `icon`/quality для эфемерных `skaz-<slug>` (берём meta по slug — Lampa-совместимо, но не доказано = как иконки у SKAZ-плагина); (б) runtime `url` vs `api_url` (сознательное отличие, влияет на сетевую топологию, не на UI). → частично INCONCLUSIVE без plugin.js.

## 22. T021 Reassessment

- «Единственное структурное отличие — Maniya-only extras» — **справедливо для серверного JSON** (A/B ab2: ядро вербатим, extras в хвосте). 
- **НЕ подтверждено для UI/runtime**: сравнение runtime-объектов и рендера чипов не производилось. Фиксация: вывод сузить до «server-JSON parity подтверждена; UI-parity — MISSING EVIDENCE».

## 23. T022 Reassessment

- `/sources/card → 200` = доказательство того, что model-путь отвечает в окне (<15с), НЕ параритета UI/playback. **Согласны**: 200 не является полным доказательством — только тайминг-ворота закрыты.

## 24. Root Causes (установленные)

1. **Серверная data-модель** — совпадает (RCA нет). 
2. **Discovery**: Maniya не использует `lite/withsearch` (нет реактивной синхронизации новых источников) — RCA конфигурации, влияние низкое (контрольные карточки не затронуты).
3. **Путь воспроизведения**: SKAZ-клиент идёт на кластер напрямую (url), Maniya — через свой /videos+proxy. RCA = архитектурный выбор; влияет на доступность/авторизацию, а не на состав UI.
4. **Клиентские UI-различия** — не установлены (MISSING EVIDENCE Web Lampa).
5. **Auth Filmix** — отсутствуют FILMIX_TV creds в shadow → H+G.

## 25. Required Architecture Changes (ПЛАН, НЕ реализуется сейчас)

1. (опц.) Динамический discovery: периодический `lite/withsearch` → актуализировать `config.skaz.balancers` (без ручной правки списка 18).
2. (исследовать) Сравнить сетевую топологию /videos: нужны ли прямые cluster-url для эфемерных источников, или стандартный proxy-путь достаточен.
3. (план после evidence) Выровнять runtime-поля с реальным SKAZ-плагином (иконки/quality/порядок) — по данным Web Lampa.

## 26. Exact Maniya Files That Must Change (когда план будет одобрен)

- `server/src/config.js` — dynamic discovery-синхронизация (скоп 1).
- `server/src/sources/sourceModel.js` — по итогам §21(b)/§22 (если расхождение подтвердится).
- `public/maniya-online.js` — по итогам §22 (runtime-поля).
- (никаких изменений до утверждения плана)

## 27. Files That MUST NOT Change

- Прод: `/opt/maniya-online/**`, `.env`, nginx, DNS, users.json, videos.json, Telegram/платежи/data.
- `server/src/providers/**`, registry, availability, proxy.js — реализация поставщиков (по HARD CONSTRAINTS 023).
- Lampa UI (вне нашей зоны).

## 28. Test Plan (аудит-предложение)

1. Web Lampa DevTools HAR+sources-dump (SKAZ и Maniya, те же 4 карточки) — обязателен.
2. TV-прогон P2-P7 (022): UI parity, ≥3 фильма playback, HDRezka визуал, сериалы, CW, матрица источников.
3. По результатам — точечные серверные тесты (sourceModel icon/order) только после плана.

## 29. Production Risk

Ноль по этому аудиту: READ-ONLY. Изменений не внесено; деплой/restart не выполнялись.

## 30. Final Recommendation & Status

**FINAL STATUS: AUDIT INCOMPLETE — MISSING EVIDENCE.**

Что конкретно делает SKAZ, чего сейчас не делает Maniya (по уровням):
- **CLIENT**: SKAZ-плагин сам ходит в кластер (events/url) и рендерит чипы со своим набором runtime-полей; Maniya — тонкий клиент через /api/lampa/*. Детали рендера — **UNKNOWN без plugin.js/Web Lampa**.
- **BACKEND**: кластер SKAZ отдаёт по-тайтл события + discovery; Maniya-сервер — свой API поверх того же кластера. ✅ эквивалентно на уровне данных.
- **BALANCER**: SKAZ discovery=`lite/withsearch` (34), Maniya=статика 18 без вызова withsearch — **отличие конфигурации (не UI)**.
- **SOURCE MODEL**: ✅ вербатим (events) на сервере; runtime-поля — MISSING EVIDENCE.
- **AVAILABILITY**: кластерный `show` доверен обеими сторонами; Maniya добавляет собственный probe-слой. ✅ совместимо.
- **PROVIDER / RESOLVE / PLAYBACK / SERIAL / CW**: серверные контракты совпадают (T021); визуальное/фактическое воспроизведение — ждёт TV/Web Lampa (022 P3-P6).

**Нужны (минимум для AUDIT COMPLETE):** (1) Web Lampa DevTools: HAR + runtime `sources`/`filterSources` dump + скриншоты чипов для 4 карточек (SKAZ и Maniya Shadow); (2) название «не находящегося» сериала; (3) TV-прогон 022 P2-P7; (4) опционально — наличный обфусц. plugin.js для сверки клиентских трансформаций. До этого вердикта по UI/playback нет; ACCEPT невозможен.