// T015 acceptance: реальный путь plugin.maniya-kvn.online → Moscow (pinned IP + TLS).
// Env: IP (default 135.106.195.203), TOKEN (default mo-admin-test-2026), OLD (для A/B card, default plugin/OLD IP).
import https from 'node:https';
import dns from 'node:dns';

const IP = process.env.IP || '135.106.195.203';
const TOKEN = process.env.TOKEN || 'mo-admin-test-2026';
const DOMAIN = 'plugin.maniya-kvn.online';
const OLD_IP = process.env.OLD_IP || '95.85.241.121';

const agentFor = (ip) => new https.Agent({
  keepAlive: true,
  lookup: (host, opts, cb) => cb(null, ip, 4),
  servername: DOMAIN,
});
const AGENT = agentFor(IP);
const OLD_AGENT = agentFor(OLD_IP);

const cardParams = (t) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ id: '', imdb_id: '', kinopoisk_id: '', title: t.title, original_title: t.on, original_language: '', serial: t.serial, year: t.year, source: 'tmdb' }))
    if (v !== '' && v != null) p.set(k, v);
  return p;
};

const GET = async (base, path, agent, ms = 90000) => {
  const t0 = Date.now();
  try {
    const r = await fetch(`${base}${path}`, { agent, signal: AbortSignal.timeout(ms) });
    const body = await r.text().catch(() => '');
    let j = null; try { j = JSON.parse(body); } catch {}
    return { status: r.status, ms: Date.now() - t0, j, body: body.slice(0, 400) };
  } catch (e) { return { status: 0, ms: Date.now() - t0, err: String(e).slice(0, 90) }; }
};

const TITLES = [
  { key: 'toystory5',   title: 'История игрушек 5', on: 'Toy Story 5',         year: '2026', serial: '0' },
  { key: 'interstellar',title: 'Интерстеллар',       on: 'Interstellar',        year: '2014', serial: '0' },
  { key: 'drakon',      title: 'Дом дракона',        on: 'House of the Dragon', year: '2022', serial: '1' },
  { key: 'forrest',     title: 'Форрест Гамп',       on: 'Forrest Gump',        year: '1994', serial: '0' },
];

const classify = (st, items, body) => {
  if (st === 0) return 'EGRESS/NET';
  if (st === 403) return body.includes('subscription_required') ? 'AUTH-403' : 'EGRESS-403';
  if (st >= 500) return 'APP-ERROR-5xx';
  if (st === 200 && Array.isArray(items) && items.length > 0) return 'PASS';
  if (st === 200 && Array.isArray(items) && items.length === 0) return 'EMPTY';
  return `ST-${st}`;
};

const pickUrl = (j) => {
  const items = j?.items || [];
  const it = items.find((x) => x?.url) || items[0];
  if (!it) return null;
  return it.url || it.play?.url || null;
};

const probePlay = async (base, url, agent) => {
  if (!url) return { skipped: 'no-url' };
  // url уже реального пути: если внешний хост → прогоняем ЧЕРЕЗ proxy домена (real path)
  let p = url;
  try {
    const u = new URL(url);
    if (u.hostname !== DOMAIN) p = `${base}/proxy?url=${encodeURIComponent(url)}`;
  } catch { p = url; }
  const t0 = Date.now();
  const fr = await fetch(p, {
    agent: String(p).startsWith('https://plugin.maniya-kvn.online') ? AGENT : undefined,
    headers: { Range: 'bytes=0-65535' },
    signal: AbortSignal.timeout(60000),
  }).then(async (r) => ({ status: r.status, headers: { cr: r.headers.get('content-range') || '', ct: r.headers.get('content-type') || '' }, body: await r.arrayBuffer().then((b) => b.byteLength) })).catch((e) => ({ status: 0, err: String(e).slice(0, 60), headers: {}, body: 0 }));
  return { status: fr.status, err: fr.err, ctype: (fr.headers.ct || '').slice(0, 24), contentRange: fr.headers.cr || '', gotBytes: fr.body, ms: Date.now() - t0,
    isM3u8: /m3u8/.test(fr.headers.ct || ''), isMp4: /mp4/.test(fr.headers.ct || '') };
};

const main = async () => {
  const BASE = `https://${DOMAIN}`;
  console.log('ACCEPT real path via plugin.maniya-kvn.online → ' + IP + '\n');

  // 1) health
  const h = await GET(BASE, '/health', AGENT);
  console.log(JSON.stringify({ check: 'health', status: h.status, body: h.body.slice(0, 60), ms: h.ms }));

  // 2) sources
  const s = await GET(BASE, `/api/lampa/sources?token=${TOKEN}`, AGENT);
  console.log(JSON.stringify({ check: 'sources', status: s.status, n: s.j?.sources?.length || 0 }));

  // 3) card A/B (Moscow vs OLD) — паритет показов, транзиент egress классифицируется
  for (const t of TITLES) {
    const q = `/api/lampa/sources/card?token=${TOKEN}&${cardParams(t).toString()}`;
    const [mos, old] = await Promise.all([GET(BASE, q, AGENT), GET(`https://${DOMAIN}`, q, OLD_AGENT)]);
    const shown = (j) => (j?.sources || []).filter((x) => x.show).map((x) => x.id).sort();
    const divMos = shown(mos.j).filter((x) => !shown(old.j).includes(x));
    const divOld = shown(old.j).filter((x) => !shown(mos.j).includes(x));
    console.log(JSON.stringify({ check: 'card', title: t.key, mos: mos.status, old: old.status,
      shownMos: shown(mos.j).length, shownOld: shown(old.j).length,
      div_mos_vs_old: divMos, div_old_vs_mos: divOld, cached: mos.j?.meta?.cached, ms: mos.ms }));
  }

  // 4) provider matrix: /videos for доступные providers на подходящих тайтлах
  const PROVIDERS = [
    { p: 'filmix', t: 'interstellar' }, { p: 'filmix', t: 'toystory5' },
    { p: 'rezka', t: 'interstellar' }, { p: 'rutubemovie', t: 'interstellar' },
    { p: 'hdvb', t: 'forrest' }, { p: 'kodik', t: 'drakon' },
    { p: 'kinotochka', t: 'interstellar' }, { p: 'cdnvideohub', t: 'forrest' },
    { p: 'collaps', t: 'drakon' },
    { p: 'skaz-alloha', t: 'drakon' }, { p: 'skaz-videoseed', t: 'drakon' },
    { p: 'skaz-kinopub', t: 'interstellar' }, { p: 'skaz-veoveo', t: 'drakon' },
    { p: 'skaz-kinoflix', t: 'interstellar' }, { p: 'skaz-pidtor', t: 'interstellar' },
    { p: 'skaz-solntse', t: 'interstellar' }, { p: 'skaz-vkmovie', t: 'interstellar' },
    { p: 'skaz-geosaitebi', t: 'interstellar' }, { p: 'skaz-rhsprem', t: 'interstellar' },
    { p: 'skaz-zetflixdb', t: 'interstellar' }, { p: 'skaz-zagonka', t: 'interstellar' },
    { p: 'skaz-xvideocdnultra', t: 'interstellar' },
  ];
  for (const { p, t } of PROVIDERS) {
    const x = TITLES.find((y) => y.key === t);
    const q = new URLSearchParams({ source: 'tmdb', provider: p, token: TOKEN,
      ...{ title: x.title, original_title: x.on, serial: x.serial, year: x.year } });
    const v = await GET(BASE, `/api/lampa/videos?${q}`, AGENT);
    const items = v.j?.items || [];
    const cls = classify(v.status, items, v.body);
    console.log(JSON.stringify({ check: 'videos', provider: p, title: t, status: v.status, cls, items: items.length, ms: v.ms,
      sample: items[0] ? { url: String(items[0].url || items[0].play?.url || '').slice(0, 60) } : undefined,
      body: cls !== 'PASS' ? v.body.slice(0, 120) : undefined }));
  }

  // 5) playback цепочки (кард → выбранный provider → playable url → probe)
  const PLAY = [
    { key: 'filmix-mp4-interstellar', provider: 'filmix', t: 'interstellar' },
    { key: 'filmix-hls-toystory5', provider: 'filmix', t: 'toystory5' },
    { key: 'rutubemovie-hls-interstellar', provider: 'rutubemovie', t: 'interstellar' },
    { key: 'alloha-serial-drakon', provider: 'skaz-alloha', t: 'drakon' },
    { key: 'videoseed-serial-drakon', provider: 'skaz-videoseed', t: 'drakon' },
  ];
  for (const { key, provider, t } of PLAY) {
    const x = TITLES.find((y) => y.key === t);
    const q = new URLSearchParams({ source: 'tmdb', provider, token: TOKEN, title: x.title, original_title: x.on, serial: x.serial, year: x.year });
    const v = await GET(BASE, `/api/lampa/videos?${q}`, AGENT);
    const url = pickUrl(v.j);
    const probe = await probePlay(BASE, url, AGENT);
    console.log(JSON.stringify({ check: 'playback', scenario: key, videos: { status: v.status, items: v.j?.items?.length || 0 },
      playUrl: url ? String(url).slice(0, 80) : null, probe }));
  }
};
main();