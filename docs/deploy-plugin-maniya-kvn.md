# Деплой на plugin.maniya-kvn.online

Ниже пример деплоя Node.js-сервера и статического плагина на VPS.

## 1. Установить Node.js и nginx

```bash
apt update
apt install -y nginx nodejs npm
```

## 2. Скопировать проект

```bash
mkdir -p /opt/maniya-online
rsync -av --delete ./ /opt/maniya-online/
cd /opt/maniya-online/server
```

## 3. Создать systemd service

```ini
[Unit]
Description=Maniya Online Lampa server
After=network.target

[Service]
WorkingDirectory=/opt/maniya-online/server
Environment=PORT=3000
Environment=PUBLIC_BASE_URL=https://plugin.maniya-kvn.online
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Сохранить файл как `/etc/systemd/system/maniya-online.service`, затем:

```bash
systemctl daemon-reload
systemctl enable --now maniya-online
```

## 4. Настроить nginx reverse proxy

```nginx
server {
    server_name plugin.maniya-kvn.online;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 5. Подключить HTTPS

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d plugin.maniya-kvn.online
```

## 6. Проверить

```bash
curl https://plugin.maniya-kvn.online/health
curl "https://plugin.maniya-kvn.online/api/lampa/subscription/check?token=demo-token"
```
