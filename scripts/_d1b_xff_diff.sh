#!/usr/bin/env bash
# D1B read-only: mint SKAZ lite/lordfilm video.m3u8 from VPS with different header sets.
# Purpose: decide whether the node picks 'direct vkvideo.cloud' vs 'skaz.tv/proxy/<tok>'
# by (a) requester IP, (b) UA/origin headers, or (c) X-Forwarded-For. No code touched.
set -u
HOME_IP="${1:-}"
UA_LAMPA='Mozilla/5.0 (Linux; Android 10; Lampa) AppleWebKit/537.36 Lampa/0.16.2'
UA_CHROME='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
BASE='http://online5.skaz.tv/lite/lordfilm/video.m3u8'
Q='vkId=15566040291925&title=%D0%9C%D1%8F%D1%82%D0%B5%D0%B6&account_email=dorofeevigor20%40gmail.com&uid=wnoralpp&nws_id=ivplxwmxtmmyee1roiizjjru5c7flset'
URL="${BASE}?${Q}"
req() {
  local name="$1"; shift
  curl -sS -L --max-time 25 "$@" "$URL" -o "/tmp/d1b_${name}.json" -w "${name}: http=%{http_code} bytes=%{size_download} time=%{time_total}s\n"
}
req vps_lampa -H "User-Agent: $UA_LAMPA" -H 'Origin: http://lampa.mx' -H 'Referer: http://lampa.mx/'
if [ -n "$HOME_IP" ]; then
  req vps_xff -H "User-Agent: $UA_LAMPA" -H "X-Forwarded-For: $HOME_IP" -H 'Origin: http://lampa.mx'
fi
req vps_bare -H "User-Agent: $UA_CHROME"
for n in vps_lampa vps_xff vps_bare; do
  if [ -f "/tmp/d1b_${n}.json" ]; then
    echo "--- ${n} host/shape (masked) ---"
    grep -o '"url":"[^"]*"' "/tmp/d1b_${n}.json" | head -1 | sed -E 's#"url":"(https?)://([^/]+)[^"]*"#\1://\2#g'
    echo "    contains /proxy/: $(grep -c '/proxy/' "/tmp/d1b_${n}.json")"
  fi
done
echo "DONE"