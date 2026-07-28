#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3100}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-http://127.0.0.1:${PORT}}"
: "${TOKEN:?TOKEN must be set explicitly}"
LOG_FILE="${LOG_FILE:-/tmp/maniya-online-smoke.log}"
PID_FILE="${PID_FILE:-/tmp/maniya-online-smoke.pid}"

cleanup() {
  if [[ -f "${PID_FILE}" ]]; then
    local pid
    pid="$(cat "${PID_FILE}")"
    if kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1 || true
    fi
    rm -f "${PID_FILE}"
  fi
}
trap cleanup EXIT

PORT="${PORT}" PUBLIC_BASE_URL="${PUBLIC_BASE_URL}" node server/src/index.js >"${LOG_FILE}" 2>&1 &
echo $! >"${PID_FILE}"
sleep 1

echo "1) Checking health"
curl -fsS "${PUBLIC_BASE_URL}/health"
printf '\n\n'

echo "2) Checking subscription"
curl -fsS "${PUBLIC_BASE_URL}/api/lampa/subscription/check?token=${TOKEN}"
printf '\n\n'

echo "3) Checking sources"
curl -fsS "${PUBLIC_BASE_URL}/api/lampa/sources?token=${TOKEN}"
printf '\n\n'

echo "4) Checking videos"
curl -fsS "${PUBLIC_BASE_URL}/api/lampa/videos?token=${TOKEN}"
printf '\n\nSmoke test passed. Server log: %s\n' "${LOG_FILE}"
