// PROVIDER DISCOVERY MATRIX (runs ON the VPS, targets prod :3000)
// Spider-Man control: TMDB 634649 / IMDb tt10872600 / KP 1309570 / 2021
// 1) For every enabled provider: /api/lampa/videos -> status/ms/items/method/voice/quality/error
// 2) For the first call-item: /api/lampa/video (lazy resolve) -> status/ms/method/hasUrl
// 3) DIRECT cluster probe: same lite/<balancer> request with OUR account vs E-ONLINE account
import { readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3000';
const users = JSON.parse(readFileSync('/opt/maniya-online/server/data/users.json', 'utf8'));
const arr = Array.isArray(users) ? users : (users.users || []);
const token = (arr.find((x) => x && x.active && x.token) || arr[0])?.token || '';

const SPIDER = {
  id: '634649', tmdb_id: '634649', imdb_id: 'tt10872600', kinopoisk_id: '1309570',
  title: 'Человек-паук: Нет пути домой', original_title: 'Spider-Man: No Way Home',
  serial: '0', year: '2021', source: 'tmdb'
};
const UA = 'Mozilla/5.0 Chrome/126';

async function get(url, headers = {}, readBody = true) {
  const t0 = Date.now();
  let r;
  try {
    r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers: { 'User-Agent': UA, ...headers } });
  } catch (e) {
    return { err: e.message, ms: Date.now() - t0, status: 0 };
  }
  const ms = Date.now() - t0;
  const ct = String(r.headers.get('content-type') || '').split(';')[0];
  if (!readBody) { await r.body?.cancel?.().catch?.(() => {}); return { ms, status: r.status, ct }; }
  const buf = Buffer.from(await r.arrayBuffer().catch(() => new Uint8Array(0)));
  return { ms, status: r.status, ct, bytes: buf.length, text: buf.toString('utf8') };
}

function qkeys(q) {
  if (!q) return '-';
  if (typeof q === 'string') return q;
  if (Array.isArray(q)) return q.join(',');
  return Object.keys(q).join(',') || '-';
}

async function discoverProvider(id) {
  const q = new URLSearchParams({ token, provider: id, ...SPIDER });
  const r = await get(`${BASE}/api/lampa/videos?${q}`);
  if (r.status !== 200) return { id, status: r.status, ms: r.ms, items: 0, err: r.err || 'HTTP ' + r.status };
  let body; try { body = JSON.parse(r.text || '{}'); } catch { return { id, status: r.status, ms: r.ms, items: 0, err: 'non-JSON body' }; }
  const items = body.items || [];
  const it = items[0] || {};
  return {
    id, status: r.status, ms: r.ms, items: items.length,
    method: it.method || '-', voice: it.voice_name || '-',
    qualities: qkeys(it.quality), err: ''
  };
}

async function lazyResolve(id, firstItem) {
  if (!firstItem || firstItem.method !== 'call' || !firstItem.url) return 'no-call';
  const url = firstItem.url.replace(/^https:\/\/plugin\.maniya-kvn\.online/, BASE);
  const r = await get(url);
  let play = null; try { play = JSON.parse(r.text || '{}'); } catch {}
  const qm = play?.quality && typeof play.quality === 'object' ? Object.keys(play.quality).join(',') : (play?.quality || '-');
  return `HTTP ${r.status} ${r.ms}ms method=${play?.method || '-'} url=${play?.url ? 'yes' : 'NO'} q=${qm}${r.err ? ' ERR=' + r.err : ''}`;
}

async function directClusterProbe(balancer, accountEmail, uid, label) {
  const host = 'http://online3.skaz.tv';
  const q = new URLSearchParams({
    id: '634649', imdb_id: 'tt10872600', tmdb_id: '634649', kinopoisk_id: '1309570',
    title: SPIDER.title, original_title: SPIDER.original_title,
    year: '2021', serial: '0', source: 'tmdb',
    account_email: accountEmail, uid
  });
  const r = await get(`${host}/lite/${balancer}?${q}`, { Origin: 'http://lampa.mx' });
  const firstLine = (r.text || '').split(/\r?\n/)[0].slice(0, 80).replace(/\s+/g, ' ');
  const method = /"method"\s*:\s*"(play|call|link)"/.exec(r.text || '')?.[1] || (/(videos__button|data-json)/i.test(r.text || '') ? 'html?' : '?');
  console.log(`  DIRECT ${label.padEnd(24)} ${balancer.padEnd(12)} ${host} -> HTTP ${r.status} ${r.ms}ms ${r.bytes}B method=${method}`);
  if (r.status !== 200) console.log(`    ${(r.text || r.err || '').slice(0, 160)}`);
}

async function main() {
  const r = await get(`${BASE}/api/lampa/sources?token=${encodeURIComponent(token)}`);
  const srcs = (JSON.parse(r.text || '{}').sources || []).filter((s) => s.show !== false);

  // account used by prod (for direct cluster comparison)
  const email = process.env.SKAZ_ACCOUNT_EMAIL || process.env.EO_ACCOUNT_EMAIL || '(нет в env)';
  console.log(`PROD account_email = ${email}`);
  console.log(`providers = ${srcs.map((s) => s.id).join(', ')}\n`);

  console.log('=== A. DISCOVERY MATRIX (/videos -> lazy /video) ===');
  const results = [];
  for (const s of srcs) {
    const d = await discoverProvider(s.id);
    const lazyTxt = d.items && d.method === 'call' ? 'lazy=' : '';
    results.push(d);
    let lazy = '';
    if (d.items) {
      // re-fetch first item URL for lazy
      const q = new URLSearchParams({ token, provider: s.id, ...SPIDER });
      const r2 = await get(`${BASE}/api/lampa/videos?${q}`);
      const it = (JSON.parse(r2.text || '{}').items || [])[0] || {};
      lazy = await lazyResolve(s.id, it);
    }
    console.log(`${d.id.padEnd(14)} HTTP ${d.status} ${String(d.ms).padStart(5)}ms items=${String(d.items).padStart(2)} ` +
      `method=${String(d.method).padEnd(4)} voice="${String(d.voice).padEnd(20)}" q=[${d.qualities}]${d.err ? ' ERR=' + d.err : ''}`);
    if (lazy && lazy !== 'no-call') console.log(`    ${lazyTxt}${lazy}`);
  }

  console.log('\n=== B. DIRECT CLUSTER: OUR account vs E-ONLINE account (online3) ===');
  for (const balancer of ['alloha', 'filmix', 'rezka', 'videoseed', 'kinoflix', 'veoveo', 'pidtor', 'hdvb']) {
    await directClusterProbe(balancer, email, process.env.SKAZ_UID || process.env.EO_UID || '', 'OUR');
    // SECURITY-001: сравнение с «E-ONLINE»-аккаунтом убрано — учётка снята/мертва,
    // креды не хранятся. При необходимости — задать через env EO_ACCOUNT_EMAIL/EO_UID.
    await directClusterProbe(balancer, process.env.EO_ACCOUNT_EMAIL || '<unset>', process.env.EO_UID || '', 'E-ONLINE');
  }
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
