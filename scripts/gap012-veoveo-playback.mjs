#!/usr/bin/env node
// GAP-012 ЭТАП 7 — playback-проверка через NEW shadow (:3100).
// Полная цепочка, каждая ступень ЧЕРЕЗ прокси shadow (не напрямую):
//   master-манифест (206 HLS, переписан) → первый variant → variant-манифест →
//   первый сегмент → TS 0x47. Читает тело манифеста и берёт первый не-# URL,
//   переписывает host на shadow base и снова проксирует.
// READ-ONLY (только GET). Аргументы: <base> <movieKey> <serialKey>
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:3100';
const MOVIE = process.argv[3] || 'odyssey';
const SERIAL = process.argv[4] || 'hotd';

const TOKEN = (() => {
  try {
    const users = JSON.parse(readFileSync('/tmp/maniya-shadow/data/users.json', 'utf8'));
    const arr = Array.isArray(users) ? users : [users];
    return (arr.find((u) => u.token) || arr[0])?.token || '';
  } catch { return ''; }
})();

const TITLES = {
  odyssey: { id: '1368337', kp: '6385370', imdb: 'tt33764258', title: 'Одиссея', year: 2026, serial: 0 },
  forrest: { id: '14', kp: '448', imdb: 'tt0109830', title: 'Форрест Гамп', year: 1994, serial: 0 },
  hotd: { id: '94997', kp: '1316601', imdb: 'tt11198330', title: 'Дом Дракона', year: 2022, serial: 1 }
};

function rewriteHost(url, base) {
  const u = new URL(url);
  const b = new URL(base);
  u.protocol = b.protocol; u.host = b.host; u.port = b.port;
  return u.toString();
}

/** Через прокси инстанса: вернуть {status, ct, body(buffer), head}. */
async function viaProxy(base, proxyUrl, maxBytes = 262144) {
  const url = rewriteHost(proxyUrl, base);
  const t0 = Date.now();
  let res;
  try { res = await fetch(url, { headers: { range: 'bytes=0-' + (maxBytes - 1), accept: '*/*' } }); }
  catch (e) { return { err: String((e && e.message) || e), ms: Date.now() - t0 }; }
  const ct = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, ct, body: buf, ms: Date.now() - t0, head: buf.subarray(0, 256).toString('utf8') };
}

/** Первая ссылка (не-#) в манифесте. */
function firstSegmentUrl(manifestText, baseUrl) {
  const line = manifestText.split(/\r?\n/).find((l) => { const t = l.trim(); return t && !t.startsWith('#'); });
  if (!line) return null;
  try { return new URL(line.trim(), baseUrl).toString(); } catch { return null; }
}

async function probePlayback(base, t, label) {
  const q = { id: String(t.id), title: t.title, original_title: t.original_title, year: String(t.year), original_language: 'en', source: 'tmdb', serial: String(t.serial) };
  if (t.imdb) q.imdb_id = t.imdb;
  if (t.kp) q.kinopoisk_id = String(t.kp);
  const qs = new URLSearchParams({ ...q, provider: 'skaz-veoveo', token: TOKEN });
  const res = await fetch(`${base}/api/lampa/videos?${qs}`, { headers: { accept: 'application/json' } });
  const body = await res.json();
  const items = Array.isArray(body.items) ? body.items : [];
  const play = items.find((i) => i.method === 'play');
  if (!play) return { label, err: 'NO play item' };

  const row = { label, step1_master: null, step2_variant: null, step3_segment: null };

  // 1) master
  const master = await viaProxy(base, play.url);
  row.step1_master = { status: master.status, ct: master.ct, ms: master.ms };
  if (!(master.status >= 200 && master.status < 300) || !/mpegurl/i.test(master.ct)) {
    row.err = `master ${master.status} ${master.ct} head=${master.head.slice(0, 60)}`;
    return row;
  }
  const masterText = master.body.toString('utf8');
  row.masterHasProxySegments = masterText.includes('/api/lampa/proxy');

  // 2) variant (первый URL мастера)
  const variantUrl = firstSegmentUrl(masterText, master.url);
  if (!variantUrl) { row.err = 'no variant in master'; return row; }
  const variant = await viaProxy(base, variantUrl);
  row.step2_variant = { status: variant.status, ct: variant.ct, ms: variant.ms };
  if (!(variant.status >= 200 && variant.status < 300) || !/mpegurl/i.test(variant.ct)) {
    row.err = `variant ${variant.status} ${variant.ct}`;
    return row;
  }
  const variantText = variant.body.toString('utf8');

  // 3) сегмент (первый URL варианта)
  const segUrl = firstSegmentUrl(variantText, variantUrl);
  if (!segUrl) { row.err = 'no segment in variant'; return row; }
  const seg = await viaProxy(base, segUrl);
  const isTs = seg.status === 206 && seg.body.length > 0 && seg.body[0] === 0x47;
  row.step3_segment = { status: seg.status, ct: seg.ct, bytes: seg.body.length, ts0x47: isTs, ms: seg.ms };
  if (!isTs) row.err = `segment not TS: ${seg.status} ${seg.ct} head=${seg.body.subarray(0, 16).toString('hex')}`;

  return row;
}

async function main() {
  const movie = TITLES[MOVIE];
  const serial = TITLES[SERIAL];
  const rows = [];
  if (movie) { const r = await probePlayback(BASE, movie, `${MOVIE} (movie)`); rows.push(r); console.log(JSON.stringify(r)); await new Promise((r2) => setTimeout(r2, 150)); }
  if (serial) { const r = await probePlayback(BASE, serial, `${SERIAL} (serial)`); rows.push(r); console.log(JSON.stringify(r)); }
  const ok = rows.every((r) => !r.err && r.step3_segment?.ts0x47);
  console.log(ok ? 'PLAYBACK_OK' : 'PLAYBACK_FAIL');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
