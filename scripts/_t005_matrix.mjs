// SKAZ-MANIYA-005 §10/§17: post-deploy differential matrix по 10 ключевым провайдерам.
// Каждый: /videos → (если call) resolve через /api/lampa/video → проверить call-url leak
// → (по желанию) fetch m3u8/stream → проверить #EXTM3U/200. По одному разнесённому
// запросу (burst-контроль §16). Read-only против SHADOW (3210).
const BASE = process.env.T005_BASE || 'http://95.85.241.121:3210';
const TOKEN = process.env.T005_TOKEN || 'mo-admin-test-2026';

async function g(url, ms = 60000) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, json: j, text: t, ms: Date.now() - t0, ctype: String(r.headers?.get?.('content-type') || '') };
  } catch (e) { return { status: 'ERR', json: null, text: String(e).slice(0, 60), ms: Date.now() - t0, ctype: '' }; }
}
const RW = (u) => String(u || '').replace('http://127.0.0.1:3210', BASE);
function looksLikeCallUrl(u) {
  const s = String(u || '');
  if (/\/api\/lampa\/(proxy|video|stream)\?/.test(s)) return false;
  if (/\/proxy\/[0-9a-f]{20,}/.test(s)) return false;
  if (/\/lite\/[a-z0-9-]+\/(video\/|\?)/.test(s)) return true;
  return false;
}
function hostOf(u) { try { return new URL(String(u||'')).host; } catch { return ''; } }

// Проверяемые: §17 список (Videoseed/HDVB/Kodik/Kinopub/Alloha/Veoveo/Rezka/Filmix/Kinotochka/Collaps)
const PROV = [
  { label: 'Videoseed',  provider: 'skaz-videoseed', title: 'Дом дракона', ot: 'House of the Dragon', year: '2022', id: '94997',  imdb: 'tt11198330', kp: '',  serial: 1, fetchStream: 1 },
  { label: 'HDVB',       provider: 'skaz-hdvb',      title: 'Дюна: Часть вторая', ot: 'Dune: Part Two', year: '2024', id: '693134', imdb: 'tt15239678', kp: '4670204', serial: 0, fetchStream: 1 },
  { label: 'Kodik',      provider: 'kodik',          title: 'Паразиты', ot: 'Parasite', year: '2019', id: '496243', imdb: 'tt6751668', kp: '1023498', serial: 0, fetchStream: 1 },
  { label: 'Kinopub',    provider: 'skaz-kinopub',   title: 'Дюна: Часть вторая', ot: 'Dune: Part Two', year: '2024', id: '693134', imdb: 'tt15239678', kp: '4670204', serial: 0, fetchStream: 1 },
  { label: 'Alloha',     provider: 'skaz-alloha',    title: 'Дюна: Часть вторая', ot: 'Dune: Part Two', year: '2024', id: '693134', imdb: 'tt15239678', kp: '4670204', serial: 0, fetchStream: 1 },
  { label: 'Veoveo',     provider: 'skaz-veoveo',    title: 'Дюна: Часть вторая', ot: 'Dune: Part Two', year: '2024', id: '693134', imdb: 'tt15239678', kp: '4670204', serial: 0, fetchStream: 1 },
  { label: 'Rezka',      provider: 'rezka',          title: 'Дом дракона', ot: 'House of the Dragon', year: '2022', id: '94997', imdb: 'tt11198330', kp: '', serial: 1, fetchStream: 1 },
  { label: 'Filmix',     provider: 'filmix',         title: 'Дюна: Часть вторая', ot: 'Dune: Part Two', year: '2024', id: '693134', imdb: 'tt15239678', kp: '4670204', serial: 0, fetchStream: 1 },
  { label: 'Kinotochka', provider: 'kinotochka',     title: 'Интерстеллар', ot: 'Interstellar', year: '2014', id: '157336', imdb: 'tt0816692', kp: '462682', serial: 0, fetchStream: 1 },
  { label: 'Collaps',    provider: 'collaps',        title: 'Паразиты', ot: 'Parasite', year: '2019', id: '496243', imdb: 'tt6751668', kp: '1023498', serial: 0, fetchStream: 1 },
];

async function checkStream(streamUrl) {
  if (!streamUrl) return { ok: false, why: 'no-url' };
  const r = await g(RW(streamUrl), 30000);
  if (r.status !== 200) return { ok: false, why: `http${r.status}` };
  const hasM3u = /#EXTM3U/.test(r.text.slice(0, 2000));
  return { ok: hasM3u || true, ctype: r.ctype, head: r.text.slice(0, 20).replace(/\n/g, ' '), hasM3u };
}

(async () => {
  console.log(`\n===== §10/§17 DIFFERENTIAL MATRIX (post-deploy) — shadow =====`);
  console.log('Skaz Reference ↔ Maniya Shadow (агрегат по нашей сборке; Skaz-логика в Maniya-провайдерах).\n');
  console.log('Provider    | Vid  | Resolve | Stream(m3u8) | CallUrl | Host-bound | Lat');
  const rows = [];
  for (const p of PROV) {
    const vq = new URLSearchParams({ token: TOKEN, provider: p.provider, source: 'tmdb', title: p.title, original_title: p.ot, year: p.year, serial: String(p.serial), id: p.id, imdb_id: p.imdb, kinopoisk_id: p.kp });
    const v = await g(`${BASE}/api/lampa/videos?${vq}`, 60000);
    let line;
    if (v.status !== 200) { line = `${p.label.padEnd(11)} HTTP${v.status}`; rows.push(line); await new Promise(s=>setTimeout(s,1500)); continue; }
    const items = v.json?.items || [];
    const pe = v.json?.provider_error?.code || '';
    if (!items.length) {
      const why = pe ? pe : 'empty';
      line = `${p.label.padEnd(11)} ${('VIDS empty(' + why + ')').padEnd(6)}  ${(pe.includes('collaps') ? 'NO_SOURCE(SE-egress)' : '')}`;
      rows.push(line); console.log(line); await new Promise(s=>setTimeout(s,2000)); continue;
    }
    const it = items[0];
    const genHost = hostOf(it.url);
    let streamUrl = null, resolveStage = 'direct', method = it.method, callurl = false;
    if (it.method === 'call') {
      const cu = RW(it.url);
      const r = await g(cu, 60000);
      if (r.status !== 200) { line = `${p.label.padEnd(11)} resolve HTTP${r.status}`; rows.push(line); await new Promise(s=>setTimeout(s,1500)); continue; }
      method = r.json?.method || '?';
      streamUrl = r.json?.url || null;
      resolveStage = 'call→resolve';
      callurl = looksLikeCallUrl(streamUrl);
    } else if (it.method === 'play') {
      streamUrl = it.url;
      callurl = looksLikeCallUrl(it.url);
    }
    const resHost = hostOf(streamUrl).replace(/^api\.lampa.*$/, '');
    const hb = callurl ? 'callurl!' : (genHost === resHost || (!genHost) ? 'same' : 'diff');
    // stream check
    let streamTxt = '';
    if (p.fetchStream && streamUrl && !callurl) {
      const sc = await checkStream(streamUrl);
      // если это proxy-m3u8, распакуем и проверим реальный
      if (/\/api\/lampa\/proxy\?/.test(streamUrl)) {
        const pu = new URL(RW(streamUrl));
        const inner = pu.searchParams.get('url') || '';
        if (inner) { const sc2 = await g(inner, 20000); streamTxt = sc2.status === 200 && /#EXTM3U/.test(sc2.text) ? 'm3u8✓' : `stream${sc2.status}`; }
      } else {
        streamTxt = sc.hasM3u ? 'm3u8✓' : (sc.ok ? 'body✓' : sc.why);
      }
    }
    line = `${p.label.padEnd(11)} items=${String(items.length).padEnd(5)} ${resolveStage.padEnd(12)} ${streamTxt.padEnd(12)} ${callurl ? 'CALLURL⚠' : '0'.padEnd(7)} hb=${hb}`;
    rows.push(line);
    await new Promise((s) => setTimeout(s, 2000)); // burst-контроль
  }
  for (const l of rows) console.log(l);
  console.log('\nDONE');
})();
