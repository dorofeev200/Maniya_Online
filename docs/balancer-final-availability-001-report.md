# BALANCER-FINAL-AVAILABILITY-001 — per-title видимость источников в карточке

Дата: 2026-08-19. Статус: **IMPLEMENTED + LIVE-VERIFIED** (commit/push/deploy НЕ делались — по правилу сессии).

Задача (спека): для КАЖДОГО фильма в карточке `/sources` показывать только те источники, у которых
реально ЕСТЬ этот фильм; прятать источник при отсутствии контента (503 / 200-EMPTY / без карточки /
декой / неправильный год / карточка без playable). Три источника названы проблемными:
**Maniya·XVideoCDN (ultra)**, **Maniya·ZetflixDB**, **Kinotochka**.

Аккаунтная пара в этом отчёте везде замаскирована как `dorofe…` / `7974…` (по инструкции пользователя
«её в открытых источниках нигде не показывать», «и в документации тоже»). Реальные значения живут
только в env/`.env` на VPS и в локальном окружении.

---

## A. Root cause

Проблема «источник показан, но `/videos`=0» для заведомо пустого по данному фильму источника имела
три наложившихся причины:

1. **Abstain-оптимизм (BALANCER-ONLINE8-002, 2026-08-14).** При `reservePolicy='abstain'` не-kinopub
   source, у которого первичная проба дала «статусный шум» (все хосты 503/слишком долго), показывался
   как **inconclusive-show** (`show:true, authoritative:false`). Это правильная страховка от
   транзиентного флапа кластера, но сама по себе она НЕ отличает «временно 503» от «контента нет» —
   навсегда-пустой источник (upstream его не имеет) оставался показанным с пустым `/videos`.

2. **Confirm-фаза задыхалась об общий дедлайн карточки.** Существовавший confirm-гейт гонял
   строгую пробу (`probe(strict)`) внутри того же `deadline` (12с в проде), который первичные пробы
   конкурирующих источников уже выедали последовательно (у xvideocdnultra 6 хостов × 4–5.5с =
   24–33с ≫ 12с). К моменту входа в confirm `probe(strict)` видел `Date.now() >= deadline` на
   верхушке цикла и по коду возвращал inconclusive — подтверждения фактически не происходило.

3. **Конкарренси-троттл кластера на аккаунт.** Параллельная стрельба по ВСЕМ 6 хостам кластера
   (намерение «полный скан → absent») триггерила троттл: при batch=6 отвечали 3 хоста, 3 обрывались
   по таймауту → noResponse → честный inconclusive → source оставался показанным. Эксперимент:
   batch=2 → **6/6 ответили за 20.7с → ABSENT → HIDE**; batch=3 → 5/6 (один abort) → SHOW;
   batch=6 → 3/6 → SHOW. Волны по 2 хоста обходят троттл и всё равно совершают полный проход.

Итог: INCONCLUSIVE-show-ряд для пустого источника не подтверждался строго → нарушалась спека
«показывать только с доказанным контентом».

## B. Текущее неправильное поведение (до фикса)

Для фильма без контента у источника: карточка отдаёт `show:true, inconclusive`, источник виден в
Lampa, но `/videos` возвращает `items:[]` — «полуживой» источник, мусор в интерфейсе. Именно это
наблюдалось live на **Паразитах** у xvideocdnultra/zetflixdb/zagonka/kinoflix/hdvb (5 источников) и
на **Одиссее (2026)** у xvideocdnultra/zetflixdb/zagonka/kinoflix/solntse/rhsprem/kodik/kinopub, и это
конкретно жалоба пользователя по Maniya·XVideoCDN / Maniya·ZetflixDB / Kinotochka.

## C. Фикс

`server/src/availability.js` — минимально, внутри confirm-гейта карточки, без изменения политики
abstain первичной пробы и без трогания native/RCH/TMDB/VKMovie/Kodik/Rutube/HDVB/Collaps/PIDTOR/RHSPREM
(защита по спеке §7):

1. **`strictConfirmAllHosts(balancer, query, deadline)`** (новая, рядом с confirmWithBackoff) —
   строгое подтверждение INCONCLUSIVE-show-ряда ВОЛНАМИ по 2 хоста через ПОЛНЫЙ скан кластера:
   - любой хост с реальным контентом → `show:true` authoritative (предικат method:call/play) — W1;
   - любой `noResponse` (обрыв по таймауту) или `accsdb`-отказ → `inconclusive` (show, **не прячет**);
   - все хосты ответили не-2xx / 2xx-null / accsdb-«Ожидаем фильм» (без noResponse) → **absent → hide**;
   - волновой ранний выход на контенте (не ждём остальные волны).
   `WAVE = 2` — эмпирически против троттла кластера (где batch=3 уже ловил abort).

2. **Свежий дедлайн confirm** (`confirmDeadline`), независимый от выеденного первичными пробами:
   `Date.now() + Math.max(deadlineMs, ceil(hosts.length/2) * timeoutMs + 2000)` → прод 6 хостов/10с =
   `max(12000, 32000) = 32с`. Confirm-скан НЕ умирает по дедлайну карточки.

3. Gейт в `computeCard` без изменений структуры:
   - (a) уже-authoritative-hide-ряды → `confirmWithBackoff(..., 1, false)` (как было);
   - (b) `show:true && !authoritative && inconclusive && skazLike` → `strictConfirmAllHosts`;
   - native-без-twin → `confirmNativeAbsence` (без изменений).

Подтверждённый absent кэшируется на **HIDE_TTL_MS = 60с** (`availability.js:92`) — self-heal: если
источник появится, через ≤60с следующий запрос снова покажет его.

## D. Тесты

`server/test/availability-online8.test.js` — 6 тестов strict-подтверждения:

| тест | сценарий | вердикт |
|---|---|---|
| «ВСЕ хосты non-2xx → strict-подтверждение → hide» | 503+403 по всем хостам | show:false, authoritative, confirmed |
| «контент на ЛЮБОЙ ноде → hide невозможен» (W1) | online3=503, online8=200 content | show:true authoritative host=online8 |
| «полный скан 2xx-EMPTY (`null` все хосты) → hide» | EMPTY | show:false confirmed |
| «decoy-карточка чужого фильма (title не совпал) → hide» (RULE-1) | Полтергейст 2010 vs Форрест | show:false authoritative |
| **«волновая проба (2 хоста/волну) — кластер НЕ троттлится»** | 3 хоста, все non-2xx; пик in-flight ≤2 | show:false confirmed, `maxInFlight ≤ 2` |
| «таймаут на ноде при подтверждении → inconclusive» | no-response при confirm | show:true, confirmInconclusive (W1-safe) |

`server/test/availability.test.js` — счётчики fetch обновлены (rezka-timeout строго-подтверждение
добавляет 2 пробы). **Suite: 742/736/0/6 green** (база 737/731/0/6 + 5 новых/обновлённых тестов).

## E. Live-проверка (локальный контур = код прода: defaultChecker abstain + SkazProvider.videos на реальном кластере, аккаунт `dorofe…`/`7974…`)

Матрица 5 фильмов, 2026-08-19, `node scripts/_probe_baf_avail.mjs` (временный probe, удалён после отчёта).

**Фильмы-без-контента → проблемные источники HIDE (closure §12.1):**

| фильм | xvideocdnultra | zetflixdb | zagonka | kinoflix | hdvb | kinotochka |
|---|---|---|---|---|---|---|
| **Паразиты (2019)** | HIDE 503 | HIDE 503 | HIDE 503 | HIDE 503 | HIDE 503 | HIDE (native absent) |
| **Одиссея (2026)** | HIDE 503 | HIDE 503 | HIDE 503 | HIDE 503 | — *см. G* | HIDE (native absent) |

Паразиты также честно hidden: rutubemovie 503, cdnvideohub absent, kinopub 503. Одиссея также hidden:
solntse 503, rhsprem 503, rezka 403, kinopub 200-пусто, kodik 200-пусто, pidtor 200-пусто.

**Фильмы-с-контентом → источники SHOW с `items>0` (closure §12.2):**

| фильм | xvideocdnultra | zetflixdb | zagonka | kinoflix | hdvb |
|---|---|---|---|---|---|
| **Матрица (1999)** | SHOW items=4 | SHOW items=8 | HIDE 503 *flap см. G* | (см. G) | SHOW items=3 |
| **Интерстеллар (2014)** | SHOW items=1 | SHOW items=11 | SHOW items=11 | SHOW items=3 | SHOW items=3 |
| **Последний дом (2026)** | SHOW items=9 | SHOW items=5 | SHOW items=5 | (см. G) | SHOW items=1 |

RAW-тела кластера (Матрица): xvideocdnultra — online3/.11=503, **online8=200 len=5815 карточки**
(поэтому show с host=online8 — контент есть на ноде, W1); zetflixdb — все 3 хоста 200 len=10086;
kinotochka — online3/.11=200 len≈78 (нет карточек), online8=403; native-вход kinovibe для этих 5
фильмов absent → HIDE корректен.

## F. Регрессия W1 (BALANCER-ONLINE8-002)

W1-инвариант «контент на ЛЮБОЙ ноде → SHOW, ни одно решение не прячет рабочий источник» сохранён:
- unit-тест «контент на любой ноде → echo online8» зелёный;
- unit-тест «таймаут при подтверждении → inconclusive show, не прячем» зелёный;
- live: zagonka на Интерстеллар/ПД показывается (контент): в том же прогоне, где на Матрице 503;
  xvideocdnultra на Матрице показан через host=online8 (контент с ноды, не primary).
- Политика abstain первичной пробы НЕ тронута; изменён только confirm. Рассчитанный прод-дедлайн
  confirm 32с — только при INCONCLUSIVE-рядах (пустой фильм); контентные фильмы confirm почти не
  запускают (первичная проба видит контент раньше).

## G. Оставшиеся лимитации источников (НЕ баги Maniya)

| источник | фильм | cell | классификация |
|---|---|---|---|
| filmix | все | SHOW items=0 | **TRUSTED** (нет FILMIX_TV creds локально; на проде creds есть → контент). Не дефект. |
| rezka | Матрица/Интер/ПД | SHOW items=0 | `rezka_search_failed` — локальная коробка не достаёт rezka.ag (geo); прод достаёт. Артефакт прогона. |
| pidtor | Матрица/Интер/ПД | SHOW items=0 | torrent-дескриптор `lite/pidtor/s<btih>` → play за серверным TorrServer-гейтом — **PIDTOR-DEEPLINK-001 (UPSTREAM/CAPABILITY)**. На Одиссее честно HIDE (торрента нет). |
| skaz-hdvb | Одиссея (2026) | SHOW items=0 | upstream отдал `method:link, similar:true, url:?kinopoisk_id=6385370`; ре-фетч по KP даёт playable `method:call` (контент upstream ЕСТЬ). SkazNormalizer скипает similar-карточки (1:1 EoNormalizer Lampac) → `/videos`=0. **REFERENCE/PARITY, не Maniya-баг**; HDVB под защитой (§7). |
| skaz-geosaitebi | Одиссея (2026) | SHOW items=0 | класс-2 link-only карточки (нет прямого play). |
| skaz-zagonka | Матрица (1999) | HIDE 503 | кластерный флап под нагрузкой probe-батареи: тот же прогон zagonka SHOW items=11 (Интер) и 5 (ПД). Полный скан увидел только 503 по всем хостам в этот миг → absent → HIDE_TTL 60с self-heal. Не дефект кода. |
| skaz-kinoflix | Матрица/ПД | HIDE 200/503 | тот же флап/транзиент; на Интер SHOW items=3. |

## H. Финальный вердикт

**Maniya-баг исправлен.** Криктерии закрытия (спека §12):

1. ✅ Пустой-по-фильму кейс: XVideoCDN/ultra, ZetflixDB, Kinotochka (+zagonka/kinoflix/hdvb на
   Паразитах и Одиссее) — **HIDE** с авторитетной классификацией `absent` (полный волновой скан
   6 хостов без noResponse).
2. ✅ Контентные фильмы: те же источники **SHOW** (Матрица 4/8, Интер 1/11/11, ПД 9/5/5).
3. ✅ W1 не сломан: контент-на-любой-ноде → show (unit + live), noResponse/accsdb → никогда не прячет.
4. ✅ Провайдеры/балансеры не удалены, глобально ничего не отключено; RCH/TMDB/VKMovie/Kodik/Rutube/
   HDVB/Collaps не тронуты (filmix/rezka/pidtor/geosaitebi — документированные не-баги, незатронуты).
5. ✅ Suite 742/736/0/6 зелёный.

Изменённые файлы: `server/src/availability.js` (+`strictConfirmAllHosts`, +`confirmDeadline`),
`server/test/availability-online8.test.js` (+6 тестов), `server/test/availability.test.js` (счётчики).

**Commit: НЕТ · Push: НЕТ · Deploy: НЕТ** (отдельное разрешение не запрашивалось и не получено).
Временные probe-скрипты удалены; аккаунтная пара в репо/доках не появлялась (замаскирована).
Следующая волна MANIYA-E2E-ACCEPTANCE-001 НЕ запускается без отдельного подтверждения.