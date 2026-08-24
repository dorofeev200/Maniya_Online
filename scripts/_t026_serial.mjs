// TASK-SKAZ-MANIYA-026 Phase 5 (SERIAL P0): live chain for the serial card.
// search→events→season→episodes→resolve→final CDN status. READ-ONLY against cluster.
// Run: node scripts/_t026_serial.mjs   (from repo root)
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

const QUERY = { id: '94997', imdb_id: 'tt11198330', kinopoisk_id: '411406', title: 'Дом Дракона', original_title: 'House of the Dragon', serial: '1', year: '2022', source: 'tmdb' };
const out = { steps: {}, ok: false };

async function main() {
  // 1) search(): canonical record
  const provider = new SkazProvider({ id: 'skaz-kinopub', title: 'Maniya · kinopub', balancer: 'kinopub', hosts: config.skaz.hosts, accountEmail: config.skaz.accountEmail, uid: config.skaz.uid, origin: config.skaz.origin, show: true });
  const rec = await provider.search({ query: QUERY });
  out.steps.search = { count: rec.length, type: rec[0]?.type, id: rec[0]?.id };
  const rc = rec[0]?.metadata || {};

  // 2) getOnline (what /sources/card uses for the serial card)
  const online = await client.getOnline({ ...QUERY, ...rc, id: rc.id || QUERY.id, kinopoisk_id: QUERY.kinopoisk_id }, { timeoutMs: 9000 });
  out.steps.online = { status: Array.isArray(online) ? 'OK' : 'ERR', total: online?.length ?? 0, shown: online?.filter((o) => o.show === true).length ?? 0, first: online?.[0]?.name, rch: online?.filter((o) => o.rch === true).length ?? 0 };
  if (!Array.isArray(online) || !online.length) { write(); return; }

  // 3) season page (serialVideos path) — plain provider.videos via same normalizer
  for (const row of online) {
    if (!['kinopub', 'alloha', 'videoseed', 'veoveo', 'solntse'].includes(row.balanser)) continue;
    const p = new SkazProvider({ id: `skaz-${row.balanser}`, title: `Maniya · ${row.balanser}`, balancer: row.balanser, hosts: config.skaz.hosts, accountEmail: config.skaz.accountEmail, uid: config.skaz.uid, origin: config.skaz.origin, show: true });
    const t0 = Date.now();
    const res = await p.videos({ query: { ...QUERY, ...rc, voice: '0' } });
    out.steps.season = out.steps.season || {};
    out.steps.season[row.balanser] = {
      ms: Date.now() - t0,
      items: res.items?.length ?? 0,
      seasons: res.seasons?.length ?? 0,
      voices: res.voices?.length ?? 0,
      firstItem: res.items?.[0] ? { method: res.items[0].method, type: res.items[0].type, season: res.items[0].season, episode: res.items[0].episode, title: RED(res.items[0].title), url: RED(res.items[0].url).slice(0, 110) } : null,
      provider_error: res.provider_error || null,
    };
    if (res.items?.length) break;
  }

  // 4) episode resolve for a call-item if any
  const ep = (out.steps.season && Object.values(out.steps.season).find((v) => v.items));
  if (ep && ep.firstItem?.method === 'call') {
    const bal = Object.keys(out.steps.season).find((k) => out.steps.season[k] === ep);
    const p = new SkazProvider({ id: `skaz-${bal}`, balancer: bal, hosts: config.skaz.hosts, accountEmail: config.skaz.accountEmail, uid: config.skaz.uid, origin: config.skaz.origin, show: true });
    const t0 = Date.now();
    const rawUrl = await p.resolveSerialVideo({ ...QUERY, season: String(ep.firstItem.season), episode: String(ep.firstItem.episode), voice: '0' }, {}, (u) => u);
    out.steps.resolve = { ok: Boolean(rawUrl), method: rawUrl?.method, url: rawUrl?.url ? RED(rawUrl.url).slice(0, 110) : null, ms: Date.now() - t0 };
    if (rawUrl?.url) {
      // CDN status probe — no proxy, straight request, header matrix (hotlink check)
      const probes = await Promise.all([
        ['no-headers', undefined],
        ['origin', { Origin: config.skaz.origin || 'https://lampa.mx' }],
        ['referer', { Referer: config.skaz.origin || 'https://lampa.mx/' }],
        ['ua-mobile', { 'User-Agent': 'okhttp/4.9.0' }],
        ['range', { Range: 'bytes=0-1023' }],
      ].map(async ([k, h]) => {
        const r = await fetch(rawUrl.url, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(8000), method: 'GET' }).catch((e) => ({ e: String(e) }));
        return [k, { status: r.status || 'ERR', ct: (r.headers?.get?.('content-type')) || '', final: r.url && RED(r.url).slice(0, 90), err: r.e || '' }];
      }));
      out.steps.resolve.cdn_probes = Object.fromEntries(probes);
    }
  }

  write();
}
function write() { writeFileSync('docs/t026/serial-chain.json', JSON.stringify(out, null, 2), 'utf8'); console.log(JSON.stringify(out, null, 2)); console.log('→ docs/t026/serial-chain.json'); }
main().catch((e) => { out.fatal = String(e); write(); });