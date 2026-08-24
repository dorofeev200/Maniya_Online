# SKAZ-MANIYA TASK-041 — Девайс-wire: «фильмы не находит / всё пропадает» после кард-модели → фикс активного источника с index:null

**Статус:** ✅ ФИКС в modelMode задеплоен на STAGING и верифицирован. PROD НЕ ТРОНУТ.
**Дата:** 2026-08-23 (деплой ~21:15, bundle md5 5151e9bc…)
**Гейт:** `modelMode` (кардио-модель `/sources/card` с полем `index`). vm-песочницы тестов — legacy-путь без изменений. Suite 826/818/1/7 (fail — предсуществующий сетевой `availability-route.test.js`).

## Задача (девайс-фидбек юзера)

> «при первом входе в приложение и когда заходишь на фильм показывается новый дизайн, выбираются источники, находятся фильмы при нажатии долгая загрузка и фильм не воспроизводится, если перейти на другой фильм все пропадает и фильмы не находит»

Симптомы после T041-панели «Опрашиваем источники» (деплой 18:04: loading panel + uiFrame reattach):
1. Открытие фильма — долгая загрузка, фильм не воспроизводится.
2. Переход на другой фильм — «всё пропадает», фильмы/источники не находятся.

## Root cause (единый): хранимый активный источник с `index:null`

Девайс-Nginx-форензика (сессия до этого отчёта):
- `Lampa.Storage` ключ `maniya_online_source` (наш же `changeSource`) ПЕРСИСТИТ выбранный источник между фильмами.
- Кардио-модель (`/sources/card`, `meta.model`) для каждой карточки возвращает источники кластера c `index` (server-подтверждённые, есть контент: kinopub 4 items, filmix 3 items) и Maniya-only extras c `index:null` (rhsprem/kodik — оптимистично `show:true` из реестра, их `/videos` → **0 items**).
- `applyCardAvailability` modelMode считал `activeChanged = shown.indexOf(activeSource) === -1`. rhsprem НАХОДИЛСЯ в `shown` (show:true) → `activeChanged=false` → активным оставался rhsprem → `loadVideos()` уходил на `/videos?provider=skaz-rhsprem` → 0 items → список пуст, «фильмы не находит» на КАЖДОМ фильме (пока сам не выберешь источник вручную).

Подтверждено `server/src/sources/sourceModel.js`: `index: o.index` (только кластерные события) vs extras `index: null` (native- и visibleSkaz-довески в конце, строки 125-168).

## Фикс (client-only, `public/maniya-online.js` applyCardAvailability modelMode)

Активный источник должен быть **подтверждён кластером для этой карточки** (`index != null`):

```js
var confirmedShown = shown.filter(function (key) { return sources[key].index != null; });
var activeStale = shown.indexOf(activeSource) === -1 ||
  (confirmedShown.length && sources[activeSource] && sources[activeSource].index == null);
if (activeStale) {
  activeSource = confirmedShown.length ? confirmedShown[0] : shown[0];
  activeSeason = null; activeVoice = null;
  Lampa.Storage.set('maniya_online_source', activeSource);
}
activeUrl = sources[activeSource].url;
```

Поведение:
- Хранимый источник подтверждён для новой карточки → остаётся (пользовательский выбор уважается).
- Хранимый источник `index:null` (rhsprem/kodik) → сброс на ПЕРВЫЙ подтверждённый показанный источник (server-order, kinopub/filmix).
- Нет подтверждённых вообще → fallback `shown[0]` (старое поведение).
- `updateFilter()+loadVideos()` в modelMode вызывались БЕЗУСЛОВНО → после перепривязки список сразу перезагружается с живым источником → «всё пропадает» закрыто (при условии свежего бандла на девайсе).

Legacy-ветка (статический реестр, нет `index`) не тронута — там уже был `!sources[activeSource] || !sources[activeSource].show`.

## Тесты и деплой

- Suite **826 / 818 pass / 1 fail / 7 skip** — 0 регрессий (единственный fail — предсуществующий сетевой `availability-route.test.js`, не связан с правкой).
- Staging bundle `server/staging-public/maniya-online-staging.js` 92552 B, md5 `5151e9bcb5ed0b4c9e7f9a79a46889f0`; VPS md5 == локальный; `systemctl restart maniya-online` → `active`.
- `/api/lampa/version` → `{"staging":true,"build":"5fb2c9e8","model":true}`.
- Served-плагин (Lampa-UA) маркеры: `confirmedShown|activeStale` ×5, `uiLoadingPanel` ×6, `z01-loading` ×13.
- `.env` **`DIRECT_PLAYBACK=false` НЕ ТРОНУТ** (эксперимент B).
- **PROD:** ноль обращений.

## Следующий шаг — девайс-приёмка (Android)

1. На девайсе: перезапуск Lampa / переустановка подписки (fetch нового бандла 21:15, md5 5151e9bc) — старый кэш плагина может держать предыдущий бандл.
2. Проверить: фильм → «Опрашиваем источники · Nс» → список ИСТОЧНИК (с тулбаром) → нажатие на видео → воспроизведение; переход на другой фильм → снова источники+плейбек (без «всё пропадает»).
3. Если плейбек call-method (skaz-резолв `/api/lampa/video`) всё ещё не играет — ловим девайс-wire `/api/lampa/video` и `/proxy`.