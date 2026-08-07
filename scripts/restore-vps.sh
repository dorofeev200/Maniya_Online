#!/usr/bin/env bash
set -euo pipefail

# Полное восстановление VPS с нуля (или перезапись состояния) из локального бэкапа.
# 1) Деплой кода + инфраструктура (systemd/nginx/tls) — скрипт deploy.sh (tar, сохраняет .env).
# 2) Восстановление .env и server/data/*.json из снимка, взятого backup-remote.sh.
#
# Usage:
#   bash scripts/restore-vps.sh [-s backup/snapshots/<stamp>] [DOMAIN=...]
# По умолчанию берётся самый свежий снимок из backup/snapshots/.

set -euo pipefail
SERVER_HOST="${SERVER_HOST:-95.85.241.121}"
SERVER_USER="${SERVER_USER:-root}"
SERVER_PATH="${SERVER_PATH:-/opt/maniya-online}"
DOMAIN="${DOMAIN:-plugin.maniya-kvn.online}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://${DOMAIN}}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SNAPSHOT="${SNAPSHOT:-}"
while getopts "s:" opt; do
  case "$opt" in
    s) SNAPSHOT="$OPTARG" ;;
    *) echo "unknown arg" >&2; exit 2 ;;
  esac
done

if [ -z "$SNAPSHOT" ]; then
  SNAPSHOT="$(ls -1dt "${ROOT_DIR}"/backup/snapshots/*/ 2>/dev/null | head -1)"
fi
if [ -z "$SNAPSHOT" ] || [ ! -d "$SNAPSHOT" ]; then
  echo "Нет бэкапа. Сначала: bash scripts/backup-remote.sh" >&2
  exit 1
fi
SNAPSHOT="$(cd "$SNAPSHOT" && pwd)"
echo "← Восстанавливаю из снимка: ${SNAPSHOT}"

echo "== [1/3] Деплой кода и инфраструктуры =="
SERVER_HOST="${SERVER_HOST}" \
SERVER_USER="${SERVER_USER}" \
DOMAIN="${DOMAIN}" \
bash "${ROOT_DIR}/scripts/deploy.sh"

echo "== [2/3] Восстановление состояния (незаменимые файлы) =="
# .env — поверх, гарантируя токены/пути; users.json / videos.json — в server/data/.
ssh "${SERVER_USER}@${SERVER_HOST}" "mkdir -p '${SERVER_PATH}/server/data'"
for f in .env users.json videos.json; do
  if [ -f "${SNAPSHOT}/${f}" ]; then
    target=""
    case "$f" in
      .env) target="${SERVER_PATH}/server/.env" ;;
      *)    target="${SERVER_PATH}/server/data/${f}" ;;
    esac
    scp -q "${SNAPSHOT}/${f}" "${SERVER_USER}@${SERVER_HOST}:${target}"
    echo "  ✓ ${SNAPSHOT}/${f} → ${target}"
  fi
done

echo "== [3/3] Reстарт и проверка =="
ssh "${SERVER_USER}@${SERVER_HOST}" "systemctl restart maniya-online && sleep 2 && systemctl is-active maniya-online && echo health: \$(curl -s http://127.0.0.1:3000/health)"

echo "Done. Live-проверка: bash scripts/verify-remote.sh (нужен TOKEN, см. data/users.json)"