// T026 P4: probe underlying werkecdn CDN URL (extracted from our /videos proxy wrap)
// with header matrix + burst — reproduce/deny 429 Too Many Requests. Node: sequential, no AbortSignal.
import { writeFileSync, mkdirSync } from 'node:fs';
const { config } = await import('../server/src/config.js');
const { SkazClient } = await import('../server/src/providers/skaz/SkazClient.js');
const { SkazProvider } = await import('../server/src/providers/skaz/SkazProvider.js');
const RED = (u) => String(u ?? '').replace(/(account_email=)[^&]*/, '=$1=R').replace(/(uid=)[^&]*/, '=$1=R');
mkdirSync('docs/t026', { recursive: true });

const client = new SkazClient({ hosts: config.skaz.hosts, accountEmail: config.skaz.accountEmail, uid: config.skaz.uid, origin: config.skaz.origin, timeoutMs: 8000, enabled: () => config.skaz.enabled !== false });
const QUERY = { id: '1288445', imdb_id: 'tt32338669', kinopoisk_id: '1288445', title: 'Мятеж', original_title: 'Mutiny', serial: '0', year: '2026', source: 'tmdb' };
const O = config.skaz.origin || 'https://lampa.mx';

const p = new SkazProvider({ id: 'skaz-filmix', title: 'Maniya · filmix', balancer: 'filmix', hosts: config.skaz.hosts, accountEmail: config.skaz.accountEmail, uid: config.skaz.uid, origin: config.skaz.origin, show: true });
const res = await p.videos({ query: QUERY });
const wrapped = res.items?.[0]?.url || '';
const inner = wrapped.includes('/api/lampa/proxy?url=')
  ? decodeURIComponent(wrapped.split('/api/lampa/proxy?url=')[1].split('&')[0])
  : wrapped;
const url = inner.split(' or ')[0];
const out = { wrapped: RED(wrapped).slice(0, 130), inner: RED(url).slice(0, 130), items: res.items?.length ?? 0 };

async function probe(label, headers) {
  return new Promise((resolve) => {
    const ctl = new AbortController();
    const tm = setTimeout(() => { ctl.abort(); }, 10000);
    fetch(url, { headers: headers || {}, redirect: 'follow', signal: ctl.signal })
      .then((x) => { clearTimeout(tm); resolve({ status: x.status, ct: x.headers.get('content-type') || '' }); })
      .catch((e) => { clearTimeout(tm); resolve({ status: 'ERR', err: String(e).slice(0, 80) }); });
  });
}
out.probes = {};
out.probes.table1 = [];
out.probes.table1.push(['bare', await probe('bare', {})]);
out.probes.table1.push(['proxy-semantics', await probe('proxy', { Origin: O, Referer: O + '/' })]);
out.probes.table1.push(['ref-only', await probe('ref', { Referer: O + '/' })]);
out.probes.table1.push(['origin-only', await probe('origin', { Origin: O })]);
out.probes.table1.push(['ua-android', await probe('ua', { 'User-Agent': 'okhttp/4.9.0', Referer: O + '/' })]);
out.probes.range = await probe('range', { Range: 'bytes=0-1023', Referer: O + '/' });
out.probes.range2 = await probe('range2', { Range: 'bytes=0-1023' });
// burst 6x sequential — hotlink/rate-limit 429 check (same IP, same semantics as our proxy)
out.probes.burst = [];
for (let i = 1; i <= 6; i++) {
  out.probes.burst.push([`burst-${i}`, await probe('b' + i, { Origin: O, Referer: O + '/' })]);
}
for (const row of out.probes.table1) console.log(`${row[0].padEnd(16)} → ${row[1].status} ${row[1].ct} ${row[1].err || ''}`);
console.log(`range      → ${out.probes.range.status} ${out.probes.range.ct}`);
console.log(`range(noR) → ${out.probes.range2.status} ${out.probes.range2.ct}`);
for (const row of out.probes.burst) console.log(`${row[0].padEnd(16)} → ${row[1].status} ${row[1].ct} ${row[1].err || ''}`);
writeFileSync('docs/t026/filmix-wire.json', JSON.stringify(out, null, 2), 'utf8');
console.log('→ docs/t026/filmix-wire.json');