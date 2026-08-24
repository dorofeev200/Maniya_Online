// SKAZ-REMAINING-PROVIDERS-001: полный потенциальный play-чейн для спорных кейсов.
// A) videoseed-serial: descriptor JSON → json.url (m3u8) → master → variant → seg.
// B) rhsprem: прямой fetch cluster-URL (без proxy) — 503 это кластер или прокси?
// C) geosaitebi: повторный chaining play-url (маст → variant → seg) — стабильность.
const BASE = 'http://95.85.241.121:3210';
const TOKEN = 'mo-admin-test-2026';
const RW = (u) => String(u || '').replace('http://127.0.0.1:3210', BASE);
const rwUrlSync = (u, base) => { try { return new URL(RW(String(u)), base).toString(); } catch { return RW(String(u)); } };

async function fetchAny(url, timeout = 30000) {
  try { const r = await fetch(url, { headers: { Range: 'bytes=0-4095' }, signal: AbortSignal.timeout(timeout) }); const b = Buffer.from(await r.arrayBuffer()); return { status: r.status, ct: r.headers.get('content-type') || '', b }; }
  catch (e) { return { status: 'ERR', ct: '', b: Buffer.alloc(0), err: String(e.message || e).slice(0, 60) }; }
}
function firstUri(t) { const m = /#EXT-X-STREAM-INF[^\n]*\n[ \t]*(\S+)/.exec(t || ''); return m ? m[1] : null; }
function firstSegment(t) { const l = String(t || '').split(/\r?\n/); for (let i = 0; i < l.length; i++) if (/^#EXTINF/.test(l[i].trim()) && l[i + 1] && !l[i + 1].trim().startsWith('#')) return l[i + 1].trim(); return null; }
const retry = async (fn, n = 3) => { let r; for (let i = 0; i < n; i++) { r = await fn(); if (r.status !== 'ERR' && r.status !== 503 && r.status !== 502 && r.status !== 403) break; if (i < n - 1) await new Promise((s) => setTimeout(s, 1200)); } return r; };

async function chainFromJsonDescriptor(descUrl, label) {
  // 1. descriptor URL → JSON
  let d = await retry(() => fetchAny(RW(descUrl), 30000));
  const dt = d.b.toString('utf8');
  let parsed = null; try { parsed = JSON.parse(dt); } catch {}
  if (!parsed || parsed.method !== 'play') return `${label}: descriptor ${d.status} НЕ play-дескриптор: ${JSON.stringify(dt.slice(0, 120))}`;
  const media = String(parsed.url || '').split(/\s+or\s+/i)[0].trim();
  if (!media) return `${label}: descriptor без url`;
  // 2. m3u8 (мастер)
  for (let attempt = 0; attempt < 2; attempt++) {
    let m = await retry(() => fetchAny(media, 30000));
    const mac = m.b.slice(0, 24).toString('latin1');
    if (/^#EXTM3U/.test(mac)) {
      const text = RW(m.b.toString('utf8'));
      const v = firstUri(text);
      if (v) {
        let vv = await retry(() => fetchAny(rwUrlSync(v, media + (media.includes('?') ? '&x=1' : '?x=1')), 20000));
        const vs = vv.b.slice(0, 24).toString('latin1');
        const seg = firstSegment(RW(vv.b.toString('utf8')));
        if (seg) {
          let so = await retry(() => fetchAny(rwUrlSync(seg, rwUrlSync(v, media)), 15000));
          const ss = so.b.slice(0, 24).toString('latin1');
          return `${label}: ${media.slice(0, 100)} → m3u8 ${m.status}(${m.b.length}B) → variant ${vv.status}(${vv.b.length}B) → seg ${so.status} ${so.ct.split(';')[0]} ${so.b.length}B ${so.b[0] === 0x47 ? 'sig47✓' : (ss.startsWith('ftyp') ? 'mp4sig✓' : '')}`;
        }
        return `${label}: variant ${vv.status}(${vv.b.length}B) без-сегмента`;
      }
      const seg = firstSegment(text);
      if (seg) {
        let so = await retry(() => fetchAny(rwUrlSync(seg, media), 15000));
        return `${label}: m3u8→seg ${so.status} ${so.ct.split(';')[0]} ${so.b.length}B ${so.b[0] === 0x47 ? 'sig47✓' : ''}`;
      }
      return `${label}: m3u8 ${m.status}(${m.b.length}B) без-variant/seg`;
    }
    if (attempt === 0 && d.status === 200) continue; // повтор после дескриптора
  }
  return `${label}: media ${d.status} ct=${d.ct} «${d.b.slice(0, 40).toString('latin1')}»`;
}

console.log('=== A) videoseed-serial: descriptor-follow (имитация клиента) ===');
{
  const q = new URLSearchParams({ token: TOKEN, provider: 'skaz-videoseed', source: 'tmdb', title: 'Дом дракона', original_title: 'House of the Dragon', year: '2022', serial: '1', id: '94997', imdb_id: 'tt11198330', kinopoisk_id: '0' });
  const v = await fetchAny(`${BASE}/api/lampa/videos?${q}`, 45000);
  let items = []; try { items = JSON.parse(v.b.toString('utf8')).items || []; } catch {}
  if (!items.length) { console.log('items=0'); }
  else {
    const it = items[0];
    const rurl = RW(it.url) + (it.url.includes('?') ? '&' : '?') + `token=${TOKEN}`;
    const resolved = await fetchAny(rurl, 40000);
    let rj = null; try { rj = JSON.parse(resolved.b.toString('utf8')); } catch {}
    const finalUrl = rj?.url ? String(rj.url).split(/\s+or\s+/i)[0] : null;
    console.log(`ep[0] resolve: ${resolved.status} method=${rj?.method} finalUrl=${String(finalUrl || '').slice(0, 140)}`);
    if (finalUrl) {
      const decoded = decodeURIComponent(String(finalUrl));
      const isDescriptorEp = /\/lite\/[^/]+\/video\//.test(RW(decoded));
      console.log(`finalUrl это лайт-video дескриптор: ${isDescriptorEp}`);
      console.log(await chainFromJsonDescriptor(finalUrl, 'descriptor-follow'));
      // Сравнение: тот же URL но с play=true (что делает Lampac-RedirectToPlay)
      console.log(`play=true вариант: ${await chainFromJsonDescriptor(finalUrl + (finalUrl.includes('?') ? '&' : '?') + 'play=true', 'play=true')}`);
    }
  }
}

console.log('\n=== B) rhsprem: 503 — это кластер или прокси? ===');
{
  const q = new URLSearchParams({ token: TOKEN, provider: 'skaz-rhsprem', source: 'tmdb', title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0', id: '157336', imdb_id: 'tt0816692', kinopoisk_id: '462682' });
  const v = await fetchAny(`${BASE}/api/lampa/videos?${q}`, 45000);
  let items = []; try { items = JSON.parse(v.b.toString('utf8')).items || []; } catch {}
  if (!items.length) { console.log('items=0'); }
  else {
    const it = items[0];
    const rurl = RW(it.url) + (it.url.includes('?') ? '&' : '?') + `token=${TOKEN}`;
    const resolved = await fetchAny(rurl, 40000);
    let rj = null; try { rj = JSON.parse(resolved.b.toString('utf8')); } catch {}
    const finalUrl = rj?.url ? String(rj.url).split(/\s+or\s+/i)[0] : null;
    console.log(`resolve: ${resolved.status} finalUrl=${String(finalUrl || '').slice(0, 160)}`);
    if (finalUrl) {
      const decoded = decodeURIComponent(String(finalUrl));
      // Прямой fetch кластерного URL — без прокси.
      const direct = await retry(() => fetchAny(decoded, 30000), 2);
      console.log(`ПРЯМОЙ fetch (без proxy): ${direct.status} ct=${direct.ct} body=${JSON.stringify(direct.b.toString('utf8').slice(0, 200))}`);
      // через прокси ещё раз (для сравнения)
      const viaProxy = await retry(() => fetchAny(RW(decoded), 30000), 2);
      console.log(`через proxy:              ${viaProxy.status} ct=${viaProxy.ct} «${viaProxy.b.slice(0, 30).toString('latin1')}»`);
    }
  }
}

console.log('\n=== C) geosaitebi: полный chain (стабильность) ===');
{
  const q = new URLSearchParams({ token: TOKEN, provider: 'skaz-geosaitebi', source: 'tmdb', title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0', id: '157336', imdb_id: 'tt0816692', kinopoisk_id: '462682' });
  const v = await fetchAny(`${BASE}/api/lampa/videos?${q}`, 45000);
  let items = []; try { items = JSON.parse(v.b.toString('utf8')).items || []; } catch {}
  if (!items.length) { console.log('items=0'); }
  else {
    const it = items[0];
    console.log(`item[0] method=${it.method} url=${String(it.url).slice(0, 150)}`);
    if (it.method === 'play') {
      // Master fetch
      let m = await retry(() => fetchAny(RW(it.url), 25000));
      const mac = m.b.slice(0, 24).toString('latin1');
      if (/^#EXTM3U/.test(mac)) {
        const text = RW(m.b.toString('utf8'));
        const v2 = firstUri(text);
        if (v2) {
          let vv = await retry(() => fetchAny(rwUrlSync(v2, it.url), 20000));
          const seg = firstSegment(RW(vv.b.toString('utf8')));
          if (seg) {
            let so = await retry(() => fetchAny(rwUrlSync(seg, rwUrlSync(v2, it.url)), 15000));
            console.log(`master ${m.status}(${m.b.length}B) → variant ${vv.status}(${vv.b.length}B) → seg ${so.status} ${so.ct.split(';')[0]} ${so.b.length}B ${so.b[0] === 0x47 ? 'sig47✓' : ''}`);
          } else console.log(`variant ${vv.status}(${vv.b.length}B) без-сегмента: ${vv.b.toString('utf8').slice(0, 120)}`);
        } else console.log(`нет variant-строки в мастере: ${text.slice(0, 160)}`);
      } else console.log(`мастер НЕ m3u8: ${m.status} ct=${m.ct} «${mac}»`);
    }
  }
}
console.log('\nDONE');