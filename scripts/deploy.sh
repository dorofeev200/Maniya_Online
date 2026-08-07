#!/usr/bin/env bash
set -euo pipefail

SERVER_HOST="${SERVER_HOST:-95.85.241.121}"
SERVER_USER="${SERVER_USER:-root}"
SERVER_PATH="${SERVER_PATH:-/opt/maniya-online}"
DOMAIN="${DOMAIN:-plugin.maniya-kvn.online}"
PORT="${PORT:-3000}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://${DOMAIN}}"

if ! command -v tar >/dev/null 2>&1 || ! command -v ssh >/dev/null 2>&1; then
  echo "tar and ssh are required" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Deploying Maniya Online to ${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}"

ssh "${SERVER_USER}@${SERVER_HOST}" "mkdir -p '${SERVER_PATH}'"

# rsync на Windows-стороне недоступен → tar-over-ssh (работает для аддитивных
# (и перезаписываемых) файлов заливки; не удаляет файлы, которых нет локально).
tar czf - \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='./server/.env' \
  --exclude='./server/data' \
  --exclude='./backup' \
  -C "${ROOT_DIR}" . | ssh "${SERVER_USER}@${SERVER_HOST}" "tar xzf - -C '${SERVER_PATH}'"

ssh "${SERVER_USER}@${SERVER_HOST}" bash -s <<REMOTE
set -euo pipefail
command -v node >/dev/null 2>&1 || apt-get update
command -v node >/dev/null 2>&1 || apt-get install -y nodejs npm
apt-get install -y nginx certbot python3-certbot-nginx || true
mkdir -p ${SERVER_PATH}/server/data

# .env НЕ перезаписываем — там реальные USERS_FILE/VIDEOS_FILE/KODIK_TOKEN.
# Шаблон создаётся только если файла ещё нет (первичный деплой).
if [ ! -f ${SERVER_PATH}/server/.env ]; then
cat > ${SERVER_PATH}/server/.env <<ENVFILE
NODE_ENV=production
HOST=0.0.0.0
PORT=${PORT}
PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
CORS_ORIGINS=${PUBLIC_BASE_URL}
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
TOKEN_MIN_LENGTH=8
SHUTDOWN_TIMEOUT_MS=10000
USERS_FILE=${SERVER_PATH}/server/data/users.json
VIDEOS_FILE=${SERVER_PATH}/server/data/videos.json
ENVFILE
fi

cat > /etc/systemd/system/maniya-online.service <<SERVICE
[Unit]
Description=Maniya Online Lampa server
After=network.target

[Service]
WorkingDirectory=${SERVER_PATH}/server
EnvironmentFile=${SERVER_PATH}/server/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
SERVICE
cat > /etc/nginx/sites-available/maniya-online <<'NGINX'
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/maniya-online /etc/nginx/sites-enabled/maniya-online
nginx -t
systemctl daemon-reload
systemctl enable --now maniya-online
systemctl restart maniya-online
systemctl reload nginx || true
if command -v certbot >/dev/null 2>&1; then
  certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos --register-unsafely-without-email || true
fi
REMOTE

echo "Deployment completed. Check: ${PUBLIC_BASE_URL}/health"