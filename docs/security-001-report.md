# SECURITY-001 — очистка credentials (аудит + cleanup)

**Дата:** 2026-08-14 · **Статус:** cleanup выполнен, ротация НЕ выполнялась (список ниже).
**Scope:** только security-очистка. Код/availability/providers/UI/cache/playback не менялись.
**Правило отчёта:** реальные значения нигде не приводятся — только тип, файл, строка, masked fingerprint (первые 6 + `…` + последние 2).

---

## 1. Итог

- **Рабочее дерево (tracked + untracked):** реальных credentials НЕТ. Повторный скан по всем известным паттернам → пусто.
- **Git history:** реальные credentials БЫЛИ закоммичены в 6 коммитов (см. §3). Рабочий аккаунт и второй прод-токен в истории НИКОГДА не были.
- **Все verification-скрипты** переведены на env-первый паттерн через `scripts/_creds.mjs` (см. §4).
- **Верификация после cleanup** — §5 (health, deploy-скрипты, тесты, отсутствие в HEAD).
- **Ротация:** требуется для 2 секретов, по желанию для 2 (см. §6). НЕ выполнялась — на подтверждение.

---

## 2. Секреты в дереве (до cleanup) — все удалены

### Tracked-файлы (были закоммичены или изменены в HEAD)

| Тип | Файл:строка | Fingerprint | Статус после cleanup |
|---|---|---|---|
| Prod-токен (подписка) | `scripts/auto-confirm-config.mjs:5` | `mo-54f4…27` | → `process.env.PROD_TOKEN` |
| Prod-токен (подписка) | `scripts/p1b-live-test.mjs:5` | `mo-54f4…27` | → `process.env.PROD_TOKEN` |
| Мёртвая учётка (email/uid) | `scripts/provider-matrix.mjs:111` | `nazarov6…om` / `dg4xu2…tj` | учётка снята, probe убран |
| Мёртвая учётка | `docs/action-plan.md:91,464` | `nazarov6…om` / `dg4xu2…tj` | → `<значение удалено SECURITY-001>` |
| Пароль VPS | `docs/action-plan.md:542` | `789z…89` | → `$VPS_PASSWORD` (env) |
| Пароль VPS | `README.md:70` | `789z…89` | → `$VPS_PASSWORD` (env) |
| Мёртвая учётка | `docs/regression-20260811-hidden-twin.md:38` | `nazarov6…om` / `dg4xu2…tj` | → `<значения удалены SECURITY-001>` |
| Мёртвая учётка | `docs/skaz-architecture.md:166,217,220` | `nazarov6…om` / `dg4xu2…tj` | → `<REDACTED>` |
| Мёртвый uid (в тесте) | `server/test/skaz-provider.test.js:731` | `dg4xu2…tj` | → `unit-uid-ab12cd34` |

### Untracked-файлы (в git не коммитились, были в рабочем дереве)

| Тип | Файл:строка | Fingerprint | Статус после cleanup |
|---|---|---|---|
| Prod-токен (подписка) | `docs/balancer-stability-card-report.md:15` | `mo-54f4…27` | → `<REDACTED: prod-token>` |
| Рабочая учётка (email/uid) | `docs/skaz-p2-gap-analysis.md:6,278` | `dorofe…om` / `7974…37` | → `<REDACTED>` |
| Мёртвая учётка | `docs/skaz-p2-gap-analysis.md:267-269,328-330` | `nazarov6…om` / `dg4xu2…tj` | → `<REDACTED>` |

### Проверено и НЕ требует правок

- `scripts/deploy.sh`, `scripts/verify-remote.sh`, `scripts/backup-remote.sh`, `scripts/restore-vps.sh`, `scripts/backup-weekly.bat` — секретов нет (пароль VPS только через `$VPS_PASSWORD`/SSH-ключ).
- `.env.example`, `server/.env.example` — только закомментированные плейсхолдеры; реальных значений нет.
- `server/data/` и `backup/` в `.gitignore`; `users.json`/`videos.json` в git НЕ трекаются.
- `mo-admin-test-2026` (`deploy-test@maniya.local`) — **fake-фикстура** (деплой-тест), не секрет, ротации не требует.

---

## 3. Git history — коммиты с реальными credentials

| Секрет | Коммит | Файл:строка |
|---|---|---|
| Prod-токен `mo-54f4…27` | `323b575` | `scripts/auto-confirm-config.mjs:5`, `scripts/p1b-live-test.mjs:5` |
| Prod-токен `mo-54f4…27` | `89478c1` | `scripts/auto-confirm-config.mjs:5` |
| Пароль VPS `789z…89` | `37548a0` | `docs/action-plan.md:19` |
| Пароль VPS `789z…89` | `a722a59` | `docs/action-plan.md:16,39` |
| Пароль VPS `789z…89` | `2b9c5ee` | `docs/action-plan.md:16` |
| Мёртвая учётка `nazarov6…om`/`dg4xu2…tj` | `79864f2` | `docs/action-plan.md:14,387`, `docs/regression-*.md:38`, `docs/skaz-architecture.md:166,217`, `scripts/provider-matrix.mjs:111` |
| Мёртвая учётка | `29ba731` | `docs/action-plan.md:185`, `docs/skaz-architecture.md:166,217` |
| Мёртвая учётка | `7076836` | `docs/action-plan.md:39` |
| Мёртвая учётка | `323b575` | `docs/action-plan.md:38,411`, `docs/regression-*.md:38`, `docs/skaz-architecture.md:217`, `server/test/skaz-provider.test.js:731` |

**Подтверждено отсутствие в истории** (0 коммитов по `git log -S`):
- Рабочая учётка `dorofe…om` / `7974…37` — только untracked-файлы, в git не попадала.
- Второй прод-токен `mo-fb9b…70` — только temp-файл вне репо.
- Свежий админский токен (если появится) — вне истории.

> История НЕ переписывалась (без подтверждения; `filter-repo` — опционально, см. §6.3).

---

## 4. Миграция verification-скриптов на env-first

**Новый модуль `scripts/_creds.mjs`** — центральная загрузка credentials:
приоритет `process.env` → внешний temp-файл (ВНЕ репозитория). Экспорты:
`loadUsers`, `loadUserA`/`loadUserB` (`PROD_TOKEN`/`PROD_TOKEN_B`), `loadClusterEmail`/`loadClusterUid`/`loadClusterOrigin` (`SKAZ_*`/`EO_*`), `loadKodikToken`, `loadVpsPassword` (только env).

**Переведены на `_creds.mjs` (18 скриптов)** — syntax-check все OK:

| Группа | Файлы |
|---|---|
| readiness | `readiness-matrix.mjs`, `readiness-concurrency.mjs`, `readiness-perf.mjs`, `readiness-eo-reprobe.mjs` |
| prod-verify | `prod-verify-kinopub-002.mjs`, `prod-verify-kinopub-004.mjs`, `prod-verify-online8-002.mjs`, `prod-verify-reveals-002.mjs` |
| trace | `trace-kinopub-003.mjs`, `trace-kinopub-postids.mjs`, `trace-kodik-005-root.mjs`, `trace-kodik-005-verdict.mjs`, `trace-kodik-native-005.mjs` |
| shadow/lifecycle/poll | `shadow-kinopub-004.mjs`, `lifecycle-kodik-005.mjs`, `lifecycle-kodik-005-slow.mjs`, `poll-kodik-005.mjs` |
| ранее (сессия до этой) | `auto-confirm-config.mjs`, `p1b-live-test.mjs`, `provider-matrix.mjs` (прямой `process.env`) |

**Запуск без env:** скрипты читают temp-файлы `%TEMP%\prod-verify-users.json` и `%TEMP%\prod-cluster-env.json` (вне git). **Запуск с env:** `PROD_TOKEN`, `PROD_TOKEN_B`, `SKAZ_ACCOUNT_EMAIL`, `SKAZ_UID`, `KODIK_TOKEN`, `VPS_PASSWORD` — имеют приоритет.

Проверка загрузчиков (только длины/признаки):
```
loadUserA   token_len=35 has_email (mo-54f4…27)   ✓
loadUserB   token_len=35, отличен от A (mo-fb9b…70) ✓
loadClusterEmail/loadClusterUid/loadClusterOrigin   ✓
```

---

## 5. Верификация после cleanup

| Проверка | Результат |
|---|---|
| **Prod health** | `GET https://plugin.maniya-kvn.online/health` → **200** `{"ok":true,"service":"maniya-online-lampa"}` |
| **Deploy-скрипты** | `bash -n` OK: `deploy.sh`, `verify-remote.sh`, `backup-remote.sh`, `restore-vps.sh` |
| **Скрипты синтаксис** | 18 изменённых `.mjs` → `node --check` OK |
| **Отсутствие в HEAD** | grep по 6 паттернам (токены/пароль/учётки) по tracked+untracked → **пусто** (только маскированные `mo-54f4…` и т.п.) |
| **Тесты (полный)** | 514 tests: **506 pass / 2 fail / 6 skip** — 2 fail `api.test.js` **pre-existing**, НЕ связаны с cleanup |
| **Тесты (skaz-provider)** | 35/35 pass (в т.ч. правка UID-ассерта) |

> 2 pre-existing fail: `subscription_text` regex `/^Осталось \d+ дней$/` ломается на склонении
> «26803 дня» (fixture `expires_at=2099-12-31`, today 2026-08-14 → ~26803 дня). Date-dependent,
> от SECURITY-001 не зависит, файл `api.test.js` не изменялся (0 строк diff).

---

## 6. Ротация — список (НЕ выполнялась, ждёт подтверждения)

### 6.1 Требуют ротации (были в git history)

| # | Тип | Fingerprint | Где был | Риск |
|---|---|---|---|---|
| 1 | **Prod-токен подписки** | `mo-54f4…27` | история, 2 коммита | высокий — рабочий токен с доступом к подписке |
| 2 | **Пароль VPS (root)** | `789z…89` | история, 3 коммита | критический — полный доступ к серверу |

Дополнительно: токен `mo-54f4…27` истекает **2026-09-09** — ротация совпадает с естественным истечением.

### 6.2 Не были в истории — ротация по желанию (понижение риска)

| # | Тип | Fingerprint | Статус |
|---|---|---|---|
| 3 | Второй прод-токен | `mo-fb9b…70` | только temp-файл; истекает 2026-09-09 |
| 4 | Рабочая учётка (email/uid) | `dorofe…om` / `7974…37` | только untracked-docs; GRANTED у кластера |

### 6.3 Ротация не требуется

- Мёртвая учётка `nazarov6…om`/`dg4xu2…tj` — уже недействительна (сменился uid, memory `maniya-skaz-strategy`).
- `mo-admin-test-2026` — fake-фикстура.
- `KODIK_TOKEN` — в `server/.env` на VPS, в git не попадал (проверка: `loadKodikToken` len=0 в local env).

### 6.4 Опционально: чистка истории

Полное удаление секретов из истории — `git filter-repo` + force-push в `backup`. **Не выполнялось**:
переписывает все коммиты, требует согласования. Альтернатива — принять историю как есть и ротировать §6.1.

---

## 7. Ограничения

- **Не commit / не deploy** — рабочие изменения ждут подтверждения (git status: 8 tracked modified + untracked docs/скрипты + `_creds.mjs`).
- **Не ротация** — только список (§6), выполнение на отдельном шаге.
- Прод-код (`server/`) и поведение не изменялись.
