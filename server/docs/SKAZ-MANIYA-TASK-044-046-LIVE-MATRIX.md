# SKAZ-MANIYA TASK-044/045/046 — Панel + живой активный источник + direct-first + deep-probe

**Статус:** ✅ STAGING задеплоен. Bundle `d64e0d69` (110 864 B, served 111 009 B). PROD НЕ ТРОНУТ.
**Дата:** 2026-08-23 (~22:30)
**Гейт:** Suite 826 / 819 pass / 0 fail / 7 skip.

## Жалоба юзера (единый блок)
> «Опрашиваем источники — найдено 14, 6с, работает но отображается криво, нужен серый тон как у SKAZ; показываются источники без фильмов и карточка пропадает; самое главное — фильмы не запускаются, крутят долго, потом Скрипт Эрор»
> «можно сначала прямой доступ, если не доступно — через прокси?»
> «протестировать реально на разных фильмах, проверка на всех источниках»

## Четыре отдельных исправления (каждое — свой этап)

### T044 (панель + мёртвые источники + плей) — ранее (md5 03c32207→46 047 029)
- Панель опроса: `uiLoadingText()` с found/bar/slow как у SKAZ (детали в TASK-043).
- `uiListEmpty()` держит каркас+тулбар+note: мёртвый источник больше НЕ стирает экран, селектор жив.
- `probeSources(ordered)` (новое): параллельная проба ≤6 кандидатов через /videos; источник,
  давший 0 videos, гочится (show:false → «Ещё N») и не предлагается.

### T045 (direct-first с фейловером) — этап 2
- Сервер: `buildPlayUrl` уже direct-first (T037). Staging `.env` (бэкап `.env.bak-t045-direct-…`):
  `DIRECT_PLAYBACK=true`, `DIRECT_PLAYBACK_ALLOW_HOSTS=werkecdn.me,sevstar933krop.com,ashdi.vip`.
- Клиент: если `play.url` — прямая CDN (не наш /proxy, не наш API), ставится
  `play.url_reserve = /api/lampa/proxy?url=…&token=…&origin/ref=…` — плеер Lampa при фейле
  прямого автоматически переключается на прокси (механизм `url_reserve`, «or» из E-Online).
  Inert при DIRECT_PLAYBACK=false (все URL уже наши).

### T046 (deep-probe: источник «с items» ≠ рабочий) — этап 3 (этот бандл)
Матрица 4 фильмов показала второй слой мёртвых источников: items ЕСТЬ, но плей-ссылка битая —
kinopub 403 на всех 4, kinoteatrkg 404 (Одиссея), mirkino 403, filmix-direct 404 (Паразиты).
Они проходили старый probeSources («есть items → winner») → юзер тапнул → спиннер.
**Фикс:** в probeSources после получения items берётся ПЕРВАЯ плей-ссылка (метод ≠ call) и
делается live Range-проба (bytes=0-1023, AbortController 8s):
- 2xx/206 → **confirmed** → первый такой становится активным;
- 4xx/5xx/таймаут/0-ttems → **ghost** (show:false → «Ещё N»);
- network/CORS-сбой (прямая CDN без ACAO) → **unverified** — источник НЕ гочится, но активным
  становится только если никто не подтвердился (fallback-уровень, порядок = кандидаты).
- Никто не ответил 2xx → активный = первый unverified, иначе probed[0] (note + живой селектор).

## Live-матрица (исполнена на VPS: card → /videos → Range-проба плей-ссылки, token staging)

### Одиссея (film, tmdb 1368337) — card 20/35 visible
| источник | items | вердикт |
|---|---|---|
| skaz-kinopub | 0 | **ghost** (корень жалобы: активный но пустой) |
| filmix | 13 | ✓ proxy 206 HLS |
| skaz-ashdi | 1 | ✓ DIRECT ashdi.vip 200 HLS |
| skaz-kinoukr | 1 | ✓ DIRECT ashdi.vip 200 HLS |
| rutubemovie | 3 | ✓ proxy 200 HLS |
| skaz-vkmovie | 21 | ✓ proxy 206 MP4 |
| hdvb | 1 | ✓ DIRECT sevstar 307→HLS |
| skaz-alloha / skaz-lordfilm | 4 / 3 | call-item (резолв позднее) |
| skaz-veoveo | 1 | unverified (проба таймаут) |
| skaz-kinoteatrkg | 1 | 404 → ghost |
| skaz-mirkino | 2 | 403 → ghost |
| eneyida/geosaitebi/kodik/cdnvideohub/collaps/rhsprem/zetflixdb/zagonka | 0 | ghost |

### Мятеж (film, tmdb 1288445) — card 20/33
kinopub 403→ghost; **filmix DIRECT werkecdn 206 ✓**; rezka proxy 200 ✓; vkmovie 206 MP4 ✓;
hdvb DIRECT 307 ✓; alloha/lordfilm call; mirkino 403→ghost; остальные 0→ghost.

### Паразиты (film, 2019) — card 21/36
kinopub 403→ghost; rezka 11 proxy 200 ✓; ashdi DIRECT 200 ✓; veoveo 206 HLS ✓; solntse 206 MP4 ✓;
kodik 5 proxy 200 ✓; hdvb DIRECT 307 ✓; filmix DIRECT 404 ✗ (на этом CDN-хосте Паразитов нет);
vkmovie proxy 500 ✗ (серверная ошибка на этом файле); mirkino 403→ghost.

### Дом Дракона (serial, tmdb 94997) — card 20/34
kinopub 403→ghost; filmix DIRECT 206 ✓; rezka 10 proxy 200 ✓; ashdi 10 DIRECT 200 ✓;
veoveo 10 proxy 206 ✓; solntse 10 proxy 206 MP4 ✓; hdvb 10 DIRECT 307 ✓; rutubemovie 1 proxy 200 ✓.

**Итог:** стабильно рабочая база по всей матрице — filmix, rezka, ashdi (direct), solntse,
veoveo, vkmovie, rutubemovie, kodik, hdvb (307→direct), kinoukr. Direct-first реально отдаёт
прямые URL только для хостов из allowHosts (werkecdn/sevstar/ashdi видели DIRECT), остальное — /proxy.

## Деплой и верификация (этап 3)
- Локальный md5 `d64e0d69dda8362ba0637243254be51f` == VPS.
- restart → active; served (Lampa-UA) 111 009 B, маркеры `probeSources|hasVideo|AbortController` ×11.
- `/api/lampa/version` → `{staging:true, build:5fb2c9e8, model:true}`.
- Suite 826/819/0/7. PROD: 0 обращений.

## Следующий шаг
Девайс reload подписки → проверить на Одиссее/Мятеже и сериале: панель живёт до отрисовки,
активный источник — ПЕРВЫЙ подтверждённый (filmix для Одиссеи), пустые/битые источники не
показываются («Ещё N»), карточка не пропадает, плей сразу (direct, при ошибке → /proxy сам).