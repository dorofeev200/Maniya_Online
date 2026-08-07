# CLAUDE.md — Maniya Online

Lampa-плагин + Node API-сервер стриминга. Git-корень здесь (`C:\Users\Admin\Maniya_Online`).
Цель: полный рабочий плагин — подписка через Telegram-бот (потом), ссылка в расширения Lampa,
работают балансировщики источников и играют фильмы на iOS/Android.

## Resume (как продолжить сессию)
1. Прочитать `docs/action-plan.md` — единственный источник истины «где мы» (статусы/чекбоксы/очередь волн).
2. Продолжать первую незавершённую волну/провайдера (порт из Lampac до 100% рабочего).
3. Прогнать тесты: `cd server && NODE_ENV=test node --test`.
4. Обновить чекбоксы `docs/action-plan.md`, коммит, деплой.

## Стек и структура
- `server/` — Node ESM (zero-dep, чистый `http`/`fetch`). Точка входа `server/src/index.js`.
- Контракт провайдера: `server/src/providers/base.js` (`search/movie/serial/streams`→`StreamItem[]`,
  `videos()`→`{items:{method:'play'},seasons,voices}`). Реестр `server/src/providers/registry.js`.
- Конфиг `server/src/config.js` + env через `.env.example`. Прокси-локлист `proxy.allowHosts` (SSRF).
- `public/maniya-online.js` — браузерный плагин (тонкий клиент, ходит в API).
- Эталон Lampac: `C:\Users\Admin\AppData\Local\Temp\Lampac` (все модули Online*).
- Спека/аудит: `docs/provider-specification.md`, `docs/architecture-audit.md`,
  `docs/rezka-provider-design.md`, `docs/rezka-migration-checklist.md`.

## Соглашения
- Zero-dep: не добавлять npm-пакеты без надобности. Браузерные провайдеры — только под гейтом
  `PLAYWRIGHT_ENABLED` (Тир 3), дефолт — чистый HTTP.
- Секреты/токены — только через env/конфиг, НЕ в коде (зашитые публичные ключи Lampac — как
  поведенческий реф, но выносить в config).
- Провайдер «не в рабочем состоянии» = `enabled()=false` (не светится в `/apia/lampa/sources`).
- Каждый новый провайдер = клиент+декод+нормализатор+videos()/streams()+реестр+config+тесты.
- Деплой: `scripts/deploy.sh` root@95.85.241.121 (пароль передан, неинтерактивный вход через
  SSH_ASKPASS), проверка `scripts/verify-remote.sh`.