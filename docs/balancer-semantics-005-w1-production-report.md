# BALANCER-SEMANTICS-005-W1 — PRODUCTION REPORT (commit → deploy → verify)

Дата: 2026-08-16 (ночь, по UTC +03 после 2026-08-15 20:43). Статус: **ВЫПОЛНЕН, production verification ПРОЙДЕНА, STOP**.
Основа: `docs/balancer-semantics-005-w1-release-gate.md` (verdict READY FOR RELEASE) → отдельное разрешение владельца → релиз.

## 0. Hash-цепочка релиза

| Шаг | Значение | Проверка |
|---|---|---|
| Commit (локальный) | `25582563b779fc0959d8ae97752be8cdc447715a` (`2558256`, ветка `gap-012-veoveo`) | 13 файлов, +1430/−82, только W1 |
| Backup push | `backup: refs/heads/gap-012-veoveo = 2558256…` (`e5561b7..2558256`) | `git ls-remote backup` |
| Backup default-branch | `feature/alloha-provider` = `d6c6365` (не двигался — пуш рабочей ветки, не default) | `git ls-remote --symref backup HEAD` |
| **origin** | `a4a214777cb9406f7bceb9fd5e5bdb547dd85c24` — **до и после** | `git ls-remote origin HEAD` дважды, идентично |
| Deploy | tar-over-ssh `scripts/deploy.sh` → `/opt/maniya-online`; `.env`/`data/` ИСКЛЮЧЕНЫ (не менялись) | systemd `ExecMainStartTimestamp=2026-08-15 20:43:42 UTC` |
| Deployed hash | sha256 6 W1-файлов = локальным (2142495c…/09dc0f10…/ae317839…/f7f1bd20…/7289b88a…/01aa1d9a…) | sha256sum через SSH, 6/6 идентично |

## 1. Pre-commit аудит

- Staged строго W1: 6 src (availability, index, store, SkazClient, SkazProvider, hostOrder) + 4 тест-файла (skaz-client, availability-w1, skaz-provider-w1, skaz-vs-eo-w1) + 3 W1-документа. НЕ включены: `api.test.js` (pre-existing склонение «дней»), README/docs пред. задач, SECURITY-001/002, все чужие отчёты/скрипты, `.env`/временные.
- `git diff --check` (working+staged): чисто. Secrets scan (staged diff + untracked кандидаты): 0 секретов (только плейсхолдеры `user@example.com`/`abc123` и пустой `token:''`).
- Suite: **611 tests / 605 pass / 6 skip / 0 fail** (идентично гейту).

## 2. Production service status (A)

- `/health` = **200** (internal 127.0.0.1 и public https).
- systemd `maniya-online`: **active**, `NRestarts=0` (repошло после всей верификационной нагрузки — не растёт).
- Journald с момента рестарта: `unhandledRejection`/crash = **0** (STABILITY-004 гвард `promise.catch(()=>{})` в проде).
- nginx: 5xx в окне верификации = **0**. Исторические `17:34:25` в error.log — pre-fix orphan-crash STABILITY-004 (до этого деплоя), не регрессия.

## 3. Sources identity (B)

- `/api/lampa/sources` = 200, **16 источников, дублей id = 0, дублей имён = 0**.
- `skaz-veoveo` **id сохранён** (identity), **«Ozvuchky» сохранён** как presentation-имя (VEO-015 не затронут).
- Состав: 9 `skaz-*` (alloha, videoseed, kinopub, kinoflix, veoveo, pidtor, solntse, geosaitebi, rhsprem) + native (filmix, kodik, rezka, rutubemovie, cdnvideohub, collaps, hdvb). Набор не изменился.

## 4. Cluster consistency (C) — LIVE SKAZ shadow на прод-коде (ВПС, боевой .env)

Shadow `balancer-semantics-005-w1-shadow.mjs` против **deployed** 2558256-кода (= sha-паритет §0). Окно 2026-08-15 ~20:48–20:57. Сводка по балансерам для 8 обязательных тайтлов:

| Тайтл | alloha | videoseed | kinopub | kinoflix | veoveo | pidtor | solntse | geosaitebi | rhsprem |
|---|---|---|---|---|---|---|---|---|---|
| **Одиссея 2026** | CONTENT n=4 | CONTENT n=5 | CLS-n=0 (hide) | EMPTY(same) | CONTENT n=1 | EMPTY(same) | EMPTY(same) | CLS-n=0 | EMPTY(same) |
| **Последний дом 2026** | CONTENT n=3 | EMPTY(same) | CLS-n=0 (hide) | CLS-n=0 | CONTENT n=4 | CONTENT n=8 | EMPTY(same) | CLS-n=0 | CONTENT n=2 |
| **Интерстеллар 2014** | CONTENT n=8 | CONTENT n=9 | **CONTENT n=9** | CONTENT n=3 | CONTENT n=1 | CONTENT n=9 | CONTENT n=1 | CONTENT n=1 | CONTENT n=10 |
| **Форрест Гамп 1994** | CONTENT n=4 | EMPTY(same) | **CONTENT n=25** | CONTENT n=3 | CONTENT n=1 | CONTENT n=8 | CONTENT n=1 | CONTENT n=1 | CONTENT n=22 |
| **Матрица 1999** | CONTENT n=7 | CONTENT n=16 | **CONTENT n=22** | EMPTY(same) | CONTENT n=1 | CONTENT n=3 | CONTENT n=1 | CONTENT n=1 | CONTENT n=18 |
| **Дюна 2 2024** | CONTENT n=11 | CONTENT n=16 | **CONTENT n=14** | CONTENT n=2 | CONTENT n=1 | CONTENT n=47 | CONTENT n=1 | CONTENT n=1 | CONTENT n=11 |
| **Скайуокер 2019** | CONTENT n=3 | CONTENT n=3 | EMPTY(same) | CONTENT n=2 | CONTENT n=1 | CONTENT n=6 | EMPTY(same) | CLS-n=0 | CONTENT n=5 |
| **Паразиты 2019** | CONTENT n=1 | CONTENT n=6 | **EMPTY(same)** | EMPTY(same) | CONTENT n=1 | CONTENT n=3 | CONTENT n=1 | CONTENT n=1 | CONTENT n=11 |

Классы: **CONTENT** = NEW items > 0 (существующий контент идёт клиенту); **EMPTY(same)** = все 6 нод zonder контента (503/403/429), OLD и NEW согласованы 0; **CLS-NOW-EMPTY** = страница usable (isUsablePage), но 0 playable-кард — установленный артефакт парсера (одинаково до/после W1), не регрессия.

- Доп. тайтлы вне матрицы: Дом Дракона (kinopub CONTENT n=10, alloha n=10, veoveo n=10), Аватар (kinopub n=7, alloha n=5).
- **`B→A` live не воспроизвёлся (B-CASES=0)**: во всех 10 тайтлах × 9 балансеров строк с OLD=EMPTY + NEW=CONTENT нет (первая нода online3 live продуктивна; где кластер «нет» — честно 0 в обеих версиях). Маркер `CLASS=B→A!!` в выводе shadow — динамический флаг (fix=... при `oldFinal==='EMPTY' && items>0`), в этом проде НЕ сработал ни разу; финальная строка «run complete — CLASS=B→A!! …» — статическая подпись пробы, не результат.
- Прод-карточка API (`/api/lampa/sources/card`): Форрест/kinopub = show:true (elapsed 3.4 s), Паразиты/kinopub = show:false (elapsed 12.0 s — полный 6-нодовый скан, кино-пуб легаси-правило). Живое подтверждение консистентности с матрицей shadow.

## 5. Pin / fallback (C-продolate)

- **Пин записывается** на authoritative FOUND и читается `/videos` preferred-first: Форрест/kinopub pin=`online3.skaz.tv` (25 items), Форрест/alloha pin=`online3.skaz.tv` (4), Форрест/veoveo pin=`online3.skaz.tv` (1), Одиссея/alloha pin=`94.249.239.37` (4 items). Без пина и с пином счётчики равны (nopin=pin) — пин не снижает доступность.
- **Не-authoritative ряды пина не получают**: ДД/kinopub show=true auth=false inconclusive=true → pin=none → ротация даёт 10 items.
- **Fallback pinned-A→B в live окне не триггерился** (пин-нода отвечает; B-CASES=0). Механизм доказан CONTROLLED (`scripts/w1-release-gate.mjs`, 11 сценариев/27 asserts/0): пин → 200-empty/timeout/500 → фактическая ротация `h1#bal → h2#bal` → CONTENT.
- Trusted/accsdb ряд: filmix `show/auth/trusted=true`, host=∅ (пин не пишется — по коду, только `!trusted`); проверено live.

## 6. Критическая семантика (D) — split LIVE / CONTROLLED

| № | Случай | LIVE (прод-код, реальный кластер) | CONTROLLED (гейт-харнесс, mock) | Итог для прод-поведения |
|---|---|---|---|---|
| 1 | A=200-empty, B=CONTENT → fat content | не встретился (B-CASES=0) | `h1(non-usable) > h2` items=1, card FOUND+pin=pin h2 | клиент контент → FOUND |
| 2 | A=timeout, B=CONTENT | не встретился | `h1(timeout) > h2` items=1 | FOUND |
| 3 | A=500, B=CONTENT | не встретился | `h1(500) > h2` items=1 | FOUND |
| 4 | все 503/timeout → INCONCLUSIVE/UNABLE, НЕ EMPTY/hide | **kinoflix/Паразиты: 6 нод 503/403/429 → CARD show (не-auth, вclusive) + videos=0** (абстин-балансер); kinopub (легаси-исключение) — hide по дизайну | card `show/auth:false/inconclusive`, videos `lastScan {nonContent:0,noResponse:3}` = UNABLE | не-kinopub держится видимым, videos UNABLE — не авторитетный EMPTY |
| 5 | все authoritative EMPTY → EMPTY/hide | **pidtor/Одиссея, rhsprem/Одиссея: hide* (auth)** при all-«нет» | all-200-non-content → hide/auth=true | единственный путь к hide — content-«нет» всех нод |
| 6 | pinned A fails → fallback B | не триггерился (пин жив) | 3 варианта ротации с фактическими попытками нод | fallback работает |

## 7. Playback (E) — изолированные свежие пробы на прод-коде (вне матричного burst)

| Таргет | Метод → резолв | HLS-цепочка | Вердикт |
|---|---|---|---|
| **Kinopub** / Форрест | play → `resolveStream RESOLVED` | master 206 (1 вар) → variant 206 (14 сегм) → segment 206 | **PLAY OK (video+audio)** |
| **Alloha** / Форрест | call → `resolveVideoJson=play` → RESOLVED | master 206 (1 вар) → variant 206 (112 сегм) → segment 206 | **PLAY OK** |
| **VeoVeo/Ozvuchky** / Форрест | play → RESOLVED | master 206 (**2 вар.** мульти-аудио, VEO-015) → variant 206 (47 сегм) → segment 206 | **PLAY OK** |
| **Native Rezka** / ДД (serial) | items=10, поток → **403** (104 B); ajax 503×2 | — | точный state: upstream-блок (Anubis), провайдер вне W1-диффа; НЕ регрессия |
| Kinopub / ДД (serial) | item0 `method=link` (голос) | — | serial-структура (сезоны/озвучки), не дефект |

- HLS-проба выполнялась с `Range: bytes=0-4095` → **206** на master/variant/segment (удовлетворяет и MP4-style-паттерн Range→206 для CC-сегментов; MP4-формат-записи встречены).
- В **полной матрице** Форрест/kinopub `resolveStream→NULL` (burst-эффект: после ~300 строк нагрузка => кластер придушил дет); в **изолированной** свежепробке — RESOLVED с полной цепочкой. Диагноз зафиксирован: burst-насыщение, не дефект W1.

## 8. Одиссея — «Бросьте вызов богам» (G): полная цепочка, LIVE

1. **Skaz cluster**: alloha/videoseed/veoveo — CONTENT-страницы; kinopub/geosaitebi/pidtor/rhsprem/solntse/kinoflix — 503/пусто; kinopub — usable page c 0 playable-кард.
2. **Availability**: alloha `show=true, auth=true, host=94.249.239.37`; veoveo `show=true, auth=true`; videoseed `show=true, auth=false, inconclusive`; kinopub `show=false, auth=true` (авторитетный EMPTY).
3. **Selected/pin**: alloha → pin=`94.249.239.37` (только authoritative-FOUND пишутся).
4. **/videos**: alloha → «Одиссея» 4 playable карты (pinned preferred-first); videoseed 5; veoveo 1. kinopub → карта скрыта → клиент не дёргает.
5. **Playback**: alloha item0 (translate «LE-Vitation») call→play→`RESOLVED`→HLS master 206→**variant 206 (112 сегментов)**→segment 206.

**Вывод по G: Skaz ИМЕЕТ CONTENT на кластере (alloha/videoseed/veoveo), и Maniya (W1) ЕГО ПОЛУЧАЕТ И ИГРАЕТ (полная цепочка 206). RELEASE BLOCKER отсутствует.** Kinopub для Одиссеи — CLS-артефакт (usable страница, 0 playable-кард), карта авторитетно скрыта, поведение идентично pre-W1 (OLD тоже 0); это не «Skaz-имеет-B,а-Maniya-EMPTY».

## 9. Regression (F)

| Область | Проверка | Результат |
|---|---|---|
| Полный suite (все 11 регционов) | `NODE_ENV=test node --test` | 611/605/0/6 |
| Deployed parity | sha256 6 W1-файлов = локальным | 6/6 |
| GAP-002 host-block | availability.js 403/422/451-логика не менялась; unit-тесты зелёные; live online8 rows не-«нет» | OK |
| GAP-005 compound title | classifyLinkCard вне W1-диффа; unit-тесты | OK |
| VEO-015 | SkazProvider/normalizer title-пути вне W1 (git show подтвердил); live veoveo master с 2 audio-вариантами | OK |
| STABILITY-004 orphan | `promise.catch(()=>{})` (availability.js:462) в развёрнутом коде; journald 0 crash | OK |
| Trusted Filmix | live: `filmix show=true auth=true trusted=true host=∅` (пин не пишется на trusted) | OK |
| Three-state model / OLD∩NEW | live CARD: show/FOUND, show+inconclusive (kinoflix/kodik/videoseed rows), hide+auth-empty (pidtor/rhsprem/kinopub) | OK |
| HIDE_TTL | hide-ряды пишутся с HIDE_TTL (код 1044-1065); unit-тесты W1 (5c TTL deleted-on-read) | OK |
| Single-flight (STABILITY-003) | store.js не менял ключ; unit-тесты; live проксирует | OK |
| online8 abstain | live: kinoflix/Паразиты show@online8 при 503/403 кластере (не голосует «нет»), kinopub-исключение по дизайну | OK |
| Provider id/display-name separation | /sources: skaz-veoveo id, «Ozvuchky» name, нет дублей; EO_TITLES вне W1 | OK |

## 10. FP/FN до → после

- **Паразиты/kinopub (бывший FP картины аудита §CLUSTER-MISMATCH)**: до W1 — карта show:true при /videos EMPTY (расхождение host-выбора). После W1 в проде: **карта hide (авторитетный) И /videos 0 — согласованы**; кластер целиком 503/без контента (обе версии честно 0). Расхождений show↔items живых в окне **0** (FP=0, FN=0).
- Гейт-таблица states (CONTROLLED) воспроизводит все 5 итогов для гарантии, что FP/FN-механизм не вернулся.

## 11. Известные ограничения (без регрессий)

1. **B→A live по-прежнему 0 в окне** (предусловие «старт-нода 2xx-non-usable при контенте позже» не встретилось): алгоритм доказан только CONTROLLED-гейтом (9 сценариев) + юнитам (28 тестов W1). Не выдаётся за live-факт.
2. **Native Rezka** (extern «For Serial»): ajax 503 / поток 403 (Anubis) — pre-existing Rezka состояние (RezkaCodec phase-1), W1 не трогает провайдер. skaz-rezka выключен в конфиге (не светится).
3. **CLS-артефакт** (usable page, 0 playable-кард): kinopub/Одиссея, kinopub/Последний дом, kinoflix/Последний дом, geosaitebi/Одиссея, geosaitebi/Скайуокер, rhsprem/ДД, pidtor/ДД, videoseed/ДД — УСТАНОВЛЕН до W1, поведение идентично; отдельная задача вне W1.
4. **Burst-насыщение кластера** при стендовом параллелизме (Форрест resolve NULL в полной матрице; кад 12 s) — не дефект; изолированные пробы стабильны.
5. `origin` (github.com/dorofeev200/Maniya_Online.git) не трогался (hash подтверждён до/после).

## 12. Artifacts / cleanup

- VPS: `/tmp/w1-prod-shadow-20260815.log`, пробники (w1-playback-probe, w1-odyssey-chain, w1-prod-sources) — **удалены**. Стендов-каталогов нет. Локальные копии логов — в `AppData\Local\Temp` (без секретов: маски/длина).
- Код/тесты/деплой-скрипт после выполнения не изменялись.

## 13. VERDICT

**RELEASE ВЫПОЛНЕН И PRODUCTION-VERIFIED.** Все блоки A–H закрыты; гейт-verdict подтверждён продуктионом. Единственные не-закрытые пункты — известные ограничения (§11), вне W1 и вне обязательств этого релиза.

**STOP — следующая задача (W2/GAP-013/COLLAPS-*/прочее) НЕ начиналась, НЕ будет начата автоматически.**