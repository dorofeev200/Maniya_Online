// T026 P4 final: who returns 429 — capture FULL response headers (Server/Via/CF/nginx,
// Set-Cookie, Retry-After) + a control URL from the SAME CDN host family.
import { writeFileSync, mkdirSync } from 'node:fs';
const { config } = await import('../server/src/config.js');
const { SkazClient } = await import('../server/src/providers/skaz/SkazClient.js');
const { SkazProvider } = await import('../server/src/providers/skaz/SkazProvider.js');
const RED = (u) => String(u ?? '').replace(/(account_email=)[^&]*/, '=$1=R').replace(/(uid=)[^&]*/, '=$1=R');
mkdirSync('docs/t026', { recursive: true });
const O = config.skaz.origin || 'https://lampa.mx';

const client = new SkazClient({ hosts: config.skaz.hosts, accountEmail: config.skaz.accountEmail, uid: config.skaz.uid, origin: config.skaz.origin, timeoutMs: 8000, enabled: () => config.skaz.enabled !== false });
const p = new SkazProvider({ id: 'skaz-filmix', balancer: 'filmix', hosts: config.skaz.hosts, accountEmail: config.skaz.accountEmail, uid: config.skaz.uid, origin: config.skaz.origin, show: true });
const res = await p.videos({ query: { id: '1288445', imdb_id: 'tt32338669', kinopoisk_id: '1288445', title: 'Мятеж', original_title: 'Mutiny', serial: '0', year: '2026', source: 'tmdb' } });
const wrapped = res.items?.[0]?.url || '';
const inner = wrapped.includes('/api/lampa/proxy?url=') ? decodeURIComponent(wrapped.split('/api/lampa/proxy?url=')[1].split('&')[0]) : wrapped;
const url = inner.split(' or ')[0].trim();
const hostname = new URL(url).hostname;
const out = { cdnUrl: RED(url).slice(0, 120), hostname };

await new Promise((r) => setTimeout(r, 4000)); // cooldown after burst
async function probe(label, target, headers, method = 'GET') {
  return new Promise((resolve) => {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 12000);
    fetch(target, { headers: headers || {}, redirect: 'manual', signal: ctl.signal, method })
      .then(async (x) => { clearTimeout(tm); resolve({ status: x.status, headers: Object.fromEntries([...x.headers.entries()].slice(0, 22)), body: (await x.text()).slice(0, 220) }); })
      .catch((e) => { clearTimeout(tm); resolve({ status: 'ERR', err: String(e).slice(0, 90) }); });
  });
}
out.probe429 = await probe('429', url, { Origin: O, Referer: O + '/' });
console.log('429 full:', JSON.stringify(out.probe429, null, 1));
if (out.probe429.status === 429 && out.probe429.headers['location']) { out.locFollow = await probe('loc', out.probe429.headers['location'], { Origin: O, Referer: O + '/' }); console.log('loc:', JSON.stringify(out.locFollow)); }
writeFileSync('docs/t026/429-headers.json', JSON.stringify(out, null, 2), 'utf8');
console.log('→ docs/t026/429-headers.json');