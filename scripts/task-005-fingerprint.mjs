// SKAZ-MANIYA-005 §5/§21: детерминированный fingerprint разворачиваемого кода.
// Хэширует ТОЛЬКО server/src/** + server/package.json (чистый runtime-код),
// в отсортированном порядке. Никаких test/data/node_modules/.env/scripts.
// Использование: node task-005-fingerprint.mjs <serverDir>
// Вывод:  <sha256>  <fileCount>
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const serverDir = process.argv[2];
if (!serverDir) { console.error('usage: node task-005-fingerprint.mjs <serverDir>'); process.exit(2); }

// Явный набор: только src/** и package.json на корне serverDir.
const isIncluded = (rel) => {
  if (!rel || rel.endsWith('.env')) return false;
  if (rel === 'package.json') return true;
  if (rel === 'src' || rel.startsWith('src/')) return true;
  return false;
};

function collect(dir, base) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(base, full).replace(/\\/g, '/');
    if (!isIncluded(rel)) continue;
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collect(full, base));
    else if (st.isFile()) out.push(rel);
  }
  return out;
}

const files = collect(serverDir, serverDir).sort();
const h = createHash('sha256');
for (const f of files) {
  h.update(f);
  h.update('\n');
  h.update(readFileSync(join(serverDir, f.replace(/\//g, sep))));
  h.update('\n');
}
console.log(`${h.digest('hex')}  ${files.length}`);
