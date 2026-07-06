# Эксплуатация Maniya Online Lampa

## Переменные окружения

Скопируйте `.env.example` в `.env` и измените значения под сервер.

| Переменная | Назначение |
| --- | --- |
| `NODE_ENV` | `production` для публичного запуска |
| `HOST` | адрес прослушивания, обычно `0.0.0.0` |
| `PORT` | порт Node.js сервера |
| `PUBLIC_BASE_URL` | публичный HTTPS URL сервиса |
| `CORS_ORIGINS` | список разрешённых Origin через запятую |
| `RATE_LIMIT_WINDOW_MS` | окно rate limit |
| `RATE_LIMIT_MAX` | максимум запросов на IP за окно |
| `TOKEN_MIN_LENGTH` | минимальная длина токена |
| `USERS_FILE` | путь к JSON с пользователями |
| `VIDEOS_FILE` | путь к JSON с видео |
| `PUBLIC_DIR` | путь к статике плагина |

## Проверки

```bash
npm --prefix server test
./scripts/smoke-local.sh
./scripts/verify-remote.sh
```

## Логи

Сервер пишет структурированные JSON-логи в stdout/stderr. В systemd смотреть так:

```bash
journalctl -u maniya-online -f
```

## systemd

```bash
systemctl status maniya-online --no-pager -l
systemctl restart maniya-online
systemctl is-enabled maniya-online
systemctl is-active maniya-online
```

## nginx

```bash
nginx -t
systemctl reload nginx
```

## SSL

Для первого выпуска сертификата:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d plugin.maniya-kvn.online
```

Certbot обычно сам добавляет auto-renew timer. Проверка:

```bash
systemctl list-timers | grep certbot
certbot renew --dry-run
```

## GitHub Actions deploy

Нужно добавить secrets:

- `VPS_HOST` — `95.85.241.121`
- `VPS_USER` — `root` или отдельный deploy-пользователь
- `VPS_DOMAIN` — `plugin.maniya-kvn.online`
- `VPS_SSH_KEY` — приватный SSH-ключ без пароля или с настроенным агентом

Workflow запускает тесты, деплой и удалённую проверку.
