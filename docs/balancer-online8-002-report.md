# BALANCER-ONLINE8-002 — SHADOW FIX: online8 воздерживается для не-kinopub

**Дата:** 2026-08-14, прогоны ~12:04 UTC и ~12:13 UTC (VPS).
**Статус:** SHADOW-ФИКС. Код изменён, но НЕ закоммичен, НЕ задеплоен (по ТЗ «НЕ коммитить. НЕ деплоить.»).
**Скрипт:** `scripts/online8-002-shadow.mjs`, staged на VPS в `/tmp/shadow-online8` (НЕ деплой в `/opt/maniya-online`).

---

## 1. Резюме

Реализована опция `reservePolicy: 'abstain'` в `createAvailabilityChecker()`
(`server/src/availability.js`), по умолчанию **`'legacy'`** — продакшн byte-identical.
При `'abstain'` резервная легаси-нода **online8** для НЕ-kinopub балансеров
**ВОЗДЕРЖИВАЕТСЯ**: её быстрый 403 `disable` (7 байт, query-independent — «модуль
выключен», док. BALANCER-ONLINE8-001 §9), 503 и 2xx-non-content **не дают «нет»-голос**.
hide возможен **только** от content-«нет» primary (2xx-non-content / accsdb-«Ожидаем
фильм»). Kinopub **не затрагивается** (rule 8 — реально живёт на online8).

**Вердикт shadow (2 прогона, 7 карточек × 9 балансеров):**
- **ГЕЙТ OLD∩OLDv→NEW: PASS** (run2 — 29/29; run1 — 30 проверок, 1 флап — kinopub/The OA, см. §6).
- **REGRESSED=0** по построению (abstain-вердикт ⊂ legacy-вердикт на «нет»).
- **FIXED=0** — в окне прогонов НЕ воспроизвёлся целевой сценарий «primary 503 →
  online8 403 закрывает unanimous-«нет» у рабочего не-kinopub источника»: все
  не-kinopub hide в сэмпле были OLDv=0 (контента нет).
- **REVEAL=14** (OLD=hide, OLDv=0, NEW=show) — оптимистичный inconclusive-показ под
  статусный шум primary/воздержание online8. Все — OLDv=0 (потерянного контента нет);
  три-стейт сохранён (authoritative:false, self-heal по TTL).

**Ключевое наблюдение (вне scope данного фикса):** единственный устойчивый кейс
«источник скрыт, но контент есть» в данных — **kinopub** (hide + OLDv=4/3 на
«Одиссее»/«Последнем доме» 2026 при EO=show). Он НЕ лечится этим фиксом намеренно
(rule 8). Это pre-existing gap online8-туннеля (см. §7).

---

## 2. Что изменено (код)

`server/src/availability.js` — только additive, за опцией `reservePolicy`:

1. `const reservePolicy = options.reservePolicy || 'legacy';` (после `backoffMs`).
2. В `probe()`: `const newMode = reservePolicy === 'abstain' && balancer !== 'kinopub';`
   и сигналы `sawStatusNo` (primary не-2xx — статусный шум), `sawReserveAbstain`
   (online8 ответил — воздержался).
3. Не-2xx: при `newMode` primary → `sawStatusNo`, online8 → `sawReserveAbstain`
   (НЕ «нет»); legacy-ветка неизменна.
4. accsdb-«Ожидаем фильм» и 2xx-non-content: при `newMode` online8 → `sawReserveAbstain`; primary → `sawDefinitiveNo` (как раньше).
5. Финальный вердикт при `newMode`: `sawDefinitiveNo && !sawNoResponse` →
   authoritative absent; иначе → show/inconclusive (+`mixed` при любом из трёх сигналов).
6. `confirmWithBackoff`/`confirmAbsence`/`card()`/гейт подтверждения — **без изменений**
   (все идут через `probe()` с теми же `newMode`-гейтами).

**Три-стейт (rule 4):** abstain-show = `authoritative:false, inconclusive:true`. По
BALANCER-STABILITY-002 карточка с любой hide кэшируется на HIDE_TTL_MS=60с (self-heal);
даже all-show запись — на TTL 5 мин с `hasInconclusive`, вердикт НЕ сворачивается в
permanent show:true (перепроверка по TTL/force).

---

## 3. Юнит-тесты (локально, `NODE_ENV=test node --test test/availability-online8.test.js`)

**10/10 PASS.** Кейсы (хост-пул `[online3, online8]` как в проде):

| # | Кейс | reservePolicy | Ожидание | Факт |
|---|---|---|---|---|
| 1 | online3=503 + online8=403 `disable` | abstain | show/inconclusive/mixed | ✅ |
| 2 | online3=200 `null` + online8=403 | abstain | hide/absent (primary content-«нет») | ✅ |
| 3 | online3=200 контент + online8=403 | abstain | show authoritative (online8 не тронут) | ✅ |
| 4 | online3=таймаут + online8=200 `null` | abstain | show (нет content-«нет») | ✅ |
| 5 | online3=accsdb-«Ожидаем фильм» + online8=403 | abstain | hide (RULE-2) | ✅ |
| 6 | online3=503 + online8=403 | legacy (дефолт) | hide/absent (прежнее) | ✅ |
| 7 | online3=200 контент + online8=403 | legacy | show authoritative | ✅ |
| 8 | online3=503 + online8=403, **kinopub** | abstain | hide (kinopub вне абстаина) | ✅ |
| 9 | online3=503 + online8=200 `null`, **kinopub** | abstain | hide | ✅ |
| 10 | card(): оба сигнала = шум, **skaz-alloha** | abstain | show/inconclusive | ✅ |

Полный сьют: **501 тестов, 493 pass, 2 fail** — оба fail pre-existing
(`api.test.js` «Осталось 26803 дня» vs regex `дней`; подтверждено `git stash`-проверкой,
не связаны с фиксом).

---

## 4. Методика shadow

- **OLD** = `createAvailabilityChecker({})` (legacy, прод).
- **NEW** = `createAvailabilityChecker({ reservePolicy: 'abstain' })`.
- **OLDv** = `provider.videos()` на каждый видимый источник (что юзер реально получает).
- **EO** = reference `lite/events?life=false` (show:true per балансер) — контекст.
- 7 карточек ТЗ × 9 балансеров (filmix, rezka, rhsprem, videoseed, kinopub, kodik,
  kinoflix, rutubemovie, geosaitebi). OLD и NEW — последовательно (не грузим кластер
  двумя карточками разом).
- **ГЕЙТ:** OLD=show && OLDv>0 → NEW обязан быть show:true.
- **FIXED:** OLD=hide && OLDv>0 && NEW=show. **REGR:** OLD=show → NEW=hide (не должен
  существовать по построению). **reveal:** OLD=hide && OLDv=0 && NEW=show.

---

## 5. OLD vs NEW — полный дифф (прогон 2, GATE PASS)

Легенда: `OLDv` — items от videos(); `!` после числа = items=0; `flag`: `=` без изменений,
`reveal` = OLD=hide→NEW=show при OLDv=0, `FIXED` = при OLDv>0 (не встретился),
`REGR` = OLD=show→NEW=hide (не встретился).

### 5.1 «Одиссея» 2026 (id 1368337, tt33764258)

| balancer | OLD | NEW | OLDv | EO | flag |
|---|---|---|---|---|---|
| filmix | show | show | 13 | show | = |
| rezka | hide | hide | 0! | hide | = |
| rhsprem | hide | hide | 0! | show | = |
| videoseed | show | show | 5 | show | = |
| kinopub | hide | hide | **4** | show | = (вне абстаина) |
| kodik | hide | hide | 0! | hide | = |
| kinoflix | hide | **show** | 0! | hide | **reveal** |
| rutubemovie | show | show | 2 | show | = |
| geosaitebi | show | show | 0! | show | = |

### 5.2 «Последний дом» 2026 (id 1284041, tt32268156)

| balancer | OLD | NEW | OLDv | EO | flag |
|---|---|---|---|---|---|
| filmix | show | show | 4 | show | = |
| rezka | show | show | 3 | show | = |
| rhsprem | show | show | 2 | show | = |
| videoseed | hide | **show** | 0! | hide | **reveal** |
| kinopub | hide | hide | **3** | show | = (вне абстаина) |
| kodik | hide | hide | 0! | hide | = |
| kinoflix | hide | hide | **2** | show | = |
| rutubemovie | show | show | 0! | show | = |
| geosaitebi | hide | hide | **1** | show | = |

### 5.3 «Дом Дракона» serial (id 94997, tt11198330)

| balancer | OLD | NEW | OLDv | EO | flag |
|---|---|---|---|---|---|
| filmix | show | show | 10 | show | = |
| rezka | show | show | 10 | show | = |
| rhsprem | show | show | 10 | show | = |
| videoseed | show | show | 10 | show | = |
| kinopub | show | show | 0!* | show | = |
| kodik | hide | hide | 0! | hide | = |
| kinoflix | hide | **show** | 0! | hide | **reveal** |
| rutubemovie | hide | **show** | 0! | hide | **reveal** |
| geosaitebi | hide | **show** | 0! | hide | **reveal** |

\* kinopub OLDv флакал между прогонами: run1=10, run2=0 (videos()-флак, см. §6.2).

### 5.4 Forrest Gump (id 13, tt0109830)

| balancer | OLD | NEW | OLDv | EO | flag |
|---|---|---|---|---|---|
| filmix | show | show | 5 | show | = |
| rezka | show | show | 22 | show | = |
| rhsprem | show | show | 22 | show | = |
| videoseed | hide | **show** | 0! | hide | **reveal** |
| kinopub | show | show | 25 | show | = |
| kodik | hide | **show** | 0! | hide | **reveal** |
| kinoflix | show | show | 3 | show | = |
| rutubemovie | show | show | 0! | show | = |
| geosaitebi | show | show | 1 | show | = |

### 5.5 The OA serial (id 71712, tt4491250)

| balancer | OLD | NEW | OLDv | EO | flag |
|---|---|---|---|---|---|
| filmix | show | show | 8 | show | = |
| rezka | show | show | 8 | show | = |
| rhsprem | show | show | 8 | show | = |
| videoseed | hide | **show** | 0! | hide | **reveal** |
| kinopub | show | show | 8 | show | = |
| kodik | hide | hide | 0! | hide | = |
| kinoflix | hide | hide | 0! | show | = |
| rutubemovie | hide | **show** | 0! | hide | **reveal** |
| geosaitebi | hide | **show** | 0! | hide | **reveal** |

### 5.6 The Seven-Per-Cent Solution (id 27190, tt0076851)

| balancer | OLD | NEW | OLDv | EO | flag |
|---|---|---|---|---|---|
| filmix | show | show | 0! | show | = |
| rezka | show | show | 2 | show | = |
| rhsprem | show | show | 2 | show | = |
| videoseed | hide | **show** | 0! | hide | **reveal** |
| kinopub | show | show | 3 | show | = |
| kodik | hide | hide | 0! | hide | = |
| kinoflix | hide | **show** | 0! | hide | **reveal** |
| rutubemovie | show | show | 0! | hide | = |
| geosaitebi | hide | **show** | 0! | hide | **reveal** |

### 5.7 «Матрица» (id 603, tt0133093, kp 301)

| balancer | OLD | NEW | OLDv | EO | flag |
|---|---|---|---|---|---|
| filmix | show | show | 0! | show | = |
| rezka | show | show | 22 | show | = |
| rhsprem | show | show | 18 | show | = |
| videoseed | show | show | 16 | show | = |
| kinopub | show | show | 22 | hide | = |
| kodik | hide | hide | 0! | hide | = |
| kinoflix | hide | **show** | 0! | hide | **reveal** |
| rutubemovie | show | show | 1 | hide | = |
| geosaitebi | show | show | 1 | show | = |

### 5.8 Сводка

| Показатель | Значение |
|---|---|
| Ячеек сравнено | 7×9 = 63 |
| Без изменений (`=`) | 49 |
| **reveal** (OLD=hide→NEW=show, OLDv=0) | **14** |
| **FIXED** (OLD=hide→NEW=show, OLDv>0) | **0** |
| **REGR** (OLD=show→NEW=hide) | **0** |
| ГЕЙТ OLD∩OLDv→NEW | **PASS** (run2 29/29; run1 30 проверок, 1 флап kinopub/OA → §6) |

**reveal по балансерам:** kinoflix 4 (Одиссея/Дом Дракона/Seven/Матрица),
videoseed 4 (Последний дом/FG/OA/Seven), geosaitebi 3 (Дом Дракона/OA/Seven),
rutubemovie 2 (Дом Дракона/OA), kodik 1 (FG). Все стабильны между прогонами.

---

## 6. Флап kinopub/The OA в прогоне 1 (НЕ дефект фикса)

- **Прогон 1:** kinopub/The OA OLD=show → NEW=hide (OLDv=8). ГЕЙТ FAIL. NEW-карточка
  именно на этой карточке упёрлась в дедлайн (first=12005ms, timedOut) — кластер
  тормозил под нагрузкой.
- **Код:** kinopub исключён из abstain (`newMode` требует `balancer !== 'kinopub'`),
  probe() для kinopub в OLD и NEW **побайтово одинаков** (доказано юнит-тестом №8/№9).
  Поголовный «net»-вердикт у kinopub возможен и в OLD, и в NEW — это известный флак
  online8-302-туннеля под параллельной нагрузкой (док. native-availability-001 §2.4,
  stability-002: «kinopub: online8 на миг отвечал 503/null, хотя OLD videos() находил
  items»).
- **Доказательство живости (5 раундов × 3 хоста × 2 сигнала = 30/30):** все ответы
  kinopub/The OA = **200 с content-bearing телом** (`<div class="videos__line"><!--q:2160p-->...`),
  158–304 мс, без 403/503/null. Контент на кластере есть.
- **Прогон 2 (через ~9 мин):** kinopub/The OA OLD=show → NEW=show. ГЕЙТ PASS.

**Вывод:** флап — транзиентная кластерная вариация, НЕ вызвана фиксом. В проде его
смягчают существующие механизмы: гейт подтверждения (двойной сигнал) + retry-with-backoff
+ HIDE_TTL_MS=60с (self-heal скрытого рабочего источника за минуту).

---

## 7. Pre-existing gap: kinopub «скрыт, но контент есть» (ВНЕ scope rule 8)

В данных есть устойчивый кейс «hide при OLDv>0» — и это **kinopub**:

| Карточка | kinopub OLD/NEW | OLDv (items) | EO |
|---|---|---|---|
| Одиссея 2026 | hide/hide | **4** | show |
| Последний дом 2026 | hide/hide | **3** | show |
| Дом Дракона | show/show | 10 (run1) | show |
| Forrest Gump | show/show | 25 | show |
| The OA | show/show | 8 | show |
| Seven-Per-Cent | show/show | 3 | show |
| Матрица | show/show | 22 | show |

Фикс намеренно НЕ трогает kinopub (rule 8: «kinopub: online8 stays full authoritative
fallback — он реально работает через online8»). Кейс «Одиссея»/«Последний дом» (hide +
рабочие items) — отдельная pre-existing тема (вероятно, checksearch-предикат отвергает
карточку как «чужой title» — kinopub может отдавать на эти фильмы другой тайтл, напр.
сериал «Одиссея» 1997; либо туннель флакает) и требует отдельного исследования —
**рекомендуется BALANCER-ONLINE8-003**. Не блокер данного фикса.

---

## 8. Соответствие правилам ТЗ

| Rule | Статус |
|---|---|
| 1. kinopub: online8 = полный авторитетный fallback | ✅ не затронут (`newMode` гейт) |
| 2. Не-kinopub: быстрый 403 online8 = INCONCLUSIVE, не UNAVAILABLE | ✅ abstain |
| 3. 503/таймаут online8 ≠ доказательство отсутствия | ✅ non-2xx online8 → abstain |
| 4. INCONCLUSIVE не permanent show:true | ✅ три-стейт, TTL/self-heal |
| 5. online3 авторитетный результат → использовать | ✅ primary content → стоп/вердикт |
| 6. online3 контент → online8 не переворачивает | ✅ ротация останавливается на content |
| 7. online3 авторитетное «нет» → online8 (unsupported/disable) не меняет | ✅ abstain не «разрешает» hide-only-online8 |
| 8. Kinopub unchanged | ✅ юнит-тесты №8/9, live-проверка |
| 9. НЕ менять filmix trusted / card cache / UI / playback / RCH / videos() / resolveVideo() | ✅ затронут только probe()-гейт под опцией |
| 10. Сначала отдельный shadow/compare режим | ✅ shadow на VPS, staged, не деплой |

---

## 9. Рекомендации

1. **Клиентский абстаин — опция, продакшн не тронут.** Если после ревью решено
   включать: `reservePolicy: 'abstain'` в `createAvailabilityChecker` при создании
   `defaultChecker` (или через env). Ожидаемый эффект: hide-флап не-kinopub от 403
   online8 исчезает; плата — до 14 лишних inconclusive-show на этих карточках (из 63
   ячеек; все OLDv=0), self-heal по TTL.
2. **Оценить «reveal»-цену:** 14/63 ячеек стали show без контента. Не критично (три-стейт),
   но если UX «кликнул → видео не найдено» досаждает — добавить на reveal-ряд short-TTL
   (типа 60с) или второй сигнал до показа. По ТЗ это НЕ требуется (rule 4 допускает).
3. **kinopub hide-при-items (Одиссея/Последний дом)** — отдельный тикет
   BALANCER-ONLINE8-003 (предикат vs туннель; вероятно, надо дать kinopub
   full-authoritative fallback на online8 и в availability, как в SkazClient).
4. Перед включением — прогнать shadow ещё раз на более широком наборе карточек
   (12–16) для статистики reveal/FIXED.

---

## 10. Файлы

- `server/src/availability.js` — опция `reservePolicy` + abstain-гейты в `probe()` (НЕ закоммичено).
- `server/test/availability-online8.test.js` — 10 новых юнит-тестов (НОВЫЙ файл).
- `scripts/online8-002-shadow.mjs` — shadow OLD vs NEW (НОВЫЙ файл).
- `docs/balancer-online8-002-report.md` — этот отчёт.
- Логи прогонов: `/tmp/shadow-online8/run.log` (run1), `run2.log` (run2) на VPS;
  локальные копии в temp.
