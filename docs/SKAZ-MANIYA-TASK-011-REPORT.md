# SKAZ-MANIYA-TASK-011 — READ-ONLY DIFFERENTIAL: SKAZ ↔ PRODUCTION MANIYA

**Дата:** 2026-08-21. **Тип:** READ-ONLY investigation. **Изменения кода/конфиг/.env/VPS/PROD:** НЕТ.
Харнесс: `scripts/_t011_diff.mjs` (только GET-запросы). Проверено: Maniya prod `https://plugin.maniya-kvn.online` (token активного юзера) + прямой кластер `lite/*` с теми же params (Maniya buildUrl), аккаунт из server/.env.

## 1. КОНТРОЛЬНЫЙ НАБОР (6 тайтлов)

| key | title | год | тип | почему |
|---|---|---|---|---|
| toystory5 | История игрушек 5 | 2026 | m | прод-hls-эталон (filmix nl105), высокая латентность |
| forrest | Форрест Гамп | 1994 | m | классика, multi-source |
| interstellar | Интерстеллар | 2014 | m | мульти-источник+мульти-хост, native-first Rutube |
| drakon | Дом дракона | 2022 | **serial** | S01E01 |
| parasite | Паразиты | 2019 | m | прошлые HIDE/FP-эпизоды (kinopub), fallback |
| odyssey | Одиссея | 2026 | m | прошлые kinopub/postid-эпизоды, EMPTY/hide |

## 2. EVIDENCE — КЛАСТЕРНАЯ ИСТИНА vs MANIYA (Phase A+B)

Для каждого тайтла: Maniya `/sources/card` (show/hide, avail_ms) + прямой probe каждого подключённого skaz-балансера на всех 6 хостах (checksearch=true). Итог: **0 расхождений show/hide** — каждый показанный источник имеет кластерный content, каждый скрытый — честные 503/403/`null`/200-пусто на всех хостах.

| title | shown (skaz-*) | hidden (skaz-*) | карта |
|---|---|---|---|
| toystory5 | alloha, pidtor, vkmovie, geosaitebi = все content/200 | videoseed, kinopub, kinoflix, veoveo, solntse, rhsprem, zetflixdb, zagonka, xvideocdnultra = все 503/403/пусто | 0 mismatch |
| forrest | alloha, kinoflix, veoveo, pidtor, solntse, vkmovie, geosaitebi = content | videoseed, kinopub, rhsprem, zetflixdb, zagonka, xvideocdnultra = 503/403 | 0 |
| interstellar | alloha, kinoflix, veoveo, pidtor, solntse, vkmovie, geosaitebi = content | videoseed, kinopub, rhsprem, zetflixdb, zagonka, xvideocdnultra = 503/403 | 0 |
| drakon | alloha, veoveo, pidtor, solntse = content/inconclusive(200) | videoseed, kinopub, kinoflix, vkmovie, geosaitebi, rhsprem, zetflixdb, zagonka, xvideocdnultra = 503/403 | 0 |
| parasite | alloha, veoveo, pidtor, solntse, vkmovie, geosaitebi = content | videoseed, kinopub, kinoflix, rhsprem, zetflixdb, zagonka, xvideocdnultra = 503/403 | 0 |
| odyssey | alloha, veoveo, vkmovie, geosaitebi = content | pidtor(200-пусто×6), solntse, kinopub, kinoflix, videoseed, rhsprem, zetflixdb, zagonka, xvideocdnultra = 503/пусто | 0 |

**Жёсткое наблюдение топологии:** только `online3.skaz.tv` жив для подключённых балансеров (content/200 на всех 6 тайтлах, 90–2254ms). `94.249.239.63/.37/.11` и `77.90.33.109` — 503 на ЛЮБОМ балансере/тайтле; `online8.skaz.tv` — легаси 403/503. ⇒ host-selection-дивергенция (SKAZ latency-pool `ms≤fast×1.6+150` vs Maniya пин) на этой топологии **не различаема**: оба де-факто выберут online3 (мёртвые хосты исключает и пул SKAZ, и сканер Maniya).

## 3. EVIDENCE — DISCOVERY (§12): 29 балансеров кластера vs 18 подключённых

`lite/withsearch` (наш аккаунт) → **29** слогов: kinotochka, kinobase, kinopub, lumex, filmix, **filmixtv**, fxapi, redheadsound, animevost, animego, animedia, animebesst, anilibria, aniliberty, rezka, rhsprem, kodik, remux, animelib, kinoukr, vcdn, videocdn, collaps, vdbmovies, hdvb, alloha, veoveo, rutubemovie, vkmovie.

Подключено в Maniya: 18 skaz-балансеров + native-дубли (filmix/rezka/kodik/rutubemovie/hdvb). Не подключено (~18): kinotochka(native есть отдельно), kinobase, lumex, **filmixtv**, fxapi, redheadsound, anime*×6, remux, animelib, kinoukr, vcdn, videocdn, vdbmovies.

**Пробный probe неподключённых на контрольных тайтлах: отдаёт контент только `filmixtv`** на `77.90.33.109`:
- toystory5: content/**2160p**; interstellar: content/**2160p**; drakon: inconclusive(200).

⇒ Единственный измеренный кейс «у SKAZ рабочий источник, а Maniya его физически не имеет» на контрольном наборе = **filmixtv (2160p)** → классификация **B (COVERAGE GAP)**, НЕ баг балансировщика. Остальные неподключённые честно 503/пусто на контрольных тайтлах.

## 4. EVIDENCE — RESOLVE → PLAYABLE (Phase C deep)

| title | источник | /videos | /video | итог |
|---|---|---|---|---|
| interstellar | skaz-alloha | 200, 8 items (6 голосов call) | voice0 → **play 200** (proxy→vkvideo.c…) | **играбельно** |
| interstellar | skaz-veoveo | 200, 1 item play «(1080p)» | play-URL прямой, /video 404 (play без резолва — норма) | **играбельно** |
| interstellar | skaz-pidtor | 200, **0 items** (magnet-дескрипторы фильтруются `isTorrentDescriptor`) | — | показан, не играбелен REST |
| drakon (serial) | skaz-alloha | 200, **10 серий S1**, seasons=3, voices=10, s1e1..s1e6 call | S1E1 → **play 200** (proxy→vkvideo.c…) | **играбельно** |

Мелочи: pditor «shown но 0 items» — известно с TASK-SOURCES-007 (torrent за TorrServer-гейтом = клиентская способность, классификация **C/UPSTREAM**); veoveo `/video` 404 на play-item — эквивалент прямого URL (не баг).

## 5. ЛАТЕНТНОСТЬ (§9)

- Maniya availability (cold, prod): 1754–6262ms на тайтл — доминирует **последовательные probe волны по источникам** (fit: 21 источник × хосты). 
- Кластерный content-ответ по одному балансеру: 90–2254ms (медленный хвост: alloha/партнёры под окном насыщения, odyssey 2254ms).
- /videos показанного источника: 112–1101ms; /video резолв: 757–1283ms (ходит в кластер + CDN-прокси) — «долго думает» = честная цена 2 сетевых хопа на ленивый резолв, не расхождение.
- SKAZ-эталон: та же структура (checkSearch параллельно по источникам + lazy резолв выбранного голоса). Выигрыша/проигрыша по этапам не выявлено — оба получают playable за ≈ один карточный проход.

## 6. КЭШ (§10) / CROSS-QUERY (§11)

Короткий smoke: повторный card parasite через ~1 мин — recalc (cached:false) из-за **HIDE_TTL=60с** для подтверждённых absent (self-heal, дизайн). State-leak не наблюдался (каждый title независим). Закрыто: полный cross-query доказан ранее (TASK-003…008, 50× леак=0) — по §11 короткий smoke достаточен.

## 7. FIRST DIVERGENCE MATRIX

| # | Title | Stage | SKAZ decision | MANIYA decision | First divergence? | Class |
|---|---|---|---|---|---|---|
| 1 | все 6 | Discovery (provider set) | 29 балансеров (lite/withsearch) | 18 подключаемых + native-дубли | **YES — здесь впервые решения расходятся** (набор источников, на котором ищет каждый) | B (не баг) |
| 2 | toystory5/interstellar | Discovery/coverage | filmixtv 2160p на 77.90.33.109 | filmixtv отсутствует (физически не спрашивается) | YES (единственный рабочий-в-SKAZ недоступный-в-Maniya) | B |
| 3 | все 6 | Availability show/hide | кластер-истина (показать всё, что content) | show/hide = кластер-истина 1:1 | NO — 0 расхождений | E |
| 4 | все 6 | Host selection | latency-pool → online3 (остальные 503) | пин/ротация → online3 (остальные 503) | NO (сходятся) | E |
| 5 | все 6 | Selected provider | порядок списока эталона | порядок registry (native-фильмix первым) | Разные «первый», но оба playable-эквивалентны | E |
| 6 | interstellar | Resolve | playable (call→резолв) | playable (call→резолв) | NO | E |
| 7 | interstellar/drakon | Playable URL | vkvideo CDN через масштаб | proxy→vkvideo CDN | эквивалент | E |
| 8 | interstellar | pidtor | magnet→TorrServer (клиент) | 0 items (REST не играет) | YES (показан, но не играбелен) | C |
| 9 | toystory5/interstellar | High-latency | — | — | — | — |

## 8. TOP 5 REAL DIFFERENCES (traceback-подтверждённые)

1. **D1 (B, COVERAGE GAP):** `filmixtv` не подключён — кластер отдаёт 2160p для Истории игрушек 5 и Интерстеллара на 77.90.33.109, Maniya этот источник не запрашивает. Traceback: withsearch→29; Maniya balancers→18; probe→filmixtv content/2160p.
2. **D2 (B, COVERAGE GAP, broader):** неподключены ещё ~17 балансеров кластера (kinobase/lumex/fxapi/anim*×6/remux/kinoukr/vcdn/videocdn/vdbmovies…) — на контрольном наборе пока честно пусты, потенциальный резерв источников.
3. **D3 (C/UPSTREAM):** skaz-pidtor показан (cluster-content) но даёт 0 playable items (magnet-дескрипторы за TorrServer) — не регрессия, документировано.
4. **D4 (E, perf):** топология де-факто 1-хостна (online3) — Мертвые IP-ноды 94.249.*/77.90.33.109 в пуле добавляют 0,5–3с хвостов на scanned-провах скрытых источников (avail_ms до 6с), хотя SKAZ то же самое обходит быстрее локально; сетевой эквивалент, не баг.
5. **D5 (E, UX):** порядок-«первый источник» отличается (native-filmix первый у Maniya vs порядок эталона) при playable-эквивалентности всех показанных.

## 9. VERDICT (§15)

- **Q1** (одинаковые ли решения?): **Да для show/hide и выбора хоста/резолва** — 0 расхождений по availability всех 6 тайтлов; хост всегда online3 у обоих. Расхождения только в **наборе источников** (периметре).
- **Q2** (где FIRST DIVERGENCE?): на этапе **Discovery/provider coverage** (§2: первый шаг цепочки). Конкретно: Maniya не спрашивает `filmixtv`, который кластер сейчас отдаёт 2160p для контрольного filmix-тайтла. Availability/ordering/resolve — совпадают.
- **Q3** (баг Maniya или ожидаемое различие?): **ожидаемое архитектурное** — availability-слой точно воспроизводит кластерную истину; единственный класс расхождения — физически неподключённые балансеры (известный дизайн «подключаем только показанные»). Балансировщик НЕ виноват.
- **Q4** (что из 22 неподключённых даёт различия?): из 29 в withsearch, не подключено ~18; **реально отдаёт контент только filmixtv (2160p)** на контрольном наборе; прочие — 503/пусто (не различия сегодня).
- **Q5** (минимальная следующая задача?): **отдельный TASK: подключить `filmixtv` как skaz-балансер** (гейт: cluster-content probe + OLD∩NEW + smoke; в config.skaz.balancers). По правилам T011 фиксы НЕ выполнялись.

## 10. ROOT CAUSE → EVIDENCE → FIRST DIVERGENCE → IMPACT → MINIMAL FIX PROPOSAL

- **ROOT CAUSE (типа разницы):** Maniya базируется на статически выбранном *подмножестве* балансеров кластера (18), тогда как SKAZ-эталон видит весь набор (29). Расхождения не в принятии решения, а в **объёме запрашиваемых источников**.
- **EVIDENCE:** withsearch=29; sources/Maniya=21; probe: единственный served-unknown = filmixtv content/2160p (toystory5, interstellar).
- **FIRST DIVERGENCE:** Discovery — источник `filmixtv` присутствует в кластере и отдаёт 2160p, в Maniya отсутствует физически.
- **IMPACT:** для тайтлов, где filmixtv — единственный/лучший 2160p-источник, пользователь Maniya видит меньше/без 2160p на этом канале; playability остальных не нарушена (0 регрессий show/hide).
- **MINIMAL FIX PROPOSAL (НЕ выполнялся):** добавить `filmixtv` в `config.skaz.balancers` (или отдельный `skaz-filmixtv` провайдер) + сквозной smoke playable; ожидает отдельного задания.

## ИТОГ: Investigation СПИСАН с критериями §16. Код/конфиг/.env/VPS/PROD не изменялись. Ожидается отдельное задание на исправление (если потребуется).