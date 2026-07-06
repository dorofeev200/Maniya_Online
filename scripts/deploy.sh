#!/usr/bin/env bash
set -euo pipefail

SERVER_HOST="${SERVER_HOST:-95.85.241.121}"
SERVER_USER="${SERVER_USER:-root}"
SERVER_PATH="${SERVER_PATH:-/opt/maniya-online}"
DOMAIN="${DOMAIN:-plugin.maniya-kvn.online}"
PORT="${PORT:-3000}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://${DOMAIN}}"

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Deploying Maniya Online to ${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}"

ssh "${SERVER_USER}@${SERVER_HOST}" "mkdir -p '${SERVER_PATH}'"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.env' \
  "${ROOT_DIR}/" "${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/"

ssh "${SERVER_USER}@${SERVER_HOST}" bash -s <<REMOTE
set -euo pipefail
apt update
apt install -y nginx nodejs npm
cat > /etc/systemd/system/maniya-online.service <<SERVICE
[Unit]
Description=Maniya Online Lampa server
After=network.target

[Service]
WorkingDirectory=${SERVER_PATH}/server
Environment=PORT=${PORT}
Environment=PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE
cat > /etc/nginx/sites-available/maniya-online <<NGINX
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
systemctl reload nginx
REMOTE

echo "Deployment completed. Check: ${PUBLIC_BASE_URL}/health"
