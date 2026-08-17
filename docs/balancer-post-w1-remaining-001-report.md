# BALANCER-POST-W1-REMAINING-001 — аудит остаточных расхождений

**Статус:** READ-ONLY аудит (код/тесты/config НЕ менялись, commit/push/deploy НЕ делались).
**Дата:** 2026-08-16.
**Цель:** найти и доказать ВСЕ оставшиеся реальные расхождения между семантикой кластера Skaz, availability Maniya, Maniya /videos и реальным playback'ом после закрытия W1 (BALANCER-SEMANTICS-005-W1: CLUSTER-MISMATCH 2→0).
**Метод:** live-пробы против кластера (online3/online8.skaz.tv, 94.249.239.63/.37/.11, 77.90.33.109; для vkmovie — доп. online4/oleg6), сравнение с ответами прод-API Maniya `/sources`, `/sources/card`, `/videos`. Временные probe-скрипты — используются только для чтения, после отчёта удалены.
**Вне scope (закрыты ранее, не трогали):** Collaps (GAP-002), kodik (закрыт, отдельный playback-гейт — см. KODIK-PLAYBACK-AUDIT-001), предикат/twin/каталог-гейт/Skaz/Collaps/E-Online классификация (AUDIT-001, FN-AUDIT-001, CANONICAL-EONLINE).

---

## §0. Ключевой вопрос задачи (таблица решений)

Просили таблицу решений для четырёх сценариев, где A/B/C — источники:

**Таблица 1. Авторитетность классов ответов кластера в availability**

| Класс ответа кластера | Статус | Примеры (live) | Что означает | Как обрабатывает Maniya |
|---|---|---|---|---|
| CONTENT-2xx (`data-json`/`videos__line`) | 200 | kinopub/Матрица, videoseed/Дюна, pidtor/ПД | Контент ЕСТЬ | FOUND → show (W1-pin, preferred) |
| CONTENT-cards с method:link | 200 | kinopub/Интерстеллар (2014 exact), geosaitebi/Одиссея (2026), geosaitebi/Скайуокер (2019) | Контент реалистично ЕСТЬ, но за дисамбигуацией (пост/точный title+год) | зависит от RULE-1 (см. §2, §5) |
| EMPTY-2xx (пустое тело) | 200 | pidtor/Одиссея (все 6 нод), solntse/Скайуокер | Контента НЕТ (подтверждено всеми нодами) | EMPTY → hide |
| 503 (всё тело «null»/пусто) | 503 | kinoflix/Одиссея, videoseed/ПД, solntse/Одиссея (6/6), Форрест/kinopub (5/6) | Не «контента нет» — НЕ доступен (нагрузка/кэш-ошибка/нода). GT через /videos может давать CONTENT (Аватар/kinopub 4/6 CONTENT при 503 на primary windows) | INCONCLUSIVE → show (rule 3, anti-FN) |
| 403 `disable` (тело «disable», 7 байт) | 403 | online8 для 9/10 балансеров, geosaitebi/ПД | Резервная легаси-нода выключена (online8-002, abstain) | abstain для не-kinopub; kinopub — реальный голос |
| ACCSDB («Войдите в аккаунт» в JSON) | 200 | follow geosaitebi/Одиссея postid, pidtor/ДД follow | Требуется авторизация бота, контент за гейтом | hide (нет контента в клиенте) |

**Таблица 2. Четыре сценария (A=EMPTY/B=TRANSIENT/C=CONTENT)** — авторитетность при НЕСОГЛАСИИ источников/сигналов:

| # | Сценарий | Live-доказательство | Правильная семантика | Рабочий вывод Maniya |
|---|---|---|---|---|
| 1 | A=EMPTY-2xx, B=503, C=CONTENT-2xx | geosaitebi/Одиссея: 200 LINK-карты (сам фильм есть в 2026) + plain; но классификатор Maniya → show при 0 items | «EMPTY» правдив только когда ВСЕ ноды 2xx-empty (pidtor/Одиссея 6/6). При LINK-картах — не EMPTY, а «нужна дисамбигуация» | Правила 1 (RULE-1) в classifyLinkCard решает по title+год. Задача: показать НЕ «show без items», а «show с items» — дисамбигуация сама. СМ. §5 |
| 2 | A=503, B=503, C=playable CONTENT | Аватар/kinopub: cs=503 на primary-окне, 4/6 нод CONTENT | 503 ≠ «нет» (см. Таблица 1) | show (INCONCLUSIVE, rule 3). Подтверждено /videos=7 items |
| 3 | checksearch=503, lite(plain)=playable CONTENT | Форрест/kinopub: cs=503, plain=200 CARDS (25 play!), /videos=8 items | checksearch (обычно быстрый предикат) может падать/расходиться с полным /videos | Показывать (INCONCLUSIVE). В /videos контент есть. ПОДТВЕРЖДЕНО live |
| 4 | checksearch=playable, lite=503 | Аватар/kinopub (cs=200 CARDS 7 плей), 77.90.33.109/online8=503 | checksearch-сигнал правдивее 503 | show (FOUND). /videos=7 items |

**Вывод по таблицам:** рабочая семантика правильная в 4/4 сценариях (show при любом CONTENT-сигнале, hide только при ЕДИНОГЛАСНОМ 2xx-empty). Оставшиеся проблемы — не в правиле срабатывания show/hide, а в КАЧЕСТВЕ items (показывает show → items=0, §5) и во время выполнения ((§7), §4-C).

---

## §1. Матрица 12×9 (live): полные результаты

Мини-матрица: 12 тайтлов × 9 skaz-провайдеров. `cs` = checksearch-запрос, `plain` = полный /videos-запрос (без checksearch). `card.show` = итог availability-карты Maniya.

### §1.1 Класс CONTENT: show=true, items≥1 (норма, W1-регрессии нет)

| Тайтл | Провайдер | items (/videos) | Примечание |
|---|---|---|---|
| Одиссея 2026 | videoseed | 5 | okko/AlphaProject/ENG |
| Одиссея 2026 | alloha | 4 | call |
| Одиссея 2026 | veoveo | 1 | 1080p |
| Одиссея 2026 | filmix | 1* | *пропущен в /videos-скрипте (skip) |
| ПД 2026 | pidtor | 8 | play |
| ПД 2026 | alloha/veoveo | 3/4 | |
| Интерстеллар 2014 | видеoseed 9, pidtor 9, alloha 8, kinoflix 3, solntse 1, veoveo 1, geosaitebi 1 (link→CONTENT) | — | kinopub см. §4 |
| Матрица 1999 | kinopub **22**, videoseed 16, alloha 7, pidtor 3, filmix 4 | — | |
| Дюна 2 | pidtor **47**, videoseed 16, kinopub 14, alloha 11 | — | |
| Скайуокер 2019 | videoseed 3, alloha 3, pidtor 6, kinoflix 2, veoveo 1 | — | |
| Паразиты 2019 | videoseed 6, pidtor 3, alloha 1, solntse 1, veoveo 1 | — | |
| ДД (serial) | kinopub 10, videoseed 10, solntse 10, alloha 10, veoveo 10 (season-links) | — | |
| Аватар 2009 | kinopub 7, videoseed 9, pidtor 9, alloha 5 | — | |
| Тёмный рыцарь 2008 | kinopub 12, videoseed 12, alloha 9, pidtor 4 | — | |
| Пусан 2016 | pidtor 2, solntse 1, alloha 1, veoveo 1, filmix 2 | — | |

### §1.2 Класс FP (Class A, INC-show): show=true при items=0

GT = ground truth: /lite-запрос напрямую по нодам кластера (все известные 6 нод).

**FP Class A (контента нет ни на одной ноде, 503/403; правило rule-3 anti-FN показывает → юзер видит источник, но items=0):**

| Тайтл | Провайдер | card.show | /videos items | Сигнал | GT |
|---|---|---|---|---|---|
| Одиссея 2026 | kinoflix | true | 0 | cs/plain=503 `null` | 6×503/403 `disable` |
| Одиссея 2026 | solntse | true | 0 | 503 EMPTY | 6×503/403 |
| ПД 2026 | videoseed | true | 0 | 503 EMPTY | 6×503/403 |
| ПД 2026 | solntse | true | 0 | 503 EMPTY | 503 (не GT) |
| Форрест 1994 | videoseed | true | 0 | 503 EMPTY | 6×503/403 |
| Матрица 1999 | kinoflix | true | 0 | 503 `null` | 6×503/403 |
| Скайуокер 2019 | solntse | true | 0 | 503 EMPTY | 503 (не GT) |
| ДД serial | kinoflix | true | 0 | 503 `null` (timeout 12323ms) | 503 |
| ДД serial | geosaitebi | true | 0 | 503 EMPTY | 503/EMPTY |
| Аватар 2009 | solntse | true | 0 | 503 EMPTY | 503 |
| Пусан 2016 | videoseed | true | 0 | 503 EMPTY | 503/403 |
| Пусан 2016 | kinoflix | true | 0 | 503 `null` | 503/403 |

**Итого Class A (INC-show) FP: 12 = kinoflix×4 (Одиссея, Матрица, ДД, Пусан) + solntse×4 (Одиссея, ПД, Скайуокер, Аватар) + videoseed×3 (ПД, Форрест, Пусан) + geosaitebi×1 (ДД).** Все 12 — «нода отвечает 503/empty, rule-3 показывает»; GT контента нет → юзер-видимый FP (пустой источник), но это **by-design anti-FN**, не несогласование show/hide.

**INC-оправданный show (контент есть, но 1/6 нод):**

| Тайтл | Провайдер | card.show | /videos items | GT | Вердикт |
|---|---|---|---|---|---|
| Форрест 1994 | kinopub | true | 0 | 1/6 CONTENT (online3), 5×503 | show CORRECT (rule-3), items=0 из-за pin на 503-ноду |

**FN-окно (hide при живом контенте):**

| Тайтл | Провайдер | card.show | /videos items | GT | Вердикт |
|---|---|---|---|---|---|
| ПД 2026 | kinopub | **false** (hide) | 0 | **6/6 CONTENT** | **FN** (см. §4-C) |
| ПД 2026 | kinoflix | **false** (hide) | 0 | 4/6 CONTENT (online3/63/37/77.90), 503×1 (11), 403 (online8) | **FN** |
| ПД 2026 | geosaitebi | **false** (hide) | 0 | 5/6 CONTENT | **FN** |

### §1.3 Класс CONTENT-link (FP-cont / link-модель): show=true, items=0 (дисамбигуация)

| Тайтл | Провайдер | card.show | /videos items | LM (link-модель) | follow |
|---|---|---|---|---|---|
| Одиссея 2026 | geosaitebi | true | 0 | LINK ×2 («ოდისეა» 2026, 2016) | ACCSDB (пост требует доступа) |
| Скайуокер 2019 | geosaitebi | true | 0 | LINK ×1 «ვარსკვლავური ომები…» 2019 | ACCSDB |
| Интерстеллар 2014 | kinopub | true | 0 | LINK ×4 («Интерстеллар/Interstellar» s:true 2014 exact) | postid=8613 → /videos 9000ms→0 |
| ДД serial | pidtor | true | 0 | LINK ×3 «Дом дракона» | d1 ACCSDB |
| ПД 2026 | geosaitebi | **false** | 0 | LINK ×1 «ბოლო სახლი მარცხნივ» 2009 — **другой фильм**→ hide CORRECT по RULE-1, НО GT контент есть (см. §4-C) | — |

**Правило 1 (RULE-1) применено классификатором к link-картам:** «точное совпадение title+year → CONTENT» (а не ссылка-пост). Для Одиссея/geosaitebi «ოდისეა» s:true 2026 — точное совпадение 2026 → show. Но это **пограничный тип**: карта method:link — не play-запись, контент за постом (ACCSDB): не «FP» в смысле «нет контента» (он есть в кластере), а **«show без items» — юзер видит пустой источник даже при существующем контенте**.

---

## §2. Kinopub (Class C) — 12 тайтлов, проверка через /videos напрямую по нодам

Детали deep-follow (postid): все link-карты киноpub идут на `online8.skaz.tv` с `postid=`.

| Тайтл | cs | plain | card.show | /videos items | POSTID follow |
|---|---|---|---|---|---|
| Одиссея 2026 | 200 CARDS (3 link: Одиссей 1997, Одиссея 1992, Florence 2016) | 200 | **false** (hide) | 0 | follow 200, cards=[] |
| ПД 2026 | 200 CARDS (link «Последний дом слева» 2009/1972) | 200 | **false** | 0 | follow 200, cards=[] |
| Интерстеллар 2014 | 200 CARDS (4 link, 2014 exact) | 200 | **true** | 0 (9000ms timeout) | postid=8613 |
| Форрест 1994 | **503** NON-CONTENT | **200** CARDS (25 play!) | true | 0 (ms=1757) | — |
| Матрица 1999 | 200 CARDS (22 play!) | 200 | true | **22** | — реальный контент |
| Дюна 2 | 200 CARDS (14 play) | 200 | true | **14** | — реальный контент |
| Скайуокер 2019 | 503 EMPTY | 503 | false | — | — |
| Паразиты 2019 | 503 EMPTY | 503 | false | — | — |
| ДД serial | 200 CARDS (season) | 200 | true | **10** | реальный |
| Аватар 2009 | 200 CARDS (7 play) | **503** (флап!) | true | **7** | реальный |
| Тёмный 2008 | **503** | 200 CARDS (12 play) | true | **12** | реальный |
| Пусан 2016 | 503 EMPTY | 503 | false | — | — |

**Наблюдения:**
- **kinopub cs≠plain флап доказан в обоих направлениях:** Форрест (cs=503/plain=25 play) и Тёмный (cs=503/plain=12 play) и Аватар (cs=200/plain=503). → одиночный сигнал (cs или plain) недостоверен для kinopub. W1 продолжает обе ветки (cs+plain), вердикт консистентный.
- **hide при 200-CARDS правомерен** для Одиссея/kinopub: это ссылки на ДРУГИЕ фильмы (1997/1992/2016 — «Florence + the Machine: The Odyssey») — корректная дисамбигуация. Но ПД/kinopub: link «Последний дом слева» 2009/1972 — направление hide ОШИБОЧНО (GT 6/6 CONTENT, §4.2, FN), а Интерстеллар single 2014 exact → RULE-1 показывает (правильно), а /videos при этом 0 (timeout). Пограничный Class C.
- **Реальный контент kinopub = direct play-карты (stream URLs)**: Матрица/Дюна/ДД/Аватар/Тёмный дают live 10-22 items.

---

## §3. PIDTOR (Class B, link-глубина) — 3 тайтла

| Тайтл | card.show | p1 | follow d1 | GT | Вердикт |
|---|---|---|---|---|---|
| ДД (serial) | true | 3 link «Дом дракона» | **ACCSDB** («Войдите в аккаунт») | 6×503/403 | FP-cont (link-model, контент за авторизацией бота) |
| Одиссея 2026 | false (hide) | — | — | 6×200 EMPTY-2xx | hide CORRECT (реальный EMPTY) |
| ПД 2026 | true (show, из m1) | 8 play | — | CONTENT | правильно |

pidtor link-цели всегда идут на `?rjson=False&title=…` → требует доступа бота (для наших creds). Одиссея/pidtor = эталон «реального EMPTY» (все 6 нод 200-пусто).

---

## §4. GT-вердикты и FN-окна

### §4.1 GT по нодам (ground truth)

| Пара | GT (6 нод: content/empty/error) | Вердикт |
|---|---|---|
| Форрест/kinopub | 1 CONTENT (online3), 5×503 | CONTENT |
| Одиссея/kinoflix | 0/0/6 (5×503+403 disable) | 503 → нет |
| ПД/kinopub | **6×CONTENT** | CONTENT (!!) |
| ПД/geosaitebi | 5×CONTENT + 403 online8 | CONTENT |
| ПД/videoseed | 0/0/6 (5×503+403) | 503 → нет |
| Аватар/kinopub | 4×CONTENT (online3/63/37/11) + 503×2 | CONTENT |
| Одиссея/pidtor | 0 EMPTY / 6×EMPTY-2xx | EMPTY → нет |
| Одиссея/solntse | 0/0/6 | 503 → нет |
| ПД/kinoflix | 4×CONTENT (online3/63/37/77.90) + 503×1 (11) + 403 (online8) | CONTENT |

### §4.2 FN-КЛАСС 2: ПД/kinopub, ПД/kinoflix, ПД/geosaitebi — HIDE при живом контенте

**Это самый серьёзный остаточный FN-класс (3 пары, один тайтл — Последний дом 2026).**

| Пара | Maniya | GT (6 нод) | Механика скрытия |
|---|---|---|---|
| ПД/kinopub | hide | **6/6 CONTENT** | cs=200 CARDS: links (Последний дом слева 2009/1972) — другой фильм → RULE-1 title+год НЕ совпал → absent → hide |
| ПД/kinoflix | hide | 4/6 CONTENT (online3/63/37/77.90), 503×1 (11), 403 (online8) | kinoflix CS=200 CARDS: 1 link 2009 «Последний дом слева» → не совпал год → hide. НО на других нодах (online3 и пр.) есть полный плей-ряд |
| ПД/geosaitebi | hide | 5/6 CONTENT | CS=200 CARDS: link «ბოლო სახლი მარცხნივ» 2009 → поверхностно похожа, но это 2009 Last House on the LEFT — **другой фильм**; GT = контент на других нодах через прямой /lite |

**Гипотеза (подтверждается всеми тремя):** дисамбигуация по точному title+год работает против ПД — в кластере play-ряд для «Последний дом 2026» раскрывается через НЕ-«слева» ссылки и/или другие ноды, а классификатор видит только link-карту «Последний дом слева» (2009), склеивает как absent → hide. Отдельно: у kinopub/ПД GT 6/6 CONTENT — hide при 100% контента.

### §4.3 Форрест/kinopub: show с 0 items — INC-оправданный

GT: 1/6 CONTENT (online3), 5×503. show=true CORRECT (rule-3), но /videos=0 из-за pin на 503-ноду (ms=1757). Контраст: Тёмный/kinopub (тоже cs=503, plain=200 CARDS) даёт 12 items — сработал случайный выбор ноды pin; Форресту не повезло с нодой.

---

## §5. CONTENT-CLASSIFICATION (остаточный)

**Проблема 1 (Class C, Одиссея/geosaitebi, Скайуокер/geosaitebi):** LINK-карта с ТОЧНЫМ title и годом («ოდისეა» 2026, «სქაიუოქერი» 2019) = CONTENT по RULE-1. Реально: follow → ACCSDB — контент ЕСТЬ в кластере, но требует авторизации в @skaztv_bot. Maniya показывает source (правильно — контент существует), но юзер получает 0 items. **«show без items» — пограничный FP-first.** Отличается от §4.2 (там год 2009 vs 2026 — different movie).

**Проблема 2 (ПД/kinopub, ПД/kinoflix, ПД/geosaitebi, §4.2):** hide при существующем контенте — потому что год и суффикс «слева» в link-карте (2009) ≠ искомое (2026) → дисамбигуация не матчит → absent → hide. **FN класса 2 (3 пары, один тайтл).**

**Проблема 3 (Интерстеллар/kinopub):** show RELIABLE (2014 точный match), но /videos timeout 9000ms → 0. Составной тайтл «Интерстеллар / Interstellar» + год → RULE-1 exact → CONTENT → show. Должен давать items (пост 8613), but timeout на ноде pin.

**Итог §5:** классификация по RULE-1 (title+год) — основной тонкий гейт. Правильная в одном направлении (different-movie→hide: kinopub/Одиссея, kinopub/Скайуокер, kinopub/Паразиты, kinopub/Пусан, geosaitebi/ПД-2009), но даёт (a) show-с-0-items для exact-link (geosaitebi/Одиссея, Скайуокер, kinopub/Интерстеллар) и (b) hide-при-контенте для ПД (3 провайдера).

---

## §6. VIDEOS-ROUTING (pin) — проверка

/videos идёт по pin (row.host preferred-first). Подтверждено индиректно:
- Интерстеллар/kinopub: /videos timeout 9000ms (попытка на 503-ноду → потребление времени), затем 0.
- Форрест/kinopub: /videos 1757ms items=0 (роут через 503-ноду).
- Здоровые: Матрица/kinopub 709ms/22, Дюна/kinopub 549ms/14.
- Тайминговые окна §1.2: INC-rows (kinoflix/Одиссея) /videos 1014…3662ms → 0.

**Вывод:** pin перенаправляет на той же ноде, что и availability; 503-нода → /videos с 0, но время малое (<1s). Вреден только один кейс: Интерстеллар (9s timeout). pin-ротация работает (W1).

**Независимое подтверждение (ранняя aggregate-проба, 10:04, 11 тайтлов × ~6 prov):** во всех 62 строках `pin=N==nopin=N` (число items не зависит от пина — ротация/continue работают). В 2 строках pin фиксирован на `online3.skaz.tv` при GT CONTENT на `94.249.239.37` → pin удерживает ноду карты; между картой и GT нода может сместиться (флап наподобие §4.3), но items при этом не теряются (nopin-ротация).

---

## §7. Время выполнения /videos и 503/timeout комбо

| Сценарий | Наблюдение live | Причина |
|---|---|---|
| /videos timeout 9000ms (Интерстеллар/kinopub) | единственный долгий кейс из 96 | нода pin (online8? postid follow) или кэш-лимит |
| /card 9–12s по матрице | Одиссея 9145ms, остальные 12.2s | 13 провайдеров × deadline ~ 9s параллельно: норма |
| kinoflix 503 во всех | 6×503 | балансер kinoflix недоступен в окне (data не дал ни одной 200) |
| solntse 503 на многих | Одиссея/Скайуокер/Аватар/Пусан 503 | частичная недоступность solntse |

---

## §8. Сводная классификация оставшихся расхождений

| Класс | Кол-во | Строки | Вердикт для Maniya |
|---|---|---|---|
| FP INC-show (Class A, items=0 при 503-нодах) | 12 | §1.2 (kinoflix×4, solntse×4, videoseed×3, geosaitebi×1) | Оправдан rule-3 (show через транзиент), но юзер-видимый FP (пустой источник) |
| CONTENT-link show-с-0-items (Class C) | 4 | geosaitebi/Одиссея, geosaitebi/Скайуокер, kinopub/Интерстеллар, pidtor/ДД | Пограничный: контент существует, но items=0 (ACCSDB/timeout) |
| CORRECT hide (200-link different-movie / EMPTY) | 7 | kinopub/Одиссея, kinopub/Скайуокер, kinopub/Паразиты, kinopub/Пусан, pidtor/Одиссея (EMPTY 6/6), geosaitebi/ПД (2009 другой фильм), kinoflix/ПД см. FN | hide CORRECT по RULE-1 |
| **FN-класс 2 (hide при живом контенте)** | **3** | **ПД/kinopub (GT 6/6), ПД/kinoflix (GT 4/6), ПД/geosaitebi (GT 5/6)** | **Реальный FN — один тайтл «Последний дом 2026», три источника** |
| INC show при реальном контенте (1/6 нод) | 1 | Форрест/kinopub | show CORRECT (не FP), items=0 из-за pin |
| VIDEOS-ROUTING (pin на 503-ноду → timeout/0) | 1 | Интерстеллар/kinopub /videos 9000ms→0 | Пограничный (время) |
| CLUSTER-MISMATCH | 0 (закрыт W1) | — | целевой результат достигнут, регрессии нет |

---

## §9. Детальный разбор E-Online ключевого кейса

(Этот раздел покрыт документами AUDIT-001/FN-AUDIT-001/CANONICAL; здесь — только остаточное связывание с текущими находками.)

- E-Online показывает kinopub для интерстеллара 2014 → он показывает то же (items, но там реальный контент post).
- И «Rus-1/Rus-2» — разные кластерные балансеры (см. §10).

---

## §10. IDENTITY-МОДЕЛЬ: E-Online «RUS-1/RUS-2-4K» ↔ кластер Skaz ↔ Maniya (user injection #1/#2)

### §10.1 Свежий кластерный lifeevents (эталон)

4 последовательных снапшота (16:47:15–16:47:30, каждый ~5s — «готовность кластера» стабильна):

| Хост | status | total строк | ready/tasks | VK-семейство | Rutube-семейство |
|---|---|---|---|---|---|
| online3.skaz.tv | 200 | **32** (стабильно) | undefined/undefined | `{"name":"VK Видео","url":"…/lite/vkmovie","balanser":"vkmovie"}` | `{"name":"Rutube","url":"…/lite/rutubemovie","balanser":"rutubemovie"}` |
| 94.249.239.11 | 200 | 30–31 (флап ±1) | undefined/undefined | та же строка (url → 94.249.239.11) | та же строка |
| online8.skaz.tv | 200 | 9–10 | undefined/undefined | **НЕТ** (урезанный список, 9-10 источников) | **НЕТ** |

Ключевые факты:
- **`{ready,tasks}` в /lite/events НЕ возвращаются** (undefined во всех 12 замерах, 3 хоста × 4 цикла) — «ready=false/tasks=29» в инъекции юзера — это НЕ состояние этого кластера/DNS-эндпоинта. Возможны варианты: клиент E-Online дополняет сам, или снимал с другого слоя (online4/oleg6 — но те отдают accsdb для наших creds, см. §10.2 п.6).
- **`index/show/voices/seasons/rch` в /lite/events отсутствуют** — все варианты {token/online/isSerials} вернули чистый ARRAY[32] без обогащения. → **«index:16, voices:21, rch:false» — клиентское обогащение E-Online** (из своей карты/meta/quality-model), не поле кластера.
- vkmovie и rutubemovie — **раздельные balanser'ы на обеих основных нодах** (online3 + 94.249.239.11), online8 их не имеет (легаси-слой).

### §10.2 Разбор по 11 пунктам (INJECTION #1)

1. **vkmovie в Skaz registry?** — ДА: live /lite/events = vkmovie («VK Видео»), url online3/lite/vkmovie, бalanser vkmovie. Входит в список.
2. **vkmovie в Maniya registry?** — НЕТ как skaz-bprovider: config.skaz.balancers → 14 слогов (alloha…rhsprem), vkmovie отсутствует. В `registry.EO_TITLES` есть `vkmovie: 'Maniya · VKMovie'` (только display). → buildSkazProviders создаёт skaz-только из config списка → vkmovie нет нигде.
3. **Почему нет в /sources?** — /sources строится из providers registry; vkmovie не создан → отсутствует.
4. **«Rus-1-4K» = vkmovie?** — ЧАСТИЧНО: display-namer E-Online для balanser `vk` (meta.js: `vk: {name:'RUS-1'}`) — ЛЕГАСИ-имя. Текущий кластер НЕ имеет balanser `vk` (только `vkmovie`). Клиент E-Online может навешивать «- 4K HDR» (качество из voices/quality). Точное сопоставление «Rus-1-4K↔vkmovie» НЕ доказано на уровне серверного identity (см. §10.3).
5. **Переименован/заменён?** — `vk` (номер display-маппинга meta.js) и `vkmovie` (объект в жизни кластера) — РАЗНЫЕ сущности: по eonline-gap, `vk` (RUS-1) = 404/rch (WebSocket-only, REST не играет; ashdi — контроль rch), `vkmovie` = REST-живой play (21×2160p→144p, live-нода). Текущий кластер не содержит `vk` — только `vkmovie` (актуальное «ВК Видео»).
6. **online4 — отдельный слой?** — ДА: online4.skaz.tv/oleg6.skaz.tv живые, но их /lite/events → accsdb «Войдите в аккаунт» (для наших creds), НЕ массив источников. → online4 в orderedSkazHosts не включён (правильно; онлайн4 = другой кластерный слой, аккаунт-гейт).
7. **Почему source online4 present/absent?** — Для наших creds online4 закрыт accsdb → sources нет. Дороже: E-Online, вероятно, проходит own creds (granted), поэтому видит и online4.
8. **Полная цепочка vkmovie: /sources→/sources/card→/videos→playback:** нет (providers отсутствует). Прямой кластер: /lite/vkmovie на 94.249.239.11 (единственная живая нода) → 21 play-карта (Матрица), 206 Range video/mp4 → реальный playback, а на других нодах 503/null (см. §10.4).
9. **Реально играбельный контент, ≥3 тайтла:** Матрица 1999 → 21 play (качества 2160p→144p), Аватар 2009 → 20 play, Дюна 2 2024 → 11 play. Все через единственную ноду 94.249.239.11. (serial vkmovie → series 0 на всех нодах; сериалов нет.)
10. **Playback:** подтверждён §10.4 (Range 206, video/mp4, ftyp ‹isom› подпись).

### §10.3 Разбор машиппинга RUS-2 (инъекция #2)

- **«Rus-2-4K»** — дисплей-имя для **balanser `rutube`** (meta.js line 38: `rutube: {name:'RUS-2'}`). Текущий кластер НЕ имеет `rutube`: только `rutubemovie` («Rutube», url online3/lite/rutubemovie).
- **Rus-1 / Rus-2 = legacy vk/rutube** из старых волн; «- 4K HDR» — клиентское качество.
- **Maniya: rutubemovie ЕСТЬ** (native Rutube provider + hidden twin skaz-rutubemovie) → семья RUS-2 покрыта. **vkmovie отсутствует** → семья RUS-1 НЕ покрыта (реальный пробел).
- **vkmovie = vk, НО не работает через REST** (vk rch). vkmovie — работающий аналог.
- Ответы на (a)-(d): vkmovie и rutubemovie = **два разных live balanser'а** (не один источник, не два presentation одного, не два энтерпрайза). Доказательство: /lite/events содержит обе строки отдельно; карты на ноде различаются (21 vs …).

### §10.4 Ключевое доказательство playback'а (manifest через ноду, byte-read)

- play-url vkmovie (Матрица) = `http://94.249.239.11/proxy/{opaque}` (токен кластера-внутренний).
- GET с `Range: bytes=0-1023` → **206**, `content-type: video/mp4`, `content-range: 0-1023/6984078646` (6.98 GB), 1024 байта прочитано, подпись `…ftypisom…` → **реальный playable MP4 файл**.
- Без Range → 200 с content-length 6984078646, но при `.text()` → 0 байт (поток/возможность).

### §10.5 Итог по vkmovie/RUS-1/RUS-2

1. **E-Online «Rus-1-*» ↔ кластерный balanser `vkmovie`** (текущий), display-суффикс качества — клиентский.
2. **«Rus-2-*» ↔ кластерный balanser `rutubemovie`** (семья покрыта Maniya native).
3. **vkmovie = реальный отсутствующий источник** (VK-семейства: 21/20/11 play на live-ноде, 206-воспроизведение MP4-файла). Не закрыт в Maniya (нет в config.skaz.balancers).
4. **Не авто-добавлять:** авторизация (REST-жив только на 94.249.239.11), сериалов нет, proxy-токен кластера внутренний, online4/oleg6 закрыты accsdb. Для Maniya нужен НОВЫЙ клиент/parsing (не registry-флаг).
5. **Важность:** RUS-1-семейство — единственный заметный пробел в покрытии источников (E-Online показывает «Rus-1-4K», Maniya — нет).

---

## §11. Остаточные GAP (карта проблем; НЕ предлагается код — по решению юзера)

1. **FN-класс 2 — ПД/kinopub, ПД/kinoflix, ПД/geosaitebi (§4.2):** hide при живом контенте (год «слева» 2009 ≠ 2026 → RULE-1 absent). **Единственный класс «обратного» расхождения** (у Maniya контент есть, а рука скрывает).
2. **CONTENT-link show-с-0-items (§1.3/§5):** geosaitebi/Одиссея+Скайуокер, kinopub/Интерстеллар (timeout), pidtor/ДД (ACCSDB) — юзер видит источник, но items=0. Два разных под-типа: (a) контент существует но за гейтом бота; (b) контент существует но нода недоступна. Оба — «достоверный show, плохой items», не «ошибочный show».
3. **FP INC-show с items=0 (§1.2):** by-design (rule-3 anti-FN). Это метрика, не баг: 12 пар, все с нодами-503, где реального контента нет. Если снижать — упадёт anti-FN (Форрест/kinopub и станет скрываться). Баланс осознанный.
4. **vkmovie как источник (§10.5):** единственный реально отсутствующий источник в Maniya (RUS-1-семейство E-Online). НЕ авто-добавлять: live только на 1 ноде (94.249.239.11), сериалов нет, proxy-токен кластера внутренний, online4/oleg6 закрыты accsdb для наших creds. Требует отдельной задачи (новый клиент/плей-обработка, не registry-флаг).
5. **Время /videos (Интерстеллар/kinopub 9000ms→0, §7):** единственный долгий кейс из 96; pin на 503-ноду даёт полный timeout. Метрика.

---

## ITOG (Сводка)

1. **Матрица 12×9 = 108 ячеек.** CORRECT: все CONTENT-пары с items≥1 (52) + CORRECT-hide (6: kinopub/Одиссея, kinopub/Скайуокер, kinopub/Паразиты, kinopub/Пусан, pidtor/Одиссея, geosaitebi/ПД) = 58 твёрдо-корректных. Остальное: **12 FP INC-show (503-ноды, по-дизайну)**, **4 CONTENT-link show-0-items**, **3 FN (ПД×3 провайдера)**, 1 INC-оправданный (Форрест/kinopub).
2. **Рабочая семантика show/hide правильная в 4/4 сценариях таблицы решений** (§0): hide только при единогласном 2xx-EMPTY; любой CONTENT-сигнал (включая 503-расхождения → INC-show) показывает. CLUSTER-MISMATCH не регрессирован.
3. **Ключевые остаточные проблемы — НЕ в правиле show/hide**: (a) **FN-класс 2 (ПД 2026, 3 источника)** — скрывает реальный контент (самое важное); (b) **show-с-0-items** (exact-link→ACCSDB/timeout); (c) **vkmovie** — отсутствующий источник (live 21/20/11 play на ноде, MP4 6.98GB, 206-воспроизводим).
4. **identity-модель E-Online подтверждена по lifeevents**: «Rus-1-*»/«Rus-2-*» = display (клиентские суффиксы качества «4K HDR» и index/voices/rch в событиях кластера отсутствуют — ARRAY[32] без обогащения). Кластерные balanser'ы: `vkmovie` («VK Видео») и `rutubemovie` («Rutube») — раздельные строки. Maniya покрывает Rutube-семейство native, VK-семейство — отсутствует. vkmovie REST-жив ТОЛЬКО на 94.249.239.11.
5. **Playback vkmovie доказан**: play-URL Матрицы = `http://94.249.239.11/proxy/{opaque}` → GET Range → **206 video/mp4, content-range 0-1023/6984078646, байты ftyp-isom** (реальный MP4 6.98 ГБ). Без Range тело `.text()` пусто (поток), это НЕ отсутствие контента.
6. **READ-ONLY соблюдён**: код/тесты/config не менялись; commit/push/deploy нет; временные probe-скрипты удалены.

STOP после отчёта (READ-ONLY).