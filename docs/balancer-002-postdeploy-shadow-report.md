# BALANCER-002 POST-DEPLOY — SHADOW/COMPARE: единый per-card availability для native

Дата: 2026-08-13. Статус: **БЛОКЕР (правило #7) — UI НЕ подключён, работа остановлена на диагностике.**

## 1. TL;DR

- Реализован **единый per-card availability** для native + skaz + скрытых твинов; хардкод
  «native → всегда show:true» **удалён** (`server/src/availability.js`, не задеплоено).
- `provider.videos()` / `resolveVideo()` / `store.js` / существующие provider-имплементации **не менялись** —
  availability определяет только видимость, не воспроизведение.
- Тесты: **12/12** `availability-hidden-twin.test.js` (переписан: теперь закрепляет НОВОЕ поведение),
  вся сюита **462 pass / 2 fail** (2 fail — предсуществующие, дата-зависимая плюрализация в
  `api.test.js` «Осталось 26803 дня» vs `/^Осталось \d+ дней$/`, вне scope минимального фикса).
- SHADOW на 5 карточках (Forrest Gump, Дом Дракона, The OA, Seven-Per-Cent, Матрица) на живом VPS,
  живой сервер не перезапускался (scratch-копия `/tmp/shadow-new/src`).
- **1 БЛОКЕР по правилу юзера #7**: `filmix` на Seven-Per-Cent — NEW=false при EO=show.
- **Решение: UI НЕ подключаю, останавливаюсь на диагностике.** Коммитов/деплоя нет.

## 2. Что сделано (минимальный фикс, требования юзера 1–5)

`server/src/availability.js`:
- `NATIVE_PROBES`: cdnvideohub (ключуется по kp → `client.playlist(kp)`, бросает HttpError на сетевой/
  HTTP-ошибке), collaps (kp→imdb→orid через `recordByKeys`, фолбэк — поиск по названию).
- `nativeProbe()`: **нет ключа → inconclusive → show**; найдено → show (authoritative); пусто ПРИ ключе →
  «нет» (authoritative); сеть/HTTP/таймаут/дедлайн → inconclusive → show.
- `confirmNativeAbsence()` — аналог `confirmWithBackoff` для native без твина.
- `resolveSources()`: native несут `provider`, `balancer`/`twinBalancer` = балансер скрытого твина.
- `card()` settled-block: native-с-твином → `checkBalancer(twin.balancer)`; native-без-твина →
  `nativeProbe()`; skaz → `checkBalancer()`.
- **OLD∩NEW гейт расширен на native**: прячем источник только при «нет» от ОБОИХ сигналов
  (native-без-твина — повторной пробой, native-с-твином — прямым lite-page балансера).
- Кэш: подтверждённый «нет» — HIDE_TTL_MS 60с (self-heal), чистые вердикты — 5 мин.

`server/test/availability-hidden-twin.test.js` — переписан (старый закреплял «native никогда не
проверяется»). 12 тестов: twin-проверка native filmix, скрытие при двойном «нет», nativeProbe
cdnvideohub/collaps (no-key/найдено/пусто/ошибка/таймаут).

## 3. Методика SHADOW/COMPARE

- **NEW** = `checker.card()` из scratch-копии `/tmp/shadow-new/src/availability.js` (md5 совпадает с
  локальной правкой `2304da1…`); креды из реального `/opt/maniya-online/.env` + `server/.env`.
- **OLD** = живой `GET /api/lampa/videos?provider=X` (store-путь с твином) — что реально получит юзер
  при клике.
- **twin** = `twinFor(native)` из registry.
- **EO** = `lite/events` (серверный checksearch E-Online) на primary хосте, c аккаунтом.
- 5 карточек: Forrest Gump (movie 13, kp 448), Дом Дракона (serial 94997, kp 1316601), The OA
  (serial 71712, kp 1008365), Seven-Per-Cent (movie 27190, kp 7204), Матрица (movie 603, kp 301).
- visible(16): filmix, kodik, rezka, rutubemovie, cdnvideohub, collaps, hdvb, skaz-alloha,
  skaz-videoseed, skaz-kinopub, skaz-kinoflix, skaz-veoveo, skaz-pidtor, skaz-solntse,
  skaz-geosaitebi, skaz-rhsprem. Natives: filmix/kodik/rezka/rutubemovie/hdvb (+twin),
  cdnvideohub/collaps (probe).

## 4. Таблицы (source | OLD items | NEW availability | twin | expected | E-Online)

### 4.1 Forrest Gump (movie 13, kp 448) — elapsed 12.0s

| source | type | OLD items | NEW avail | twin | expected | EO | verdict |
|---|---|---|---|---|---|---|---|
| filmix | native | 5 | true | skaz-filmix | show | show | OK |
| kodik | native | 0 | **false** | skaz-kodik | hide | hide | OK |
| rezka | native | 22 | true | skaz-rezka | show | show | OK |
| rutubemovie | native | 8 | true | skaz-rutubemovie | show | show | OK |
| cdnvideohub | native | 2 | true | probe | show | n/a | OK |
| collaps | native | 1 | true | probe | show | n/a | OK |
| hdvb | native | 1 | true | skaz-hdvb | show | show | OK |
| skaz-alloha | skaz | 4 | true | — | show | show | OK |
| skaz-videoseed | skaz | 0 | true | — | hide | hide | +visible (запас) |
| skaz-kinopub | skaz | 25 | true | — | show | show | OK |
| skaz-kinoflix | skaz | 3 | true | — | show | show | OK |
| skaz-veoveo | skaz | 1 | true | — | show | show | OK |
| skaz-pidtor | skaz | 0 | true | — | show (EO) | show | OK (gap соблюдён) |
| skaz-solntse | skaz | 1 | true | — | show | show | OK |
| skaz-geosaitebi | skaz | 1 | true | — | show | show | OK |
| skaz-rhsprem | skaz | 22 | true | — | show | show | OK |

### 4.2 Дом Дракона (serial 94997, kp 1316601) — elapsed 3.6s

| source | type | OLD items | NEW avail | twin | expected | EO | verdict |
|---|---|---|---|---|---|---|---|
| filmix | native | 10 | true | skaz-filmix | show | show | OK |
| kodik | native | 0 | true | skaz-kodik | hide | hide | +visible (запас) |
| rezka | native | 10 | true | skaz-rezka | show | show | OK |
| rutubemovie | native | 0 | false | skaz-rutubemovie | hide | hide | OK |
| cdnvideohub | native | 10 | true | probe | show | n/a | OK |
| collaps | native | 10 | true | probe | show | n/a | OK |
| hdvb | native | 10 | true | skaz-hdvb | show | show | OK |
| skaz-alloha | skaz | 10 | true | — | show | show | OK |
| skaz-videoseed | skaz | 10 | true | — | show | show | OK |
| skaz-kinopub | skaz | 10 | true | — | show | show | OK |
| skaz-kinoflix | skaz | 0 | false | — | hide | hide | OK |
| skaz-veoveo | skaz | 10 | true | — | show | show | OK |
| skaz-pidtor | skaz | 0 | true | — | show (EO) | show | OK (gap соблюдён) |
| skaz-solntse | skaz | 10 | true | — | show | show | OK |
| skaz-geosaitebi | skaz | 0 | false | — | hide | hide | OK |
| skaz-rhsprem | skaz | 10 | true | — | show | show | OK |

### 4.3 The OA (serial 71712, kp 1008365) — elapsed 11.6s

| source | type | OLD items | NEW avail | twin | expected | EO | verdict |
|---|---|---|---|---|---|---|---|
| filmix | native | 8 | true | skaz-filmix | show | show | OK |
| kodik | native | 0 | true | skaz-kodik | hide | hide | +visible (запас) |
| rezka | native | 8 | true | skaz-rezka | show | show | OK |
| rutubemovie | native | 0 | false | skaz-rutubemovie | hide | hide | OK |
| cdnvideohub | native | 8 | true | probe | show | n/a | OK |
| collaps | native | 8 | true | probe | show | n/a | OK |
| hdvb | native | 8 | true | skaz-hdvb | show | show | OK |
| skaz-alloha | skaz | 8 | true | — | show | show | OK |
| skaz-videoseed | skaz | 0 | false | — | hide | hide | OK |
| skaz-kinopub | skaz | 8 | true | — | show | show | OK |
| skaz-kinoflix | skaz | 0 | true | — | show (EO) | show | OK (gap соблюдён) |
| skaz-veoveo | skaz | 8 | true | — | show | show | OK |
| skaz-pidtor | skaz | 0 | true | — | show (EO) | show | OK (gap соблюдён) |
| skaz-solntse | skaz | 0 | false | — | hide | hide | OK |
| skaz-geosaitebi | skaz | 0 | false | — | hide | hide | OK |
| skaz-rhsprem | skaz | 8 | true | — | show | show | OK |

### 4.4 Seven-Per-Cent (movie 27190, kp 7204) — elapsed 12.0s

| source | type | OLD items | NEW avail | twin | expected | EO | verdict |
|---|---|---|---|---|---|---|---|
| **filmix** | native | 0 | **false** | skaz-filmix | show (EO) | show | **⚠ БЛОКЕР: NEW=false при EO=show** |
| kodik | native | 0 | true | skaz-kodik | hide | hide | +visible (запас) |
| rezka | native | 2 | true | skaz-rezka | show | show | OK |
| rutubemovie | native | 0 | true | skaz-rutubemovie | hide | hide | +visible (запас)* |
| cdnvideohub | native | 0 | false | probe | show? (нет EO-slug) | n/a | hide корректен (kp валиден, контента нет) |
| collaps | native | 0 | true | probe | show? (нет EO-slug) | n/a | OK (probe нашёл) |
| hdvb | native | 0 | false | skaz-hdvb | hide | hide | OK |
| skaz-alloha | skaz | 3 | true | — | show | show | OK |
| skaz-videoseed | skaz | 0 | true | — | hide | hide | +visible (запас) |
| skaz-kinopub | skaz | 3 | true | — | show | show | OK |
| skaz-kinoflix | skaz | 0 | false | — | hide | hide | OK |
| skaz-veoveo | skaz | 1 | true | — | show | show | OK |
| skaz-pidtor | skaz | 0 | false | — | hide | hide | OK |
| skaz-solntse | skaz | 0 | false | — | hide | hide | OK |
| skaz-geosaitebi | skaz | 0 | true | — | hide | hide | +visible (запас) |
| skaz-rhsprem | skaz | 2 | true | — | show | show | OK |

\* rutubemovie на этой карточке флакает: в 5-карточном прогоне NEW=true, в изолированном — NEW=false
(EO=hide в обоих → не блокер). В любом случае EO согласен «hide», рабочий источник не скрыт.

### 4.5 Матрица (movie 603, kp 301) — elapsed 12.0s

| source | type | OLD items | NEW avail | twin | expected | EO | verdict |
|---|---|---|---|---|---|---|---|
| filmix | native | 4 | true | skaz-filmix | show | show | OK |
| kodik | native | 0 | true | skaz-kodik | hide | hide | +visible (запас) |
| rezka | native | 18 | true | skaz-rezka | show | show | OK |
| rutubemovie | native | 1 | true | skaz-rutubemovie | show | hide | OK (+visible, НО работает) |
| cdnvideohub | native | 3 | true | probe | show | n/a | OK |
| collaps | native | 1 | true | probe | show | n/a | OK |
| hdvb | native | 2 | true | skaz-hdvb | show | show | OK |
| skaz-alloha | skaz | 7 | true | — | show | show | OK |
| skaz-videoseed | skaz | 16 | true | — | show | show | OK |
| skaz-kinopub | skaz | 22 | true | — | show | show | OK |
| skaz-kinoflix | skaz | 0 | true | — | hide | hide | +visible (запас) |
| skaz-veoveo | skaz | 1 | true | — | show | show | OK |
| skaz-pidtor | skaz | 3 | true | — | show | show | OK |
| skaz-solntse | skaz | 1 | true | — | show | show | OK |
| skaz-geosaitebi | skaz | 1 | true | — | show | show | OK |
| skaz-rhsprem | skaz | 18 | true | — | show | show | OK |

## 5. Проверка ТЗ юзера (6 ожиданий)

| Ожидание юзера | Результат |
|---|---|
| **kodik: OLD=0 → NEW=false** | ✓ на Forrest Gump. ✗ на HOTD/OA/Seven-Per-Cent/Матрице: NEW=true при OLD=0 и EO=hide — **+visible** (не блокер). Причина в §7. |
| **cdnvideohub: OLD=0 → NEW=false** | ✓ на Seven-Per-Cent (kp валиден, контента нет). На остальных 4 карточках контент ЕСТЬ (OLD=2..10) → NEW=true — проба с kp работает. Прошлый вердикт «cdnvideohub лишний» был **артефактом отсутствия kp** в диагностическом запросе. |
| **rutubemovie: native=0 + twin>0 → NEW=true** | Карточка-зависимо: FG/Матрица — twin нашёл карточку → true; HOTD/OA — twin не нашёл (EO=hide) → false. |
| **collaps: карточка-зависимый** | Да: FG/HOTD/OA/Матрица → true (recordByKeys нашёл запись); Seven-Per-Cent → true (probe нашёл, хотя OLD=0) — не блокер (нет EO-slug). |
| **Filmix/Pidtor/Kinoflix: не скрывать из-за navigation gap** | pidtor (OA/HOTD/FG: EO=show, NEW=true) ✓, kinoflix (OA: EO=show, NEW=true) ✓. **filmix ✗ БЛОКЕР на Seven-Per-Cent.** |
| **Правило #7: NEW не скрывает то, что EO показывает** | Нарушено ровно в одном месте: filmix/Seven-Per-Cent. → СТОП. |

**OLD∩NEW (правило #6): конфликтов НЕТ** — ни один источник с OLD items>0 не скрыт ни на одной
карточке (cdnvideohub FG/HOTD/OA/Матрица true при OLD>0; rutubemovie/Матрица true при OLD=1).
Гейт не сработал — но и не понадобился: новых скрытий рабочих источников не было.

## 6. БЛОКЕР: filmix на Seven-Per-Cent (kp 7204) — диагностика

**Симптом.** NEW=false (скрыт), EO=show, OLD=0 (Maniya filmix-навигация карточку не отдаёт —
задокументированный navigation gap filmix/niche). По правилу #7 — СТОП, UI не подключать.

**Проверено на VPS (изолированно, без шума 5-карточного прогона):**
- `checksearch` (lite/filmix, с kp) ×3 → show=false, authoritative, **все 6 хостов ответили «нет»**:
  online3.skaz.tv → `503 null`; online8.skaz.tv → `403 disable` (filmix ВЫКЛЮЧЕН на ноде);
  94.249.239.{63,37,11} → `503` (пусто); 77.90.33.109 → `403 disable`.
- RAW-матрица форм запроса на online3: `kp+checksearch`, `kp+direct`, `no-kp+checksearch`,
  `no-kp+direct`, `search=`, `search_one`, и **bare (без единого параметра)** — ВСЁ `503 null`.
- `redirect:'manual'` → **редиректов нет** (rch-механизм не при чём).
- **Баланс НЕ лежит**: filmix на online3 с НАШЕЙ учёткой по Forrest Gump → `200`, work=true,
  контент 5973 байта.
- Анонимный filmix → `{"accsdb":true,"msg":"Войдите в аккаунт…"}` (кластер требует аккаунт — он у нас есть).
- **EO events ×3 свежих (подряд, с аккаунтом) → filmix=show стабильно** — не устаревший кэш.

**Вывод.** `lite/filmix` (то, что читает наш checksearch) честно отвечает «нет» для этой карточки во
всех формах, но E-Online-плагин на той же ноде через свой `lite/events` стабильно отвечает «есть».
Механика checkSearch для filmix внутри плагина EO не воспроизводится сырым `lite/filmix`-запросом —
плагин EO это закрытый форк, его конфиг баланса filmix нам недоступен. Это **расхождение источников
истины** (environment), а не баг в `availability.js`: checker честно прочитал кластер и сообщил «нет».

Поскольку ровно этот случай юзер закладывал в правило #7 («не скрывать автоматически из-за navigation
gap» для filmix/pidtor/kinoflix) и в критерий остановки («NEW скрывает источник, который EO показывает»),
**решение: UI не подключать, работа остановлена на диагностике.**

## 7. kodik +visible на 4/5 карточках — объяснение

NEW для native-с-твином = checksearch(skaz-kodik). На HOTD/OA/Seven-Per-Cent/Матрице checksearch
нашёл карточку → show, при том что OLD=0 и EO=hide. Причина: `lite/kodik` на online3 отвечает
**302-редиректом** на `/lite/kodik?rjson=False&title=…` — карточный запрос перенаправляется в
title-поиск; наш fetch следует за редиректом и оценивает страницу поиска, а там для этих названий
есть data-json (work=true). На Forrest Gump title-поиск пуст → kodik скрыт. Это тот же класс
navigation gap (карточка у кластера есть, Maniya-резолвер items не отдаёт), но в **+visible**-направлении:
не нарушает правило #7, однако жалоба юзера «источник виден, а фильм не играет» для kodik на этих
карточках сохраняется. EO здесь «hide» — значит EO-конфиг kodik-баланса ищет иначе (другой search-механизм).

## 8. Что НЕ скрыто из того, что EO показывает (кроме filmix) — нет

Единственное расхождение «NEW=false при EO=show» — filmix/Seven-Per-Cent. Все прочие NEW=false
совпадают с EO=hide (rutubemovie/HOTD, rutubemovie/OA, kinoflix/HOTD, geosaitebi/HOTD, videoseed/OA,
solntse/OA, hdvb/Seven-Per-Cent, kinoflix/Seven-Per-Cent, pidtor/Seven-Per-Cent, solntse/Seven-Per-Cent).

## 9. Решение

1. **UI (`public/maniya-online.js`) к новой availability НЕ подключён** — по правилу #7.
2. **Коммитов и деплоя нет.** Изменены только локально: `server/src/availability.js`,
   `server/test/availability-hidden-twin.test.js`. Живой сервер на VPS не перезапускался.
3. Новый код полностью отлажен (12/12 тестов) и готов к подключению ПОСЛЕ снятия блокера.

## 10. Рекомендации (решение за юзером)

- **Вариант A (рекомендуется): filmix — оптимистичный show (исключение из checksearch-скрытия).**
  filmix числится у юзера среди navigation-gap источников («не скрывать автоматически»), а его
  checksearch-сигнал недостоверен (EO-плагин на той же ноде отвечает иначе). Разрешить filmix
  availability = show (как сейчас в проде) до закрытия filmix navigation gap (Maniya-резолвер filmix
  отдаёт items на карточках, где кластер карточку имеет). Остальные источники — под единым гейтом.
  Минус: жалоба «filmix виден, но не играет» для filmix остаётся до фикса навигации.
- **Вариант B: воспроизвести checkSearch EO для filmix** (какой именно запрос делает плагин: другой
  пул хостов / rch / search-эндпоинт). Глубокая работа, возможно невозможна извне (закрытый форк).
- **Вариант C: filmix скрывать по checksearch как сейчас** — но тогда на Seven-Per-Cent filmix
  исчезнет вопреки EO и правилу юзера. Не рекомендую.
