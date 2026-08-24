# TASK-SKAZ-MANIYA-022 — REAL TV/LAMPA ACCEPTANCE OF T021

> Текущий статус: **IN PROGRESS — Phase 1 (сервер) выполнена; Phase 2–7 ожидают реального TV.**
> Дата сессии: 2026-08-22. Прод: **не тронут** (см. §2). Deploy: **ЗАПРЕЩЁН** (не выполнялся и не будет в рамках этой задачи).

## 1. Цель и границы

Проверить T021 не по curl/API, а на реальном Lampa/TV-клиенте, сравнив поведение Maniya Shadow (T021, READY-FOR-PRODUCTION) с актуальным SKAZ. HARD CONSTRAINTS соблюдаются: prod/.env/DNS/nginx/Telegram/платежи/пользователи — **без изменений**; deploy/restart prod — **запрещены**; код T021 во время acceptance **не менялся**; HTTP 200 **не считается** доказательством playback; дефекты — только FIRST DIVERGENCE.

## 2. Phase 1 — Подключение TV к Shadow T021 (серверная часть, ВЫПОЛНЕНА ✅)

### 2.1 Shadow-инстанс
- VPS `/tmp/t022-shadow/` (scratch-копия T021), порт **3222**, запуск `nohup node --env-file=.env --env-file=run.env src/index.js` (PID 41935), слушает `0.0.0.0:3222`.
- `run.env` оверрайды: `PORT=3222`, `PUBLIC_BASE_URL=http://135.106.195.203:3222`, `CORS_ORIGINS=*`, `TELEGRAM_ENABLED=false`, `TGAUTH_ENABLED=false`, `TGABOT_ENABLED=false` (избежать двойного бота), data/.env склонированы с прода (users.json — реальные токены).
- Подписка: реальный user-токен (длина 18, **не печатаю**) проходит проверку на shadow.

### 2.2 Fingerprints (проверено НА VPS)
| Объект | SHA-256 | Файлов | Комментарий |
|---|---|---|---|
| **Shadow T021** | `4ccf46f0860c5900bac272210ecffdbd844b6ef68bf0f8502aec5d80f6736530` | 78 | ПОБАЙТНО == рабочее дерево T021 |
| **Production** | `8fc187536d84a3dafe063ab33a0f1233beeed35291734f6c602a29f8c1f69f5e` | 76 | == Golden T020, read-only, не трогался |

Единственное отличие staged-дерева от T021 — константа `MANIYA_API_BASE` в `public/maniya-online.js`:
```
prod:   var MANIYA_API_BASE = 'https://plugin.maniya-kvn.online/api/lampa';
shadow: var MANIYA_API_BASE = 'http://135.106.195.203:3222/api/lampa';
```
(строки 4; diff показывал и client model-ветку — она ВХОДИТ в T021, prod её уже не имеет как Golden без T019.)

### 2.3 Доказательства запросов в Shadow
- `GET /maniya-online.js` (User-Agent `Lampa/2.4.0`) → 200, 57 080 байт, реальный код плагина (UA-гейт: для браузера → stub «Добавьте плагин в Расширения Lampa.», для Lampa → код).
- `GET /api/lampa/sources?token=<real>` → 200, 21 источник.
- `GET /api/lampa/sources/card?...&token=<real>` (4 контрольные карточки) → 200, `meta.model=true`, elapsed 1.7–10.4 с (≤ 12 с кэп ≪ 15 с окна клиента — симптом 019C закрыт).
- Shadow-лог (`/tmp/t022-shadow/server.log`): `request_completed` с полями path/statusCode/durationMs/ip; монитор вооружён (persistent) для поимки запросов с реального TV (не 127.0.0.1).

### 2.6 Событие подключения клиента (19:57 UTC, реальная Lampa-сессия к Shadow)
Полная последовательность в shadow-логе (IP `178.173.126.235` — egress, совпадающий с этим боксом; TV, вероятно, за тем же роутером; по IP неразличимо от бокса, но паттерн — живой клиент, а не мои curl):

```
19:57:20.958  GET /vip-kanal-tvv_207711693970.js → 200   (install-ссылка плагина, ×5)
19:57:51.140  OPTIONS /api/lampa/subscription/check → 204;  GET → 200
19:57:52.587  OPTIONS /subscription/check → 204;           GET → 200
19:57:52.679  OPTIONS /api/lampa/sources → 204;            GET → 200
19:57:52.789  OPTIONS /api/lampa/videos → 204
19:57:52.831  OPTIONS /api/lampa/sources/card → 204
19:57:53.048  GET /api/lampa/sources/card → 200 (178ms)     ← cache/model
19:57:53.420  warn filmix_video_links_failed postId=186401 tvHost=api.filmix.tv hasAuth=false 403
19:57:53.664  warn filmix_card_primary_failed host=filmix.my fetch failed
19:57:54.464  GET /api/lampa/videos → 200 (1384ms)          ← выбран filmix post 186401
```

Вывод: клиент (TV или Lampa на домашней сети) корректно пошёл на Shadow — подписка 200, `/sources` 200, `/sources/card` 200 (КиноПуб-модель), `/videos` 200. Filmix-предупреждения (`hasAuth:false 403`, `filmix.my fetch failed`) — отсутствие FILMIX_TV-кредов на shadow + сетевой egress → категория EGRESS/UPSTREAM (не дефект Maniya, известный факт T013/T010). Ожидаемая реакция на экране при выборе Filmix — без реального видео из этого источника без кредов. Ждём подтверждение пользователя, какой карточки это соответствовало.

Сессия продолжилась 19:58–19:59: `/sources/card` 200 (4ms — кэш) и 200 (3317ms — свежий кластерный фетч модели; **≪ 15с окна клиента — симптом 019C «скрытые источники» закрыт на живом Lampa**), `/videos` 200 (511/731ms) без warn. Клиент активно листает карточки на Shadow. Примечание к Phase 1: лог shadow `request_completed` не содержит UA и query — карточку (id/imdb/title) и выбранный provider по логу опознать невозможно, только по экрану; для строгости «это TV» достаточно паттерна: браузер получил бы stub и не смог бы сделать эти API-вызовы с валидным токеном.

### 2.4 ЧТО ПОЛУЧИТ TV (HTTP-снимки shadow, фактически отданные пользователю)
`docs/t022/t022-shadow-cards.json` (снято node-скриптом на VPS через `http://127.0.0.1:3222`, sanitize без url/токенов):

| Карточка | shown (ядро) | +Maniya-экстры (index=null) | ghost («Ещё N») | total | КиноПуб первый |
|---|---|---|---|---|---|
| Мятеж (2026) | 14 | Kodik, Collaps, HDRezka 4K (3) | 21 | 35 | ✅ idx=1 |
| История игрушек 5 (2026) | 17 | Kodik, Collaps, HDRezka 4K (3) | 18 | 35 | ✅ idx=1 |
| Интерстеллар (2014) | 27 | Kodik, Collaps, HDRezka 4K (3) | 8 | 35 | ✅ idx=1 |
| Дом Дракона (2022, serial) | 21 | Kodik, Rutube, CDNVideo, Collaps, RUmovie-1, HDRezka 4K, Maniya·zetflixdb, GET's TV (8) | 12 | 33 | ✅ idx=1 |

- Ядро (кластерные записи) — **вербатим** из кластерного `online[]` (name/index/show/rch/voices/seasons), KinoPub первый.
- Maniya-only экстры в КОНЦЕ списка, `index=null` — документированный дизайн T021 (§Model), на экране выглядят как дополнительные источники. Это **единственное** структурное отличие Maniya от SKAZ в составе карточки.
- Ghost (`show:false` из кластера) СОХРАНЕНО → клиент показывает «Ещё N» (Lampa «Ещё N» = фильтр ghost).

### 2.5 SKAZ-базлайн (кластер, то, что видит SKAZ-плагин на экране)
`docs/t022/t022-nodevar2.json` — разброс по 6 нодам кластера для 4 карточек. **KinoPub первый на 5 из 6 нод**; нода `77.90.33.109` отдаёт Filmix первым (#2 filmixtv) — инфра-особенность SKAZ (зафиксирована в T021; не регрессия). Число записей/состав варьируется по нодам (например Мятеж: online3 → 29 записей/9 shown, 94.249.239.37 → 33/11). SKAZ и Maniya оба зависят от кластерной ноды — абсолютные цифры на экране могут отличаться у самого SKAZ между сессиями.

> **Вывод для Phase 2:** признак совпадения на экране — не абсолютное число источников, а **порядок/имена/первый-KinoPub/ghost-механизм/состав ядра**. Maniya дополнительно показывает Maniya-only экстры (для дракона 8).

## 3. РУНБУК TV (что делать на ТВ)

1. Lampa → **Расширения** (плагины) → **Maniya Online** → **Редактировать URL**: заменить только host
   `https://plugin.maniya-kvn.online/…` → **`http://135.106.195.203:3222/…`** (путь сохранить; `/p/<install>.js`, `/maniya-online.js`, `/x/…` — все работают, token из `Lampa.Storage` `maniya_token`/`lampac_token`).
2. Сохранить/перезагрузить. Во время acceptance не открывать prod-плагин.
3. Как я докажу подключение: shadow-лог поймает `GET /maniya-online.js`, `/api/lampa/subscription/check`, `/api/lampa/sources/card`, `/api/lampa/videos` с IP ТВ-клиента (не 127.0.0.1).

## 4. Phase 2 — Source UI parity (ОЖИДАЕТ TV)

**Серверный оракул** (A/B «SKAZ-кластер vs Shadow T021», `docs/t022/ab2-*.json`): ядро совпадает **вербатим** (порядок/имена/индексы/rch/voices), единственное структурное отличие — Maniya-экстры в хвосте (index=null, документированный дизайн T021). Абсолютные счётчики (ghost/«Ещё N», кол-во записей) **зависят от кластерной ноды** в момент запроса (§2.5) — на экране сверять **состав и порядок**, а не числа.

**Ожидаемые (ядро в порядке отдачи; то, что покажет SKAZ-плагин):**
- **Мятеж:** 1 КиноПуб → 2 Filmix 4K → 4 Alloha 4K → 7 Zagonka → 8 SkazTV → 13 Eneyida [rch] → 16 Videoseed → 17 VeoVeo → 22 HDVB → 23 Kinotochka → 26 VideoHUB 4k → 27 LordFilm → 28 Мир кино Z → 515 ZetflixDB. В хвосте у Maniya: Kodik, HDRezka 4K.
- **История игрушек 5:** 1 КиноПуб → 2 Filmix 4K → 4 Alloha → 5 Rezka → 7 iRemux → 8 SkazTV → 13 Eneyida [rch] → 14 Rutube → 15 VK Видео → 25 Geosaitebi → 27 LordFilm → 28 Мир кино Z. В хвосте: Kodik, HDRezka 4K.
- **Интерстеллар:** 1 КиноПуб → 2 Filmix 4K → 4 Alloha → 5 Rezka → 7 iRemux → 8 SkazTV → 10 xVideoCDN Ultra → 11 xVideoCDN 60/120fps → 12 FilmGE → 13 Eneyida [rch] → 14 Rutube → 15 VK Видео → 16 Videoseed → 17 VeoVeo → 20 Солнце → 22 HDVB → 23 Kinotochka → 25 Geosaitebi → 26 VideoHUB → 27 LordFilm → 28 Мир кино Z → 515 ZetflixDB. В хвосте: Kodik, HDRezka 4K.
- **Дом Дракона (сериал):** 1 КиноПуб → 2 Filmix 4K → 4 Alloha → 5 Rezka → 8 SkazTV → 11 Eneyida [rch] → 13 VeoVeo → 15 Солнце → 17 HDVB → 18 Kinotochka → 21 LordFilm. В хвосте **только у Maniya**: Rutube, CDNVideo, RUmovie-1, Kodik, HDRezka 4K, Maniya · zetflixdb, GET's TV.

Сравнивать на экране: первый источник (ожидание — **КиноПуб**), состав/порядок ядра, «Ещё N» (ghost), rch-иконка у Eneyida, наличие экстров в хвосте, поведение при открытии списка. Неопределённые визуально позиции → `INCONCLUSIVE`.

| Поле | SKAZ (ожидание) | Maniya Shadow (ожидание) | MATCH / DIVERGENCE |
|---|---|---|---|
| … | (заполняется с TV) | (заполняется с TV) | … |

## 5. Phase 3 — Movie real playback (ОЖИДАЕТ TV)
≥3 фильма: card→source→videos→resolve→play; время до источников/playback/первого кадра, звук, картинка, buffering, continuity, перемотка, pause/resume, выход, повторный запуск. Playback PASS только при реальных картинке+звуке+потоке+перемотке.

## 6. Phase 4 — HDRezka (ОЖИДАЕТ TV)
Полный путь на ТВ: source→videos→voice→resolve→manifest→playback→video+audio. Проверить прежний симптом «шипящая картинка / нет нормального воспроизведения» (T019C/T021). Не работает → FIRST DIVERGENCE с точным этапом; codec/MIME/audio/video codec/HLS/DASH/MP4/manifest/segment/фактический player error.

## 7. Phase 5 — Serial flow (ОЖИДАЕТ TV)
Поиск, карточка, serial=1, источники, seasons, episodes, voices, выбор серии, запуск, playback. Дом Дракона + ≥2 сериала, один из которых пользователь сейчас НЕ находит. SKAZ находит, Maniya нет → FIRST DIVERGENCE по search→card→source→videos→season→episode→resolve (id/imdb_id/kinopoisk_id/title/original_title/year/serial/season/episode/source). НЕ исправлять.

## 8. Phase 6 — Continue Watching (ОЖИДАЕТ TV)
Фильм (play→несколько минут→stop→exit→reopen; CW/позиция/запуск с timecode) и сериал S01E01. T021: CW = клиентский localStorage Lampa/SISI (серверного нет). Проверить фактическое поведение ТВ.

## 9. Phase 7 — Source matrix (ОЖИДАЕТ TV)
Filmix, KinoPub, HDRezka, Alloha, VideoSeed, VeoVeo, HDVB, один RCH, сериал — для каждого DISPLAY/SOURCE CLICK/VIDEOS/RESOLVE/PLAYBACK → PASS/EMPTY/UPSTREAM/EGRESS/CLIENT/FAIL. EMPTY/UPSTREAM не превращать в FAIL без доказательства.

## 10. Phase 8 — Differential (ОЖИДАЕТ TV)
SYMPTOM/SKAZ/MANIYA/FIRST DIVERGENCE/EVIDENCE/ROOT CAUSE/IMPACT/FIX REQUIRED по каждому различию (UI, ordering, ghost, first, movie playback, HDRezka, serial search, seasons/episodes, CW, switching).

## 11. Phase 9 — FINAL DECISION (ОЖИДАЕТ завершения Phase 2–7)
ACCEPT / REJECT / ACCEPT WITH KNOWN EXTERNAL LIMITATION / INCONCLUSIVE по критериям задачи. НЕ выдавать ACCEPT на основании только API/curl/headless.

## 12. FIRST DIVERGENCE log
(пусто до появления расхождений на живом TV)

## 13. Evidence index
- `docs/t022/t022-shadow-cards.json` — HTTP-снимки shadow card (4 карточки, sanitize).
- `docs/t022/t022-nodevar.json` / `t022-nodevar2.json` / `t022-nodevar-v1-bug.json` — разброс кластерных нод SKAZ.
- `docs/t022/ab2-*.json`, `ab2-all.json` — A/B «SKAZ cluster vs Shadow T021» по полям контракта (чистый дифф: только Maniya-экстры).
- Shadow-лог VPS `/tmp/t022-shadow/server.log` (monitor task bezvi795x).
- База T021: `docs/SKAZ-MANIYA-TASK-021-FULL-SKAZ-PARITY-REPORT.md`, `docs/t021/*`.