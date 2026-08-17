# COLLAPS-SHAPE-FIX-001 — отчёт

Статус: **IMPLEMENTED** (код+тесты локально, live-механизм доказан на temp-VPS). Commit/push/deploy НЕ делались (по инструкции).
Дата: 2026-08-17. Suite: **652 / 646 pass / 0 fail / 6 skip** (из `server/`, `NODE_ENV=test node --test`).

---

## A. Root cause

`availability.js` для Collaps в title-only-режиме отвечал «FOUND / show:true» по **первому** поиску (`client.search().results.length > 0`), а затем `/videos` (при отсутствии явных kp/imdb/orid) **повторно** запускал `client.search(title)` + `bestMatch` и строил/выбирал embed-route заново. Два независимых поиска могли выбрать **разные** записи → разные identity → **разные** route → «карточка FOUND, `/videos` — другой маршрут → 422/боится-пусто → «видео не найдено» при `show:true`». Рассинхрон «search-identity» и «videos-identity».

## B. Что изменено

1. **`server/src/providers/collaps/CollapsProvider.js`** — единая canonical identity для Collaps (kp → imdb → orid + embedHost), пропущенная через **инстанс-кэш по `title|year`** (TTL 30 мин, max 256):
   - `search()` предзаполняет кэш identity из bestMatch-записи.
   - `resolveIdentity()` title-only: **сначала кэш** (требование: «НЕ делать повторный title-search в /videos, если identity уже известна»), иначе однократный search+bestMatch с записью в кэш.
   - `identityFromMatch()`: identity = kp/imdb/orid/embedHost — display name в identity НЕ участвует.
   - `embed()` строит route из той же identity; `recordByKeys()` без изменений в логике.
2. **`server/src/availability.js`** — `NATIVE_PROBES.collaps.present` теперь = `Boolean(await provider.recordByKeys(query, requestContext))` (`recordByKeys` → `resolveIdentity`: kp→imdb→orid, иначе title→search+bestMatch с кэшем → embed). Вердикт карточки и содержимое `/videos` теперь производятся **одним и тем же** путём. `HARD_REFUSAL_STATUSES` (403/422/451) и глобальная availability-semantics **не тронуты**.
3. **Тесты**: +5 (COL-8 title-only дважды → идентичный route, search один раз; COL-9 search() сеет кэш → /videos тот же identity без повторного поиска; COL-10 explicit kp → search никогда; COL-11 embedHost=origin(iframe_url); availability: карточки есть, но route не playable → show:false, а не FOUND).

Skaz, proxy, store.js, VKMovie/RUmovie-1, Rutube, Kodik, E-Online — не изменялись.

## C. Identity flow: BEFORE → AFTER

**BEFORE:**
```
search()  → client.search(title) → FOUND (любой результат)          [show:true]
/videos   → client.search(title)  → bestMatch  → другой выбор?      [другой route → пусто]
```
Карточка и `/videos` — два независимых поиска с независимым выбором записи.

**AFTER:**
```
search()  → client.search → bestMatch → identity{kp,imdb,orid,embedHost} → кэш (title|year)
card      → recordByKeys → resolveIdentity: explicit-ключи | кэш | search+bestMatch → embed → playable?
/videos   → embed → resolveIdentity: explicit-ключи | кэш(ТОТ ЖЕ)  → ТОТ ЖЕ embed-route → items
```
Одна canonical identity проходит весь путь поиск → карточка → `/videos` → embed. Без явных ключей повторный title-search НЕ происходит, пока identity актуальна.

## D. Live proof (temp-VPS 127.0.0.1:3102, прод не тронут)

SHAPE-DEBUG логи temp-сервера показывают: для каждого реального названия identity резолвится **один раз** (SEARCH-FIRST) и все последующие обращения карточки/`/videos` — **CACHE-HIT с идентичными** kp/imdb/orid/embedHost и идентичным embed-route:

| Название | identity (SEARCH-FIRST) | Все последующие route |
|---|---|---|
| Матрица | kp=301, orid=474 | `/embed/kp/301` (одинаково card+`/videos`) |
| Интерстеллар | kp=258687, orid=180 | `/embed/kp/258687` |
| Форрест Гамп | kp=448, orid=164 | `/embed/kp/448` |
| Дом Дракона | kp=1316601, orid=14327 | `/embed/kp/1316601` |
| Одиссея | поиск 200, bestMatch | кэш тот же канон-ключ |

Соответствие записей проверено по реальным ответам search-API (kp соответствуют карточкам). Механизм SHAPE «одна canonical identity сквозь search→card→/videos» — **подтверждён**.

## E. Playback

**Не демонстрируемо сегодня — egress-блокер, НЕ дефект SHAPE.** Embed-хост `api.ortified.ws` возвращает **422 пустой** на каждый route (включая точные `iframe_url` карточек из search), тогда как search-API `api.bhcesh.me` — 200; альтернативные embed-хосты (`api.bhcesh.me/embed`, `apiconv.bhcesh.me/embed`) — 404 (embed там не живёт). Карточка честно `show:false` (host-block по HARD_REFUSAL), `/videos` несёт `provider_error {kind:'upstream-refusal', status:422}` — **не** замаскировано под EMPTY (удовлетворяет требованию 6). Рассинхрона «show:true → видео не найдено» в live больше нет: оба звена выдают один и тот же сигнал отказа по одному и тому же route.

## F. Регрессии

Полный suite из `server/`: **652/646/0/6** — чисто. Live: продакшен-здоров после инцидента (см. G2), остальные источники не затрагивались (изменения только в CollapsProvider + availability.present для collaps). Runtime других провайдеров не менялся.

## G. GAP-013 — результат реализации (2026-08-17)

GAP-013 получил реальную попытку исправления (пользовательская задача, не аудит).

**Реализовано (код):**
- `DEFAULT_EMBEDHOST` в `CollapsClient.js` и дефолт в `config.js`/`.env.example`: `api.ortified.ws → api.luxembd.ws` (актуальный Lampac master `Modules/OnlineRUS/Collaps/ModInit` conf.host). Env-оверрайд `COLLAPS_EMBED_HOST` уже работал и сохранён.
- `identityFromMatch`: убран pin `embedHost = originOf(iframe_url)` — Lampac `Invoke.Embed` берёт `conf.host` и игнорирует iframe_url; iframe_url поиска до сих пор указывает на вымерший ortified, пининг навсегда ломал бы будущий playback. Identity = kp→imdb→orid; host решает клиент/конфиг.
- Regression-тесты: +6 (`server/test/collaps-client.test.js` GB-1..6: дефолт luxembd, env-оверрайд, маршруты kp/imdb/orid, 422→upstream-refusal НЕ EMPTY, 404→invalid-route), COL-9/COL-11 переписаны. Suite **658/652/0/6**.
- Live (temp-VPS 3102, прод не тронут): Maniya-код EGRESS → `https://api.luxembd.ws/embed/kp/301`; card `show:false` + `/videos` `provider_error 422 upstream-refusal` согласованы. Прод health 200.

**Блокер ВНЕШНИЙ (доказан, workaround не выдуман):** `/embed/*` → `422 0b` (nginx, `Vary: *`) на **обоих** хостах (ortified и luxembd), с полным браузерным набором headers, curl и node, с VPS и с локального residential IP, `?token=` не помогает. `root /` = 200 с заглушкой `videostorage.xyz@protonmail.com` (throwaway-домены одного бэкенда). Search API (`api.bhcesh.me/list`) жив (200). Upstream закрыл embed-путь на стороне сервера; ни request shape, ни route, ни headers, ни endpoint решение не меняют. Рабочий reference (Lampac master) с того же кода упирается в тот же 422 — т.е. конфигурация Maniya теперь **паритетна** референсу. Если апстрим вернётся или переедет на новый host — потребуется только `COLLAPS_EMBED_HOST` на проде, без кода.

**Историческая заметка (прозрачность):** при первой сборке temp-стенда случился инцидент с портом 3000 (темп занял прод-порт; прод восстановлен systemd, health 200). Сегодняшние проверки подтвердили: прод-порт 3000 держит systemd `maniya-online` (Main PID 126183, health 200), temp живёт на 127.0.0.1:3102 — конфликтов нет.

---

**STOP выполнен**: commit/push/deploy не делались, новые аудиты не создавались. Файлы temp-стенда и probe-скрипты остались в `/tmp/` на VPS (по желанию можно удалить).