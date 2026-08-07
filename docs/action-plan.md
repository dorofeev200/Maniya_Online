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
- [ ] HDVB — JSON+POST playlist (csrf), зашитый токен
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
- [ ] sources отдаёт все включённые провайдеры (балансировщик источников)
- [ ] видео играет из каждого провайдера в Lampa (iOS/Android)
- [ ] Деплой на VPS, восстановление с нуля документировано