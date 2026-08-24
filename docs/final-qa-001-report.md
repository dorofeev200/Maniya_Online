# FINAL-QA-001 — Полный read-only аудит Maniya Online

**Дата:** 2026-08-19
**Метод:** READ-ONLY. Код/тесты/config не менялись, commit/push/deploy НЕ выполнялись.
**Созданный артефакт:** только этот отчёт.

## Резюме

Полный аудит 15 областей выполнен по исходникам (`server/src`, ~14.6K строк) + полной карте тестов (50 файлов) + скану TODO/FIXME/dead-code. Закрытые волны (W1/балансер, RCH, TMDB, VKMovie, Rutube, HDVB, Kodik AMS, Collaps, PIDTOR, RHSPREM, FINAL playback gaps) не ре-флагаются — новых доказательств дефектов в них нет.

**Найдено 2 реальных MANIYA-бага (оба однострочные) + 4 LOW-класса чистки. CRITICAL/MEDIUM = 0. UPSTREAM/ACCOUNT/FALSE-POSITIVE = 0.**

---

## Счётчики

| Категория | Количество |
|---|---|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 0 |
| LOW | 5 |
| UPSTREAM LIMITATION | 0 |
| ACCOUNT/ACCESS DEPENDENT | 0 |
| FALSE POSITIVE | 0 |

---

## Находки (AUDIT-XXX)

### AUDIT-001 — HIGH — AllohaClient.streams(): обращение к несуществующей переменной `directors` (ReferenceError)

- **File:** `server/src/providers/alloha/AllohaClient.js`
- **Location:** строка 123 (сигнатура метода — строка 112)
- **Problem:** `directors_cut: directors ? 'true' : undefined` ссылается на необъявленную переменную `directors`; параметр метода называется `directorsCut`. В ESM (строгий режим) это выбрасывает `ReferenceError` на каждом вызове `streams()` с валидным токеном. Параметр `directorsCut` при этом не используется вообще (мёртв).
- **Expected:** `directors_cut: directorsCut ? 'true' : undefined`.
- **Root cause:** опечатка/расхождение имени переменной (`directorsCut` → `directors`).
- **Impact:** нативный провайдер Alloha полностью нефункционален при включении (токен задан). Ошибка тихо гасится `try/catch` в `AllohaProvider.videos()` → провайдер светится в `/sources`, но всегда отдаёт пустые `items`. Краша/500 нет (прямой путь `/api/lampa/stream?provider=alloha` выходит раньше на гарде `!item.token && !item.id`).
- **Evidence:** `AllohaClient.js:112` — `async streams({ …, directorsCut = false, ip = … } = {})`; `AllohaClient.js:123` — `directors_cut: directors ? 'true' : undefined`. Корроборация: реальный `AllohaClient` не покрыт тестами вообще (`alloha-provider.test.js` использует только `FakeAllohaClient`), поэтому дефект невидим для сьюта.
- **Classification:** MANIYA BUG.
- **Recommended fix:** однострочная замена `directors` → `directorsCut`.

### AUDIT-002 — LOW — SkazRchClient._executePushed(): User-Agent = функция вместо строки

- **File:** `server/src/providers/skaz/SkazRchClient.js`
- **Location:** строка 379
- **Problem:** `requestHeaders['user-agent'] = defaultUserAgent;` присваивает ссылку на функцию `defaultUserAgent` (без вызова `()`). При передаче в `fetch` заголовок коэрсится в строку — в User-Agent уезжает исходник функции, а не браузерный UA.
- **Expected:** `requestHeaders['user-agent'] = defaultUserAgent();`.
- **Root cause:** пропущенные скобки вызова.
- **Impact:** RCH-режим `rchtype === 'apk'` шлёт битый User-Agent на pushed-запрос; кластер может отклонить/некорректно обработать запрос. Узкий путь (только apk-RCH), деградация косметическая/функциональная, не security.
- **Evidence:** `UserAgent.js:6` экспортирует функцию; все прочие использования в коде — `defaultUserAgent()` (tmdbProxy, CDNvideohub, HDVB, Kinotochka). Единственное `= defaultUserAgent` без вызова — `SkazRchClient.js:379`.
- **Classification:** MANIYA BUG.
- **Recommended fix:** однострочная замена `defaultUserAgent` → `defaultUserAgent()`.

### AUDIT-003 — LOW — Мёртвый код (модули/экспорты без единого импорта)

- **File / Location:**
  - `server/src/providers/manager.js` — весь модуль (`ProviderManager` :17, `toApiItem` :55, `providerManager` :56). Импортируется только самим собой.
  - `server/src/providers/lampac/LampacProvider.js` — весь модуль (:21, default :103). Ноль ссылок, ноль тестов.
  - `server/src/providers/base.js:132` — `BaseProvider` (alias) — ноль ссылок.
  - `server/src/providers/base.js:111/122` — `isStreamItem`/`assertStreamItems` — импортируются только мёртвым `manager.js` (плюс один тест для `assertStreamItems`).
  - `server/src/providers/shared/utils/UserAgent.js:10` — `randomUserAgent()` — ноль ссылок.
  - `server/src/providers/shared/utils/Headers.js:11` — `withReferer()` — ноль ссылок.
  - `server/src/config.js:297` — `isProduction()` — ноль ссылок.
  - `server/src/providers/test/TestProvider.js` — ноль ссылок.
- **Impact:** нет runtime-эффекта; раздувание поверхности и ложная карта «живых» API. `assertStreamItems`/`isStreamItem` — единственная содержательная логика, которую выпилить без потерь.
- **Classification:** DEAD CODE (не баг, LOW).
- **Recommended fix:** удалить при следующей чистке (НЕ в рамках read-only).

### AUDIT-004 — LOW — Неиспользуемые config-ключи (тихие no-op)

- **File:** `server/src/config.js`
- **Location / Problem:**
  - `:189` блок `eonline.*` — не читается в `server/src` (только `eolive.test.js` и `scripts/*.mjs`).
  - `:231` `skaz.enabled` — не читается; реальный переключатель — `skaz.checkEnabled`.
  - `:104–105` `filmix.host` / `filmix.tvHost` — не читаются: `registry.js:47` передаёт только `token`, `FilmixClient` использует хардкод-дефолты. **Пользовательский `FILMIX_HOST`/`FILMIX_TV_HOST` в env молча игнорируется.**
  - `:98` `telegram.maxTrialChats` — не читается: лимит выдачи триалов НЕ enforced (`bot.js` /start выдаёт триал без ограничения).
  - `:57` `env` — читается только мёртвым `isProduction()`.
- **Impact:** самая содержательная часть — `maxTrialChats` (объявленный лимит против триал-абуза бездействует) и `FILMIX_HOST` (обещанный mirror-оверрайд игнорируется). Остальное — косметика.
- **Classification:** конфиг-тупики (LOW).
- **Recommended fix:** либо завести чтение (`maxTrialChats`, `filmix.host/tvHost`), либо убрать ключи.

### AUDIT-005 — LOW — Критические пути без выделенных тестов

- **File / Location:** `server/src/http.js`, `server/src/security.js` + клиенты ниже.
- **Problem:** нет unit-тестов на `http.js` (все 6 функций — только e2e через api/plugin-install/shortlink); нет unit-тестов на `security.js` вообще, а `assertRateLimit`-путь 429 ни разу не упражняется (интеграция ставит `RATE_LIMIT_MAX=1000`). Реальные `AllohaClient`/`AllohaNormalizer`/`KodikNormalizer`/`RutubeClient`/`CDNvideohubClient` — только через fakes (именно это скрыло AUDIT-001). `LanguageNormalizer`/`VoiceNormalizer`, `shared/http/*`, `shared/streams/*`, `shared/utils/*`, `proxy.tokenFromRequest`, `store.writeUsers/listUsers` — без прямых тестов.
- **Impact:** нет product-дефекта; пропуски в покрытии, позволившие AUDIT-001 просуществовать незамеченным.
- **Classification:** test-coverage gap (LOW, информационная).
- **Recommended fix:** приоритет — добавить тест на `AllohaClient.streams()` (см. AUDIT-001) и на `security.assertRateLimit` 429.

### AUDIT-006 — LOW — Непортабельная фикстура теста

- **File:** `server/test/skaz-normalizer.test.js`
- **Problem:** читает фикстуры по абсолютному внешнему пути `C:/tmp/showy/` — тест падает на машине без этих файлов (не самодостаточен, в отличие от фикстур `server/test/fixtures/`).
- **Classification:** test-hygiene (LOW).
- **Recommended fix:** перенести фикстуры под `server/test/fixtures/`.

---

## Подтверждённо НЕ баги (для полноты, не флагируются)

- **`eonline/*`** (`EoProvider/EoClient/EoNormalizer`) — намеренно оставлены для live-сравнения (документировано `registry.js:110`; используются `scripts/e2e-*.mjs` и `server/test/eonline-*.test.js`). Продакшн использует `SkazProvider`.
- **`shared/quality.js`** (`normalizeQuality`/`sortStreamsByQuality`) — используется `KodikNormalizer`; дублирует семантику `shared/normalize/QualityNormalizer.js` (Filmix), но доказанного бага нет → не рефакторинг.
- **`providerById` ищет только видимые провайдеры** — корректно: скрытые skaz-близнецы резолвятся через `/api/lampa/video`, а не `/stream`.
- **TODO/FIXME/HACK-маркеры** — 0 совпадений по `server/src` и `public/` (все case-insensitive хиты — легитимные: `PLUGIN_STUB_TEXT`, `placeholderOrigin`, regex-комментарии).

---

## Статус 15 областей аудита

1. **Архитектура/server-флоу** — OK. Единая точка входа, типизированные маршруты, shutdown, `NODE_ENV=test` гейт `listen`.
2. **Реестр провайдеров + реализации** — OK. native/skaz-близнецы, `twinFor`, единый `meta.js`.
3. **Полный флоу search→card→sources→availability→videos→resolve→playback** — OK (наивный-first + twin-fallback, ленивый `method:"call"`).
4. **Нормализаторы** — OK (title/year/quality/voice/season/episode/subtitle).
5. **Fallback/reserve-потоки** — OK (`reservePolicy:'abstain'`, Rezka cdnStreams-fallback, Filmix api-fx→v2).
6. **Заголовки/cookies/request-context** — OK.
7. **Таймауты/ретраи/ошибки** — OK (HttpError, RetryPolicy, RateLimiter, классификация collaps-отказов).
8. **Кэш + конкурентность** — OK (single-flight, 5-мин TTL, episodes-кэш Rezka, identity-кэш Collaps).
9. **Балансер + per-title availability** — OK (strictConfirmAllHosts, confirmDeadline, pin по userUid).
10. **Безопасность** — OK. SSRF: proxy allowHosts + re-валидация redirect, TMDB exact-host, RCH DNS-rebinding+private-block; HMAC-путь плагина, secrets только через env.
11. **Производительность горячих путей** — OK (кэш навигации, ограничение страниц поиска MAX_PAGES, abstain-резерв).
12. **TODO/FIXME/dead code** — см. AUDIT-003/AUDIT-004.
13. **Тестовое покрытие критических путей** — см. AUDIT-005/AUDIT-006.
14. **Диффы от эталона Lampac** — OK (совместимое поведение: FilmixTV auth, Kodik AMS/decode, Rezka Anubis, HDVB signed-playlist).
15. **Незавершённые реализации/прод-гэпы** — закрытые волны подтверждены; новых гэпов не выявлено.

---

## BLOCKING / NON-BLOCKING

**BLOCKING:** нет (CRITICAL/MEDIUM в активном наборе провайдеров не найдено).

**NON-BLOCKING (рекомендуется исправить до расширения):**
- AUDIT-001 (HIGH, 1 строка) — **must-fix перед включением нативного Alloha** (пока Alloha без токена — провайдер скрыт, влияние нулевое).
- AUDIT-002 (LOW, 1 строка) — User-Agent RCH apk-режима.
- AUDIT-003…AUDIT-006 (LOW) — чистка/покрытие/фикстура.

---

## FINAL AUDIT VERDICT

**NEEDS FIXES** — но мягкое: блокирующих дефектов нет. Единственный обязательный фикс — **AUDIT-001** (однострочный, латентный, активируется только при задании токена нативного Alloha); **AUDIT-002** — второй однострочный should-fix. Всё остальное — LOW-чистки и расширение тестов. Секьюрити-слой (proxy/TMDB/RCH SSRF, HMAC-путь плагина, secrets в env) проверен и не содержит дефектов; все ранее закрытые волны — чисты.

После исправления AUDIT-001 + AUDIT-002 сьюта и прод-гейт можно считать PASS без оговорок.
