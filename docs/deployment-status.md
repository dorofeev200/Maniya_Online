# Статус деплоя plugin.maniya-kvn.online

## Цель

Конечные проверки должны пройти так:

```bash
curl https://plugin.maniya-kvn.online/health
curl -I "https://plugin.maniya-kvn.online/maniya-online.js?token=demo-token"
ssh root@95.85.241.121 'nginx -t'
ssh root@95.85.241.121 'systemctl is-enabled maniya-online && systemctl is-active maniya-online'
```

## Что подготовлено в репозитории

- `scripts/deploy.sh` — деплой на VPS.
- `scripts/verify-remote.sh` — финальная проверка HTTPS, плагина, API, nginx и systemd.
- `deploy/maniya-online.service` — systemd unit.
- `deploy/nginx-maniya-online.conf` — nginx reverse proxy.

## Блокер текущей среды

Из текущей среды SSH/TCP до `95.85.241.121` недоступен: `ssh` и `nc` возвращают `Network is unreachable`. Поэтому фактический удалённый деплой нужно запускать из сети, где доступен SSH к VPS.

Когда доступ к SSH есть, команда деплоя:

```bash
SERVER_HOST=95.85.241.121 \
SERVER_USER=root \
DOMAIN=plugin.maniya-kvn.online \
./scripts/deploy.sh
```

Финальная проверка:

```bash
DOMAIN=plugin.maniya-kvn.online \
SERVER_HOST=95.85.241.121 \
SERVER_USER=root \
./scripts/verify-remote.sh
```
