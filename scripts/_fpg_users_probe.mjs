// FINAL-PLAYBACK-GAP-001: что лежит в users.json — есть ли lampac_uid/account для rhsprem.
import { readFile } from 'node:fs/promises';
const d = JSON.parse(await readFile('/opt/maniya-online/server/data/users.json', 'utf8'));
console.log('count=', d.length);
console.log('keys=', Object.keys(d[0] || {}).join(','));
for (const u of d) {
  console.log('user:', JSON.stringify({
    id: u.id, email: u.email, token: String(u.token || '').slice(0, 6),
    uid: u.uid, lampac_uid: u.lampac_uid, side: u.side_id,
    access_skaz: (u.access || {}).skaz, extra: u.extra
  }));
}