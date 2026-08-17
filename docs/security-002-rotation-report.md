# SECURITY-002 — ротация credentials + production verification

**Дата:** 2026-08-14 · **Статус:** ротация ВЫПОЛНЕНА (прод-токен + пароль VPS), production verification пройдена.
**Scope:** только security-ротация и верификация. Код/availability/providers/UI/cache/playback не менялись.
**Правило отчёта:** реальные значения нигде не приводятся — только masked fingerprint (первые 6 + `…` + последние 2).
**Git history НЕ переписывался. Commit/deploy проекта НЕ выполнялись** (без отдельного подтверждения).

---

## 1. Итог

| Действие | Credential | Fingerprint | Статус |
|---|---|---|---|
| **Ротация (обязательная)** | Прод-токен подписки | `mo-54f4…27` → **`mo-6d7c0…e4`** | ✅ выполнена + prod-verified |
| **Ротация (обязательная)** | Пароль root VPS | `789z…89` → **`137630…d6`** | ✅ выполнена + verified |
| Опционально (не ротировано) | Второй прод-токен | `mo-fb9bf…70` | ⏸ см. §6 |
| Опционально (не ротировано) | Рабочая учётка кластера | `dorofe…om` / `7974…37` | ⏸ см. §6 |

---

## 2. Прод-токен подписки: ротация выполнена (живьём подтверждена)

### Хронология (сессия была прервана «пропал свет», состояние сохранено)

| Момент | Событие | Свидетельство |
|---|---|---|
| 20:01 | Снят бэкап **до** ротации | `backup/snapshots/20260814-200116-before-rotation` |
| 20:03 | Новый токен из Telegram сохранён в temp | `%TEMP%\prod-verify-users.json` (slug `dorofeev200`) |
| 20:11 | Бэкап **после** ротации | `backup/snapshots/20260814-201138` |
| 20:1x | «пропал свет» — ротация уже была на VPS | подтверждено ниже живьём |

users.json на VPS (`/opt/maniya-online/server/data/users.json`):
`dorofeev200`: `mo-54f4…27` (before-rotation) → `mo-6d7c0…e4` (после, len 35, active, expires 2026-09-09).

### Production verification (живой API, токен из temp через `_creds.mjs`)

| Проверка | Результат |
|---|---|
| `subscription/check` NEW `mo-6d7c0…e4` | HTTP 200 `authorized:true active:true plan:full`, 26 дней |
| `subscription/check` OLD `mo-54f4…27` | HTTP 200 `authorized:false active:false` — **старый токен мёртв** ✓ |
| `/api/lampa/sources` (NEW) | HTTP 200, **16** источников |
| `/api/lampa/sources/card` MOVIE (Форрест Гамп 13) | HTTP 200, **15 visible / 1 hidden** (cdnvideohub) — mix show/hide ✓ |
| `/api/lampa/sources/card` SERIAL (Дом Дракона 94997) | HTTP 200, **14 visible / 2 hidden** (kodik, cdnvideohub) — mix ✓ |
| `/api/lampa/sources/card` OLD token | HTTP **403** — старый токен не авторизует ✓ |
| **Playback MOVIE** (filmix, Форрест Гамп) | items=5 → `play` → HTTP **206** `video/mp4` ✓ |
| **Playback SERIAL** (filmix, Дом Дракона) | items=10 → `play` → HTTP **206** `application/vnd.apple.mpegurl` (HLS) ✓ |

> Плэйбек пробировался Range `bytes=0-1023` (не качали поток целиком — см. memory `maniya-script-error-findings`).

### verify-remote.sh (деплой-путь, read-only) — 5/5 OK

`health` 200 · `maniya-online.js` HTTP 200 (54644 B) · `subscription/check` `authorized:true` ·
`nginx -t` syntax ok (одно pre-existing warning: conflicting server name на `:80`) · `systemd` enabled + active (uptime 3h29m).

---

## 3. Пароль root VPS: ротация выполнена и подтверждена

- **Был (скомпрометирован, в git history 3 коммита):** `789z…89` (len 9).
- **Стал:** сгенерирован 40-символьный hex, fingerprint **`137630…d6`**.
- **Метод:** `chpasswd` через SSH-канал (stdin, пароль не попадал в командную строку ssh). Рабочий доступ — **SSH-ключ — не удалялся и продолжает работать** (порядок из плана: новый доступ подтверждён до фиксации результата).

### Верификация

| Проверка | Результат |
|---|---|
| `chpasswd` | rc=0 — shadow-хэш заменён |
| SSH по **ключу** (после смены) | `KEY_STILL_OK`, rc=0 ✓ |
| SSH по **новому паролю** (`SSH_ASKPASS` + `PreferredAuthentications=password`) | `NEW_PW_AUTH_OK`, rc=0 ✓ |
| SSH по **старому паролю** (извлечён из git history для negative-теста) | **Permission denied** — старый пароль мёртв ✓ |
| `systemd maniya-online` | `active` |
| `/health` локальный и публичный | HTTP 200 |

> Пароль root выдан пользователю **один раз** в чате (одноразовая передача). В файлы/репо не записан.
> `VPS_PASSWORD` по-прежнему ТОЛЬКО env (см. `scripts/_creds.mjs:71`).

---

## 4. Verification-скрипты: env-first — подтверждено

- **19 скриптов** импортируют `scripts/_creds.mjs` (env → temp, вне git).
- `balancer-002-shadow.mjs` и `online8-002-shadow.mjs` токен читают **на лету** из `config.usersFile`
  (зеркалят сервер) — зашитых токенов нет, миграция не требуется.
- Новых секретов в файлы не записывалось; в Git ничего не добавлено (git status не изменился относительно SECURITY-001).
- Sanity-grep: новый токен `mo-6d7c0…`, новый пароль `137630…` — **отсутствуют** в рабочем дереве.
  Старый токен в дереве — только маскированные формы (`mo-54f4…`, `mo-54f4a…` и т.п.).

---

## 5. `loadUserA()` — fingerprint-независимость подтверждена

- Выбор пользователя — по **стабильному slug** (`USER_A_SLUG = 'dorofeev200'`), не по fingerprint токена
  (комментарий `_creds.mjs:23`: ротация меняет префикс, slug остаётся).
- `_creds.mjs` в **prod-runtime не попадает** (`grep _creds server/` → пусто). Модуль — только verification/migration tooling.
- По плану: fingerprint остаётся только в tooling → **оставлено как есть**. Стоп не требуется.

---

## 6. Optional rotation — НЕ выполнялось (по желанию)

| # | Credential | Fingerprint | Где | Почему optional / статус |
|---|---|---|---|---|
| 3 | Второй прод-токен | `mo-fb9bf…70` | только temp-файл; истекает 2026-09-09 | в git не попадал; ротация не обязательна |
| 4 | Рабочая учётка кластера | `dorofe…om` / `7974…37` | только untracked-docs; GRANTED у кластера | активна и нужна для skaz-кластера; ротация = пере-грант у бота — не тривиальна, по желанию |

---

## 7. Git history / commit / deploy

- **History НЕ переписывалась.** Скомпрометированные `mo-54f4…27` и `789z…89` остаются в старых коммитах —
  но оба **уже недействительны** (ротированы), т.е. угроза закрыта поведением, а не переписыванием.
- **Commit / deploy проекта НЕ выполнялись** (без отдельного подтверждения).
  Рабочее дерево = состояние SECURITY-001 + этот отчёт (`docs/security-002-rotation-report.md`).
- Коммиты с секретами: `mo-54f4…27` (323b575, 89478c1), `789z…89` (37548a0, a722a59, 2b9c5ee).

---

## 8. Рекомендации (опционально)

1. **Отключить парольную аутентификацию SSH** на VPS (`PasswordAuthentication no`, `PermitRootLogin prohibit-password`):
   доступ и так только по ключу — это навсегда нейтрализует любые будущие утечки пароля.
2. **`git filter-repo` + force-push в `backup`** — полная чистка истории (требует согласования; см. SECURITY-001 §6.4).
3. Пользователю: обновить локальный `VPS_PASSWORD` (новое значение передано один раз) перед следующим деплоем.
4. Ротировать optional-пункты (§6) до истечения 2026-09-09, если требуется понизить остаточный риск.

---

## 9. Ограничения

- Не commit / не deploy — как и в SECURITY-001.
- Прод-код (`server/`) и поведение не изменялись.
- nginx warning «conflicting server name на `:80`» — pre-existing, к ротации не относится.
