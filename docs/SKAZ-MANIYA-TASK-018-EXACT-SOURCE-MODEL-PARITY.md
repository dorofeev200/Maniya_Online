# SKAZ-MANIYA-TASK-018 — EXACT SKAZ SOURCE MODEL / CARD UI PARITY

**Дата:** 2026-08-22. **Тип:** READ-ONLY differential (базис = **SKAZ**, актуальные данные кластера; E-Online = устаревший референс).
**Правило:** PRODUCTION / CODE / .env / CONFIG / NGINX / BALANCER — **NONE**. Только GET-диагностика; скрипты в `scripts/_t018_*.mjs` (не изменяют ничего), сырые артефакты в `docs/t018/*.json`, `docs/t018/static-sources.json`, `docs/t018/funnel.json`.

**Метод:** прямые ответы кластера SKAZ (`online3/online8/oleg6.skaz.tv`) за текущее окно 2026-08-22 vs производство Maniya `plugin.maniya-kvn.online` (тот же аккаунт `account_email`+`uid` из `server/.env`). Вход — не UI, а данные.

---

## 0. ТЕРМИНЫ / МОДЕЛЬ (что вообще есть)

| Понятие | SKAZ (базис) | Maniya |
|---|---|---|
| Discovery-реестр | `lite/withsearch` → 29 статических слагов (T011, индексная нумерация совпадает с online[]) | статический `PROVIDER_META`/registry → **21** источник (8 native + 13 skaz-мостов), `/api/lampa/sources` |
| Per-title модель источника | `lite/events` (без life) → **`online[]` = 32 записи на карточку** `{name,url,index,show,balanser,rch,voices,seasons}` (серверная правда проверки кластера по тайтлу) | `/api/lampa/sources/card` → **флаги `{id,show}` для тех же 21** статических id (probe-волны сервера Maniya) |
| Контент источника | deep-link `lite/<slug>` + card params → HTML `data-json` карточки; `rch:true` → `{"rch":true,ws,nws}` (WebSocket) | `/api/lampa/videos?provider=<id>` → `items[method:call|play]` (мост в те же кластерные страницы / native-каналы) |
| Эндпоинты Lampac-app `/sources/card`, `/videos` на кластере | **400** (не существуют; у SKAZ нет этих API — источники = online[]) | есть (миры Maniya) |

Подтверждено жёсткими GET: `online3.skaz.tv/sources/card` → **400**, `online3.skaz.tv/videos` → **400** (docs/t018/*.json `app`).

---

## 1. PHASE 1 — РЕАЛЬНЫЕ ОТВЕТЫ SKAZ (3 контрольные карточки)

Карточки: **Мятеж** (Mutiny, tt32338669/1288445/2026), **История игрушек 5** (tt29355505/1084244/2026), **Интерстеллар** (tt0816692/2014). Аккаунт из `server/.env` — тот же, что у ТВ.

### 1.1 Схема source-объекта (СВЕЖАЯ, обновлённая кластером)

`GET /lite/events?<card>` (200, 4.4–4.7 с) → JSON-массив из 32 объектов:
```json
{ "name":"Filmix ~ 4K", "url":"http://online3.skaz.tv/lite/filmix", "index":2,
  "show":true, "balanser":"filmix", "rch":false, "voices":0, "seasons":0 }
```
- **`name` несёт качество/бренд** («Filmix ~ 4K», «xVideoCDN (Ultra)», «Lumina - 720p», «СказTV», «Мир кино Z», «VK Видео»).
- **`index` = серверный порядок** (мастер-каталог: kinopub=1, filmix=2, alloha=4, rezka=5, pidtor=8, ashdi=13… zetflixdb=515, uakino=825).
- **`voices`/`seasons`** — числа голосов/сезонов, посчитанные кластером на тайтл (расширение актуальной версии SKAZ; E-Online legacy их не имел).
- **`rch:true`** — WebSocket-only (ashdi, kinoukr, eneyida): deep-link отдаёт `{"rch":true,"ws":…,"nws":…}`.
- **`show`** — кластерная «есть ли контент по тайтлу» (скрытие/показ на сервере).

### 1.2 Online[]-набор per title

| card | online[] | **shown** | hidden | rch shown | Maniya shown (для сравнения) |
|---|---|---|---|---|---|
| mutiny | 32 | **11** | 21 | 3 | 7 |
| toystory5 | 32 | **14** | 18 | 3 | 10 |
| interst | 32 | **24** | 8 | 3 | 19 |

Hidden записи **НЕ выкидываются** — они в том же массиве с `show:false` (это и есть скрытые чипы «Ещё N»).

### 1.3 Shown-списки SKAZ (базис)

- **mutiny (11):** 1 KinoPub(@online8), 2 Filmix ~ 4K, 4 Alloha, 8 СказTV(pidtor), 13 Ashdi(rch), 14 UAkino(rch), 15 Eneyida(rch), 18 Videoseed, 19 VeoVeo, 30 LordFilm, 31 Мир кино Z.
- **toystory5 (14):** KinoPub, Filmix ~ 4K, Alloha, Rezka, iRemux(rch), СказTV, Ashdi(rch), UAkino(rch), Eneyida(rch), Rutube, VK Видео, Geosaitebi, LordFilm, Мир кино Z.
- **interst (24):** KinoPub, Filmix ~ 4K, Alloha, Rezka, Zagonka(@**oleg6**.skaz.tv — хоста нет в пуле Maniya!), iRemux, СказTV, xVideoCDN (Ultra)(@online8), xVideoCDN (60/120fps)(@online8), FilmGE(kinoflix), Ashdi, UAkino, Eneyida, Rutube, VK Видео, VeoVeo, Солнце, HDVB, Kinotochka, Geosaitebi, VideoHUB 4k(cdnvideohub), LordFilm, Мир кино Z, ZetflixDB.

### 1.4 Deep-links (контент показанных)

Все показанные не-rch балансеры → 200 <1 с HTML `videos__line` + `data-json` (число карточек голосов/татул): kinopub 9.4КБ, filmix 3.7КБ, alloha 5.2КБ, rezka 5.1КБ, pidtor 2.8–24.9КБ, videoseed 5.3КБ, zagonka 21.7КБ(@oleg6), xvideocdnultra 2.7КБ; rch (ashdi/kinoukr/eneyida/remux) → `{"rch":true,"ws","nws"}`. Итог: **SKAZ показанный источник = кластерно-рабочий** (не пустой чип).

### 1.5 Сравнение deep-link-моста Maniya (mutiny, точка)

| balanser | SKAZ кластерный page | Maniya `/videos` (тот же момент) |
|---|---|---|
| videoseed | 200, 12 data-json | 200, **items 12** |
| filmix | 200, 3 data-json (MP4 2160/1440/1080 werkecdn) | 0–3 items (в окне транзиента native-filmix JSON-канал → EMPTY; см. PHASE 3) |
| veoveo | 200, 1 data-json (**season**-карточка) | 0 items (тип-сезон ↔ movie-дескрипторы) |
| pidtor | 200, 4 data-json (торрент-дескрипторы) | 0 items (фильтр `isTorrentDescriptor`, by design) |

---

## 2. PHASE 2 — СТРУКТУРНОЕ СРАВНЕНИЕ (SKAZ vs MANIYA, поле-за-полем)

| FIELD | SKAZ (базис) | MANIYA | FIRST DIVERGENCE | EFFECT |
|---|---|---|---|---|
| Discovery list | кластерный статик 29 | локальный реестр **21** | **ДА — здесь впервые различаются входные наборы** | разный периметр источников с самого начала |
| Per-title модель | server-generated **online[] 32** (`{name,url,index,show,balanser,rch,voices,seasons}`) | реестр 21 + флаги `{id,show}` от probe | **ДА (DATA-MODEL)** | 32 vs 21; per-title состав vs статичный |
| Число показанных | 11 / 14 / 24 | 7 / 10 / 19 | ДА | меньше чипов на ТВ |
| name (видимый) | серверное: «KinoPub», «Filmix ~ 4K», «СказTV», «VK Видео», «Мир кино Z» | meta.js: «Lime - 4K», «Filmix - 2160p», «PidTor - 4K», «RUmovie-1 - Full HD», «GeoVideo - Full HD» | ДА (отображение) | те же бэкенды выглядят как ДРУГИЕ источники |
| icon | Lampa/плагин по имени | эмодзи meta.js (свои) | ДА (отображение) | другой визуальный ряд |
| quality | в `name` («~ 4K», «- 720p») | отдельное `quality_label` | ДА (форма) | одинаково «качество в чипе», но средства разные |
| voices / seasons | **в online[] числами** (kinopub 3–9, alloha 5–8, vkmovie 21, pidtor 4–22…) | на `/videos` — списки голосов (не на карточке-списке) | ДА (место данных) | SKAZ знает озвучки ДО открытия источника |
| ordering | **`index`** (мастер-каталог: KinoPub первый, Filmix второй) | порядок реестра (native-первый → `filmix` первый) | ДА | дефолтный выбор источника разный: **KinoPub vs Filmix** |
| host | динамический per-balanser (kinopub@online8, zagonka@oleg6) | свой выбор хоста Maniya (online3-первый; oleg6 **вне пула** hosts) | ДА | интерст SKAZ-«Zagonka» живёт на хосте, которого Maniya не спрашивает |
| rch-источники | показаны как обычные чипы (ashdi/kinoukr/eneyida/remux) | **отсутствуют вообще** (не в balancers; «rch-резерв» meta) | ДА | 3–4 источника SKAZ физически нет в Maniya |
| `/sources/card`, `/videos` на кластере | 400 (нет) | есть | — | — |

Никакой **функциональной** дивергенции в самих решениях о показа/скрытии при ОДНОМ балансере нет (показ = есть ли контент у кластера); дивергенция — в **наборе/моэле/имени/порядке** тех же решений.

---

## 3. PHASE 3 — ВОРОНКА ИСТОЧНИКОВ (численно, тот же момент времени)

| step | mutiny | toystory5 | interst |
|---|---|---|---|
| **SKAZ** discovery (withsearch статик) → online[] | 29 → 32 | 29 → 32 | 29 → 32 |
| SKAZ **shown** | **11** | **14** | **24** |
| SKAZ shown с контентом (deep-link 200) | 11 (8 html + 3 rch-ws) | 14 | 24 |
| **MANIYA** static реестр → per-card show | 21 → **7** | 21 → **10** | 21 → **19** |
| Maniya `/videos` items>0 (свежий снимок) | **5** (filmix 3, alloha 5, videoseed 12, kinopub 4) | **8** (filmix 4, rezka 4·21.0с, rutubemovie 3, alloha 3, kinopub 3, vkmovie 21, geosaitebi 1, rhsprem 4) | **17** (все, кроме pidtor 0) |
| Maniya shown → 0 items (ТВ-видимо, но пусто) | collaps (`collaps_http_error`), veoveo (season-тип), pidtor (торрент) | collaps (err), pidtor | pidtor |

**Переносы в «пустые» чипы Maniya:** collaps — собственный native недоступен в окне (`collaps_http_error`, в SKAZ collaps нет вовсе); veoveo/mutiny — кластер отдаёт **season**-карточку, Maniya-мост возвращает movie-items 0; pidtor — торрент-дескрипторы за гейтом (документировано). rezka как в T017: /videos **21.0–21.1 с** (Anubis+AJAX) — см. PHASE 8.

**Методика честности:** transients подтверждены повторным снимком (videoseed/mutiny 0→12, filmix 0→3); в таблице — согласованный `docs/t018/funnel.json` (последний прогон).

---

## 4. PHASE 4 — ДУБЛИКАТЫ

1. **filmix vs filmixtv (SKAZ):** в per-card `online[]` ВСЕХ 3 карточек **`filmixtv` ОТСУТСТВУЕТ** (grep 0). В актуальной SKAZ-модели **ODIN** filmix-источник («Filmix ~ 4K»). filmixtv остаётся только в withsearch-статике/прямом deep-link (T011/12) — вне текущих per-title tray. Ранний вывод T011 «две карточки фильмикса» — **СНЯТ для текущей модели** (это была устаревшая/уstatic картина; кластер обновился).
2. **native vs skaz-twin (MANIYA):** для нативных с idi-твин (filmix/rezka/hdvb/rutubemovie/kodik/kinotochka) skaz-близнец **скрыт** (`hiddenTwinNative`) — в UI ОДНА карточка (native); близнец — фоллбэк (0 items у native → store отдаёт близнеца). SKAZ-кластер не имеет «native-категории».
3. **Maniya-only источники (в SKAZ-модели отсутствуют):** `collaps` (собственный native; в online[] кластера его нет вообще), `skaz-rhsprem` на toystory5 (в SKAZ-toystory5 набора нет rhsprem), `skaz-videoseed` на interst (SKAZ **скрывает** videoseed на interst, Maniya — показывает — reverse-divergence availability).
4. **SKAZ-only (физически отсутствуют в Maniya):** lordfilm, mirkino («Мир кино Z»), ashdi/kinoukr/eneyida/remux (rch/WS), xvideocdn60fps (interst), kinotochka (interst; rch-кластерный — Maniya использует собственную native-kinotochka, другой слаг), cdnvideohub/vkmovie/geosaitebi — есть, но в другом виде/под другим именем.

Дубликатов контента внутри Maniya, дающих «лишнюю» карточку, НЕ выявлено: нативный и близнец не показываются одновременно; единственный двукарточный случай (SKAZ filmix+filmixtv) в актуальной модели отсутствует.

---

## 5. PHASE 5 — ПОРЯДОК (SKAZ ordering vs MANIYA)

- **SKAZ**: порядок = **`index`** восходяще (мастер-каталог кластера, стабильный по тайтлам). Показанные идут 1,2,4,8,13,14,15,18,19,30,31 (mutiny) с пропусками скрытых (3,5,6,7,9,10,11,12,16,17,22–29,515,825 — в tray ghost). **Первый источник = всегда KinoPub** (index 1, показан на всех трёх тайтлах).
- **MANIYA**: порядок = порядок реестра `/sources` (native-первый → `filmix,kodik,rezka,rutubemovie,cdnvideohub,collaps,hdvb,kinotochka`, затем skaz-*) с рефильтрацией по show. **Первый = filmix** (для mutiny shown[0]=filmix).
- **Следствие:** дефолтный выбор (первый показанный / запомненный) у SKAZ = **KinoPub**, у Maniya = **Filmix** — ТВ-юзер видит разный «выбранный источник» даже при равном составе.
- Приоритет качества/латентности/пина: в SKAZ-данных НЕ разделяется от `index` (качество — в имени, латентность — только на выбор хоста). В Maniya нет сущности `index` вовсе.

---

## 6. PHASE 6 — UI-FEASIBILITY (может ли Lampa отрисовать SKAZ-результат)

**ДА — доказано кодом, без изменений Lampa:**

- Оба плагина рендерят источники одним и тем же примитивом Lampa `filter.set('sort', items)` с `{title, source, selected, ghost}`: актуальный SKAZ-плагин — `json.online.forEach(...)→ sources[name]{url,name,show}` → `filter.set('sort', ...map(... ghost:!sources[e].show))`; Maniya — `updateFilter()`: `filter.set('sort', filterSources.map(... ghost:!sources[key].show))` (maniya-online.js:549-558).
- Lampa превращает `ghost`-элементы сортировки в скрытые/приглушённые + счётчик «Ещё N»; состав чипов = переданный массив.
- **Расхождение НЕ в рендере:** если бы Maniya отдавала SKAZ-модель (per-title `online[]` 32: имена+index+показ+rch+voices+ghost), Lampa нарисовала бы ровно SKAZ-трай. Различие только в **данных бэкенда** → FIRST DIVERGENCE на этапе данных (PHASE 9).
- Ограничение rch: Lampa-плеер rch/WS-источники в Maniya не играет (нет WS-клиента балансера) — даже «правильный список» для ashdi/kinoukr/eneyida дал бы чип без играбельного REST-контента (класс C/UPSTREAM, задокументировано `rch-резерв` в meta.js).

---

## 7. PHASE 7 — ВИЗУАЛЬНЫЙ ACCEPTANCE (SKAZ = reference)

Скриншоты-эталоны смотрены на старте сессии (после компакции контекста недоступны; критерии зафиксированы из описания TASK и подтверждены живыми данными кластера). Эталонные визуальные сущности и их соответствие данным:
- **Чипы источников** ↔ `online[]` по `index` (11/14/24 показанных чипов на тайтле);
- **Качество/имя в чипе** ↔ серверное `name` («Filmix ~ 4K», «xVideoCDN (Ultra)», «Мир кино Z»);
- **Зелёность/available** ↔ `show:true` (кластерная истина);
- **«Ещё N»** ↔ hidden-элементы (show:false в online[]) → Lampa ghost + счётчик;
- **Сортировочный список** ↔ `filter.set('sort')` по индексу;
- **Выбранный источник** ↔ первый показанный (kinopub) / запомненный per-title.
Признак приёмки: **Lampa рисует СКАЗ-видимость из СКАЗ-данных** (одинаковый состав/порядок/имена/ghost), без копирования CSS. На текущих данных Maniya НЕ проходит: состав 7/10/19 vs 11/14/24, имена/порядок/первый выбор другие → дивергенция в бэкенд-модели (PHASE 9), рендер готов.

---

## 8. PHASE 8 — ОБЪЯСНЕНИЯ (НЕ фиксы)

### 8.1 Почему «ViruseProject» появляется/выбран (Мятеж, голос)

- **Появление:** ViruseProject — **голос (call-item) балансера alloha** для Мятежа в каталоге кластера: `/videos skaz-alloha` items = HDrezka Studio, **ViruseProject**, HDrezka Studio.18+, Оригинальный, Субтитры (живой замер). Показ = каталог alloha, не специфика Maniya.
- **Выбор:** выбранный источник/голос на ТВ берётся пользователем/запоминается (per-title выбор), либо первый показанный. T017 зафиксировал фактическое воспроизведение потока ViruseProject (~3.33 Мбит/с). САМ выбор НЕ баг: качества проигрывания (stall) определил T017 (клиентская нога 2.9–3.5 Мбит/с < 4.68 Мбит/с потока, single-rung ABR) — это bandwidth-проблема, не ошибка озвучки/памяти.
- В SKAZ-модели на mutiny **alloha вообще 2-й по порядку** (index 4); Maniya показала его 3-м по своему реестру — порядок разный, «выбранный» разный (PHASE 5).

### 8.2 Почему HDrezka видна в UI при ~21 с `/videos`

- **Чип:** нативный `rezka` — ВИДИМЫЙ источник реестра (иконка 😉 «For Serial - Full HD»), и на toystory5/interst кластерная проверка дала `show:true` → чип рисуется мгновенно из `/sources` + `/sources/card`.
- **Провал:** клик → `/videos provider=rezka` → inherent цепочка Anubis-PoW + AJAX = **21.0–21.1 с** (замеры 4 тайтла, OLD≡MOS = не миграция, T017) > клиентский таймаут Lampa ~15 с → nginx **499** (68 записей /videos у ТВ) → «Видео не найдено или повреждено».
- Вывод: **появление чипа (availability) и его работоспособность (resolve latency) — разные стадии цепочки**; показ корректен, провал — в латентности резолва upstream. Аналогично ещё один показанный-но-дорогой источник: `skaz-filmix` близнец — 21.0 с (0 items, hidden).

---

## 9. PHASE 9 — FIRST DIVERGENCE (в цепочке данных, не с UI)

Цепочка обеих сторон: **raw discovery → source model → ordering → UI payload**.

| stage | SKAZ | MANIYA | разошлись? |
|---|---|---|---|
| 0. Discovery list | кластерный скан, 29 слагов | локальный реестр 21 | **ДА (самое первое)** |
| 1. Source model | `online[]` **32 per-title** со схемой `{name,url,index,show,balanser,rch,voices,seasons}` (серверная правда) | реестр 21 + флаги `{id,show}` (probe по своим 21) | **ДА (модель данных)** |
| 2. Availability | кластерный checkSearch по всему каталогу (show по тайтлу) | probes по подмножеству (21) | частично (reverse: collaps/rhsprem/videoseed) |
| 3. Ordering | `index` (KinoPub первый) | реестр (Filmix первый) | ДА |
| 4. UI payload | все 32 c ghost → «Ещё N» | только shown (7/10/19) без ghost | ДА |

**FIRST DIVERGENCE = этап 0/1 (построение списка источников):** SKAZ генерирует per-title **серверные `online[]` 32**; Maniya отдаёт **фиксированный локальный реестр 21** и флипает show-флаги. Всё видимое ниже (11/14/24 vs 7/10/19 чипов, имена, порядок, первый выбор = KinoPub vs Filmix, «Ещё N», rch-источники) — производное от этой модели. Бэкенд-модель (а не UI, не балансировщик, не прокси) — корень визуальной разницы на ТВ.

---

## 10. ROOT → EVIDENCE → FIRST DIVERGENCE → IMPACT

- **ROOT CAUSE (тип):** Maniya моделирует источники как **статический курируемый реестр + per-card show-флаги**; SKAZ моделирует как **per-title серверный online[]** (состав, имена, порядок, voices, rch, hidden-множество).
- **EVIDENCE:** online[] SKAZ 32/тайтл (11/14/24 shown) против 21 реестра Maniya (7/10/19); `/sources/card` и `/videos` на кластере = 400 (у SKAZ нет; модель = online[]); имена/порядок/первый выбор; filmixtv отсутствует в актуальных online[]; rch/host-различия (zagonka@oleg6 вне пула Maniya); чипы «показаны, но 0 items» (collaps/veoveo/pidtor) и «есть в SKAZ, нет в Maniya» (lordfilm/мirkino/ashdi/kinoukr/eneyida/remux/xvc60fps).
- **IMPACT (ТВ):** другой состав (меньше чипов), другие имена/иконки, другой первый/выбранный источник (Filmix вместо KinoPub), отсутствие rch/WS-источников и lordfilm/Мир кино Z, чипы, которые при нажатии дают «нет результатов» (коллапс-источник — Maniya-собственный — в окне 0).
- **MINIMAL FIX PROPOSAL (НЕ выполнялся; требование отдельного задания):** перенести модель Maniya с «registry + flags» на **«per-title online[]-семантику»** — отдавать карточке SKAZ-подобный список (id, name, show, index, voices, quality) от сервера, а клиенту прокинуть ghost-элементы для «Ещё N» (в точности как SKAZ-плагин через `filter.set('sort')`). rch-источники — отдельная задача (WS-клиент). По правилам T018 — ничего не менять.

---

## ВЕРДИКТ

| Вопрос | Ответ |
|---|---|
| Реальные SKAZ-ответы получены? | **ДА** — online[] 32×3 карточки, deep-links, rch, двойной снимок воронки (docs/t018/*) |
| Модель источника SKAZ определена? | **ДА** — `{name,url,index,show,balanser,rch,voices,seasons}` из `lite/events` (не `/sources/card`/`/videos`; их на кластере нет — 400) |
| Причины визуальной разницы обоснованы? | **ДА** — состав (21 vs 32), имена/иконки (meta.js vs серверные), порядок/первый (реестр vs index), ghost/«Ещё N», rch |
| FIRST DIVERGENCE доказана (не с UI)? | **ДА** — этап discovery/источник model (per-title server online[] vs static curated registry) |
| PHASE 8 объяснён? | **ДА** — ViruseProject = голос alloha (появление/выбор), HDrezka = availability OK / resolve 21 с → 499 ТВ |
| Функциональный дефект Maniya найден? | Опционально: показанные-но-пустые чипы есть (collaps upstream-err / veoveo season-тип / pidtor torrent) — классификации C/UPSTREAM/design; сам факт «чип ≠ результат» корректен в SKAZ тоже (он прячет/показывает одинаково) |
| Изменения кода/config/.env/PROD? | **NONE** |

## FINAL STATUS: **ACCEPT** (read-only; FIRST DIVERGENCE доказана на этапе данных)

Контрольные артефакты: `docs/t018/{mutiny,toystory5,interst}.json`, `docs/t018/static-sources.json`, `docs/t018/funnel.json`; харнессы `scripts/_t018_skaz_model.mjs`, `scripts/_t018_funnel.mjs`, `scripts/_t018_spot.mjs`. Деплой/фиксы — не выполнялись (HARD CONSTRAINTS).