// T026 P4: why is lite/rezka empty on Mutiny in our param form? Test slug/kp variants.
const { config } = await import('../server/src/config.js');
const { SkazClient } = await import('../server/src/providers/skaz/SkazClient.js');
const client = new SkazClient({
  hosts: config.skaz.hosts, accountEmail: config.skaz.accountEmail, uid: config.skaz.uid,
  origin: config.skaz.origin, timeoutMs: 8000, enabled: () => config.skaz.enabled !== false,
});
const RED = (u) => String(u ?? '').replace(/(account_email=)[^&]*/, '$1=R').replace(/(uid=)[^&]*/, '$1=R').replace(/(nws_id=)[^&]*/, '$1=R').replace(/(memkey=)[^&]*/, '$1=R');

// mutiny with our params; variant B uses externalids kp-override 5582050
const VARIANTS = {
  ours:      { id: '1288445', imdb_id: 'tt32338669', kinopoisk_id: '1288445', title: 'Мятеж', original_title: 'Mutiny', serial: '0', year: '2026', source: 'tmdb' },
  kpOverride:{ id: '1288445', imdb_id: 'tt32338669', kinopoisk_id: '5582050',  title: 'Мятеж', original_title: 'Mutiny', serial: '0', year: '2026', source: 'tmdb' },
  viaTmdbId: { id: '5582050', imdb_id: 'tt32338669', kinopoisk_id: '5582050',  title: 'Мятеж', original_title: 'Mutiny', serial: '0', year: '2026', source: 'tmdb' },
};
const SLUGS = ['rezka', 'hdrezka', 'hdreziya', 'hdego', 'fxapi'];
for (const [vname, q] of Object.entries(VARIANTS)) {
  for (const slug of SLUGS) {
    const t0 = Date.now();
    const out = { len: 0, status: 0 };
    const url = `${config.skaz.hosts[0]}/lite/${slug}?${new URLSearchParams({ ...q, account_email: config.skaz.accountEmail || '', uid: config.skaz.uid || '' })}`;
    try {
      const r = await fetch(url, { headers: { Origin: config.skaz.origin }, signal: AbortSignal.timeout(8000) });
      out.status = r.status; out.len = (await r.text()).length;
    } catch (e) { out.err = String(e).slice(0, 80); }
    console.log(`${vname.padEnd(12)} /lite/${slug.padEnd(8)} → ${out.status} len=${out.len}${out.ms ? '' : ' '}${String(Date.now() - t0)}ms`);
  }
}
// also: what did events actually give us (url+buildEventsUrl) for rezka?
const online = await client.getOnline(VARIANTS.ours, { timeoutMs: 9000 });
const rz = (online || []).filter((o) => o.url.includes('rezka'));
console.log('\nrezka rows in events:', JSON.stringify(RED(JSON.stringify(rz)).slice(0, 500)));