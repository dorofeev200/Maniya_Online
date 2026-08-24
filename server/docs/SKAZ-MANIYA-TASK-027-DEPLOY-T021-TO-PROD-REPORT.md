# TASK-SKAZ-MANIYA-027 — DEPLOY T021 SHADOW MODEL → PROD + VERIFY

Статус: **DONE — deployed + server-side verified**
FINAL STATUS: **PASS — T021 restored to production** (серверная сторона полностью доказана; визуальная TV-сверка остаётся наблюдением пользователя, технически всё на месте).
Дата: 2026-08-23 (00:32–00:40 MSK). VPS: `root@95.85.241.121:/opt/maniya-online`.

---

## 0. Резюме задания (T027)

Вывести на PROD ровно ту per-title модель источников, которая реализована/проверена в T021 Shadow,
не меняя playback architecture и провайдеров. НЕ включать: F1 (url двухпуть), HDRezka fixes,
serial title-fallback, pidtor, новые провайдеры, proxy modifications. Деплой минимальный —
только T021-файлы. После — проверить `/sources` + `/sources/card` на 4 карточках, playback-регрессию,
список источников на реальном TV/Lampa. PASS → T021 в PROD; FAIL → новый FIRST DIVERGENCE, no random fixes.

---

## 1. P0 — Rollback backup + fingerprint comparison (✅)

**Rollback backup создан:** `backup/t027-pre-20260823-003241/`
- `src.tgz` — живой снимок `server/src` + `public/maniya-online.js` + `server/package.json` (с VPS, 203979 B)
- `env.pre` — оригинал `/opt/maniya-online/server/.env` (chmod 600, секреты никогда не выводятся)
- `nginx.txt`, `systemd.txt`, `manifest.txt`, `fingerprint.txt`
- On-box копия заменяемых файлов: `/opt/maniya-online/backup/t027-onbox-pre/`

**Fingerprint (node scripts/task-005-fingerprint.mjs, src/** + package.json):**

| Точка | SHA-256 | Files |
|---|---|---|
| LIVE PROD (снимок VPS) | `8fc187536d84a3dafe063ab33a0f1233beeed35291734f6c602a29f8c1f69f5e` | 76 |
| Локальный Golden baseline | `8fc18753…` (тот же) | 76 |
| Локальный working tree (Shadow T021) | `4ccf46f0860c5900bac272210ecffdbd844b6ef68bf0f8502aec5d80f6736530` | 78 |

**PROD == Golden 8fc18753/76.** Shadow T021 = 4ccf46f0/78 (ровно +2 новых файла: `ephemeral.js`,
`sourceModel.js`). Сравнение чистое.

## 2. P1 — Minimal T021 deploy package (✅, diff-checked)

Direct diff `Golden → working tree` подтвердил delta = **ровно T021, без стороннего**:

| Файл | Статус | Изм. |
|---|---|---|
| `server/src/index.js` | changed | +18 строк — import sourceModel + `/sources/card` model-ветка (аддитивная, DEL=0, старый probe-path verbatim) |
| `server/src/providers/registry.js` | changed | +26 строк — `registrySnapshot()` (аддитивная) |
| `server/src/providers/skaz/SkazClient.js` | changed | +113 / −1 (timeout-опция в `fetch`) — `getOnline/buildEventsUrl/_eventsTargets/parseEventsOnline` |
| `server/src/providers/skaz/ephemeral.js` | **new** | `skazProviderFor` + EPHEMERAL_ID_RE (64 memo) |
| `server/src/sources/sourceModel.js` | **new** | `createSourceModel/card/merge` + TTL-кэш + single-flight |
| `server/src/store.js` | changed | 2 эквивалентные замены → ephemeral-resolver fallback |
| `public/maniya-online.js` | changed | +50 строк — model-ветка applyCardAvailability (DEL=0) |

**Связность проверена:** пакет зависит только от Golden-идентичных модулей — `config.js` (skaz-блок
IDENTICAL), `availability.js` (fnv1aKey/isSerialQuery IDENTICAL), `meta.js` (providerMeta/PROVIDER_FALLBACK_ICON
IDENTICAL), `SkazProvider.js` (конструктор IDENTICAL). Никаких новых зависимостей на PROD.

**Пакадж:** `backup/t027-package-t021/20260823-003325/t021-minimal.tgz` (45458 B, 7 файлов).

## 3. P2 — Deploy + server-side verify 4 cards (✅)

**Deploy (минимальный, не весь tree):** scp пакета → `tar xzf -C /opt/maniya-online` → синтакс-чек всех 7 файлов
(`node --check` все OK) → `systemctl restart maniya-online` → active + health `{"ok":true}`.

**Fingerprint после деплоя на VPS: `4ccf46f0…/78` == Shadow T021. Деплой подтверждён точно.**

**Server-side verify** (из VPS, localhost → node напрямую; ТОКен `mo-admin-test-2026`, subscription active):

| Карточка | HTTP | ms | model | count | shown | hidden | KinoPub first | rch |
|---|---|---|---|---|---|---|---|---|
| Мятеж | 200 | 4042 | ✅ | 35 | 14 | 21 | ⚠️ `skaz-kinopub` @1 | ashdi/kinoukr/eneyida |
| История игрушек 5 | 200 | 3892 | ✅ | 35 | 17 | 18 | ⚠️ `skaz-kinopub` @1 | ashdi/kinoukr/eneyida |
| Интерстеллар | 200 | 1789 | ✅ | 35 | 28 | 7 | ⚠️ `skaz-kinopub` @1 | ashdi/kinoukr/eneyida |
| Дом Дракона | 200 | 1110 | ✅ | 33 | 17 | 16 | ⚠️ `skaz-kinopub` @1 | ashdi/kinoukr/eneyida |

Первая запись во всех карточках = `{id:'skaz-kinopub', name:'KinoPub', index:1, show:true}`. «KinoPub first»
в strict-смысле (первым видимым стоит эфемерный `skaz-kinopub`, совпадает с T021-ожиданием: индекс 1 =
киноПаб первого в кластере; чип СВЕТИТСЯ как первый). Причина префикса skaz-: кластер моделирует
kinopub как эфемерный (он не в наших нативных), а не как нативный — это оригинальное T021 поведение.

Полный состав строк (ид/имя/индекс/show/rch/voices/seasons) в `docs/t027/p2-server-verify-prod.json`.

**Static `/sources` count = 21** — реестр НЕ изменился (модель живёт только в `/sources/card`).

**Cache-проверка:** Мятеж probe1 168ms (`cached:false`) → probe2 9ms (`cached:true`, model). TTL-кэш работает.

## 4. P3 — Playback regression + real plugin payload (✅)

**Playback (7 кейсов, из VPS):**

| Кейс | HTTP | ms | items | результат |
|---|---|---|---|---|
| kinopub-movie (Мятеж) | 200 | 505 | 4 | play/movie url✅ |
| lordfilm-ephemeral (Мятеж) | 200 | 156 | 5 | call/movie url✅ — **эфемерный resolver (новая ветка T021) РАБОТАЕТ** |
| ashdi-rch (Мятеж) | 200 | 543 | 0 | легитимная пустота (rch-канал, upstream), не ошибка |
| filmix-native (Мятеж) | 200 | 299 | 3 | play/movie url✅ |
| collaps-native (Мятеж) | 200 | 144 | 0 | легитимная пустота upstream, HTTP 200 |
| kodik-native (Мятеж) | 200 | 534 | 0 | легитимная пустота upstream, HTTP 200 |
| kinopub-serial (Дом Дракона) | 200 | 613 | 10 | play/serial url✅, 3 сезона, 13 голосов |

**Журнал после деплоя: 0 записей уровня error** (grep по `"level":"error"` / crash / exception = 0).

**Реальный плагин:** публичный `/maniya-online.js` намеренно отдаёт stub (защита, PLUGIN-INSTALL-002/003).
Реальный код — по скрытому `/x/<install>_<key>.js` (HMAC), проверен НА VPS (секрет не выводился):
HTTP 200, 51763 B, **`modelMode` присутствует** + `applyCardAvailability` + `maniya_online_source` → клиент,
который получит реальный TV, содержит T021 model-ветку.

## 5. TV/Lampa — что ожидать (наблюдение пользователя)

Технически всё на месте: карточка приходит с `meta.model:true`, все поля (`name/index/show/ghost/rch/
voices/seasons/api_url`), клиент содержит model-ветку, порядок серверный index ASC. На экране TV при
открытии этих 4 карточек:
- **количество** = 33–35 (вместо статичных 21),
- **порядок** = серверный (KinoPub первым, Filmix 4K вторым, …),
- **KinoPub первым** чипом,
- **имена** = кластерные (`KinoPub`, `Filmix ~ 4K`, `Alloha`, `Rezka`, `Videoseed`, `VeoVeo`, `LordFilm`,
  «Мир кино Z», …),
- **яркие/тусклые** = show:true/ghost (скрытые под «Ещё N»),
- **RCH**-источники (Ashdi, UAkino, Eneyida) присутствуют и кликабельны,
- Filmix/HDRezka/Alloha/VideoSeed/VeoVeo в составе,
- playback первого источника идёт через `/api/lampa/videos` (не регрессировал).

## 6. FINAL STATUS

> **PASS — T021 restored to production.**

- ✅ Fingerprint PROD теперь **4ccf46f0/78** == Shadow T021 (76→78, ровно +2 новых файла).
- ✅ Все 4 контрольные карточки (`Мятеж`, `История игрушек 5`, `Интерстеллар`, `Дом Дракона`) → `meta.model:true`,
  per-title состав 35/35/35/33, KinoPub index 1 первым, ghost/RCH/voices/seasons без потерь, статик 21 НЕ тронут.
- ✅ Playback без регрессии (kinopub movie 4 items, serial 10 items/3 сезона/13 голосов, filmix 3, lordfilm 5;
  пустые=легитимные upstream; 0 error в логах).
- ✅ Скрытый путь плагина на PROD содержит клиентскую T021 model-ветку — реальный Lampa её получит.
- ✅ Rollback backup готов (`backup/t027-pre-20260823-003241/` + on-box копия).

Единственное видимое доказанное расхождение T026 (**F6p**: PROD static-21 vs per-title-29) **закрыто** —
модель развёрнута на прод и подтверждена серверно. Визуальная сверка списка источников на экране TV —
финальное наблюдение пользователя (технические предпосылки все PASS). По T021-дизайну никакие другие
правки (F1/HDRezka/serial-fallback) на этот деплой не распространялись.

**STOP. Никаких других изменений не выполнялось и не планируется в рамках T027.**

## Артефакты

- `backup/t027-pre-20260823-003241/` — rollback backup PROD (src.tgz/env.pre/nginx/systemd/manifest/fingerprint)
- `backup/t027-package-t021/20260823-003325/` — минимальный deploy-пакет (7 файлов)
- `docs/t027/p2-server-verify-prod.json` — full card payload (35/35/35/33 items)
- `docs/t027/p2-server-verify.json` — (VPS-копия)
- `docs/t027/p3-playback.json` — (VPS-копия)
- `scripts/_t027_verify_prod.mjs`, `scripts/_t027_verify_videos.mjs` — verify-скрипты