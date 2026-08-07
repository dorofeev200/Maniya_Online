# Action Plan — Maniya Online (план возобновления)

> Единственный источник истины «где мы». Перед стартом каждой сессии: прочитать этот файл,
> определить текущую незавершённую волну/провайдера, продолжить с неё. После каждого wave —
> обновлять чекбоксы ниже и коммитить.

## Цель
Полный рабочий Lampa-плагин: пользователь покупает подписку (Telegram-бот, потом), вставляет
ссылку плагина в расширения Lampa, на iOS/Android работают балансировщики источников и играют фильмы.
Все провайдеры из Lampac (~70) довести до 100% рабочего состояния, поочерёдно.

## Как гонять тесты / деплой
```bash
cd C:/Users/Admin/Maniya_Online/server && NODE_ENV=test node --test   # юнит-тесты
```
Деплой: SSH root@95.85.241.121 (пароль 789zxc789; неинтерактивный вход —
SSH_ASKPASS_REQUIRE=force с временным askpass-скриптом: `export SSH_ASKPASS=/tmp/askpass.sh
SSH_ASKPASS_REQUIRE=force DISPLAY=dummy:0`, скрипт печатает пароль). VPS: systemd `maniya-online`
(node 3000) + nginx 443; docker-контейнер `lampac` (9118) — эталон, не трогать. 
`/opt/maniya-online/server/.env` — НЕ перезаписывать (там USERS_FILE и реальные пользователи);
rsync исключает `.git`, `node_modules`, `.env`, `server/data`. Проверка: `scripts/verify-remote.sh`
(нужен `TOKEN` реального пользователя). Локальный git — источник истины для восстановления с нуля.

## ⏸ Точка остановки (2026-08-07, выключение ПК)
- Закоммичено `aa2a91b` (RutubeMovie ✅ live, e2e локально зелёный: 122 теста / 121 pass + 1 skip).
- **НЕ выполнено:** деплой волны Rutube на VPS (локальный e2e прошёл, на VPS код ещё старый —
  `git log -1` там без Rutube). Следующая сессия: `scripts/deploy.sh`-эквивалент (rsync + restart
  systemd, сохраняя `.env`/`data`), затем `verify-remote.sh` и live-проверка Rutube через VPS.
- Локально всё остановлено (node 3000/3100 не слушает); `/tmp/askpass.sh` создать заново при деплое.

## Статус готовности

Легенда: ⬜ не начат · 🔶 код/тесты готовы · ✅ live-рабочий · 🚫 блокирован (нет токена)

### Уже в провайдерах (проверено)
- [x] Filmix — ✅ live (workets)
- [x] Kodik — ✅ (портирован, без secret_token)
- [x] Rezka — ✅ + Anubis PoW в процессе + premium login/cookie
- [x] Alloha — 🔶 код+тесты готовы, 🚫 жив-STREAM без токена (живет при вашем токене)

### Tier 1 — чистый HTTP (без браузера/внешних инфр.)
- [x] Kodik, Rezka, Filmix, Alloha(код) — см. выше
- [x] RutubeMovie — JSON API rutube, простой HLS/MP4; ✅ live локально, ⏳ деплой на VPS не сделан
- [ ] CDNvideohub — JSON API (`{host}/api/v1/player/sv/...`), hlsUrl
- [ ] Collaps — HTML+JSON, зашитый токен, кастомный URL-кодировщик
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
4. [x] Первый Tier-1 провайдер (RutubeMovie) — ✅ live локально; ⏳ деплой VPS (первое действие след. сессии)
5. [ ] Дальше по очереди см. статусы выше (следующий: CDNvideohub)
6. [ ] Live-валидация на VPS + деплой после каждой волны

## Итоговый чекбокс «плагин работает»
- [ ] sources отдаёт все включённые провайдеры (балансировщик источников)
- [ ] видео играет из каждого провайдера в Lampa (iOS/Android)
- [ ] Деплой на VPS, восстановление с нуля документировано