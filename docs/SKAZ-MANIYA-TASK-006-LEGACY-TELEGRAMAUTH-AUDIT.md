# SKAZ-MANIYA-006 — Legacy TelegramAuth Removal Audit (read-only)

Дата: 2026-08-21. Тип: **read-only аудит** перед production-деплоем. PRODUCTION НЕ ТРОГАЛСЯ
(никаких изменений на VPS в ходе аудита).

Цель: подтвердить, что Shadow-ACCEPT версия `b1f98f8c` (76 файлов) — корректная целевая
версия Maniya **без** старого TelegramAuth, и что удаление TelegramAuth никого не ломает.

---

## 1. Текущее состояние (установленные факты)

- LOCAL fingerprint = `b1f98f8ce0b9cfbd7710d5538f6aafb9ac33402640847a2670effb2047924bbf` (76 файлов).
- SHADOW (VPS `/tmp/fpg-shadow/server`) fingerprint = `b1f98f8c...` (76 файлов) — **MATCH**,
  версия skew устранён (TASK-005).
- PROD (`/opt/maniya-online/server`) fingerprint = `aee2d945...` (100 файлов) — **другая**,
  старая структура (в т.ч. TelegramAuth-слой, stale `.bak-*`, old `registry.js`/`SkazClient.js`).

## 2. PROD-only TelegramAuth-слой (legacy, намеренно удаляемый)

Файлы/артефакты, существующие ТОЛЬКО в production:
1. `server/src/telegram-auth/` — 9 модулей (`access.js`, `access-resolver.js`, `api-client.js`,
   `bot-commands.js`, `bot-extension.js`, `http.js`, `models.js`, `service.js`, `store.js`) + `.bak`.
2. `config.js` → секция `config.telegramAuth` (из `TGAUTH_*`).
3. `index.js` → импорты TelegraphAuth*, инстансы `TelegramAuthStore/Service/Bot`,
   `ManiyaAccessControl/Resolver` (`accessResolver`), маршруты `/tg/auth/*`, вызовы
   `requireSubscription(context, accessResolver)`.
4. `telegram/runner.js` → слот `deps.telegramAuthBot` (колбэки `tga:`, startMenu).
5. `.env` → `TGAUTH_*` + `TGABOT_*` (после удаления — мёртвый конфиг).
6. `server/data/telegram-auth.json` (осиротевший store-файл).

## 3. Только эти 3 файла PROD зависят от TelegramAuth вне самого модуля

`grep -rl "telegram-auth|telegramAuth|ManiyaAccess|tg/auth"` по `server/src` (вне `telegram-auth/`):
- `config.js`
- `index.js`
- `telegram/runner.js`

Все три **перезаписываются** при деплое `b1f98f8c` чистыми локальными версиями (в target-версии
эти файлы TelegramAuth НЕ импортируют и не используют). ⇒ внешних зависимостей не остаётся.

## 4. b1f98f8c (target) — чистая целевая версия без TelegramAuth

- `server/src/` (75 файлов): **0** совпадений `telegram-auth|tgauth|tgabot|tg/auth|telegramAuth|
  handleTelegramAuth|ManiyaAccess`.
- `index.js`: импортирует ТОЛЬКО `./telegram/runner.js`; защищённые роуты вызывают
  `await requireSubscription(context)` (без accessResolver) — плановое store-резолвление.
- `config.js`: секция `telegram` (обычный бот, `TELEGRAM_*`); **нет** секции telegramAuth.
- `telegram/runner.js`: импортирует только `BotClient` + `bot.js`; **нет** `telegramAuthBot`/`tga:`.
- `server/test` и `server/test-helpers`: **0** упоминаний telegram-auth (принятый suite чист).
- `public/` (клиентский плагин): **0** упоминаний telegram-auth.
- `.env.example`: только обычный бот (`TELEGRAM_*`, триал по `/start`, `/grant <token> [days]`).

## 5. Новый обычный Telegram-бот (останется; не удалять)

`server/src/telegram/{runner.js, bot.js, BotClient.js}` — полноценный, самодостаточный,
НЕ зависит от старого TelegramAuth:
- long-polling через `TelegramBotClient` (api.telegram.org);
- триал по `/start`, ручная выдача/продление `/grant <token> [days]` из админ-чатов;
- оплата/чеки, список пользователей, баннер, «связь с админом»;
- пишет в тот же `users.json` (жизненный цикл подписки telegram_id → subscription).
- Конфиг — только `TELEGRAM_*`; TGAUTH/TGABOT не читает.

## 6. Проверка «что сломается при удалении TelegramAuth»

| Функция | Зависимость от TelegramAuth? | После удаления |
|---|---|---|
| Подписки / пользователи | Нет — `store.js` (`findUserByRequest` по account_email/token/install/short + `isSubscriptionActive`, `requireSubscription`) | Работает. Prod `requireSubscription(context, access)` уже имеет fallback = `findUserByRequest`+`isSubscriptionActive` (идентично target-пути). |
| Access control / auth | `ManiyaAccessResolver` был fuse с TelegramAuth store; при удалении `requireSubscription(context)` даёт ту же store-авторизацию | Работает (плановая модель users.json). |
| account / uid | uid-pin в `availability.js`, account_email в `store.js` — без telegram-auth | Работает. |
| Skaz providers / Balancer / provider registry | Нет ссылок на telegram-auth (модули TASK-005 shadow-верифицированы) | Работает. |
| Playback / proxy | `proxy.js`, `availability.js` — без telegram-auth | Работает. |
| Maniya API | Все защищённые роуты — `requireSubscription(context)` (target) | Работает. |
| Regular Telegram-бот | Независим (см. §5) | Работает. |

Единственное, что «перестанет работать» — legacy `/tg/auth/*`, device-store, `telegram-auth.json`,
tga-бот-расширение — это и есть намеренно удаляемый слой.

## 7. Выводы

- TelegramAuth полностью legacy, удаляем из целевой архитектуры. Отсутствие в `b1f98f8c` —
  **ожидаемое**, НЕ version mismatch.
- `b1f98f8c` содержит всё необходимое для целевой архитектуры без TelegramAuth (обычный бот +
  store-подписки + пропровайдеры + balancer + proxy/playback).
- Производственных нарушений при удалении нет (все 3 зависимых файла перезаписываются чистыми;
  `.env`-ключи TGAUTH/TGABOT станут мёртвыми, что безопасно; `telegram-auth.json` осиротеет).
- **НЕ восстанавливать** TelegramAuth в b1f98f8c; **НЕ** делать ручной надстройки поверх Shadow-версии.

---

### ВЕРДИКТ

```
LEGACY TELEGRAMAUTH:
REMOVE

NEW TELEGRAM BOT:
PRESENT (server/src/telegram/{runner,bot,BotClient}.js; независим от TelegramAuth, TELEGRAM_* конфиг)

PRODUCTION DEPENDENCIES:
config.js, index.js, telegram/runner.js — все перезаписываются чистыми версиями b1f98f8c;
TGAUTH_*/TGABOT_* → dead config; telegram-auth.json → orphan. Ничего из target-архитектуры не зависит от TelegramAuth.

b1f98f8c TARGET VERSION:
READY

PRODUCTION DEPLOY:
YES — ровно b1f98f8c (exact fingerprint), без ручного добавления TelegramAuth
```
