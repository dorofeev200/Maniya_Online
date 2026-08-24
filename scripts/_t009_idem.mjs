// Идемпотентность inheritBaseQuery на живом werkecdn (nl221): rewrite не должен
// ПЕРЕЗАПИСЫВАТЬ собственный hash сегментов hash-ом базы (missing-check per key).
const BASE = process.env.B || 'http://127.0.0.1:3210';
const TOKEN = process.env.T || '';
const qs = (o) => new URLSearchParams(o).toString();
async function g(u) { const r = await fetch(u, { signal: AbortSignal.timeout(60000) }); return { s: r.status, b: Buffer.from(await r.arrayBuffer()) }; }
const hashOf = (u) => { try { const inn = new URL(String(u)).searchParams.get('url'); return inn ? new URL(inn).searchParams.get('hash') || '' : ''; } catch { return ''; } };
(async () => {
  const v = await g(`${BASE}/api/lampa/videos?${qs({ token: TOKEN, provider: 'filmix', source: 'tmdb', title: 'История игрушек 5', original_title: 'Toy Story 5', year: '2026', serial: '0' })}`);
  const items = JSON.parse(v.b.toString()).items || [];
  const werk = items.find((i) => i.url && i.url.includes('werkecdn'));
  if (!werk) { console.log('NO_WERKECDN_ITEM'); process.exit(0); }
  const baseUrl = new URL(werk.url).searchParams.get('url') || '';
  const baseHashDirect = (baseUrl.match(/[?&]hash=([^&]+)/) || [])[1] || '';
  const m = await g(werk.url);
  const lines = m.b.toString().split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const segInfos = lines.slice(0, 8).map((l) => ({ innerHash: hashOf(l) }));
  const wOwnHash = segInfos.filter((s) => s.innerHash).length;
  const own = segInfos.filter((s) => s.innerHash && s.innerHash !== baseHashDirect).length;
  const inherited = segInfos.filter((s) => s.innerHash && s.innerHash === baseHashDirect).length;
  console.log(JSON.stringify({
    baseHashLen: baseHashDirect.length,
    baseHashHead: baseHashDirect.slice(0, 12),
    segsTotal: lines.length,
    sampled: segInfos.length,
    wOwnHash,
    ownHashNotOverwritten: own,
    equalBaseHash: inherited
  }, null, 1));
})();