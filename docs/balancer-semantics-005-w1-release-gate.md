# BALANCER-SEMANTICS-005-W1 — RELEASE GATE REVIEW (дополнение к имплементационному отчёту)

Дата: 2026-08-15 (вечер). Статус: **REVIEW ONLY — ничего не менялось, не коммичено, не пушилось, не деплоилось.**
Ответвления: `docs/balancer-semantics-005-w1-implementation-report.md` (реализация), `docs/balancer-semantics-005-w1-design.md` (дизайн), `docs/balancer-semantics-005-report.md` (аудит).

Вердикт в конце: **READY FOR RELEASE** (релиз — только по отдельному разрешению владельца).

## 0. Метод и разделение доказательств

| Блок | Тип | Инструмент |
|---|---|---|
| Pinned-host fallback (A→B), all-node failure, state-таблица, пин (п.1/2/4/5 гейта) | **CONTROLLED ALGORITHM EVIDENCE** | `scripts/w1-release-gate.mjs` (mock-кластер fake fetchImpl, **настоящий** код W1: availability.probe/pinMap, SkazClient._scanLite/_liteTargets/_poolIndex, SkazProvider.pinFromContext, hostOrder) |
| Повторная проверка 8 тайтлов (п.3 гейта) | **LIVE SKAZ EVIDENCE** | shadow `/tmp/shadow-gate` на VPS (боевой `.env`, staged-копия src = release candidate, стенд удалён) |
| Один краевой сценарий (Паразиты/kinopub B→A) | **НЕ выдан за live-факт** — live предусловие отсутствует (контента нет в кластере) → алгоритм доказан только controlled | — |

Границы честности: контроллируемые id (h1,h2,h3) имеют разные семантики от живых нод skaz (online3/online8/IP) — сравнение КАЧЕСТВЕННОЕ (алгоритм), не количественное.

## 1. PINNED-HOST FALLBACK — CONTROLLED (п.1 гейта)

Карта → `show` (FOUND) на ноде A → пин A (authoritative). Затем `/videos` с пином A, кластер: A негоден, B (2-я нода) — контент. **Показаны фактические попытки нод** (`attempts=`), а не только итог.

| Вариант провала пина | Фактические attempts `/videos` | items | Результат |
|---|---|---|---|
| A: 2xx-non-content (`null`) | `http://h1#rezka > http://h2#rezka` | 1 | старт с пина h1 → провал пина (продолжение скана) → B CONTENT |
| A: timeout (fetch throw) | `http://h1#rezka > http://h2#rezka` | 1 | старт с пина h1 → noResponse (continue) → B CONTENT |
| A: HTTP 500 | `http://h1#rezka > http://h2#rezka` | 1 | старт с пина h1 → non-2xx (continue) → B CONTENT |

Пин при карте подтверждён: `pin записан на h1, получено http://h1` (3 сценария). Каждый пиновый вызов стартует с пина (`v.seen[0] === h1`), а не с hosts[0]-пула. Пин = «как кандидат, а не жёсткий приказ» (дизайн §2.4/§8.2): провальная пин-нода не обрывает обход.

## 2. SEMANTICS OF ALL-NODE FAILURE — CONTROLLED + LIVE (п.2 гейта)

Контроллируемый случай **503 + 503 + timeout** (все кластеры без контента, ни один не дал authoritative EMPTY):

| Сторона | Состояние | Авторитетность | Дизайн §2.7 |
|---|---|---|---|
| `card` (skaz-rezka, reservePolicy='abstain') | `show:true, inconclusive:true` | `authoritative:false` | **INCONCLUSIVE**, НЕ hide, НЕ EMPTY |
| `videos` /SkazClient lastScan | `{nonContent:0, noResponse:3, total:3}` | — | **UNABLE/транзиент**, НЕ EMPTY (`EMPTY = nonContent==total && noResponse==0`) |
| `kinopub` (legacy-политика карты) | `show:false` | `authoritative:true` | kinopub намеренно исключён из abstain (BALANCER-ONLINE8-002): 503 = «нет источника» для КАРТЫ. **Pre-existing, W1 не меняет.** Клиент при этом всё равно UNABLE (не авторитетный EMPTY). |

Точный reason для карты (abstain-режим): all-503 → `sawStatusNo` (статусный шум, не «нет»-голос), h3 timeout → `sawNoResponse` → `sawDefinitiveNo==false` → rule 3/4: show/inconclusive. Для кинопуб: legacy-ветка `sawDefinitiveNo` (503=«нет») → hide.

**Live-подтверждение той же границы**: Паразиты/kinopub и Скайуокер/kinopub в окне шэдоу = **все 6 нод 503** (`online3:503 > online8:503 > …94.249.239.63:503 > …37:503 > …11:503 > 77.90.33.109:503`). По W1-клиенту это UNABLE (noResponse>0), не авторитетное EMPTY; карта kinopub-legacy гасит. Обе версии согласованы — «источник сейчас недоступен целиком», а не «контента нет» (структура может подняться) — дизайну не противоречит.

## 3. B→A — CONTROLLED (алгоритм) + LIVE (повтор 8 тайтлов, п.3 гейта)

### 3.1 CONTRolled: контент на последней ноде h3 (самый «B-трудный» случай)

| | OLDv (pre-W1: raw-порядок + FAIL-NOT-RETRY) | NEWv (W1: continue-скан) |
|---|---|---|
| h1 2xx-non-usable | EMPTY — **СТОП**, финал (баг-механизм) | non-usable → continue |
| h2 2xx-non-usable | (не достигнуто) | continue |
| h3 CONTENT | (не достигнуто) | **CONTENT, items=1** |
| total | `OLD=EMPTY (http://h1:null)` | `http://h1#rezka > http://h2#rezka > http://h3#rezka` |

Плюс карта на том же кластере: `card(контент на h3) = show|auth=true|…|http://h3`, `pin=http://h3` — FOUND и пин на **фактическую ногу контента** (не на hosts[0]). Это контроллируемый эквивалент «живого B→A», которого live не воспроизвёл.

### 3.2 LIVE SKAZ EVIDENCE — повтор 8 тайтлов (shadow, боевой .env, staged, стенд удалён)

userUid и креды вмаскированы; проба ≈ 10 тайтлов × 9 skaz-балансеров (+collaps). Фокус-строки из полной матрицы (log 333 строк):

| Тайтл / kinopub | CARD legacy | CARD new (W1) | OLDv (понодовый порядок) | NEWv nopin/pin | Класс | Оценка гейта |
|---|---|---|---|---|---|---|
| **Интерстеллар 2014** | `show*@94.249.239.63` | `show*@online3.skaz.tv` | `CONTENT online3:CONTENT/200` | 9 / 9 | CONTENT | оба клиента сошлись; карта в обеих версиях show (host-историч. отличие ноды — легитимно, не регрессия) |
| **Форрест Гамп 1994** | `show*@online3` | `show*@online3` | `CONTENT online3:CONTENT/200` | 25 / 25 | CONTENT | flapless; **playback PASS** (кард play → RESOLVED → манифест 200, m3u8, len 689) |
| **Паразиты 2019** | `hide*@online8` | `hide*@online8` | `EMPTY` (503 × **6 нод**) | 0 / — | EMPTY(same) | обе версии honest «нет»; B→A live невозможен (контента нет в кластере) → алгоритм см. §3.1 (LIVE/Controlled разделено) |
| **Одиссея 2026** | `hide*@94.249.239.37` | `hide*@online3` | `CONTENT online3:CONTENT/200` | 0 / — | CONTENT-OLD-NOW-EMPTY | артефакт парсера: страница usable (isUsablePage), 0 playable-кард → обе версии items=0; классификатор не менялся (установленный артефакт отчёта-реализации §4) |
| **Последний дом 2026** | `hide*@online8` | `hide*@online3` | `CONTENT online3:CONTENT/200` | 0 / — | CONTENT-OLD-NOW-EMPTY | то же (артефакт, не регрессия: карты hide одинаково OLD≠NEW только узел) |
| **Матрица 1999** | `show*@online3` | `show*@online3` | `CONTENT online3:CONTENT/200` | 22 / 22 | CONTENT | OK |
| **Дюна 2 2024** | `show*@online3` | `show*@online3` | `CONTENT online3:CONTENT/200` | 14 / 14 | CONTENT | OK |
| **Скайуокер 2019** | `hide*@online8` | `hide*@online8` | `EMPTY` (503 × 6 нод) | 0 / — | EMPTY(same) | кластер целиком 503 — UNABLE-семантика (не авторитетный EMPTY), обе версии 0 items, согласованы |

Прочие живые наблюдения:
- **Кросс-нодовый кейс** (контент после первой ноды) — в окне не воспроизвёлся; Интерстеллар дал разнческие card-host'ы legacy (IP-нода 94.249.239.63) vs new (online3), обе show — это пре-W1 delta host-выбора (reorderHosts vs raw-order), NOT W1, и обе версии читают контент.
- **Серийный Дом Дракона/kinopub**: `show@online3` (не-authoritative в ряду), nopin=10, **pin=—** — пин пишется только при authoritative FOUND; при inconclusive-карте каллы без пина ротацией находят 10 items. Соответствует дизайну (§2.4, §6.6-6.7).
- Отдельные «CONTENT-OLD-NOW-EMPTY» + «nopin=0/pin>0» (rhsprem/Интерстеллар nopin=0 pin=10) — установленный burst-артефакт насыщения кластера при стендовом параллелизме (свежие изолированные провайдеры = полные items), НЕ дефект W1 (отчёт-реализация §9.2).

**LIVE B-CASES = 0** (как и в предыдущем окне): предусловие «старт-нода 2xx-non-usable при контенте ПОЗЖЕ» живьём не встретилось; алгоритмическая корректность доказана controlled (§3.1) + юнитами (§6).

## 4. Таблица состояний (п.4 гейта) — CONTROLLED, 5 обязательных строк

| Случай | Состояние | Против ожидания |
|---|---|---|
| 200-empty одного кластера → rotation | `h1(non-usable) > h2(CONTENT)` items=1 | content-где-угодно → FOUND |
| 503 / timeout → rotation | `h1(timeout) > h2(CONTENT)` (h3 503 не посещён) items=1 | FOUND |
| all-errors (503×3) | card `show/inconclusive`, videos `noResponse:3, items 0` | **INCONCLUSIVE/UNABLE, НЕ EMPTY** |
| all-authoritative-empty (200-non-content×3) | card `hide (auth=true)`, videos `nonContent:3, noResponse:0` | **EMPTY — единственный путь к авторитетному hide** |
| content-anywhere (h2) | card `show/auth/h2, pin=h2`; videos `h1 > h2` items=1 | FOUND + пин на фактическую ноду |

## 5. Пин — 6 проверок (п.5 гейта) — CONTROLLED

| № | Проверка | Результат |
|---|---|---|
| 5.1 | uid-скоп: `pinnedHost(skaz-rezka,'uid-a')==='http://h1'`, `uid-b` до своей карты → `null`; после карты второй uid — своя запись `h1` | ключ разделяет uid (`userUid|providerId`), записи независимы |
| 5.2 | provider/balancer-скоп: rezka→пин h1, **kinopub**→пин h2 одновременно на одном юзере | балансеры не смешиваются |
| 5.3 | display-name не в ключе: строки несут только id (`skaz-rezka`, `skaz-kinopub`); доступ по id | title не участвует |
| 5.4 | TTL истекает: `ttlMs:200` → после 280 мс `pinnedHost` = `null` (deleted-on-read) | пин не «клеится» |
| 5.5 | перевыбор после TTL: без пина (контент мигрировал на h3) → ротация `h1>h2>h3` items=1 | нода выбирается заново, актуальный контент найден |
| 5.6 | пишется ТОЛЬКО на authoritative FOUND с host (не trusted/accsdb): проверено one-row + кодовые инварианты (п.7) | вердикт ≠ FOUND → пин удаляется |

Нюанс TTL (корректная семантика, не баг): `pinTtl = hasConfirmedHide ? HIDE_TTL_MS(60s) : ttlMs` — если в ТОМ ЖЕ card-прогоне другая строка получила подтверждённый hide (например, kinopub-легаси), пин резии 60 с (зеркалит кэш). Проверка 5.4 использует прогон без hide-строки → проверяется ветка `ttlMs`.

## 6. Регрессии (п.6 гейта)

| Область | Проверка | Результат |
|---|---|---|
| Полный suite | `cd server && NODE_ENV=test node --test` | **611 tests / 605 pass / 6 skip / 0 fail** (6 skip pre-existing) |
| GAP-002 host-block / единый порядок | `orderedSkazHosts([online8,online3,online5])` = `online3 > online5 > online8`; клиентский пул = пул карточки | online8 резерв-последний; parity (контроллируемая проверка + суита) |
| GAP-005 compound title | код `classifyLinkCard` не менялся; suite включает compound-тесты и зелёный | OK |
| VEO-015 VeoVeo/Ozvuchky | нормализатор/EO_TITLES/title-пути **отсутствуют в git status**; live веовэо-строки CONTENT (1 item в шэдоу) | OK (гейт не трогал) |
| STABILITY-004 orphan | `availability.js:462` `promise.catch(() => {});` на месте (не тронут W1) | OK |
| drift | `git status` server/src+test: только 5 W1-файлов M + hostOrder.js ?? + 3 новых тест-файла; никаких посторонних изменений | OK |
| identity ≠ presentation | id/balancer/названия вне diff; пин только в `query.host`, не наружу (whitelist buildPageParams + buildResolveUrl тесты живые) | OK |

## 7. Инструмент (прозрачность)

`scripts/w1-release-gate.mjs` — контроллируемый стенд (11 сценариев, 27 asserts, exit 0, лог `C:\tmp\w1-gate-controlled.log`). В процессе самопроверки стенд поймал ОДНУ ошибку у САМОГО СТЕНДА (передача fetchImpl-Ф-Signature: `page(b,h)` получал `(url, opts)`), испраа; код продукта не менялся — это подтверждение, что гейт-утиль детектирует собственные сбои, а не маскирует их.

## 8. VERDICT

**READY FOR RELEASE.**

Обоснование: все 6 пунктов гейта закрыты — (1) pinned-host fallback доказан контроллируемо с фактическими последовательностями нод для 200-empty/timeout/500; (2) all-node failure НЕ превращается в авторитетное EMPTY ни на клиенте (UNABLE), ни на карте abstain-балансеров (INCONCLUSIVE); kinopub-legacy карта при 503 гасит — намеренно (BALANCER-ONLINE8-002), вне W1, обе версии согласованы; (3) повтор 8 тайтлов live: CONTENT/EMPTY согласованы с обеими версиями, Паразиты/kinopub остаётся честным live-EMPTY (503×6 кластерных; алгоритм B→A доказан только controlled, LIVE/CONTROLLED разделение соблюдено); (4) все 5 состояний таблицы верны; (5) все 6 проверок пина верны; (6) все 4 регрессии ok + suite 611/605/0 + drift пустой.

Не-блокирующие примечания (документированы ранее, не новые): live B-CASES по-прежнему 0 в окне; kinopub-legacy 503→карта-hide; burst-артефакт nopin=0/pin>0 при стендовом параллелизме — насыщение, не дефект.

**Релиз = коммит/push(только `backup`)/deploy — НЕ выполнен и НЕ будет выполнен без отдельного разрешения владельца.** Это STOОP-состояние по умолчанию.

## 9. STOP

Гейт завершён. Код, тесты, деплой не тронуты. VPS-стенды удалены (включая копии .env). Локальные логи шэдоу и контроллируемого гейта — без секретов.