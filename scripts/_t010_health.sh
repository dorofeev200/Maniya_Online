#!/usr/bin/env bash
# T010 P4: production health check post-deploy.
set -uo pipefail
echo "=== systemd service ==="
systemctl show maniya-online -p ActiveState -p SubState -p NRestarts -p ExecMainPID
echo ""
echo "=== process ==="
ss -ltnp 2>/dev/null | grep -E ':3000' | head -3
echo ""
echo "=== health endpoint (local :3000) ==="
curl -s -o /dev/null -w "http_status=%{http_code}\n" http://127.0.0.1:3000/health || echo "health local FAIL"
echo "=== health endpoint (public nginx TLS) ==="
curl -s -o /dev/null -w "https_status=%{http_code} tls=%{ssl_verify_result}\n" https://plugin.maniya-kvn.online/health --max-time 20 || echo "health public FAIL"
echo ""
echo "=== nginx ==="
nginx -t 2>&1 | tail -2
echo ""
echo "=== recent prod app log: any 5xx / errors since restart? ==="
journalctl -u maniya-online --since "3 minutes ago" --no-pager 2>/dev/null | grep -iE '"statusCode":[5-9][0-9][0-9]|"level":"error"|error|FATAL' | tail -15 || true
echo "(no matches above = no 5xx/error lines)"
echo ""
echo "=== last 6 request log lines ==="
journalctl -u maniya-online --since "3 minutes ago" --no-pager 2>/dev/null | tail -6 || true
