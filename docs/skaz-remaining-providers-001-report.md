# SKAZ-REMAINING-PROVIDERS-001 — проверка оставшихся skaz-провайдеров

**Дата:** 2026-08-18 · **Статус:** CHECKED — MANIYA BUGS: 0, FIXED: 0. **STOP (commit/push/deploy НЕ делались).**

---

## 1. Scope и метод

**Кандидаты** (из BALANCER-POST-W1-REMAINING-001): `kinoflix, solntse, videoseed, geosaitebi, pidtor, rhsprem`.
Запреты задачи соблюдены: W1/balancer-semantics, availability, Kodik/SolodCDN/AMS, VKMovie/RUmovie-1, Rutube,
HDVB, Skaz-RCH, collaps, TMDB-proxy, Filmix — **не тронуты**. Подтверждающие волны: PIDTOR-DEEPLINK-001 и
RHSPREM-AUTH-001 **выполнены** (обе закрыты UPSTREAM/ACCOUNT-DEPENDENT, код не менялся). COLLAPS-EGRESS,
HDVB-TITLE-ONLY, RUTUBE-QUALITY — **не начинались**.

**Метод (без SSH — VPN глушит :22, см. release-playback-gap-001 §7.3):**
- **Maniya-сторона** (2 прогона, shadow `http://95.85.241.121:3210`, токен `mo-admin-test-2026`, тот же код/creds,
  что на VPS): полный каскад `/api/lampa/videos → (call→/api/lampa/video) → proxy → m3u8 → variant → seg`,
  с RW-переписыванием вложенных proxy-URL на shadow-host. Скрипт `scripts/_skaz_shadow_verify.mjs`.
- **Upstream-сторона**: закрытые отчёты (balancer-post-w1-remaining-001: карточный микс play/call/link/ACCSDB/EMPTY;
  final-playback-gap-001: pidtor=магнит-фильтр) + прямые fetch-пробы кластерных конечных точек через shadow-proxy
  (тот же `Origin: http://lampa.mx`, те же creds из resolved-URL) — скрипты `_skaz_debug_bodies/full_chain/vseed_*`.

## 2. Таблица

| provider | title | items | resolve | playback | classification | action |
|---|---|---|---|---|---|---|
| kinoflix | Интерстеллар (2014) | 3 | play «Русский», q=2160p/1080p/480p | **play=MP4/TS-RANGE 206** video/mp4 ✓ (2/2 прогона) | **WORKING** | — |
| solntse | Дюна: Часть вторая (2024) | 1 | play «(720p)» | **play=MP4/TS-RANGE 206** video/mp4 ✓ (2/2) | **WORKING** | — |
| videoseed (movie) | Дюна: Часть вторая (2024) | 16 | play «Dubляж» | **m3u8(351KB)→variant 200→seg 206 MP2T sig47✓** (2/2) | **WORKING** | — |
| videoseed (serial) | Дом дракона (2022) | 0–10 (флак) | call→resolve→**JSON-дескриптор-URL** `lite/videoseed/video/<opaque>` (без play) | дескриптор 200-JSON↔**400-empty**; **fresh m3u8 404** (+play=true/creds/creds+Origin); items=0 эпизодически | **UPSTREAM EPISODIC** (серийные медиа биты/гейтятся апстрим; НЕ MANIYA BUG по критерию «upstream playable») | — (не трогать) |
| geosaitebi | Интерстеллар (2014) | 1 | play «Интерстеллар» | **m3u8→variant 200(529KB)→seg 206 MP2T sig47✓** (1-й хит — транзиентный JSON-гейт, ретрай→206) | **WORKING** | — |
| pidtor | Дюна: Часть вторая (2024) | 0 | — | — (карточки `lite/pidtor/s<btih>` фильтруются `isTorrentDescriptor`; следование 302 → `oleg*.skaz.tv:8081/stream` → **401**/timeout) | **UPSTREAM/CAPABILITY LIMITATION** (торрент-descriptor без клиент-плейабельного HTTP target; stream-гейт серверный) | — (close) |
| rhsprem | Интерстеллар (2014) | 11 | call→resolve→`lite/rhsprem/movie.m3u8?...play=true` (Лампак-форма) | **503 empty** & **HTML-decoy** («Волк с Уолл стрит») & 200-JSON — флаки | **ACCOUNT/ACCESS DEPENDENT** (HDrezka-Premium) + UPSTREAM REFUSAL | — (close, без запроса кред) |
| *(вне scope кандидатов, проверено в ходе)* zetflixdb / zagonka / xvideocdnultra | Интерстеллар | 11 / 11 / 1 | play / play / call | **seg 206 MP2T sig47✓** / **seg 206** / call→resolve→**seg 206`** | WORKING (подтверждает TASK-SOURCES-005) | — |

## 3. ### Fixed

**Ничего.** Ни по одному кандидату не выполнено условие MANIYA BUG
(«upstream playable → Maniya теряет/ломает → конкретный root cause»). Код не менялся.

## 4. ### Confirmed working

- **kinoflix** — play-карточка с мапой качеств 2160p/1080p/480p → прямой MP4, Range-206. Стабильно 2/2.
- **solntse** — play-карточка → прямой MP4, Range-206. Стабильно 2/2.
- **videoseed (фильмы)** — полный HLS: master(351KB)→variant→seg 206 MP2T sig47✓. Стабильно 2/2.
- **geosaitebi** — полный HLS: master→variant(529KB)→seg 206 MP2T sig47✓. Первый хит кластера иногда возвращает
  транзиентный JSON-дескриптор/гейт (в 1-м прогоне raw-verify — `JSON(60B)`, при retry — полный 206; во 2-м прогоне
  — сразу 206). Для клиента (Range + retry) рабочая пара.

## 5. ### Upstream limitations

- **pidtor — UPSTREAM/CAPABILITY LIMITATION (торрент-descriptor, stream за серверным гейтом).** Карточки —
  не голые магнеты, а дескрипторы `lite/pidtor/s<btih>?tr=…` (torrent: btih + трекеры). По эталону Lampac
  (`Modules/PidTor/Controller.cs`) этот endpoint — не client-playable: кластер на нём делает server-side
  `POST /torrents` (action=add, **Basic auth внутренним логином `{user_uid}` на собственный пул TorrServer**
  `oleg*.skaz.tv:8081`), затем 302 → `/stream?link=<hash>`; у клиента нет ни внутреннего Basic-креда, ни
  pre-add хэша. **Проверено live (2 сэмпла, GET с Origin `http://lampa.mx`+creds, redirect-follow):
  прямой ход 302 → `oleg3.skaz.tv:8081/stream` = 401 (пустое тело); второй сэмпл — таймаут** (TorrServer
  не отдаёт без pre-load). Медиа материализуется только после серверного add с внутренней авторизацией →
  **клиент-плейабельного HTTP/HLS/MP4 target за линком нет** (ни для Maniya, ни для crawler; HTTP-гейт
  серверный, а не accsdb — ACCSDB-гейт кластера на этом пути пройден, иначе был бы JSON `{accsdb:true}`).
  `isTorrentDescriptor` фильтр корректен → честный `items=[]`. Менять нечего.
- **rhsprem — ACCOUNT/ACCESS DEPENDENT (+ UPSTREAM REFUSAL).** «Maniya · HDRezka 4K» — премиум-источник.
  Resolve строит корректную Лампак-форму `lite/rhsprem/movie.m3u8?title=…&id=2259&t=56&favs=…&play=true`,
  но кластер отвечает флаки: 503-empty / HTML-decoy (страница другого фильма) / JSON. Это upstream-гейт
  премиум-аккаунта (личная Lampa-подписка HDRezka Premium). **Закрыт по критерию «требует личный Lampa-аккаунт»,
  креды не запрашивались.** Подтверждает флаки из balancer-post-w1. **RHSPREM-AUTH-001 (проверка):** по эталону
  Lampac `Modules/OnlinePaid/Rezka` (Controller.cs `getCookie`, RezkaSettings `premium`) playable-контент требует
  серверно-сконфигурированного HDRezka-аккаунта (`init.cookie` либо `init.login/passwd`); анонимного/
  безавторизационного playable-пути у paid-модуля НЕТ. Текущая архитектура Maniya передаёт только Lampa-access
  (account_email/uid) и не имеет канала получить персональную Premium-сессию → штатно playable rhsprem content
  НЕ берётся → подтверждено ACCOUNT/ACCESS DEPENDENT, без правок.
- **videoseed (сериалы) — UPSTREAM EPISODIC.** Кластерный серийный путь нестабилен: items 0↔10; дескриптор-эндпоинт
  200-JSON↔400-empty; m3u8 из дескриптора — **404 даже свежим** (4 раунда × 3 серии, с play=true/creds/creds+Origin).
  Фильмовый m3u8-путь (контроль) работает 200 — значит различие upstream-серийное, не Maniya-сетевое. Зафиксирована
  особенность Maniya: в серийном резолве отдаётся URL дескриптор-эндпоинта (без де-резолва до m3u8), но фикс НЕ
  доказан (медиа 404 в апстриме) → **не MANIYA BUG по формальному критерию задачи**.

## 6. ### Remaining

- **rhsprem** — остаётся видимым в UI (show:true, решение юзера BALANCER-002). Работа упирается в премиум-доступ;
  без личного Lampa-аккаунта HDRezka-Premium не играется. Не менять UI. RHSPREM-AUTH-001 **выполнена**: подтверждено
  по эталону Lampac (paid-модуль требует серверный HDRezka-аккаунт; анонимного пути нет) → закрыто ACCOUNT/ACCESS
  DEPENDENT, код не менялся.
- **videoseed-serial** — апстрим-эндпоинт серий в нерабочем состоянии на 2026-08-18. Мониторить; при починке апстрима
  перепроверить, не станет ли де-резолв дескриптора→m3u8 доказанным фиксом.
- **pidtor** — намеренно `items=[]` (торрент-фильтр `isTorrentDescriptor`). PIDTOR-DEEPLINK-001 выполнен:
  подтверждён торрент-descriptor, HTTP-таргет за линком требует серверной TorrServer-авторизации (401 live),
  клиент-плейабельного target нет → закрыто как UPSTREAM/CAPABILITY LIMITATION, код не менялся.

## 7. Ограничения и риски

- SSH к VPS недоступен (VPN глушит :22-баннер) → `_skaz_upstream_probe.mjs` (на VPS, прямое чтение creds из
  `/opt/maniya-online/server/.env`) **не запускался**; upstream-факты взяты из закрытых отчётов + fetch-проб кластера
  через shadow-proxy (тот же Origin/creds). Creds при этом не раскрыты (берутся из resolved-URL рантайма).
- Активные probe-скрипты кластера могут триггерить rate-limit (дескриптор 200→400 после серии запросов). Детерминирующие
  факты (m3u8 404 fresh, HTML-decoy, MP4-206 стабильно) от каденса не зависят.
- Кодовых изменений: **0**. Тесты: suite **735/729/0/6** (базовая линия релиза `7013097`) — без регрессий.

**Итог:** `SKAZ-REMAINING-PROVIDERS-001 Checked: 6 / WORKING: 4 (kinoflix, solntse, videoseed-movie, geosaitebi) /
UPSTREAM LIMITATIONS: 2 (pidtor torrent-descriptor — stream за серверным TorrServer-гейтом, клиент-плейабельного
HTTP-таргета нет; rhsprem account-dependent) + videoseed-serial upstream-episodic / MANIYA BUGS: 0 / FIXED: 0 /
PIDTOR-DEEPLINK-001: закрыт UPSTREAM/CAPABILITY LIMITATION / Tests: 735/729/0/6 / Commit: NOT DONE / Push: NOT DONE /
Deploy: NOT DONE / **STOP.**`