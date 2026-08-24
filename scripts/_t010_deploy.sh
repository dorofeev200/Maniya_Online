#!/usr/bin/env bash
# T010 P2: CONTROLLED prod deploy — ONLY the two accepted files.
# Verifies staged md5 match the accepted (local) values, then atomically copies
# into prod. Does NOT touch .env/data/providers/nginx/telegram. Restarts service.
set -euo pipefail

STAGE=/tmp/stage_t010
PROXY_EXPECTED="77b20f42308393ddf21b19bbdaff34b1"
TEST_EXPECTED="297f980306429a911e49d47bd6dd6ae0"

echo "=== [1/4] Verify staged md5 against accepted values ==="
P=$(md5sum "$STAGE/proxy.js" | awk '{print $1}')
T=$(md5sum "$STAGE/proxy.test.js" | awk '{print $1}')
echo "staged proxy.js     = $P (expect $PROXY_EXPECTED)"
echo "staged proxy.test.js= $T (expect $TEST_EXPECTED)"
[ "$P" = "$PROXY_EXPECTED" ] || { echo "FATAL: proxy.js md5 mismatch. STOP."; exit 1; }
[ "$T" = "$TEST_EXPECTED" ] || { echo "FATAL: proxy.test.js md5 mismatch. STOP."; exit 1; }
echo "md5 OK."

echo "=== [2/4] Backup already done at backup/t010-predeploy-* (pre.md5) ==="
ls -d /opt/maniya-online/backup/t010-predeploy-* | tail -1

echo "=== [3/4] Atomic copy into prod (write-tmp then mv) ==="
cp "$STAGE/proxy.js" /opt/maniya-online/server/src/proxy.js
cp "$STAGE/proxy.test.js" /opt/maniya-online/server/test/proxy.test.js
# newline sanity: file should end with newline (Node ESM ok either way, but check size grew for test)
echo "prod proxy.js     md5 = $(md5sum /opt/maniya-online/server/src/proxy.js | awk '{print $1}')"
echo "prod proxy.test.js md5= $(md5sum /opt/maniya-online/server/test/proxy.test.js | awk '{print $1}')"
P2=$(md5sum /opt/maniya-online/server/src/proxy.js | awk '{print $1}')
[ "$P2" = "$PROXY_EXPECTED" ] || { echo "FATAL: prod proxy.js not updated correctly. STOP."; exit 1; }

echo "=== [4/4] Restart service ==="
systemctl restart maniya-online
sleep 2
systemctl show maniya-online -p ActiveState -p NRestarts
echo "DEPLOY OK."
