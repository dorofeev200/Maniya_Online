# LAST-HOUSE-FN-AUDIT-001 — «Последний дом» (2026): kinopub / kinoflix / geosaitebi

**Дата:** 2026-08-16. **Режим:** READ-ONLY (код/тесты/config не менялись, commit/push/deploy не делались).
**Цель:** определить точный root cause остаточного «FN»: Skaz-кластер вроде имеет CONTENT/playable по «Последний дом» 2026, а Maniya скрывает источник для kinopub/kinoflix/geosaitebi.
**Метод:** live-пробы на VPS (95.85.241.121) двумя probe-скриптами (raw cs/plain по 6 нодам кластера, follow link-карточек и postid, реальный пайплайн Maniya defaultChecker.card + SkazProvider.videos ×3 uid) + статические семантики Lampac (KinoPub.контроллер/Service, OnlineApi.checkSearch).

---

## §1. Проверяемый запрос и объект

- Запрос Maniya: `id:1284041` (TMDB), `imdb_id:tt32268156`, `title:«Последний дом»`, `original_title:The Last House`, `year:2026`, `serial:0`. (id 1284041 — **TMDB id**, НЕ kinopoisk.)
- Искомый фильм реален: «Последний дом» (The Last House) 2026 — kinopoisk film/6943600, kino.mail.ru 956297 (веб-верификация, не из кластера).
- Другой фильм: «Последний дом слева / The Last House on the Left» — ремейк 2009 (Dennis Iliadis; IMDb tt0454841) и оригинал 1972 (Wes Craven; IMDb tt0067309) — **разные картины**, не искомые.

---

## §2. Что вернул кластер (live, схематично)

### kinopub (6/6 нод)
| мода | статус | len | data-json | videos__line | Maniya | naive Lampac |
|---|---|---|---|---|---|---|
| cs (checksearch) | **503 `null`** ×6 | 0-4 | 0 | false | absent | false |
| plain | **200 ×6** (идентично) | 2056 | **2** | **true** | **absent** | **true** |

Обе карточки, на ВСЕХ нодах, идентicчно:
- `{method:link, year:2009, similar:true, title:«Последний дом слева / The Last House on the Left», url:…/lite/kinopub?postid=2536&title=Последний дом&original_title=The Last House}`
- `{method:link, year:1972, similar:true, title:«Последний дом слева / The Last House on the Left», url:…/lite/kinopub?postid=12646&title=…}`

> Замечание: `cs` на kinopub **флапает 503↔200** (в probe-1 — 503×6, в повторе stability — 200). На вердикт не влияет: и при 200 карточки те же декой → absent.

### kinoflix (5/6 200; online8 — 403 `disable` len=7)
- 1 link-карта `{method:link, year:2009, similar:true, title:«Последний дом слева / The Last House on the Left», url:…/lite/kinoflix?title=…&href=movie/4195/the-last-house-on-the-left}`. Maniya absent, naive true.

### geosaitebi (5/6 200; online8 — 403 `disable`)
- 1 link-карта `{method:link, year:2009, similar:true, title:«ბოლო სახლი მარცხნივ» («Последний дом слева», груз.), url:…/lite/geosaitebi?…&href=6368-filmi-bolo-saxli-marcxniv-qartulad.html}`. Maniya absent, naive true.

### След-цепочки (наивный follow первой link-карты — что показала бы «показ»-ветка)
| follow | статус | play-карточки | контент |
|---|---|---|---|
| kinopub postid=2536 | 200, len=4815 | 3 × **«Последний дом (unk)»** | cdntogo.net/hls m3u8 1080p/720p/480p (kinopub item aWQ9MTI1MzE4) |
| kinopub postid=12646 | 200, len=3449 | 2 × **«Последний дом (unk)»** | ams-static-02.cdntogo.net/hls (item aWQ9Mjc5NjIx) |
| kinoflix href movie/4195/… | 200, len=2649 | 2 × **«Последний дом (Грузинский)/(Английский)»** | online3.skaz.tv/proxy/{opaque} |
| geosaitebi href 6368-…html | 200, len=1211 | 1 × **«Последний дом (Последний дом)»** | online3.skaz.tv/proxy/{opaque} |

**Ключевой факт:** у play-карточек title = **эхо искомого названия** (MovieTpl в Lampac рендерит `title` из URL-параметров, см. §4). Реальные айдишники контента (kinopub item 125318/279621, kinoflix item 4195, geosaitebi slug 6368) — это «The Last House on the Left» 2009/1972. **Под именем искомого играл бы ДРУГОЙ фильм.**

### Варианты запроса (закрывают B/C/E/D)
| балансер | вариант | статус | результат |
|---|---|---|---|
| kinopub | imdb-only (cs/plain) | 503 | null (модулю нужен title для search) |
| kinopub | title+year / RU-only / orig-only | 200 | те же 2 декой link-карты, absent |
| kinopub | **title+orig+**`kinopoisk_id=6943600` (настоящий KP id 2026) | 200 | **те же 2 декой link-карты** → фильма 2026 в БД kinopub нет |
| kinoflix | imdb-only | 503 | пусто |
| kinoflix | title+year / orig-only | 200 | 1 декой link-карта |
| geosaitebi | imdb-only / title+year | 503 | модуль не ищет по этим формам; по базовому запросу — 1 декой |

**Вывод по пункту (4) и (11) задания:** карточки «Последний дом» **2026 не существует ни на одной из 6 нод ни в одном из трёх балансеров** — контент-отсутствие это факт БД кластера, а не артефакт конкретной ноды.

---

## §3. Механика кластера (почему возвращается только похожее)

**KinoPub module (Lampac Modules/OnlinePaid/KinoPub/Controller.cs + Service.cs):**
- `Controller.Index` при `postid==0` → `Search(title, original_title, year, clarification, imdb_id, kinopoisk_id)`.
- `Search` выставляет `result.id` ТОЛЬКО если элемент совпал по `item.kinopoisk==kinopoisk_id` или `tt{item.imdb}==imdb_id`, или (единственный кандидат с годом ∈ [year-1, year, year+1] и префикс/суффиксом титла).
- `if (similar || search.Value.id == 0) return ContentTpl(search.Value.similars)` — **id==0 → страница ТОЛЬКО из похожих link-карточек** (+ самих фильмов «слева»). Для ПД: `tt32268156` ничему не равен, `6943600` не найден, а единственные кандидаты 2009/1972 вне окна [2025, 2027] → **id==0** → similars-only страница (live: len=2056, 2 `similar:true` link-карты).
- `Tpl` → `new MovieTpl(title, original_title, …)` — **query-эхо**: в URL плеера всегда титул запроса, отсюда «Последний дом (unk)» даже для чужого фильма.

**kinoflix / geosaitebi** — аналогичный search-слой, единственной картой похожести выдаётся 2009 «…слева» → те же след-семантики.

**Lampac OnlineApi.checkSearch (эхо/ссылка на E-Online) — наивный предикат (954-1055):**
`work = rch || res.Contains("data-json=") || "type":movie/episode/season`. На similars-странице `data-json=` присутствует → **work=true** → E-Online «SHOW». Это ровно тот же сигнал, что прежний GT трактовал как «CONTENT».

---

## §4. Реальный пайплайн Maniya (live, READ-ONLY)

Проверено через действующий `defaultChecker.card(Q, uid, force)` + `SkazProvider.videos({query:{…,host:row.host}})` на VPS, три разных tag uid:

| uid | balancer | show | auth | inconc | host | status | items/seasons/voices |
|---|---|---|---|---|---|---|---|
| audit-u1 | kinopub | **false** | true | **true** | online8 | 503 | 0/0/0 |
| audit-u1 | kinoflix | **false** | true | false | online3 | 200 | 0/0/0 |
| audit-u1 | geosaitebi | **false** | true | false | online3 | 200 | 0/0/0 |
| audit-u2 | kinopub | **false** | true | false | online3 | 200 | 0/0/0 |
| audit-u2 | kinoflix | **false** | true | false | online3 | 200 | 0/0/0 |
| audit-u2 | geosaitebi | **false** | true | false | online3 | 200 | 0/0/0 |
| audit-u3 | kinopub | **false** | true | false | online3 | 200 | 0/0/0 |
| audit-u3 | kinoflix | **false** | true | false | online3 | 200 | 0/0/0 |
| audit-u3 | geosaitebi | **false** | true | false | online3 | 200 | 0/0/0 |

- Hide **стабилен: 9/9 (3 uid × 3 балансера)**, пункт (12) задания исключён (не флап).
- Метрики `items=0` — корректны: `postidFromCards`/`linkCardMatchesQuery` не выбирают декой (год вне окна, титл-части ≠) → /videos пусто. Показанный источник без селекции карты тоже дал бы 0 (кинопуб: только пост-фоллоу декой).
- kinopub u1 503-inconc на online8 — известный cs-флап резервной ноды; verdict тот же (подтверждено plain-абсенсом на дочерних прогонах).

---

## §5. Почему прежний «GT 6/6 CONTENT» = артефакт

Прежняя метрика считала источник «CONTENT», если страница содержала `data-json`/`videos__line` (страница с карточками). Live подтверждает: на **всех 6 нодах** plain 200 + `videos__line:true` + `data-json:2` → «GT 6/6 CONTENT» (kinopub), «4/6» (kinoflix: online8 403) и «5/6» (geosaitebi: online8 403). Но содержимое страницы = **similars-страница декой-карточек** (id==0 по §3). Т.е. GT измерял «на странице есть карточки», а не «есть искомый фильм». Это **тот же наивный предикат**, что у Lampac checkSearch (E-Online), и именно он порождает и «GT CONTENT», и E-Online ghost-SHOW. **FN-класс 2 прежнего отчёта не подтверждается.**

---

## §6. Обязательная таблица (пункт «две таблицы»)

### Таблица (a): provider × кластер
| provider | кластер (ноды) | возвращённый title | год | IDs на карточке | similar | method | playable | Maniya | E-Online |
|---|---|---|---|---|---|---|---|---|---|
| kinopub | все 6 нод (online3/8+IP, одна страница) | «Последний дом слева / The Last House on the Left» ×2 | 2009 (postid=2536, kinopub item 125318), 1972 (postid=12646, item 279621) | postid; tt0454841/tt0067309 (референс) | true | link | только за пост-follow — фильм 2009/1972 под эхо-названием; **2026 нет** | **hide (ВЕРНО)** | SHOW (ghost) |
| kinoflix | 5/6 (online8 403-disable) | «Последний дом слева / The Last House on the Left» | 2009 | href `movie/4195/the-last-house-on-the-left` | true | link | за follow — 2 play-эха 2009; **2026 нет** | **hide (ВЕРНО)** | SHOW (ghost) |
| geosaitebi | 5/6 (online8 403-disable) | «ბოლო სახლი მარცხნივ» | 2009 | href `6368-filmi-bolo-saxli-marcxniv-qartulad.html` | true | link | за follow — 1 play-эхо 2009; **2026 нет** | **hide (ВЕРНО)** | SHOW (ghost) |

### Таблица (b): WRONG CARD / RIGHT CARD
| | WRONG CARD (декой 2009/1972) | RIGHT CARD («Последний дом» 2026) |
|---|---|---|
| WHY MANIYA CHOSE IT | **НЕ выбрала**: RULE-1 (split-части «слева/the-last-house-on-the-left» ≠ запроса; год 2009/1972 вне [2025-2027]) → absent → hide по OLD∩NEW | — |
| WHY SKAZ ACCEPTED IT | модуль Search id==0 (нет матча по tt32268156 / kp 6943600 / 2026) → similars-only страница; kinoflix/geosaitebi — похожий как единственный результат | карты нет в БД: все варианты запроса (вкл. верный kinopoisk_id) → не существует |
| WHY E-ONLINE ACCEPTED IT | наивный предикат checkSearch (data-json= присутствует) → work=true → SHOW; клиент при открытии follow-ит первый similar → wrong-film под эхо-именем | отсутствует, но предикат всё равно «SHOW» (ghost) |

---

## §7. 12 пунктов задания

1. **Реальный декой или нет** — ДА. 2009/1972 «The Last House on the Left» — другие фильмы (Wes Craven-франшиза), `similar:true`, выданы как похожесть на запрос.
2. **Альтернативное/локализованное имя** — не найдено: RU/EN/груз. варианты не дали 2026-карту нигде.
3. **Верные IMDb/KP ID на карточке** — на декой-картах своя атрибутика (2009/1972); KP 6943600 искомого известен только из внешнего веба, в кластере его нет.
4. **Есть ли 2026-карточка** — **НЕТ** (3 бал. × 6 нод × все формы запроса).
5. **Составной/альтернативный титл** — декой = «…слева / The Last House on the Left»; GAP-005-сплит корректно даёт части ≠ искомого + год мимо → absent. Случай не совпадает с GAP-005.
6. **Несколько link-карт / wrong-first-pick** — в kinopub их 2 (2009+1972); naive first-pick взял бы 2009. Maniya их не пикает (year-gate).
7. **Playable контент за «правой» картой** — правой карты нет; за левой(декой) playable ЕСТЬ, но это wrong-film (эхо-название «Последний дом (unk)» доказано live).
8. **Как E-Online/Skaz выбирает эту карту** — Skaz: id==0 → similars-only страница (рендерится самим модулем). E-Online: наивный предикат → SHOW, клиент берёт первый similar.
9. **Что Lampac OnlineApi.cs делает с link-результатом** — `work=true` по `data-json=` → источник помечается доступным (ghost-SHOW); различать «часть фильма»/«похожее» не умеет.
10. **Тот же класс, что GAP-005** — **НЕТ.** GAP-005: false-absent для карточек, которые *и есть* искомый фильм (составной RU/EN титл слит normalizeTitle). Здесь карточки — *не* искомый фильм, и absent **корректен**.
11. **Кластерная зависимость** — контент-отсутствие = факт БД кластера (6/6 нод одна страница). Hide независим от pin/orderedSkazHosts/uid.
12. **Повтор ≥3× на разных uid** — 3×9 hide стабильно; raw-стабильность повторена отдельно; cs-флап (503↔200) вердикт не меняет.

---

## §8. Варианты A–G (вердикты)

- **A (чужой фильм → hide корректен)** — да: ПД 2026 ≠ «…слева» 2009/1972; hide = защита от wrong-film.
- **B (тот же фильм, др. имя → RULE-1 слишком строг)** — не подтверждён: правой карты нет ни под каким именем.
- **C (правая карта 2-я/3-я → баг выбора)** — нет правой карты вообще.
- **D (правая карта на другой ноде)** — 6/6 нод идентичны; не подтверждён.
- **E (титл/год верны, ID отсутствует)** — **проверен с верным kinopoisk_id=6943600**: тот же декой → фильм отсутствует в БД балансеров. Не спасает.
- **F (контент только через postid/link-follow)** — follow даёт playable, но wrong-film (эхо-имена) → показ не дал бы ПД.
- **G (нестабильно/транзиентно)** — исключён (3×3 + повтор raw).

---

## §9. ИТОГ

### (A) Точный root cause
«Последний дом» (2026) **отсутствует в кластерных БД kinopub/kinoflix/geosaitebi**. Единственные карточки, которые возвращают все три балансера на всех нодах, — **декой-ссылки на другие фильмы** 2009/1972 («Последний дом слева / The Last House on the Left»), сгенерированные модулем как similars-only страница (kinopub: `Search.id == 0` → `ContentTpl(similars)`). Maniya корректно классифицирует их absent (RULE-1: split-части титла + год вне окна) и прячет источник по OLD∩NEW. **Ни один элемент пайплайна Maniya не даёт неверный результат.**

### (B) Доказанный FN или не FN
**НЕ FN.** Показ источника в этом кейсе = wrong-film playback под названием искомого (live-доказательство: play-карточки «Последний дом (unk)» за postid 2536/12646, «(Грузинский)» на kinoflix, «(Последний дом)» на geosaitebi — это фильмы 2009/1972). Hide — правильная семантика.

### (C) Какие правила работают правильно
RULE-1 `classifyLinkCard` (split-части + год), проверка link-карт как не-контента, `checkSearchPredicate`, OLD∩NEW + confirm-абсенс + backoff, MANIYA-аuthoritative-подтверждение, `reservePolicy='abstain'` (online8 для non-kinopub), single-flight, pin@row.host, SkazClient continue-скан, «EMPTY только все-ноды-«нет»». Реальный пайплайн: hide 9/9 с авторитетными статусами 200/503 — стабильно и детерминированно.

### (D) Какое правило даёт неверный результат
В PROD — **ни одно** (hide верен). Неверный результат даёт **наивный предикат наличия карточек на странице** (`data-json` / `videos__line`): он порождает и прежний «GT 6/6 CONTENT», и E-Online ghost-SHOW (Lampac `OnlineApi.checkSearch` `res.Contains("data-json=")`).

### (E) Минимальное концептуальное изменение
**В коде Maniya — НИЧЕГО менять не нужно.** Для методологии GT (если он будет использоваться в дальнейших аудитах): контент-сигнал = matched-query-карточка по id/титл-частям/году, ИЛИ Lampac item-search семантика (`result.id ≠ 0`), а НЕ наличие `data-json`/`videos__line`. Показ декой-источников опционален только через film-identity gate после follow (check по титлу/году/пост-ид против запроса) — но это НЕ рекомендуется и вне скоупа этого аудита.

### (F) Какие тесты понадобятся
Новых prod-тестов не требуется — поведение корректно и уже закреплено (`availability.test.js:165-168` — «Последний дом слева / The Last House on the Left» 2026 и 2009 → `absent`; `skaz-navigation-004.test.js:87` — similar-карточки 2009/1972 → postid=null). Если хочется закрепить методологию GT: фикстура «страница с декой-карточкой (`similar:true`, др. год/титл-части) ≠ контент».

### (G) Какие регрессии возможны
Никаких: код, тесты и config не менялись; деплой не выполнялся. Семантика существующих источников не затронута.

### (H) Что НЕ надо менять
RULE-1/`classifyLinkCard`, link-классификацию, OLD∩NEW/confirm/backoff, HIDE_TTL, W1 (hostOrder/порядок нод/pin), `orderedSkazHosts`, online8 `abstain`, single-flight/кэш-карточек (STABILITY-002/003), GAP-005 (сплит по «/»), GAP-002, Kodik-fix (solodcdn), Collaps, proxy.js, provider registry. Предикат GT — только в методологию аудитов, не в код.

---

## §10. Классификация: новый баг или расширение GAP-005

**Ни новое, ни расширение GAP-005.** GAP-005 был ложным «absent» для карточек, которые *являются* искомым фильмом (нормализатор склеивал «RU / EN»). Здесь RULE-1 работает правильно (карточки — реально другой фильм). Феномен относится к классу **«недостоверный предикат наличия контента»** — тому самому, что даёт E-Online ghost-SHOW (Lampac naive `checkSearch`). Это дефект **методологии GT прежнего аудита**, не дефект Maniya.

## §11. Примечания
- Секреты (account_email/uid) в отчёт не включены; пробы гонялись на VPS из /opt (config.js читает /opt/maniya-online/server/.env).
- Временные probe-скрипты удалены локально и на VPS.
- READ-ONLY соблюдён: diff в `git status` — пусто, коммитов/деплоев не было.
- STOP (после удаления probe-скриптов).