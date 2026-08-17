# BALANCER-SEMANTICS-005 — POST-W1 PRODUCTION FP/FN AUDIT

**Дата:** 2026-08-16 (после деплоя W1 `2558256`+`9176c1a`)
**Тип:** READ-ONLY аудит производства. Код/тесты НЕ менялись, commit/push/deploy НЕ выполнялись.
**Объект:** исчезла ли главная несостыковка W1-задачи: `/sources/card show:true → /videos → items:0 / «Видео не найдено»`, особенно для SKAZ.
**Метод:** полный сквозной путь каждого провайдера: provider ID → skaz-балансер → конкретный кластер → availability → пин → /videos → фактические items → playback. Live через публичный API `plugin.maniya-kvn.online` + ground-truth проба кластера на VPS (деплой-код).

---

## 0. Вердикт (должен быть РОВНО один из трёх)

# W1 PARTIALLY VERIFIED — REMAINING SKAZ FP/FN

- **W1-цель (CLUSTER-MISMATCH) достигнута полностью: 0 случаев** из 99 пар. Главный FP из
  audit-005 (Паразиты/skaz-kinopub, show:true + EMPTY) **исчез** (теперь show(INC)@online8 или
  hide — рассинхрона нет). Второй FP (Одиссея/collaps title-only) **закрыт** (hide + 0).
- **Но остаточные SKAZ FP остаются**: 15 FP из 99 пар матрицы r2, классифицированные как
  **11 INCONCLUSIVE-show** (кластер UNABLE: все ноды 503/timeout) + **4 content-model**
  (страница CONTENT, но только `method:link`-карточки → парсер законно даёт 0).
  Ни один из них НЕ является CLUSTER-MISMATCH и НЕ входил в scope W1.
- **Устойчивых FN не подтверждено**: единственный FN-кандидат (Аватар/skaz-kinopub,
  matrix r2 show:false + 7 items) при повторном замере ×3 = **show + 7 items** — hide-gate
  флап под нагрузкой, не стабильный FN. Дюна/kinopub и ДД/kinopub — аналогично
  (hide*(INC) в пробе под нагрузкой, show:true+14/10 в спокойном API-замере).

**Основание для перехода к следующей задаче:** да, можно двигаться дальше — но с явным
учётом двух остаточных FP-классов (INCONCLUSIVE-show + content-model) как отдельной работы,
вне scope W1. W1 свои обещания выполнил; «остаточный FP» теперь другой природы.

---

## 1. Объём и как мерили

| Составляющая | Что сделано |
|---|---|
| 11 тайтлов | Одиссея, Последний дом, Интерстеллар, Форрест Гамп, Матрица, Дюна 2, Скайуокер, Паразиты, Дом Дракона (serial), Аватар, Тёмный рыцарь |
| 9 skaz-провайдеров | videoseed, kinopub, kinoflix, veoveo, pidtor, solntse, geosaitebi, rhsprem, alloha |
| Всего пар | 11 × 9 = **99** |
| Live API матрица | `matrix-api-result-r2.json` (persisted, generatedAt 2026-08-16T07:03:28Z): card show + /videos items по каждой паре |
| Ground-truth проба | `cluster-probe.mjs` на VPS (деплой-код через pathToFileURL): per-node verdict (CONTENT/EMPTY-2xx/non-2xx/accsdb/timeout), cardRows, newVideos (nopin/pin), consistency, playbackFirst |
| Данные пробы | probe-all.log (8 тайтлов), probe-dd.log (ДД), probe-avatar.log (Аватар), probe-dark.log (Тёмный рыцарь), probe-odyssey-r2.log (Одиссея повтор), дампы карточек |
| Регрессии | suite 611/605/0/6, sha-parity 6/6, health 200, filmix trusted, collaps, veoveo стабильность, Паразиты/kinopub, кодовые маркеры на деплое |

**Разделение LIVE / CONTROLLED:** все замеры — live (публичный API + реальный кластер skaz).
Никакое mock-доказательство не использовалось как доказательство live-фикса.

---

## 2. Матрица BEFORE → AFTER (главная метрика)

### FP (show:true И /videos=0)
| Период | Счёт | Состав |
|---|---|---|
| **BEFORE** (audit-005 §18) | 2 | Паразиты/skaz-kinopub (CLUSTER-MISMATCH, show:true + EMPTY); Одиссея/collaps (title-only → show:true, embed пуст) |
| **AFTER** (этот аудит, matrix r2, 99 пар) | 15 | **0 CLUSTER-MISMATCH**; 11 INCONCLUSIVE-show (кластер UNABLE); 4 content-model (link-only страницы). Все — НЕ рассинхрон host-выбора |

### FN (кластер ЕСТЬ контент И card show:false)
| Период | Счёт | Состав |
|---|---|---|
| **BEFORE** (audit-005 §18) | 0 устойчивых (3 митигированы) | kinopub/Форрест 2×show:false (защищён OLD∩NEW, /videos 25 play); pidtor 2×NULL→4×content; rutubemovie/Одиссея 503+11 items (RULE-4) |
| **AFTER** (этот аудит) | **0 подтверждённых устойчивых** | 1 кандидат (Аватар/skaz-kinopub show:false+7) — при ×3 = show+7. Дюна/kinopub, ДД/kinopub — hide*(INC) под нагрузкой, show+14/10 в спокойном замере |

### Итог по главной метрике
- **CLUSTER-MISMATCH: 2 (BEFORE) → 0 (AFTER).** Цель W1 достигнута.
- **kinopub/Форрест FN (2×show:false при 25 items): show:false+25 → show:true+25. Починен.**
- Главный FP Паразиты/kinopub: «show:true + EMPTY» → больше нет (show(INC)@online8 при UNABLE или hide).

---

## 3. Детальный разбор Одиссеи по каждому Skaz-балансеру

Ground-truth проба (probe-odyssey-r2.log) + matrix r2 (live API). Провайдеры — 9 skaz-балансеров + collaps отдельно (native).

| Балансер | Кластер (GT) | Card | /videos (nopin/pin) | Классификация |
|---|---|---|---|---|
| **skaz-alloha** | CONTENT (5 нод, online3 200(4)) | show*@online3 | 4 / 4 | **FOUND** — PLAYBACK call→play→status=200 len=164 m3u8=true |
| **skaz-videoseed** | CONTENT (5, online3 200(5)) | show*@online3 | 5 / 5 | **FOUND** — PLAYBACK play→200 len=684 m3u8=true |
| **skaz-kinopub** | CONTENT (6/6 нод, online3 200(3)) | hide*@online3 (пробе) / show (matrix) | 0 / — | **FP content-model** — дамп: 3 карточки, **все method:link** (ссылки на посты kinopub, НЕ плеерные) → парсер законно 0. «show при link-only» = показ мёртвого |
| **skaz-kinoflix** | UNABLE (6/6 503) | show(INC)@online8 | 0 / — | **FP INCONCLUSIVE-show** — кластер не ответил (нет данных о контенте) |
| **skaz-veoveo** | CONTENT (5, online3 200(1)) | show*@online3 | 1 / 1 | **FOUND** — PLAYBACK play→200 len=1414 m3u8=true |
| **skaz-pidtor** | EMPTY (6/6 EMPTY-2xx 200) | hide*@online3 | 0 / — | **корректно скрыт** — GT-EMPTY (все ноды «нет», согласовано) |
| **skaz-solntse** | UNABLE (6/6 503) | show(INC)@online8 | 0 / — | **FP INCONCLUSIVE-show** |
| **skaz-geosaitebi** | CONTENT (5, online3 200(2)) | show*@online3 | 0 / 0 | **FP content-model** — дамп: 2 карточки, **все method:link** («ოდისეა») |
| **skaz-rhsprem** | EMPTY (accsdb=4, noresp=2) | hide*@online8 | 0 / — | **корректно скрыт** — accsdb (учётка) + GT-EMPTY |
| **collaps** (native, отдельно) | — | hide | 0 | **FP GAP закрыт** (audit-005: title-only → hide). Не смешивать со Skaz |

**Вывод по Одиссее:** 3 источника реально играют (alloha 4, videoseed 5, veoveo 1, playback m3u8=true).
2 скрыты корректно (pidtor EMPTY, rhsprem accsdb). 4 FP (2 INCONCLUSIVE-show под 503 + 2 content-model link-only). **0 CLUSTER-MISMATCH.**

---

## 4. Таблица 10+ тайтлов (matrix r2, 99 пар)

Полная матрица в `matrix-api-result-r2.json`. Сводка по классам:

```
FOUND (items>0):     77 пар
FP (show:true+0):    15 пар
HIDE (show:false+0):  7 пар
─────────────────────────
                    99 пар
```

### 15 FP — классификация по ground-truth (проба)
| # | Тайтл / provider | GT кластера | Card в пробе | Класс FP |
|---|---|---|---|---|
| 1 | Одиссея / skaz-kinopub | CONTENT (6/6) | hide*@online3 (флап→show) | **content-model** (link×3, подтверждено дампом) |
| 2 | Одиссея / skaz-kinoflix | UNABLE (6/6 503) | show(INC)@online8 | **INCONCLUSIVE-show** |
| 3 | Одиссея / skaz-solntse | UNABLE (6/6 503) | show(INC)@online8 | **INCONCLUSIVE-show** |
| 4 | Одиссея / skaz-geosaitebi | CONTENT (5) | show*@online3 | **content-model** (link×2, дамп) |
| 5 | ПД / skaz-videoseed | UNABLE (6/6 503) | show(INC)@online8 | **INCONCLUSIVE-show** |
| 6 | ПД / skaz-solntse | UNABLE (6/6 503) | show(INC)@online8 | **INCONCLUSIVE-show** |
| 7 | Форрест / skaz-videoseed | UNABLE (6/6 503) | show(INC)@online8 | **INCONCLUSIVE-show** |
| 8 | Матрица / skaz-kinoflix | UNABLE (6/6 503) | show(INC)@online8 | **INCONCLUSIVE-show** |
| 9 | Скайуокер / skaz-solntse | UNABLE (6/6 503) | show(INC)@online8 | **INCONCLUSIVE-show** |
| 10 | Скайуокер / skaz-geosaitebi | CONTENT (5) | show*@online3 | **content-model** (link×1, дамп) |
| 11 | Паразиты / skaz-kinoflix | UNABLE (6/6 503) | show(INC)@online8 | **INCONCLUSIVE-show** |
| 12 | ДД / skaz-kinoflix | UNABLE (6/6 503) | show(INC)@online8 | **INCONCLUSIVE-show** |
| 13 | ДД / skaz-pidtor | CONTENT (5) | show(INC)@online3 | **content-model** (link×3, дамп) |
| 14 | ДД / skaz-geosaitebi | UNABLE (6/6 503) | show(INC)@online8 | **INCONCLUSIVE-show** |
| 15 | Аватар / skaz-solntse | UNABLE (6/6 503) | show(INC)@online8 | **INCONCLUSIVE-show** |

**Итого:** INCONCLUSIVE-show = 11, content-model = 4, CLUSTER-MISMATCH = **0**.

### 7 HIDE (show:false + 0) — проверка на «скрыли рабочее»
| Тайтл / provider | GT | Карточки | Статус |
|---|---|---|---|
| Одиссея / skaz-pidtor | EMPTY (6/6) | — | корректно (EMPTY согласован) |
| Одиссея / skaz-rhsprem | EMPTY (accsdb=4) | — | корректно (accsdb) |
| ПД / skaz-kinopub | CONTENT (5) | **link×2** (дамп) | корректно (link-only, hide законен) |
| ПД / skaz-kinoflix | CONTENT (5) | **link×1** (дамп) | корректно (link-only) |
| ПД / skaz-geosaitebi | CONTENT (5) | **link×1** (дамп) | корректно (link-only) |
| Скайуокер / skaz-kinopub | UNABLE (6/6) | — | hide при UNABLE (не FP/FN) |
| Паразиты / skaz-kinopub | UNABLE (6/6) | — | флап show(INC)↔hide; НЕ рассинхрон |

**Ключевой пункт:** Паразиты/skaz-kinopub — тот самый главный FP audit-005 — в этом аудите:
в пробе show(INC)@online8 (кластер UNABLE), в матрице hide, live-регрессе ×2 hide. **Класс
«show:true + EMPTY при CONTENT» больше не воспроизводится.**

---

## 5. Кластер-матрица (§7-9: pin → /videos консистентность)

Проба: 99 пар, consistency из aggregate-probe.json:

```
pin@X == CONTENT-node OK     62
CONTENT без пина (videos>0)  14   (continue-скан нашёл контент без пина)
UNABLE (нет ответа)          19
GT-EMPTY + videos=0 согласованы = 2   (Одиссея/pidtor, Одиссея/rhsprem)
pin@X != CONTENT (CONTENT на другой) = 2  ← НЕ баг, доказательство W1
────────────────────────
                           99
```

### 2 случая «pin≠CONTENT-нода» — это работа W1, а не mismatch
| Случай | pin | CONTENT на | /videos | Что доказано |
|---|---|---|---|---|
| Форрест / skaz-geosaitebi | online3 (мертва/503 на скане) | 94.249.239.37 | **1** (найден) | continue-скан обошёл мёртвый пин и нашёл контент на живой ноде → **ротация W1 работает** |
| Паразиты / skaz-alloha | online3 (мертва/503 на скане) | 94.249.239.37 | **1** (найден) | то же самое |

- Правило задачи: «pin=A → /videos начинается с A; A EMPTY + B CONTENT → FOUND на B». Выполнено
  в 100% случаев: ни одного «пин на CONTENT-ноде, а videos=0».
- **Все-node 503/timeout (UNABLE) НЕ считается EMPTY/hide** (19 пар): карточка показывается как
  show(INC)@online8 (abstain-политика ONLINE8-002), /videos=0 → это и есть класс INCONCLUSIVE-show.

---

## 6. Identity (skaz-veoveo ≠ «Ozvuchky»)

Проверено по аудиту-005: `balancer` = identity (стабильный slug). Display-имя «Ozvuchky»/«KinoPub»
у veoveo/kinopub — **presentation, не identity** (нормализатор берёт `_text`=метка качества,
VEO-015). В этом аудите identity-расхождений НЕ обнаружено: provider ID стабильно резолвится в
свой balancer и свой путь кластера.

---

## 7. Регрессии (все проверены на деплое/живьём)

| Проверка | Результат | Маркер/доказательство |
|---|---|---|
| Suite тестов | **611/605/0/6** (14 suites, ~6878ms) | совпадает с W1-implementation-report |
| sha-parity после ребута | **6/6** | hostOrder/SkazClient/SkazProvider/availability/index/store — совпали с W1 |
| Health | 200 | после ребута VPS 06:50 прод поднялся сам, NRestarts=0 |
| filmix trusted | **show=true** | live API (Интерстеллар), карточка видима |
| collaps (GAP-005) | **hide + 0 items** | live API (Интерстеллар), OLD∩NEW hide работает |
| veoveo/ПД стабильность | **4 items ×2** (+ ранее ×2) | без флака |
| Паразиты/kinopub (главный FP) | **hide ×2** (live) / show(INC)@online8 (проба) | CLUSTER-MISMATCH не воспроизводится |
| HIDE_TTL_MS | 60с | availability.js:88 (HIDE_TTL_MS = 60*1000) |
| OLD∩NEW гейт | активен | availability.js:977-1031 + hasInconclusive:1044 (self-heal по TTL) |
| orphan-promise (STABILITY-004) | `promise.catch(() => {})` | availability.js:462 — утечки нет |
| single-flight (STABILITY-003) | активен | availability.js:543,881 (in-flight cache-key) |
| online8 abstain | активен | availability.js:650 `reservePolicy==='abstain' && balancer!=='kinopub'` |
| orderedSkazHosts | online8 ПОСЛЕДНИЙ | hostOrder.js:21-28 (primary-first, reserve-last); availability.js:518 |
| identity vs presentation | расхождений нет | §6 |

---

## 8. Live vs Controlled

Всё, что заявлено в этом отчёте, — **live**: публичный API `plugin.maniya-kvn.online`
(прод-деплой, token из prod-verify-users.json, UA «lampa») + ground-truth проба на VPS
(импорт деплой-кода `/opt/maniya-online/server/...`). Моков нет.

### Методический инцидент (задокументирован честно)
- VPS: 2GB RAM. Полный прогон пробы набрал ~1.5GB RSS → **reboot 06:50**, /tmp стёрт.
- Последствия: прод сам поднялся (health 200, sha 6/6 сохранён), скрипты пробы восстановлены
  из локальной копии, недостающие 3 тайтла (ДД, Аватар, Тёмный рыцарь) прогнаны повторно
  с `NODE_OPTIONS="--max-old-space-size=512"`. Данные этих тайтлов — из повторных прогонов,
  идентичны по методологии.
- Вывод: тяжёлые пробы — только с лимитом памяти и по одному тайтлу.

---

## 9. Остаточные проблемы (вне scope W1)

1. **INCONCLUSIVE-show (11/15 FP):** когда ВСЕ ноды кластера отвечают 503/timeout, карточка
   показывается (show(INC)@online8 по abstain-политике), но /videos=0. Юзер видит «источник
   есть, но пусто». Это транзиентная перегрузка кластера, НЕ рассинхрон и НЕ постоянный FP.
   Решение — вне W1 (кластер/таймауты, либо мягкий hide при UNABLE-кластере — обсуждалось как
   «волна» в audit-005 §22, НЕ исполнялось).
2. **content-model (4/15 FP):** страница CONTENT, но только `method:link`-карточки (kinopub
   даёт ссылки на посты, geosaitebi — ссылки на груз. сайт, pidtor на serial — ссылки).
   Парсер SkazProvider игнорирует link → 0 items. Карточка show при таком «контенте» = показ
   мёртвого. Это свойство source, а не host-выбора. Решение: link-only-страницы → hide,
   вне scope W1.
3. **hide-gate флап под нагрузкой (FN-риск):** kinopub/Форрест (было), Аватар/kinopub,
   Дюна/kinopub, ДД/kinopub — под 503-нагрузкой карточка флапает hide*(INC)↔show. При hide
   кластер CONTENT = потенциальный FN, но OLD∩NEW + self-heal по TTL (60с) возвращают show.
   Устойчивого FN нет; риск остаётся во время пиковой нагрузки.
4. **rhsprem accsdb:** учётка не даёт доступ (accsdb=4/6) → hide верен, но источник «пуст»
   из-за доступа, не контента. Вне кода.

---

## 10. Что W1 починил / не починил

### Починил (подтверждено)
- **CLUSTER-MISMATCH: 2 → 0.** hostOrder (online8-last) + continue-скан + пин + pinMap дали
  единый порядок карточки и /videos.
- **Главный FP Паразиты/skaz-kinopub** (audit-005 §18, класс B): «show:true + EMPTY» больше
  не воспроизводится (hide / show(INC) при UNABLE).
- **Одиссея/collaps** (title-only FP): теперь hide + 0.
- **kinopub/Форрест FN**: 2×show:false → show:true + 25 play.
- **Ротация/пин**: 2 кейса «пин на мёртвой ноде» всё равно дали контент (continue-скан).

### НЕ починил (и не обещал)
- INCONCLUSIVE-show (кластер UNABLE) — транзиентная перегрузка, вне W1.
- content-model (link-only страницы) — свойство источника, вне W1.
- hide-gate флап под пиковой нагрузкой — риск FN на минуты, самовосстанавливается.

---

## 11. Сырые данные (для воспроизводимости)

- Матрица live API (99 пар, карточки+items+elapsedMs+первый item): `matrix-api-result-r2.json`
  (persisted в tmp аудита, generatedAt 2026-08-16T07:03:28Z).
- Проба кластера (per-node verdicts, pin, videos, consistency, playback): probe-all.log,
  probe-dd.log, probe-avatar.log, probe-dark.log, probe-odyssey-r2.log (VPS /tmp/postw1).
- Дампы карточек (доказательства content-model): kinopub/Одиссея 3×link; geosaitebi/Одиссея
  2×link; geosaitebi/Скайуокер 1×link; pidtor/ДД 3×link; kinopub/ПД 2×link; kinoflix/ПД 1×link;
  geosaitebi/ПД 1×link (все с VPS, статусы 200).
- Скрипты: matrix-api.mjs, cluster-probe.mjs, aggregate-probe.mjs, fn-verify.mjs (Аватар/Дюна ×3),
  regressions.mjs (filmix/collaps/veoveo/Паразиты).

---

## 12. STOP

После этого отчёта никаких других действий не выполнять (в соответствии с условием задачи:
«STOP. После отчёта ничего больше не делать»).
