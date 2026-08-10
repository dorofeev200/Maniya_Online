// Санитайзер RAW-фикстуры Alloha video-JSON → server/test/fixtures/alloha-spiderman-video.json.
// Правила спеки: mask account_email/uid в URL, НО сохранить runtime-креды (token_movie/t) как есть —
// иначе тест перестанет отражать реальный дескриптор. Никакого реального email в файле.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = 'C:/tmp/showy/alloha-spiderman.video.json';
const out = path.join(here, '..', 'server', 'test', 'fixtures', 'alloha-spiderman-video.json');

const raw = readFileSync(src, 'utf8');
let j = JSON.parse(raw);

// ---- инспекция ----
console.log('size(bytes):', raw.length);
console.log('keys:', Object.keys(j).join(','));
console.log('quality:', Object.keys(j.quality || {}).join(','));
console.log('subtitles:', Array.isArray(j.subtitles) ? j.subtitles.length : '-');
console.log('segments:', JSON.stringify(j.segments));
console.log('hls_manifest_timeout:', j.hls_manifest_timeout);
console.log('leaks account_email:', /account_email=/.test(raw));
console.log('leaks uid=', /(&|\?)uid=/.test(raw));
console.log('leaks email-like:', /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(raw));
const orCount = String(j.url || '').match(/\s+or\s+|\s*%20or%20\s*/gi);
console.log('or-separators in url:', orCount ? orCount.length : 0);

// ---- маскировка авторизации в URL-полях (account_email/uid) ----
const maskUrl = (u) => {
  const s = String(u || '');
  return s
    .replace(/([?&]account_email=)[^&]*/gi, '$1MASKED_EMAIL')
    .replace(/([?&]uid=)[^&]*/gi, '$1MASKED_UID');
};
const walk = (node) => {
  if (typeof node === 'string') return maskUrl(node);
  if (Array.isArray(node)) return node.map(walk);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = walk(v);
    return out;
  }
  return node;
};
j = walk(j);

// ---- проверка после маскировки ----
const masked = JSON.stringify(j, null, 2);
console.log('after mask: has MASKED_EMAIL:', masked.includes('MASKED_EMAIL'));
console.log('after mask: real email-like remains:', /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(masked));
console.log('after mask: token_movie/t kept:', /token_movie/.test(masked) || /[?&]t=/.test(masked));

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, masked + '\n');
console.log('WROTE', out);