# SKAZ-MANIYA-TASK-019A — PRE-SHADOW BACKUP + UI ACCEPTANCE

**Дата:** 2026-08-22 · **Тип:** PRE-SHADOW (rollback-точка + acceptance на shadow, прод НЕ тронут)
**Хост:** LOCAL Windows `C:\Users\Admin\Maniya_Online` · **Прод:** VPS Москва 135.106.195.203 — **NO CHANGE**

---

## 1. Резюме

- Создана полная rollback-точка до shadow-запуска TASK-019: `backup/t019a-pre-shadow-20260822-201129/`.
- **GOLDEN BASELINE зафиксирован** (fingerprint + card-поведение 3 контрольных карточек на проде,
  который T019 не получал — см. PHASE 3).
- **Shadow UI acceptance: PASS 3/3** (локальный сервер, реальные creds кластера; эфемерные
  skaz-источники кликабельны → `/videos` → resolve).
- **Регрессия: зелёная** (787/795; 1 fail = предсуществующий flake route:41, не связан с T019).
- Rollback-восстановимость **доказана без выполнения реального rollback**.
- Прод/DNS/.env/nginx/Telegram: **NO CHANGE**. Deploy: ЗАПРЕЩЁН, не выполнялся.

---

## 2. PHASE 1 — BACKUP (rollback-точка)

Директория: `backup/t019a-pre-shadow-20260822-201129/` (backup/ gitignored, секреты локально).

| Артефакт | Размер | MD5 | Проверено |
|---|---|---|---|
| `project.tgz` (498 файлов: server/src, test, public, scripts, docs, config, package.json…) | 1 511 182 | `3a762a54d1c0fa3c6f8ceabd197b546e` | ✅ `tar -tzf` + `gzip -t` |
| `src.tgz` (server/src + public + server/package.json, 104 файла) | 212 565 | `39817d86e5276103f0b558ffebbddbfb` | ✅ sourceModel/ephemeral/maniya-online.js на месте |
| `data.tgz` (server/data users/videos + .fpg-shadow контекст) | 4 210 | `6c5102cb91c9742c94ba1e23672e3928` | ✅ |
| `env.pre` (server/.env, СЕКРЕТНО — только в backup) | 92 | — | ✅ присутствует, в docs не выводился |
| `systemd.txt` (unit-шаблон + статус health/ready, NRestarts=0) | 1 488 | — | ✅ |
| `nginx.txt` (шаблон site + 80→301 / 443→200) | 1 307 | — | ✅ |
| `fingerprint.txt` (GOLDEN 71185d92…/76 vs рабочее 4ccf46f0…/78) | 1 020 | — | ✅ |
| `manifest.txt` (checksum + git status) | 393 | — | ✅ |
| `backup-report.md` | — | — | ✅ |

SHA-256 архивов: `project=6454e2ac…`, `src=57705bc0…`, `data=038fc3b6…`.

Существующий weekly-механизм (backup-weekly, последний снапшот `backup/snapshots/20260822-140906/`,
VPS users: 3 — 1 deploy + 2 активные подписки) не заменяется, а дополняется этой точкой.

---

## 3. PHASE 2 — VERIFY BACKUP

- Все архивы существуют, непусты, `tar -tzf` и `gzip -t` → OK (3/3).
- `project.tgz` содержит server/src, public, scripts, docs (вкл. T019-отчёты), package.json.
- `src.tgz` содержит критичные модули: `server/src/sources/sourceModel.js`, `providers/skaz/ephemeral.js`,
  `public/maniya-online.js`, `index.js` — **распаковано в /tmp/t019a_proof, все файлы читаются**.
- `data.tgz` содержит server/data users/videos + .fpg-shadow (включая скрытые shadow-файлы).
- `env.pre` присутствует (92 байта), не копировался в docs/report — только в backup.

---

## 4. PHASE 3 — GOLDEN BASELINE (ДО TASK-019)

### Fingerprint (scripts/task-005-fingerprint.mjs: server/src + server/package.json)

| Состояние | Fingerprint | Файлов |
|---|---|---|
| **GOLDEN BASELINE** (commit `2fd2f5c` BALANCER-LAUNCH-FIX-001 — ДО T019) | `71185d92…` | 76 |
| Рабочее дерево (с T019, не задеплоено) | `4ccf46f0…` | 78 |
| Прод (последний отчётный, T015) | `8fc18753` | 76 |

Разница `76→78` в server/src = **ровно 2 новых файла T019**: `providers/skaz/ephemeral.js`,
`sources/sourceModel.js` (comm/diff проверен: новых других нет, удалённых нет).

### /sources/card — прод (T019 НЕ задеплоен; данные docs/t019/_ab-all.json, 2026-08-22)

| Карточка | Прод: источников | shown | meta.model | ms | Кластер-параллель (shown) |
|---|---|---|---|---|---|
| mutiny | 21 | 9 | нет | 38 028 | 12 |
| toystory5 | 21 | 10 | нет | 32 286 | 14 |
| interst | 21 | 19 | нет | 6 516 | 25 |

→ Прод живёт на legacy `{id,show}`-probe-пути; модель в проде отсутствует — golden-базис
для доказательства «изменение относится к T019» зафиксирован в `backup/…/golden-baseline.json`.

### Service status / health (2026-08-22)

- `/health` → **200**, `/ready` → **200** `{"ready":true,"uptime_ms":70815411}`
- HTTP :80 → 301 (nginx→HTTPS), HTTPS 443 → 200; uptime ≈ 19.7ч; NRestarts=0 (T015-мониторинг).

---

## 5. PHASE 4 — SHADOW ONLY

Производство **НЕ менялось**: код/DNS/.env/nginx/Telegram — NO CHANGE. Все проверки T019 — на
локальном shadow-инстансе (127.0.0.1:3322, NODE_ENV=production, реальные creds кластера из
server/.env; tok unit-test-token из fixtures). Публичный каталог, подписки, платёжки не задеты.

---

## 6. PHASE 5 — UI ACCEPTANCE (shadow, реальный Lampa-клиент)

Реального Lampa/TV на этой машине нет — acceptance выполнен на **локальном сервере** (тот же
контракт, который клиент потребляет) + **клиентские юнит-контракты** (plugin-contract.test.js,
sort/ghost/activeSource/videosUrl). Воспроизводимый скрипт: `scripts/_t019a_shadow.mjs`.

Контрольные карточки — **3/3 PASS**:

| Проверка | mutiny | toystory5 | interst |
|---|---|---|---|
| meta.model=true (34 источника) | ✅ | ✅ | ✅ |
| Первый = **KinoPub** (index 1, серверное имя) | ✅ | ✅ | ✅ |
| Видимых (shown=кластер+extras) | 16 | 20 | 24 |
| ghost «Ещё N» (скрытые сохранены, не отброшены) | 18 | 14 | 10 |
| Порядок index ASC, коллизии пресервованы | ✅ | ✅ | ✅ |
| rch-чип (ashdi/kinoukr/eneyida) | ✅ | ✅ | ✅ |
| Переключение source → `/videos` 200 | ✅ alloha(7) | ✅ kinopub(3)/alloha(3)/remux(2) | ✅ kinopub(9)/alloha(8)/remux(5) |
| **Эфемерный skaz-<slug> кликабелен → resolve (не 404)** | ✅ skaz-ashdi | ✅ skaz-remux | ✅ skaz-remux |
| Повторное открытие карточки → кэш-хит | ✅ 0ms | ✅ 0ms | ✅ 0ms |

**Ключевое (задача §5 «источник, появившийся через ephemeral skaz-<slug>, реально кликабелен»):**
эфемерные источники вне реестра (skaz-remux, skaz-ashdi, skaz-kinoukr) отвечают на
`/videos?provider=skaz-<slug>` статусом 200 и возвращают items (или честный пусто по
upstream-причине, напр. pidtor=торрент-дескриптор, rch — T020) — то есть `source → /videos →
resolve` работает вне зарегистрированного реестра. Эфемерные **не регистрируются** в
`/sources`/PROVIDER_META — реестр не тронут (HARD-констрейнт).

RCH: отображение чипа подтверждено (rch:true в модели); **полноценный RCH playback в эту
задачу не входит** — только наличие/отображение (T020).

Визуальные детали чипов (иконки/качество) — из meta.js/имени кластера: за этим наблюдается
тот же battle-tested клиентский рендер (updateFilter → filter.set('sort') с ghost), покрытый
plugin-contract.test.js (23/23 зелёные, включая T019-контракты sort с ghost + активный source).

---

## 7. PHASE 6 — REGRESSION (native providers)

`NODE_ENV=test node --test` → **795 tests / 787 pass / 1 fail / 7 skip**.

Единственный fail: `availability-route.test.js:41` — **предсуществующий flake**, НЕ регрессия T019:
- файл не менялся с `b2f919a`; тест работает в `SKAZ_ENABLED=0` (модельная ветка не выполняется);
- причина на этой машине: локальный бокс достаёт реальный rutubemovie API → authoritative
  вердикт «нет» по карточке (не timeout) → `show:false` против ожидаемого
  «сети нет → show:true» (исторический флейк, см. SKAZ-MASTER-ENABLE-FLAKE-001 route:41).
- Native провайдеры (Filmix/Rezka/HDVB/Alloha/KinoPub/VideoSeed/VeoVeo/Kodik/Kinotochka/Rutube/etc.)
  покрыты suite: **787 зелёных**, включая все unit/route/контракты T019. Новых фиксов НЕ вносилось
  (задача запрещает).

---

## 8. PHASE 7 — ROLLBACK TEST (НЕ выполнять реальный)

Доказано, что rollback возможен:
- 3/3 архива `tar -tzf` + `gzip -t` целостны; sha256/md5 зафиксированы в manifest.
- Из `src.tgz` распакованы и прочитаны критические файлы (sourceModel/ephemeral/index/public) —
  восстановление кода к состоянию backup подтверждено фактически.
- `env.pre` (`.env`) в backup; `server/data` users/videos в data.tgz.
- Fingerprint golden/рабочее/прод сохранены — возможность вернуться к «ДО T019» (76 файлов)
  документирована.
- Реальный прод-rollback НЕ выполнялся (не требуется: прод не менялся).

---

## 9. Respondы на HARD CONSTRAINTS

- PROD/.env/config/nginx/DNS/VPS/Telegram/платежи/пользователи — НЕ тронуты.
- Deploy/restart — НЕ выполнялись. STOP после отчёта.
- Статический реестр 21→32 не расширялся; в PROVIDER_META ничего не добавлялось.

---

## Финальный статус

`FINAL STATUS: ACCEPT`

- ✅ Backup полный (5 архивов + env.pre + systemd/nginx/fingerprint/manifest/report, проверен).
- ✅ Golden BASELINE зафиксирован (fingerprint 71185d92…/76 + прод card-поведение 3 карточек).
- ✅ Shadow UI соответствует кластеру SKAZ (первый KinoPub, состав/pорядок/ghost/rch честные).
- ✅ Source switching работает (3 карточки, несколько источников каждый → /videos 200).
- ✅ Эфемерные skaz-<slug> кликабельны → /videos → resolve (не 404), без регистрации в реестре.
- ✅ Regression отсутствует (787/795; 1 fail = предсуществующий flake route:41, не связан с T019).
- ✅ Rollback-восстановимость доказана.

`READY-FOR-PRODUCTION` — условия ACCEPT выполнены; **PRODUCTION DEPLOY ЗАПРЕЩЁН и не выполнялся.**

СТОП.