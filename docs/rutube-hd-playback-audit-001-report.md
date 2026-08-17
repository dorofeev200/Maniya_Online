# RUTUBE-HD-PLAYBACK-AUDIT-001 — «не удалось получить ссылку» (Rutube)

**Дата:** 2026-08-16 · **Режим:** READ-ONLY (код/тесты/config НЕ менялись, commit/push/deploy НЕ делались)
**Симптом:** «Rutube HD (rutubemovie): источник находится, карточка показывается, но при запуске Maniya пишет „не удалось получить ссылку“».

---

## 0. Объём и доказательная база

Прослежен полный pipeline на **проде** (VPS localhost:3000, реальный активный токен подписки, реальные creds SKAZ_* из prod .env; токены/секреты в отчёт не попали): `sources → sources/card → videos → resolve → play URL → Maniya proxy → Rutube CDN → segment` для 6 фильмов (Матрица/Аватар/Дюна:Ч2/Интерстеллар/ВК:Братство/Аннигиляция). Плюс прямой доступ к Rutube API и к кластеру `lite/rutubemovie`. Смешивания rutubemovie/vkmovie нет (разные provider/balanser; vkmovie не трогался).

## 1. Факты (live, прод)

**Нативный Rutube (rutubemovie) — РАБОТАЕТ end-to-end:**
1. `/api/lampa/sources` → `rutubemovie` show:true, «Rutube 📹 HD».
2. `/api/lampa/sources/card` (Матрица) → `rutubemovie show:true` (CONTENT, 17 источников).
3. `/api/lampa/videos?provider=rutubemovie` (Матрица) → **1 item `method:"play"`**, url = наш proxy(`https://bl.rutube.ru/route/….m3u8?guids=…&sign=…&expire=…`).
4. Master m3u8 через наш proxy → **200 `application/vnd.apple.mpegurl`**, `#EXT-X-STREAM-INF`-URI переписаны на наш proxy (правило VEO-015 работает), redirects=0.
5. Variant m3u8 через наш proxy → **206 m3u8**, сегментные URI переписаны на наш proxy.
6. Segment `.ts` через наш proxy (Range 0-1023, полный URL) → **206 `video/MP2T`**, MPEG-TS `G@…` (пишется в поток). Прямой запрос к CDN → тоже 206 MP2T.

→ Прокси-путь нативного Rutube: master 200 / variant 206 / segment 206, Range работает, hosts ниже покрыты allowlist.

**Кластерный Rutube (skaz-rutubemovie, twin) — БИТЫЙ:**
1. `/api/lampa/videos?provider=skaz-rutubemovie` (Матрица, первая прогонка) → items 0 (кластер мёртв). Матрица ушла на native → именно поэтому у Матрицы карточка РАБОТАЛА.
2. Аватар (повтор) → **2 items `method:"call"`** от `provider=skaz-rutubemovie` (карточки «Аватар | Avatar (2009, расширенная версия, 4K)» и «Аватар (фильм, 2009)») — кластер на 77.90.33.109 ответил.
3. Резолв call-карточки: `/api/lampa/video?provider=skaz-rutubemovie&voice=0` → **200, но play-URL = наш proxy(`http://77.90.33.109/lite/rutubemovie/play?linkid=…&account_email=…&uid=…`)** — это НЕ m3u8, а сам lite-эндпоинт кластера.
4. Прямой ответ кластера на `lite/rutubemovie/play?linkid=<рабочий linkid Матрицы>`: **`{"title":"auto","method":"play","quality":{"auto":null},"vast":{}}`** — `quality.auto = null`, m3u8 кластером НЕ получен (даже для linkid, который напрямую через Rutube API отдаёт m3u8!).
5. `resolveVideoJson` такой JSON отвергает (`parsed.url` отсутствует → null) → фолбэк `resolveStream` возвращает сам `lite/play` endpoint как финальный URL → клиент получает **JSON вместо медиапотока** → «не удалось получить ссылку».
6. Скан кластера по `lite/rutubemovie` (Матрица): online3/94.249.239.37/.11/77.90.33.109 → **503 `null`**, online8 → **`disable`**, 94.249.239.63 → пусто/timeout. RutubeMovie на кластере почти везде деградирован (ср. vkmovie жив 8/9 нод — но это другой балансер).

**Rutube API (чтобы исключить гео-блок как причину):** search + `play/options` дали `acl_access.allowed:true` и m3u8 для всех 6 фильмов (Матрица 784 B, Аватар 356 B, Дюна2 792 B, Интерстеллар 589 B, ВК 583 B, Аннигиляция 677 B). Первый-же linkid из search «Аватар» (e7655428…) → m3u8 есть. А вот для linkid кластерной карточки Аватара (fab94898…) native API → **`blocking_rule 10656141` «Видео недоступно из-за ограничений в вашей стране»** — т.е. ссылка, которую даёт кластер, сама по себе не воспроизводима (гео-ограничение конкретной ко... записи), и у кластера сама его play-страница возвращает auto:null. Двойной отказ, итог один — нативные карточки тоже не играются через twin.

**Подсказка пользователя (withsearch):** на online4 `{"name":"Rutube","url":"http://online4.skaz.tv/lite/rutubemovie","show":false,…}` — кластер САМ помечает rutubemovie как не рекомендуемый (show:false) в discovery.

## 2. Точный root cause (A)

Клиентская фраза «не удалось получить ссылку» = `maniya_nolink`, всплывает по 2 путям в `public/maniya-online.js` (820 — onError `requestJson` резолва call-карточки; 855 — пустой `play.url`). Причинный путь у Rutube — **ПЕРВЫЙ**:

- store.js при одиночном провайдере и **фильме** выбирает **twin-first**: `chosen = (twin?.items?.length) ? twin : native`.
- Когда любой живой нод кластера отвечает по `lite/rutubemovie` (в наблюдении 77.90.33.109), twin отдаёт `method:"call"` карточки, и они ВЫТЕСНЯЮТ рабочие native play-items.
- Резолв этих call на кластере возвращает `lite/rutubemovie/play` → JSON `quality.auto:null` (кластер не может взять m3u8 у Rutube) → `resolveVideoJson` отклоняет → фолбэк `resolveStream` отдаёт **URL самого lite-эндпоинта** как play-ссылку → плеер получает JSON, не HLS/MP4 → `maniya_nolink`.

Иначе говоря: **n-источник Rutube играется (native путь доказан), но twin-first подмена на скрытый skaz-rutubemovie даёт клиенту неиграбельные call-карточки, резолв которых возвращает JSON-dead-end вместо медиа — откуда «не удалось получить ссылку».**

## 3. Где ломается pipeline (B)

| Шаг | Результат |
|---|---|
| sources / sources/card | ✔ показываются (rutubemovie show:true) |
| videos (native) | ✔ items `method:"play"`, proxy(m3u8) |
| videos (store.js twin-first) | ✘ выбраны call-карточки skaz-rutubemovie (кластер жив) |
| resolve call | ✘ `lite/rutubemovie/play` → JSON `quality.auto:null` → фолбэк отдаёт сам lite-URL |
| Maniya proxy → Rutube CDN | ✔ для native URI (bl.rutube.ru/rtbcdn.ru покрыты); ✘ для twin (JSON вместо потока) |
| Playback | ✘ «не удалось получить ссылку» на twin-ветке; ✔ на native-ветке |

## 4. Реальный playback bug или upstream limitation? (C)

Оба. Нативный контур Maniya **не сломан** (доказано 200/206/206). Реальный воспроизводимый дефект — **порядок выбора в store.js (twin-first для фильмов) при битом twin**: он ставит неиграбельный call-дескриптор выше рабочего native-play. Upstream-ограничения, усугубляющие: (1) кластер по `rutubemovie` почти везде 503/`disable` и не умеет получить m3u8 (auto:null даже для рабочего linkid); (2) некоторые linkid кластерных карточек сами по себе гео-заблокированы (`blocking_rule`), и с ними и native не сыграл бы.

## 5. Файлы, требующие изменения (D)

1. `server/src/store.js` — фильмовая ветка single-provider: **native-first, когда у native есть items** (`method:"play"` с реальным потоком), twin — только как фоллбэк (или вовсе не подключать twin для провайдеров с играющим native). Это единственное действительно необходимое место.
2. (Опц.) `server/src/providers/skaz/SkazProvider.js` — `resolveCardItem`/`resolveStream`: не отдавать lite-endpoint-URL как play-ссылку, если резолв вернул не-поток (JSON без `url`/`quality.auto`); возвращать null → клиент увидит «нет данных» честно, а не битую ссылку.
3. (Опц.) `server/src/providers/skaz/SkazClient.js` — `resolveVideoJson` уже корректен (auto:null → null); менять не требуется.

## 6. Минимальный безопасный концептуальный фикс (E)

В `getVideosForRequest` одиночного провайдера, для **фильмов**: `nativePayload = await payloadOrNull(primary)` сначала; `chosen = nativePayload?.items?.length ? nativePayload : (await twinForPayload(selected)) || nativePayload`. Без изменения контракта провайдеров, без трогания availability/W1, без новых allowlist-записей. Сериальная ветка (native-first) уже сделана так же — фильмовая приводится к тому же правилу. Побочный эффект: для фильмов, где native пуст, но кластер жив, остаётся twin-фоллбэк (не хуже текущего).

## 7. Нужно ли менять allowHosts? (F)

**НЕТ.** Финальные Rutube-CDN хосты покрыты суффиксным allowlist:
- `bl.rutube.ru` → суффикс `rutube.ru` ✓ (в `proxy.allowHosts`);
- `river-4-439.rtbcdn.ru` → суффикс `rtbcdn.ru` ✓;
- кластер `77.90.33.109` (http) → в `httpAllowHosts` ✓.
Прокси натийного пути отвечает 200/206 без изменений конфигурации.

## 8. Реально используемые Rutube CDN hosts (G)

- Master m3u8: `https://bl.rutube.ru/route/{hash}.m3u8?guids=…&sign=…&expire=…`
- Variant/сегменты: `https://river-4-439.rtbcdn.ru/hls-vod/{vod_id}/{ts}/{…}/{…}.mp4.m3u8` и `.ts`-сегменты
- API: `https://rutube.ru/api/search/video/`, `https://rutube.ru/api/play/options/{id}/`
- Кластер twin: `http://77.90.33.109/lite/rutubemovie(, /play)` (+ прочие ноды по пулу)

## 9. SSRF/security-риски (H)

Дополнительного allowlist-расширения не требуется (см. F), поэтому новых SSRF-поверхностей фиксом НЕ добавляется. Существующее: `resolveStream`/`resolveVideoJson` ходят на кластер по пулу (httpAllowHosts), вызовы на Rutube API напрямую — белый список уже покрывает. Proxy-цепочка twin не должна (и не будет) тащить `lite/...`-URL как поток — это ограничивает попадание внутренних lite-эндпоинтов в плеер. Секреты (uid/account_email) в play-URL twin действительно присутствуют — фикс native-first уменьшает число таких цепочек, но они не новые (то же справедливо для всех skaz-call).

## 10. Регрессионная матрица (I)

| Контур | Ожидание при фиксе E |
|---|---|
| rutubemovie native (Матрица) | ✔ остаётся items play, 206/206/206, карточка работает → главное улучшение |
| rutubemovie twin (Аватар, 77.90.33.109) | ✔ больше не вытесняет native; при пустом native — честный empty (без битой ссылки) |
| vkmovie / RUmovie-1 | ✘ не задет (не имеет native-дубля; twinFor→null; порядок не применяется) |
| veoveo/kinopub/alloha (skaz-фильмы) | ✘ не задет: у них нет играющего native-closeido (или native скрыт/нуля) — twin first сохранён как фоллбэк |
| filmix/rezka/kodik/hdvb native+twin | ✘ порядок сериальной ветки уже native-first; фильмовая меняется симметрично, если native дал items — иначе старт twin |
| availability / W1 / pin | ✘ не задето (изменение только в store.js-выборе payload) |
| `/sources`, `/sources/card` | ✘ без изменений |

## 11. Что НЕ надо менять (J)

- `server/src/providers/rutube/*` — клиент/нормалайзер/провайдер НЕ трогать: они исправны (доказано 206 end-to-end).
- `server/src/proxy.js`, `config.proxy.allowHosts`/`httpAllowHosts` — НЕ трогать (покрытие достаточное).
- Skaz-архитектура (W1, pinnedHost, hostOrder, SkazClient-ротация) — НЕ трогать.
- `vkmovie`/RUmovie-1, presentation-мета — НЕ трогать (релиз fb15b21 уже PROD-verified).
- Кластерные ноды/allowlist pod 77.90.33.109 — не наш код, лечится только фиксом порядка выбора у нас.

## 12. Итог

- **Root cause:** twin-first выбор для фильмов в `store.js` ставит неиграбельные `method:"call"` карточки скрытого `skaz-rutubemovie` выше рабочего native Rutube; резолв таких call на кластере возвращает `{"quality":{"auto":null}}` (кластер не берёт m3u8), фолбэк отдаёт сам lite-endpoint как play-URL → клиент получает JSON вместо потока → «не удалось получить ссылку».
- **Native Rutube корректен:** master 200 / variant 206 / segment 206 MP2T через наш proxy; allowlist достаточен без правок.
- **«Rutube HD»/«Rutube»** — это native rutubemovie; никого иного за ним не скрыто (`lite/rutubemovie` = тот же Lampac OnlineRUS/RutubeMovie, что у нас native-клиент). «Видео недоступно в вашей стране» для отдельных linkid кластера — upstream-ограничение конкретных записей Rutube, не дефект Maniya.
- Фикс концептуальный (E) — один участок `store.js`; код/тесты не менялись по условию аудита.

**RUTUBE-HD-PLAYBACK-AUDIT-001 — READY FOR REVIEW**