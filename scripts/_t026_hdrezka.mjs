// TASK-SKAZ-MANIYA-026 Phase 4 (HDREZKA 429): wire-level investigate.
// mutiny movie → events → rezka row → resolveMovieVideo (passthrough) → raw CDN URL,
// probe with header matrix vs SKAZ-style direct request. READ-ONLY.
// Run: node scripts/_t026_hdrezka.mjs   (from repo root)
import { writeFileSync, mkdirSync } from 'node:fs';
const { config } = await import('../server/src/config.js');
const { SkazClient } = await import('../server/src/providers/skaz/SkazClient.js');
const { SkazProvider } = await import('../server/src/providers/skaz/SkazProvider.js');

const RED = (u) => String(u ?? '').replace(/(account_email=)[^&]*/, '$1=R').replace(/(uid=)[^&]*/, '$1=R').replace(/(nws_id=)[^&]*/, '$1=R').replace(/(memkey=)[^&]*/, '$1=R');
mkdirSync('docs/t026', { recursive: true });

const client = new SkazClient({
  hosts: config.skaz.hosts, accountEmail: config.skaz.accountEmail, uid: config.skaz.uid,
  origin: config.skaz.origin, timeoutMs: 8000, enabled: () => config.skaz.enabled !== false,
});
const QUERY = { id: '1288445', imdb_id: 'tt32338669', kinopoisk_id: '1288445', title: 'Мятеж', original_title: 'Mutiny', serial: '0', year: '2026', source: 'tmdb' };
const out = { config: {}, chain: {}, ok: false };

const HDR_PROBE = async (url, label, extra) => {
  const r = await fetch(url, { headers: extra, redirect: 'follow', signal: AbortSignal.timeout(10000) })
    .then((x) => ({ status: x.status, ct: x.headers.get('content-type') || '', len: x.headers.get('content-length') || '', final: RED(x.url).slice(0, 100) }))
    .catch((e) => ({ status: 'ERR', err: String(e).slice(0, 140) }));
  console.log(`  ${label.padEnd(14)} → ${r.status} ${r.ct} ${r.err || ''}`);
  return { [label]: r };
};

async function probeRezka() {
  const online = await client.getOnline(QUERY, { timeoutMs: 9000 });
  out.chain.online = { total: online?.length ?? 0, shown: online?.filter((o) => o.show === true).length ?? 0, first: online?.[0]?.name };
  if (!Array.isArray(online)) { console.log('online ERR'); return; }
  const row = online.find((o) => ['rezka', 'hdrezka', 'hdreziya'].includes(o.balanser)) || online.find((o) => o.name.toLowerCase().includes('hd')) || online.find((o) => o.rch === true);
  if (!row) { console.log('no rezka row'); out.chain.missing = online.map((o) => o.name + '/' + o.balanser).slice(0, 12); out.chain.raw = RED(JSON.stringify(online).slice(0, 400)); return; }
  out.chain.row = { name: row.name, balanser: row.balanser, rch: row.rch, url: RED(row.url), index: row.index };
  const p = new SkazProvider({ id: `skaz-${row.balanser}`, title: `Maniya · ${row.balanser}`, balancer: row.balanser, hosts: config.skaz.hosts, accountEmail: config.skaz.accountEmail, uid: config.skaz.uid, origin: config.skaz.origin, show: true });
  // raw cluster page for rezka on Mutiny — cards, voices, episodes
  const rawHtml = await p.client.getLite(p.buildPageParams(QUERY), {});
  const rawCards = rawHtml ? p.normalizer.cards(rawHtml) : [];
  out.chain.rawCards = { htmlLen: rawHtml?.length ?? 0, cards: rawCards.slice(0, 12).map((c) => ({ method: c.method, title: c.title ?? '', href: RED(c.href || c.url).slice(0, 90), s: c.s, e: c.e, balanser: c.balanser, translate: c.translate })) };
  out.chain.voices = (rawHtml ? p.normalizer.voices(rawCards) : []).map((v) => v.name).slice(0, 8);
  console.log('rawCards', JSON.stringify(out.chain.rawCards));
  console.log('voices', JSON.stringify(out.chain.voices));
  const t0 = Date.now();
  const res = await p.resolveMovieVideo(QUERY, {}, (u) => u); // passthrough → raw CDN
  out.chain.resolve = { ok: Boolean(res), ms: Date.now() - t0, method: res?.method, type: res?.type, provider_error: res?.provider_error || null };
  // full /videos path — what the client actually receives for rezka
  const tv = await p.videos({ query: QUERY });
  out.chain.videos = { items: tv.items?.length ?? 0, first: tv.items?.[0] ? { method: tv.items[0].method, title: RED(tv.items[0].title), url: RED(tv.items[0].url).slice(0, 120), qualityKeys: tv.items[0].quality ? Object.keys(tv.items[0].quality).slice(0, 6) : [] } : null, provider_error: tv.provider_error || null };
  console.log('videos:', JSON.stringify(out.chain.videos));
  if (!res?.url) {
    // fallback: resolve the first call-item from videos path via resolveMovieVideo-style URL
    console.log('resolve= null'); return;
  }
  const url = res.url.split(' or ')[0];
  out.chain.rawUrl = RED(url);
  console.log('rezka raw:', RED(url));
  // header matrix — what a direct (SKAZ-style) player request needs
  const probes = {};
  Object.assign(probes, await HDR_PROBE(url, 'no-headers'));
  Object.assign(probes, await HDR_PROBE(url, 'origin', { Origin: 'https://lampa.mx' }));
  Object.assign(probes, await HDR_PROBE(url, 'referer', { Referer: 'https://lampa.mx/' }));
  Object.assign(probes, await HDR_PROBE(url, 'ref+origin', { Origin: 'https://lampa.mx', Referer: 'https://lampa.mx/' }));
  Object.assign(probes, await HDR_PROBE(url, 'ua-android', { 'User-Agent': 'okhttp/4.9.0', Referer: 'https://lampa.mx/' }));
  Object.assign(probes, await HDR_PROBE(url, 'range', { Range: 'bytes=0-1023', Referer: 'https://lampa.mx/' }));
  Object.assign(probes, await HDR_PROBE(url, 'ua-safari', { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' }));
  out.probes = probes;
}
await probeRezka();
writeFileSync('docs/t026/hdrezka-wire.json', JSON.stringify(out, null, 2), 'utf8');
console.log('→ docs/t026/hdrezka-wire.json');