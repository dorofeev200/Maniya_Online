# BALANCER-SKAZ-VEO-015 — VeoVeo: metadata «1080p/720p/…» и playback «Не удалось декодировать видео»

**Статус:** фикс подготовлен, **НЕ закоммичен, НЕ задеплоен** (ждёт отдельного разрешения).
**Дата:** 2026-08-15.
**Тайтл-кейс:** «Последний дом» / The Last House 2026, TMDB 1284041, IMDb tt32268156.
**Директива:** отображаемое имя источника «Ozvuchky - Full HD» НЕ менять; исследовать и починить
metadata (title в списке) и playback именно технического `veoveo`.

---

## 1. Root cause — metadata (title «1080p/720p/480p/360p» вместо названия)

RAW-карточка veoveo (online5.skaz.tv) несёт **название фильма в `title`** и метку качества в
инлайн-тексте (`_text`):

```json
{"method":"play","url":"http://h/1080.m3u8","translate":"1080p","title":"Последний дом (1080p)"}
```

Поле `quality` в data-json veoveo **отсутствует** (в отличие от filmix/всех других play-карточек).

`normalizerCardTitle` возвращал `card._text` первым: `"1080p"` маскировал `card.title`
(«Последний дом (1080p)»). Оригинальный Lampac (`plugin.js:544-559 parseJsonDate`) делает
ровно обратное: инлайн-текст, похожий на `/^\d+p$/i`, трактуется как **качество**, а в название
подставляется `object.movie.title` из data-json.

**Вывод:** `_text` = «1080p» — это метка качества, а не название. Потеря происходит в
`normalizerCardTitle` (SkazProvider.js, строки возврата `card._text` первым).

## 2. Root cause — playback «Не удалось декодировать видео»

veoveo-мастер (602 байта) содержит аудио-группу с **относительным** URI:

```
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio0",NAME="default",AUTOSELECT=YES,DEFAULT=YES,CHANNELS="2",URI="index-f1-a1.m3u8"
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=5200893,...,AUDIO="audio0"
/videos/1080/index-f1-v1.m3u8
```

`rewriteDirectiveUri` (proxy.js) переписывал только `#EXT-X-MAP` и `#EXT-X-KEY`. Относительный
`index-f1-a1.m3u8` оставался нетронутым. hls.js резолвит относительные URI против URL
плейлиста, который он получил, — **нашего** `/api/lampa/proxy?url=…master.m3u8` →
`https://plugin.maniya-kvn.online/api/lampa/index-f1-a1.m3u8` → **404 not_found**.
Аудио-группа (DEFAULT=YES, обязательная) падает → «Не удалось декодировать видео».

Правильный резолв (против реального CDN) — валидный HLS (200, 849 сегментов).

## 3. Skaz vs Maniya — сравнение запросов

| Шаг | Оригинальный Skaz (Lampac) | Maniya (до фикса) |
|---|---|---|
| Список | `lite/veoveo` → карточки data-json | тот же `lite/veoveo` (SkazClient) |
| Title | `parseJsonDate`: `/^\d+p$/i` текст → `object.movie.title` | `normalizerCardTitle` → `_text` первым («1080p») |
| Quality | `data.quality[text] = data.url` (синтез из текста) | `cleanedQualityMap(card.quality)` — у veoveo `quality` отсутствует → `{}` |
| Playback URL | `getFileUrl`: `method=='play'` → **прямой CDN-URL** плееру (без прокси) | **Всё через** `/api/lampa/proxy` (SSRF-allowlist, переписывание манифестов) |

Ключевое отличие: Lampac отдаёт плееру прямой CDN-URL → относительный аудио-URI резолвится
против реального CDN и работает. Maniya проксирует всё → относительный URI ломается.

## 4. Сравнение RAW-ответов

Одна и та же RAW-структура карточки veoveo (живой online5.skaz.tv, 200, application/json):

```json
{
  "method": "play",
  "url": "http://h/1080.m3u8",
  "translate": "1080p",
  "title": "Последний дом (1080p)"
  // "quality": <отсутствует>
}
```

+ инлайн-текст `<div>1080p</div>` (нормализатор кладёт его в `card._text`).

## 5. Сравнение нормализованных ответов (до фикса)

| Поле | OLD (прод, без фикса) | NEW (с фиксом) |
|---|---|---|
| `items[].title` | `"1080p"` / `"720p"` / `"480p"` / `"360p"` | `"Последний дом (1080p)"` … `(360p)` |
| `items[].quality` | `{}` | `{"1080p": "<proxy-url>"}` … `{"360p": …}` |
| `translate` / `voice_name` | `"1080p"` (метка качества) | `"1080p"` — без изменений |
| `url` | proxy | proxy (host отличается только базой: локальный vs прод) |

## 6. Redirect chain

- `api.rstprgapipt.com/.../1080/master.m3u8` → 307 → `vn50003.mvapspdmpg.com/.../1080/master.m3u8` (live, подтверждено Ф3/Ф4).
- Аудио-плейлист живёт на `deovi.mvapspdmpg.com`, варианты на `vn50003.mvapspdmpg.com` — оба поддомена `mvapspdmpg.com` (в `proxy.allowHosts` с GAP-012).
- `validateProxyTarget` валидирует redirect-цель по allowlist (GAP-012 тест) — цепочка разрешена.

## 7. HLS-валидация (живой мастер через прод-proxy)

- Мастер: 200, `application/vnd.apple.mpegurl`, 602 байта; аудио-группа `URI="index-f1-a1.m3u8"` (относительная).
- Правильный резолв аудио (`new URL(audioUri, realTarget)`): 200 HLS, **849 сегментов**.
- Первый сегмент аудио: 200, `video/mp2t`, head `47 40 00 10` — валидный MPEG-TS (0x47).
- Все 4 качества (1080p/720p/480p/360p) — идентичная структура мастера (Ф4): единая причина.

## 8. Причина ошибки декодирования (итог)

Не переписанный относительный аудио-URI `#EXT-X-MEDIA`. Не URI-переписывание остальных
элементов работает: MAP/KEY уже переписывались (регрессия 00:00), сегменты/варианты (не-директивы)
тоже. Падала только аудио-группа, из-за которой hls.js не мог собрать медиа → decode error.

## 9. Изменённые файлы (5; фикс — 2, тесты — 3)

1. **`server/src/proxy.js`** — `rewriteDirectiveUri`: регекс `^#EXT-X-(?:MAP|KEY):` → `^#EXT-X-[A-Z0-9-]+:` (любая URI-директива: `#EXT-X-MEDIA`, `#EXT-X-I-FRAME-STREAM-INF` и т.д.).
2. **`server/src/providers/skaz/SkazProvider.js`** — `normalizerCardTitle`: метка качества (`/^\d+p$/i`) → вернуть `card.title`; новый `cardQualityMap`: синтез `{label: url}` из `_text`/translate при отсутствии `card.quality`; `movieVideos` play-ветка переключена на `cardQualityMap`.
3. **`server/test/proxy.test.js`** — маршрут `/veoveo-master.m3u8` (точная копия реального мастера) + тест переписывания `#EXT-X-MEDIA`.
4. **`server/test/skaz-provider.test.js`** — 3 регресс-теста veoveo.
5. **`server/test/api.test.js`** — 2 фикса date-drift (pre-existing, см. §13).

## 10. Diff summary

```
 server/src/providers/skaz/SkazProvider.js | 27 ++++++++++++-
 server/src/proxy.js                       | 11 ++++--
 server/test/api.test.js                   |  6 ++-
 server/test/proxy.test.js                 | 45 ++++++++++++++++++++++
 server/test/skaz-provider.test.js         | 64 ++++++++++++++++++++++++++++++-
 5 files changed, 146 insertions(+), 7 deletions(-)
```

**prod-код: +38/−4 строки.** Ключевые изменения:

```diff
// proxy.js
-  const match = String(line).match(/^(#EXT-X-(?:MAP|KEY):.*?\bURI=")([^"]+)(".*)$/);
+  const match = String(line).match(/^(#EXT-X-[A-Z0-9-]+:.*?\bURI=")([^"]+)(".*)$/);

// SkazProvider.js — normalizerCardTitle
+  const text = String(card._text || '').trim();
+  if (/^\d+p$/i.test(text) && card.title) return String(card.title).trim();

// SkazProvider.js — movieVideos play-ветка
-  quality: cleanedQualityMap(card.quality, streamProxy),
+  quality: this.cardQualityMap(card, streamProxy),
```

## 11. Тесты

- **Полный suite:** `cd server && NODE_ENV=test node --test` → **559 тестов, 553 pass, 0 fail, 6 skip** (skip pre-existing, гейтнутые).
- Новые регресс-тесты:
  - `proxy.test.js`: `proxyMedia: #EXT-X-MEDIA аудио-URI переписывается на прокси` — на точной копии veoveo-мастера.
  - `skaz-provider.test.js`: `veoveo: play-карточка — title из data-json`, `veoveo: quality-map синтезируется`, `play-карточка с НЕкачественной меткой: без изменений` (защита от регрессии filmix/alloha).
- Затронутые файлы: 52/52 (skaz-provider + proxy) и полный suite зелёный.

## 12. Live shadow (NEW vs OLD, «Последний дом» 2026)

Запуск: локальный NEW-сервер (фиксы в коде, `USERS_FILE`/`SKAZ_UID` из temp) против прод-OLD
(plugin.maniya-kvn.online, без фиксов).

**Metadata** (один и тот же `/api/lampa/videos?provider=skaz-veoveo`):

| # | OLD title | OLD quality | NEW title | NEW quality |
|---|---|---|---|---|
| 0 | `"1080p"` | `[]` | `"Последний дом (1080p)"` | `["1080p"]` |
| 1 | `"720p"` | `[]` | `"Последний дом (720p)"` | `["720p"]` |
| 2 | `"480p"` | `[]` | `"Последний дом (480p)"` | `["480p"]` |
| 3 | `"360p"` | `[]` | `"Последний дом (360p)"` | `["360p"]` |

**Playback** (на ЖИВОМ мастере; CDN `rstprgapipt.com` недоступен с локальной машины, поэтому
мастер получен через прод-proxy — сервер до него дотягивается):

```
REAL #EXT-X-MEDIA: ...URI="index-f1-a1.m3u8"          (относительный)
OLD regex (^#EXT-X-(?:MAP|KEY)): НЕ МАТЧИТ → URI относительный
hls.js-resolve (OLD, против прокси-мастера): https://plugin.maniya-kvn.online/api/lampa/index-f1-a1.m3u8 → 404

NEW regex: МАТЧИТ → URI="…/api/lampa/proxy?url=https%3A%2F%2F…index-f1-a1.m3u8"
correct-resolve (NEW, против реального CDN): 200 application/vnd.apple.mpegurl, isHLS=true, 849 сегментов
first audio segment: 200 video/mp2t, head 47 40 00 10 (валидный TS)
```

Все CHECK-условия: title не голый `\d+p`, title несёт название фильма, качество синтезировано у
всех 4 карточек, url идёт через прокси — **OK**.

## 13. Regression matrix

| Проверка | Результат |
|---|---|
| Название источника «Ozvuchky - Full HD» (PROVIDER_META meta.js) | **Без изменений** |
| `veoveo → Ozvuchky` маппинг | **Без изменений** |
| filmix play-карточки (несут `quality`, `_text`=`"DVO [1080+, …]"` — НЕ `^\d+p$`) | Не затронуты (тест «НЕкачественная метка») |
| alloha call-карточки (`_text`=`"ViruseProject"`) | Не затронуты |
| Serial-путь veoveo (эпизоды method:play) | Существующий тест serial-veoveo проходит |
| `cleanedQualityMap` (or-split, все существующие тесты 548-593) | Без изменений |
| X-MAP/X-KEY переписывание (регрессия 00:00) | Тест на месте, проходит |
| Redirect 307 GAP-012 | Тест на месте, проходит |
| **date-drift в api.test.js** (pre-existing, НЕ связано с фиксом): `expires_at=2099-12-31` → 2026-08-15 осталось 26801 «день»/26802 «дня», регекс ждал только «дней». Сервер (`status.js` pluralDays) корректен; починена проверка → `/^Осталось \d+ (день|дня|дней)$/` | Исправлено в тесте (2 строки) |
| Полный suite | 559/0 fail |

## 14. Fix risk

- **Минимальный** (prod-код +38/−4). `cardQualityMap` синтезирует мапу **только** если `card.quality`
  пуст И `_text`/translate — метка `^\d+p$` И есть URL; для всех остальных карточек поведение
  прежнее (мапа из `cleanedQualityMap`, title из `_text`).
- `normalizerCardTitle`: метка `^\d+p$` забирает `card.title` только при наличии title; иначе
  прежний путь.
- Плейback-фикс затрагивает только относительные URI-директивы манифеста; уже переписываемые
  MAP/KEY продолжают работать (тесты на месте). Не-URI директивы не тронуты.
- Никаких изменений availability/show/hide, качества не скрываются, «Ozvuchky - Full HD» не трогался.

## 15. Что НЕ изменено

- Имя источника «Ozvuchky - Full HD» (presentation name) — **не тронуто**.
- Маппинг `veoveo → Ozvuchky` — не тронут.
- Новые провайдеры — не добавлялись.
- Workaround «если veoveo» — нет: оба фикса общие (URI-директивы HLS; синтез title/quality для
  любой play-карточки с меткой `\d+p` без `quality`), не привязаны к slug.
- Проверки (availability, per-card, allowlist) — не отключались.
- Redirect chain / SSRF-гард / allowlist — без изменений.
- **Коммит и деплой — НЕ выполнялись** (ожидается отдельное разрешение).

---

### Сводка для действий

1. Фикс метаданных: `SkazProvider.js` (normalizerCardTitle + cardQualityMap + movieVideos).
2. Фикс playback: `proxy.js` (rewriteDirectiveUri — любые URI-директивы).
3. Регресс-тесты: 4 новых (proxy 1, skaz-provider 3) + 2 фикса date-drift в api.test.js.
4. Полный suite: **559, 0 fail**.
5. Live shadow: metadata и playback подтверждены на реальном «Последнем доме» 2026.
6. **STOP.** Коммит/деплой — только после отдельного разрешения.
