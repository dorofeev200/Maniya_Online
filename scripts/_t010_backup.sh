#!/usr/bin/env bash
# T010 P2: pre-deploy backup of the exact files being replaced on prod.
# Backs up proxy.js + proxy.test.js (current prod versions = pre-fix state),
# plus a full src tree tarball for rollback completeness.
set -euo pipefail
BK="/opt/maniya-online/backup/t010-predeploy-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK"
cp /opt/maniya-online/server/src/proxy.js "$BK/proxy.js.pre"
cp /opt/maniya-online/server/test/proxy.test.js "$BK/proxy.test.js.pre"
tar czf "$BK/src.tgz" -C /opt/maniya-online/server src
# record md5 of pre state
( cd /opt/maniya-online/server && md5sum src/proxy.js test/proxy.test.js ) > "$BK/pre.md5"
echo "BACKUP_DIR=$BK"
cat "$BK/pre.md5"
ls -la "$BK"
