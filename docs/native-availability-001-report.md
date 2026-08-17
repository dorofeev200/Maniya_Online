# NATIVE-AVAILABILITY-001 — Аудит per-card availability на новых фильмах 2026

**Дата:** 2026-08-13, прогон ~18:56 UTC (VPS), через ~20 мин после жалобы устройства (18:33–18:37 UTC).
**Статус:** ДИАГНОСТИКА. Код НЕ менялся, НИЧЕГО не закоммичено, НЕ задеплоено.
**Скрипт:** `/tmp/diag-native-availability.mjs` (read-only: свежий checker в процессе + трассировка
каждого `lite/*`-запроса + живой HTTP `/api/lampa/videos` + EO-reference `lite/events`).

**Фильмы (query ТОЧНО как у реального устройства — из nginx-лога, БЕЗ `kinopoisk_id`):**

| Фильм | id | imdb | title | original_title | year |
|---|---|---|---|---|---|
| «Одиссея» (The Odyssey) 2026 | 1368337 | tt33764258 | Одиссея | The Odyssey | 2026 |
| «Последний дом» (The Last House) 2026 | 1284041 | tt32268156 | Последний дом | The Last House | 2026 |

---

## 1. Матрица provider × film

Видимых источников 16 (7 native + 9 skaz). Колонки: **card** = вердикт `/sources/card`
(show:true/false); **why** = причина вердикта; **videos** = items живого `/api/lampa/videos`;
**play** = playback-проба первого item (`item.url` → статус/content-type, резолв как в Lampa);
**EO** = show/hide серверного `lite/events` E-Online; **verdict** = классификация.

### «Одиссея» 2026 (EO: show=12/hide=17)

| source | UI-имя | type | card | why | videos | play | EO | verdict |
|---|---|---|---|---|---|---|---|---|
| filmix | Filmix | native(twin) | true | TRUSTED | 1 | 429 (транзиент) | show | OK: контент есть |
| kodik | Kodik | native(twin) | true | **show:predicate (similar-link)** | **0** | — | **hide** | **⚠ FALSE-POSITIVE** |
| rezka | For Serial | native(twin) | true | **inconclusive:accsdb «Ожидаем фильм»** | **0** | — | **hide** | **⚠ FALSE-POSITIVE** |
| rutubemovie | Rutube | native(twin) | true | inconclusive (все хосты 503/abort) | 11 | 200/json | hide | OK: контент есть (ЭО отстаёт) |
| cdnvideohub | CDNVideo | native(probe) | true | **inconclusive:no-key** | **0** | — | hide* | **⚠ FALSE-POSITIVE (всегда)** |
| collaps | Collaps | native(probe) | true | show:found (imdb) | 1 | 200/HLS | hide | OK: контент есть |
| hdvb | HDVB | native(twin) | true | show:predicate (link, title совпадает) | 1 | 200/html | show | OK |
| skaz-alloha | Alloha | skaz | true | show:predicate (call-card) | 4 | 200/json | show | OK |
| skaz-videoseed | VideoSeed | skaz | true | show:predicate (play-card) | 5 | 200/mpegurl | show | OK |
| skaz-kinopub | Lime | skaz | true | show:predicate (**link → postid=1362, сериал 1997**) | 4 | 200/HLS | show | **⚠ риск «не тот фильм»** |
| skaz-kinoflix | KinoFix | skaz | true | **inconclusive (все 503 → дедлайн)** | **0** | — | **hide** | **⚠ FALSE-POSITIVE** |
| skaz-veoveo | VeoVeo | skaz | true | show:predicate (play-card) | 1 | **403** | show | показывается, play 403 (известная проблема CDN) |
| skaz-pidtor | PidTor | skaz | true | **inconclusive (дедлайн после «нет»)** | **0** | — | **hide** | **⚠ FALSE-POSITIVE** |
| skaz-solntse | Solntse | skaz | true | **inconclusive (все 503 → дедлайн)** | **0** | — | **hide** | **⚠ FALSE-POSITIVE** |
| skaz-geosaitebi | GeoVideo | skaz | true | show:predicate (link, title совпадает) | **0** | — | show | **⚠ FALSE-POSITIVE / nav-gap** |
| skaz-rhsprem | HDRezka 4K | skaz | true | **inconclusive:accsdb «Ожидаем фильм»** | **0** | — | show | **⚠ FALSE-POSITIVE** (EO разойдён) |

`*` у EO в списке нет балансера `videohub` вообще — см. §7.

**Итог «Одиссея»: 9 из 16 источников показываются без контента (videos=0); E-Online скрывает 7 из них.**

### «Последний дом» 2026 (EO: show=14/hide=15)

| source | UI-имя | type | card | why | videos | play | EO | verdict |
|---|---|---|---|---|---|---|---|---|
| filmix | Filmix | native(twin) | true | TRUSTED | 4 | 200/mp4 | show | OK |
| kodik | Kodik | native(twin) | true | **show:predicate (similar-link)** | **0** | — | **hide** | **⚠ FALSE-POSITIVE** |
| rezka | For Serial | native(twin) | true | show:predicate (call-card) | 2 | 200/json | show | OK |
| rutubemovie | Rutube | native(twin) | true | show:predicate (call-card) | 5 | 200/json | show | OK |
| cdnvideohub | CDNVideo | native(probe) | true | **inconclusive:no-key** | **0** | — | hide* | **⚠ FALSE-POSITIVE (всегда)** |
| collaps | Collaps | native(probe) | true | show:found (imdb) | 1 | 200/HLS | hide | OK: контент есть |
| hdvb | HDVB | native(twin) | true | show:predicate (link, kp совпадает) | 1 | 200/html | show | OK |
| skaz-alloha | Alloha | skaz | true | show:predicate (call-card) | 3 | 200/json | show | OK |
| skaz-videoseed | VideoSeed | skaz | **false** | **hide/confirmed/retry** | 0 | — | hide | ok: скрыт |
| skaz-kinopub | Lime | skaz | true | show:predicate (link → postid=2536) | 3 | 200/HLS | show | OK |
| skaz-kinoflix | KinoFix | skaz | true | show:predicate (link, title совпадает) | 2 | 200/mp4 | show | OK |
| skaz-veoveo | VeoVeo | skaz | true | show:predicate (play-card) | 4 | **403** | show | показывается, play 403 |
| skaz-pidtor | PidTor | skaz | true | show:predicate (link/torrent) | 8 | 200/x-matroska | show | OK (торренты mkv) |
| skaz-solntse | Solntse | skaz | **false** | **hide/confirmed/retry** | 0 | — | hide | ok: скрыт |
| skaz-geosaitebi | GeoVideo | skaz | true | show:predicate (call-card) | 1 | 200/HLS | show | OK |
| skaz-rhsprem | HDRezka 4K | skaz | true | show:predicate (call-card) | 2 | 200/json | show | OK |

**Итог «Последний дом»: гейт РАБОТАЕТ, когда успевает по дедлайну** — videoseed и solntse
скрыты правильно (все хосты 503 × confirm × retry). На этом фильме настоящих false-positive
двое: **kodik** и **cdnvideohub**.

> ⚠ **Сверка с жалобой юзера.** Юзер (18:33–18:37) на «Последнем доме» получал «видео не
> найдено» также для For Serial / Lime / PidTor — в моём прогоне (~18:56) у них items 2/3/8.
> Это **контент-популяция**: новые фильмы 2026 появляются в каталогах в течение десятков минут.
> На «Одиссее» 7 из 8 жалоб юзера подтверждены videos()=0 и в моём прогоне — там речь о
> настоящих false-positive, а не о времени.

---

## 2. Причина каждого false-positive (доказано телами ответов)

Механизмов **четыре**, все зафиксированы трассировкой и телом `checksearch`-ответа:

### ФП-1. «Similar-link-карточка» засчитывается предикатом как контент (kodik, kinopub, geosaitebi-типа)

Кластер, не найдя точного совпадения по фильму, отдаёт РЕДУЦИРОВАННЫЙ ответ — одну
link-карточку «искать снова» с `method:"link"` и `similar:true`, указывающую на ДРУГОЙ
похожий тайтл. В ней есть `data-json=` → предикат `data-json=` → work=true → show:true.

Доказательства (тела ответов, `lite/<balancer>?checksearch=true`):

```html
<!-- kodik, «Одиссея» 2026 (videos=0): -->
{"method":"link","url":".../lite/kodik?title=\u0026original_title=The+Odyssey\u0026...\u0026pick=%D0%B1%D0%B5%D1%81%D0%BA%D0%BE%D0%BD%D0%B5%D1%87%D0%BD%D0%B0%D1%8F+%D0%BE%D0%B4%D0%B8%D1%81%D1%81%D0%B5%D1%8F+%D0%BA%D0%B0%D0%BF%D0%B8%D1%82%D0%B0%D0%BD%D0%B0+%D1%85%D0%B0%D1%80%D0%BB%D0%BE%D0%BA%D0%B0","similar":true,"year":2002,"title":"Бесконечная Одиссея капитана Харлока"}
<!-- kodik, «Последний дом» 2026 (videos=0): тот же паттерн, pick = другой тайтл -->

<!-- kinopub, «Одиссея» 2026: -->
{"method":"link","url":".../lite/kinopub?postid=1362\u0026...","similar":true,"year":1997,"title":"Одиссей / The Odyssey"}
<!-- postid=1362 = мини-сериал 1997 года, НЕ фильм 2026. Наш videos() = 4 items ЭТОГО сериала →
     риск «Lime отдаёт не тот фильм» (не «видео не найдено», но тоже поломка). -->

<!-- geosaitebi, «Одиссея» 2026: -->
{"method":"link","url":".../lite/geosaitebi?title=...\u0026href=5486-filmi-odisea-qartulad.html","similar":true,"year":2026,"title":"ოდისეა"}
<!-- title СОВПАДАЕТ (настоящая страница фильма), но это method:link (навигация), а не call →
     предикат засчитал, а videos() при следовании даёт 0 → nav-gap, см. §6. -->
```

**Контраст — те же балансеры на фильме, который у них ЕСТЬ:**

```html
<!-- rezka, «Форрест Гамп» (контент есть): method:CALL, id/t/stream -->
{"method":"call","url":".../lite/rezka/movie?title=...&id=763&t=56&favs=...","stream":".../movie.m3u8?...&play=true"}
<!-- kinopub, «Форрест Гамп» (контент есть): method:PLAY, quality 2160p/1080p -->
{"method":"play","url":".../hls/.../master-v1a1.m3u8?...","quality":{"2160p":"...","1080p":"..."}}
<!-- hdvb, «Одиссея» (контент есть): method:LINK, но kp/год СОВПАДАЮТ с запрошенным фильмом -->
{"method":"link","url":".../lite/hdvb?kinopoisk_id=6385370","similar":true,"year":2026}
```

**Вывод:** link-карточка сама по себе НЕ признак. Признак — ЧТО за тайтл у link-карточки:
`method:"link"` + `similar:true` + **другой** title/pick/год → «похожий, но не тот» → это
НЕ контент запрошенного фильма. `method:"link"` + совпадающий title/kp → реальная навигация
к фильму → контент есть. Наш substring-предикат их не различает.

### ФП-2. accsdb «Ожидаем фильм в хорошем качестве...» = «контента пока нет», а не «вердикта нет» (rezka, rhsprem)

```json
{"accsdb":true,"msg":"Ожидаем фильм в хорошем качестве..."}
```
вернул **каждый** из 5 primary-хостов по `lite/rezka` и `lite/rhsprem` на «Одиссее».
`probe()` трактует accsdb как «отказ учётки → вердикта нет → показать оптимистично»
(availability.js:393-398). Но для семьи rezka эта msg-шаблон — **штатный ответ «фильма ещё
нет в каталоге»**, а не «войдите в аккаунт». На «Последнем доме» тот же rezka отдал обычную
call-карточку и контент есть (2 items) — т.е. accsdb-«Ожидаем» надёжно коррелирует с
отсутствием. E-Online в этой ситуации показывает rezka=hide.

### ФП-3. cdnvideohub: no-key → «показать» всегда (оба фильма)

Реальный Lampa-запрос **не содержит `kinopoisk_id`** (подтверждено nginx-логом), а
`NATIVE_PROBES.cdnvideohub.hasKey` = только `kinopoisk_id` → `no-key → inconclusive → show`
(availability.js:175-181, 235-238). `provider.videos()` тоже требует kp
(CDNvideohubProvider.js:42 — `if (!kinopoiskId) return []`). Итог: **cdnvideohub светится на
КАЖДОЙ карточке и всегда даёт videos()=0**. Это не «плохой прогон», это структурный инвариант.

### ФП-4. Исчерпание card-дедлайна (10с) превращает подтверждённое «нет» в «показать» (kinoflix, pidtor, solntse)

На «Одиссее» elapsed карточки = **12 004 мс > дедлайна 10 000 мс**. Трассы:

```
kinoflix : online3=503, 94.249.239.63=503, .37=503, .11=503, 77.90.33.109=503, online8=403  → кластер ЧЕСТНО «нет»
pidtor   : online3=200 (тело без content-маркеров → work=false → authoritative «нет»)       → кластер ЧЕСТНО «нет»
solntse  : 6 хостов 503/403                                                                → кластер ЧЕСТНО «нет»
```

`probe()` на 6-м хосте (или на повторном `confirmWithBackoff`) упирается в
`if (Date.now() >= deadline) return { show:true, ..., inconclusive:true }` (availability.js:362-366)
и **переворачивает подтверждённый «нет» обратно в «показать»**. На «Последнем доме» (elapsed
9 464 мс < 10 с) те же videoseed/solntse корректно скрылись — доказывает, что дело в бюджете
времени, а не в логике гейта.

---

## 3. Как E-Online определяет availability

E-Online (Lampa-клиент на той же ноде) использует серверный **`lite/events`** — единый
запрос, кластер сам решает, какие балансеры показывать для карточки, и возвращает
`[{url, show}]`. Кластер применяет **title-aware матчинг** (title/original_title/year/imdb/kp),
поэтому:

- link-карточки «похожий, но другой тайтл» (kodik → Харлок, kinopub → сериал 1997) в show НЕ попадают;
- accsdb-«Ожидаем фильм» трактуется как «контента нет» (rezka=hide на «Одиссее»);
- источники, которых реально нет в каталоге на этот фильм, скрываются (kinoflix/pidtor/solntse = hide на «Одиссее», videoseed/solntse = hide на «Последнем доме»).

Эталонные ответы `lite/events` (online3, 2026-08-13 ~18:56 UTC):

| Фильм | show (12) | hide |
|---|---|---|
| «Одиссея» | alloha, ashdi, eneyida, filmix, geosaitebi, hdvb, kinopub, kinoteatrkg, kinoukr, rhsprem, veoveo, videoseed | asiage, kinobase, **kinoflix**, kinotochka, lumina, mirkino, **pidtor**, remux, **rezka**, rutubemovie, sakhtv, **solntse**, uakino, vkmovie, xvideocdn, xvideocdn60fps, xvideocdnultra |
| «Последний дом» | alloha, ashdi, eneyida, filmix, geosaitebi, hdvb, **kinoflix**, kinopub, kinoukr, **pidtor**, **rezka**, rhsprem, rutubemovie, veoveo | asiage, kinobase, kinoteatrkg, kinotochka, lumina, mirkino, remux, sakhtv, solntse, uakino, **videoseed**, vkmovie, xvideocdn, xvideocdn60fps, xvideocdnultra |

Обратите внимание: EO **различает два фильма** (у «Последнего дома» show=14, у «Одиссеи»
show=12). Наш per-card checksearch на этих же карточках показал почти всё подряд — см. §4.

---

## 4. Как Maniya сейчас определяет availability (почему возвращает show:true)

Поток `availability.js` (`/api/lampa/sources/card`), код закоммичен 576a835:

1. **`checkSearchPredicate`** (строки 87-103) — точная копия Lampac `OnlineApi.cs:975`:
   `work = rch || res.Contains("data-json=") || type:"movie"|"episode"|"season"`.
   Это substring-поиск по ВСЕМУ телу ответа. **Любая `data-json=`-атрибут — включая
   similar-link-карточку ФП-1 — даёт work=true.** Разницы «call/play против link-на-другой-тайтл» нет.

2. **`probe`** (строки 353-426) — хост-ротация: primary → online8-резерв.
   - 2xx content-bearing → предикат, стоп (show может быть истинным или ложным — п.1);
   - 2xx «нет» (`null/disable/false/not found`) и не-2xx (403/404/503) → следующий хост;
   - таймаут/сеть → `sawNoResponse` → **показываем оптимистично**;
   - **accsdb → приравнивается к «ответа нет» → показываем** (ФП-2);
   - **`Date.now() >= deadline` → show:true/inconclusive** (ФП-4).

3. **`nativeProbe`** (строки 221-256, 172-204): cdnvideohub ключуется ТОЛЬКО по `kinopoisk_id`
   → без kp `no-key → inconclusive → show` (ФП-3). collaps — по kp/imdb/orid → `recordByKeys`,
   работает корректно (show:found, контент подтверждён).

4. **`card`** (строки 521-644):
   - **TRUSTED_ALWAYS_VISIBLE** (`filmix`, `skaz-filmix`) — всегда show:true без пробы;
   - native-с-твином и skaz — checksearch твин/балансера; native-без-твина — nativeProbe;
   - **OLD∩NEW гейт**: show:false (authoritative) подтверждается прямым lite-page
     (`confirmWithBackoff`, retry с паузой) — скрыть только при «нет» от ОБОИХ сигналов;
   - кэш 5 мин (hide 60 с), только чистые вердикты.

**Почему это даёт «показывать почти всё»:** три из четырёх ложных путей ведут в show:true по
дизайну — «не прятать рабочий источник из-за транзиентного сбоя/отказа учётки». Это правильная
страховка для ТРАНЗИТЕНТНЫХ ошибок, но три из четырёх случаев (ФП-1, ФП-2, ФП-3) — НЕ
транзиентные: кластер **отвечает** «нет» (или «похожий, но не тот»), а код трактует ответ как
«нет вердикта». Четвёртый (ФП-4) — перекос бюджета: 16 источников × 6 хостов не умещаются
в 10 с дедлайна, и «нет» от кластера тонет в fallback.

---

## 5. Какие providers требуют отдельного probe

| Provider | Сейчас | Правильно (требуется) |
|---|---|---|
| **cdnvideohub** | nativeProbe по `kinopoisk_id`, но в реальном query kp НЕТ → всегда no-key → всегда show | **Отдельная проба обязательна.** Кластерного балансера нет (проверено: `lite/videohub`=404, `lite/cdnvideohub`=503/null, `lite/vdb`=404) → единственный сигнал — `client.playlist(kp)` через native-клиент. Либо научить карточку получать kp (см. §8), либо не показывать источник, когда kp отсутствует |
| **collaps** | nativeProbe `recordByKeys` (kp→imdb→orid) + title-fallback | Уже корректный отдельный probe — не трогать |
| **kodik** | твин `lite/kodik?checksearch` → similar-link | Отдельной пробы не нужно — нужен только predicate, различающий similar-link (ФП-1). Достаточно починить предикат |
| rezka / rhsprem | твин checksearch; accsdb «Ожидаем» = inconclusive | Отдельной пробы не нужно — нужен разбор accsdb-msg (ФП-2): «Ожидаем фильм в хорошем качестве» = hide, accsdb-авторизация = inconclusive |
| rutubemovie / hdvb / alloha / videoseed / kinopub / kinoflix / veoveo / pidtor / solntse / geosaitebi / filmix | твин/балancer checksearch | Работают через тот же сигнал, что и E-Online; отдельных проб не требуют — ловятся тем же фиксом предиката/дедлайна |

---

## 6. Какие providers имеют navigation-gap

**Navigation-gap — это когда карточка/навигация источника ЕСТЬ, а наш код не может дойти до
playable-контента.** Доказанные случаи:

| Provider | Фильм | Симптом | Природа |
|---|---|---|---|
| **geosaitebi** | «Одиссея» | checksearch → link-карточка с верным title (href=5486-filmi-odisea-qartulad.html), EO=show, но videos()=0 | gap в нашем `collectMovieCards`/follow: georgian-страница → postid не извлекается (или контент действительно ещё не добавили). INCONCLUSIVE — прятать нельзя без доказательства |
| **kinopub** | «Одиссея» | checksearch и прямой lite-page → link `postid=1362` (сериал 1997), videos()=4 = **чужой фильм** | gap ИНАЧЕ: маппинг title→пост подбирает похожий сериал вместо фильма 2026. Риск «не тот фильм» у Lime |
| **kodik** | оба | checksearch → similar-link на другой тайтл | Это не navigation-gap, а **predicate-gap** (ФП-1): наш substring-предикат не отличает similar-link от контента. Код навигации у kodik не виноват — контента для этих фильмов у kodik нет вообще (EO=hide) |
| **rutubemovie** | «Одиссея» | обратная сторона: EO=hide, а наш videos()=11 (рабочий контент) | gap у E-Online/кластера (не проиндексировали), у нас всё на месте. Показывать правильно |

---

## 7. Какие providers действительно мёртвые на этих фильмах

«Мёртвый» = **доказано отсутствие контента** (videos()=0 И EO=hide ИЛИ accsdb-«Ожидаем»),
а не «пока недоступен».

| Provider | «Одиссея» 2026 | «Последний дом» 2026 | Комментарий |
|---|---|---|---|
| **kodik** | МЁРТВ (EO=hide, videos=0) | МЁРТВ (EO=hide, videos=0) | similar-link = «в каталоге нет». False-positive на обоих |
| **cdnvideohub** | МЁРТВ (videos=0 всегда) | МЁРТВ (videos=0 всегда) | нет kp в запросе → нет контента вообще. Светится всегда |
| **rezka** | МЁРТВ (accsdb «Ожидаем», EO=hide, videos=0) | ЖИВ (2 items) | accsdb-«Ожидаем» = «ещё нет» |
| **rhsprem** | МЁРТВ по videos=0, НО EO=show | ЖИВ (2 items) | расхождение с EO — либо контент-популяция, либо nav-gap; INCONCLUSIVE |
| **kinoflix** | МЁРТВ (EO=hide, videos=0) | ЖИВ (2 items) | на «Одиссее» замаскирован ФП-4 (дедлайн) |
| **pidtor** | МЁРТВ (EO=hide, videos=0) | ЖИВ (8 торрент-mkv) | на «Одиссее» замаскирован ФП-4 |
| **solntse** | МЁРТВ (EO=hide, videos=0) | МЁРТВ (EO=hide, videos=0) | на «Одиссее» замаскирован ФП-4, на «Последнем доме» скрыт ПРАВИЛЬНО |
| **videoseed** | ЖИВ (5) | МЁРТВ (EO=hide, videos=0, скрыт) | на «Последнем доме» скрыт ПРАВИЛЬНО |

Остальные (filmix, alloha, hdvb, rutubemovie, collaps, kinopub, geosaitebi, veoveo) — живы
на обоих или на одном фильме, см. матрицу §1.

---

## 8. Минимальный безопасный fix (ПРЕДЛОЖЕНИЕ — НЕ применено, требует подтверждения)

Правило юзера соблюдено: «НЕ менять код, НЕ скрывать при videos()=0, НЕ делать новых
исключений». Ниже — только предложение по итогам аудита. **Ничего не закоммичено, не задеплоено.**

**Принцип:** все четыре механизма — это НЕ «videos()=0 → скрыть», а «неверно прочитанный
**ответ кластера**». Чиним чтение ответа, а не жертвуем работающими источниками. Каждый пункт
добавляет только случай «скрыть», который и так скрывает E-Online.

1. **Предикат: не считать similar-link-карточку контентом** (лечит ФП-1).
   `checkSearchPredicate` вместо substring `data-json=` должен извлечь первый `data-json`
   объект и оценить: `work = rch || method==="call" || method==="play" || type:movie|episode|season`
   `|| (method==="link" && карточка соответствует запрошенному фильму)`.
   Соответствие: title/year/kp/imdb из url link-карточки совпадают с query. Пустой `title=`
   + `pick=`-другой-тайтл, или `similar:true` с чужим годом/тайтлом → **НЕ контент**.
   Безопасность: hdvb/geosaitebi/kinopub (совпадающий title/kp) остаются видимыми — ничего
   работающего не скрывается. Это чистое «-» по false-positive.

2. **accsdb: различать «Ожидаем фильм» и «отказ учётки»** (лечит ФП-2).
   `probe()`: `{"accsdb":true,"msg":"Ожидаем фильм в хорошем качестве..."}` (семья rezka) =
   контента нет → authoritative «нет» (hide, подтверждается гейтом). accsdb с msg про вход в
   аккаунт — по-прежнему inconclusive. Провайдеро-специфично только по msg-шаблону, без
   исключений по имени источника.

3. **cdnvideohub: без `kinopoisk_id` — «нет», а не «no-key → показ»** (лечит ФП-3).
   Для cdnvideohub `hasKey` вернуть false → вердикт «нет» (авторитетно), а не inconclusive.
   Безопасность: kp в реальном query отсутствует ВСЕГДА, а videos() без kp всё равно пустой —
   скрытие не теряет контент. Опционально: подкладывать kp в query (kp известен из TMDB/соседних
   link-карточек — например hdvb отдал kp=6385370 для «Одиссеи»), тогда cdnvideohub вернётся.

4. **Дедлайн не должен переворачивать подтверждённое «нет»** (лечит ФП-4).
   В `probe()` fallback `Date.now() >= deadline` применять только если источник НИ разу не
   получил ответ кластера (`sawNoResponse` без единого 2xx/не-2xx). Если хост-ротация успела
   получить полный ответ (все 503 / work=false) — вернуть «нет», даже если на повторном
   confirm времени нет. Это возвращает kinoflix/pidtor/solntse-«Одиссея» в hide, ничего не
   ломая у работающих.

5. **(Опционально, вне минимального фикса)** geosaitebi/kinopub navigation-gap (§6): следование
   link-карточке `href=страница` → postid у geosaitebi; у kinopub — контроль того, что postid
   относится к запрошенному году/фильму, а не к похожему сериалу.

**Риски/ограничения:** пункты 1-4 — каждое только добавляет «нет», где E-Online уже «нет»;
единственный теоретический риск — если кластер отдаёт similar-link с верным title, а контент
появится позже (как у kinopub-«Одиссея»). Для этого пункт 1 допускает «link + совпадающий
title» = показывать (как сейчас), т.е. контент-популяция не ломается. Пункт 4 — минимальный
риск, подтверждён эмпирически (videoseed/solntse-«Последний дом» уже так скрываются).

---

## Приложение: доказательства (тела ответов)

| Кейс | Ответ кластера | Наш вердикт | EO |
|---|---|---|---|
| kodik, «Одиссея» | link `similar:true` pick=Харлок, `title=` пустой | show:predicate | hide |
| kodik, «Последний дом» | link `similar:true` pick=другой тайтл | show:predicate | hide |
| rezka, «Одиссея» | `{"accsdb":true,"msg":"Ожидаем фильм в хорошем качестве..."}` ×5 хостов | inconclusive:accsdb → show | hide |
| rhsprem, «Одиссея» | то же ×4 хоста (+403×2) | inconclusive:accsdb → show | show (расхождение) |
| kinopub, «Одиссея» | link `postid=1362` `similar:true` `year:1997` «Одиссей/The Odyssey» | show:predicate | show (но videos()=4 = сериал 1997) |
| geosaitebi, «Одиссея» | link `href=5486-filmi-odisea-qartulad.html` `similar:true` title=ოდისეა (верный) | show:predicate, videos=0 | show |
| kinoflix, «Одиссея» | 6 хостов 503/403 | inconclusive (дедлайн) → show | hide |
| pidtor, «Одиссея» | online3=200 (без content-маркеров → «нет»), затем дедлайн | inconclusive (дедлайн) → show | hide |
| solntse, «Одиссея» | 6 хостов 503/403 | inconclusive (дедлайн) → show | hide |
| videoseed, «Последний дом» | 6 хостов 503/403 × confirm × retry | hide/confirmed | hide |
| cdnvideohub, оба | (нет кластерного балансера) no-key | inconclusive:no-key → show | (в EO-списке отсутствует) |

**Файлы для контекста:** `server/src/availability.js` (закоммичен 576a835, НЕ изменялся),
`C:\tmp\showy\diag-native-availability.mjs` (диагностический скрипт), `/tmp/diag-2nd-run.txt`
(полный вывод матрицы на VPS).
