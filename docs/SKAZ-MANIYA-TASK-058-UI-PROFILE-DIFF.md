# SKAZ-MANIYA-TASK-058 — АУДИТ UI-ПРОФИЛЯ: SKAZ (z01 modern) vs Maniya (z01) — РАЗЛИЧИЯ

Дата: 2026-08-26. Status: ⏳ АУДИТ, правки НЕ вносились (wait подпись юзера). PROD НЕ ТРОГАТЬ.

Эталоны:
- SKAZ-клиент (реверс-снапшот): `C:\Users\Admin\AppData\Local\Temp\skaz-reverse\onlines.latest.js` (md5 2df91499, 5839 строк).
- Наш клиент: `public/maniya-online.js` (Z01_UI_OK-ветка = modern).

## 1. Как работает SKAZ modern (onlines.latest.js)

### 1.1 Источники — живая сессия кластера
- `createSource()` (3246) → `lite/events?life=true` → `{memkey, life:true}`.
- `lifeSource()` (3173): поллинг `lifeevents?memkey=…` каждую 1с до `ready:true` ИЛИ 15 тиков.
  Каждый ответ `json.online[]` **живо обновляет** `sources[name]={url,name,show}`, `filter_sources`,
  `filter.set('sort')` (3203-3219) — источники **добавляются/убираются/меняют show** прямо на карточке
  во время загрузки, без пересоздания экрана. `uiLoadingProgress(json, times)` (1325): found=count(show),
  бар = ready?100:min(95, times/15*100).
- WATCHDOG: `uiWatch` (1344) first 40с / далее 24с — зависший балансер → `doesNotAnswer`.

### 1.2 Тулбар и чипы
- `uiRows()` (1773): `addChip(key,label,text,extra)` рендерит в `.skaz-toolbar`:
  - **Источник** (chip: бейдж качества + имя + chevron, `source`),
  - **Сезон** — `addChip('season', 'Сезон', текущий сезон.title)` **если `filter_find.season.length > 1`** (1806),
  - **Озвучка** — `addChip('voice', 'Озвучка', текущий голос.title)` **если `filter_find.voice.length > 1`** (1811),
  - **Переход** (jump) — если серий > 20 (1815),
  - **Варианты** (similar) — если similar_list > 1 (1820).
- Раскрытие: `ui_open` в ['source'|'season'|'voice'|'jump'] → под тулбаром `.skaz-drop`:
  `uiSourceRow()` (2248) / `uiOptionRow(type)` (2149) / `uiJumpRow()` (2096).
- Выбор сезона/голоса: `uiSwitch(type,index)` (2192) → `filter_find[type][index].url` → `uiLoading()` → `request(url)`
  (свежий запрос с новым season/voice, экран = skeleton + перерисовка).

### 1.3 filter_find (данные сезонов/озвучек)
- `parse()` (3627): `.videos__button` из лайв-HTML. Сезонные кнопки → `filter_find.season=[{title,url}]`;
  голосовые кнопки → `filter_find.voice=[{title,url}]`; активные кнопки → choice.
- Авто-выбор голоса: `skaz_voice_pref` (kind: дубляж/многоголос/…) — `uiSwitch('voice')` сохраняет
  `Lampa.Storage.set('skaz_voice_pref', kind)` (2201); при следующем открытии сериала находит предпочтение (3710-3717).
- Память сезона: `seasonMemory` (3841) `z01_season_last` per movie.id → авто-сезон при открытии.
- Сортировка голосов по kind (Дубляж→Многоголосый→Двухголосый→…→Прочее) в `uiOptionRow('voice')` (2160).

### 1.4 Живой источник без выхода из карточки (probe + auto-switch)
- ПЕРИОДИЧЕСКИЙ фоновый probe: `uiDraw` → `probeBackground()` (1926) → через PROBE_DELAY=1.5с
  `probeSources(all)` (1976) — все источники, лимит 26, параллель 2, бюджет 45с, таймаут 7с,
  кэш `skaz_probe` (TTL ok 6ч / empty 30м).
- `probeMark` (1951): **источник, которого НЕТ в ряду, но probe дал 'ok' → чип ДОБАВЛЯЕТСЯ в открытый
  `.skaz-drop`** (1956-1961) с бейджем качества + зелёной ●; 'empty' → `skaz-chip--empty`, точка убирается;
  rch/accsdb → `skip`.
- Мёртвый активный источник → `doesNotAnswer` (4496): modern-note «источник пуст» + AUTO-SWITCH
  (таймер 6с / 10с при accsdb, `skaz_auto_switch` toggle) на `nextSource()` (2364) — **не выходя из карточки**.
- `nextSource`: state 'ok' > knownQuality-источники > show — по рангу/качеству.

### 1.5 Прочее
- Постраничная навигация серий (JUMP_FROM=20) для длинных сериалов.
- Hero: «Продолжить просмотр» + прогресс (reached/rememberReach), сезонная строка прогресса
  «Сезон: N · просмотрено X из Y · осталось Z» для сериалов.
- Память последнего балансера per-movie (`online_last_balanser`).
- Similar-чип «все варианты».

## 2. Как работает наш Z01 (public/maniya-online.js)

### 2.1 Источники
- `/sources` (статический реестр) + `/sources/card` (кард-модель, show/ghost, index) — ОДИН запрос при
  входе на карточку. Сервер кэширует availability: 5 мин (hide 60с). Дальше набор источников СТАТИЧЕН.
- `probeSources()` (890): при входе, ≤6 кандидатов, live Range-проба (8с), убирает мёртвые в ghost,
  активный = первый подтверждённый 2xx. Один раз; повторных циклов нет.
- `uiRefreshGhost` (882): поздний вердикт → перестройка ТОЛЬКО раскрытого `.z01-drop`.

### 2.2 Тулбар
- `uiToolbar()` (1191): **только** чип источника «[бейдж] имя ▼» + раскрытие `.z01-drop` (uiSourceRow 1220)
  со всеми источниками + «Ещё N». **Чипов «Сезон»/«Озвучка» НЕТ.**
- `setFilters()` (1435) СТРОИТ под-фильтры season/voice в нативный Lampa-Filter (как legacy), но шапка
  фильтров Lampa скрыта в modern (`z01-hidden-head`, initialize 586) → **на сериале в новом профиле
  сезон/озвучка не выбираются НИКАК** (жалоба юзера).

### 2.3 Пропуски vs SKAZ
- ❌ Чипы «Сезон/Озвучка» + `uiOptionRow` (нет выбора вообще).
- ❌ Живое обновление набора источников на карточке (опроса/добавления чипов нет).
- ❌ Авто-переключение мёртвого активного источника (только ручной switch через note+тулбар).
- ❌ Память предпочтительного голоса/сезона (автовыбор).
- ❌ Постраничная навигация длинных списков серий.
- ❌ До-пагинация голосов по kind.
- ~ Память последнего источника: у нас глобальный `maniya_online_source` (через фильмы), у SKAZ per-movie.

## 3. Сводная таблица различий

| # | Функция | SKAZ modern | Maniya Z01 | Приоритет |
|---|---------|-------------|------------|-----------|
| D1 | Выбор сезона на сериале | чип «Сезон» в тулбаре + drop-чипы + request | ❌ НЕТ (setFilters спрятан) | 🔴 ВАЖНО |
| D2 | Выбор озвучки на сериале | чип «Озвучка» в тулбаре + drop-чипы + request | ❌ НЕТ | 🔴 ВАЖНО |
| D3 | Живое обновление списка источников на карточке | поллинг lifeevents → sources live + probeMark добавляет/гхостит чипы | ❌ статично после входа, только uiRefreshGhost при открытом drop | 🟠 СРЕДНЕ |
| D4 | Авто-переключение с мёртвого источника | doesNotAnswer → таймер 6с → nextSource (без выхода) | ❌ note + ручной switch | 🟠 СРЕДНЕ |
| D5 | Автовыбор предпочтительной озвучки | skaz_voice_pref (kind) при открытии сериала | ❌ | 🟢 НИЗКО |
| D6 | Память последнего сезона per-movie | z01_season_last | ❌ (только «Продолжить просмотр» на ▶) | 🟢 НИЗКО |
| D7 | Пагинация длинных списков серий (jump) | >20 серий → «Переход» | ❌ | 🟢 НИЗКО |
| D8 | Фоновый probe источников после отрисовки | probeBackground + кэш skaz_probe | ❌ (только при входе) | часть D3 |
| D9 | Сортировка голосов по kind | дубляж→многоголос→… | ❌ (серверный порядок) | 🟢 НИЗКО |
| D10 | Hero-прогресс сериала «Сезон X: просмотрено Y из Z» | есть | «Вариантов: {n}» | 🟢 НИЗКО |

## 4. Корневая причина жалоб

1. **«Нет сезона и озвучки выбора»** (D1/D2): modern-ветка прячет нативную шапку фильтров Lampa
   (`z01-hidden-head`), а свой тулбар (`uiToolbar`) рисует только источник. `setFilters()` кладёт
   season/voice под-фильтры в спрятанный `filter` → невидимы. SKAZ эту задачу решает СВОИМИ чипами
   в тулбаре (`addChip('season'/'voice')` + `uiOptionRow`).
2. **«Балансер сам добавляет/убирает источник»** (D3/D4): это следствие живой lite-сессии
   (`lifeevents?memkey` поллинг 1с) + `probeBackground`/`probeMark` + `doesNotAnswer`-auto-switch.
   Наш серверный контракт — single-shot `/sources/card` (кэш 5 мин) + однократный клиентский
   `probeSources` (≤6) → набор статичен после входа.

## 5. План правок (на подпись, прод НЕ трогать)

### 5.1 W1 — Сезон/Озвучка в Z01 (D1+D2, client-only, `public/maniya-online.js`)
- Запоминать опции сезонов/озвучек из ответа `/videos` (в `setFilters` плюс к текущему):
  `uiSeasons=[{number,title}]`, `uiVoices=[{name,index}]` (модульные переменные, чистятся при смене карточки).
- `uiToolbar()`: после чипа источника при `uiSeasons.length>1` → чип «Сезон: <выбранный title>»,
  при `uiVoices.length>1` → чип «Озвучка: <выбранный name>» (label как SKAZ `torrent_serial_season`/`torrent_parser_voice`);
  `data-z01-focus` = 'season'/'voice', активный класс при открытии.
- `uiToggleSource` → общий `uiToggle(key)`; раскрытие = `.z01-drop` с чипами опций
  (`uiOptionRow('season'|'voice')`), выбранный помечается `z01-chip--active`; клик:
  `uiSwitch(type,index)` → `activeSeason`/`activeVoice` → `loadVideos()` (сервер уже умеет `season=`/`voice=`,
  store.js + SkazProvider.serialVideos). Сброс выбора — по источнику (как сейчас в changeSource).
- Тот же flow работает и для тонкого клиента (thinFlow → resolved тоже несёт {seasons,voices}).
- НЕ трогать: legacy-путь, server, спайки uiSourceRow, hero.

### 5.2 W2 (кандидат) — живой источник на карточке (D3/D4)
- `probeSources` → периодический фоновый ре-проб (тик ~20-30с, лимит параллельных запросов 2,
  бюджет ~40с) с кэш-окном: повторно пробуем `uiDeadSources`/ghost → живой → чип появляется в открытом
  drop (`uiRefreshGhost`), и наоборот мёртвый активный → ghost.
- Авто-switch мёртвого активного: note + таймер 6с (как SKAZ `skaz_auto_switch`) → следующий живой.
- Оговорка: set-источников в `online[]` мы не видим (single-shot контракт), поэтому «добавление» новых
  чипов возможно только для источников УЖЕ известных реестра/кард-модели, у которых /videos ожил.
  Полного аналога lifeevents (новые источники появляются/пропадают от кластера) на VPS нет
  (T051: single-shot качается — только живая сессия устройством). Для skaz-thin-модулей живой набор
  может давать ThinSkaz с девайса — отдельный шаг (уже есть sessionManager/nws).

### 5.3 W3 (по желанию) — мелочи (D5-D10)
- Автовыбор голоса по kind-предпочтению, память сезона per-movie, пагинация >20 серий, прогресс-строка hero.

## 6. Ограничения
- PROD (135.106.195.203) НЕ трогаем; деплой только staging (95.85.241.121, `systemctl restart maniya-online`).
- Бандл: `node scripts/generate-staging-plugin.mjs` → `server/staging-public/maniya-online-staging.js`.
- Тесты: клиент без real-DOM → vm-песочницы дают Z01_UI_OK=false (legacy) — контракт-тесты не зависят
  от рендера; новые проверки — статические (grep/структура), как в T040/T042.