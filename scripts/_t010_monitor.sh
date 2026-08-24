#!/usr/bin/env bash
# T010 P9: post-deploy monitoring. Scan journalctl since deploy for 5xx and
# proxy/HLS/availability error signatures. NO hotfix.
set -uo pipefail
SINCE="2026-08-21 19:12:00"
echo "=== service state ==="
systemctl show maniya-online -p ActiveState -p NRestarts -p ExecMainPID
echo ""
echo "=== NRestarts vs pre-deploy (was 0) ==="
echo "NRestarts above should be 0 (no new restart after deploy)"
echo ""
echo "=== any 5xx status codes since deploy ==="
journalctl -u maniya-online --since "$SINCE" --no-pager 2>/dev/null | grep -oE '"statusCode":[0-9]{3}' | sort | uniq -c | sort -rn
echo "(empty = none)"
echo ""
echo "=== error-level / proxy / HLS / availability error signatures ==="
journalctl -u maniya-online --since "$SINCE" --no-pager 2>/dev/null | grep -iE '"level":"(error|fatal)"|fragLoadError|proxy_host_forbidden|not allowed|EADDRINUSE|unhandledRejection|TypeError|RangeError' | tail -20
echo "(empty = none)"
echo ""
echo "=== total request count since deploy and top-by-path ==="
journalctl -u maniya-online --since "$SINCE" --no-pager 2>/dev/null | grep -oE '"path":"[^"]*"' | sort | uniq -c | sort -rn | head -12
