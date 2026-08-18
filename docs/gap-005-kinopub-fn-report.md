# GAP-005 — Kinopub false-negative в /sources/card (read-only research)

Дата: 2026-08-15. Режим: **READ-ONLY**. Код не менялся, коммит/деплой НЕ выполнялись.
Воспроизведено на PRODUCTION (публичный `https://plugin.maniya-kvn.online`, токены userA/userB/userC,
кластер skaz online3/online8, креды `dorofe…` / uid `7974…`).

---

## 1. ROOT CAUSE

**`classifyLinkCard` в `server/src/availability.js:211`**: для link-карточки kinopub с
**составным title формата «RU / EN»** сравнение названий требует ТОЧНОГО равенства
`normalizeTitle(cardTitle)` одному из `qTitle`/`qOriginalTitle`. Составной title склеивается
`normalizeTitle` в одну строку без разделителя, не равна ни одному из запрошенных названий,
`comparable=true` (кириллица в обеих строках), `!titleMatch` → **`return 'absent'` ДО проверки year**
(которая прошла бы — год совпал). kp/imdb в url link-карточки ОТСУТСТВУЮТ (только `postid`) →
ветка id-сравнения не срабатывает.

### Точная цепочка (Интерстеллар, TMDB 157336 / tt0816692)

Kinopub checksearch=true на online3 → 200, первая карточка **правильного фильма**:

```json
{"method":"link","url":"http://online8.skaz.tv/lite/kinopub?postid=8613&title=Интерстеллар&original_title=Interstellar",
 "similar":true,"year":2014,"title":"Интерстеллар / Interstellar","details":"Дубляж, Профессиональный многоголосый, Авторский одноголосый, Оригинал"}
```

`classifyLinkCard`:
- `normalizeTitle("Интерстеллар / Interstellar")` → `"интерстелларinterstellar"` (склейка)
- `titleText` = `"интерстеллар"` (qTitle) → `comparable` = true (кириллица в обеих)
- `titleMatch` = `"интерстелларinterstellar" === "интерстеллар"`? НЕТ. `=== "interstellar"`? НЕТ → false
- **availability.js:211** `if (comparable && !titleMatch) return 'absent';` → **absent**
- Year `2014 === 2014` (дал бы content) НЕ достигается — return раньше
- `linkTargetIds(url)`: в url только `postid` + эхо `title`/`original_title` запроса, kp/imdb нет → id-ветка пропущена

Предикат → `{work:false, verdict:'absent'}` → probe → `{show:false, authoritative:true}` →
eligible → OLD∩NEW гейт (прямой lite-page БЕЗ checksearch → те же link-карточки → тот же absent) →
подтверждённый hide → кэш HIDE_TTL_MS=60s.

**Контент при этом РЕАЛЬНО есть**: `/api/lampa/videos?provider=skaz-kinopub` → **9 playable items**,
первый `method:"play"` → прод-proxy → master 200 (2160p SDR) → variant 200 (421KB, ~852 EXTINF) →
играбельно.

---

## 2. Доказательство (всё live на проде)

| # | Запрос | Результат |
|---|---|---|
| 1 | `/sources/card` Интерстеллар (userA) | kinopub `show:false`, cached=false, elapsed=12003 |
| 2 | `/videos` kinopub Интерстеллар | **9 items, 9 playable** (первый play→proxy→master 200) |
| 3 | VPS `createAvailabilityChecker` (force=true, логирующий fetch) | row=`{show:false, authoritative:true, status:200, host:online3, inconclusive:true, confirmInconclusive:true}`, elapsed=12003 |
| 4 | raw checksearch=true online3 (3×) | стабильно 200, 4 link-карточки, первая = правильный фильм (postid=8613, similar:true, year=2014) |
| 5 | `checkSearchPredicate(raw)` на VPS | `{"work":false,"rch":false,"quality":"","verdict":"absent"}` |
| 6 | Прямая lite-page (checksearch=false) | те же 4 link-карточки → тот же absent (второй сигнал согласен) |
| 7 | classify-матрица 7 тайтлов | см. §3 |

Полный лог первичного force-calc: `/tmp/gap005-probe-log.json` (VPS). Скрипты диагностики (read-only,
VPS `/tmp` + Temp): `gap005-probe.mjs`, `gap005-predicate.mjs`, `gap005-classify.mjs`,
`gap005-stability.mjs`, `gap005-cases.mjs`, `gap005-detail.mjs`, `gap005-conc.mjs`,
`gap005-singleflight.mjs`, `gap005-playback.mjs`, `gap005-matrix.mjs`.

---

## 3. Матрица тайтлов (CASE A/B/C/D)

| Тайтл | checksearch-ответ | классификация link-карточек | /sources/card | /videos | CASE |
|---|---|---|---|---|---|
| **Интерстеллар** 2014 | **link** «Интерстеллар / Interstellar» 2014 (similar:true) + 3 чужих | правильная карточка → **absent** (составной title) | **show:false** | **9 playable** | **A (FN)** |
| Форрест Гамп 1994 | **play**-карточки (25 переводов) | content (method play, минует классификатор) | show:true | 25 playable | B (OK) |
| Матрица 1999 | **play**-карточки (22) | content | show:true | 22 playable | B (OK) |
| Дюна 2 2024 | **play**-карточки (14) | content | show:true | 14 playable | B (OK) |
| 1+1 2011 | play-карточки | content | show:true | 7 playable | B (OK) |
| Дом Дракона 2022 (serial) | **link** без title/year (только postid) | **inconclusive** (нет данных для сравнения) | show:true | 10 playable | B (OK, через inconclusive) |
| Последний дом 2026 | **link** «Последний дом **слева**» 2009/1972 | absent (чужой title, чужой год) | show:false | 0 | C (корректный hide) |
| Одиссея 2026 Nolan | link «Одиссей/Одиссея» 1997/1992 | absent | show:false | 0 | C (корректно) |
| Скайуокер 2019 | link чужих фильмов | absent | show:false | 0 | C (корректно) |
| Дом Дракона serial | link без данных | inconclusive → show | show:true | 10 playable | B |

**CASE D (show:true + videos empty = FP) в текущих пробах НЕ воспроизведён** — все show:true тайтлы
имеют playable items; все hide-тайтлы имеют 0 items. (В readiness-002 фиксировались 2 FP — вероятно
inconclusive-показ при отсутствии контента; целенаправленный поиск CASE D — отдельная задача.)

---

## 4. Affected layer

- **Файл**: `server/src/availability.js` — `classifyLinkCard` (строки 189-219), конкретно строка 211.
- **Вызывающий**: `checkSearchPredicate` (229-298) → `probe` (584-732) → `checkBalancer` (735-737,
  `checksearch=true`) → `computeCard` (871-1001) → `defaultChecker.card` → `/api/lampa/sources/card`
  (index.js:209-233, БЕЗ force — публичный force-параметр не пробрасывается).
- **Клиент**: `public/maniya-online.js:498` `loadCardAvailability()` → `applyCardAvailability` (506-547):
  `sources[kinopub].show = false` → kinopub **исчезает из списка источников у пользователя**; если он
  был активным — активный источник заменяется на первый видимый, `loadVideos()` перезапускается.
- **Не затронуты**: OLD видео-флоу (`/videos` → `movieVideos` → follow postid → 9 items работает),
  прокси, другие балансеры (для НЕ-kinopub `newMode=abstain` без изменений), кэш-структура,
  single-flight.

---

## 5. Почему текущая логика даёт FN (а не корректный hide)

`classifyLinkCard` спроектирован под карточки с kp/imdb в url (E-Online/skaz-style) или точным title.
Kinopub — **двухшаговая схема**: checksearch возвращает link-кандидатов с `postid` (без kp/imdb),
реальный контент — по follow `postid` (что OLD videos() и делает). Для однотипных названий (Форрест
Гамп) кластер отдаёт play-карточки → классификатор не задействуется. Для неоднозначного поиска
(Интерстеллар: есть «Interstella 5555», «Schiller / Interstellar», доки) кластер отдаёт link-карточки,
и первая (правильная) карточка **имеет составной title «RU / EN» и совпавший год** — а классификатор:

1. не умеет составной формат «RU / EN» (склейка normalizeTitle ломает сравнение);
2. **не использует year как резерв** при non-exact title: `return 'absent'` на строке 211 стоит ДО
   годовой проверки (строки 214-216);
3. не использует `similar:true` (кластер сам пометил карточку как «похожую»);
4. не следует за link-карточкой (не проверить postid → реальный контент), в отличие от OLD videos().

Итог: **вердикт «нет» — артефакт классификатора, а не кластера** (кластер вернул 200 + правильную
карточку + контент играется).

---

## 6. Почему это НЕ upstream-only

- Кластер ответил **200 с контентом** (link-карточка правильного фильма: `similar:true`, `year:2014`,
  `postid=8613`), не 503, не accsdb, не пусто.
- `/videos` (OLD flow) по тому же postid=8613 находит **9 playable items**, первый играется
  (proxy→master 200→variant 200).
- Оба сигнала гейта (checksearch=true И прямая lite-page) возвращают ОДИНАКОВО правильную первую
  карточку — «нет» согласованный, значит не транзиентный флак.
- Формат ответа кластера (link vs play) варьируется по тайтлу, но наличие контента подтверждено
  независимо. Ошибка — в нашем коде классификации link-карточек.

---

## 7. Почему предложенный фикс не создаст FP (оценка, фикс НЕ реализован)

Гипотеза минимального фикса: для link-карточки **без kp/imdb**, где title в формате «RU / EN»
(разделитель « / »), считать `content`, если `normalizeTitle(левая_часть)` === `normalizeTitle(qTitle)`
И `normalizeTitle(правая_часть)` === `normalizeTitle(qOriginalTitle)` (или наоборот), **И** год совпал
(если год присутствует с обеих сторон). Почему это различает тайтлы:

| Карточка | Лев.=qTitle? | Прав.=qOrig? | Год | Вердикт |
|---|---|---|---|---|
| «Интерстеллар / Interstellar» (8613) | интерстеллар==интерстеллар ✓ | interstellar==interstellar ✓ | 2014✓2014 | **content (fix)** |
| «Schiller / Interstellar» (123847) | schiller≠интерстеллар ✗ | — | 2026✗2014 | absent (не тронут) |
| «Быстрее света… / Faster Than Light…» (52882) | ✗ | ✗ | 2017✗2014 | absent |
| «Наука „Интерстеллар" / The Science of Interstellar» (19932) | наукаинтерстеллар≠интерстеллар ✗ | ✗ | 2014=2014, но title ✗ | absent (док, не фильм) |
| «Последний дом слева / The Last House on the Left» 2009 | последнийдомслева≠последнийдом ✗ | lasthouseontheleft≠lasthouse ✗ | ✗ | absent (корректно) |
| «Последний дом слева» 1972 | ✗ | ✗ | ✗ | absent |
| «Одиссей / The Odyssey» 1997 | одиссей≠одиссея ✗ | odyssey≠odyssey? (odyssey==odyssey ✓) | 1997✗2026 | absent по году |

Важно: точное равенство ЧАСТЕЙ (а не подстрока) + год — не даёт «Науке Интерстеллар» стать content
(левая часть «наукаинтерстеллар» ≠ «интерстеллар»), поэтому док не станет FP. «Одиссей/The Odyssey»
отсечётся годом. Годовая ветка уже существует (строки 214-216) — фикс лишь **не допускает `absent`
по не-exact title, когда у карточки есть составной «RU / EN» title и совпавший год**, либо добавляет
распознавание разделителя « / » ДО строки 211. Оба варианта требуют юнит-тестов на все карточки из §3.

---

## 8. Какие тесты нужны (до фикса — отдельное подтверждение)

- **Юнит** (availability.test.js): классификация карточек «Интерстеллар / Interstellar»+2014 → content;
  «Schiller / Interstellar»+2026 → absent; «Наука „Интерстеллар" / The Science of Interstellar»+2014 →
  absent; «Последний дом слева / The Last House on the Left»+2009/1972 → absent; «Одиссей / The
  Odyssey»+1997 против qYear=2026 → absent; link-карточка без title/year → inconclusive.
- **Regression**: все существующие 560 тестов (включая availability-002, hidden-twin, online8,
  single-flight) без изменений поведения для play-карточек.
- **Shadow/сверка**: после фикса live-сверка по матрице §3 (5/6 B-тайтлов без регресса, Интерстеллар
  A→B, C-тайтлы остаются hide).
- **Prod-verify** (после одобрения): холодный/тёплый кэш, 5 seq + 5 parallel, force (VPS-checker),
  разные UID — подтвердить, что Интерстеллар становится show:true и играется, FP на доках нет.

---

## 9. Ожидаемое изменение FP/FN

- **FN: 1→0** для воспроизведённого кейса (Интерстеллар: hide → show, 9 items доступны юзеру).
  Механизм распространяется на ВСЕ link-карточки с составным «RU / EN» + совпавшим годом — они
  перестают ложно прятаться.
- **FP: не растут** при точечном фиксе (точное равенство частей + год): «Schiller», «Наука
  Интерстеллар», «Последний дом слева», «Одиссей», доки — остаются absent (см. таблицу §7).
- **Не изменяются**: play-карточки (классификатор не задействуется), serial-карточки без данных
  (inconclusive→show уже сейчас), CASE C (hide при 0 items), single-flight (объединяет вердикт,
  а не меняет его).

---

## Кэш / concurrency / single-flight — результаты тестов

- **5 последовательных (userA)**: 1 calc (elapsed=12001, show:false) → 4 HIT (cached:true) → все show:false.
- **5 параллельных (userA)**: все cached:true, show:false.
- **Холодный fresh-UID, 8 параллельных (userC)**: все elapsed=11593 (ОДИН calc, join-запросы получили
  тот же результат, cached:false — как в BALANCER-STABILITY-003), **все show:false**.
- **Другой UID (userB)**: cached:false, elapsed=12002, show:false.
- **Без year**: show:false (title-ветка absent независимо от year). **С kinopoisk_id=264063**: show:false
  (kp в url карточки нет — ветка не сработала).
- **Вывод**: FN **детерминирован** (не concurrency race, не single-flight, не кэш-стампед).
  single-flight работает и не является причиной: он объединяет идентичные calc, а не меняет вердикт.
  Дедлайн 12s упирается (elapsed 11593-12003) из-за confirm-ретраев, но вердикт absent стабилен.

---

## ЗАПРЕЩЁННЫЕ фиксы (НЕ применены, не предлагаются)

TRUSTED_ALWAYS_VISIBLE для kinopub, hardcode show:true, provider-specific bypass, отключение
availability, увеличение HIDE_TTL без доказательства, удаление OLD∩NEW гейта, отключение online8
abstain. Отчёт только диагностирует; **фикс не написан, не закоммичен, не задеплоен.**

---

## Файлы диагностики (временные, read-only)

VPS `/tmp`: `gap005-probe.mjs`, `gap005-probe-log.json`, `gap005-predicate.mjs`,
`gap005-classify.mjs`, `gap005-stability.mjs`, `gap005-cases.mjs`, `gap005-detail.mjs`.
Локально `%TEMP%`: `gap005-*.mjs` (matrix/conc/singleflight/playback). Удалять вручную после
завершения исследования.
