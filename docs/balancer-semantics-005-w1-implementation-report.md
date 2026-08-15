# BALANCER-SEMANTICS-005-W1 — IMPLEMENTATION REPORT (CLUSTER CONSISTENCY)

Дата: 2026-08-15. Статус: **IMPLEMENTED + VERIFIED, НЕ закоммичено/не задеплоено** — жду отдельного разрешения на release.
Ответвление: отчёт дизайна `docs/balancer-semantics-005-w1-design.md`, аудит `docs/balancer-semantics-005-report.md`.

## 1. Суть

W1 делает независимость **availability-карточки** и **SkazClient `/videos`** в выборе ноды кластера skaz:

1. **Единый порядок** `orderedSkazHosts` (primary-first, online8-last) для обоих (было: карточка = reorderHosts, клиент = сырой `config.skaz.hosts`, где online8 ВТОРОЙ).
2. **Continue-скан** в `getLite`/`openLiteUrl`: N-й хост пула кандидат; контент → стоп; 2xx-non-usable → продолжать; 5xx/timeout → продолжать; accsdb → стоп + `provider_error`; **EMPTY только если ВСЕ ноды дали «нет»** (было: первый 2xx = финал, FAIL-NOT-RETRY).
3. **Пин «карточка → /videos»**: authoritative FOUND несёт `row.host`; `/videos`/`/video` пробуют его первым; провал → ротация по остальным; TTL зеркалит кэш-запись; uid-скоуп.

## 2. Файлы (exact diff)

| Файл | Изменение |
|---|---|
| `server/src/providers/skaz/hostOrder.js` | **НОВЫЙ**. `isReserveHost(host)` (host содержит `online8`), `orderedSkazHosts(hosts)`. Нейтральный модуль, без импортов. |
| `server/src/providers/skaz/SkazClient.js` | `hosts = orderedSkazHosts(...)` в конструкторе; новый `getLite` → `buildLiteUrl(params,{pinnedHost})` → `_scanLite(this._liteTargets(url, pinnedHost))`; `openLiteUrl(url,{pinnedHost})` аналогично; `_scanLite` (continue-scan, lastScan, accsdb-stop, «Ожидаем фильм» = continue); `_liteTargets` (пул, each-once, старт с пина/pool-индекса или 0); `_poolIndex`; `buildLiteUrl` инкремент `_hostIndex` ТОЛЬКО без пина (`if (!extra.pinnedHost) this._hostIndex += 1;`); exported `isAwaitingFilmAccsdb`. `fetch`/`resolveStream`/`resolveVideoJson`/`fetchHosts`/`discover`/`STATUS_REST` НЕ тронуты. |
| `server/src/providers/skaz/SkazProvider.js` | `pinFromContext(requestContext)` из `requestContext.query?.host`; проброс `{ pinnedHost }` во все `getLite`/`openLiteUrl` (movie: `movieVideos`, `collectMovieCards` ×3, `_cachedCollectMovieCards`; serial: `serialVideos`, `_cachedOpenSeasonPage`, `openSeasonPage`; `resolveVideo`); `buildPageParams` whitelist {id, imdb_id, kinopoisk_id, title, original_title, serial, year, source} — host структурно исключён; nav-cache ключи НЕ изменены (без host). |
| `server/src/availability.js` | import `{ orderedSkazHosts, isReserveHost }`; локальный `reorderHosts` удалён; probe использует `orderedSkazHosts`; `pinMap` в замыкании checker'а; запись/удаление пина в `card()` рядом с `cache.set` (только authoritative show + host + !trusted + !accsdb); exported `pinnedHost(providerId, userUid)` (read + delete-on-expiry); export `{ card, checkBalancer, confirmAbsence, checkSearchPredicate, pinnedHost }`. Вердикты/ tri-state / confirm-логика / reservePolicy НЕ изменены. |
| `server/src/index.js` | `/api/lampa/videos` и `/api/lampa/video`: `context.userUid = sha256Hex(user.token).slice(0,16)` (сквозной доступ к uid). |
| `server/src/store.js` | import `{ defaultChecker }`; `withPinnedHost(context, providerId)` → `query.host` per-provider; применено в `payloadOrNull`, `twinForPayload`, `getVideoForRequest`. No-circular (registry не импортирует store/availability). |
| `server/test/skaz-client.test.js` | 1 старый тест FAIL-NOT-RETRY (rch 200 no-rotation) замещён на 10 W1: continue-scan/EMPTY; UNABLE (noResponse); pin-start; pin-fail-rotation→content; pin-not-in-pool→ignore; accsdb-stop; accsdb-«Ожидаем»-continue; openLiteUrl-pin. |
| `server/test/availability-w1.test.js` | **НОВЫЙ**, 8 тестов (order-parity ×3; pin-write/uid; pin-absent-recompute-clears; trusted-no-pin; accsdb-no-pin; uid-независимость). |
| `server/test/skaz-provider-w1.test.js` | **НОВЫЙ**, 9 тестов (pin-start movie + no-host + whitespace; serial pin через openLiteUrl/openSeasonPage; reverse реальный клиент: pin-fail → ротация → content; accsdb stop + provider_error; buildResolveUrl no-host-leak). |
| `server/test/skaz-vs-eo-w1.test.js` | **НОВЫЙ**, 2 теста (FOUND-паритет EoClient==SkazClient; 2xx-non-usable → намеренное расхождение: Eo null vs Skaz HTML). |
| `scripts/balancer-semantics-005-w1-shadow.mjs` | **НОВЫЙ** (shadow, staged на VPS, удалён). |
| `scripts/w1-bhunt.mjs` | **НОВЫЙ** (B-hunter, staged на VPS, удалён). |

## 3. Тесты

- Полный прогон: `cd server && NODE_ENV=test node --test` → **611 tests / 605 pass / 6 skip / 0 fail** (6 skip — pre-existing).
- 14 обязательных пунктов дизайна §6 → все покрыты и зелёные (см. файлы выше).

## 4. Шэдоу OLD vs NEW (live, staged на VPS с боевым .env, 2026-08-15)

**10 тайтлов**: Одиссея, Последний дом, Интерстеллар, Форрест Гамп, Матрица, Дюна 2, Скайуокер, Паразиты, Дом Дракона (serial), Аватар × 14 skaz-балансеров + collaps. userUid из боевого юзера.

Ключевые строки матрицы (полный лог в чате; здесь выжимка):

| Кейс | OLDv (pre-W1 клиент) | NEWv (nopin / pin) | CLASS |
|---|---|---|---|
| Интерстеллар/kinopub | `online3:timeout > online8:CONTENT/200` | nopin=9, pin=- (карта show@online8, не-authoritative→без пина) | CONTENT — **живой кросс-нодовый обход, оба клиента сошлись** |
| Форрест Гамп/kinopub | `online3:CONTENT/200` | nopin=25, pin=25 | CONTENT — flapless |
| Паразиты/kinopub | EMPTY (503 **все 6 нод**) | nopin=0, pin=- | EMPTY **в обеих** (карта hide*, легитимно) |
| Скайуокер/kinopub | EMPTY (503 везде) | 0 | EMPTY (consistent absent) |
| Дом Дракона/kinopub | CONTENT | nopin=10, pin=- | CONTENT |
| Одиссея/pidtor | `online3:EMPTY-2xx/200` → EMPTY | 0 | EMPTY (genuine; online3 «нет источников») |
| Дом Дракона/videoseed (serial) | CONTENT | nopin=10, pin=10 (свежие провайдеры) | CONTENT, пин не ломает сериал |
| kinoflix/solntse (все тайтлы) | EMPTY (online8:403 / 503 по кластеру) | 0 | EMPTY **в обеих**; карта hide*→show — **это ONLINE8-002 abstain-дельта (уже прод), НЕ W1** |

Примечания к маркировке «CONTENT-OLD-NOW-EMPTY» в выводе шэдоу: это артефакт классификатора — OLDv CONTENT = страница usable (есть `isUsablePage`), но парсер даёт 0 playable-кард ⇒ **обе** версии дают items=0. Регрессии нет (клиенты читают одну и ту же страницу).

### 4.1 B-hunter (поиск живого B-кейса)

27 пар (3 тайтла × 9 балансеров) понодовым сканом: **B-CASES: 0**. В живом окне контент у всех продуктивных балансеров лежит на online3 (первая нода пула) → OLD и NEW достают его одинаково; там, где контента нет — кластер 503/403 везде → OLD и NEW одинаково EMPTY. Предусловие B (старт-нода 2xx-non-usable при контенте ПОЗЖЕ) в окне не воспроизвелось — в т.ч. kinopub/Паразиты сейчас 503-кластерно (обе версии «нет» — честно).

### 4.2 Итог по обязательному пункту «Паразиты/kinopub B→A»

Конкретный live-кейс **не воспроизведён**: в окне шэдоу kinopub/Паразиты отдаёт 503 на ВСЕХ 6 нодах — контента нет физически, карта обоснованно hide в обеих версиях, /videos EMPTY в обеих. Фикс механизма (если на старт-ноде 2xx-non-usable, а контент есть позже — NEW продолжит обход) доказан:
- юнит-тестами §6 (reverse pin-fail→ротация→content; 2xx-non-usable→Eo null vs Skaz HTML; continue-скан);
- живым кросс-нодовым случаем Интерстеллар/kinopub (timeout online3 → контент online8, NEW nopin=9);
- плейбеком Форрест/kinopub после резолва кластера (см. §6).

## 5. Пин — жизненный цикл

- **Запись**: в `card()` при authoritative FOUND (`show===true && authoritative && host && !trusted && !accsdb`) рядом с `cache.set`; ключ `userUid|providerId`; `ttl = hasConfirmedHide ? HIDE_TTL_MS(60s) : ttlMs(5min)` — зеркалит TTL кэш-записи.
- **Чтение, провал ротации**: `/videos` и `/video` через `store.withPinnedHost` подставляют `query.host` per-provider; `SkazClient._liteTargets` стартует с pool-индекса пина, но **как кандидат, а не жёсткий приказ**: нода пина вернула пусто → скан продолжается по остатку пула (каждая нода ровно раз).
- **Инвалидация**: протухший пин (read-expiry в `pinnedHost`) больше не блокирует ротацию; любой не-FOUND вердикт при рекомпуте удаляет пин; `force`-рекомпут тоже.
- **Uid-скоуп**: `pinMap` ключуется `userUid|providerId` — разные устройства не мешают друг другу (тест §6.4).
- **Trusted/accsdb** пина не дают (фильм/фильмх/резка-тв не пинится).

## 6. Плейбек после резолва кластера (E)

Форрест Гамп/skaz-kinopub, пин=online3 (из карты):
1. pinned `getLite` → play-карта `translate="Многоголосый (Позитив…"`.
2. `resolveStream` → **RESOLVED**.
3. Манифест по финальному URL с `Origin: http://lampa.mx` → **status=200, len=689, m3u8=true**.

## 7. Регрессии (F)

| Область | Проверка | Результат |
|---|---|---|
| GAP-005 compound title | тесты классификации не тронуты, suite зелёный; код `classifyLinkCard` не менялся | OK |
| VeoVeo/Ozvuchky | display-name/EO_TITLES/нормализатор НЕ менялись (подтверждено diff-ом), ВОЛНА-015 прод-тайтлы интактны | OK |
| Collaps (отдельный native) | карты: `hide` в обеих версиях; код Collaps-провайдера не тронут | OK |
| GAP-002 host-block | `orderedSkazHosts` сохраняет первичность/резервность; клиент и карта теперь ОДИН порядок | OK |
| STABILITY-004 orphan | `availability.js:467` `.catch(()=>{})` не тронут; suite + process-тесты зелёные | OK |
| filmix trusted | TRUSTED_ALWAYS_VISIBLE не тронут; trusted-ряд пина не даёт (тест §6.3) | OK |
| Три-стейт availability (AVAILABLE/UNAVAILABLE/INCONCLUSIVE) | логика не менялась; suite-тесты стабильности зелёные | OK |

## 8. Identity ≠ presentation (подтверждение)

Провайдер id (`skaz-<slug>`), `row.balancer`, `row.id` — НЕ изменены. Названия/EO_TITLES/метки качества — НЕ изменены. Пин живёт ТОЛЬКО в `query.host` (серверный per-provider), наружу клиенту НЕ уходит: `buildPageParams`-whitelist структурно исключает host (тест §6.12 no-host-leak), buildResolveUrl использует whitelist + token.

## 9. Известные ограничения

1. **B→A для kinopub/Паразиты live не зафиксирован** в окне 2026-08-15 (кластер 503-везде) — см. §4.2. Механизм покрыт тестами и кросс-нодовым кейсом.
2. В шэдоу (при параллельном фоне сотен запросов) наблюдался burst-артефакт «nopin=0/pin=10» у videoseed/ДД; на свежих изолированных провайдерах **10/10** — это насыщение кластера (важно: старт/ротация у без-пин вызова сдвигается на `_hostIndex`), НЕ дефект W1.
3. `lastScan.total` = размер пула (а не число реально посещённых нод) при CONTENT-возврате — для диагностики; EMPTY-семантика корректна (`nonContent==total`).
4. Пин подпирается, но НЕ клеится: если у пользователя `row.host` протух/сменился, первый бес-пин калл заново найдёт актуальную ноду.

## 10. STOP. Релиз — только по отдельному разрешению.

Ничего не закоммичено/не запушено/не задеплоено. Шэдоу-стенды на VPS удалены (включая копии .env). Локальные отчёты-логи шэдоу сохранены (без секретов).