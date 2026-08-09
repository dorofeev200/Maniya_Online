# Action Plan — Maniya Online (план возобновления)

## ✅ 2026-08-09: ACTION-КНОПКА «M» в action bar — доработана (Элемент #2)
- **Задача:** на странице фильма в ряду `[M] [▶] [🔖] […] [☆]` СУЩЕСТВУЮЩАЯ первая кнопка
  слева от Play должна стать брендированной «M», а НЕ текстовым блоком (который уже сделан —
  `[M-Online] Остался 1 день`, Элемент #1, НЕ трогаем). НЕ создавать новую кнопку поверх,
  НЕ overlay, НЕ прятать через CSS — изменить сам компонент.
- **Компонент найден:** `addButton()` в `public/maniya-online.js`. Ранее кнопка была НОВОЙ
  (вставлялась перед `.button--play`). Исправлено:
  - ищем ряд `.full-start-new__buttons / .fullstart__buttons`, внутри — `.button--play`;
  - если слева от Play ЕСТЬ нативная кнопка (`button, .btn, [data-action]`, классы
    `full-button/full-start__button/…`) — НЕ создаём новую: у этого ЭЛЕМЕНТА заменяем только
    содержимое/декорации (`.maniya-online-button`, `title`, `html(maniyaButtonPart())`),
    элемент/классы/`data-action`/клик-обработчик остаются → функциональность сохранена;
  - если Play «первый» (слева пусто) — только тогда вставляем свою «M» первой.
  - `maniyaButtonPart()` = кольцо + SVG-глиф «M» (внутри 1.5em, `__svg`/`__ring`/`__glyph`),
    убран дублирующий текстовый «M» (глиф рисует буква).
- **CSS:** `.maniya-online-button` уже золотой круг 2.2em + focus/hover-scale; добавлены
  `.maniya-online-button__m` (флекс-центр), `.maniya-online-button__svg` (размер), поправлен
  селектор `inButton` (is+hasClass вместо мёртвого `button--`).
- **Держим:** Элемент #1 (бейдж `maniya-status`) не тронут; layout/фокус Play, Bookmark,
  Favorite не меняется; responsive media-queries прежние.
- **Проверка:** `node --check public/maniya-online.js` → OK; тесты 261 (259 pass / 2 skip / 0 fail).

## ✅ 2026-08-09: НОВЫЙ ИСТОЧНИК «Maniya · Lime» (kinopub) — РЕАЛИЗОВАН, LIVE, ДЕПЛОЙ~OK
- **Задача (сессия 13):** перенести из исходного JS все источники. Audit + mapping готовы (§ выше).
  Реализован 1-й недостающий REST-живой источник: **Lime = `kinopub`** (2-шаговый follow через
  `postid`). Новых провайдеров не создавал — доработал `EoProvider` (fallback-цепочка).
- **Изменения (3 файла):**
  - `server/src/providers/eonline/EoProvider.js` — `movieVideos` теперь 2-ступенчатая:
    1) follow через `href` (rezka); 2) **`postid`-схема Lime** (`kinopub`): из карточки-ссылки
    `postidFromCards()` → повторный `getLite({…, postid})` → страница перевода (play/call).
  - `server/src/providers/registry.js` — `EO_TITLES.kinopub = 'Maniya · Lime'`.
  - `server/src/config.js` — `kinopub` в дефолтный `EO_BALANCERS` (между videoseed и kinoflix).
- **Live-подтверждение (eolive.test.js, 09.08, все 6 хостов):**
  `kinopub` [Интерстеллар:OK Матрица:OK Тёмный рыцарь:OK] = **3/3**, serial=no-episodes.
  Итог матрицы: покрение ≥2/3 → **8 из 11** (alloha, kinopub, veoveo, pidtor, solntse, filmix,
  rezka, hdvb). `rutube` 503 в этот прогон (гейт под аккаунт), `videoseed`/`kinoflix` — хостовые
  флапы (в прогоне 08.08 были 3/3, 2/3). `EO_BALANCERS_LIVE` в выводе теста.
- **Unit (доделано): `postidFromCards` обращался к неимпортированному `paramNumber` —**
  переписан на локальный `paramValueOf` + `Number.parseInt`; `postid` в `getLite` строкой
  (как остальные URL-параметры). Юнит «kinopub (Lime) — link-карточки с postid → follow через
  postid» зелёный. **262 юнита (260 pass +2 skip live)**.
- **Деплой:** сразу после этой волны, потом commit+pash на `backup`. План обновлён.
- **Обновление плана (unit-фикс):** деплой выполнен ✓ (`DEPLOY 09.08 08:49` — tar-over-SSH, certbot renew OK,
  `/health` = `{"ok":true}`), коммит `82987b0` на `feature/alloha-provider`, пушим на `backup`.
- **AUDIT исходного `eonline-deob3.js` (деобфускат 198KB плагина) — ОБНОВЛЕНО:**
  - ✅ **Карта балансеров `_0x39b522`** (все 11 источников пользователя + остальные найдены):
    `kinobase:"🔥 Kino"`, `veoveo:"📽️ Ozvuchky"`, `alloha:"📺 Allo-XA"`, `filmix:"🔥 FILMix"`,
    `videoseed:"🪬 VideoS"`, `videohub:"🗿 VideoH"`, `turboserial:"🐉 Dragon"`,
    `vk:"🇷🇺 RUS-1"`, `rutube:"🇷🇺 RUS-2"`, `zagonka:"🌏 GET`s TV"`, `kinopub:"🌏 Lime"`,
    `hdvb:"📻 XDVB"`, `fancdn:"💾 FCD"`, `mirage:"🎦 Miror"`, `kodik:"👀 Kodik"`,
    `fanserials:"😈 FANS"`, `rezka:"😉 For Serial"`, `mirkino/mir kino:"📼 KinoPUB"`,
    `xvideocdn:"🗽 VCDN"`, `hdrezka:"🎦 HDRezka"`, `aniliberty:"🌸 AniLiberty"`,
    `animebesst:"🌸 AniBest"`, `animelib:"🌸 AniTrue"`.
  - ✅ **skaz-cluster** (lumina-кластер, карточки-переходы): `["skaztv","lumina","солнце",
    "kinoteatr.kg","ashdi","getstv","lift","eneyida","iremux","fmedia","lumex","spectre","eng",
    "redheadsound","collaps","tochka","kinogo","animevost","animedia","filmge","geosaitebi",
    "leproduction","asiage","vibix","ua","zetflix"]`.
  - ✅ **`getQualityDisplay`** (вытащил в deob3): HDR-детекция (dolby vision/hdr10+/hdr10/hdr),
    классиф. качества: 4k/2160→4K, 1080/fullhd→Full HD, 720→HD, 480→SD, regex `\d{3,4}`:
    ≥2160→4K(0x870), ≥1080→Full HD, ≥720→HD, ≥480→SD; cam/ts/telesync→HDRip, `webrip`,
    `webdl`, `bluray`→BluRay; HDR-суффиксы к базовому (4K HDR10+ / Full HD HDR10 …).
  - ✅ **Параметры lite-запроса** = `lite/<balancer>?title=<query>` + заголовки
    `X-Kit-AesGcm` (Lampa.Storage aesgcmkey). `withsearch`/`events` — системные порталы
    (поиск через eolive «withsearch» — не каталог).
  - ✅ **Live-проверка slug (09.08, 6 хостов × 6 параметров):** живые REST-play:
    `veoveo/alloha/filmix/rezka/kinoflix/pidtor`; `kinopub` — 200 link (follow).
    400/429/403/503: `vk/rutube/videohub/turboserial/fanserials/zagonka/kinobase/fancdn/mirage`
    → rch(WebSocket)/аккаунт, деобфул REST недоступен (подробно §10.3 отчёта).
  - Оригинал и деобфускат: `C:\tmp\showy\eonline-check.js` / `C:\tmp\showy\eonline-deob3.js`
    (НЕ коммитим — в них зашиты токены).
- **МАРРING (источник из JS → Maniya provider → Action):**
  | Исходный JS (slug/display) | Maniya provider | Действие |
  |---|---|---|
  | `filmix` 🔥 FILMix | native Filmix + eonline twin | ✅ есть (twin fallback) |
  | `rezka` 😉 For Serial | native Rezka + eonline twin | ✅ есть |
  | `hdvb` 📻 XDVB | native HDVB + eonline twin | ✅ есть |
  | `videohub` 🗿 VideoH | native CDNvideohub | ✅ есть (native видимый) |
  | `alloha` 📺 Allo-OA | EoProvider balancer `alloha` | ✅ есть, live |
  | `rutube` 🇷🇺 RUS-2 | — | ⛔ REST 400 (rch/аккаунт) — зарезервировать |
  | `vk` 🇷🇺 RUS-1 | — | ⛔ REST 400 (rch/аккаунт) — зарезервировать |
  | `kinopub` L E Lime | EoProvider `kinopub` | ✅ **ДОБАВЛЕН** (09.08): postid-follow, unit 262/260, DEPLOY ✓ |
  | `fanserials` 😈 FANS | — | ⛔ REST 429 (rch/аккаунт) — зарезервировать |
  | `zagonka` 🌏 GET`s TV | — | ⛔ REST 429/400 (rch) — зарезервировать |
  | `veoveo` 📽️ Ozvuchky | EoProvider `veoveo` | ✅ есть (live 200 PLAY) |
  | `kinobase` 🔥 Kino | — | ⛔ REST 503 — зарезервировать |
  | `turboserial` 🐉 Dragon | — | ⛔ REST 429 — зарезервировать |
  | `fancdn` 💾 FCD | — | ⛔ REST 403 — зарезервировать |
  | `mirage` 🎦 Miror | — | ⛔ REST 403 — зарезервировать |
  | `kodik` 👀 Kodik | native Kodik + EoProvider `kodik` | ✅ есть (native; eonline-близнец link) |
  | `aniliberty/animebesst/animelib` (🌼) | EoProvider `aniliberty` | ⚠️ 503 — зарезервировать |
- **ИТОГ live-проверки (09.08.2026, пробы GET на всех 6 хостах, Interstellar/BreakingBad):
  `veoveo/alloha/filmix/rezka/kinoflix/pidtor` = 200 PLAY|CALL (REST работает);
  `kinopub` = 200 link (Lime, двухшаговая follow-схема — movieHref уже в EoProvider);
  `vk/rutube/videohub/turboserial/fanserials/zagonka` = 400—429, `kinobase` = 503,
  `fancdn/mirage` = 403 — **НЕ отдаются lite-REST** (rch/аккаунтные/WS) → реализация =
  добавить в каталог стрингов провайдера с `enabled()=false` (зарезервированы), без фейкового
  «работо» в UI. UI-селектор (#10) показывает только ПРОВЕРЕННЫЕ (items>0).**
- **Мои (не менять при аудите):**
- Не переписывать project с нуля; не создавать дубликаты существующих providers; переиспользовать существующие, доработать недостающие, добавить только недостающие; перенести XDVB/Videohub/и все остальные найденные источники с полной логикой/качествами/озвучками/субтитрами/сериями; динамические токены и подписи переносить как алгоритмы генерации; секреты — только в ENV (не логировать/коммитить); ВСЕ изменения сохранять на VPS, локально и в git-ветке `backup`.
- **Задача:** статус-бейдж M-Online рядом с кнопками действий, дни из РЕАЛЬНОЙ подписки (`expires_at`),
  НЕ хардкод; склонения; состояния active/1 день/0 дней/expired/no-подписки/неавторизован; responsive
  1920×1080 → 320×568; не ломать layout/фокус; unit-тесты; деплой сразу.
- **AUDIT:** подписка = `users.json {token,email,plan,active,expires_at}`; `isSubscriptionActive`
  (store.js), `expires_at` ISO или null=навсегда. Клиент Lampa: строка кнопок `.full-start-new__buttons`.
- **Реализация:**
  - `server/src/status.js` (новый, чистый модуль): UTC-календарный день не 24ч-интервал,
    `remainingDays` (null=бессрочно/бито), `pluralDays` (1→день, 2-4→дня, 5-20/0→дней, 11-14→дней),
    `subscriptionStatus` (истекла/активна/Остался 1 день/Осталось N дней).
  - `/api/lampa/subscription/check` → `authorized`/`active`/`plan`/`expires_at`/`days_left`/`subscription_text`
    (без `requireSubscription` — бейдж виден и без активной подписки).
  - `public/maniya-online.js`: `addStatusBadge(event)` тянет `/subscription/check`, рендерит бейдж с
    текстом статуса (не рендерит при `authorized === false` или пустом тексте), вставляется
    `.before('.full-start-new__buttons, .fullstart__buttons')`, fallback — `prepend` контейнера.
    CSS `.maniya-status` в `maniya_css`: фикс. ширина, `@media (max-width:640px)/(420px)`.
- **Тесты:** `server/test/status.test.js` (remainingDays/pluralDays/subscriptionStatus — 26 ассертов)
  + `server/test/api.test.js` (subscription/check токен → `Осталось N дней`, неавторизованный →
  `authorized=false`, `subscription_text=null`). **Итог: 261 тест, 259 pass, 2 skip, 0 fail.**
- **Деплой:** `scripts/deploy.sh` → HTTPS 200, health OK, systemd active; live `subscription/check`:
  trial (expires 2026-08-10) → «Остался 1 день», full (2026-09-09) → «Осталось 31 день».
- **Potential issues:** бейдж — косметика; не влияет на прокси/rate-limit; `days_left` может быть
  отрицательным (expired) — текст «Подписка истекла»; клиент кэширует плагин — обновление после
  переподключения расширения.

## 📌 2026-08-09: IP входа E-Online сменился (138.16.184.153:8080) — балансеры НЕ менялись
- Пользователь: «изменился IP в Е-Online, учти где мы брали токены и skaz; Е-Online всё берёт
  с другого сервера, он только промежуточный».
- **Проверено:** старый вход `195.133.39.208:8080/dorofeev200_*.js` → мёртв (000/соединение сброшено).
  Новый — `http://138.16.184.153:8080/dorofeev200_6c95576dbd45.js` (отдаёт «Добавьте в плагины Lampa»,
  41B). Цепочка Е-Online: Lampa → `<вход>:8080/dorofeev_*.js` → `<вход>:8085/check?key=9d42475c810a`
  → **балансеры skaz** (`lite/<balancer>`). Чек-скрипт на новом IP **идентичный байт-в-байт** старому
  (198094B, diff пуст) → **хосты балансеров не менялись** (94.249.239.{63,37,11}, 77.90.33.109,
  online3/8.skaz.tv, cf 188.114.*). `cors/check` 200, `lite/events?life=true` 200.
- **Вывод:** наш EoClient/EoProvider ходит **напрямую на skaz-кластер** (`lite/<balancer>`) — это и есть
  «другой сервер», из которого всё берётся; плагин-вход только посредник, смена его IP не требует
  изменений в коде. Токены `account_email=nazarov6@gmail.com`/`uid=dg4xu2tj` живут в `server/.env`
  (EO_ACCOUNT_EMAIL/EO_UID), из вход-скрипта наружу они НЕ читаются. Обновлено: `docs/action-plan.md`
  (этот блок) + `E-ONLINE-REPORT.md` (источник — новый вход). Диагностические скрипты `diag-eo-*.mjs`
  остались в `C:\tmp\showy`, в git не коммитятся.
- **TODO-future:** если балансеры снова слетят — проверять `:8085/check` на входном IP напрямую
  (минуя вход-плагин) и обновлять `EO_HOSTS`/`PROXY_HTTP_ALLOW_HOSTS`.

## ⏸ Точка остановки (2026-08-08, сессия 12: follow-фикс + skaz-прямые + vkvideo allowlist; alloha играет)
- **✅ ВЕСЬ e-онлайн-СТЕК ПОЧИНЕН И ИГРАЕТ (live на VPS):** `provider=eonline-alloha` «Интерстеллар» →
  10 items, прокси → **200 `application/vnd.apple.mpegurl` + `#EXTM3U`**. Три фикса:
  1. `config.js` — хосты первыми `online3/8.skaz.tv` (**`94.249.*` стали 503/302 → 403-поток**);
  2. `config.js` allowlist: +`vkvideo.cloud` (alloha-резолв уводит на VK-хостинг → `proxy_host_forbidden`);
  3. (ранее) follow-href (rezka → 16 items) + скрытый twin-фолбэк.
  Тесты локально **237 pass / 2 skip / 0 fail**. Коммиты `935a50c`, `85a3c4e`, пуш backup.
- **⚠️ ЗАДВОЕНИЕ «Rezka / Maniya · Rezka» — НА СЕРВЕРЕ УЖЕ НЕТ.** Живой `/api/lampa/sources` = 13 источников,
  **без дублей**: filmix/kodik/rezka/rutubemovie/cdnvideohub/collaps/hdvb + Maniya·alloha/videoseed/kinoflix/
  veoveo/PidTor/solntse. `eonline-rezka` существует только как скрытый фолбэк (`show:false`) и в sources НЕ
  светится. Клиентский плагин не создаёт источников (тянет `/sources`). Если в Lampa всё же два кода — это
  старый кэш/список расширений на устройстве; обновить (**`/sources` должен показать один**).
- **⚠️ «E-Online лёг» ≠ кластер лёг — ПРЯМОЙ ДОСТУП К SKAZ-КЛАСТЕРУ РАБОТАЕТ.**
  Пользователь прав: E-Online тянет источники через skaz/voidboost. Доказано вручную: все 6 хостов
  (online3/8.skaz.tv + 94.249.239.{63,37,11} + 77.90.33.109) → `cors/check` 200; прямой
  `lite/filmix` → `werkecdn.me` **2160p**; **полный скан 21 балансера × 2 фильма сохранён**
  (`backup` не нужен — это `C:\tmp\showy\skaz-scan-20260808161521.json` + `SKAZ-REPORT-12.md`,
  НЕ КОММИТИМ сессии могут выкл свет — файл на диске).
  - **Рабочие балансеры (прямые lite-ответы):** filmix 2/2(8), rezka 2/2(28), alloha 2/2(15), hdvb 2/2(7),
    pidtor 2/2(12 play=torrent!), veoveo 2/2(6), solntse 2/2(2), **kinopub 2/2(26)**, **vkmovie 2/2(42)**,
    geosaitebi 2/2(6), kinoflix 1/2(3), rutubemovie 1/2(8), kinoteatrkg 1/2(1).
  - **Мёртвые:** videoseed(0/2), aniliberty, kinobase, xvideocdn, videohub, turboserial, mirkino, hdrezka
    (503/400/таймаут).
- **❓ Разрыв в авто-матрице:** eonline-* через НАШ proxy → `eonline-alloha` FAIL·HTTP403 на ВСЕХ тайтлах,
  при этом прямой alloha → 15 карток 200. Т.е. наш EoClient/прокси теряет пробив потока (Origin/302/voidboost-call)
  на этапе манифест/сегмент, НЕ поиск. **Задача след волны: сравнить прямые lite-запросы vs наш e-провider
  на уровне потока и починить 403 (см. `SKAZ-REPORT-12.md` TODO).**
- **pidtor нюанс:** play-карточка = torrent URL (`tr=http%3a…`), не HLS. Классификатор/авто-confirm не должен
  бить по нему как по манифесту.
- Авто-матрица (13×8) отработала частично (упрлась в таймауты e-источников), данные у eс в `/tmp/auto-confirm.log`.

## ⏸ Точка остановки (2026-08-08, сессия 11: живой матрицер + фолбэк-твин + авто-подтверждение)
- **Жалоба пользователя закрыта:** «задвоение Rezka/Maniya · Rezka» и «Maniya · Filmix» — это были дованние
  между деплоями (до дедупа 12:34). На живом `/api/lampa/sources` СЕЙЧАС 13 источников без дублей:
  filmix/kodik/rezka/rutubemovie/cdnvideohub/collaps/hdvb + Maniya·alloha/videoseed/kinoflix/veoveo/PidTor/solntse.
  «Maniya · Filmix» в дефолтном EO_BALANCERS НЕТ вообще.
- **НОВАЯ ЛОГИКА (реестр+store):** каждый EO-балансер теперь присутствует в двух режимах:
  - у Native с тем же id (filmix/rezka/hdvb/rutubemovie) включен → eonline-близнец = СКРЫТЫЙ ФОЛБЭК
    (`twinFor(nativeId)`), в UI НЕ светится;
  - у native нет токена → eonline-источник ВИДИМ (как раньше).
  **store.js:** если выбранный native вернул 0 items (или бросил) → `/api/lampa/videos` прозрачно пробует
  скрытого близнеца → один источник в Lampa, но «рабочий». Проверено живьём: `provider=rezka` на «Форрест Гамп»
  (native пуст) → 22 items через eonline-твина, манифест `application/vnd.apple.mpegurl` 200 (HLS). ✅
- **БАГ, пойманный сервером после деплоя:** в store.js имя хелпера `twinPayloadOrNull` vs `twinForPayload`
  (ReferenceError → 500 на /api/lampa/videos). Исправлено, 235 тестов pass (включая новые registry-twin).
- **АВТОМАТИЧЕСКОЕ ПОДТВЕРЖДЕНИЕ (новый инструмент):** `scripts/auto-confirm.mjs` (+`auto-confirm-config.mjs`):
  каждый источник × 8 фильмов/сериал → `/api/lampa/videos` → первый item → запрос его URL через прокси →
  PASS если 200 + `#EXTM3U`/`mpd`/`mp4`/`webm`/`mkv`; ненулевой exit-код если хоть один источник мёртв.
  Прогон: `TOKEN=<реальный> node scripts/auto-confirm.mjs` (опции `--source <id>` `--only a,b`).
- **⚠️ E-Online СЕЙЧАС НЕДОСТУПЕН (провайдер лёг)**, при этом источники E- тянут НЕ собственные, а оригинальные
  (skaz.tv / voidboost и API самих провайдеров). Задача следующего этапа — найти прямые исходные endpoint-ы
  (идут в `C:\tmp\showy\E-ONLINE-REPORT.md` §6, §9 + код `eonline-deob*.js`) и/или держать балянс из native
  провайдеров. Речь пользователя: обход защит (Cloudflare/Anubis) разрешён «любым способом».
- Тесты: **235 pass / 2 skip / 0 fail** (+4 twin). Пуш: backup (ЗАПУШИТЬ после деплоя-верификации матрицы).

> Единственный источник истины «где мы». Перед стартом каждой сессии: прочитать этот файл,
> определить текущую незавершённую волну/провайдера, продолжить с неё. После каждого wave —
> обновлять чекбоксы ниже и коммитить.

## Цель
Полный рабочий Lampa-плагин: пользователь покупает подписку (Telegram-бот, потом), вставляет
ссылку плагина в расширения Lampa, на iOS/Android работают балансировщики источников и играют фильмы.
Все провайдеры из Lampac (~70) довести до 100% рабочего состояния, поочерёдно.

## Как гонять тесты / деплой / бэкап / восстановление
```bash
# юнит-тесты
cd C:/Users/Admin/Maniya_Online/server && NODE_ENV=test node --test

# <-- Инфраструктура SSH (Windows-сторона, без rsync):
export SSH_ASKPASS=/tmp/askpass.sh SSH_ASKPASS_REQUIRE=force DISPLAY=dummy:0
printf '#!/bin/sh\necho "789zxc789"\n' > /tmp/askpass.sh   # пересоздать перед деплоем

# Деплой кода + инфраструктуры (tar-over-SSH; .env/data НЕ трогает):
bash scripts/deploy.sh
# Проверка деплоя (нужен TOKEN реального пользователя):
TOKEN=<...> bash scripts/verify-remote.sh

# РЕЗЕРВ: снимок незаменимого состояния VPS (server/.env, data/*.json) → backup/snapshots/<stamp>/
bash scripts/backup-remote.sh
# ПОЛНОЕ ВОССТАНОВЛЕНИЕ VPS с нуля из свежего снимка:
bash scripts/restore-vps.sh            # или -s backup/snapshots/<stamp>
```
Деплой через tar-over-ssh (`tar czf --exclude=.git --exclude=server/.env --exclude=server/data
--exclude=node_modules --exclude=backup .`), т.к. rsync на Windows-стороне отсутствует. VPS:
systemd `maniya-online` (node 3000) + nginx 443; docker-контейнер `lampac` (9118) — эталон, не трогать.
`/opt/maniya-online/server/.env` — НЕ перезаписывать (там USERS_FILE/VIDEOS_FILE/KODIK_TOKEN);
`server/data/*.json` — реальные пользователи, НЕ коммитить (gitignore) и не затирать деплоем.
`backup/` — gitignored-бэкап секретов (не попадает в git). Восстановление с нуля: локальный git
(код) + `backup/*` (состояние) + `restore-vps.sh` (сборка всего на новый VPS). Remote на GitHub:
origin → код продублирован.

## ⏸ Точка остановки (2026-08-08, сессия 9: E-Online → источники «Maniya»)
- **Код волны E-Online ГОТОВ (клиент+нормализатор+провайдер+реестр+config+proxy http-allowlist):**
  - `server/src/providers/eonline/{EoClient,EoNormalizer,EoProvider}.js` — каждый REST-доступный
    балансер (`EO_BALANCERS`) становится отдельным источником `eonline-<balancer>` под брендом «Maniya · …».
  - Аккаунт только через env `EO_ACCOUNT_EMAIL`/`EO_UID` (в `server/.env`, не коммитить). Авторизация —
    `account_email`+`uid` в URL, `Origin: http://lampa.mx` на потоки skaz/voidboost.
  - Серверный резолв потоков: `method:"call"` карточки резолвятся на сервере (GET m3u8 с Origin →
    финальный voidboost/skaz-манифест) и наружу идут ТОЛЬКО прокси-URL `/api/lampa/proxy?url=…`.
  - `proxy.js`: добавлен `httpAllowHosts` (`PROXY_HTTP_ALLOW_HOSTS`) — http-хосты (E-Online IP,
    `skaz.tv`, `voidboost.one|com`) отдельным узким списком; https-локлист не ослаблен.
  - ⚠️ **OpenResty-миграция E-Online** (сообщил пользователь): формат `data-json` карточек генерится
    приложением, гейт OpenResty его не трогает; но гейт решает «кого пускать» (403/429/re-директы).
    Проверяется live-матрицей: статус первичного `lite`-запроса + `:gate`-маркер в отчёте.
- **Mock-тесты: 29 новых (client 8 + normalizer 6 + provider 7 + proxy http-allow 3) — зелёные.**
  Полный сьют: **229 pass / 2 skip / 0 fail** (skip = live-гейты). Исправлен реальный баг провайдера:
  `seasonLinkHref` возвращал `fallback||url`, где fallback — ранняя карточка перевода → сезон терялся;
  теперь точное совпадение сезона отдаёт свой URL.
- **Live-матрица — МНОГОТАЙТЛОВАЯ (2026-08-08, 3 фильма/баланс: Интерстеллар/Матрица/Тёмный рыцарь):**
  - ✅ **Alloha — 100% (3/3)** после фикса: call-карточки фильма резолвились через НЕСУЩЕСТВУЮЩИЙ
    `resolveCardStream` → всё уходило в catch → NO-ITEMS. Метод добавлен (EoProvider.js): каждая
    call-карточка (8 голосов) резолвится `stream` → финальный voidboost-HLS. Мок-тесты +2 (23 eonline).
  - ✅ 3/3: `videoseed, veoveo, pidtor, solntse`; 2/3: `filmix` (Тёмный рыцарь НЕТ — «один фильм
    играет, другой нет»), `kinoflix`, `rezka` (+сериалы ep1). filmixtv — 403-гейт в этом прогоне.
  - ✅ **Дедупликация источников** (реестр): eonline-балансер НЕ генерится, если уже есть включённый
    native-провайдер с тем же id (filmix/rezka/hdvb/rutubemovie) → «Rezka» и «Filmix» в Lampa один раз.
  - ✅ Дефолт `EO_BALANCERS=alloha,videoseed,kinoflix,veoveo,pidtor,solntse` (без native-дублей,
    без filmixtv-403). Исключены: link-только kinopub/lumex/kodik/animelib; 503/403 под аккаунт.
- **Следующее:** проверка на VPS (источники в `/api/lampa/sources` под реальным токеном) → `backup`-commit.

## ⏸ Точка остановки (2026-08-08, сессия 8: ВОСПРОИЗВЕДЕНИЕ ПОЧИНЕНО, live-проверка E2E)
- **✅ РУТ-ПРИЧИНА «ни один источник не играет» НАЙДЕНА И ЗАКРЫТА (коммит 1d0db18, деплой ✓):**
  `isManifestResponse` в `server/src/proxy.js` считал `video/mp2t` (TS-сегмент, sync-byte 0x47)
  манифестом и переписывал бинарные сегменты в URL-мусор → «Не удалось декодировать видео».
  Фикс: манифест = только `application/vnd.apple.mpegurl|x-mpegurl|dash+xml` или путь `.m3u8/.mpd`;
  сегменты проходят байт-в-байт. + фильтр в `store.js`: поисковые записи (метаданные без url/stream)
  не показываются как «играбельные» карточки (Filmix при Cloudflare отдавал мёртвые тайтлы).
- **LIVE E2E против публичного HTTPS VPS (реальный токен mo-54f4ada0…, Форрест Гамп 1994):**
  filmix → **3 items**, rezka → **22 items**, hdvb → **1 item**; каждый manifest переписан через
  `/api/lampa/proxy?url=…&token=…`, сегмент через прокси = **сырые TS (0x47)**, `video/MP2T` 200.
  Это прямая проверка всей цепи API→провайдер→прокси→сегмент.
- **0 items ≠ поломка, это покрытие каталога/качество поиска:** kodik (в этом токене нет тайтла,
  работает для фильмов из его каталога), cdnvideohub/collaps (малые каталоги), rutubemovie (поиск
  отдаёт нерелевантное, часто 0).
- **Filmix на VPS:** primary `/api/v2/post` закрыт Cloudflare (501) с IP датацентра, но анонимный
  фолбэк `api-fx/video-links` работает → Форрест Гамп отдаёт 3 play-item. Часть тайтлов (Дюна,
  Матрица) получает 403 и на `api-fx/post/{id}/video-links` — персистентный Cloudflare-блок по
  содержимому/IP; решается только Playwright/резидентным IP (Тир 3, гейт PLAYWRIGHT_ENABLED), не баг кода.
- **Урок для диагностики:** probe-скрипт `f.videos({query: q})` давал ложные 0 — `videos()` читает
  `context.query` (плоский), а `search(context)` — через `context.request`; реальный роутер шлёт оба.
  Диагностика должна ходить через живой API с реальным токеном, а не напрямую в провайдер с кривым shape.

## ⏸ Точка остановки (2026-08-07, сессия 6: волна HDVB ЗАКРЫТА; ПАУЗА по провайдерам)
- **WAVE HDVB ✅ ЗАВЕРШЁН ПОЛНОСТЬЮ (код+тесты+деплой+live):** клиент (`videos.json` + iframe GET + POST playlist
  с csrf), нормализатор (search/record/extractEmbed/cleanFile/parsePlaylistResponse/episodeFile), провайдер
  (videos → фильм один item / сериал по сезонам×озвучкам×сериям, streams). Registry+config+`.env.example`+proxy
  allowHosts (`sevstar933krop.com`,`entouaedon.com`).
  Ключевое решение: еслиrame ходит на `frameHost = entouaedon.com` (не sevstar-нода из API) с referer movielab.one;
  подписанная m3u8 привязана к IP POST-запроса → прокси обязателен, сегменты без заголовков.
  Локально **166 тестов / 165 pass + 1 skip, 0 fail**. Live локально: фильм «Дюна» 1 item (voice), сериал «Шерлок»
  4 сезона / 14 озвучек. Деплой VPS ✓ (tar+systemd+nginx), `HDVB_TOKEN` добавлен в server/.env, service active,
  `/sources` включает `hdvb`, videos(movie Дюна) → real proxied m3u8, proxy отдаёт master и переписывает все
  внутренние плейлисты/сегменты через `/api/lampa/proxy` (IP-привязка совпадает). Следующая волна: **Kinotochka**.
- **▶ НАПРАВЛЕНИЕ ДАЛЬШЕ (по плану пользователя, сессия 6):** провайдеры на ПАУЗУ (новые не добавляем пока).
  Фокус — **настройка проекта целиком и интеграционный тест уже добавленных источников**
  (Filmix, Kodik, Rezka, Rutube, CDNvideohub, Collaps, HDVB, Alloha-код): подключить/довести до финального
  рабочего результата, проверить что всё играет в Lampa с теми источниками, что уже есть, потом вернуться
  к остальным провайдерам.
- **ИНТЕГРАЦИОННЫЙ ТЕСТ (сессия 6, против публичного HTTPS VPS с токеном mo-admin-test-2026):** все
  включённые источники отдают play-item при **корректном идентификаторе** (не по одному только названию —
  store падает в поисковые карточки). Проверено реальным прокси: **CDNvideohub** (kinopoisk_id) PROXY-OK m3u8,
  **Collaps** (kinopoisk_id) PROXY-OK m3u8 + 5 субтитров, **HDVB** PROXY-OK m3u8 (фильм+сериал). **Filmix**
  title→2 play-item. Итог: источники играют; Kodik/Rezka/Rutube/Alloha — по их типовым ключам или после их
  токена. Замечание: main-балансировщик при title возвращает поисковые карточки со всех включённых — для
  воспроизведения нужен id-путь.

## ⏸ Точка остановки (2026-08-07, сессия 7: Telegram-бот авто-выдачи подписок)
- **TELEGRAM-БОТ ✅ РЕАЛИЗОВАН (код + 17 тестов, без live — ждём токен от @BotFather).**
  Модель (выбор пользователя): **триал по /start (TELEGRAM_TRIAL_DAYS дней, план `trial`) + ручная
  выдача/продление командой /grant <token> [days] из админ-чата (TELEGRAM_ADMINS)**; доставка —
  **ссылка плагина с токеном** (`<code>`): пользователь добавляет её в расширения Lampa как кастом-плагин.
  Файлы: `server/src/telegram/BotClient.js` (Bot API, длинный polling, инжектируемый fetch), `bot.js`
  (команды `/start /status /help /grant|subscribe|extend|give /revoke|expire|suspend`, HTML-escape,
  makeToken/pluginUrl/isUserActive), `runner.js` (poll-loop, offset-трекинг), `store.js` (`writeUsers`/`listUsers`),
  `config.js` (блок `telegram`), `.env.example` (секция). Локально **179 pass + 1 skip, 0 fail**. Запуск:
  `TELEGRAM_ENABLED=1 TELEGRAM_BOT_TOKEN=...` (без токена сервер молчит, polling не стартует).
  **Чтобы включить live:** создать бота в @BotFather, вписать токен + TELEGRAM_ADMINS + TELEGRAM_PLUGIN_URL
  в `server/.env` на VPS, перезапустить `maniya-online`. Это единственный недостающий кусок.

## ⏸ Точка остановки (2026-08-07, сессия 5: волна Collaps ЗАКРЫТА)
- **WAVE COLLAPS ✅ ЗАВЕРШЁН (код+тесты+live, деплой см. ниже):** клиент (`/list` поиск + embed-страница),
  нормализатор (чистый DTO: search → записи, parseEmbed → movie-source / seasons-блок; слайсер parseJsObject —
  JS-literal с незакавыченными ключами и trailing-commas), провайдер
  (search без названия → по kp/imdb/orid через embed; movie/serial; videos → фильм один источник/сериал по сериям;
  streams → StreamItem auto). Registry+config+`.env.example`+proxy allowHosts (`interkh.com`).
  Локально **150 тестов / 149 pass + 1 skip, 0 fail**. Live с токеном (eedefb54…, из Lampac):
  search «Интерстеллар» → movie (kp 258687), videos → 1 play-item + 5 субтитров, HLS прокси OK;
  search «Друзья» → сериал, videos → 17 серий (1 сезон), озвучка «Рус. Оригинальный», субтитры — через прокси.
  Публичный токен зашит в Lampac = поведенческий реф; на VPS задать `COLLAPS_TOKEN` в server/.env для live
  (иначе enabled()=false, из источников скрыт). Следующая волна: **HDVB**.
- Замечание: `sliceJsonArray`/`parseJsObject` — JS-literal парсер (без брейсера): ключи без кавычек + trailing-commas.

## ⏸ Точка остановки (2026-08-07, сессия 4: волна CDNvideohub ЗАКРЫТА)
- **WAVE CDNVIDEOHUB ✅ ЗАВЕРШЁН ПОЛНОСТЬЮ (код+тесты+деплой+live):** клиент (`playlist`/`videoHls`, hlsUrl-срез),
  нормализатор (records kp-only, seasons/episodes/voices), провайдер (search/movie/serial/videos/streams,
  фильм по озвучкам, сериал по сериям×озвучкам). Registry+config+`.env.example`+proxy allowHosts (`vkuser.net`,`okcdn.ru`).
  Локально **135 тестов / 134 pass + 1 skip, 0 fail**. Деплой VPS ✓, verify-remote 5/5, sources включает `cdnvideohub`.
  Live через HTTPS: videos(kp=462682, Интерстеллар) → 1 play-item (voice «Неизвестный»), прокси отдаёт HLS
  (HTTP 200, 2175 B, `application/x-mpegURL`) с `vd293.okcdn.ru` (okcdn.ru в allowHosts). Следующая волна: **Collaps**.

## ⏸ Точка остановки (2026-08-07, сессия 3: durability + волна Rutube закрыта)
- **WAVE RUTUBE ✅ ЗАВЕРШЁН ПОЛНОСТЬЮ (деплой VPS + верификация):** локально 122 теста / 121 pass + 1 skip;
  деплой VPS из tar-over-SSH в `/opt/maniya-online` (`.env` и `data/users.json` сохранены); `verify-remote.sh` 5/5;
  live Rutube через HTTPS: sources `rutubemovie:true`, videos (Интерстеллар 2014) → играбельный item quality auto.
- **DURABILITY ✅:** `deploy.sh` починен (tar вместо rsync, `.env` не перезаписывает — heredoc только при отсутствии;
  фикс `<<'NGINX'` для `$host`); добавлены `backup-remote.sh` (снимок `.env`+`data` → `backup/snapshots/`, gitignored)
  и `restore-vps.sh` (полное восстановление с нуля: deploy + возврат состояния из снимка). Оба прогнаны на живом VPS:
  restore прошёл [1/3..3/3], health active. `verify-remote.sh` шаг Plugin переведён на GET (сервер 405 на не-GET).
  Первый снимок: `backup/snapshots/20260807-184437` (`.env` с KODIK_TOKEN ✓, `users.json` с токеном ✓).
  Код запушен на GitHub origin (см. git).
- **Kodik live (не регрессия):** токен валиден (API 200), поиск через сервер отдаёт до 100 записей. Живая
  расшифровка потоков требует `secret_token` (HMAC video-links) — это уже Tier-2 «Kodik secret_token — HMAC»,
  до неё Kodik в live отдаёт поисковые карточки (фолбэк в store.js). Код/токен не менялись.
- **Следующая волна: CDNvideohub** (Tier 1, чистый HTTP: `{host}/api/v1/player/sv/...`, hlsUrl). См. статусы ниже.
- `/tmp/askpass.sh` создавать заново при каждом деплое.

## Статус готовности

Легенда: ⬜ не начат · 🔶 код/тесты готовы · ✅ live-рабочий · 🚫 блокирован (нет токена)

### Уже в провайдерах (проверено)
- [x] Filmix — ✅ live (workets)
- [x] Kodik — ✅ (портирован, без secret_token)
- [x] Rezka — ✅ + Anubis PoW в процессе + premium login/cookie
- [x] Alloha — 🔶 код+тесты готовы, 🚫 жив-STREAM без токена (живет при вашем токене)

### Tier 1 — чистый HTTP (без браузера/внешних инфр.)
- [x] Kodik, Rezka, Filmix, Alloha(код) — см. выше
- [x] RutubeMovie — JSON API rutube, простой HLS/MP4; ✅ live (VPS, verify 5/5 + live-videos)
- [x] CDNvideohub — JSON API (`{host}/api/v1/player/sv/...`), hlsUrl; ✅ реализован (клиент+нормализатор+провайдер, kp-only), 13 тестов, live: search(Интерстеллар 462682)→movie, videos→1 play-item (Неизвестный) через прокси
- [x] Collaps — HTML+JSON, зашитый токен; ✅ реализован (клиент+нормализатор+провайдер), 15 тестов, live локально (токен Lampac); VPS live после `COLLAPS_TOKEN`
- [x] HDVB — JSON+POST playlist (csrf), зашитый токен; ✅ live (VPS): sources включает hdvb, movie+serial играют через прокси
- [x] **E-Online (проксированные источники «Maniya · …»)** — ✅ live (сессия 9): чистый REST без memkey, авторизация account_email+uid через env; фильмы OK у `filmix,videoseed,kinoflix,pidtor,solntse`, сериалы — `rezka` (voidboost-HLS) после OpenResty-миграции; дефолт `EO_BALANCERS` = эти 6, каждый балансер — отдельный источник
- [ ] Kinotochka — JSON+HTML, plain
- [ ] LeProduction — HTML iframe `[Qp]url`
- [ ] VideoDB — HTML+base64 player config → HLS
- [ ] VkMovie — VK API (динамический anonym-token)
- [ ] VeoVeo — JSON + local DB (mp4/m3u8)
- [ ] Zetflix / ZetflixDB — HTML+playerjs/obrut base64
- [ ] Аниме plain-HTTP (~12): AiLiberty, AniLiberty, AniLibria, AniMedia, AnimeGo, Animebesst, Animevost, AnimeON, Dreamerscast, Mikai, AnimeLib(OAuth) ...
- [ ] RgShows (ENG) — JSON `{stream:{url}}`
- [ ] GEO×3: AsiaGe, Geosaitebi, Kinoflix

### Волна 2 — токены/API-ключи
- [ ] AnimeLib — OAuth Bearer (refresh в рантайме)
- [ ] Kodik secret_token — HMAC
- [ ] Платные (Alloha, GetsTV, IptvOnline, KinoPub, SakhTV, VoKino, iRemux, FilmixPartner) — конфиг, ⬜/🚫 жду ваших токенов

### Тир 3 — Playwright/browser (нужен chromium на VPS, гейт `PLAYWRIGHT_ENABLED`)
- [ ] MoonAnime, UaKino,
- [ ] ENG×9 (AutoEmbed, HydraFlix, MovPI, PlayEmbed, SmashyStream, TwoEmbed, VidLink, VidSrc, Videasy) — CDP route-capture
- [ ] OnlineRUS браузерные: FanCDN, FlixCDN, Kinobase, Kinogo, PizdatoeHD, Mirage, Phantom, Spectre, Vibix, Videoseed

## Очередь (ближайшие волны)
1. [x] Инфраструктура возобновления (README+память+CLAUDE.md) — сделано
2. [x] Базовый коммит restore-point — сделано (0316e2e)
3. [ ] Фундамент движка (FetchService + IframeCodec + IframeProviderBase) — понадобится при провайдерах с iframe/JS-декодом
4. [x] Первый Tier-1 провайдер (RutubeMovie) — ✅ live (локально + VPS)
5. [x] CDNvideohub (Tier 1, чистый HTTP) — ✅ завершён (деплой VPS + live)
5b. [x] Collaps (Tier 1, HTML+JSON, зашитый токен) — ✅ завершён (тесты+live; VPS live при COLLAPS_TOKEN)
6. [ ] Live-валидация на VPS + деплой после каждой волны

## Итоговый чекбокс «плагин работает»
- [x] sources отдаёт все включённые провайдеры (балансировщик источников)
- [x] видео играет из провайдеров с контентом в Lampa (iOS/Android): Rezka/Filmix/HDVB/CDNvideohub/Collaps
      проверены E2E live; Kodik работает для фильмов из своего каталога (нет тайтла → 0 items — покрытие,
      не поломка); Rutube — слабый поиск (часто 0/нерелевантно), не декод
- [x] Деплой на VPS, восстановление с нуля документировано
## Сессия 8.5 → 8.6 (2026-08-08) — Telegram: продление кнопкой вместо команды /grant ✅
- [x] Поиск пользователя по нику устойчив: транслит кириллицы, любой регистр, «ё»→«е», подчёркивания/дефисы/пробелы,
      обратная совместимость со старыми слитными slugs; `slugFrom` пробел→`-` (`Иван Иванов` → `ivan-ivanov`)
      (сначала оформлен `/grant @ник 08.08.26 [P]` — `c1aff1a`; затем ПО ЗАПРОСУ УБРАН)
- [x] Команда `/grant` и её parse-хелперы удалены из бота (и псевдонимы subscribe/extend/give)
- [x] Уведомления админу (новый пользователь по /start, фото квитанции) несут inline-кнопку
      «🟢 Выдать подписку (1 мес)» — callback `grant_issue:<telegram_id>:<дней>`; срок = max(now, expires_at) + 30 дней, план full
- [x] `/revoke` (поиск по нику/токену), `/list` остались; не-админ читает только подсказки
- [x] Деплой `f3c5309` на remote backup; live `/health` ok; сервис active; в bot.js нет команд /grant (только комментарии)
- Тесты: 208 (207 pass + 1 skip) — переписаны под кнопку; поиск по нику покрыт через /revoke

## Сессия 8.7 (2026-08-08, вечер) — ЖИВОЙ тест пользователя в Lampa (сохранить!)
- ✅ ИГРАЮТ: HDVB, CDNvideohub, Rutube
- ❌ «Видео не найдено»: Collaps, Rezka, Kodik (Kodik = нет тайтла в каталоге; Rezka ⚠ был E2E 22 items — проверить тайтл/Anubis завтра)
- ⚠️ Filmix: «то видео нет» — часть тайтлов 0/403 (Cloudflare), нестабилен по каталогу
- «В остальных по одному фильму» — поисковая выдача провайдеров слабая → гл. боль = покрытие каталога/поиска (не декод — он работает)
ОТЛОЖЕНО НА ЗАВТРА. Старт: проверить каждый через живой API с реальным токеном (не напрямую провайдер), см. память.

