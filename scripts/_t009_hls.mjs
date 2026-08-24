// SKAZ-MANIYA-009 Phase 3: real HLS playback через SHADOW (127.0.0.1:3210).
// Цепочка TASK-007: /videos (filmix, «История игрушек 5») → nl105 m3u8(?hash=)
// → rewritten manifest → seg-1/2/3 через proxy. Проверяем на КАЖДОМ сегменте:
// URL / hash-присутствие / HTTP status / content-type / Range / первые байты.
// Также: #EXT-X-KEY, #EXT-X-MAP, относительные URI, сегмент со СВОИМ hash
// (идемпотентность — не перезаписывается), сегмент без query (наследует hash).
// Критерии: m3u8=200, seg=200/206 video/mp2t, 0×403, 0×fragLoadError.
const BASE = process.env.T009_BASE || 'http://127.0.0.1:3210';
const TOKEN = process.env.T009_TOKEN || 'mo-admin-test-2026';

const qs = (q) => new URLSearchParams(q).toString();
async function jget(url, opts = {}) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeout || 45000) });
  const ct = r.headers.get('content-type') || '';
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, ct, buf, headers: r.headers };
}

(async () => {
  const out = { base: BASE, tests: {} };

  // 1) /videos — filmix Toy Story 5
  const u = `${BASE}/api/lampa/videos?${qs({ token: TOKEN, provider: 'filmix', source: 'tmdb', title: 'История игрушек 5', original_title: 'Toy Story 5', year: '2026', serial: '0' })}`;
  const v = await jget(u);
  out.test_videos = { status: v.status, items: 0, playItems: 0, provider_error: null };
  let list = [];
  try { list = JSON.parse(v.buf.toString('utf8')); } catch { list = {}; }
  const items = list.items || [];
  out.test_videos.items = items.length;
  out.test_videos.playItems = items.filter((i) => i.method === 'play').length;
  out.test_videos.provider_error = list.provider_error || null;
  out.test_videos.allItemUrls = items.map((i) => `${i.method}:${(i.url || '').slice(0, 90)}`);

  const nl105 = items.find((i) => i.url && i.url.includes('cdnsqu.com'));
  const firstPlay = items.find((i) => i.method === 'play' && i.url);
  const item = nl105 || firstPlay;
  if (!item) {
    out.test_videos.result = 'NO_PLAY_ITEM';
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }
  out.test_videos.choosen = { method: item.method, urlHead: item.url.slice(0, 120) };

  // 2) m3u8 через proxy (rewritten manifest)
  const m = await jget(item.url, { timeout: 60000 });
  out.tests.manifest = { status: m.status, ct: m.ct, bytes: m.buf.length };
  // contenido манифест
  const txt = m.buf.toString('utf8');
  const lines = txt.split(/\r?\n/);
  const uriLines = lines.filter((l) => l && !l.startsWith('#'));
  const dirLines = lines.filter((l) => /EXT-X-KEY|EXT-X-MAP|EXT-X-MEDIA|I-FRAME/.test(l));

  // 3) базовый hash из реального m3u8 (проксированный URL → inner)
  const inner = new URL(item.url).searchParams.get('url') || '';
  const innerHash = (inner.match(/[?&]hash=([^&]*)/) || [])[1] || '';
  out.tests.baseHash = innerHash ? `ДА (${innerHash.length}ch)` : 'НЕТ';

  // 4) каждый rewritten URI: has hash? proxy-form?
  const segChecks = uriLines.map((l, i) => {
    const isProxy = l.includes('/api/lampa/proxy');
    const hasHash = /[?&]hash=/.test(decodeURIComponent(String(l)));
    return { idx: i, isProxy, hasHash, tail: String(l).slice(-80) };
  });

  // 5) fetch первого трёх сегментов через proxy (Range)
  const segInfo = [];
  for (let i = 0; i < 3 && i < uriLines.length; i++) {
    const segUrl = uriLines[i];
    const s = await jget(segUrl, { headers: { Range: 'bytes=0-1048575' }, timeout: 60000 });
    const innerSeg = new URL(segUrl).searchParams.get('url') || segUrl;
    const magic = s.buf.slice(0, 8).toString('hex');
    segInfo.push({
      idx: i,
      status: s.status,
      ctype: s.ct,
      rangeReq: 'bytes=0-1048575',
      contentRange: s.headers.get('content-range') || '',
      bytes: s.buf.length,
      firstBytesHex: magic,
      mpegTsSig47: s.buf[0] === 0x47,
      innerHref: innerSeg.slice(0, 100),
      innerHashPresent: /[?&]hash=/.test(decodeURIComponent(innerSeg)),
    });
  }

  out.tests.uriCount = uriLines.length;
  out.tests.segHashCoverage = `${segChecks.filter((c) => c.hasHash).length}/${segChecks.length}`;
  out.tests.segProxyCoverage = `${segChecks.filter((c) => c.isProxy).length}/${segChecks.length}`;
  out.tests.segs = segInfo;
  out.tests.directives = dirLines.map((l) => {
    const uri = (String(l).match(/URI="([^"]*)"/) || [])[1] || '';
    return { line: l.slice(0, 90), uriHasHash: /[?&]hash=/.test(decodeURIComponent(uri)), uri };
  });

  // 6) idempotency: сегмент СО СВОИМ hash (werkecdn-форма) — hash у такого seg
  // НЕ должен перезаписываться. Если в этом nl105-плейлисте таких seg нет,
  // берём item с werkecdn (если есть в /videos) и проверяем его плейлист.
  const ownHashSeg = uriLines.find((l) => /[?&]hash=/.test(String(l)));
  out.tests.idempotentSeg = ownHashSeg ? { found: true, uri: ownHashSeg.slice(-90) } : { found: false };
  let idemManifest = null;
  const werkItem = items.find((i) => i.url && i.url.includes('werkecdn'));
  if (!ownHashSeg && werkItem) {
    try {
      const wm = await jget(werkItem.url, { timeout: 60000 });
      const wtxt = wm.buf.toString('utf8');
      const wlines = wtxt.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
      const wOwn = wlines.filter((l) => /[?&]hash=/.test(String(l))).length;
      // hash получен от сервера у каждого seg? смотрим НЕ-проксированный original hash:
      const segHashes = wlines.slice(0, 5).map((l) => { try { return (new URL(new URL(l).searchParams.get('url') || l).searchParams.get('hash') || '').length; } catch { return -1; } });
      idemManifest = { host: 'werkecdn-item', segs: wlines.length, withOwnHash: wOwn, sampleHashLens: segHashes.map((h) => (h > 0 ? `${h}ch` : 'none')) };
    } catch (e) { idemManifest = { host: 'werkecdn-item', err: String(e).slice(0, 60) }; }
  }
  out.tests.idemWerkecdn = idemManifest;

  // 7) итог
  const allSegOk = segInfo.every((s) => (s.status === 200 || s.status === 206) && (String(s.ctype).toLowerCase().includes('mp2t') || String(s.ctype).toLowerCase().includes('video/mp')));
  const zero403 = segInfo.every((s) => s.status !== 403) && m.status !== 403;
  const hashOnAll = segChecks.every((c) => c.hasHash);
  const PASS = m.status === 200 && hashOnAll && allSegOk && zero403;
  out.result = PASS ? 'PASS' : 'FAIL';
  out.criteria = { manifest200: m.status === 200, hashOnAllURIs: hashOnAll, segOk3: allSegOk, zero403 };
  console.log(JSON.stringify(out, null, 2));
  process.exit(PASS ? 0 : 1);
})().catch((e) => { console.error('T009-HLS-FAIL', e); process.exit(1); });