#!/usr/bin/env bash
set -euo pipefail

# Снимок незаменимого состояния VPS в ЛОКАЛЬНЫЙ бэкап (секреты не в git — см. .gitignore "backup/").
# Сохраняем то, что нельзя пересоздать деплоем кода:
#   server/.env           → токены (KODIK_TOKEN), пути USERS_FILE/VIDEOS_FILE
#   server/data/users.json — реальные подписки/токены пользователей
#   server/data/videos.json — кэш (опционален, если есть)
# Восстановление: scripts/restore-vps.sh.

SERVER_HOST="${SERVER_HOST:-95.85.241.121}"
SERVER_USER="${SERVER_USER:-root}"
REMOTE_BASE="${REMOTE_BASE:-/opt/maniya-online}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-${ROOT_DIR}/backup}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="${BACKUP_ROOT}/snapshots/${STAMP}"

if ! command -v scp >/dev/null 2>&1 || ! command -v ssh >/dev/null 2>&1; then
  echo "scp and ssh are required" >&2
  exit 1
fi

mkdir -p "${DEST}"
FILES=(
  "server/.env"
  "server/data/users.json"
  "server/data/videos.json"
)

echo "Backup VPS ${SERVER_USER}@${SERVER_HOST} → ${DEST}"
for rel in "${FILES[@]}"; do
  if ssh "${SERVER_USER}@${SERVER_HOST}" "test -f '${REMOTE_BASE}/${rel}'"; then
    scp -q "${SERVER_USER}@${SERVER_HOST}:${REMOTE_BASE}/${rel}" "${DEST}/$(basename "${rel}")"
    echo "  ✓ ${rel}"
  else
    echo "  – (нет на VPS) ${rel}"
  fi
done

# Валидация: критичные файлы непусты и содержат реальные данные.
# (grep вместо node-require — Windows-у node недоступны MSYS-пути вида /c/...)
ok=1
if [ -f "${DEST}/.env" ] && grep -q 'KODIK_TOKEN=.' "${DEST}/.env"; then
  echo "  ✓ .env с KODIK_TOKEN"
else
  echo "  ⚠ .env нет KODIK_TOKEN"; ok=0
fi
if [ -f "${DEST}/users.json" ] && grep -q '"token"' "${DEST}/users.json"; then
  echo "  ✓ users.json содержит токен(ы)"
else
  echo "  ⚠ users.json без токенов/не читается"; ok=0
fi

echo "{ \"host\":\"${SERVER_HOST}\", \"stamp\":\"${STAMP}\", \"files\":[${FILES[*]}] }" > "${DEST}/snapshot.json"
if [ "$ok" = "1" ]; then
  echo "Backup OK → ${DEST}"
else
  echo "Backup с предупреждениями → ${DEST} (проверить!)"
fi