# BALANCER-SEMANTICS-005 — POST-W1 REMAINING-SEMANTICS AUDIT

**Дата:** 2026-08-16 (после `docs/balancer-semantics-005-post-w1-audit.md`)
**Тип:** READ-ONLY аудит остаточных проблем после W1. Код/тесты НЕ менялись, commit/push/deploy НЕ выполнялись.
**Объект:** три класса остаточных проблем из пост-W1 аудита — A (INCONCLUSIVE/503/timeout, 11 FP),
B (CONTENT но /videos=0, method:link, 4 FP), C (FN/FLAP, 4 kinopub-пары). Проверить каждый класс
отдельно, доказать/опровергнуть, ответить на 8 вопросов, предложить ≤3 волны БЕЗ реализации.
**Метод:** live-пробы кластера skaz С РЕАЛЬНЫМИ кредами (`SKAZ_ACCOUNT_EMAIL`/`SKAZ_UID`,
`dorofe…@gmail.com`/`7974…`) с локальной Windows-машины + перечиткой канона Lampac
(`OnlineApi.cs`, `plugin.js`) + повторный разбор прод-матрицы `matrix-api-result-r2.json` и
ground-truth `aggregate-probe.json`. Ничего на VPS не запускалось (урок ребута 06:50: тяжёлые
пробы только с лимитом памяти; здесь все пробы лёгкие, последовательные, 1 title за раз).

**Ключевое уточнение от этого аудита:** несколько классификаций пост-W1 аудита НЕ подтвердились
свежими ответами кластера — часть «content-model» пар оказалась нестабильными 503/timeout,
а 4 kinopub-пары оказались **работающими** (kinopub реально имеет контент). Это меняет картину
остаточных проблем существенно (см. §3-§5).

---

## 0. Вердикт

# REMAINING-SKAZ-FP: НЕ «ПРОСТО СКРЫТЬ НА 503» — ТРИ РАЗНЫЕ ПРИРОДЫ, ОДНА ИЗ КОТОРЫХ ПАРСЕР-БАГ

1. **Class A (11 «INCONCLUSIVE-show»):** подтверждено — быстрые стабильные 503 у не-kinopub
   балансеров по конкретным title. **Канон Lampac скрывает (omits) источник при 503/timeout**
   (`OnlineApi.cs:1049-1052` catch → `links[index] = null` → `.Where(i => i.code != null)` → source
   отсутствует в ответе). Maniya **делиберативно** показывает (INC→show, rule 3 «статусный шум
   не прячет»). Это осознанное расхождение, НЕ баг, но издержка = FP «мёртвый источник показан»,
   закэшированный на TTL карточки. «Скрыть на 503» = следование канону (не изобретение), НО
   менять надо точечно, с разграничением «быстрый стабильный 503» (почти наверняка нет контента)
   и «timeout» (транзиентный тормоз — прятать нельзя, иначе вернём FN).
2. **Class B (4 «content-model»):** ТОЛЬКО 2 из 4 подтверждены как стабильный link-only
   (Одиссея/geosaitebi, Скайуокер/geosaitebi — similar-ссылки с совпавшим ГОДОМ, ложно
   засчитанные `classifyLinkCard` как «content»). **ДД/pidtor — парсер-ограничение, НЕ «контента
   нет»**: вручную follow по link-карточке дошёл до перевода «Дубляж, Кравец» (контент ЕСТЬ на
   глубине 2), а `collectMovieCards` делает только 1-2 шага (href/postid) и не умеет каскадно
   следовать по поисковому url → 0 items. **Одиссея/kinopub — НЕ стабильный link-only**: свежие
   ответы = timeout/503 (real params) / play (title-only) — нестабилен, переклассифицирован.
3. **Class C (4 kinopub FN/flap):** **kinopub реально имеет контент** для всех 4 (Аватар 7 play,
   Дюна 14 play, ДД 10 items в r2, Форрест 25 play — подтверждено свежими пробами и матрицей r2).
   **hide-gate флап = скрытие РАБОТАЮЩЕГО источника** под медленным/503-ответом checkSearch.
   Единственный устойчивый FN в r2 — Аватар/kinopub (show:false при 7 items). Остальные 3 в r2
   работали, но флапают под нагрузкой. Это не «нет контента», это **latency-нестабильность
   checkSearch-прохода**.

**Сводно: из 19 остаточных случаев (15 FP + 4 FN-кандидата) общий корень один — двойной проход
(availability при открытии карточки, /videos при клике) использует РАЗНЫЕ ответы кластера в РАЗНОЕ
время, и эти ответы недетерминированы (503 ↔ link ↔ play ↔ timeout у одного и того же балансера
+ title). W1 синхронизировал HOST-выбор, но не CONTENT-вердикт между двумя проходами.** Никакой
дефект НЕ является «просто скрыть на 503» — но канон уже так делает, и сближение с ним требует
осторожной волны (см. §8).

---

## 1. Методология и 7 обязательных правил (как выполнены)

| Правило | Как выполнено |
|---|---|
| 1. Реальные свежие Skaz-ответы | 3 свежих пробы (14:2x-14:4x) к online3.skaz.tv с реальными кредами; 20+ последовательных лёгких GET. Результаты в §2. |
| 2. Сравнение с E-Online/оригиналом | Перечитан `OnlineApi.cs` (§ checkSearch 957-1053, catch→null→omitted; LifeEvents 546-643, `item?.code != null`) и `plugin.js` (§ parse 779-884, link→follow/similars). Выводы §3-§5. |
| 3. Не смешивать display name и provider ID | Весь анализ по provider ID (`skaz-kinopub` и т.д.), display-имена не использовались как identity. |
| 4. Не смешивать Collaps со Skaz | Collaps — native, отдельно; в Skaz-пары не включался. |
| 5. Никаких выводов из одной ноды | Все вердикты — кластерные (aggregate-probe 6 нод) или многократные пробы. |
| 6. Разделять вердикты | В пробах отдельно: 200-play / 200-link / 200-similar-link / 503-пусто / 503-null / timeout / 200-empty. Таблица §2. |
| 7. LIVE и CONTROLLED раздельно | Всё live (реальный кластер + прод-матрица). Контролируемых моков нет; canonical Lampac — как эталон, отдельно (§3.2). |

---

## 2. Свежие ответы кластера (live, online3.skaz.tv, 2026-08-16 ~14:20-14:45)

Все запросы: `/lite/<balancer>?…&account_email=…&uid=…`, `checksearch=true` (что видит
availability) и без него (что видит /videos). Таймаут 12-15с. body пуст → «503 пусто».

### 2.1 Class A-кандидаты (были UNABLE 6/6 в 06:26)

| Пара | checksearch | plain | Медлительность | Что это |
|---|---|---|---|---|
| solntse/Аватар | **503 пусто** | **503 пусто** | 102ms / 115ms | быстрый стабильный 503 |
| kinoflix/Одиссея | **503 «null»** | **503 «null»** | 415ms / 712ms | быстрый стабильный 503 |
| videoseed/ПД | **503 пусто** | **503 пусто** | 342ms / 289ms | быстрый стабильный 503 |

Три независимых окна (title-only probe #1, real-params probe #2 через ~10 мин) — 503 стабилен и
БЫСТР (100-700ms), НЕ таймаут. Те же балансеры в том же окне отвечают 200 для других title
(aggregate-probe 06:26: solntse CONTENT для Интерстеллар/Форрест/Матрица/Дюна/Паразиты/ДД/Тёмный;
kinoflix CONTENT для ПД/Интерстеллар/Форрест/Дюна/Скайуокер/Аватар/Тёмный; videoseed CONTENT для
Одиссея/Дюна/Скайуокер/ДД/Аватар/Тёмный). **Вывод: 503 title-специфичен, кластер при этом жив.**
Это похоже на «у балансера нет/апстрим 503 для конкретного title», а НЕ на транзиентную
перегрузку кластера.

### 2.2 Class B-кандидаты (content-model)

| Пара | checksearch | plain | Стабильность | Что это |
|---|---|---|---|---|
| geosaitebi/Одиссея | 200, **2× link similar:true** «ოდისეა» (2026, 2016) | то же | стабильно (probe#2 + #3) | similar-ссылки, у geosaitebi нет фильма |
| geosaitebi/Скайуокер | 200, **1× link similar:true** «ვარსკვლავური ომები…» (2019) | то же | стабильно | similar-ссылка; follow→503 (недоказано, есть ли playable) |
| pidtor/ДД (serial) | 200, **3× link** url=`lite/pidtor?rjson=False&title=…` | то же | стабильно (probe#2 + #3) | **follow#1 → 1× link similar «Дубляж, Кравец»** url=`lite/pidtor/serial/<token>` — контент есть на глубине 2 |
| kinopub/Одиссея | **timeout (15с) / 503** (real params) | timeout / 503 | НЕ стабилен | в аудите был link×3, сейчас timeout/503; title-only → **2× play** |

### 2.3 Class C-кандидаты (kinopub, реальные параметры карточек)

| Пара | checksearch | plain | Вывод |
|---|---|---|---|
| kinopub/Аватар | 200, **7× play** (медленно 7.8с) | 200, **7× play** (706ms) | **контент ЕСТЬ**, стабильно |
| kinopub/Дюна2 | 200, **14× play** | 200, **14× play** | **контент ЕСТЬ** |
| kinopub/Форрест | **503** | 200, **25× play** | **контент ЕСТЬ**, checksearch флапает 503 |
| kinopub/ДД (serial) | 200, 3× link (без title, similar:false) | 200, 3× link | в r2 было **10 items**; сейчас link-режим — недетерминизм |
| kinopub/Интерстеллар (CTRL) | 200, **4× link similar:true** | 200, 4× link | в r2 было **9 items**; сейчас link-режим — недетерминизм |
| kinopub/ПД (CTRL) | 200, **2× link similar** «Последний дом слева» (др. фильм) | то же | у kinopub НЕТ «Последнего дома 2026» |

**Главный вывод §2.3:** kinopub-поиск **недетерминирован по режиму**: для одного и того же фильма
в разные окна отдаёт `play` (прямое совпадение Lime) либо `link similar` (список похожих/постов),
либо `503`, либо timeout. Например kinopub/Интерстеллар: r2=9 play items, title-only probe=9 play,
real-params probe=4 similar link. **Это источниковое свойство kinopub (Lime search / KpInvk
routing), НЕ выбор хоста и НЕ Maniya.**

---

## 3. Class A — 11 FP: INCONCLUSIVE-show (503/timeout)

### 3.1 Root cause (подтверждён кодом и живьём)
1. Кластер: все ноды 503 (быстро и стабильно) по конкретному title+балансеру. НЕ сатурация
   (остальные балансеры и другие title отвечают 200 в том же окне).
2. `probe()` в abstain-режиме (не-kinopub): не-2xx primary → `sawStatusNo=true` (availability.js:651,
   676-684 «статусный шум, НЕ content-вердикт»). В конце цикла `sawDefinitiveNo=false` → return
   `show:true, inconclusive:true` (availability.js:763-768).
3. Card: источник показан как доступный (`show(INC)@online8`).
4. `/videos`: getLite тот же 503 → non-content → 0 items. Юзер кликает → «видео не найдено».
5. Card-кэш TTL 5 мин → FP живёт до 5 мин даже если кластер «выздоровел».

### 3.2 Канон Lampac/E-Online (доказано перечиткой)
`OnlineApi.cs` checkSearch: `Http.GetSpan(checkuri, timeoutSeconds:10)`; **исключение (в т.ч. 503,
timeout) → catch → `links[indexList]` остаётся null** (строки 1049-1052) → результат фильтруется
`.Where(i => i.code != null)` (строки 913-917) → **источник OMITTED из lite/events**. LifeEvents
фильтрует `item?.code != null` (строки 546-643) → источник отсутствует в `online[]` → Lampa не
показывает. plugin.js строит sources ТОЛЬКО из ответа (строка 363). **Итого: оригинал НЕ
показывает источник, чей checksearch упал (503/timeout).** «Hide on 503/timeout» — это и есть
поведение оригинала, НЕ наша выдумка.

### 3.3 Почему текущий вердикт
Maniya `INCONCLUSIVE→show` — **INTENTIONAL POLICY** (rule 3 «статусный шум не прячет», документировано
в комментариях availability.js и отчётах BALANCER-ONLINE8-002 / audit-005). Три-стейт создан,
чтобы транзиентный тормоз кластера не прятал рабочий источник (эмпирика rutubemovie/Одиссея
503+abort при 11 items). Издержка — FP на время TTL.

### 3.4 Ответы на 8 вопросов
1. **Root cause:** 503-вердикт кластера для title+балансер → abstain-режим трактует не-2xx как
   «статусный шум» (не «нет») → show:true → /videos 0. Разделение во времени двух проходов.
2. **Почему текущий вердикт:** три-стейт + rule 3 (защита живых источников от транзиентных
   тормозов) — осознанное решение, задокументировано.
3. **BUG или INTENTIONAL POLICY:** INTENTIONAL POLICY (делиберативное расхождение с каноном:
   канон omits при 503, Maniya показывает).
4. **FP риск:** подтверждён — 11/15 FP живут на TTL кэша; юзер видит мёртвый источник.
5. **FN риск при изменении:** высокий, если прятать по «timeout»/смешанному ответу — вернём
   FN работающего источника (случай rutubemovie). Низкий, если прятать только по **быстрому
   стабильному 503** (100-700ms, без no-response) — такие почти наверняка «нет».
6. **Фиксится ли без ломки W1:** да. W1 = host-порядок (не трогаем). Меняется ТОЛЬКО правило
   интерпретации не-2xx primary в abstain-режиме. Фикс не влияет на /videos (он и так пуст при 503).
7. **Файлы:** `server/src/availability.js` (probe, не-2xx ветка ~стр. 676-684 + финальная логика
   ~стр. 759-768), `server/src/config.js` (если нужен флаг), тесты `server/test/` (availability).
8. **Тесты:** unit: не-2xx primary (быстрый 503) → hide authoritative; 503+no-response (смесь) →
   INC show; timeout-only → INC show; 200-empty → hide; kinopub (legacy) не затронут. + регресс
   suite + live: solntse/Аватар после фикса → hide, а не show.

### 3.5 Чего НЕ делать
- **Не менять online8 abstain** (он не источник: Class A — это 503 PRIMARY, а не воздержание
  online8; abstain уже корректен).
- **Не «просто скрывать на 503» глобально**: timeouts и смешанные ответы обязаны остаться
  INC→show (иначе FN). Только «быстрый стабильный non-2xx без no-response» заслуживает «нет».

---

## 4. Class B — 4 FP: CONTENT но /videos=0 (method:link)

### 4.1 Подтверждено свежими ответами: 2 стабильных, 1 парсер-баг, 1 переклассифицирован

| Пара | Свежий ответ | Диагноз | БАГ/ПОЛИТИКА |
|---|---|---|---|
| **Одиссея/geosaitebi** | 2× link similar «ოდისეა» (2026, 2016) | у geosaitebi нет playable Одиссеи; similar-ссылки с совпавшим **годом** засчитаны `classifyLinkCard` как content (availability.js:229-231) | классификация неточна (semantic), НО поведение show:true = канон (data-json → work=true) |
| **Скайуокер/geosaitebi** | 1× link similar «ვარსკვლავური ომები…» (2019) | то же по году; follow→503 (недоказано, есть ли playable) | то же |
| **ДД/pidtor (serial)** | 3× link url=поисковый; **follow → «Дубляж, Кравец» (перевод!)** | контент ЕСТЬ на глубине 2; `collectMovieCards` умеет только href/postid-шаги, каскадного follow по поисковому url нет | **БАГ (парсер-ограничение)** |
| **Одиссея/kinopub** | timeout/503 (real params), 2× play (title-only) | НЕ стабильный link-only; kinopub имеет фильм; сейчас — 503/timeout (Class A-механика) или play-режим | переклассифицирован: недетерминизм kinopub, см. §3/§5 |

### 4.2 Почему availability=content, а /videos=0 (корень Class B)
Двойной предикат:
- **availability** (`checkSearchPredicate` + `classifyLinkCard`): link-карточка с совпавшим годом →
  `content` (RULE-1, availability.js:229-231). Для geosaitebi/Одиссея и Скайуокера это **ложный
  позитив по году**: similar-ссылка другого фильма/link-only с годом 2026/2019 засчитана как
  «этот фильм». Комментарий RULE-1 прямо признаёт «год — слабое совпадение, по ТЗ».
- **parser** (`collectMovieCards`/`hasMovieItems`): link-only → нет play/call → `hasMovieItems=false`;
  movieHref/postidFromCards не находят полезную цель (url=поисковый, нет postid, title пустой →
  `linkCardMatchesQuery` отбрасывает) → `{cards: []}` → 0 items.

### 4.3 Канон (plugin.js parse, строки 779-884)
Оригинал на link-only: single non-similar link → **follow**; multiple similar links →
`similars()` (раздел «похожие фильмы»); link-only без similar → **season links → follow**.
Т.е. канон **обрабатывает** link-карточки (follow/similars), а не возвращает пусто. Для
pidtor/ДД канон каскадно дожал бы до серий. Для geosaitebi канон показал бы «похожие», а не
«видео не найдено».

### 4.4 Ответы на 8 вопросов
1. **Root cause:** (а) `classifyLinkCard` засчитывает similar-link с совпавшим годом как
   «content»; (б) парсер не следует каскадно по произвольным link-url (только href/postid).
2. **Почему текущий вердикт:** RULE-1 «год совпал → content» — осознанный компромисс (нужен для
   kinopub-link-карточек без id, GAP-005); парсер ограничен 1-2 шагами follow, чтобы не уходить
   в чужой фильм (BALANCER-KINOPUB-004 защита от decoy).
3. **BUG или INTENTIONAL POLICY:** смешанно. geosaitebi — семантически неточная классификация
   (поведение = канон, так что скорее ПОЛИТИКА RULE-1). **pidtor/ДД — БАГ** (потерянный
   playable-контент, парсер-ограничение). kinopub/Одиссея — нестабильность кластера (§5).
4. **FP риск:** подтверждён для geosaitebi×2 и ДД/pidtor (show:true + 0 items в r2).
5. **FN риск при изменении:** если просто скрывать link-only — **скроем pidtor/ДД, где контент
   есть** (новый FN). Поэтому hide link-only — НЕ решение. Решение = каскадный follow + уточнить
   classifyLinkCard (similar:true + только год ≠ content).
6. **Фиксится ли без ломки W1:** да. W1 не трогается. Меняется `collectMovieCards` (глубина
   follow) и/или `classifyLinkCard` (similar-флаг). /videos-путь остаётся с пином.
7. **Файлы:** `server/src/providers/skaz/SkazProvider.js` (collectMovieCards, каскадный follow),
   `server/src/availability.js` (classifyLinkCard: similar:true → не content по одному году),
   тесты.
8. **Тесты:** unit: pidtor-сериал каскадный follow до play; geosaitebi similar-link год-match →
   не-content; kinopub play-режим не задет; decoy-защита (BALANCER-KINOPUB-004) сохраняется. +
   live: pidtor/ДД → items>0; geosaitebi/Одиссея → hide или «похожие».

### 4.5 Примеры (реальные, ≥3)
1. Одиссея/geosaitebi: `lite/geosaitebi?title=Одиссея…&imdb_id=tt33764258` → 2× link similar
   «ოდისეა» (2026, 2016), show:true, /videos=0 (r2).
2. Скайуокер/geosaitebi: → 1× link similar «ვარსკვლავური ომები: სქაიუოქერის აღზევება» (2019),
   show:true, /videos=0 (r2).
3. ДД/pidtor: → 3× link url=поисковый; follow → «Дубляж, Кравец» (перевод существует), но
   collectMovieCards → 0 items (r2, свежие пробы).
4. (контроль) kinopub/Аватар: 7× play — показывается «мёртвым» только из-за hide-gate (§5).

---

## 5. Class C — 4 kinopub FN/FLAP

### 5.1 Факты (matrix r2 + свежие пробы)
| Пара | r2 (07:03, прод) | Свежая проба (14:30) | Итог |
|---|---|---|---|
| **Аватар/kinopub** | **show:false** (нет в show-списке) + **7 items** | 7× play (cs медленный 7.8с, plain 706ms) | **FN подтверждён в r2**: скрыт работающий источник |
| **Дюна/kinopub** | show:true + 14 items | 14× play | работает в r2 и сейчас |
| **ДД/kinopub** | show:true + 10 items | 3× link (сейчас) / CONTENT 3/6 (probe-dd 06:58, card hide*(INC)) | флап: то 10 серий, то link, то 503 |
| **Форрест/kinopub** | show:true + 25 items | cs=503, plain=25 play | работает; checksearch флапает 503 |

### 5.2 Root cause
kinopub-поиск недетерминирован (play ↔ link similar ↔ 503 ↔ timeout в разные окна) +
двойной проход во времени:
1. availability checkSearch при открытии карточки: медленный (7.8с, на грани deadline 12с) или
   503 → в **legacy-режиме kinopub** 503 = `sawDefinitiveNo` (availability.js:686) → при чистом
   «нет» → `show:false` (availability.js:761) → **hide работающего источника**.
2. /videos (клик, другой момент): kinopub отвечает play → 7-25 items.
3. Результат: hide-gate показал «нет», а контент есть → FN. Self-heal OLD∩NEW + HIDE_TTL 60с
   возвращает show при следующем открытии карточки, но на минуты юзер не видит источник.

### 5.3 Ответы на 8 вопросов
1. **Root cause:** недетерминизм kinopub-поиска (режим play/link/503/timeout) + разделение
   checkSearch и /videos во времени; 503 в legacy-режиме kinopub трактуется как твёрдое «нет».
2. **Почему текущий вердикт:** kinopub единственный legacy-балансер (reservePolicy НЕ abstain) —
   для него 503 = «нет» (по дизайну). При живом контенте и флапающем 503 это даёт FN.
3. **BUG или INTENTIONAL POLICY:** ПОЛИТИКА (legacy 503=нет) + источниковый недетерминизм kinopub.
   Но FN (скрытие работающего) — нежелательный эффект политики.
4. **FP риск:** низкий (kinopub при 503=hide, а не show).
5. **FN риск:** подтверждён (Аватар/kinopub в r2; флап у Дюны/ДД/Форреста под нагрузкой).
6. **Фиксится ли без ломки W1:** да. Не трогаем host-порядок. Можно: не давать hide по ОДНОМУ
   503-проходу без подтверждения OLD∩NEW (оба прохода «нет») — но OLD∩NEW уже есть; проблема в
   том, что при «нет» от checksearch + «да» от /videos hide уже не отменяется (проверка /videos
   не участвует в гейте). Уточнение: hide подтверждать независимой ПОВТОРНОЙ checksearch-пробой
   (backoff), а не полагаться на единичный медленный ответ.
7. **Файлы:** `server/src/availability.js` (confirmAbsence/confirmWithBackoff — критерии hide для
   legacy 503), тесты.
8. **Тесты:** unit: kinopub 503 → hide только после подтверждения повторной пробой; медленный
   (>6с) 503 с последующим play-ответом → НЕ hide; /videos items>0 при show:false → логировать.
   + live: Аватар/kinopub после фикса → show:true + 7.

### 5.4 Ключевое правило
FN (не показали рабочий источник) хуже FP (показали мёртвый): юзер не может получить фильм.
Поэтому для legacy-503 kinopub надо требовать **подтверждённого** «нет», а не единичного ответа.

---

## 6. Что реально остаётся (сводка после этого аудита)

| # | Класс/случай | Кол-во | Природа | Канон Lampac | Что это для Maniya |
|---|---|---|---|---|---|
| A1 | быстрый стабильный 503 non-kinopub | 11 FP | кластер title-специфичный 503 | **omit при 503** | FP (show мёртвого на TTL) |
| B1 | geosaitebi similar-link год-match | 2 FP | у geosaitebi нет фильма; RULE-1 «год=content» | show:true (data-json) → similars на клике | семантически «content» неточно; поведение = канон; /videos=0 |
| B2 | pidtor/ДД двухшаговый follow | 1 FP | контент есть на глубине 2, парсер не дожал | каскадный follow | **БАГ: потерянный контент** |
| B3 | kinopub/Одиссея | 1 FP | нестабилен (play/timeout/503/link в разных окнах) | omit при 503 / follow при link | общий корень с C |
| C1 | kinopub FN (Аватар устойчивый + Дюна/ДД/Форрест флап) | 1 FN + 3 флапа | hide работающего под медленным/503 checksearch | 503=omit (т.е. тоже временно скрыт!) | FN работающего источника (хуже FP) |
| — | rhsprem accsdb | — | учётка, вне кода | — | вне scope |

**Устойчивые FN: 1 (Аватар/kinopub). Устойчивых FP: 13 (11×503 + 2×geosaitebi).**
Нестабильные: kinopub/Одиссея, ДД/kinopub, Форрест/kinopub, Скайуокер/geosaitebi(follow 503).

**Общий корень 15+4+4 случаев:** двойной проход (availability↔/videos) по недетерминированным
ответам кластера. Три разных «лица»: (а) 503-вердикт трактуется по-разному (abstain=INC / legacy=нет);
(б) link-карточки трактуются по-разному (availability=content / parser=0); (в) hide не
подтверждается вторым проходом /videos. W1 закрыл host-измерение, но не content-измерение.

---

## 7. Вердикты по каждому классу (8 вопросов сведены)

| Класс | BUG/ПОЛИТИКА | FP риск | FN риск | Фиксится без ломки W1 |
|---|---|---|---|---|
| **A (11)** | ПОЛИТИКА (три-стейт/rule 3, канон=omit) | да (11) | при «просто скрыть» — да | да (точечно: быстрый стабильный 503 → «нет») |
| **B (4)** | B1 ПОЛИТИКА (RULE-1) + B2 **БАГ** (парсер) + B3 нестабильность | да (2 geosaitebi + pidtor) | при «скрыть link-only» — да (pidtor) | да (каскадный follow + similar-точность) |
| **C (4)** | ПОЛИТИКА (legacy 503=нет) + источниковый недетерминизм | низкий | да (1 устойчивый + 3 флапа) | да (подтверждение hide повторной пробой) |

---

## 8. Заключение (6 обязательных пунктов)

### 8.1 Что W1 закрыл
**CLUSTER-MISMATCH 2→0** (единый host-порядок карточки и /videos через hostOrder + continue-скан +
пин + pinMap). Главный FP Паразиты/kinopub («show:true + EMPTY» при CONTENT) больше не
воспроизводится; Одиссея/collaps закрыт; kinopub/Форрест FN починен; ротация обходит мёртвый пин.
**Всё, что осталось — НЕ host-выбор.** (Проверено: sha-parity 6/6 локально == VPS; suite
611/605/0/6.)

### 8.2 Что РЕАЛЬНО остаётся
1. **11 FP (быстрый стабильный 503 у non-kinopub)** — политика три-стейта показывает «мёртвое»
   вместо канонического omit. Плюс кэш карточки 5 мин фиксирует FP.
2. **2 FP (geosaitebi similar-link год-match)** — RULE-1 засчитывает похожий фильм с совпавшим
   годом как «этот фильм». Поведение show:true = канон, но клик даёт «видео не найдено» вместо
   «похожих».
3. **1 FP→БАГ (pidtor/ДД)** — парсер не делает каскадный follow по поисковому url; playable
   перевод «Дубляж, Кравец» не достигается. Потерянный контент.
4. **1 FN + 3 флапа (kinopub)** — hide работающего источника под медленным/503 checksearch
   (legacy 503=«нет» без подтверждения). Аватар/kinopub — устойчивый FN в r2.
5. **rhsprem accsdb** — учётка, вне кода.

### 8.3 Какие случаи имеют ОДИН общий корень
**Двойной проход по недетерминированным ответам кластера:** availability (карточка) и /videos
(клик) разделены во времени и используют разные вердикты; кластер для одного title+балансера
недетерминирован (503 ↔ link similar ↔ play ↔ timeout). Сюда относятся: все 11 FP Class A,
kinopub/Одиссея, kinopub-флапы Class C (включая FN Аватара). Это **одна задача**: «синхронизация
content-вердикта двух проходов и честная интерпретация 503».

### 8.4 Какие — РАЗНЫЕ задачи
- **B1 (geosaitebi similar-год)** — точность `classifyLinkCard` (RULE-1): similar:true + только
  год ≠ content. Самостоятельная, маленькая, низкий риск.
- **B2 (pidtor/ДД каскадный follow)** — глубина `collectMovieCards`: следовать по link-url
  рекурсивно до play (как канон). Самостоятельная, добавляет контент.
- **C (подтверждение hide повторной пробой)** — политика hide для legacy-503: не скрывать по
  единичному медленному ответу. Самостоятельная, защищает от FN.
- **rhsprem accsdb** — вне кода (учётка).

### 8.5 Какая задача ПЕРВОЙ и ПОЧЕМУ
**Сначала — Class C (hide подтверждением)**, затем Class A (503-интерпретация), затем B (B2 потом B1).
Обоснование: Class C — единственная, где теряется **рабочий** контент (FN Аватара/kinopub = юзер
не получает фильм, хотя 7 переводов существуют). FN хуже FP: FP — «лишний клик», FN — «фильм
недоступен». Class C фикс (подтверждать hide повторной пробой) маленький, не трогает abstain,
не ломает W1 и **одновременно** улучшает Class A-механику (503 не становится «нет» без
подтверждения). После этого — Class A (массовость: 11 FP) с разграничением «быстрый 503 = нет /
timeout = INC» (сближение с каноном omit, см. доказательство §3.2). Затем B: B2 (каскадный follow,
+контент), потом B1 (similar-точность, минус 2 FP).

### 8.6 Предложение ≤3 волн (НЕ реализуются)
**Волна 1 — «hide только подтверждённым „нет"» (Class C + подготовка A).**
- `availability.js`: legacy-503 (kinopub) и быстрый non-2xx (non-kinopub) не дают «нет» по
  единичному ответу; hide только после `confirmAbsence` повторной probe (уже есть backoff-механизм
  OLD∩NEW — усилить его: повторная проверка ДО hide, а не после). Медленные/смешанные ответы —
  INC→show (как сейчас).
- Тесты: kinopub 503 без подтверждения → не hide; с подтверждением → hide; timeout → INC show.
- Эффект: FN Аватара исчезает; флапы kinopub смягчаются. FP не растут.
- Риск: минимальный (hide-гейт остаётся для подтверждённого «нет»).

**Волна 2 — «503 как канон» (Class A, массовость).**
- `availability.js` abstain-ветка: быстрый стабильный non-2xx primary (503, без no-response,
  ответ за <~2с) → authoritative «нет» (omit как канон); timeout/no-response/смесь → INC→show.
- НЕ трогать online8 abstain, НЕ менять hostOrder/пин.
- Эффект: 11 FP → показ «мёртвого» прекращается; живые источники (200-ответы) не затронуты.
- Риск: если апстрим балансера «постоянно 503» для реально существующего title — источник
  скрыт до «выздоровления» (как в каноне; перепроверка на следующем открытии карточки).

**Волна 3 — «link-семантика» (Class B).**
- 3.1 `SkazProvider.collectMovieCards`: каскадный follow по link-url (рекурсивно, с лимитом
  глубины 2-3 и защитой от циклов) — pidtor/ДД → серии. Ориентир: канон plugin.js parse.
- 3.2 `classifyLinkCard`: `similar:true` + совпал только год → НЕ content (geosaitebi/Одиссея,
  Скайуокер → hide или «похожие»). Оставить год-match для non-similar link (kinopub-play-режим).
- Эффект: +1 источник (pidtor/ДД), −2 FP (geosaitebi).
- Риск: decoy-защита (BALANCER-KINOPUB-004) сохраняется тестами; глубина ограничена.

**Границы волн:** ни одна волна не меняет hostOrder/SkazClient continue-скан/pin/pinMap (W1),
не меняет online8 abstain, не трогает kinopub-legacy 503→«нет» полностью (остаётся как «нет»
после подтверждения). После волны 3 повторить матрицу r2 (99 пар) для измерения FP/FN.

---

## 9. Сырые данные (для воспроизводимости)

- Свежие пробы (live, локальная Windows-машина): `C:\Users\Admin\AppData\Local\Temp\post-w1-audit\`
  `postw1-fresh-probe.mjs` (title-only, 11 пар), `postw1-fresh-probe2.mjs` (real-params, 14 пар),
  `postw1-fresh-probe3.mjs` (полные карточки + follow), `postw1-fresh-cards.json` (дампы карточек
  pidtor/geosaitebi/kinopub), follow-цепочка pidtor/ДД → «Дубляж, Кравец».
- Прод-матрица r2: `matrix-api-result-r2.json` (generatedAt 2026-08-16T07:03:28Z) — card show +
  /videos items по 99 парам.
- Ground-truth пробы: `aggregate-probe.json` (06:26, per-node verdicts, pin, consistency),
  `probe-dd.json` (06:58, ДД).
- Канон Lampac: `C:\Users\Admin\AppData\Local\Temp\Lampac\Online\OnlineApi.cs` (checkSearch
  957-1053, LifeEvents 546-643, filter 913-917), `plugin.js` (sources build 330-460, parse 779-884).
- Код Maniya: `server/src/availability.js` (probe 638-788, classifyLinkCard 185-234,
  checkSearchPredicate 244-304, confirmAbsence/confirmWithBackoff), `server/src/providers/skaz/
  SkazProvider.js` (collectMovieCards 176-199, movieHref 314-343, postidFromCards 299-312).

---

## 10. STOP

После этого отчёта никаких других действий не выполнять (условие задачи: «STOP после отчёта»).
Код/тесты не менялись, commit/push/deploy не выполнялись. Следующая задача (волна 1 из §8.6) —
только по явному решению пользователя.
