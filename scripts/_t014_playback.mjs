// T014 playback/HLS regression through Moscow clone (and OLD for control).
// Env: BASE_MOS, BASE_OLD, TOKEN. provider=filmix, title=интерстеллар.
const provider = 'filmix';
const t = { source: 'tmdb', title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0' };
const time = async (url, ms = 60000) => { const s = Date.now(); try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return { status: r.status, contentType: r.headers.get('content-type') || '', ms: Date.now() - s, a: r.headers.get('accept-ranges') || '' }; } catch (e) { return { status: 0, ms: Date.now() - s, err: String(e).slice(0, 70) }; } };
const main = async () => {
  const MOS = process.env.BASE_MOS, OLD = process.env.BASE_OLD, TOKEN = process.env.TOKEN;
  const q = new URLSearchParams({ token: TOKEN, provider, ...t });
  // 1) videos from both
  const [vOld, vMos] = await Promise.all([time(`${OLD}/api/lampa/videos?${q}`), time(`${MOS}/api/lampa/videos?${q}`)]);
  const jOld = await (await fetch(`${OLD}/api/lampa/videos?${q}`, { signal: AbortSignal.timeout(60000) })).json().catch(() => null);
  const jMos = await (await fetch(`${MOS}/api/lampa/videos?${q}`, { signal: AbortSignal.timeout(60000) })).json().catch(() => null);
  const nOld = jOld?.items?.length, nMos = jMos?.items?.length;
  console.log(JSON.stringify({ step: 'videos', old: { st: vOld.status, ms: vOld.ms, n: nOld }, mos: { st: vMos.status, ms: vMos.ms, n: nMos } }));
  // pick first mp4/hls item from Moscow
  const pick = (j) => {
    const it = (j?.items || []).find((i) => i?.play?.url) || (j?.items || [])[0];
    return it ? (it.play?.url || it.link || it.stream?.url || null) : null;
  };
  const urlMos = pick(jMos), urlOld = pick(jOld);
  console.log(JSON.stringify({ step: 'playurl', old: urlOld ? String(urlOld).slice(0, 70) : null, mos: urlMos ? String(urlMos).slice(0, 70) : null }));
  const probe = async (base) => {
    const j = base === MOS ? jMos : jOld;
    const url = pick(j); if (!url) return { step: 'play', skipped: 'no-url' };
    // proxy it through same base
    const proxy = /^https?:/i.test(url) ? `${base}/proxy?url=${encodeURIComponent(url)}` : url;
    const r = await time(proxy, 90000);
    let m3u8 = null, seg = null;
    if (r.status === 200 && /m3u8/.test(r.contentType)) {
      const body = await (await fetch(proxy, { signal: AbortSignal.timeout(60000) })).text();
      const line = body.split('\n').find((l) => l.includes('.ts') || l.includes('index') || l.includes('seg'));
      m3u8 = { status: r.status, ms: r.ms, hasHash: /\?hash=/.test(body), lines: body.split('\n').filter((l) => l.includes('http')).length };
      if (line) { const segUrl = /^http/i.test(line) ? line : proxy.split('/').slice(0, -1).join('/') + '/' + line; seg = await time(segUrl, 90000); }
    }
    return { step: 'play', status: r.status, ctype: r.contentType.slice(0, 30), ms: r.ms, m3u8, seg };
  };
  const resMos = await probe(MOS), resOld = await probe(OLD);
  console.log(JSON.stringify(resMos)); console.log(JSON.stringify(resOld));
};
main();