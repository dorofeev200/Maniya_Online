# SKAZ-MANIYA FULL PARITY MATRIX — STAGING 95.85.241.121

**Статус:** ✅ Реализация по матрице выполняется. Деплои: F1 (filmix) + season-follow (veoveo)
залиты на staging (`/opt/maniya-online`), оба верифицированы ливым wire (ниже).
**Дата:** 2026-08-23. **PROD НЕ ТРОНУТ.** Бренд Maniya Online, наши названия провайдеров.
Методика: для каждого сценария — SKAZ real wire (кластер direct `lite/<balancer>`) против
наш staging (`/api/lampa/videos?provider=<id>`), сравнение количества карточек/методов.
Красный флаг — только реальная функциональная дивергенция; косметика не гоняется.

Легенда: ✅ паритет · 🔧 исправлено и задеплоено · ⚪ by-design (документированная разница)

## Сводка

| # | Сценарий | Статус | Реализация | Доказательство |
|---|---|---|---|---|
| 1 | Фильмы — Filmix | 🔧 | F1 `linkCardMatchesQuery` + существующий twin-fallback | «Мятеж»: фильм→filmix items=3 (MVO HDRezka), детерминизм 3/3, proxy 206 |
| 2 | Фильмы — KinoPub | ✅ | не требовалось | gump 25/25 play; mutiny кластер сам 0 → hide mirror |
| 3 | Фильмы — Alloha | ✅ | не требовалось | gump 4/4 call; mutiny 7/7 call |
| 4 | Фильмы — Rezka | ✅ | не требовалось | «Мятеж 2025» нет в каталоге HDRezka → честный empty (и у SKAZ) |
| 5 | Фильмы — Lumex/lumina | ✅ | не требовалось | кластер 0/0/0 → `show:false ghost:true` mirror |
| 6 | Фильмы — VeoVeo (и киноструктурные) | 🔧 | season-follow `seasonLinkTarget` (#3 в collectMovieCards) | «Мятеж»: skaz-veoveo items=8 (1-8 серия), proxy 206 HLS |
| 7 | Фильмы — остальные | ✅ | не требовалось | map: zagonka 3, hdvb 1, kinotochka 1, cdnvideohub 2, lordfilm 5 call, mirkino 2, zetflixdb 3 (все play) |
| 8 | Сериалы | ✅ | не требовалось | HOD: filmix 10, rezka 10, kinopub 10 (3 сез/13 voices), alloha 10 (3 сез/10 voices), клик сезона/голоса меняет набор |
| 9 | Сезоны/эпизоды | ✅ | сериальный путь openSeasonPage | `season=3` → 8 эпизодов; items 1-10 серия |
| 10 | Озвучки | ✅ | voices-массив в /videos | `voice=2` → набор меняется; voices=10-19 на провайдерах |
| 11 | Выбор источника | ✅ | модель /sources/card = кластер lite/events | 35 строк, 17 show, 18 ghost, model:true; названия Maniya |
| 12 | «Ещё N»/ghost | ✅ | ghost из кластера (T018/T019C) | ghost-список 18 на «Мятеж» (kinopub/lumina/… скрыты там же, где кластер) |
| 13 | RCH/WS | ✅ | SkazRchClient+Registry (T034 live) | rch-каналы отдаются; RCH-ошибки — provider_error |
| 14 | Поиск | ✅ | TMDB-индекс Lampa + SkazProvider.search title-fallback | F9 юнит-тесты (55/55); onSearch плагина не заявляется |
| 15 | Playback | ✅ | /api/lampa/proxy SSRF-локлист | filmix→nl221.werkecdn 206 mp4; veoveo→api.rstprgapipt 206 mpegurl |
| 16 | Fallback (native→twin) | 🔧 | store.js twinForPayload (существовал) + F1 | «Мятеж» filmix native 0 → skaz-filmix cluster 3 play |
| 17 | Ошибки/пустые | ✅ | честный empty + provider_error | collaps upstream-refusal пробрасывается; pidtor торрент-дескриптор by-design |
| 18 | Continue-watching | ⚪ | клиентский (серверного у SKAZ нет) | T021: server 404 на стороне SKAZ |
| 19 | Продолжение — реальный девайс | ⏳ | — | ждёт acceptance на Android/Lampa (шаг 1: «Мятеж»→Filmix→play) |

## Исправления (2) — оба только staging

### F1 — `SkazProvider.js: linkCardMatchesQuery` (filmix D2)
Год-гейт ДO title-матча отвергал единственную корректную similar-карточку «Мятеж/Mutiny
2026» при TMDB-годе 2025 → postid-навигация обрывалась → «Видео не найдено». Теперь:
title-match + каталог-допуск `CATALOG_YEAR_TOLERANCE=2` (пост кластера vs год выхода —
шум, десятилетия — другой фильм → KINOPUB-004 «Одиссея 1997/1992» не ломается).
Деploy staging: `grep CATALOG_YEAR_TOLERANCE` на хосте. Suite 818/810/1 (fail — пре-сущ. сетевой).

### F-veoveo — `SkazProvider.js: collectMovieCards #3 + seasonLinkTarget`
Модули, отдающие ФИЛЬМ сезон-ссылкой (veoveo: `movieid…&s=1` с совпавшим `kinopoisk_id/imdb_id`
в URL), не фоловренились в movie-пути → пусто. Теперь third-step: `openLiteUrl(seasonUrl)`
(как сериальный путь), ID-гейт не пускает на чужую карточку (KINOPUB-004-безопасно).
Деploy staging подтверждён; «Мятеж» → veoveo 8 play + proxy 206 (HLS).

## Не изменено намеренно (задокументированные различия)
- **PidTor** — кластер отдаёт торрент-дескрипторы `lite/pidtor/s<hash>?tr=`; играются
  только торрент-плеером. SKAZ-клиент с кторрент модулем может; наш — нет → честный empty
  (TASK-SOURCES-007, не регрессия).
- **Rezka** на фильмах, отсутствующих в каталоге HDRezka (будущие/специфичные) — честный
  empty вместо чужого фильма; SKAZ тоже пуст (кластер сам без контента).
- **Названия источников** — наши (Maniya Online, «Фильм ~ 4K» и т.п.), НЕ SKAZ. Бренд сохранён.
- **Иконки/чипы** (icon, extras index=null) — косметика, не трогалась (задание: «не косметика»).

## Осталось
1. **Реальный Android acceptance** (пользователь): «Мятеж»→Filmix→play; затем `seasons/voices`,
   выбор источника, «Ещё N», поиск, playback всех видимых.
2. Если девайс покажет новую функциональную дивергенцию — вернуться к матрице (тот же цикл).

## Артефакты этого прогона
- `backup/t035b-kinopub-parity.mjs`, `t035b-provider-parity.mjs` (alloha/rezka/lumina),
  `t035b-pidtor-veoveo.mjs`, `t035b-veoveo-cards.mjs`, `t035b-veoveo-follow.mjs`,
  `t035b-empty-check.mjs`, `t035-visible-map.mjs` (post-F1).
- Юнит-тесты: `skaz-provider.test.js` +4 (T035-D2 ×2, T035b-veoveo ×2).
- Deploy-маркеры: `CATALOG_YEAR_TOLERANCE` + `seasonLinkTarget` на 95.85.241.121.