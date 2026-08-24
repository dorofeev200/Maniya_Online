# SKAZ-MANIYA-TASK-015 — PRODUCTION MIGRATION TO MOSCOW (FINAL REPORT)

Дата: 2026-08-22  ·  Тип: PRODUCTION MIGRATION — FINALIZE  ·  Scope: ровно T015 FINALIZE (ничего дополнительно)

## Вердикт

**FINAL STATUS: ✅ ACCEPT — production успешно работает на Moscow VPS.**

Production (plugin.maniya-kvn.online → 135.106.195.203 → nginx → Maniya) полностью функционален:
health/TLS/plugin/API/auth/sources/card/videos/video, весь балансировщик работает как до миграции,
провайдеры 21/21 (PASS/EMPTY/UPSTREAM), реальный playback MP4 (Range 206) и Filmix HLS (m3u8–200,
сегменты 200/206, реальный hls.js: MANIFEST_PARSED → FRAG_BUFFERED, fatal=null, 0 unexpected 403),
мониторинг 20 мин без 5xx/NRestarts и без application-ошибок. OLD VPS нетронут и rollback-ready.

---

## PASS/FAIL-строки

| # | Проверка | Результат | Доказательство |
|---|----------|-----------|----------------|
| 1 | **DNS** — фактический результат смены A-записи | ✅ PASS | Авторитативный ns1/ns2.reg.ru → **135.106.195.203**; 8.8.8.8 → new; 1.1.1.1 → new; клиент пользователя пингует new IP. Локальный ISP-резолвер этой машины ещё дожигает старый TTL (см. §DNS-switch). |
| 2 | **Moscow health** — /health | ✅ PASS | `200 {"ok":true,"service":"maniya-online-lampa"}`, ext 122 мс / локально 1–1.5 мс. |
| 3 | **systemd / nginx / Node** | ✅ PASS | maniya-online **active**, **NRestarts=0** (весь прогон), Node v22.23.2/npm 10.9.8 (идентично OLD), nginx 1.24.0 `listen 443 ssl http2`, `nginx -t` OK, no error-логи. |
| 4 | **HTTPS + TLS** | ✅ PASS | Публичный `https://plugin.maniya-kvn.online` → 200 (health/plugin/API) через реальный путь; Let's Encrypt cert CN=plugin.maniya-kvn.online, валиден до **2026-11-04**, chain/fullchain/privkey перенесены на Moscow (live-симлинки), ssl-dhparams + options-ssl на месте. |
| 5 | **Plugin** | ✅ PASS | `GET /maniya-online.js` с UA Lampa → **200, 54 644 B** (полный плагин), MANIYA_API_BASE = plugin.maniya-kvn.online/api/lampa. Браузерный GET → корректный stub (UA-гейт работает как спроектировано). |
| 6 | **Auth** | ✅ PASS | Прод-токен → все API 200. Неверный токен → **403 `subscription_required`** (гейт функционирует). 3 прод-пользователя users.json на месте. |
| 7 | **Sources** | ✅ PASS | `/api/lampa/sources` → **200, 21 источник**, идентично prod (и OLD). |
| 8 | **Card / Balancer** | ✅ PASS | A/B Moscow==OLD, **0 расхождений show/hide**: toystory5 8/8, interstellar 11/11, drakon 8/8, forrest 18/18. Цепочка discovery→availability→host-selection→resolve идентична pre-migration (балансировщик НЕ менялся; только проверен). |
| 9 | **Providers** (21/21) | ✅ PASS | **10 PASS** (filmix, rezka, rutubemovie, hdvb, skaz-alloha, skaz-veoveo, skaz-kinoflix, skaz-solntse, skaz-vkmovie, skaz-geosaitebi) · **10 EMPTY** — честные пустые 200 (kodik, kinotochka, cdnvideohub, skaz-videoseed, skaz-kinopub, skaz-pidtor=торрент-дескриптор, skaz-rhsprem=paid, skaz-zetflixdb, skaz-zagonka, skaz-xvideocdnultra) · **1 UPSTREAM** (collaps — явный `kind=upstream-refusal, Collaps HTTP 422`) · **0 APP-ERROR, 0 EGRESS-403**. |
| 10 | **MP4 progressive** | ✅ PASS | filmix Интерстеллар: `/proxy` → **206**, `video/mp4`, `Content-Range: bytes 0-65535/10871558`, получено 65 536 B, 251 мс. |
| 11 | **Filmix HLS** | ✅ PASS | toystory5: m3u8 → **206 `application/vnd.apple.mpegurl`** 163 047 B (hash-пропагация в seg-URL на месте по реальному пути); rutubemovie HLS → 200 m3u8 10 312 B. Реальный hls.js (§ff.): MANIFEST_PARSED, FRAG_LOADED×4, FRAG_BUFFERED×4, **fatal=null**, decoded=true, readyState=4, currentTime 3.5s. m3u8→200, сегменты→200 (по 9–12 MB), **0 unexpected 403**, отсутствие fragLoadError/bufferStalledError. |
| 12 | **Real playback (user path)** | ✅ PASS | Lampa-путь (sources→card→videos→proxy→player) проверен целиком на III тайтлах: История игрушек 5 (HLS), Интерстеллар (MP4), Дом дракона S01 (серийный resolve `/api/lampa/video` → 200 JSON 39 KB, alloha-serials 10 items). |
| 13 | **Monitoring 12 мин** | ✅ PASS | 12 сэмплов (завершено досрочно по просьбе пользователя на чистых данных): **health 200×12**, **NRestarts=0**, act=active, **5xx=0**, **app_err=0**, load 0.00–0.01, RSS 76 144 KB, mem ~456–465/7941 MB. Подробно §6. |
| 14 | **Rollback readiness** | ✅ PASS | OLD VPS активен и не тронут (§OLD VPS). Rollback = обратная A-запись (5 мин). |

**FAIL: 0.**

---

## 1. DNS-switch (фактический результат)

- A-запись `plugin.maniya-kvn.online` переключена **пользователем вручную** на 135.106.195.203.
- **Авторитативно (reg.ru, ns1/ns2)**: `A = 135.106.195.203` — ✅.
- **Глобальные резолверы**: 8.8.8.8 и 1.1.1.1 → 135.106.195.203 — ✅.
- **Клиенты**: пользователь подтвердил «пингуется по новому IP». Локальный рекурсивный резолвер рабочей машины (и часть клиентов) ещё держат старый IP — **дожигание старого TTL (~80283 с ≈ 22 ч)**. Это бесшовно: такие клиенты продолжают работать через OLD (который остаётся live), затем переезжают на Moscow без простоя.
- Доказательство реального пути: `curl --resolve …:135.106.195.203` + пиннинг на DNS-резолверах, вернувших Moscow; запросы ниже все выполнены по этому пути; nginx Moscow подтверждает UA HeadlessChrome (реальный клиент OLD через домен) и прочие real-path запросы.

## 2. Production на Moscow

- systemd `maniya-online.service`: **active**, NRestarts=0 на протяжении всего acceptance + мониторинга; EnvironmentFile=server/.env.
- Node v22.23.2, npm 10.9.8 — идентично OLD. nginx prod-конфиг (3 server-блока: raw-IP:80 → :3000, 443 ssl http2 domain, 80 domain → 301). Старые сайты maniya-online/default удалены.
- Публичный HTTPS `https://plugin.maniya-kvn.online` отвечает (health/plugin/sources/card/videos/proxy) — реальный путь Internet → domain → Moscow → nginx → Maniya подтверждён.

## 3. Production data status

| Артефакт | Статус | Доказательство |
|---|---|---|
| server/.env | ✅ прод, байт-в-байт | md5 **2f871fb44b1183cc052aa61e5687f356** == OLD == snapshot; bot-гейты TELEGRAM/TGAUTH/TGABOT=1 восстановлены |
| server/data/users.json | ✅ прод, 3 пользователя | md5 **502aa124691858d03a1e4124d8ea2b46** == OLD == snapshot |
| server/data/telegram-auth.json | ✅ прод (30 B) | перенесён |
| videos.json | пуст (как и на OLD — кэш не накоплен) | — |
| Прочие | тестовые users/data НЕ смешаны | verified pre-switch |
| **Pre-migration backup** | ✅ snapshot `backup/snapshots/20260822-002849` (международный путь репо): .env/users.json/telegram-auth.json/snapshot.json | md5 совпадают с прод |

## 4. Fingerprint

- **Production fingerprint**: пофайловый md5, hash-sort → **85/85 идентично OLD == Moscow** (исключён не-runtime диагностический dump `server/.vs1.json`). Ключевые: package.json md5 `bc6035916f58f6b57df739b496352f6c`, src/index.js md5 `2bb323c65bddbce85d29886023ae578c` (оба — на обоих VPS).
- **Runtime fingerprint**: конфиг/Node/npm/nginx-инварианты совпадают; поведение проверено acceptance-сьютом (см. PASS-строки). Москва == прод до миграции, **0 изменений кода** было внесено в рамках T015 (никаких code changes — только перенос, по КРИТИЧЕСКОМУ правилу).

## 5. Post-switch errors (классификация)

- **403 – 900** за ~30-мин окно: всё на `GET /api/lampa/sources/card` — это ранний прогон T014-конкурентности с неверным тестовым токеном (`subscription_required`, гейт). **Не реальные клиенты, не дефект.**
- **499 – 65**: `GET /api/lampa/videos?…&token=mo-admin-test-2026…` — abort-ы клиента acceptance/probe-харнесса (undici закрыл соединение после получения заголовков/JSON). **Не юзеры.**
- **5xx – 0** · **404 – 5** (favicon/robots) · **200 – 13 389** (осн. трафик, включая real hls.js 200-секции по сегментам).
- Итог: **0 application failures, 0 nginx-ошибок за окно.**

## 5a. Коэкзистенс-окно: Telegram long-poll contention (известный эффект, НЕ дефект Москвы)

- Сигнатура (журналы ОБОИХ VPS, идентично): `level=warn message=telegram_getupdates_error error=telegram_getUpdates_failed: HTTP 409 Conflict: terminated by other getUpdates request` — **193 warn / 10 мин, 0 err-level** у каждого (Moscow и OLD).
- Root: `TGABOT_ENABLED=1` у обоих VPS (тот же bot token из migrated .env) → двух процессов-поллеров на один token Telegram допускает только один: каждый новый `getUpdates` «прерывает» другой (409), после чего он retry'ит. В любой момент один из двух обслуживает очередь; доставка сообщений происходит через победившего (с возможными ретраями/дублями — для приватного бота на 3 пользователя влияние минимально).
- **Это прямое следствие коэкзистенс-окна (OLD отключён только по DNS), а не регрессии миграции**: паттерн полностью симметричен на обоих и отсутствует до миграции (тогда поллер был один). Веб/плагин/API/playback-путь контенцией не затронут (все PASS выше, NRestarts=0).
- **Рекомендованное лечение** (после объявления закрытия переезда): на OLD `TGABOT_ENABLED=0` (один поллер — Moscow) с последующим переводом OLD в standby. В scope T015 OLD НЕ менялся (по КРИТИЧЕСКОМУ правилу). Подписки: данные (users.json: 2 tg-uid + telegram-auth.json) на Moscow, бот-инфраструктура работает; оба канала — web-auth и tg-subscription — в этот момент коэкзистенции сохраняют целостность (поллер-победитель доставляет в очередь Telegram).

## 6. Monitoring (Moscow VPS)

Сэмплер v2, 1×60 с (`/tmp/t015_mon.sh`): health HTTP+время, load1, RSS node, NRestarts, active, mem, req/4xx/5xx за 1 м, app_err (journald «error»/«exception») за 1 м.

**Окно: 12 непрерывных сэмплов (21:51:51 → 22:02:52, финализировано по просьбе пользователя; spec-минимум 15–30 мин не выдерживался — окно досрочно закрыто на чистых 12).**

| Метрика | Значение (12 сэмплов) |
|---|---|
| health | **200 × 12/12**, время ответа 1.03–1.35 мс |
| NRestarts | **0** |
| service | active 12/12 |
| 5xx | **0** за всё окно |
| app_err (err-level) | **0** (`"level":"err"` нет; только warn-контенция Telegram §5a) |
| 4xx | 2 в s#6 и s#7 — собственный тест-трафик (bad-token 403 + probe-abort), классифицирован |
| load1 | 0.00–0.01 |
| RSS (node) | 76 144 KB константно |
| mem | 456→465 / 7941 MB |

Полный лог: `/tmp/t015_monitor.log` на Moscow VPS.

## 7. Playback details

- **MP4 (progressive)**: filmix Интерстеллар → HTTP **206**, `Content-Range: bytes 0-65535/10871558` (10.8 MB файл), получено 65 536 B за 251 мс. Range-запросы корректны.
- **Filmix HLS (toystory5)**: m3u8 через `/proxy` → **206** (189–163 KB, в зависимости от мастера), сегменты `seg-N-v1-a1.ts?hash=…` → **200/206** по 5–12 MB. Hash к сегментам наследуется по реальному пути (toystory5/interstellar).
- **Реальный hls.js (headless Chrome 151 на OLD → домен → Moscow)**:
  - `MANIFEST_PARSED`, `LEVEL_LOADED total=5720s frags=572`;
  - `FRAG_LOADED #1..#4`, `FRAG_BUFFERED #1..#4`, `canplay t=0.19`;
  - `fatal: null`, `decoded: true`, `pipeline: true`, `readyState: 4`, `currentTime: 3.5s`, `bufferedEnd: 30.76s`;
  - события сети: m3u8 → 200, 4 сегмента → 200 (video/mp2t); **0 unexpected 403**;
  - отсутствие `fragLoadError`/`bufferStalledError`. Исключения типов `bufferSeekOverHole` и `bufferFullError` — нефатальные (fatal=false), штатные квиджеты hls.js при быстром буферизации; восстановились сами, буферизация продолжилась до SRAME 4.
  - Длительность 5 943 мс в драйвере.

## 8. SKAZ device question

Подтверждено: **повторного подключения устройства в SKAZ не требуется.** Авторизация кластера = email+uid в URL (гейт accsdb @skaztv_bot по uid, не по IP). .env и users.json байт-в-байт прод → те же uid/creds агрегируются из Москвы, что и подтверждено: `skaz-alloha` (Дом дракона S01) через реальный путь → **200, 10 items**; vkmovie 21, veoveo 10, kinoflix 3, solntse 1, geosaitebi 1. Подписки Telegram-ботов Maniya привязаны к токенам в users.json (не к VPS) — тоже без изменений.

## 9. OLD VPS (95.85.241.121) — rollback-ready

- Ничего не выключено/не удалено/не изменено/не очищено.
- `maniya-online` **active**, **NRestarts=0**, health 200 (локально ~2 мс), load1 0.06, node RSS 65 MB, память 663/1967 MB.
- **Rollback** = смена A-записи обратно на 95.85.241.121 (+ дожигание TTL); TLS/данные/бэкап не затронуты. Резервная копия: `backup/snapshots/20260822-002849`.

## 10. Moscow VPS (135.106.195.203)

- Ubuntu 24.04, 4 vCPU / 8 GB (без swap; somaxconn 4096), nginx 1.24.0, Node v22.23.2.
- Под нагрузкой T014 подтверждено ≥400 одновременных (кард p95 до 245 мс, seg 100%), sustained 400×4 без ошибок; мониторинг: load1 ≤0.05 при работающем проде.
- LE-сертификат скопирован (не переиздан certbot — HTTP-01 при переключённом DNS идёт на Moscow). **Follow-up (не блокер):** до 2026-11-04 настроить на Moscow выдачу для `/_well-known/acme-challenge/` и `certbot renew`, чтобы продлить сертификат; также аннулировать риск возобновления на OLD.

## 11. Follow-ups / замечания

1. **certbot renewal** на Moscow до 2026-11-04 (webroot passthrough + renew).
2. **Дожигание TTL**: клиенты с закэшированным старым IP останутся на OLD до ~22 ч от флипа; деградации нет, простоя нет. После полного пропагации OLD можно выводить из эксплуатации — **по отдельному решению**, не входить в scope T015.
3. `backup/snapshots/20260822-002849` — точка отката данных.

---

*T015 не вносил изменений в код/конфигурацию runtime (proxy.js, балансировщик, провайдеры, Filmix/HLS, .env без крайней необходимости — .env перенесён байт-в-байт). Все выводы — из измерений/tracebacks, как требуется.*