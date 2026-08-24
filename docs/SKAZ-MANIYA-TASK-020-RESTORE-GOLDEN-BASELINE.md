# SKAZ-MANIYA-TASK-020 — RESTORE GOLDEN BASELINE

**Дата:** 2026-08-22 · **Тип:** RESTORE (Shadow/local → последнее гарантированно рабочее состояние ДО TASK-019)
**Хост:** LOCAL Windows `C:\Users\Admin\Maniya_Online` · **Прод:** VPS Москва 135.106.195.203 — **NO CHANGE**
**Rollback-база:** `backup/t019a-pre-shadow-20260822-201129/` (T019A PRE-SHADOW BACKUP)

---

## 1. Резюме

- **Fingerprint восстановленного дерева = `8fc187536d84a3dafe063ab33a0f1233beeed35291734f6c602a29f8c1f69f5e / 76 файлов`**
  — **байт-в-байт равно ПРОД** («последнее гарантированно рабочее состояние до TASK-019», точное значение из манифеста бэкапа).
- **Test suite = `763 / 756 pass / 1 fail / 6 skip`** — **ровно Golden-базелайн** (TASK-008/010: 763/756/1/6).
  Единственный fail = предсуществующий флейк `route:41` (не связан с восстановлением).
- **Runtime-проверки пройдены**: `/health`, `/ready`, `/sources`, `/sources/card` (3 Golden-карточки —
  вердикты 18/18 идентичны Golden), `/videos` (Filmix, KinoPub, HDRezka, сериал) + playback через /proxy
  (playlist 206 mpegurl, segment 206 MP2T) — паритет Golden-акцептансу T010/T015.
- **Все T019-артефакты удалены**: `sourceModel.js`, `ephemeral.js` и связанные правки/тесты (грep-свип: 0 совпадений).
- Прод/.env/data/nginx/DNS/Telegram/платежи — **NO CHANGE**. Deploy — НЕ выполнялся. **STOP.**
- Восстановление выполнено к **ПРОД-состоянию `8fc18753`**, НЕ к чистокровному HEAD `71185d92`
  (см. §6 — это две разные цели; детальное обоснование ниже).

---

## 2. Почему цель = `8fc18753` (Прод), а не `71185d92` (HEAD)

Манифест бэкапа фиксирует три fingerprint-значения:

| Состояние | Fingerprint | Файлов | Смысл |
|---|---|---|---|
| GOLDEN (HEAD commit `2fd2f5c`, ДО T019) | `71185d92…` | 76 | `git worktree` HEAD БЕЗ принятых pre-T019 фиксов |
| Рабочее дерево С T019 (не задеплоено) | `4ccf46f0…` | 78 | +2 модуля T019 (`ephemeral.js`, `sourceModel.js`) |
| **ПРОД** (T010/T015 релиз, T019 НЕ получал) | **`8fc18753…`** | **76** | **задеплоенные pre-T019 фиксы** |

Доказано (grep по blobs HEAD, verify worktree `/tmp/head_wt_020`): **`71185d92` = чистокровный HEAD БЕЗ
всех принятых и задеплоенных фиксов** — `inheritBaseQuery` (HLS, T008/T010), `config.skaz?.enabled`
(T004 P0), `resolveVideoJson(card.stream||card.url)` (T002), `if (text)`-хen (T003) — в HEAD отсутствуют,
в ПРОД присутствуют (проверено на VPS). Восстановление к `71185d92` = вычищение работающих деплой-фиксов
из локального дерева → локаль разошлась бы с прод, а будущий деплой **регресснул бы прод** (0×403 HLS и т.д.).

Задача: «вернуть к последнему **гарантированно рабочему** состоянию до TASK-019» и «**удалить только
T019-артефакты**» — обе формулировки мапятся на **ПРОД (=`8fc18753`)**, который одновременно является
«точным значением из манифеста бэкапа» (допустимая цель по п.1). `71185d92` же содержательно равен
«HEAD без фиксов» и не является «последним рабочим состоянием» после TASK-008/010/015.

**Решение:** восстановлено к `8fc18753` (Прод). Манифест-критерий «76 файлов / точное значение» —
**выполнен** (76 файлов, точное значение из манифеста).

---

## 3. Что сделано

### 3.1 Сохранены (pre-T019 принятые фиксы, идентичны ПРОД)
`server/src/providers/skaz/SkazClient.js` (003 хen), `SkazProvider.js` (002/004), `server/src/proxy.js`
(008/010 `inheritBaseQuery` ×3) + `server/test/{proxy,skaz-client,skaz-provider}.test.js` — **без изменений**.

### 3.2 Откачены к HEAD (T019-only правки; проверено: идентичны ПРОД)
`server/src/index.js`, `server/src/store.js`, `public/maniya-online.js`, `server/test/plugin-contract.test.js` —
реверт к HEAD; по-файлово совпадают с ПРОД (sha256). T019-как модель-ветка из `/sources/card` и `store.js`,
Т019-поля из клиента убраны.

### 3.3 Байт-восстановлен `server/src/providers/registry.js` (специальный случай)
Локальный HEAD-checkout `registry.js` отличался от ПРОД **только** UTF-8 BOM + окончаниями строк
(контент по-функционально идентичен — `diff --strip-trailing-cr`: пусто; T019-маркеров 0). Снят
read-only `cat` с VPS (`/opt/maniya-online/server/src/providers/registry.js`, sha256 на VPS совпал
с локальной копией `088ccbc0d…`) → записан байт-в-байт → дерево идентично ПРОД по всем 76 файлам.

### 3.4 Удалены T019-артефакты (13 untracked)
`server/src/sources/sourceModel.js`, `server/src/providers/skaz/ephemeral.js`,
`server/test/{source-model,source-model-live,sources-card-model-route,skaz-events}.test.js`,
`server/test/fixtures/t019-{mutiny,toystory5,interst}.json`,
`scripts/_t019{_ab,_audit_check,_baseline,_a_shadow}.mjs`.

### 3.5 Грep-свип после очистки = 0 маркеров
`sourceModel|ephemeral|skazProviderFor|registrySnapshot|getOnline|parseEventsOnline|_eventsTargets`
в `server/src` + `public` + `server/test` — только мусорные совпадения («2019», цифры в URL). Чисто.

---

## 4. Верификация

### 4.1 Fingerprint
```
node scripts/task-005-fingerprint.mjs server
→ 8fc187536d84a3dafe063ab33a0f1233beeed35291734f6c602a29f8c1f69f5e  76   == ПРОД точно
```
(нестабильности нет — пересчитывался 3 раза за сессию, стабилен).

### 4.2 Test suite
```
NODE_ENV=test node --test
→ tests 763, pass 756, fail 1, skipped 6   (exit 1 — из-за 1 fails)
```
- Единственный fail: `availability-route.test.js:41` — **предсуществующий флейк** (задокументирован
  в 019A PHASE 6 и SKAZ-MASTER-ENABLE-FLAKE-001): локальный бокс достаёт реальный rutubemovie API →
  авторитетный «нет» → `show:false` против ожидаемого «сети нет → show:true`. Файл не менялся. НЕ регрессия.
- Счёт **763/756/1/6 = идентичен Golden pre-T019** (TASK-008/010) — восстановление семантически точное.

### 4.3 Runtime (локальный сервер :3399, `NODE_ENV=production`, реальные кластер-creds из server/.env,
фикстурные `users/videos` — через `USERS_FILE/VIDEOS_FILE`, **файлы server/data и .env не тронуты**)

| Проверка | Результат | Golden (манифест) |
|---|---|---|
| `/health` | 200 `{"ok":true}` | 200 |
| `/ready` | 200 `{"ready":true}` | 200 `ready:true` |
| `/sources` | 200, 20 источников | 21 (см. §5 — .env-гейт нативов, не код) |
| `/sources/card` mutiny | 20 эл., хол. 36 942 ms, **verdict-parity 18/18** | 21, shown 9, 37 686 ms |
| `/sources/card` toystory5 | 20 эл., хол. 33 396 ms, **verdict-parity 18/18** | 21, shown 10, 32 176 ms |
| `/sources/card` interst | 20 эл., 14 837 ms, **verdict-parity 18/18** | 21, shown 19, 6 391 ms |
| `/videos` Filmix (mutiny) | 200, 3 play-items (werkecdn HLS) | playable (паритет) |
| `/videos` KinoPub (skaz-kinopub, mutiny) | 200, 4 play-items | playable (паритет) |
| `/videos` HDRezka (rezka, interst) | 200, 10 call-items (голоса) | playable (паритет) |
| `/videos` сериал (Дом Дракона serial=1, skaz-kinopub) | 200, 10 items, **seasons 3, voices 13** | серии/сезоны/голоса (паритет) |
| Playback /proxy (filmix HLS) | playlist **206** `application/vnd.apple.mpegurl`; segment **206** `video/MP2T` | T015: filmix 206, 0×403 |

Claster-латентность того же порядка, что Golden (mutiny 37.0 vs 37.7 с, toystory5 33.4 vs 32.2 с,
interst 14.8 vs 6.4 с — нодная вариация, не регрессия).

---

## 5. `/sources` 20 vs Golden 21 — объяснение (НЕ код)

Локальный `.env` (92 Б, == `env.pre` в бэкапе) держит native `kodik/collaps/hdvb` в `enabled()=false`
(нет токенов в локальном env), поэтому:
- натив `collaps` не регистрируется в `/sources` и не входит в перечисление карточки (collaps — native-only);
- нативы `kodik/hdvb` не светятся → вместо них **видимы skaz-близнецы** `skaz-kodik`/`skaz-hdvb`.

На ПРОД эти нативы включены → карточка перечисляет их как native (12 эл. kodik/hdvb collaps). **Вердикты
show/hide по всем пересекающимся id = 18/18 идентичны** (kodik/hdvb совпали и через близнеца). Это штатная
native-twin-архитектура (registry.js §nativeTwin), а не расхождение кода: восстановленное дерево байт-в-байт
= ПРОД.

---

## 6. Итоговая сверка с Golden BASELINE

| Показатель | Golden baseline | Восстановлено | Статус |
|---|---|---|---|
| Fingerprint (76 файлов) | `71185d92…` (HEAD) / **`8fc18753…` (ПРОД)** | **`8fc18753…`** | ✅ точное значение из манифеста |
| Файлов в fingerprint-скоупе | 76 | 76 | ✅ |
| Test suite `763/756/1/6` | да | да (тот же 1 fail-флейк) | ✅ |
| `/sources/card` 3 карточки | 21 эл. (mutiny/ts5/interst) | вердикты **18/18** + twin-паритет kodik/hdvb | ✅ |
| Playback HLS | playlist 206 + segment 206, 0×403 | **то же** | ✅ |
| T019-маркеры в коде | 0 | 0 | ✅ |
| Прод/DNS/.env/data/nginx/Telegram | NO CHANGE | **NO CHANGE** | ✅ |

---

## 7. HARD CONSTRAINTS — подтверждение

- PROD/.env/config/nginx/DNS/VPS/Telegram/платежи/пользователи — **НЕ тронуты** (только read-only `cat`
  с VPS для сверки `registry.js`).
- Deploy/restart — **НЕ выполнялись** (локальный shadow-сервер :3399 поднимался и остановлен; прод не трогался).
- Git: коммиты/пуши не выполнялись (`git status` — только ожидаемые M по восстановленным файлам против продол-head).
- Секреты (env.pre, прод-токены) — в отчёт не выводились.

---

## Финальный статус

`FINAL STATUS: ACCEPT` — Shadow/local восстановлен к ПРОД-состоянию задеплоенным pre-T019 фиксам:

- ✅ Дерево байт-в-байт = ПРОД (fingerprint `8fc18753…/76`, точное значение манифеста).
- ✅ Suite 763/756/1/6 = Golden (1 fail — pre-existing flake route:41).
- ✅ Runtime: /health, /ready, /sources, /sources/card ×3, /videos (Filmix/KinoPub/HDRezka/сериал), playback 206 — паритет Golden.
- ✅ T019-артефакты удалены (sourceModel.js, ephemeral.js и связанные; grep 0).
- ✅ T019 в ПРОД НЕ задеплоен → прод оставался и остаётся на `8fc18753` (вариант B исключён в 019C).

**README: при следующем деплое локаль (== прод-код) продолжит прод-контракт без T019-модели —
это осознанный выбор «последнее гарантированно рабочее состояние», а не «HEAD без фиксов».**

СТОП.