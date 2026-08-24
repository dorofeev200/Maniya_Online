# SKAZ-MANIYA TASK-043 — Панель опроса (found-text) + мёртвый источник (экран не убивается)

**Статус:** ✅ STAGING задеплоен и live-верифицирован (served md5 46064c29 = 99 665B = бандл+подпись). PROD НЕ ТРОНУТ.
**Дата:** 2026-08-23 (~19:05)
**Гейт:** Z01_UI_OK (modern, real браузер). Suite **826 / 819 pass / 0 fail / 7 skip**.

## Девайс-фидбек юзера (после T042)

> «некореектно отображается и работает Опрашиваем источники - найдено источников: 14 6с, находит источники но если перейти на тот источник где видео не найдено все пропадает и не возможно изменить источник»

Два разных бага (оба клиентские):

### Б1. Панель опроса — текст «как в сказ»
Наш `uiLoadingPanel` показывал title «Опрашиваем источники» + текст «N с», а строка «Найдено источников: {n}» (перевод `maniya_polling_found`) **нигде не вызывалась**. SKAZ (onlines.js uiLoadingText/uiLoadingProgress, строки 1311-1336) делает: `text = found?«Найдено источников: {n}»:«Опрашиваем источники» + « · Nс»`, при ≥12с и percent<100 добавляет « · отвечают медленно», бар `max(percent, min(90, sec*7))`. found = count(show) из ответа events.

**Фикс (public/maniya-online.js):**
- module state: `uiPollFound`(-1)/`uiPollPct`/`uiPollBar`/`uiPollText`.
- `this.uiLoadingText()` — точная семантика SKAZ; само-стоп, если панель отвязана от DOM (`!uiPollText.parent().length`), как в SKAZ 1312.
- `uiLoadingPanel()` — тикает `uiLoadingText` каждую 1с.
- `applyCardAvailability()` — убрал ранний `uiPollStop()`, ответ балансера → `uiPollFound = shown.length` (modelMode) / `filterSources.length` (legacy) + `uiPollPct = 95` + `uiLoadingText()`. Панель живёт до отрисовки, как SKAZ (uiLoadingStop в uiDraw).
- переводы `maniya_polling_slow` («отвечают медленно»), `maniya_sec` уже был.

### Б2. Мёртвый источник → «всё пропадает, невозможно сменить»
`draw(items)` при 0 items и error-колбэк `loadVideos` дергали `empty()` → `scroll.clear()` → **весь z01-UI (hero+тулбар+селектор) выносился**, вернуться к выбору источника было нечем. SKAZ на это показывает note (doesNotAnswer, 4500+) и держит тулбар/авто-свитч.

**Фикс:**
- `this.uiListEmpty(message, hint)` — в Z01: `uiFrame()` + `uiToolbar()` + `.z01-note` (title+hint) в списке; legacy → прежний `empty()`.
- `loadVideos()`: `!Z01_UI_OK` → reset() (прежний путь); `!uiPolling` (смена источника) → держим каркас+тулбар (`uiFrame()+uiToolbar()`), не `scroll.clear()`; `uiPolling` (первая загрузка) → панель живёт до ответа.
- error-колбэк и `draw([])` → `uiListEmpty('Видео не найдено', 'На текущем источнике нет этого фильма — смените его в списке выше')`.
- CSS `.z01-note/.z01-note__title/.z01-note__hint` в `maniya_css`.

**Поведение теперь (SKAZ-эквивалент):** заголовок «Опрашиваем источники», строка «Найдено источников: N · Nс» (бар 95%, slow-нота ≥12с) → отрисовка → hero+тулбар+список. Смена на пустой источник → «Видео не найдено» + селектор живой — можно переключиться. Второй фильм → снова опрос → снова источники.

## Деплой и верификация
- Бандл `03c322071b885d33741148cbbb00e2e6` (99 520B), VPS md5 == локальный; restart → active; `/api/lampa/version` → `{staging:true, build:5fb2c9e8, model:true}`.
- Served (Lampa-UA) md5 `46064c29` (99 665B = 99 520 + 145 подпись токеном), маркеры `uiListEmpty|maniya_switch_source|z01-note` ×11.
- `MANIYA_API_BASE` в бандле = `http://95.85.241.121/api/lampa` (staging, НЕ PROD).
- `.env` DIRECT_PLAYBACK=false НЕ тронут. **PROD: 0 обращений.**

## Следующий шаг
Девайс reload подписки → проверить: панель «Найдено источников: N · Nс», переход на источник без видео → «Видео не найдено» + живой список источников, смена на рабочий → плей; 2-й фильм находит. Юзер также задал направление: зеркалить список/ссылки источников со SKAZ (чтобы их смена подтягивалась) — это отдельный серверный sync-этап (дизайн), не входит в этот фикс.