# Action Plan — Maniya Online (план возобновления)

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
- **Live-матрица (`test/eolive.test.js`, гейт `EO_LIVE=1`) — ФИНАЛЬНЫЙ ПРОГОН (после OpenResty):**
  - ✅ **5 фильм-источников OK**: `filmix, videoseed, kinoflix, pidtor, solntse` — lite 200, items,
    поток резолвится, 200, играемый — `isPlayable()` (HLS-тело или медиа-тип).
  - ✅ rezka `serial=ep1` — сериалы s1e1 решаются до voidboost-HLS, 200 — **стрим-контур жив
    после OpenResty-миграции**; формат `data-json` карточек генерит приложение, гейт его не трогает.
  - ⚠️ hdvb/alloha/geosaitebi `lite=200 movie=NO-ITEMS` — по «Интерстеллар» контента нет
    (каталожное покрытие, не поломка). veoveo — `fetch failed` (сетевой обрыв; на VPS повторить).
  - ⚠️ kinoteatrkg/rutubemovie/vkmovie/aniliberty `lite=503` — «disable» под этот аккаунт.
- **Дефолт пересобран под live-зелёные**: `EO_BALANCERS=filmix,rezka,videoseed,kinoflix,pidtor,solntse`
  (config.js + корневой `.env.example`). Остальные остаются доступными через `EO_BALANCERS`.
- **Следующее:** деплой в `backup` → на VPS перепроверить eonline-источники с реальными токенами
  (сеть стабильнее — ждём не меньше 5 фильм-OK + rezka ep). Аккаунт — только в `server/.env` (не git).

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

