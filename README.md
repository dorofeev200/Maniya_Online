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
