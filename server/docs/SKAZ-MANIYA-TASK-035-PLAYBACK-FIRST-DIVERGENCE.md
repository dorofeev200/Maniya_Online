# SKAZ-MANIYA-TASK-035 — PLAYBACK FIRST DIVERGENCE: FILMIX (ДИАГНОСТИКА → F1 ИСПОЛНЕН)

**Статус:** ✅ **F1 ИСПОЛНЕН + DEPLOY STAGING + VERIFY ЛИВЫМ WIRE** (ниже). F2 (twin-fallback)
существовал в store.js; F1 разблокировал его доставку. **PROD НЕ ТРОНУТ.**
Правка: `linkCardMatchesQuery` (SkazProvider.js) — title-match + каталог-допуск годов
`CATALOG_YEAR_TOLERANCE=2` вместо год-гейта ДО title (KINOPUB-004 «Одиссея 1997» сохранён:
разница в десятилетия ведёт к отклонению). Тесты: +2 D2 (skaz-provider.test.js),
suite 816/808/1 (единственный fail — пре-существующий сетевой availability-флейк).
**Дата:** 2026-08-23. **Стенд:** STAGING 95.85.241.121.

## VERIFY (живой wire устройства, POST-F1)
```
GET /api/lampa/videos?provider=filmix&id=1288445&kinopoisk_id=5582050&imdb_id=tt32305988
    &title=Мятеж&original_title=The Mutiny&serial=0&year=2025&source=tmdb&token=staging-test-…
→ 200 { items: 3 }  (детерминизм: 3/3 идентичных)
   [0] MVO [1080, HDRezka]   → /api/lampa/proxy?url=https://nl221.werkecdn.me/…   (play)
   [1] MVO [1080, Ukr, Dn]   → werkecdn
   [2] DVO [1080+, Ukr, K]   → werkecdn
proxy-probe: Range 0-1023 → 206 Partial Content, video/mp4  ◀ серверный playback-путь жив
```
До F1: тот же запрос → `items:[]` → «Видео не найдено». После: та же сигнатура, что у SKAZ
(postid=186401 → 3 play-карточки кластера). Остальное — см. диагностику ниже.

## Симптом устройства (жалоба)
Список источников отображается, порядок работает, наши названия сохраняются,
«Filmix ~ 4K» на месте. При выборе Filmix клиент получает **«Maniya Online →
Видео не найдено»**. На той же карточке SKAZ → Filmix → **реальное воспроизведение**.

## Тестовая карточка
«Мятеж / The Mutiny» (TMDB id=1288445, kp=5582050, imdb=tt32305988, **year 2025**)
— та же, что в T034-reported. Модель `/sources/card` (meta.model:true, 35 items):

```
[2] show=true ghost=false id=filmix  name="Filmix ~ 4K"  api=/api/lampa/videos?provider=filmix  balanser=filmix
```
→ `resolveModelId('filmix', snapshot)` вернул **native id 'filmix'** (native enabled wins,
sourceModel.js:56-61) → клиент пошёл на **NATIVE FilmixProvider (api.filmix.tv api-fx)**.

## Живые запросы (доказательство по реальному wire)

### A. Maniya STAGING — выбранный Filmix (путь устройства)
```
GET /api/lampa/videos?provider=filmix&id=1288445&kinopoisk_id=5582050&…&token=staging-…
→ 200 { items: [] }                      (1904ms)   ◀ «Видео не найдено»
native filmix search(api-fx) mutiny: 0 records в 6907ms
```
**Недетерминизм native-цепи зафиксирован:** тот же карточка ранее дала 3 items дважды
(0.7s), затем **0 items** (2.0s) в одном прогоне. api-fx/list для этого title flaky.

### B. SKAZ — тот же клик (что видит настоящий SKAZ-канал)
```
GET {host}/lite/filmix?<cardParams>&account_email=<…>&uid=<…>
→ 20019 B  (34 link-карточки similar:true — страница «похожие», поиска кластера)
   «Мятеж / Mutiny» year=2026  postid=186401        ← ЕДИНСТВЕННЫЙ корректный таргет
GET lite/filmix?…&postid=186401
→ 3 play-карточки  «Мятеж (MVO [1080, HDRezka])»  https://nl221.werkecdn.me/s/FHmG5rq…  ◀ работает
```
Кластер держит фильм ПОД postid-навигацией (у filmix-модуля год поста 2026 ≠ TMDB 2025).
SKAZ-клиент это проходит (fuzzy title-match), наш — нет (см. D2).

### C. Наш кластерный адаптер (skaz-filmix) — тоже 0 по этой же карточке
```
GET /api/lampa/videos?provider=skaz-filmix & same card → 200 { items: [] }
```
Причина подтверждена симуляцией `collectMovieCards` (без правки сервера):
- Первая страница: 34 link-карточки, play/call нет → `hasMovieItems=false`;
- `movieHref`/`postidFromCards` ищут link, проходящую **`linkCardMatchesQuery`**:
  `SkazProvider.js:945-947` — `qYear && cardYear && cardYear !== qYear → return false`
  → «Мятеж / Mutiny» (2026) ОТВЕРГНУТ при query year 2025 → `postidFromCards=null`
  → навигация обрывается → `{cards:[]}` → items [] → «Видео не найдено».
- **Симуляция предлагаемого фикса** (title-match РАНЬШЕ год-гейта):
  `postidFromCards = 186401` → страница → **3 play-карточки, playable=true**, werkecdn. ✅

## Покрытие остальных источников (минимум из задания выполнен)
| Источник | Мятеж (фильм) | Дом Дракона (сериал) |
|---|---|---|
| filmix (native) | **0 items** (D1-flake) | 10 play ✅ |
| skaz-filmix (кластер) | **0 items** (D2-год-гейт) | 10 play ✅ |
| skaz-kinopub | 0 (кластер скрывает для карточки, show:false в модели) | 10 play ✅ |
| rezka (native) | 0 (другой бэкенд) | 10 play ✅ (8564ms) |
| skaz-alloha | 7 call ✅ | 10 call ✅ |
| skaz-lumina | 0 (кластер скрывает, ghost в модели) | 0 |
| прочие видимые (zagonka 3, hdvb 1, kinotochka 1, cdnvideohub 2, lordfilm 5 call, mirkino 2, zetflixdb 3) | ✅ | — |

→ **Другие источники играбельны.** Сломан кейс конкретно Filmix на фильме, где
кластер-модуль несёт title под постинг-годом, отличным от TMDB, а native-цепь flaky.

## FIRST DIVERGENCE (вывод)
**Клик «Filmix ~ 4K» в Maniya идёт на NATIVE api.filmix.tv цепь** (`id` модели `filmix`,
sourceModel.js:56-61, api_url `/videos?provider=filmix`) — это **другой бэкенд**, чем
кластерный модуль `lite/filmix`, который использует SKAZ. Native-цепь для этого title
недетерминирована (0↔3 items) → в момент клика устройства `items:[]` → «Видео не найдено».
Параллельно наш кластерный адаптер `skaz-filmix` **второй независимой причиной** не
доходит до контента: `linkCardMatchesQuery` год-гейт (SkazProvider.js:945-947) отвергает
единственную корректную link-карточку, когда год поста filmix ≠ года TMDB (2026 vs 2025).

## Минимальное исправление (план, КОД ПОКА НЕ МЕНЯЛСЯ) — деплой только STAGING
### F1 (ОБЯЗАТЕЛЬНО) — SkazProvider.js `linkCardMatchesQuery`, ~line 934-961
Порядок проверок: **title-match РАНЬШЕ год-гейта**. Если любая часть названия link-
карточки совпала с query-title → карточка является целью навигации независимо от года
(разница каталоговых годов TMDB/filmix — не «другой фильм»). Год продолжает отвергать
ТОЛЬКО при несовпадении названий (безопасность KINOPUB-004 сохраняется — там тайтлы
не совпадали, год был единственным дискриминатором). Симуляция: Мятеж → 3 play ✅.

### F2 (РЕКОМЕНДУЕТСЯ, МИНИМАЛЬНЫЙ БЛАСТ-РАДИУС) — FilmixProvider.videos()
Когда native-поиск/видео-линки дают **пусто** → фолбэк на зарегистрированный
`skaz-filmix` (кластерный модуль = тот же путь, что у SKAZ), вернуть его items.
- Native остаётся первичным для всех карточек, где работает (сериалы, рабочее большинство);
- Меняется ТОЛЬКО «пустой» кейс → детерминированный кластерный путь; чип/бренд/модель UI
  не меняются («Filmix ~ 4K», Maniya Online);
- Деплой этого на PROD — только отдельной командой (как T032/T027).

### F2-alt (НЕ РЕКОМЕНДУЕТСЯ сейчас) — sourceModel filmix → skaz-filmix всегда
Полный аналог пути SKAZ (кластер первичен), но заменяет native-бэкенд на ВСЕХ карточках
→ больший риск регрессий; F2-minimal даёт тот же результат с меньшим радиусом.

## Артефакты
`backup/t035-skaz-probe.mjs` — lite/filmix vs native /videos (5 карточек).
`backup/t035-filmix-page.mjs` — разбор RAW кластер-страниц (forrest play:5 / mutiny link:34).
`backup/t035-filmix-postid.mjs` — postid=186401 → 3 play; год-гейт отвергает 33/34.
`backup/t035-simulate-fix.mjs` — симуляция F1: title-раньше-года → 3 play ✅.
`backup/t035-fullmap.mjs` — /sources/card обоих карточек + /videos все провайдеры + registry.
`backup/t035-visible-map.mjs` — добивание таблицы: native rezka + все видимые.

## Итог блока
F1 задеплоен ТОЛЬКО на staging (секция VERIFY выше). следующее по матрице: KinoPub → Alloha →
Rezka → Lumex → остальные источники → сериалы → сезоны/озвучки → fallback → source selector/
runtime. PROD — HARD STOP.