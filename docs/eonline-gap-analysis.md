# E-Online INVENTORY + GAP ANALYSIS — Maniya Online

Дата: 2026-08-10. Источники: E-ONLINE-REPORT.md §5/§9/§10.1 (карта 23 балансеров плагина),
скан кластера 2026-08-08 (21 балансер `lite/withsearch`), живой REST-пробинг 2026-08-10
(`scripts/inventory-gap-probe.mjs`), E2E через существующий SkazProvider (фильм/сериал).

> Правило честности: HTTP 200 ≠ WORKING. WORKING = реальный end-to-end
> (search → источник → перевод → качество → поток → плеер → воспроизведение).

## 0. Универсум источников

Объединение трёх множеств:

1. **Карта плагина E-Online** (§10.1, 23 слага): kinobase, veoveo, alloha, filmix, videoseed,
   videohub, turboserial, vk, rutube, zagonka, kinopub, hdvb, fancdn, mirage, kodik, fanserials,
   rezka, mirkino, xvideocdn, hdrezka, aniliberty, animebesst, animelib.
2. **Блансеры кластера skaz** (сканирование 08.08 + пробы): filmix, rezka, videoseed, alloha,
   hdvb, pidtor, kinoflix, veoveo, solntse, rutubemovie, kinoteatrkg, geosaitebi, vkmovie,
   aniliberty, kinobase, kinopub, xvideocdn, videohub, turboserial, mirkino, hdrezka (+ collaps,
   vdb, kodik из withsearch-34).
3. **Maniya-native**: filmix, kodik, rezka, alloha, rutubemovie, cdnvideohub (VideoH), collaps,
   hdvb.

Авторизация для всех lite-источников — `account_email`+`uid` в URL (конфигурируемые:
`SKAZ_ACCOUNT_EMAIL`/`SKAZ_UID`, фолбэк `EO_*`; лежат только в `server/.env`/бекапе),
`Origin: http://lampa.mx` на потоки. Плагин-IP E-Online для данных не нужен (кластер напрямую).

---

## 1. ПОЛНАЯ ТАБЛИЦА (33 источника)

| # | E-Online Provider | Slug | Есть в Maniya | Реализован | Movie | Series | S/E | Voices | Quality | Poster | Subtitles | Playback | Account/Token | Статус | Gap | Prio |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Allo-OA / Allo-XA | alloha | ✔ skaz-alloha (+native) | ✔ | ✔ | ✔ | ✔ | ✔ (8+) | 1080p→360p | ✔ (TMDB) | ✔ (7) | ✔ HLS | нет | **WORKING** | — | — |
| 2 | FILMix | filmix | ✔ native+ twin | ✔ | ✔ | ✔ | ✔ | ✔ | 2160p→480p HDR | ✔ | ~ | ✔ (429 CDN sporad) | filmix token | **WORKING** | 429 cdnsqu sporadical | — |
| 3 | For Serial | rezka | ✔ native+ twin | ✔ | ✖ (0 on films) | ✔ | ✔ | ✔ (7) | 1080p→480p | ✔ | ✔ | ✔ HLS | rezka login | **PARTIAL** | фильмы пусто; только сериалы | 3 |
| 4 | VideoS | videoseed | ✔ skaz | ✔ | ✔ | ✔ | ✔ | ✔ | 1080p→480p | ✔ | ~ | ✔ | нет | **WORKING** | — | — |
| 5 | XDVB | hdvb | ✔ native+ twin | ✔ | ✔ (link→follow) | ✔ | ✔ | ✔ | 1080p→480p | ✔ | ~ | ✔ | hdvb token | **WORKING** | — | — |
| 6 | Ozvuchky | veoveo | ✔ skaz | ✔ | ≈ (play cards) | ≈ | ✔ | ✔ | 1080p→480p | ✔ | ~ | ⚠ CDN 403 | нет | **PARTIAL** | rstprgapipt 403 на части CDN | 4 |
| 7 | Lime | kinopub | ✔ skaz | ✔ (follow postid) | ✔ | ✔ | ✔ | ✔ (12) | 1080p→480p | ✔ | ~ | ✔ | нет | **WORKING** | — | — |
| 8 | KinoFlix | kinoflix | ✔ skaz | ✔ | ✔ (play) | ✖ (0 GoT) | ~ | ~ | 2160p→480p (карты) | ✔ | ~ | ✔ | нет | **PARTIAL** | сериалы: контента на кластере нет | 5 |
| 9 | PidTor | pidtor | ✔ skaz | ⚠ | ✔ карты play | ~ | ~ | ~ | — | ✔ | ✖ | **✖ 502 торрент-магниты** | нет | **PARTIAL/BLOCKED** | play-карточки = magnets; nginx 502 | 6 |
| 10 | Solntse | solntse | ✔ skaz | ✔ | ✔ | ✔ (2s) | ✔ | ✔ | 1080p→480p | ✔ | ~ | ✔ | нет | **WORKING** | — | — |
| 11 | RUS-2 (Рутюба) | rutube | ✔ rutubemovie (native) | ✔ | ✔ | ✔ | ✔ | ✔ | HD | ~ | ~ | ✔ | нет | **WORKING** | skaz-rutubemovie сегодня 403 (CF-gate), native жив | — |
| 12 | Kodik | kodik | ✔ native | ✔ | ≈ (anime-gate) | ≈ | ✔ | ✔ | 1080p→480p | ✔ | ~ | ✔ | kodik token | **PARTIAL** | западный каталог пусто (гейт как Lampac) | — |
| 13 | GET's TV | zagonka | ✔ (skaz, видимый) | ✖ | ✖ | ✖ | ✖ | ✖ | — | — | — | **503** | нет | **DEAD** | 503 на всех хостах; в UI живёт пустым — убрать из show | 7 |
| 14 | **GeoVideo (KinoPan)** | geosaitebi | ✔ **ДОБАВЛЕН 2026-08-10** | ✔ | ✔ (E2E) | ✖ (0 у всех) | ✖ | ~ | Full HD | ✔ | ~ | ✔ HLS | нет | **WORKING (movie)** | сериалов в каталоге нет; фикс follow `href=<slug>.html` закоммичен | — |
| 15 | (кластер) VKMovie | vkmovie | ✖ | ✖ | ✔ (21 items, 2160p→144p) | ✖ | ✖ | ~ | 2160p→144p | ~ | ✖ | ✔ (206 video/mp4) | нет | **MISSING / готов к добавлению (0 кода)** | не в карте плагина (вне E-Online), но жив | 1 |
| 16 | AniTrue | animelib | ✖ | ⚖ кандидат | ✔ (link-cards, тот же follow-фикс) | ~ | ~ | ~ | ~ | ~ | ~ | ~ | нет | **MISSING / кандидат** | проверить E2E тем же follow | 2 |
| 17 | Kino (kinobase) | kinobase | ✖ | ✖ | ✖ | ✖ | — | — | — | — | — | **503** | rch | **BLOCKED** | аккаунтный/rch-источник, не lite | ~ |
| 18 | VideoH | videohub | ✔ **cdnvideohub (native)** | ✔ | ✔ | ✔ | ✔ | ✔ | 4K | ~ | ~ | ✔ | нет | **WORKING (native-аналог)** | skaz-videohub 404 (не lite) | — |
| 19 | Dragon | turboserial | ✖ | ✖ | ✖ | ✖ | — | — | — | — | — | **404** | rch | **BLOCKED** | — | ~ |
| 20 | RUS-1 (vkvideo) | vk | ✖ | ✖ | ✖ | ✖ | — | — | — | — | — | **404** | rch | **BLOCKED** | — | ~ |
| 21 | (RUS-2 отдельно) | rutube | ✖ (native = rutubemovie) | ✖ | ✖ | ✖ | — | — | — | — | — | **404** | rch | **BLOCKED** | — | ~ |
| 22 | FCD | fancdn | ✖ | ✖ | ✖ | ✖ | — | — | — | — | — | **403** | — | **BLOCKED** | — | ~ |
| 23 | Miror | mirage | ✖ | ✖ | ✖ | ✖ | — | — | — | — | — | **403** | — | **BLOCKED** | — | ~ |
| 24 | FANS | fanserials | ✖ | ✖ | ✖ | ✖ | — | — | — | — | — | **503** | — | **BLOCKED** | — | ~ |
| 25 | KinoPUB | mirkino | ✖ | ✖ | ✖ | ✖ | — | — | — | — | — | **403** | — | **BLOCKED** | — | ~ |
| 26 | VCDN | xvideocdn | ✖ | ✖ | ✖ | ✖ | — | — | — | — | — | **503** | rch | **BLOCKED** | — | ~ |
| 27 | HDRezka | hdrezka | ✖ | ✖ | ✖ | ✖ | — | — | — | — | — | **404** | — | **BLOCKED** | — | ~ |
| 28 | AniLiberty | aniliberty | ✖ | ✖ | ✖ | ✖ | — | — | — | — | — | **403** | — | **BLOCKED** | — | ~ |
| 29 | AniBest | animebesst | ✖ | ✖ | ✖ | ✖ | — | — | — | — | — | **403** | — | **BLOCKED** | — | ~ |
| 30 | FilmixTV | filmixtv | ✖ | ✖ | ✖ | ✖ | — | — | — | — | — | **403 (гейт)** | — | **BLOCKED** | другой lampac-блок | ~ |
| 31 | vdb | vdb | ✖ | ✖ | ✖ | ✖ | — | — | — | — | — | ? | — | **UNKNOWN** | из withsearch-34 | ~ |
| 32 | KinoteatrKG | kinoteatrkg | ✖ (collaps native отдельно) | ✖ | ✖ | ✖ | — | — | — | — | — | **403** | — | **BLOCKED** | не путать с Collaps | ~ |
| 33 | Collaps | collaps | ✔ native | ✔ | ✔ | ✔ | ✔ | ✔ | ~ | ~ | ~ | ✔ | collaps token | **WORKING (native)** | skaz-collaps 403, но native API жив | — |

Легенда: ✔ — подтверждено end-to-end; ≈ — работает, но с оговорками; ~ — не подтверждено/не проверено; ✖ — нет/пусто.

---

## 2. СВОДКА ПО КАТЕГОРИЯМ

### WORKING (end-to-end)
alloha, filmix, videoseed, hdvb, kinopub, solntse, rutubemovie (native), cdnvideohub (VideoH-аналог),
collaps (native), **geosaitebi (добавлен сегодня, movie)**.

### PARTIAL (есть в Maniya, работает не полностью)
- rezka — фильмы пусто, сериалы ок
- veoveo — 403 части CDN
- kinoflix — фильмы ок, сериалы пусто
- kodik — аниме-гейт, западный каталог пусто
- pidtor — карточки есть, но торрент-магниты → 502 (playback blocked)

### MISSING FROM MANIYA (есть в E-Online/кластере, в Maniya нет)
- **vkmovie (VKMovie)** — реально жив, E2E без кода (2160p→144p, 206 video/mp4). Приоритет 1.
- **animelib (AniTrue)** — 200 link-карточки, тот же follow-механизм (geosaitebi-фикс). Приоритет 2.
- **vdb** — в withsearch, статус UNKNOWN. Требует проверки.

### BLOCKED / DEAD (есть в E-Online, сейчас недоступны по REST)
kinobase (503), turboserial (404), vk/RUS-1 (404), rutube/RUS-2 (404), fancdn (403), mirage (403),
fanserials (503), mirkino (403), xvideocdn (503), hdrezka (404), aniliberty (403), animebesst (403),
filmixtv (403), kinoteatrkg (403), zagonka (503).
Все — rch(WebSocket)/аккаунтные или блок обойдённого lite; НЕ добавлять в UI.

---

## 3. ИТОГИ И КЛЮЧЕВЫЕ ВЫВОДЫ

1. **GeoVideo добавлен** (директива пользователя п.3): фильмы WORKING E2E (манифест через
   прокси), сериалов в каталоге нет. Коммит `738d831`, деплой OK, тесты 346.
2. **account_email/uid** — уже конфигурируемые (`SKAZ_ACCOUNT_EMAIL`/`SKAZ_UID` в server/.env,
   фолбэк EO_*). Влияют на: доступ к lite-источникам вообще; rch-источники (kinobase…). Для
   обычных lite-источников влияют на наличие каталога, не на качество/переводы.
3. **vkmovie** — единственный «новый» источник, работающий сразу (0 кода). Решение пользователя:
   добавлять ли (вне карты плагина E-Online).
4. **zagonka (GET's TV)** — висит в UI пустым (503). Рекомендация: `show=false`, чтобы не светить
   мёртвый источник (директива «не показывать мёртвые в меню»).
5. Остальные BLOCKED — сохраняются в metadata registry (иконки/имена), но НЕ в balancers/UI.

## 4. NEXT IMPLEMENTATION ORDER (ожидает подтверждения пользователя)

1. **vkmovie** — добавить в balancers (0 кода, сразу рабочий; вне списка E-Online-плагина).
2. **animelib** — добавить в balancers (тот же follow-фикс, нужен E2E-проверка).
3. **rezka фильмы** — диагностика «0 items на фильмах» (двухуровневый follow), если нужны фильмы.
4. **veoveo CDN 403** — расширить allowlist / проверить проксирование rstprgapipt.
5. **kinoflix сериалы** — контента на кластере нет (не чинится провайдером).
6. **pidtor магниты** — убрать/пометка (502 в nginx).
7. **zagonka** — show=false (мёртвый).