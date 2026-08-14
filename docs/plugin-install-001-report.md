# PLUGIN-INSTALL-001 — opaque-ссылка установки (скрытие JS из URL)

**Дата:** 2026-08-14 · **Статус:** реализация + тесты + live shadow выполнены. **Commit/deploy НЕ выполнялись** (ждут отдельного подтверждения).
**Scope:** только install-flow. НЕ менялись: `server/src/availability.js`, провайдеры, cache, playback, `sources/card`, BALANCER-002/ONLINE8-002, SHADOW/COMPARE, Filmix TRUSTED_ALWAYS_VISIBLE, RCH/WebSocket.
**Правило отчёта:** реальные значения нигде не приводятся — только masked fingerprint (первые 6 + `…` + последние 2).

---

## 1. Что сделано

Новая схема ссылки установки. Старые рабочие ссылки НЕ удалены (обратная совместимость).

| URL | Что отдаёт | Кэш | Содержит реальный токен |
|---|---|---|---|
| `GET /i/<opaque>` | HTML-страница установки («MANIYA ONLINE / Добавьте плагин в расширения Lampa», кнопка «Скопировать», мобильная вёрстка) | `Cache-Control: no-store` | **Нет** |
| `GET /p/<opaque>.js` | Сам плагин JS (через существующий `sendPluginForToken`) | `Cache-Control: no-store` | Да (вшит в `window.MANIYA_ONLINE_TOKEN` — иначе Lampa не авторизуется) |
| `/dorofeev200_<short>.js` (legacy) | Плагин JS | `no-store` | Да — **сохранён как есть** |
| `/maniya-online.js?token=` (static) | Плагин JS | `public, max-age=300` | — сохранён как есть |

- **Opaque-токен:** `crypto.randomBytes(24).toString('hex')` (48 hex, 192 бита). Случайный, **не выводим** из subscription-токена; не содержит user id/email/slug/последовательный ID. Строго hex, длина ≥ 32 (маршрут + lookup) — анти-гадалка.
- **Маппинг:** `install_token` хранится в записи пользователя (`users.json`); сервер мапит opaque → пользователь → активная подписка → отдача. Реальный токен подписки в URL не попадает.
- **`/i/` никогда не отдаёт JS** (маршрут отдельный, HTML). Невалидный/короткий opaque → **404** с обобщённым `install_link_not_found` (информации о пользователе не раскрывается). Неактивная подписка → 403 (как и у legacy).

### Изменённые файлы

| Файл | Правка |
|---|---|
| `server/src/telegram/bot.js` | `makeInstallToken()`/`ensureInstallToken()`; `pluginUrl()` → `/i/<install>` при наличии `install_token`, иначе legacy; `/start` создаёт/дозаполняет `install_token`; `/grant` и `grant_issue` тоже дозаполняют |
| `server/src/store.js` | `findUserByInstallToken()` — точное совпадение (не суффикс), min 32 hex |
| `server/src/http.js` | `sendInstallPage()` — HTML no-store, never JS; escape-хелпер |
| `server/src/index.js` | Маршруты `/i/<opaque>` и `/p/<opaque>.js` до статик-фолбэка, после legacy-shortlink |
| `server/test/fixtures/plugin-install-users.json` | Новая фикстура (A/B/неактивный) |
| `server/test/plugin-install.test.js` | **16 тестов** (14 из плана + 2 доп.) |
| `server/test/telegram.test.js` | Ассерты ссылок обновлены на `/i/<install>` (поведение меняется намеренно) |

---

## 2. Тесты

Полный прогон `cd server && NODE_ENV=test node --test`:

**530 tests: 522 pass / 2 fail (pre-existing, date-dependent) / 6 skip.**

- 2 fail — те же pre-existing из `api.test.js`: регэксп `subscription_text` `/^Осталось \d+ дней$/` ломается на склонении «26802/26803 дня» (фикстура `expires_at=2099`, сегодня 2026-08-14). От PLUGIN-INSTALL-001 не зависят; `api.test.js` не изменялся.
- Новый `plugin-install.test.js`: **16/16 pass**. Новые telegram-ассерты: **pass**.

### 14 проверок из плана (все pass)

1. Валидный `/i/` → HTML 200 (text/html, бренд, инструкция, ссылка на `/p/`)
2. `/i/` никогда не JS и без subscription-токена в теле
3. Валидный `/p/` → JS 200 с вшитым токеном пользователя
4. Невалидный `/i/` → 404 (без раскрытия данных)
5. Невалидный `/p/` → 404
6. Opaque не содержит user token (не равен, не подстрока, формат hex)
7. A/B изоляция: `/i/` и `/p/` A ≠ B в обе стороны (HTML и JS)
8. HTML содержит сообщение «Добавьте плагин в расширения Lampa»
9. JS Content-Type `application/javascript`
10. Существующий Lampa-флоу работает: legacy `/dorofeev200_<short>.js` и статика `/maniya-online.js`
11. Существующий API работает: `subscription/check` по реальному токену → authorized
12. В HTML нет credentials (ни A, ни B)
13. В URL нет subscription-токена — только opaque
14. Кэш-заголовки не смешивают: HTML/JS no-store, повтор юзера идентичен, чужой — другой

Доп.: неактивный пользователь → 403 на `/i/` и `/p/`; короткий `<32` hex → 404.

---

## 3. Live shadow (локальный сервер, реальная запись прод-пользователя)

Read-only к проду: `users.json` с VPS скопирован в `%TEMP%`, в **temp-копию** добавлен свежий `install_token` (реальный пользователь `dorofeev200`, токен `mo-6d7…e4`), локальный сервер на 127.0.0.1:3210. Прод не трогался.

**14/14 PASS:**
- `/i/<install>` → 200 text/html, бренд+инструкция+ссылка, НЕ JS, без реального токена, `no-store`
- `/p/<install>.js` → 200 javascript, `no-store`, вшит реальный токен пользователя, полный плагин (49 557 B)
- `/i/<unknown>` и `/p/<unknown>.js` → 404
- legacy `/dorofeev200_<short>.js` → 200 JS с токеном; статика → 200
- API `subscription/check` с реальным токеном → `authorized=true`
- прод-файл не изменён (в нём нет `install_token`)

---

## 4. Ограничения и честная оценка

- **JS «скрыт» только от случайного открытия ссылки в браузере.** Lampa физически должен скачать JS по `/p/<opaque>.js`, поэтому код остаётся доступен через DevTools/Network-вкладку. Это НЕ «невозможно украсть» и НЕ «полностью скрыт» — заявлено как есть.
- Opaque-токен защищает от *наблюдателя URL* (перехват/логирование ссылки больше не раскрывает subscription-токен). Кто получил саму ссылку установки — получает и плагин с токеном; это тот же уровень доверия, что и у legacy-ссылки.
- `/p/<opaque>.js` и `/i/<opaque>` не rate-limited (как и legacy-shortlink) — запросы валидации подписки дёшевы, абьюза не замечено.

---

## 5. Что проверить при деплое (не делалось)

1. **nginx** пропускает `Cache-Control: no-store` от апстрима для `/i/` и `/p/` (не переопределяет на кэширующий). После деплоя: `curl -sI https://plugin.maniya-kvn.online/i/<install>` → `cache-control: no-store`.
2. nginx проксирует `/i/…` (без расширения, как `/health`) и `/p/….js` (как legacy-shortlink) — ожидаемо, но подтвердить живым запросом.
3. Существующим пользователям: до первого `/start`/выдачи у них нет `install_token` → бот продолжает слать legacy-ссылку (обратная совместимость), лениво заполняется при следующем взаимодействии.
4. Проверить отсутствие cross-user cache-poisoning на CDN/прокси после деплоя: `/i/<A>` ≠ `/i/<B>`.

---

## 6. Commit / deploy — НЕ выполнены

- Рабочее дерево: 6 файлов изменены для PLUGIN-INSTALL-001 (+ 2 новых) плюс pre-existing изменения прошлых сессий (SECURITY-001/002 и др.).
- Реальных credentials в diff нет (проверено: только masked).
- Жду отдельного подтверждения на commit и deploy.
