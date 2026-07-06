# Maniya Online Lampa Plugin

Стартовый шаблон плагина Lampa для Maniya Online. Плагин добавляет кнопку **Maniya Online** в карточку фильма/сериала, проверяет подписку пользователя через ваш API и получает список легально доступных источников воспроизведения.

> В шаблоне нет привязки к сторонним балансерам и нет выполнения кода через `eval`. Сервер Maniya Online должен отдавать только те ссылки и источники, на которые у вас есть право распространения.

## Файлы

- `public/maniya-online.js` — клиентский плагин для Lampa.
- `docs/maniya-online-api.md` — контракт API, который должен реализовать сервер.

## Быстрый запуск

1. Разместите `public/maniya-online.js` на своём HTTPS-домене.
2. В файле замените `https://maniya.online/api/lampa` на адрес вашего API.
3. Реализуйте API по контракту из `docs/maniya-online-api.md`.
4. Добавьте URL плагина в Lampa.

## Настройка подписки

Плагин хранит локальный идентификатор устройства `maniya_unic_id` и токен `maniya_token`. Токен можно передать через URL плагина:

```text
https://your-domain.com/maniya-online.js?token=USER_TOKEN
```

Или сохранить в Lampa Storage из другого вашего модуля:

```js
Lampa.Storage.set('maniya_token', 'USER_TOKEN')
```

## Сервер Maniya Online

В репозиторий добавлен минимальный Node.js-сервер для домена `plugin.maniya-kvn.online`.

### Локальный запуск

```bash
cd server
PUBLIC_BASE_URL=https://plugin.maniya-kvn.online PORT=3000 npm start
```

### Тестовый доступ

По умолчанию в `server/data/users.json` есть тестовый токен:

```text
demo-token
```

Плагин можно подключить так:

```text
https://plugin.maniya-kvn.online/maniya-online.js?token=demo-token
```

Перед production-запуском замените тестового пользователя и тестовый HLS-поток в `server/data/` на вашу реальную базу подписок и легальные источники.

## Что уже извлечено из исходного WTCH-кода

Разбор присланного примера находится в `docs/wtch-sample-analysis.md`. Там перечислены найденные storage-ключи, endpoint-ы, query-параметры, форматы ответа и то, что не стоит переносить в Maniya Online.

## Пошаговая инструкция для новичка

Если вы не знаете, что делать дальше, откройте `docs/novice-next-steps.md`. Там расписаны шаги: локальная проверка, DNS, SSH, деплой, HTTPS, подключение плагина в Lampa и замена тестовых данных.

## Проверка удалённого деплоя

После запуска деплоя используйте `scripts/verify-remote.sh`, чтобы проверить `/health`, файл плагина, API подписки, `nginx -t` и состояние `systemd`-сервиса. Текущий статус и команды собраны в `docs/deployment-status.md`.
