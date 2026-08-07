#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-plugin.maniya-kvn.online}"
SERVER_HOST="${SERVER_HOST:-95.85.241.121}"
SERVER_USER="${SERVER_USER:-root}"
: "${TOKEN:?TOKEN must be set explicitly}"

HTTPS_BASE="https://${DOMAIN}"

echo "1) HTTPS health"
curl -fsS "${HTTPS_BASE}/health"
printf '\n\n'

echo "2) Plugin file"
curl -fsS -o /dev/null -w "HTTP %{http_code}, %{size_download} bytes\n" "${HTTPS_BASE}/maniya-online.js?token=${TOKEN}"

echo "3) Subscription check"
curl -fsS "${HTTPS_BASE}/api/lampa/subscription/check?token=${TOKEN}"
printf '\n\n'

echo "4) nginx config test over SSH"
ssh "${SERVER_USER}@${SERVER_HOST}" 'nginx -t'

echo "5) systemd service status over SSH"
ssh "${SERVER_USER}@${SERVER_HOST}" 'systemctl is-enabled maniya-online && systemctl is-active maniya-online && systemctl status maniya-online --no-pager -l | sed -n "1,25p"'
