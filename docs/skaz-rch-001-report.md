# SKAZ-RCH-001 — RCH/WebSocket СЛОЙ ДЛЯ КЛАСТЕРА SKAZ (IMPLEMENTATION REPORT)

Дата: 2026-08-18. Статус: **IMPLEMENTED + LIVE-VERIFIED. НЕ закоммичено / не задеплоено** — жду отдельного разрешения (release-гейт).
Ответвления: аудиты `docs/balancer-semantics-005-report.md`, `docs/balancer-architecture-audit-001-report.md`.

## A. Суть

Часть узлов skaz-кластера перестала отдавать контент по обычному HTTP и отвечает гейтом
`{"rch":true,"nws":"ws(s)://<host>/nws"}` — контент теперь выдают только через RCH-подключение
(Lampac `rhub`-протокол). Реализован самодостаточный RCH-слой:

1. **SkazRchClient** (`ws(s)://…/nws`): handshake `Connected` → `RchRegistry{host, rchtype, apkVersion, player}` → ack → повтор с `nws_id`.
2. **Повтор исходного запроса** с `nws_id` на **тот же хост сессии** (ротация запрещена). Разблокированному ответу применяется **обычный Skaz-парсер** (никакого дублирующего парсинга; Variant A — сервер-side RCH).
3. **Push/reply**: кластер толкает `RchClient` (выполнить URL → POST `{origin}/rch/result|gzresult`; `ping→pong`; `eval|evalrun` → честный пустой результат).
4. **SSRF-гард**: никакой `fetch(url)` без validation (схема/allowlist/private IP/DNS-rebinding).
5. **Loop-защита**: maxRounds, deadline, correlation, cleanup, без listener-leak, без unhandledRejection.
6. RCH-состояние скоупировано `userUid|host|providerId` — никогда не общее.

## B. Файлы (exact diff)

| Файл | Изменение |
|---|---|
| `server/src/providers/skaz/SkazRchClient.js` | **НОВЫЙ**. `validateRchTarget`, `bareHost`, `randomNwsId` (32 hex), `open()` (Connected/RchRegistry ack, keepalive `ping`→`pong`), `_handleRchClient` (ping/eval/push-выполнение), `_executePushed` (URL-валидация, isPost, UA-apk, таймер+`finally`-cleanup, `text.slice(RCH_RESULT_MAX_BYTES)`), `_postResult` (gzresult при >1000B). |
| `server/src/providers/skaz/SkazRchRegistry.js` | **НОВЫЙ**. Ключ `userUid\|host\|providerId; no-timers (sweep-on-acquire), single-flight `_inflight`, `_drop` = delete + `_closeHook` + close, `closeAll`. |
| `server/src/providers/skaz/SkazClient.js` | `_rchRetryPage` (rounds, rch-again → fresh-цикл, rch_repeated); `_rchFetchWithSession` (повтор с `nws_id`, **любой status**, тело читается всегда); `_scanLite` формирует `rchCandidates`; `resolveStream`/`resolveVideoJson` JSON `{rch:true}` → RCH-повтор. **Live-фикс классификации**: `_rchFetchWithSession` читает тело на любом status (был `this.fetch` = STATUS_REST-only, что 503+`null` превращало в rch_timeout). |
| `server/src/providers/skaz/SkazProvider.js` | `_rchOptions` (userUid + pin), `_rchProviderError` (rch_timeout/unavailable/repeated/… → `provider_error`, никогда «пустой источник»); `videos()`/`resolveVideo()` прокидывают RCH-контекст. |
| `server/src/config.js` | Прокси-локлист `allowHosts` += `ashdi.vip`, `tortuga.tw` (проверенные публичные IP 82.221.131.119 / 5.45.65.142 — content-хосты, которые кластер толкает в push для ashdi/kinoukr). |
| `server/test/skaz-rch.test.js` | **НОВЫЙ**, 21 контролируемый тест (WS-сервер in-test, без внешних зависимостей). |

## C. Протокол (как реализован, фактические данные)

- `GET /nws?id=<nws_id>&ver=1` → `{"method":"Connected","args":[connectionId]}` (`connectionId` 32 hex — считаем nws_id).
- Клиент шлёт `{"method":"RchRegistry","args":[{host:<bare>,rchtype,apkVersion:0,player:null}]}` → ack `{"method":"RchRegistry","args":[clientIp,connectionId,rchtype,...]}` (**live-ack наблюдён — 4 args**).
- **Unlock**: повторить исходный URL с `nws_id=<connectionId>` **на том же хосте** (host в `parseRchPayload` со схемой, `swapHost` режет её; ротация запрещена — контекст живёт с WS-соединением).
- **Push**: `{"method":"RchClient","args":[rchId,url,data,headers,returnHeaders]}` → выполнить URL (POST если `data` непуст; apk-UA; cookie/authorization/sec- заголовки из кластера НЕ применяются) → POST `{http-origin}/rch/result?id=<rchId>` (или `gzresult`, если тело >1000 байт и gzip меньше сырого).
- **Keepalive**: `ping` → `pong`. `eval`/`evalrun` → пустой ответ + `lastError='rch_eval_unsupported'` (серверная ограниченность, не падение).
- `X-Kit-AesGcm`/токены/cookies/opaque-URL с кредами никогда не hardcode и не логируются.

## D. Load-защита и классификация ошибок (+ live-находка)

- **Loop**: `maxRounds` раундов; снова `{rch:true}` при живой сессии → `release` + свежий UUID-цикл; исчерпание → `rch_repeated` без бесконечного цикла. Deadline на каждый fetch/WS; `AbortController` + `clearTimeout` в `finally`.
- **Классификация** (RCH-ошибка ≠ контент-«нет», контент ≠ ошибка):
  - `rch_no_user` — нет контекста пользователя;
  - `rch_unconfigured` — registry не подключён;
  - `rch_unavailable` — WS/ack-таймаут, сессию не получить;
  - `rch_timeout` — не-`null` 4xx/5xx после разблокировки (nginx-HTML, 401, WAF) **или** несъедобный ответ;
  - `rch_repeated` — раунды исчерпаны, кластер упорно просит RCH;
  - `NORMAL EMPTY` — пост-разблокировка `503` + тело `null`/пустое = штатный «контента нет» кластера (не ошибка, `lastRchError=null`).
- **Live-находка (fix)**: первый прогон на живом кластере давал `rch_timeout` на 379ms — корень: `_rchFetchWithSession` использовал `this.fetch` (STATUS_REST-only), выбрасывавший `503 null` ДО чтения тела. Переписан на чтение любого status; `400+` классифицируется по телу (`null`/пусто → EMPTY; иное → rch_timeout). Регрессия покрыта 2 тестами.
- `_debugRound` — только `[skaz-rch] <balancer> host=… round=… outcome=… Nms`.

## E. Безопасность (SSRF-гард)

- `validateRchTarget(url, allowHosts, httpAllowHosts)`: `https`→`proxy.allowHosts`, `http`→`httpAllowHosts`; суффикс-матч `isHostAllowed` (покрывает сегментные subdomain content-хостов: `jk39ocmje0yql3tj.ashdi.vip` ∈ `ashdi.vip`);
- DNS `family:4 all:true`; блок private/loopback/служебных: `127.0.0.1`, `::1`, `0.0.0.0`, `10.`, `192.168.`, `172.16–31.`, `100.64.`, `169.254.`, `224.`, `240.`, `255.`;
- Ошибки: `invalid_rch_url` | `rch_host_forbidden` | `rch_scheme_forbidden` | `rch_private_target`. Ни один pushed-URL не выполняется без прохождения проверки;
- Новые хосты в allowlist публичные, IP проверены в момент добавления; SSRF-локлист закрытым не стал (тест).

## F. Live-верификация (выполнена на shadow-машине 3211/3212 и probe-процессах, НЕ в prod)

1. **Гейт пойман живьём**: ashdi 5/6, kinoukr 5/6, eneyida 2/6, kinotochka 5/6 нод отвечают `{"rch":true}` (10 rch-слагов, которых нет в дефолтном списке).
2. **WS handshake + RchRegistry ack** — Connected args[0] 32 hex; ack 4 args. live.
3. **Unlock по nws_id** — контрольная группа без `nws_id` → снова 200 `{"rch":true}` (гейт ре-ассертится); с `nws_id` → нормальные ответы кластера (503+`null` EMPTY **или** контент).
4. **Push bidirectional**: кластер толкнул `RchClient` URL `https://ashdi.vip/vod/331` (id 36-hex) для «Аватара».
5. **CONTENT (live)**: ashdi/Форсаж → `content=true usable=true len=535 rounds=1 rchUsed=true`, play-карточка `data-json='{"method":"play"…`.
6. **Кластер гейт по времени/нагрузке условен**: в разные окна тот же конфиг даёт либо гейт, либо штатный EMPTY (`lastRchError=null`). Обработано честно — никакого маскирования.

## G. Playback (live)

Путь: play-карта → `resolveStream` → `https://ashdi.vip/video18/3/films/forsazh_1_975/hls/DKqXgnKRkuFdhA79Bw==/index.m3u8?account_email=…`:

- master: **200** `application/vnd.apple.mpegurl`, 3 варианта (1080/720/480) → **PASS_HLS200**;
- вариант 720: 200 HLS, VOD `.ts`-сегменты;
- сегмент: Range-запрос → **206 / video/mp2t / Content-Range / ~1025B** → **PASS_RANGE206**;
- сегмент-хост `jk39ocmje0yql3tj.ashdi.vip` покрыт суффикс-матчем `ashdi.vip`.

Playback доказан по master/variant/segment (206/Content-Range, правильный content-type), не «по URL-наличию».

## H. Регрессия

- Код деплоя затронул только: `SkazClient.js` (RCH-путь, rollback-флаг `rch:false` = прежнее поведение), `config.js` (2 строки allowlist — аддитивно). Non-RCH шлейфы не тронуты: native-first Rutube, VKMovie/RUmovie-1 display, Kodik SolodCDN, Collaps provider_error, W1 host-order/pin.
- **Тесты — основной гейт** (полный suite, см. I).
- Live HTTP-слой (parity 3212, scratch-юзер): `/api/lampa/videos` ходит, RCH/EMPTY классифицируются чисто (ни одного маскированного provider_error); играбельная отдача в HTTP-слое зависит от текущего окна кластера (гейт условен) — та же честная EMPTY/контент-дихотомия, что и в probes.
- Прод (`:3000`, pid 149705) **не трогался**; parity-сессии завершаются/остаются на shadow.

## I. Тесты

- `cd server && NODE_ENV=test node --test` → **711 tests / 705 pass / 0 fail / 6 skip** (6 skip — PLAYWRIGHT/Tier3, pre-existing). Базлайн 708/702/0/6 → +3 новых теста (503-`null`→EMPTY, 503-HTML→rch_timeout, allowHosts-локлист), +3 pass.
- Контролл WS-интеграция: handshake/ack/nws_id в повторе повторяются кластером; изоляция по userUid; single-flight; closeAll; onClose cleanup; push/ping/eval/gzip; SSRF-матрица; resolveStream/resolveVideoJson.

## J. Ограничения и честные провалы

- **RCH-гейт кластера условен**: реализация корректно обрабатывает оба состояния, но «сегодня» кластер то гейтит, то нет (вне нашего контроля). Live-доказательства в F/G собраны в реальных окнах гейтования.
- RCH-обход ускоряет только гейтнутые слаги; негейтнутые идут прежним путём.
- 🚫 commit / push / deploy — НЕ делались (ожидание разрешения; пушить только в `backup`).