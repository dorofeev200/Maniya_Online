// T026 P4: read the 429 body (who rejects: werkecdn CDN or edge) + retry-after + compare
// the SAME card resolved via cluster direct link format (events.url + cardParams, SKAZ shape)
import { writeFileSync, mkdirSync } from 'node:fs';
const { config } = await import('../server/src/config.js');
const { SkazClient } = await import('../server/src/providers/skaz/SkazClient.js');
const { SkazProvider } = await import('../server/src/providers/skaz/SkazProvider.js');
const RED = (u) => String(u ?? '').replace(/(account_email=)[^&]*/, '=$1=R').replace(/(uid=)[^&]*/, '=$1=R').replace(/(nws_id=)[^&]*/, '=$1=R');
mkdirSync('docs/t026', { recursive: true });

const client = new SkazClient({ hosts: config.skaz.hosts, accountEmail: config.skaz.accountEmail, uid: config.skaz.uid, origin: config.skaz.origin, timeoutMs: 8000, enabled: () => config.skaz.enabled !== false });
const QUERY = { id: '1288445', imdb_id: 'tt32338669', kinopoisk_id: '1288445', title: 'Мятеж', original_title: 'Mutiny', serial: '0', year: '2026', source: 'tmdb' };
const O = config.skaz.origin || 'https://lampa.mx';
const out = {};

const p = new SkazProvider({ id: 'skaz-filmix', balancer: 'filmix', hosts: config.skaz.hosts, accountEmail: config.skaz.accountEmail, uid: config.skaz.uid, origin: config.skaz.origin, show: true });
const res = await p.videos({ query: QUERY });
const wrapped = res.items?.[0]?.url || '';
const inner = wrapped.includes('/api/lampa/proxy?url=') ? decodeURIComponent(wrapped.split('/api/lampa/proxy?url=')[1].split('&')[0]) : wrapped;
const url = inner.split(' or ')[0].trim();
out.cdnUrl = RED(url).slice(0, 160);

// 1) full body of the 429
const body = new Promise((resolve) => {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 12000);
  fetch(url, { headers: { Origin: O, Referer: O + '/' }, signal: ctl.signal })
    .then(async (x) => resolve({ status: x.status, retryAfter: x.headers.get('retry-after') ?? '', server: x.headers.get('server') ?? '', body: (await x.text()).slice(0, 500) }))
    .catch((e) => { clearTimeout(tm); resolve({ status: 'ERR', err: String(e).slice(0, 80) }); });
});
const b = await body;
out.body429 = b;
console.log('429 body:', JSON.stringify(b));

// 2) SKAZ-shape request: events.url (lite/filmix) + cardParams + creds — our client's natural form
const t0 = Date.now();
const html = await client.getLite(p.buildPageParams(QUERY), {});
out.liteFilmix = { len: html?.length ?? 0, ms: Date.now() - t0, preview: RED((html || '').slice(0, 180)) };
console.log('lite/filmix(our client):', JSON.stringify(out.liteFilmix));
writeFileSync('docs/t026/werkecdn-body.json', JSON.stringify(out, null, 2), 'utf8');
console.log('→ docs/t026/werkecdn-body.json');