# SKAZ-MANIYA TASK-047 — UI/UX-правки по живой жалобе юзера

**Статус:** ✅ STAGING задеплоен. Bundle md5 `351920dd` (source 116 179 B → served 116 585 B).
**Дата:** 2026-08-23 (~23:55)
**Гейт:** Suite **827 / 820 pass / 0 fail / 7 skip** (добавлены регрессионные T047b). PROD НЕ ТРОНУТ (0 обращений).
**Деплой:** `/opt/maniya-online` (staging 95.85.241.121), service `maniya-online` active,
`/api/lampa/version` → `{staging:true, build:5fb2c9e8, model:true}`.

## Жалоба юзера (сегмент, verbatim)
> «еще один нюанс левая сторона когда открываешь источники и фильмы слишком близко к краю, нет
> продолжить просмотр при открытии фильма и не показывается на фильме полоска и время сколько фильм
> идет и нет справа качества fhd, hd или 4К и картинку постера где Сотреть в Мания нужно чуть шире»
> «и заметил при открытии источников они динамично моргают либо появляются или исчезают»

## Root causes (по реверсу SKAZ onlines.latest.js + Lampac Online/plugin.js)

1. **Нет «Продолжить просмотр» / полоски / времени.** SKAZ ставит на каждый item:
   `hash_timeline = Lampa.Utils.hash(сериал ? [season, season>10?':':'', episode, original_title].join('')
   : original_title)` → `element.timeline = Lampa.Timeline.view(hash)`; `element.time =
   secondsToTime((episode?episode.runtime:movie.runtime)*60, true)`. Наши items никогда не получали
   `timeline/time` — uiHero/uiAppendItem уже имели весь рендер (started/button/bar/time), но поля пустые.
   При просмотре core Lampa сам обновляет timeline через `play.timeline` = тот же объект view(hash).
2. **Нет качества справа.** `.z01-card__side` (quality+time) прятался в media ≤580px (`display:none`).
   На телефоне юзера бейдж FHD/HD/4K и время не рендерились вообще. SKAZ grid держит side на мобиле.
3. **Край слева.** `.z01{display:block;width:100%}` без отступа — тулбар/чипы/карточки вплотную к экрану.
   SKAZ `.skaz{padding:0 0 3em 0}` (низ), левого отступа у SKAZ нет — добавляем деликатный .75em.
4. **Постер узкий.** `.z01-card--file .z01-card__thumb{width:4.4em;height:4.4em}` — у фильмов квадрат 4.4em
   (постер «Смотреть в Maniya» маленький). Расширяем до 12em×6.75em (как сериалы).
5. **Моргание источников.** В `probeSources` late-callback'и после settle (`finished=true`, draw нарисован)
   вызывали `self.updateFilter(); self.uiToolbar();` → тулбар перестраивался ПОВЕРХ открытой панели →
   чипы появлялись/исчезали/смещались. Победитель подтверждался раньше других → они догоняли после draw.

## Изменения (все в `public/maniya-online.js`, Z01-gated)

- **`applyTimelineModel(item)`** (новая, рядом с moviePoster): hash_timeline → `item.timeline =
  Lampa.Timeline.view(hash)`, `item.time = secondsToTime(runtime*60)`; зовётся в начале каждого
  item в `draw()/render()`. Хэш идентичен SKAZ → прогресс «Продолжить просмотр» переживает переходы
  между источниками (даже между SKAZ-плагином и Maniya на том же девайсе).
- **`uiRefreshGhost()`** (новая): ghost-вердикт ПОСЛЕ отрисовки не перерисовывает тулбар — точечно
  `drop.replaceWith(this.uiSourceRow())` только когда панель открыта. `done()/kill()` → вместо
  `self.updateFilter(); self.uiToolbar();` → `self.updateFilter(); self.uiRefreshGhost();`.
- **meta карточки**: добавлен «Осталось N» (SKAZ `skaz_left`, onlines 2539-2541) когда
  `timeline.percent>0 && duration>time`.
- **CSS**: `.z01{padding:0 0 3em .75em}` + `.z01-hero{margin-left:-.75em}` (hero-арт до края);
  `.z01-card__thumb`/`--file`/skeleton 10.5em→**12em×6.75em** (постер шире); media ≤580px:
  **`.z01-card__side` больше НЕ прячется** (компакт 0.64em badge / 0.82em time), thumb 8em×4.5em.
- **Переводы**: `maniya_continue` → «Продолжить просмотр»; `maniya_left` = «Осталось» (новая).

## T047b — фикс «ReferenceError: object is not defined at applyTimelineModel» (юзер-репорт)

После первого деплоя (6a70e879) юзер прислал JS-ошибку на девайсе: `ReferenceError: object is not
defined at applyTimelineModel … /staging/4f3a9c21e7b64d08a5c2f1e9.js:320:33`, цепочка
`applyTimelineModel → Array.forEach → render → component.draw`.

**Root cause:** `object` в Lampa — замыкание фабрики `component(object)` (скоуп плагина), а НЕ
глобал модуля. Модульная функция `applyTimelineModel(item)` обращалась к `object.movie` → на
реальной Lampa (`Z01_UI_OK=true`) ReferenceError при КАЖДОЙ отрисовке ряда. Suite этого не ловил:
в vm-песочнице нет `document.createElement` → `Z01_UI_OK=false`, гвард
`if (!Z01_UI_OK …) return` срабатывал ДО обращения к `object.movie`.

**Фикс:** сигнатура → `applyTimelineModel(item, movie)`, все `object.movie` → `movie`; call site в
`draw()/render()` передаёт `applyTimelineModel(item, object.movie)` (там `object` в скоупе
компонента). Деплой: `70ea5a57` (source 115 911 B → served 116 056 B).

**Регрессионный тест `T047b`** (plugin-contract.test.js): статически проверяет, что тело модульной
функции не ссылается на глобальный `object(.movie)`, а call site передаёт `object.movie` из
компонентного скоупа. Поймал бы этот класс ошибок на будущее (сам был пойман на CRLF —
нормализация `\r\n`→`\n` перед регэкспами).

## T047c — сериалы: «Продолжить просмотр» строился ТОЛЬКО по original_title

Живой тест юзера: кнопка появилась на фильме. Зазор — сериалы: guard
`!movie.original_title` в `applyTimelineModel` срабатывал на сериальной карточке Lampa
(у неё `original_name`, а не `original_title`) → timeline не строился вовсе → для сериалов
«Продолжить просмотр»/полоска/время не появились бы никогда. Канон Lampac (DLNA plugin.js:328):
сериал хэширует по `element.tmdb.original_name`, фильм — по `original_title`.

**Фикс:** `var key = movie.original_title || movie.original_name || movie.name || movie.title || ''` —
guard и оба варианта хэша (фильм/сериал) на производном `key`. Деплой `351920dd`
(source 116 179 B → served 116 585 B). Regress-тест T047b расширен: фолбэк `original_name`.

## Верификация
- Локальный md5 `351920dd...` == VPS. restart → active. Served (Lampa-UA) 116 585 B = source + подпись.
- Маркеры в served: `applyTimelineModel ×2`, `uiRefreshGhost ×3`, `hash_timeline ×4`,
  `original_title.*original_name ×3`, `|| movie.original_name ×2`, «Продолжить просмотр ×2».
- Suite **827/820/0/7** (было 826/819 + регрессионный T047b). PROD: 0 обращений.

## Следующий шаг
Девайс reload подписки → проверить: «Продолжить просмотр» после начала фильма (посмотреть ~1 мин,
вернуться), полоска в hero/карточке, время «Осталось», качество справа на телефоне, постер шире,
левые отступы, источники без моргания.