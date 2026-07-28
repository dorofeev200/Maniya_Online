# Что делать дальше: инструкция для новичка

Эта инструкция ведёт по шагам от текущего кода до проверки плагина в Lampa.

## Шаг 1. Проверить проект локально

В корне проекта выполнить:

```bash
./scripts/smoke-local.sh
```

Если всё хорошо, увидите 4 проверки:

1. `health` — сервер живой.
2. `subscription` — явно переданный токен активен.
3. `sources` — сервер отдаёт источник `Maniya Online`.
4. `videos` — сервер отдаёт реальные provider/static источники или пустой список.

Если этот шаг не проходит, деплой на VPS делать рано.

## Шаг 2. Понять, какие файлы за что отвечают

| Файл | Для чего нужен |
| --- | --- |
| `public/maniya-online.js` | Сам плагин, который подключается в Lampa |
| `server/src/index.js` | Мини-сервер: API подписок, источников и видео |
| `USERS_FILE` | Явно настроенное хранилище пользователей и подписок |
| `VIDEOS_FILE` | Опциональное явно настроенное статическое хранилище видео |
| `scripts/deploy.sh` | Автоматический деплой на VPS |
| `docs/wtch-sample-analysis.md` | Что вытянуто из старого WTCH-кода |

## Шаг 3. Настроить DNS

У домена `plugin.maniya-kvn.online` должна быть A-запись на IP сервера:

```text
plugin.maniya-kvn.online -> 95.85.241.121
```

Проверить можно так:

```bash
getent hosts plugin.maniya-kvn.online
```

Если команда ничего не показывает, DNS ещё не настроен или не успел обновиться.

## Шаг 4. Подготовить SSH-доступ

Скрипт деплоя подключается по SSH:

```bash
ssh root@95.85.241.121
```

Пароль не нужно записывать в файлы проекта. Лучше после первого входа добавить SSH-ключ и сменить пароль root.

## Шаг 5. Задеплоить на VPS

Когда SSH работает, выполнить из корня проекта:

```bash
SERVER_HOST=95.85.241.121 \
SERVER_USER=root \
DOMAIN=plugin.maniya-kvn.online \
./scripts/deploy.sh
```

Скрипт сам:

- скопирует проект в `/opt/maniya-online`;
- поставит `nginx`, `nodejs`, `npm`;
- создаст `systemd` service;
- настроит nginx proxy;
- запустит сервер.

## Шаг 6. Проверить сервер после деплоя

После деплоя открыть или выполнить:

```bash
curl http://plugin.maniya-kvn.online/health
```

Ожидаемый ответ:

```json
{"ok":true,"service":"maniya-online-lampa"}
```

Потом проверить токен:

```bash
TOKEN=YOUR_REAL_TOKEN curl "http://plugin.maniya-kvn.online/api/lampa/subscription/check?token=${TOKEN}"
```

Ожидаемый ответ:

```json
{"active":true,"plan":"paid","expires_at":"<ISO_DATE>","message":"Подписка Maniya Online активна"}
```

## Шаг 7. Подключить HTTPS

После HTTP-проверки подключить SSL:

```bash
ssh root@95.85.241.121
apt install -y certbot python3-certbot-nginx
certbot --nginx -d plugin.maniya-kvn.online
```

После этого проверять уже так:

```bash
curl https://plugin.maniya-kvn.online/health
```

## Шаг 8. Подключить плагин в Lampa

В Lampa добавить плагин:

```text
https://plugin.maniya-kvn.online/maniya-online.js?token=YOUR_REAL_TOKEN
```

Потом открыть карточку фильма/сериала. Должна появиться кнопка **Maniya Online**.

## Шаг 9. Заменить тестовые данные

### Пользователи

Файл:

```text
USERS_FILE
```

Файл должен содержать реальных пользователей:

```json
{
  "token": "USER_TOKEN",
  "email": "user@example.com",
  "plan": "paid",
  "active": true,
  "expires_at": "2099-12-31T23:59:59Z"
}
```

Для реального пользователя создавайте свой `token` и дату окончания подписки.

### Видео

Файл:

```text
VIDEOS_FILE
```

Статическое хранилище видео опционально. Если используете его, храните только реальные разрешённые HLS/MP4-ссылки.

## Шаг 10. Что делать после первой проверки

После того как плагин откроется в Lampa и получит реальные источники, следующий этап:

1. сделать добавление пользователей без ручного редактирования JSON;
2. добавить Telegram-бота или простую админку;
3. добавить реальные источники Maniya Online;
4. добавить историю просмотра, сезоны, озвучки и качества.
