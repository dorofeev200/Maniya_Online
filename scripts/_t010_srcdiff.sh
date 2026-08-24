#!/usr/bin/env bash
# Compare prod src vs shadow src: filenames + content md5, show only divergences.
set -uo pipefail
rm -rf /tmp/srcdiff
mkdir -p /tmp/srcdiff/prod /tmp/srcdiff/shad
cp -r /opt/maniya-online/server/src /tmp/srcdiff/prod/
cp -r /tmp/fpg-shadow/server/src /tmp/srcdiff/shad/

echo "=== FILENAMES differ (prod vs shadow) ==="
diff <(cd /tmp/srcdiff/prod/src && find . -type f | sort) \
     <(cd /tmp/srcdiff/shad/src && find . -type f | sort) \
  && echo "SAME-FILENAMES"

echo ""
echo "=== CONTENT diff (paths with differing md5) ==="
cd /tmp/srcdiff/prod/src && find . -type f | sort | while read -r f; do
  pm=$(md5sum "$f" | awk '{print $1}')
  sm=$(cd /tmp/srcdiff/shad/src && md5sum "$f" | awk '{print $1}')
  if [ "$pm" != "$sm" ]; then
    echo "DIFF: $f  prod=$pm shadow=$sm"
  fi
done
echo "=== done ==="
