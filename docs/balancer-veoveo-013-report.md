# BALANCER-VEOVEO-013 — «VeoVeo исправлен по playback, но не появляется в списке источников Lampa»

> RESEARCH ONLY. Код не менялся. Ничего не закоммичено, не запушено, не задеплоено.
> Дата: 2026-08-15. Точки замера: VPS 95.85.241.121 (`/opt/maniya-online`), публичный HTTPS `plugin.maniya-kvn.online`.

---

## 1. Executive summary

**На текущем проде веово НЕ «исчез» ни на одном слое.** Все 15 тайтлов матрицы + 21 edge-форма запроса + 5× повторная выборка с `force` дают `skaz-veoveo` → `show:true` (authoritative, HTTP 200, `online3.skaz.tv`), videos 1–10 play-айтемов, playback через прокси 206 HLS. Реестр `/api/lampa/sources` содержит `skaz-veoveo` (`show:true`, имя «Ozvuchky», 🎧, Full HD). Cache чист (MISS→HIT, HIDE_TTL 60с, uid-разделение), single-flight работает (5 параллельных = 1 upstream calc, изолированные userUid).

Отчёт пользователя **не воспроизводится** с серверной стороны ни в одной форме запроса. Вердикт пользователя объясним одним из трёх вариантов (см. §8):
- **(наиболее вероятно)** юзер открыл тайтл, где у веово на кластере реально НЕТ контента → hide корректен и совпадает с E-Online (§5, §8-1);
- транзиентное окно кластера (200-empty на контентном тайтле → hide на 60с HIDE_TTL, self-heal) (§8-2);
- клиентское/устройственное (проверено: сервер отдаёт актуальный JS с `no-store`, клиент рендерит любой `show:true`) (§8-3).

**Изменений кода не требуется.** GAP-012 не трогал видимость (доказано, §7). availability работает правильно и совпадает с E-Online. Классификация — **G** (§9).

---

## 2. Full pipeline (что проверено и как)

Цепочка: `/api/lampa/sources` (статический реестр) → `/api/lampa/sources/card` (per-card availability, `defaultChecker.card`) → клиент `applyCardAvailability` (фильтр по `sources[key].show`) → `/api/lampa/videos` → `/api/lampa/video` (lazy resolve) → `/api/lampa/proxy` (playback).

| Слой | Файл | Что проверено |
|---|---|---|
| A. Реестр | `server/src/providers/registry.js`, `server/src/index.js` `/sources` | есть ли `skaz-veoveo`, id, enabled, show, порядок, мета |
| B. Card | `server/src/availability.js` `defaultChecker.card`, `index.js` `/sources/card` | show/hide/inconclusive/status/host/reason/authoritative/cached/elapsed_ms |
| C. Клиент | `public/maniya-online.js` `loadSources`/`applyCardAvailability`/`updateFilter` | рендер `show:true`, ghost-логика, sort-меню |
| D. Кэш | `availability.js` `cacheKey`/`cache`/`HIDE_TTL_MS` | холодный/тёплый, uid-разделение, stale-hide |
| E. Upstream | `lite/veoveo?checksearch=true` на `online3`/`online8` | content/absent/inconclusive, status, bytes |
| F. Policy | `TRUSTED_ALWAYS_VISIBLE`, `reservePolicy='abstain'`, OLD∩NEW гейт | не прячет ли по политике |
| Playback | `/api/lampa/proxy` | 206 HLS master/variant/TS |

Проверки гонялись двумя путями: **публичный HTTPS** (как у юзера: `https://plugin.maniya-kvn.online`) и **внутренний API** на VPS (`http://127.0.0.1:3000`), плюс **прямой вызов** `defaultChecker.card()` внутри модуля сервера (полный вердикт, который `/sources/card` не отдаёт наружу — только `{id, show}`).

---

## 3. Production evidence

### 3.1 Целостность кода (деплой = локальный код)
md5 ключевых файлов, локально == VPS (все 6 совпали):

| Файл | md5 |
|---|---|
| `server/src/availability.js` | `2bbf6873…` |
| `server/src/providers/registry.js` | `fd2f8df7…` |
| `server/src/index.js` | `67fc6126…` |
| `server/src/config.js` | `520aa444…` (mvapspdmpg.com в allowHosts подтверждён) |
| `server/src/proxy.js` | `a978b4ba…` |
| `public/maniya-online.js` | `b1301cd9…` |

### 3.2 Конфиг на VPS
- `skaz.balancers` = `alloha,videoseed,kinopub,kinoflix,**veoveo**,pidtor,solntse,filmix,rezka,hdvb,rutubemovie,kodik,geosaitebi,rhsprem` (veoveo на 5-й позиции).
- `skaz.hosts` = online3 (primary), online8 (резерв) + 4 IP. `checkEnabled=true`, `reservePolicy='abstain'`.
- `skaz.accountEmail`/`uid` заданы (granted-аккаунт). `.env` НЕ переопределяет `SKAZ_BALANCERS`/`EO_BALANCERS` (иначе веово мог выпасть).
- `proxy.allowHosts` содержит `mvapspdmpg.com` (GAP-012).

### 3.3 Реестр (слой A) — публичный HTTPS
`/api/lampa/sources` → **200, 16 источников**, `skaz-veoveo` присутствует:
```json
{"id":"skaz-veoveo","name":"Ozvuchky","icon":"🎧","quality_label":"Full HD","url":"https://plugin.maniya-kvn.online/api/lampa/videos?provider=skaz-veoveo","show":true}
```
`registeredProviders().find('skaz-veoveo').enabled() == true`. Веово без native-близнеца → не скрыт правилом «hidden twin» (скрыты skaz-filmix/rezka/hdvb/rutubemovie/kodik — у них живой native).

### 3.4 Card (слой B) — 15 тайтлов + 21 edge + 5× sampling
- 15/15: `veoShow:true`, authoritative, status 200, host `online3.skaz.tv`, inconclusive:false (для веово).
- 21 edge-форма (`source=kp/cub/hdvideobox`, `clarification=1` + search-text, no-id only-title, tmdb-id без imdb/kp, пустой year): **все show:true**.
- 5× `force` по Матрице (шаг 3с): **5/5 show:true** — флапа нет.
- `hasInconclusive:true` на части тайтлов — это про ДРУГИЕ источники (их статусный шум/таймауты), НЕ про веово (для веово row.inc:false).

### 3.5 Upstream (слой E) — raw `lite/veoveo?checksearch=true`
Для каждого контентного тайтла (пример — Матрица):
- `online3.skaz.tv` → **200**, body с `data-json='{"method":"play","url":"https://api.rstprgapipt.com/content-router/…/334.m3u8…","translate":"1080p","title":"Матрица (1080p)"}'` → `checkSearchPredicate` = **content** (work:true).
- `online8.skaz.tv` → **403 `disable`** (7 байт) → abstain-политика (резерв воздерживается, не «нет»).

Для тайтлов БЕЗ контента (несуществующий id, obscure): `online3` → **200, 0 байт** (empty) → `absent` → authoritative hide (корректно, см. §5).

### 3.6 Videos + Playback
- `videos?provider=skaz-veoveo`: movies → 1 play-item, serials → 8–10 play-items (все `method:'play'`, URL через `/api/lampa/proxy`).
- Прокси-playback (Range bytes=0-4095) на 6 тайтлах (Одиссея, Матрица, Интерстеллар, Дом Дракона, Форрест, Последний дом): **все 206, `application/vnd.apple.mpegurl`** — GAP-012 продолжает работать.

### 3.7 Публичный HTTPS vs внутренний API
`/sources` и `/sources/card` через публичный HTTPS (с локальной машины, тот же токен) — идентично: `skaz-veoveo show:true`, card `veo show:true` (meta elapsed_ms 7096). nginx ничего не режет.

---

## 4. Таблица 10+ тайтлов (VeoVeo registry | card verdict | videos | playback)

| # | Тайтл | serial | /sources | card (veo) | videos | playback |
|---|---|---|---|---|---|---|
| 1 | Одиссея (2026) | 0 | present | **show:true** auth:true 200 online3 | 1 play | 206 HLS |
| 2 | Последний дом (2026) | 0 | present | **show:true** auth:true 200 online3 | 4 play | 206 HLS |
| 3 | Форрест Гамп | 0 | present | **show:true** auth:true 200 online3 | 1 play | 206 HLS |
| 4 | Матрица | 0 | present | **show:true** auth:true 200 online3 | 1 play | 206 HLS |
| 5 | Интерстеллар | 0 | present | **show:true** auth:true 200 online3 | 1 play | 206 HLS |
| 6 | Дом Дракона | 1 | present | **show:true** auth:true 200 online3 | 10 play | 206 HLS |
| 7 | The OA | 1 | present | **show:true** auth:true 200 online3 | 8 play | — (не гонялся) |
| 8 | Укрытие | 1 | present | **show:true** auth:true 200 online3 | 10 play | — |
| 9 | Дюна: Часть вторая | 0 | present | **show:true** auth:true 200 online3 | 1 play | — |
| 10 | Одни из нас | 1 | present | **show:true** auth:true 200 online3 | 10 play | — |
| 11 | Дюна | 0 | present | **show:true** auth:true 200 online3 | 1 play | — |
| 12 | Аватар | 0 | present | **show:true** auth:true 200 online3 | 1 play | — |
| 13 | Человек-паук: НПД | 0 | present | **show:true** auth:true 200 online3 | 1 play | — |
| 14 | Титаник | 0 | present | **show:true** auth:true 200 online3 | 1 play | — |
| 15 | Джокер | 0 | present | **show:true** auth:true 200 online3 | 1 play | — |

Legacy-контроль (hide-путь, §5): несуществующий id / obscure / старый нишевый сериал → **show:false auth:true** (200-empty upstream) — корректен.

---

## 5. Maniya vs E-Online (для тех же карточек)

E-Online = Lampac-референс на том же skaz-кластере; его доступ фильтрует источники по карточке серверным `checksearch`. Сравнение выполнялось **тем же механизмом**, которым E-Online принимает решение — `lite/veoveo?checksearch=true` на кластер с granted-аккаунтом (`dorofeevigor20@…`/`7974327d37`, те же creds, что у Maniya).

| Карточка | Clúster для E-Online (raw checksearch) | Maniya card(veoveo) | Расхождение |
|---|---|---|---|
| Матрица и 14 контентных тайтлов | `online3` 200, content (play 1080p) | show:true | **Нет** |
| Несуществующий/obscure | `online3` 200-empty → Lampac скроет | show:false | **Нет** |

**Вывод: расхождения вердиктов нет.** Если E-Online показывает веово для карточки — Maniya показывает; если E-Online прячет (нет контента) — Maniya прячет. Маня не имеет «лишнего» hide относительно E-Online ни на одной из проверенных карточек.

---

## 6. Cache analysis (слой D)

- **Ключ**: `fnv1aKey(id:serial:source:count:userUid)`, где `userUid = sha256Hex(token).slice(0,16)`, `count=16`, `source='tmdb'` (дефолт), `serial` из `isSerialQuery`. TTL 5 мин, подтверждённый hide — `HIDE_TTL_MS=60с`.
- **Холодный/тёплый (HTTP, живой кэш сервера)**: 1-й запрос `cached:false` (elapsed_ms 5037), 2-й — `cached:true` (elapsed_ms 0). Вердикт одинаков (veo show:true).
- **UID-разделение**: user B (`vip-kanal-tvv`) первый запрос `cached:false` (отдельный calc, свой ключ) — вердикт тот же (veo show:true).
- **Stale hide до/после GAP-012**: сервер перезапущен `ExecMainStartTimestamp=2026-08-15 10:11:09 UTC` (после деплоя) → in-memory кэш свежий; ни один первый запрос не вернул устаревший hide (все `cached:false` на первом прогоне). HIDE_TTL=60с делает даже возможный hide само-лечащимся.
- **Повторные открытия карточки**: тот же uid+query → HIT, тот же набор.

---

## 7. Concurrency analysis (single-flight, BALANCER-STABILITY-003)

- **5 параллельных card() одного ключа** (свежий userUid, холодный кэш): `wallMs=1335`, `allElapsedMs=[1335]` — **один upstream calc**, все 5 получили тот же результат; `identical:true`, veoShows `[true,true,true,true,true]`.
- **Изоляция разных uid**: A (уже тёплый кэш, elapsed 0) + B (холодный, свежий calc elapsed 12001) параллельно — не блокируют друг друга, оба veo show:true.
- `force` изолирован от non-force (отдельный flightKey). Отказ/rejected calc не отравляет flight (finally снимает entry).

Вывод: single-flight не может скрыть веово (join возвращает тот же результат, что основной calc).

---

## 8. Root cause

**Серверных дефектов видимости веово не обнаружено.** На 15 контентных тайтлах + 21 edge-форме + повторной выборке веово показывается и играет. Отчёт «не появляется в списке источников» объясняется (в порядке вероятности):

1. **Юзер открыл тайтл без контента веово** (hide корректен). Веово = агрегатор озвучек (Ozvuchky); его покрытие — в основном популярные западные тайтлы. Если юзер смотрит русские фильмы/аниме/нишевое — на кластере пустой ответ → `show:false` (доказано: несуществующий id → 200-empty → hide). Это **правильное** поведение, совпадающее с E-Online. Как проверить: попросить юзера назвать конкретный фильм/сериал, где пропал веово, и прогнать его id через карточку.
2. **Транзиентное окно кластера** (событие, а не состояние): если `online3` на миг вернул 200-empty по контентному тайтлу, OLD∩NEW гейт при двух согласных «нет» прячет веово на **60 секунд** (HIDE_TTL, hasInconclusive → self-heal). Юзер, попавший в это окно, не увидел источник; через минуту он возвращается. На текущих замерах окна нет (5× force стабильно show:true).
3. **Клиент/устройство**: сервер отдаёт актуальный `maniya-online.js` (`Cache-Control: no-store`), клиент рендерит любой `sources[key].show:true` и прячет только при `show:false` от `/sources/card`. При чистом реестре клиент не может «потерять» веово сам по себе. Остаются Lampa-кэш расширения / сессионные артефакты — проверить переустановкой расширения.

**Чего НЕТ в корне**: ни stale-кэша (кэш сброшен рестартом, HIDE_TTL 60с), ни реестровой потери (веово в `/sources`), ни политического hide (abstain корректно воздерживается на online8 403 `disable`), ни расхождения с E-Online.

---

## 9. Classification (A–G)

**G — other / не воспроизводится на текущем проде.** Ни один серверный слой не «теряет» веово:

| Слой | Статус |
|---|---|
| A. нет в /sources | ❌ НЕТ (в реестре, show:true) |
| B. card прячет | ❌ НЕТ (show:true auth на всех контентных) |
| C. UI прячет при show:true | ❌ НЕТ (клиент рендерит) |
| D. stale-кэш/старый вердикт | ❌ НЕТ (кэш свежий, HIDE_TTL 60с) |
| E. upstream-вердикт | ⚠️ Только для тайтлов БЕЗ контента (корректно, совпадает с E-Online) |
| F. policy/predicate | ❌ НЕТ (abstain/trusted/gate работают как спроектировано) |
| G. другое | ✅ **наиболее вероятно** — тайтлы юзера без контента веово, либо транзиентное окно кластера |

---

## 10. Proposed fix

**Нет.** Изменений не требуется и не рекомендуется (§13). Если после §8-1 выяснится конкретный тайтл юзера с пропавшим веово и при этом на кластере ЕСТЬ контент — это отдельная диагностика (не текущая задача), и только тогда чинить кластерную выдачу/ротацию, а не видимость.

Единственное «улучшение» не-кодовое: в бот/ответы юзеру добавить формулировку, что веово показывается только на тайтлах, где у него есть контент (Ozvuchky покрывает не весь каталог).

---

## 11. Risks

- **Риск починить рабочее**: любое «чтобы веово всегда светился» (вроде добавления в TRUSTED_ALWAYS_VISIBLE) = показать мёртвую кнопку на тайтлах без контента → юзер получит «видео не найдено» вместо честного отсутствия. Нарушит согласованность с E-Online.
- **Риск неверной диагностики**: если гнаться за «не появляется» без конкретного тайтла юзера — легко начать менять availability под фантом (несуществующий дефект). Воздержаться.
- **Транзиентный hide**: 60-секундное окно hide при кластерном 200-empty — известное поведение (RULE-4), самолечится по HIDE_TTL; усиливать не нужно, но если юзер будет жаловаться регулярно — смотреть кластер, а не availability.

---

## 12. Necessary tests (для повторного доказательства при необходимости)

1. Повторный live-прогон матрицы (15 тайтлов) по §3.4 — должен остаться 15/15 show:true.
2. Для КОНКРЕТНОГО тайтла юзера: `/sources/card` + raw `lite/veoveo?checksearch=true` на online3/online8 (сравнить с E-Online-эквивалентом).
3. Свежесть кэша: два последовательных `/sources/card` (MISS→HIT) и uid-разделение (user B).
4. Single-flight: 5 параллельных card() одного ключа → 1 calc, identical.
5. Playback-цепочка: proxy master→variant→TS 0x47 (6–8 тайтлов) — регрессия GAP-012 не вернулась.
6. Hide-путь: несуществующий id → show:false (корректный), тайтл с контентом → show:true.

---

## 13. What NOT to change

- **НЕ добавлять veoveo в `TRUSTED_ALWAYS_VISIBLE`** (filmix-исключение обосновано отдельными отчётами; веово их доказательств не имеет и не нуждается — его checksearch достоверен).
- **НЕ вводить `if source===veoveo show=false`** и любые provider-хардкоды видимости.
- **НЕ менять `reservePolicy='abstain'`** — он корректен (online8 403 `disable` ≠ «нет»); возврат к legacy вернёт флап по 4 слагам.
- **НЕ трогать `HIDE_TTL_MS`, `TTL_MS`, single-flight, OLD∩NEW гейт** — все подтверждены рабочими.
- **НЕ менять клиент** (`applyCardAvailability`/`updateFilter`/sort-меню) — код корректен; менять его «на всякий случай» — риск сломать BALANCER-UI-001/сезоны/озвучки.
- **НЕ делать «playback работает → источник должен всегда показываться»** — это и есть запрещённая связка из ТЗ: видимость решает контент-вердикт кластера, а не способность прокси отдать 206.

---

## 14. Next step

1. Спросить юзера: **какой конкретно фильм/сериал** и из какого раздела (поиск/подборка/KP/коллекция) открывал, где веово нет. Без этого дальнейшая диагностика не имеет смысла — серверные слои исчерпаны.
2. Если тайтл назван: прогнать его через §12-2 (raw checksearch + card) и сравнить с E-Online. Если кластер отвечает контентом, а Maniya прячет — новый баг; если кластер пустой — объяснить юзеру легитимное отсутствие.
3. Если жалоба повторится на разных тайтлах с интервалом ~минута — подозревать транзиентный 200-empty кластера; наблюдать `lite/veoveo` на online3 в окне.
4. Отчёт закрыт; код не изменён; временные скрипты с VPS и локального Temp удалены.
