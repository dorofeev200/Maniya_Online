# SKAZ-MANIYA-TASK-037 — DIRECT-FIRST PLAYBACK (staging-эксперимент)

**Дата:** 2026-08-23. **Среда:** STAGING 95.85.241.121 (+ код задеплоен, PROD байт-в-байт не тронут). **Статус:** ✅ staging-верификация завершена; ждёт реального Android-плейбэка.

## Что исправлено / сделано

1. **Механизм direct-first** (код существовал, собран ранее): `buildPlayUrl(context, url, extra)` в `server/src/proxy.js` —
   при `config.directPlayback.enabled` и https-хосте из `DIRECT_PLAYBACK_ALLOW_HOSTS` возвращает **исходный URL CDN**
   напрямую Lampa (без `/api/lampa/proxy`); иначе → `buildProxyUrl` (fallback-прокси). Все провайдеры
   (`Filmix/Skaz/Alloha/CDNvideohub/Collaps/Eo/HDVB/Kinotochka/Kodik/Rezka/Rutube/registry`) меняют
   `streamProxy = buildUrl` → `buildPlayUrl`. Конфиг `config.directPlayback` (config.js:290-299) по умолчанию
   **выключен** → PROD не модифицируется.
2. **proxy.test.js починен** (структурный баг: у GAP-012 403-теста не было закрывающего `});` → тесты
   SKAZ-MANIYA-008 §7 сидели вложенными в него). Добавлено 6 новых тестов buildPlayUrl (26/26 pass):
   flag-off→proxy; allowlist-https→raw; host-outside→proxy; http-scheme→proxy; suffix-маппинг
   (kvb.cool→direct, `kvb.cool.attacker.com`→proxy); non-URL→proxy.
3. **Suite:** `824/816/1/7` — единственный fail = пре-существующий `availability-route.test.js:41`
   («прочие native — show:true», падает и на чистом HEAD), 0 регрессий.
4. Задеплоено на STAGING (`bash scripts/deploy.sh`), fingerprint совпал после деплоя (локальный/remote
   отличаются только .env + CRLF). В `/opt/maniya-online/server/.env` включено:
   `DIRECT_PLAYBACK=true`, `DIRECT_PLAYBACK_ALLOW_HOSTS=cdntogo.net,ashdi.vip`, сервис перезапущен (active).
5. **Живая сверка** (ниже) подтвердила: /videos отдаёт сырой CDN-URL для allowlist-хостов и proxy-wrapped для всех остальных.

## Что реально проверено (ливым wire, STAGING)

Запросы: `GET http://95.85.241.121/api/lampa/videos?provider=skaz-<p>&token=<staging-token>&title=…&original_title=…&year=…&id=…[&serial=1]`.

### A. /videos переключение direct-first (главный критерий)

| Provider | Запрос | items | URL в items |
|---|---|---|---|
| skaz-kinopub | Форрест Гамп 1994 (movie) | 25 play | **DIRECT** `https://…ams-static-03.cdntogo.net/hls/…` |
| skaz-kinopub | Интерстеллар 2014 (movie) | 9 play | **DIRECT** `…ams-static-01.cdntogo.net/hls/…` |
| skaz-kinopub | House of the Dragon (serial=1, 3 сезона) | 10 play | **DIRECT** cdntogo.net (разные ноды) |
| skaz-kinopub | The Boys (serial=1, 5 сезонов) | 8 play | **DIRECT** `…ams-static-02/01.cdntogo.net/hls/…`, 5 voices |
| skaz-alloha | Мятеж 2025 (movie) | 7 call | `/api/lampa/video` (ленивый) → **proxy** (IP-gated CDN) |
| skaz-alloha | HOD / The Boys (serial) | 0 | честно пусто — кластер/каталог |
| filmix | Мятеж 2025 | 0 на этом прогоне | кластер-транзиент (403 обеими путями, дет. ниже) |

Прямой URL **именно CDN→клиент**: master/variant/сегменты девайсного клassфикатора отдаёт сам
cdntogo.net (CORS `*`), никакие запросы сегментов через 95.85.241.121 не идут.

### B. Host feasibility matrix (по каким источникам direct допустим)

Определялось прямым fetch'ем CDN с Range+Origin (мастер→вариант→сегмент), плюс через наш /proxy.

| Host (источник) | Direct-безопасность | Доказательство |
|---|---|---|
| **cdntogo.net** (KinoPub) | ✅ **DIRECT-SAFE** | master/variant 206, CORS `*`; сегменты АБСОЛЮТНЫЕ self-signed (без hash), 206 video/MP2T; расшифровка не нужна |
| **ashdi.vip** (skaz-ashdi) | ⚠️ кандидат — CORS ограничен | вариативные 206, сегменты 206, но CORS `https://ashdi.vip` (не `*`) → нужна девайс-проверка hls.js |
| **vkvideo.cloud** (Alloha) | ❌ IP-гейт | direct 403 c любой комбинацией UA/Origin/Referer; тот же URL через /proxy — 206 HLS → блокировка по региону IP |
| **api.rstprgapipt.com** (veoveo) | ❌ рутинг-нода | прямой fetch не отвечает |
| **sevstar933krop.com** (HDVB) | ❌ HTML-listing | direct 200 text/html (оглавление), не HLS |
| **cdnsqu.com / werkecdn** (filmix) | ❌ транзиент+hash | 403/206 чередуется по нодам (nl06 403, nl202 206) на том же хосте; HLS `?hash=` только на плейлисте → инheritBaseQuery через /proxy обязателен (SKAZ-MANIYA-008 §7) |
| **voidboost.one / skaz.tv / …** (rezka/lordfilm) | ❌ http-scheme | http → buildPlayUrl не прямой (только https) → авто-/proxy, как и раньше |

**Вывод:** в allowHosts staging включён единственный доказанно-безопасный хоst (`cdntogo.net`) + один
кандидат под проверку на девайсе (`ashdi.vip`, CORS-ограничение). Все остальные авто-fallback → `/api/lampa/proxy`
(сан-проверено: все не-allowlist источники остались proxy-wrapped).

### C. Скорость direct vs proxy (T036-style, Range `bytes=0-8388607` на сегменте, 3 раунда)

| Раунд | DIRECT cdntogo.net | PROXY через staging |
|---|---|---|
| 1 | 2.72 MB/s (3.33 MB / 1223 ms) | 2.95 MB/s (1129 ms) |
| 2 | 3.56 MB/s (933 ms) | 0.39 MB/s (8627 ms) |
| 3 | 2.53 MB/s (1312 ms) | 0.51 MB/s (6512 ms) |
| **mean** | **~2.94 MB/s (стабильно)** | **~1.28 MB/s (разброс 0.39–2.95)** |

Подтверждает T036: `/api/lampa/proxy` — узкое место egress (0.1–0.6 MB/s в горячей фазе). Direct держит
уровень прямого CDN (порядка MB/s), что и было критерием успеха эксперимента.

### D. Прочее
- **Сегменты kinopub** — абсолютные, самоподписанные: hls.js без /proxy резолвит их от базы манифеста.
- **Субтитры/чипы**: у kinopub items `subtitles: []` (нет ни EXT-X-MEDIA SUBTITLES в master, ни поля items) —
  upstream-факт, не регрессия T037. Загрузка субтитров через /proxy у других источников не менялась.
- **Голоса/сезоны** сериалов работают (HOD 13 voices / 3 seas, Boys 5 seas) — фильтр по `serial=1` обязателен
  (без него запрос сериала трактуется как фильм → честный пустой ответ).

## Влияние на PROD
**Ноль.** `DIRECT_PLAYBACK` отсутствует в PROD-.env → `config.directPlayback.enabled=false` → все
`buildPlayUrl` ведут себя как `buildProxyUrl` (покрыто тестами flag-off + байт-индентичность по
дизайну). Существующий PROD-playback не затронут. **PROD — HARD STOP, не трогался.**

## Что дальше
1. **Реальный Android/Lampa acceptance** (ДЕВАЙС) — единственный оставшийся шаг: Форрест Гамп / HOD →
   KinoPub → play; замерить старт, буфер, перемотку; отдельно проверить direct действительно идёт
   CDN→клиент (лог /proxy 95.85.241.121 без сегментных запросов) и что переход через /proxy происходит
   только для fallback-источников. Ashdi — проверить CORS на реальном hls.js (Origin навылет).
2. Если девайс подтвердит стабильность (= скорость порядка MB/s и стабильное воспроизведение) —
   подготовить механизм к PROD (добавить cdntogo.net в PROD-allowHosts отдельной командой).
3. Потенциальные улучшения (НЕ делать без запроса): auto-ping allowlist-хостов, fallback при повторном
   403 на сегменте, расширение allowHosts под ashdi после девайс-проверки.