const { execSync } = require('node:child_process');
const { readdirSync, statSync } = require('node:fs');
const path = require('node:path');

function tree(root, dirs) {
  const out = new Set();
  for (const d of dirs) {
    const p = path.join(root, d);
    if (!(statSync(p, { throwIfNoEntry: false }) || {}).isDirectory()) continue;
    (function walk(dir) {
      for (const e of readdirSync(dir)) {
        const full = path.join(dir, e);
        if (statSync(full).isDirectory()) walk(full);
        else out.add(path.relative(root, full).split(path.sep).join('/'));
      }
    })(p);
  }
  return out;
}
const local = tree('server', ['src', 'test', 'test-helpers']);
const prodRaw = execSync("ssh -o BatchMode=yes root@95.85.241.121 'cd /opt/maniya-online/server && find src test test-helpers -type f 2>/dev/null'", { encoding: 'utf8' });
const prod = new Set(prodRaw.split('\n').map((s) => s.trim()).filter(Boolean));

console.log('MANIFEST local=' + local.size + ' prod=' + prod.size);
const prodOnly = [...prod].filter((x) => !local.has(x)).sort();
const localOnly = [...local].filter((x) => !prod.has(x)).sort();
console.log('\n=== PROD-ONLY (stale, REMOVE) ' + prodOnly.length + ' ===');
for (const p of prodOnly) console.log('  ' + p);
console.log('\n=== LOCAL-ONLY (new, DEPLOY) ' + localOnly.length + ' ===');
for (const p of localOnly) console.log('  ' + p);
