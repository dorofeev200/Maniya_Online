# SKAZ REVERSE — DEEP UI + BALANCER (onlines.js, свежая версия)

**Дата:** 2026-08-23
**Народ даты:** по запросу юзера «более подробная деобфускация SKAZ http://skaz.tv/tv.js».

## Что свёрнуто и где лежит снапшот

- `http://skaz.tv/tv.js` — **НЕ плагин** (104 Б, bootstrap-стаб: `Lampa.Platform.tv()`). Подтверждено повторно.
- Реальный клиент: `http://skaz.tv/onlines.js` — **249 963 Б, 5839 строк, md5 `2df914998349dd24fcf8a1a83fdb7835`** (скачан 2026-08-23, UA `lampa_client`). Снапшот: `C:\Users\Admin\AppData\Local\Temp\skaz-reverse\onlines.latest.js`.
- Разница со старым снапшотом (`onlines.js`, adf38474): классы переименованы `z01-*` → `skaz-*` (`skaz-loading`, `skaz-skeleton`, `skaz-hero`, `skaz-hidden-head`), добавлены `skaz_loading_slow`, auto-switch-ноты. **Логика UI/баллансера не изменилась относительно наших T040-выводов.**
- Минификация минимальная; файл читаемый, структура методов = `this.<method> = function` (ES5, тот же стиль Lampa).

## Общий runtime-flow (инициализация карточки фильма)

```
start() (584) → initialize() (2940)
  ├─ loading(true); filter.onSearch/onBack/onSelect; addButtonBack
  ├─ files.appendFiles(scroll.render()); files.appendHead(filter.render())
  ├─ scroll.minus(.explorer__files-head)                        ← шапка Lampa-filters закрепляется
  ├─ if (modern): .explorer__files-head .addClass('skaz-hidden-head').css('display','none')   ← (3005) ШАПКА ПРЯЧЕТСЯ
  ├─ if (modern): this.uiLoadingPanel()                          ← (3007) «Опрашиваем источники»
  ├─ else: scroll.body().append(lampac_content_loading)
  ├─ if (object.balanser): прямой nojson-запрос (без опроса)
  └─ askServer: pingReady → externalids() → createSource()
```

**Ключевое:** в modern-режиме нативная шапка фильтров прячется сразу в `initialize()`, и сразу рисуется панель опроса. Селектор источников берёт на себя кастомный `uiRows` (тулбар), state (`filter.set('sort', ...)`) обновляется только как data (для sort-меню/памяти), визуально не рендерится.

## 1. Баллансер (поиск источников) — наша серверная модель ЭКВИВАЛЕНТНА

`createSource()` (3246):
```
URL  = Defined.localhost + 'lite/events?life=true' + requestParams(card)   // те же card-params
timeout = 15000; silent; headers: {'X-Kit-AesGcm': Lampa.Storage.get('aesgcmkey','')}
→ json.accsdb || serverDenial → reject (нет доступа)
→ json.life  → memkey + lifeSource() (второй events-запрос, без life) → startSource(json_life)
→ иначе      → startSource(json)
```

`startSource(json)` читает `json.online[]` (`{name,url,index,show,balanser,rch,voices,seasons}`) → 
- `sources[name] = {url, name, show, ...}`; `balanser` = активный; `filter_sources` = ключи.
- `ui_load_found` = count(show) → прогресс-панель «Найдено источников: N».
- `ui_load_percent = json.ready ? 100 : min(95, times/15*100)` — прогрес бар от числа попыток.
- `uiLoadingStop(); uiRows(); search() → find() → request(source.url)` — загрузка items.

**Вывод:** наш `GET /sources/card` = наш аналог `lite/events` (кластер → per-title model с `index`/`show`), выполняет ту же задачу синхронным клиентским запросом. SKAZ делает 1-2 events-запроса + `find()` на источник; мы делаем card + `loadVideos(activeUrl)`. Механика одинаковая; **НЕ копируем их X-Kit-AesGcm/nojson — это их протокол, у нас свой.**

`find()/request()` (3282): HTTP dataType:'text' на URL источника → `parse(str)` → `parseJsonDate` вытаскивает `div.videos__item[data-json]` (метод `play|call|link`, url, quality, stream, segments) + серия/сезон из атрибутов `s/e`. Кэш `online_results_cache` TTL `ONLINE_CACHE_TTL`; дедуп `request_gen`; ретрай-фейловер по пулу хостов `nextServerUrl` (1 ретрай); лимит `number_of_requests < 10` за 4с.

## 2. Панель «Опрашиваем источники» (точный макет)

`uiLoadingPanel()` (1290):
- `uiFrame()`; `ui.list.empty().append(ui.load).append(uiSkeleton(3))`.
- **hero_box и rows НЕ трогаются** (такими и пустыми остаются на время опроса).
- `.skaz-loading__title` = title («Проверка подписки»?). `.skaz-loading__text` = прогресс-строка.
- `uiLoadingText()` (1311): `text = found ? 'Найдено источников: {n}' : 'Опрашиваем источники'`; `text += ' · ' + seconds + 'с'`; если `seconds>=12 && percent<100` → append `' · ' + slow`. Бар: `width = max(ui_load_percent, min(90, sec*7)) %`.
- `uiLoadingProgress(json, times)` (1325): обновляет found/percent при каждом ответе events (и перевзводит watchdog).
- `uiLoadingStop()` (1338): сброс таймера и `ui.load`.

**Наша панель (T041) воспроизводит это:** title+текст+бар+skeleton(3), `pct = min(90, sec*7)`, «Найдено источников» — есть в `maniya_polling_found`. Отличие: WATCHDOG — у SKAZ `WATCHDOG_FIRST=40с` (первый опрос) и `WATCHDOG=24с`, у нас фолбэк 15с (безопаснее: наш card уже кэпнут сервером ≤12с, T019).

## 3. Обработка пустого/таймаута источника (auto-switch) — НАШ АНАЛОГ есть

`doesNotAnswer(er)` (4500+):
- `auto = Storage('skaz_auto_switch', true)!==false && !object.balanser && !denial` → `nextSource()`.
- Нота `.skaz-note` с таймером: `tic = accsdb ? 10 : 6`; по истечении `switchSource(next)` (следующий источник по списку).
- Иначе `lampac_does_not_answer` с `.change`/`.cancel`; через 5с автоматический переход на следующий источник.

Вывод: у SKAZ пустой источник = авто-переключение на следующий. **У нас это решается серверной кардио-моделью** (мёртвые → show:false → ghost) + T041-фикс активного источника на server-подтверждённый (`index != null`). Архитектурно чище, отдельный таймер не нужен.

## 4. Рендер-слой (экраны и порядок)

- `uiFrame` (1160): `scroll → .skaz → [.skaz__hero, .skaz__rows, .skaz__list]`. Переприкрепление — **проверка `ui.root.parent().length`** (root выпал из DOM → заново `scroll.clear()+append`), НЕ сравнение scroll. ← наш импорт в maniya-online.js.
- `uiRows` (1773): `.skaz-toolbar` (label + chip-источник с бейджем/иконкой/имем/шевроном) + раскрытие `.skaz-drop` чипами (бейдж+ `●` для show:true, `--ghost` скрытые, `--more` «Ещё N»).
- `uiHero` (1609): постер-фон w780 → градиент-подложка → бейдж/★/год/время → title → descr (2-line) → кнопка ▶ (перемена: бейдж/★/год/время до descr) + hint (имя источника · голос) + прогресс `Lampa.Timeline.render` + строка сезона.
- `uiDraw` (2416): карточки `.skaz-card` (thumb + `__line` прогресс, title, meta ●, quality, time), пагинация `JUMP_FROM` (`uiShowPage`), grid-view, фокус-менеджмент (`data-skaz-focus`, `uiFocusRestore(hero_button)` — после перерисовки фокус на hero-кнопке).

**Порядок экрана (settled): hero → toolbar (Источник) → список. Панель опроса — только в list-зоне.** Это ровно то, что описывает юзер: «Карточка → Продолжить → ниже Источник → ниже фильмы».

## 5. Константы и CSS (для справки)

- `SkazUI.WATCHDOG=24`, `WATCHDOG_FIRST=40` (сек), `REQUEST_TIMEOUT`, `ONLINE_CACHE_TTL`, `SOURCES_DELAY`, `SOURCES_TTL`, `JUMP_FROM` (пагинация сериалов).
- CSS (938-1061): `skaz-hero` (radius 1.2em, min-height 13em), `skaz-toolbar` (flex, mb 1em, label uppercase opacity .45), `skaz-loading` (padding 1.6em 1.8em, radius 1em, bg rgba(255,255,255,.05)), `skaz-loading__bar>div` (bg `#fff`), `skaz-skeleton__row` (radius .9em, bg .04, `skazpulse` 1.4s).

## 6. Маппинг «SKAZ → Maniya»

| Функция SKAZ | Наш аналог | Статус |
|---|---|---|
| `lite/events` + startSource (online[]) | `GET /sources/card` (sourceModel per-title) | ✅ эквивалент |
| uiLoadingPanel + uiLoadingText/Progress | `uiLoadingPanel` (T041) | ✅ (наш WATCHDOG 15с) |
| skaz-hidden-head (прятать нативную шапку) | **FIX T042** `z01-hidden-head` (client) | ✅ задеплоен |
| uiFrame reattach `parent().length` | **FIX T042** `!ui.root.parent().length` | ✅ задеплоен |
| uiRows / uiHero / uiDraw | uiToolbar / uiHero / uiAppendItem | ✅ T040-параллель |
| auto-switch при пустом источнике | server-модель: show:false/ghost + активный index!=null | ✅ T041 |

**НЕ копируем:** X-Kit-AesGcm/nojson (свой протокол), sourcesCache/LocalStore SKAZ (у нас server-кэш 5 мин), WATCHDOG 40с (наш дедлайн 15с безопаснее).

## Файлы
- Снапшот свежий: `Temp/skaz-reverse/onlines.latest.js` (md5 2df91499).
- Снапшот старый (z01-имена, те же механики): `Temp/skaz-reverse/onlines.js`.
- Отчёт T040 (старый слой): `server/docs/SKAZ-MANIYA-TASK-040-UI-PARITY.md`.