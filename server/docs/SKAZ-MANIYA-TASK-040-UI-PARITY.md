# SKAZ-MANIYA TASK-040 — UI PARITY: отображение источников как в SKAZ (Z01 UI)

**Статус:** ✅ ДЕПЛОЙ на STAGING выполнен и верифицирован. ПРОД НЕ ТРОНУТ.
**Дата:** 2026-08-23
**Гейт:** `Z01_UI_OK` (реальный DOM) → современный рендер; vm-песочница тестов → legacy-путь без изменений. Suite 825/817/1/7 (единственный фейл — предсуществующий `availability-route.test.js:41`).

## Задача (запрос юзера)

> «ты можешь посмотреть дизайн отображения источников в skaz и сделать так же само в нашем плагине? … но тебе нужно самому проверить в Skaz»

Описание экранов: (2) большая hero-карточка фильма с бэкдропом/градиентом/метой/▶ Продолжить/текущим источником/прогрессом; (3) компактный селектор `ИСТОЧНИК [4K 🌐 Lime ▼]` с раскрытием в pill-чипы (бейдж качества + иконка + имя + зелёный ●); «Ещё N»; (4) после выбора — озвучки/качественные варианты отдельными горизонтальными карточками.

## Проверка в SKAZ (по требованию юзера)

Источник истины — деобфусцированный клиент SKAZ `Temp/skaz-reverse/onlines.js` (241 КБ):
- **CSS**: `.z01` блок 839-1010, инжектится `Lampa.Template.add('lampac_css', '<style>…')` + `$('body').append(...)` (наш эквивалент — `maniya_css`, те же классы).
- **Экраны**: `scroll → .z01 → [.z01__hero, .z01__rows, .z01__list]` (`uiFrame` onlines.js:1160).
- **Hero** (`uiHero` 1502-1610): `.z01-hero__bg` backdrop w780 через `Lampa.TMDB.image`, `__shade` левый градиент, `__title`, `__meta` (бейдж · ★vote · год · время), `__descr` 2-line clamp, `__actions` [`z01-btn--main` ▶ + `__hint` «name · voice»], `__progress` `Lampa.Timeline.render`, `__season`.
- **Селектор** (`uiRows`/`uiSourceRow`): `.z01-toolbar` (label + `.z01-chip--source`: `__badge` + `__label` + chevron) → раскрытие `.z01-drop` всех чипов; `.z01-chip__dot` `#4ade80` (зелёный, probed OK), `.z01-chip--ghost` (show:false), `.z01-chip--more` «Ещё N» (splitSourceName 528, shortQuality ~400/421).
- **Items** (`uiDraw`): `.z01-card` = thumb+num+`.z01-card__line` (прогресс), body `__title`+`__meta` через `.z01-dot`●, side `__quality`+`__time`.

**Вывод — наш контракт достаточен без изменения сервера:** `meta.js` отдаёт `name` (чистое имя, без качества), `icon`, `qualityLabel` → клиент уже получил все поля. Задвоения бейджа нет (например `filmix name:'Filmix' qualityLabel:'2160p'` → чип «4K 🔥 Filmix ●»).

## Реализация (client-only, `public/maniya-online.js`)

1. **`shortQuality`** — байт-в-байт копия `Z01UI.shortQuality` (onlines.js:421): `2160/1440→4K`, `1080→FHD`, `720→HD`, `480/576/360→SD`, слова `4k|uhd|fhd|hd`. `qualityLabel 'Full HD'` → `HD` (как и в SKAZ).
2. **`sourceChipParts(source, fallback)`** → `{badge, label}` = бейдж качества + «icon name».
3. **`escapeHtml`, `chevronSvg`** — для мета/стрелки.
4. **CSS** в `maniya_css`: `.z01`/`.z01-hero`(+__bg/__shade/__body/__title/__meta/__descr/__actions/__hint/__progress/__season)/`.z01-badge`/`.z01-btn--main`/`.z01-toolbar`/`.z01-chip`(+--source/--active/--ghost/--more, __badge/__label/__dot `#4ade80`)/`.z01-drop`/`.z01-card`(thumb/num/line/body/title/meta/side/quality/time), `@media(max-width:580px)`.
5. **Компонентные методы** (после `updateFilter`): `uiFrame`, `uiHero(items)`, `uiToolbar`, `uiToggleSource`, `uiSourceRow`, `uiAppendItem(item,index)`.
   - Hero: title/descr/art из `object.movie`; `uiPickResume` → первый с `timeline.percent>0`; кнопка ▶ `maniya_continue`/`maniya_watch` (+`S{n} E{m}` для сериала); hint = активный источник · voice_name; мета бейдж + ★ + год + время; прогресс-бар, если `timeline.percent>0` и есть `Lampa.Timeline.render`; строка «Вариантов: {n}».
   - Селектор: label `maniya_source` + чип активного источника с шевроном; тап → раскрытие `.z01-drop`; каждый чип: бейдж+label+зелёный ● (show); активный кликается → сворачивает; скрытые (show:false) → `.z01-chip--ghost`; «Ещё N» при многих скрытых → `uiAllSources=true` и пересборка; `changeSource(k)` стартует с `ui.open=''`.
   - Item: `.z01-card` thumb (fallback `moviePoster`, onload→timeline-линия, onerror→img_broken), num `01…`, title, мета `voice_name ● Серия N ● время`, бейдж качества + время; hover:enter → play.
6. **`draw(items)`**: `render()` — если `Z01_UI_OK` строит `.z01`-каркас + `uiAppendItem`; после цикла — `uiHero`+`uiToolbar`. TMDB-обогащение имён серий + T039 `enrichDeadline` (2500ms) сохранены НЕТРОНУТЫМИ.
7. **Локализация**: `maniya_more_sources` («Ещё N»), `maniya_items_count` («Вариантов: N»), `maniya_continue` («Продолжить»), `maniya_episode`, `maniya_source`.

**Гейт** `Z01_UI_OK = window && document && document.createElement === 'function' && $ === 'function'`. В vm-песочницах тестов (`loadSandbox`/`loadComponentSandbox`, у них `document` без `createElement`) → `Z01_UI_OK=false` → legacy-путь, контракт-тесты не зависят от UI.

## Тесты

- `plugin-contract.test.js`: `sourceLabel` переведён на SKAZ-формат `'4K 🎬 Allo-XA'`; новый тест `shortQuality`/`sourceChipParts`/`escapeHtml` (2160p→4K, 1080→FHD, 720→HD, 480→SD, 4k uhd→4K, ''→'', null→''; chip `{name:'Lime',icon:'🌐',quality_label:'4K'}` → `{badge:'4K', label:'🌐 Lime'}`; fallback badge из name `KinoPUB 2160`→4K; escapeHtml `'<img "x">'`).
- **Suite: 825 / 817 pass / 1 fail / 7 skip.** Fail — только предсуществующий `availability-route.test.js:41`. 0 регрессий.

## Деплой на STAGING (95.85.241.121)

```
node scripts/generate-staging-plugin.mjs 5fb2c9e8 http://95.85.241.121
→ server/staging-public/maniya-online-staging.js  (82397 B, md5 16948a23a9ea99696f6074cbc0512ebd)
scp → /opt/maniya-online/server/staging-public/
systemctl restart maniya-online
```

**Верификация (live):**
- VPS md5 `16948a23…` == локальный md5.
- `http://95.85.241.121/api/lampa/version` → `{"staging":true,"build":"5fb2c9e8","model":true}`.
- Served-плагин (curl с `User-Agent: Lampa/…`): `z01-hero:39`, `uiHero:3`, `sourceChipParts:4`, `resolveVideosUrl:2` (T039 жив), `MANIYA_ONLINE_TOKEN_STAGING:2` (T034-изоляция).
- `.env` staging: `MANIYA_STAGING_ENABLED=true`, `MANIYA_STAGING_PLUGIN_BASE=http://95.85.241.121`, `MANIYA_STAGING_BUILD=5fb2c9e8`, **`DIRECT_PLAYBACK=false` НЕ ТРОНУТ** (эксперимент B продолжается).

**ПРОД:** не тронут. `/version` на plugin.maniya-kvn.online → 404 (route отключён на проде — ожидаемое). Ни одного запроса к PROD/nginx-изменений не делал.

## Остатки / опционально (по запросу)

- Прогресс-линии после просмотра на карточках-предпросмотрах (сейчас линия только в hero и при `timeline.percent>0`).
- Живой health-probe источников (зелёные точки реально играбельных) — пока точка = `show:true` из кардио-модели (серверная доступность).
- Кастомные чипы сезонов/озвучек (нативный `filter` остаётся).
- Приёмка HMI на реальном девайсе (Android Lampa) — следующий шаг; браузер/девайс может держать кэш старого плагина — нужен reload / чистый запуск.