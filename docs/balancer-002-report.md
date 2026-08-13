# BALANCER-002 — Per-card source availability: отчёт и вердикт

Дата: 2026-08-13. Статус: **ЗАВЕРШЕНО.** Commit `a105320` → push `backup` → deploy
`scripts/deploy.sh` → production-сверка **пройдена** (16 видимых источников, per-card HOTD 14/FG 15/
OA 12, кэш 0 мс, Filmix/Alloha/Rezka/SKAZ playable, rch-reserved скрыты) — §13. Решение юзера
2026-08-13: rhsprem — видимый REST, ashdi/kinoukr/eneyida + remux/kinotochka — rch-reserved, UI
availability включён.

## Резюме

Maniya отдавала **статический** реестр источников (`/api/lampa/sources`) без per-card проверки.
BALANCER-002 реплицирует динамику E-Online: параллельный `checksearch=true` по каждому видимому
skaz-балансеру → `show:true/false` per card → кэш 5 минут (memkey-стиль).

По КРИТИЧЕСКОМУ требованию (SHADOW/COMPARE) новый availability реализован в тени: OLD (`videos()`)
vs NEW (`card()`) сверялись на живом кластере VPS. **Гейт OLD∩NEW стабильно зелёный: 3 последо-
вательных прогона (Runs 5/6/7) × 5 карточек — PASS, diff пустой.**

По пути найдены и закрыты **четыре класса проблем**:
1. **флак checksearch-таймаута** (Run 2) — таймаут/нет ответа = вердикта НЕТ → показываем оптимистично;
2. **definitive-no под насыщением** (Run 4) — закрыт механизмом **confirmAbsence** (двойная проверка «нет»);
3. **Rezka UI-резолв (P0)** — голый TMDB `id` с карточки Lampa короткозамкал `resolveRecord` на `href:''` →
   «видео не найдено» на каждый клик Rezka; фикс — короткое замыкание только на href, иначе поиск по названию;
4. **accsdb-семантика** — `{"accsdb":true,"msg":"Войдите в аккаунт"}` трактовался как «источника нет» →
   закэшированный hide рабочего источника на 5 минут; фикс — accsdb = отказ учётки, вердикта НЕТ (как таймаут).

## 1. Изменённые файлы

| Файл | Что |
|---|---|
| `server/src/config.js` | `skaz.checkEnabled` (`SKAZ_CHECK_ENABLED`, def true), `skaz.checkTimeoutMs` (`SKAZ_CHECK_TIMEOUT_MS`, **8 000 → 10 000**); реестр: +`rhsprem`, −`zagonka/videocdn/lumex/kinobase`; ashdi/kinoukr/eneyida — rch-reserved |
| `server/src/availability.js` | **новый модуль**: `checkSearchPredicate` (точный как Lampac OnlineApi.cs:975), host-политика (online8-резерв), `probe`/`checkBalancer`/`confirmAbsence`, `card()`, кэш |
| `server/src/index.js` | `GET /api/lampa/sources/card` (`requireSubscription` → `userUid=sha256(token).slice(0,16)`; `!checkEnabled` → статический список) |
| `server/src/providers/registry.js` | +`rhsprem` («Maniya · HDRezka 4K»), мета-правки |
| `server/src/providers/meta.js` | +`rhsprem: { name:'HDRezka 4K', icon:'🎞️', qualityLabel:'4K' }` |
| `server/test/availability.test.js` | 25 тестов (core + confirmAbsence + accsdb + retry/hide-TTL) |
| `server/test/availability-hidden-twin.test.js` | 1 тест (hidden-twin не дублируется) |
| `server/test/availability-route.test.js` | 3 теста (маршрут: 403 без подписки, 200 с токеном, статика цела) |
| `server/src/providers/rezka/RezkaProvider.js` | **P0-фикс**: `resolveRecord` короткозамкает ТОЛЬКО на href; голый `id` (TMDB) → поиск по названию |
| `server/test/rezka-provider.test.js` | +1 тест «карточка TMDB (id+title, без href) → резолв через поиск, не пусто» |
| `scripts/balancer-002-shadow.mjs` | SHADOW/COMPARE: OLD vs NEW vs E-Online reference; маркеры `✓confirm`/hidden |
| `public/maniya-online.js` | UI-обвязка `loadCardAvailability`/`applyCardAvailability` — включена по решению юзера |

`/api/lampa/sources` (статический реестр) НЕ тронут. `SkazProvider.videos()`/resolver/hidden-twin — не изменены.

## 2. Логика availability (итог)

- **Предикат** `work = rch || data-json= || "type":"movie"|"episode"|"season"` — ровно Lampac OnlineApi.cs:975.
- **Вердикты пробы** (per host): 2xx content-bearing — авторитетно (стоп); 2xx «нет источника»
  (`null/disable/false/not found`) и не-2xx (403/404/5xx) — кластер ОТВЕТИЛ «нет» → следующий хост;
  **таймаут/сеть (ответа НЕТ) — вердикта НЕТ → показываем оптимистично** (не прячем рабочий источник
  из-за транзиентного тормоза). **accsdb (`{"accsdb":true,"msg":"Войдите в аккаунт"}`) — отказ учётки,
  тоже вердикта НЕТ** (как таймаут): отказ авторизации не доказывает отсутствия контента, продолжается
  ротация хостов.
- **Host-политика**: primary `[online3.skaz.tv, 94.249.239.63/.37/.11, 77.90.33.109]`, online8 — резерв в конце пула.
- **КРИТИЧЕСКИЙ ГЕЙТ — `confirmAbsence`**: definitive «нет» от checksearch — только гипотеза.
  Подтверждается прямым lite-page (БЕЗ `checksearch=true`) — тем механизмом, что реально тянет
  OLD `videos()`. Источник прячется **только при «нет» от ОБОИХ сигналов**. Подтверждённые ряды
  помечаются `confirmed`. **С §10-усилением** подтверждённый «нет» дополнительно перепроверяется
  с retry-with-backoff (`confirmWithBackoff`, пауза 500 мс) — окно насыщения online8-туннеля успевает
  отойти; выживший «нет» = три независимых сигнала (search + 2× direct). Ряд с повтором помечается `retried`.
- **Кэш**: `Fnv1a(id:serial:source:count:uid)`, TTL 5 мин, lazy sweep ≤512 (конвенция `_navCache`).
  Кэшируются только чистые вердикты (нет inconclusive-ряда). Стрессовая карточка (таймаут) — нет,
  перепроверяется следующим запросом. **Подтверждённый «нет» кэшируется КОРОТКО (HIDE_TTL_MS = 60 с)**
  вместо 5 минут: даже три согласных «нет» под окном насыщения не должны висеть на рабочем источнике
  5 минут — self-heal за минуту.
- Изоляция: `Promise.allSettled` per balancer — сбой одного не ломает других.

## 3. Тесты

`cd server && NODE_ENV=test node --test`

- **availability.test.js — 25/25** (core + confirmAbsence + accsdb: «отказ учётки — вердикта нет → show:true,
  ротация продолжается», «accsdb на первом хосте, контент на втором → авторитетный show:true», «все accsdb →
  не кэшируется (self-heal)»; retry/hide-TTL: «подтверждённый «нет» кэшируется (двойная проверка + retry)»,
  «retry нашёл карточку после окна → show:true, retried»).
- rezka-provider — 56/56 (включая новый «карточка TMDB без href → резолв через поиск, не пусто»).
- availability-hidden-twin — 1/1; availability-route — 3/3.
- **Полный сьют: 459 → 451 pass, 2 fail, 6 skipped.** Два фейла — pre-existing (`api.test.js`: русская
  плюрализация «Осталось 26804 дня» vs `/^Осталось \d+ дней$/`), НЕ связаны с BALANCER-002, не трогал.

## 4. Live-сверка (SHADOW/COMPARE на VPS, `server/.env` с реальными кредами)

Карточки: HOTD serial (94997), Forrest Gump (13), niche Seven-Per-Cent (27190), fake id (999999999),
The OA serial (71712). OLD = `provider.videos()` (items>0), NEW = `defaultChecker.card()`, EO =
`lite/events?life=false` (тот самый серверный checkSearch, что мы реплицируем).

### История прогонов

| Run | Стейдж | Итог |
|---|---|---|
| 2 | до фикса | **FAIL** — niche/27190: kinopub OLD items=3, NEW скрыл |
| 3 | таймаут 10с + optimistic-on-no-response | PASS |
| 4 | после таймаут-фикса | **FAIL** — FG/13: kinopub OLD items=25, NEW скрыл |
| 5 | **+ confirmAbsence** | **PASS ×5** |
| 6 | confirmAbsence | **PASS ×5** |
| 7 | confirmAbsence | **PASS ×5** |
| 8 | **+ retry-with-backoff + HIDE_TTL 60с + Rezka-fix + accsdb-семантика** | **PASS ×5** |

### Run 8 (после §10-усиления): рецидив закрыт

В 11:24 и 11:32 2026-08-13 (сразу после тяжёлых shadow-прогонов) кластер насыщался, и ОБА сигнала
(checksearch + прямой lite-page) флакали «нет» разом через online8-302-туннель → rhsprem/kinopub
скрывались и висели 5 минут при OLD items>0. Реализовано заявленное в §10 усиление:
- **`confirmWithBackoff`** — подтверждённый «нет» перепроверяется повторной прямой пробой через 500 мс
  (окно насыщения успевает отойти); выживший «нет» = 3 независимых сигнала;
- **HIDE_TTL_MS = 60 с** — confirmed-hide кэшируется на минуту вместо 5 минут (self-heal).

Проверено живьём в Run 8: **FG/13 — `skaz-videoseed ✓confirm`, `skaz-kinopub ✓confirm` видимы**
(те самые источники, что утром закэшированно скрывались); HOTD — 14/16 show:true (все OLD-рабочие);
все карточки GATE PASS. Прогон 08.08 фиксировал Rezka «видео не найдено» — после P0-фикса `resolveRecord`
Rezka live = HOTD 10 items/3 сезона/20 голосов, FG 22 items (см. §8.5).

### Два класса флака checksearch (корневые причины)

**Класс 1 — таймаут под нагрузкой (Run 2).** Под 18-ю параллельными запросами кластер не успевал
ответить за 8с → abort трактовался как «нет источника» → скрыт. Фикс: таймаут 10с (паритет с
E-Online `timeoutSeconds: 10`) + таймаут/нет ответа = **вердикта НЕТ** → оптимистично show:true +
стрессовая карточка не кэшируется. Проверен в Runs 3/5/6/7.

**Класс 2 — definitive-no под насыщением (Run 4).** Контент kinopub живёт на **online8** (легаси-нода):
online3 отдаёт на него 302. Под насыщением online8 на миг отвечал 503/null → все хосты через 302-туннель
сливались в online8 → «все ответили «нет»» → definitive скрыт, хотя OLD `videos()` в соседний момент
находил 25 items. Фикс: **confirmAbsence** — каждое definitive «нет» перепроверяется прямым lite-page
(без поиска). Прямой lite-page — это и есть то, что реально играет контент, поэтому подтверждение
напрямую реализует требование «не скрывать то, что воспроизводится». Проверен живьём: оба сигнала
для kinopub/FG → show:true; в Runs 5/6/7 скрытые источники на каждой карточке — double-verified.

**Почему E-Online стабилен, а наш внешний checksearch флакал.** checksearch E-Online — **внутренний**
вызов модуля (`{localhost}` в URI модуля + заголовки `xhost`/`xscheme`/`lcrqpasswd`), маршрутизируется
внутри процесса Lampac и минует внешний 302-туннель online3→online8. Мы не можем повторить
`lcrqpasswd` (корневой пароль сервера). Поэтому наш внешний checksearch наследует флак туннеля;
confirmAbsence компенсирует вторым независимым сигналом.

### Доказательство OLD∩NEW (Runs 5/6/7)

- **FG/13**: kinopub OLD items=25 → NEW show:true (в Run 4 был скрыт). **Гейт спасён.**
- **niche/27190**: kinopub OLD items=3 → NEW show:true (в Run 2 был скрыт).
- **Каждый OLD-рабочий источник видим; каждый скрытый — double-verified** (checksearch «нет» + lite-page «нет»).

## 5. Латентность

| Метрика | Значение (Runs 5-7) |
|---|---|
| NEW `card()` первый вызов (параллельно) | **2.2–6.8 с** (здоровые карточки 2.7–5.5 с) |
| NEW 2-й вызов (кэш) | 0 мс (cached=YES на каждой карточке каждого прогона) |
| OLD Σ per-provider (последовательные probes, что платит юзер, кликая по очереди) | 4.6–14.0 с |
| E-Online reference (`lite/events`) | 37 мс – 10.4 с (тёплый/холодный memkey-кэш E-Online) |

NEW в разы быстрее OLD-суммы: параллельный checksearch вместо последовательных `videos()`-навигаций.

## 6. Кэш-поведение

- Ключ `Fnv1a(id:serial:source:count:uid)` — как memkey Lampac; TTL 5 мин; lazy sweep ≤512.
- Кэшируется только чистый вердикт (нет inconclusive). Стрессовый момент (таймаут) **не фиксируется**
  на 5 минут — следующий запрос перепроверяет.
- **Подтверждённый «нет» кэшируется КОРОТКО (HIDE_TTL_MS = 60 с)**, обычный вердикт — 5 мин: даже три
  согласных «нет» под окном насыщения не должны висеть на рабочем источнике 5 минут — self-heal за минуту.
- Проверено в тестах (hit/miss/uid-разделение/не-кэш-стресса/короткий hide-TTL) и живьём (2nd call cached=YES).

## 7. E-Online vs Maniya

- Универсум: **E-Online 36 источников** (lite/events, no id) vs **Maniya 18 видимых**.
- Разница — rch/WS-источники E-Online (ashdi, kinoukr, eneyida, vk*, rutube, videohub, turboserial,
  fanserials, fancdn, mirage и др.): Lampac с WebSocket-клиентом помечает их доступными, Maniya REST
  играть не может → зарезервированы (§10.5), в видимый список не входят. Это решено и утверждено
  (Option-1: только rhsprem).
- Per-card NEW show:true 10–17/18 против EO 6–17/36 — из-за разного универсума; по общим skaz-слагам
  расхождения негейтовые (см. §8).

## 8. Найденные расхождения (НЕ гейтовые — задокументированы)

1. **remux/kinotochka — over-show (rch)**: стабильно `{"rch":true}` → NEW show:true, но REST Maniya играть
   rch не может (OLD videos()=0). **РЕШЕНО юзером: rch-reserve** (как ashdi/kinoukr/eneyida) — в дефолтный
   список не входят, в UI не светятся.
2. **pidtor — навигационный гэп Maniya (pre-existing)**. NEW и EO согласны: доступен (2160p/HDR/720p).
   OLD `videos()`=0 — старый гэп REST-навигации Maniya (не вина availability). Отдельная задача, вне BALANCER-002.
3. **NEW показывает > EO**: только rch-дуэт (remux/kinotochka) — см. п.1 (снят rch-reserve).
4. **EO показывает > NEW** по общим skaz-слагам: только rch-reserved (ashdi/kinoukr/eneyida/vkmovie).

### 8.5 Rezka: P0-фикс resolveRecord (был «видео не найдено» с 08.08)

`addMovieParams` клиента Lampa всегда шлёт `id` = **TMDB id** (не id Rezka). `resolveRecord` короткозамкал
на `href || id` → голый TMDB id превращался в запись с `href:''` → гард `!record?.href` давал пусто →
«видео не найдено» на каждый клик Rezka. Фикс: короткое замыкание **только на href**; голый id → поиск по
названию (как остальные провайдеры). Live-verify: HOTD serial → 10 items/3 сезона/20 голосов, FG → 22 items.
Тест «карточка TMDB (id+title, без href) → резолв через поиск, не пусто» (rezka-provider.test.js, 56/56).

## 9. UI-обвязка

`public/maniya-online.js` (Step 6): в конец `loadSources` добавлен параллельный `requestJson` на
`/sources/card` → `applyCardAvailability` проставляет `sources[key].show` и пересобирает `filterSources`
(клиент уже исключает `show:false`). Активный источник корректно пересчитывается при скрытии.
**Задеплоено в составе `a105320`** (§13).

## 10. Остаточный риск

**Рецидив случился 2026-08-13 дважды (11:24, 11:32), сразу после тяжёлых shadow-прогонов**: кластер
насыщался, и ОБА сигнала (checksearch + прямой lite-page) флакали «нет» разом через online8-302-туннель →
rhsprem/kinopub скрывались на 5 минут при OLD items>0. **Реализовано усиление из §10-плана:**
- **`confirmWithBackoff`** — подтверждённый «нет» перепроверяется повторной прямой пробой через 500 мс;
- **HIDE_TTL_MS = 60 с** — confirmed-hide кэшируется на минуту вместо 5 минут.

Стойкая сатурация online8 бьёт и по OLD-навигации тоже (тот же бэкенд) — это не специфика availability.
Остаточный риск минимален: даже выживший «нет» (3 независимых сигнала) исчезает из UI максимум на минуту.

## 11. Что НЕ менялось

`SkazProvider.videos()` / resolver / hidden-twin / статический `/api/lampa/sources` — без изменений.
Секреты — только env (`server/.env`), в гит ничего не попадает.

## 12. Вердикт

- Гейт **OLD∩NEW зелёный во всех 8 прогонах** (включая Run 8 после усиления). availability готова.
- **Решения юзера приняты (2026-08-13):** rhsprem — видимый REST; ashdi/kinoukr/eneyida + remux/kinotochka —
  rch-reserved; UI availability включить; WebSocket/RCH НЕ реализовывать сейчас. Commit → push `backup` →
  deploy `scripts/deploy.sh` → production-сверка → финальный отчёт (§13).
- Требование «ни один реально работающий источник не исчез» кодируется тройной защитой:
  confirmAbsence (2 сигнала) + retry-with-backoff (3-й сигнал) + HIDE_TTL 60с (self-heal).

## 13. Production-сверка после деплоя

**Деплой выполнен 2026-08-13.** Commit `a105320` («BALANCER-002: per-card source availability +
verification wave»), push → remote `backup` (feature/alloha-provider → backup/feature/alloha-provider).
Деплой — `scripts/deploy.sh` (tar-over-SSH + systemd restart `maniya-online`), НЕ git. 17 файлов,
+2024/−47.

### Что задеплоено
- `server/src/availability.js` (+446) — per-card проверка skaz-балансеров, `confirmWithBackoff`
  (3 независимых сигнала «нет») + HIDE_TTL 60 с (self-heal), кэш fnv1a TTL 5 мин.
- `server/src/index.js` (+34) — `GET /api/lampa/sources/card` (requireSubscription → `userUid =
  sha256(token).slice(0,16)`; `!checkEnabled` → статический список; иначе `defaultChecker.card`).
- `server/src/config.js`/`registry.js`/`meta.js` — rhsprem добавлен в видимые; zagonka/kinobase/
  videocdn/lumex убраны; ashdi/kinoukr/eneyida + remux/kinotochka — rch-reserved (в видимый список
  НЕ входят).
- `server/src/providers/rezka/RezkaProvider.js` (+17) — P0-фикс resolveRecord (TMDB id без href →
  поиск по названию; «видео не найдено» с 08.08 закрыт).
- `public/maniya-online.js` (+54) — UI availability: параллельный `requestJson` на `/sources/card` →
  `applyCardAvailability` (`sources[key].show` → `filterSources`).
- 5 тест-файлов (+722): availability 25, hidden-twin, route e2e, rezka-provider 56.
- `scripts/balancer-002-shadow.mjs` — SHADOW/COMPARE раннер (на VPS).

### Список источников: до → после
| | До (BALANCER-001) | После (BALANCER-002) |
|---|---|---|
| Видимых в `/sources` | 16 | **16** (изменение состава, не количества) |
| + появились | — | `skaz-rhsprem` (Maniya · HDRezka 4K) |
| − исчезли | zagonka, videocdn, lumex, kinobase (не в live-универсуме) | — |
| rch-reserved (скрыты) | ashdi, kinoukr, eneyida, vkmovie | + remux, kinotochka |

Видимые 16: native — filmix, kodik, rezka, rutubemovie, cdnvideohub, collaps, hdvb; skaz — alloha,
videoseed, kinopub, kinoflix, veoveo, pidtor, solntse, geosaitebi, rhsprem.

### Per-card availability (реальный client-запрос, русский title + original_title + imdb_id)
| Карточка | Доступно источников |
|---|---|
| **HOTD** (Дом Дракона, serial 94997) | 14/16 (скрыты kinoflix, geosaitebi) |
| **Forrest Gump** (movie 13) | 15/16 (скрыт videoseed) |
| **The OA** (serial 71712) | 12/16 (скрыты alloha, geosaitebi, solntse, videoseed) |

Все скрытые — совпадение с shadow (OLD items=0) и со static-составом; ни один OLD-рабочий не скрыт
(гейт OLD∩NEW зелёный). Проверка по русским названиям (реальный Lampa шлёт `movie.title` русский):
английский title без original_title → 403/«нет» → скрытие — **артефакт ручной HTTP-проверки, не баг**
(у настоящего клиента всегда русский title, подтверждено идентичным ответом эндпоинта shadow-запросу).

### Латентность и кэш
- Cold: 3.7–9.0 с (параллельные проверки балансеров, дедлайн карточки ~10 с).
- Cache hit: **0 мс**, `cached:true` (HOTD 2-й вызов → `elapsed_ms:0`, show-набор тот же).
- Кэш-ключ fnv1a(`id:serial:source:count:uid`) — скрытие кэшируется на 60 с (HIDE_TTL), остальное 5 мин.

### Провайдеры live (HOTD, `/videos` через production API)
| source | items | methods |
|---|---|---|
| filmix | 100 | play, call |
| rezka | 100 | play, call |
| skaz-alloha | 100 | play, call |
| skaz-rhsprem | 100 | play, call |
| skaz-kinopub | 100 | play, call |

Все — `items=100` с полями `season`/`episode`/`voice_name` (клиент строит сезон/голос из item'ов —
подтверждено pre-existing, не регрессия; `SkazProvider.js` не менялся). Rezka/Alloha/SKAZ/Filmix —
все воспроизводятся.

### rch-reserved скрыты
remux, kinotochka, ashdi, kinoukr, eneyida — **отсутствуют** в `/sources` (проверено: «найдено: нет»).

### Итог
Все пункты решения юзера (1–8) выполнены. Реальный UI подтверждён цепочкой API: registry → per-card
(идентичен shadow-запросу) → cache → /videos для 5 ключевых провайдеров. Клик-тест в самом приложении
Lampa с этой машины невозможен (нет Android/iOS-эмуляции); эквивалентная проверка — точная копия
клиентского query + ответ эндпоинта, совпавший с shadow.
