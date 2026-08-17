# RUTUBE-HD-FIX-001 — native-first для фильмов (Rutube HD): реализация

**Дата:** 2026-08-16 · **Режим:** IMPLEMENTATION (commit/push/deploy **НЕ делались** — STOP)
**Вход:** `docs/rutube-hd-playback-audit-001-report.md` (root cause доказан, повторный аудит не проводился).
**Scope:** исправить только выбор native Rutube для фильмов. Изменены 4 файла + 1 новый тест-файл; vkmovie/RUmovie-1, proxy.allowHosts, availability/W1, Kodik/Collaps/Filmix/Rezka, provider ID НЕ тронуты.

---

## 1. Root cause (из аудита, кратко)

`store.js` при одиночном провайдере и **фильме** выбирал **twin-first**: `chosen = (twin?.items?.length) ? twin : native`. Живой нод кластера по `lite/rutubemovie` (77.90.33.109) отдаёт `method:"call"` карточки скрытого `skaz-rutubemovie`, вытесняя рабочий native-play; резолв call возвращает неиграбельный JSON (`quality.auto:null` / 404 `video_not_found`) → клиент видит «не удалось получить ссылку». Native Rutube при этом исправен end-to-end (master 200 / variant 206 / segment 206).

## 2. Изменение (минимальное, только выбор payload)

### `server/src/store.js` — `getVideosForRequest`, single-provider ветка
Ветки сериала и фильма **объединены в одно правило: native первым, skaz-близнец — фоллбэк при пустом native** (ровно семантика, уже применённая для сериалов в FILMIX-004):

```diff
-    // Для сериалов native первым, skaz-близнец — фоллбэк. … Фильмы оставляем близнец-первым …
+    // Native первым (и для сериалов, и для фильмов), skaz-близнец — фоллбэк.
+    // … RUTUBE-HD-FIX-001 (фильмы): близнец-первая ветка отдавала `method:"call"`
+    // карточки skaz-<balancer> раньше рабочего native, а резолв call на кластере
+    // возвращал JSON `quality.auto:null` → клиент видел «не удалось получить ссылку» …
     const serialRequest = isSerialRequest(context.query);
     let chosen = null;
-    if (serialRequest) {
-      const native = await payloadOrNull(primaryProvider, context);
-      if (native?.items?.length) chosen = native;
-      else if (selected) chosen = await twinForPayload(selected, context);
-    } else {
-      const twin = selected ? await twinForPayload(selected, context) : null;
-      chosen = (twin?.items?.length)
-        ? twin
-        : (await payloadOrNull(primaryProvider, context))
-          || twin
-          || null;
+    const native = await payloadOrNull(primaryProvider, context);
+    if (native?.items?.length) {
+      chosen = native;
+    } else if (selected) {
+      chosen = await twinForPayload(selected, context);
     }
```

Поведение при отсутствии `selected` не изменилось (twin недостижим → native payload или null). «Никогда не объединяем — либо twin, либо native» сохранено.

### `server/src/providers/registry.js` — комментарий (без логики)
«twin-first в store.js» → «native-first в store.js, близнец — фоллбэк при пустом native». Только текст.

## 3. Изменённые файлы

| Файл | Что |
|---|---|
| `server/src/store.js` | объединение веток: native-first для фильмов (единственное поведенческое изменение) |
| `server/src/providers/registry.js` | только комментарий |
| `server/test/store-serial-preference.test.js` | movie-тест переписан под native-first (`calls.twin === 0` при живом native) |
| `server/test/store-movie-native-first.test.js` | **новый** — 4 regression-теста на главный баг |

## 4. Regression-тесты (новый файл, provider=rutubemovie)

1. **[главный баг]** native playable + twin `method:"call"`-карточки → выбирается native, `calls.twin === 0`.
2. native playable + twin тоже playable → всё равно native (native-first, без дублей — `items.length === 1`).
3. **[обратный сценарий]** native `items:[]` + twin playable → twin остаётся фоллбэком (`native >= 1 && twin >= 1`).
4. native и близнец пусты → пустой payload `{items:[],seasons:[],voices:[]}` без исключений.

**Suite:** `cd server && NODE_ENV=test node --test` → **623 tests / 617 pass / 0 fail / 6 skip** (было 619/613/+4 новых; серещие 6 skip — исторические). Регрессии rutubemovie/vkmovie/filmix/alloha/veoveo/rezka/kinopub/kodik зелёные.

## 5. Live verification (VPS, темп-сервер :3101, prod creds/.env, прод-пользовательский токен; токены нигде не печатались)

Темп-копия `/tmp/maniya-fix001` = прод `/opt/maniya-online` + два изменённых файла (sha1 store.js сверен). PUBLIC_BASE_URL=localhost:3101 (без выхода в сеть). Прод health 200, прод server не трогался.

| Фильм | /sources/card | /videos native-first | master → variant → segment (через наш proxy) | Итог |
|---|---|---|---|---|
| Матрица (1999) | 17 источников, rutubemovie show:true | **1 item `method:"play"`** | master **200** mpegurl `bl.rutube.ru` → variant **206** `river-4-439.rtbcdn.ru` → segment **206** `video/MP2T` (MPEG-TS ✓) | ✔ **PASS_RANGE206** |
| Интерстеллар (2014) | 17, show:true | **1 item `method:"play"`** | master **200** `bl.rutube.ru` → variant **206** `river-4-445.rtbcdn.ru` → segment **206** MP2T ✓ | ✔ **PASS_RANGE206** |
| Аватар (2009) | 17, show:true | native **0** (см. §6) → twin fallback: 7 `method:"call"` | резолв call → **404 `video_not_found`** (fallback сохранён, как было) | fallback (не регрессия) |
| Дюна: Часть 2 (2024) | 17, show:true | native **0** → twin fallback: 11 `call` | резолв call → 404 (fallback) | fallback (не регрессия) |
| Аннигиляция (2018) | 17, show:true | native **0** → twin fallback: 7 `call` | резолв call → 404 (fallback) | fallback (не регрессия) |

«resolve» для native play-элементов **не вызывается** (у native нет `resolveVideo`, `/api/lampa/video?provider=rutubemovie` → 404 `null` — это by design: play-карточки несут URL напрямую; битая resolve-цепочка всплывала только у call-twin, и именно её фикс убрал из первого приоритета).

### Регрессии (live, Матрица)
- **vkmovie**: 21 item `method:"play"`, первый через proxy → **206 `video/mp4` `ftypisom`** ✔ (путь не тронут).
- skaz-alloha: 7 items, veoveo: 1 `play` «Матрица (1080p)»; kinopub/kodik/rezka/filmix/hdvb: 0 — pre-release layered-паттерн, diff по их коду = 0.
- rutubemovie `serial=1`: 1 play-item (реакция) — ветка единая, Rutube movie-only, поведение идентично до фикса (не регрессия).

## 6. Почему Аватар/Дюна2/Аннигиляция остались на fallback — и почему это вне scope

Прямой пробой native-пути (RutubeClient.search + RutubeProvider.videos):
- **Аватар, query «Аватар 2009»**: 14 результатов — реальный фильм в проходящей форме отсутствует (полный фильм «Avatar (2009) Full Movie…» — англ. титры, не содержит кириллического «аватар»; остальное — трейлеры/шоу/игры, cat ≠ 4 или год в титре не 2008–2010). `searchResults` отсекает всё → native 0.
- **Дюна 2 / Аннигиляция**: в выдаче по кириллическому запросу реального фильма нет (рецензии, стримы, сплавы; cat 4/57/73…). Вероятно, полные копии не хостятся/не проходят фильтр.

Это **вопрос качества Rutube-поиска (RutubeProvider.search / RutubeClient / RutubeNormalizer)** — не «выбор native для фильмов». По условию задачи («исправить только выбор native Rutube», STOP при необходимости расширения scope) здесь останавливаюсь и не расширяю scope: тренируемые фильмы, где native даёт items, теперь идут native (главный баг — «битый twin над рабочим native» — устранён); где native пуст — сохранён fallback на близнеца (дословно: «Twin должен оставаться доступным как fallback, если native действительно не даёт playable content»).

**Отдельно зафиксированные находки (НЕ правки этой задачи, кандидаты на волну RutubeNormalizer):**
- Матрица: native-item = «Реакция на фильм Матрица (1999)» (реакшн-видео, не сам фильм) — в `EXCLUDE_WORDS` нет «реакция»/«смотрим»/«вместе»; и до фикса это был единственный native-item Матрицы. Играется корректно (206/206/206), но контент неверный → добавить слова-исключения + возможно `original_title`-запрос (англ. титры Аватара) в отдельной волне.
- Rutube-serial: фильмовая выдача при `serial=1` (Rutube movie-only) — вне scope.

## 7. Cleanup и STOP

- Темп-сервер на :3101 остановлен (PID 54149), `/tmp/maniya-fix001` и probe-скрипты удалены, локальные probe-скрипты удалены.
- Прод: `maniya-online` active, `/health` 200 — не затронут.
- **STOP: commit/push/deploy НЕ делались.** Рабочее дерево: только 3 изменённых файла + 1 новый тест в этой задаче (прочие изменения в git status — исторический дрейф прежних сессий, не этой задачи).

## 8. Итог

| Метрика | Значение |
|---|---|
| Поведенческое изменение | 1 участок `store.js` (объединение веток, native-first) |
| Новые тесты | 4 (главный баг + обратный сценарий + no-dup + empty) |
| Suite | 623/617 pass / 0 fail / 6 skip |
| Live | 2/5 фильмов native-first playable end-to-end (206/206/206, bl.rutube.ru → river-*.rtbcdn.ru); 3/5 — fallback на twin (сохранён по требованию); vkmovie 206 MP4 — регрессий нет |
| Не в scope | улучшение Rutube-поиска/нормалайзера (отдельная волна), прокси/allowHosts/W1/мета — не тронуты |

**RUTUBE-HD-FIX-001 — реализация завершена, готова к ревью; commit/push/deploy — НЕ выполнены.**