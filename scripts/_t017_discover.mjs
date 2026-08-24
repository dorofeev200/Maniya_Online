// T017 discovery: найти поток VirusProject (~3.33 Mbps) через production API.
// GET-only, ничего не меняет.
import https from 'node:https';

const DOMAIN = 'plugin.maniya-kvn.online';
const TOKEN = process.env.TOKEN || 'mo-6678c195e56c3af34d4ebecb5f37f11c';

const agent = new https.Agent({ keepAlive: true });

const GET = async (path, ms = 60000) => {
  const t0 = Date.now();
  try {
    const r = await fetch(`https://${DOMAIN}${path}`, { agent, signal: AbortSignal.timeout(ms) });
    const body = await r.text().catch(() => '');
    let j = null; try { j = JSON.parse(body); } catch {}
    return { status: r.status, ms: Date.now() - t0, j, body };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, err: String(e).slice(0, 200) };
  }
};

const videos = (provider, t) => {
  const p = new URLSearchParams({ token: TOKEN, provider, id: t.id, title: t.title, original_title: t.on,
    original_language: 'en', serial: '0', year: t.year, source: 'tmdb', imdb_id: t.imdb, clarification: '0', similar: 'false' });
  return `/api/lampa/videos?${p}`;
};

const TITLES = [
  { key: 'mutiny',    id: '1288445', imdb: 'tt32338669', title: 'Мятеж',            on: 'Mutiny',          year: '2026' },
  { key: 'toystory5', id: '1084244', imdb: 'tt29355505', title: 'История игрушек 5', on: 'Toy Story 5',     year: '2026' },
  { key: 'interst',   id: '157372',  imdb: 'tt0816692',  title: 'Интерстеллар',      on: 'Interstellar',    year: '2014' },
];

const PROV = ['skaz-alloha', 'skaz-rezka', 'skaz-filmix'];

for (const t of TITLES) {
  for (const prov of PROV) {
    const r = await GET(videos(prov, t));
    const items = r.j?.items || [];
    console.log(`\n### ${prov} ${t.key} http=${r.status} ms=${r.ms} items=${items.length}`);
    for (const it of items) {
      console.log(`  [${it.method}] "${it.title}" tr="${it.translate}" q=${JSON.stringify(it.quality || null)}`);
      if (it.url) console.log(`     url: ${String(it.url).slice(0, 90)}`);
      if (it.subtitles && it.subtitles.length) console.log(`     subs: ${it.subtitles.length}`);
    }
    if (!/virus/i.test(JSON.stringify(items))) console.log('   (Voces VirusProject/NOT found in payload)');
  }
}