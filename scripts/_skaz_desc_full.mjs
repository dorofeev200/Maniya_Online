// SKAZ-REMAINING-PROVIDERS-001: полный дамп JSON-дескриптора + follow через RW.
// Цель: videoseed-serial и rhsprem — что именно возвращает конечный URL и доходит ли до seg.
const BASE = 'http://95.85.241.121:3210';
const TOKEN = 'mo-admin-test-2026';
const RW = (u) => String(u || '').replace('http://127.0.0.1:3210', BASE);
const rwUrlSync = (u, base) => { try { return new URL(RW(String(u)), base).toString(); } catch { return RW(String(u)); } };

async function fetchAny(url, timeout = 30000) {
  try { const r = await fetch(url, { headers: { Range: 'bytes=0-8191' }, signal: AbortSignal.timeout(timeout) }); const b = Buffer.from(await r.arrayBuffer()); return { status: r.status, ct: r.headers.get('content-type') || '', url, b }; }
  catch (e) { return { status: 'ERR', ct: '', url, b: Buffer.alloc(0), err: String(e.message || e).slice(0, 60) }; }
}
function firstUri(t) { const m = /#EXT-X-STREAM-INF[^\n]*\n[ \t]*(\S+)/.exec(t || ''); return m ? m[1] : null; }
function firstSegment(t) { const l = String(t || '').split(/\r?\n/); for (let i = 0; i < l.length; i++) if (/^#EXTINF/.test(l[i].trim()) && l[i + 1] && !l[i + 1].trim().startsWith('#')) return l[i + 1].trim(); return null; }
const retry = async (fn, n = 3) => { let r; for (let i = 0; i < n; i++) { r = await fn(); if (r.status !== 'ERR' && r.status !== 503 && r.status !== 502 && r.status !== 403) break; if (i < n - 1) await new Promise((s) => setTimeout(s, 1200)); } return r; };

async function fullMediaChain(url, label, depth = 0) {
  if (depth > 3) return `${label}: DEPTH-LIMIT`;
  let m = await retry(() => fetchAny(url, 30000));
  const mac = m.b.slice(0, 40).toString('latin1');
  const text = m.b.toString('utf8');
  if (/^\s*[{[]/.test(mac) || /application\/json/.test(m.ct)) {
    const j = JSON.parse(text);
    if (typeof j === 'string') {
      const next = RW(j);
      return await fullMediaChain(next, `${label}:JSON-string`, depth + 1);
    }
    if (j && j.method === 'play' && String(j.url || '').trim()) {
      const next = RW(String(j.url).split(/\s+or\s+/i)[0].trim());
      const sub = j.quality ? ` q=[${Object.keys(j.quality).join(',')}]` : '';
      return await fullMediaChain(next, `${label}:desc${sub}`, depth + 1);
    }
    return `${label}: JSON ${m.ct} ${JSON.stringify(text.slice(0, 200))}`;
  }
  if (/^#EXTM3U/.test(mac)) {
    const rwText = RW(text);
    const v = firstUri(rwText);
    if (v) {
      const vv = await retry(() => fetchAny(rwUrlSync(v, url), 20000));
      const vvs = vv.b.slice(0, 40).toString('latin1');
      if (/^#EXTM3U|#EXTINF/.test(vvs)) {
        const seg = firstSegment(RW(vv.b.toString('utf8')));
        if (seg) {
          const so = await retry(() => fetchAny(rwUrlSync(seg, rwUrlSync(v, url)), 15000));
          const ss = so.b.slice(0, 24).toString('latin1');
          return `${label}: m3u8(${m.b.length}B)→variant ${vv.status}(${vv.b.length}B)→seg ${so.status} ${so.ct.split(';')[0]} ${so.b.length}B ${so.b[0] === 0x47 ? 'sig47✓' : (ss.startsWith('ftyp') ? 'mp4sig✓' : '')}`;
        }
        return `${label}: variant ${vv.status}(${vv.b.length}B) без-сегмента`;
      }
      return `${label}: variant ${vv.status} ct=${vv.ct} «${vvs}»`;
    }
    const seg = firstSegment(rwText);
    if (seg) {
      const so = await retry(() => fetchAny(rwUrlSync(seg, url), 15000));
      return `${label}: m3u8→seg ${so.status} ${so.ct.split(';')[0]} ${so.b.length}B ${so.b[0] === 0x47 ? 'sig47✓' : ''}`;
    }
    return `${label}: m3u8(${m.b.length}B) без-variant/seg`;
  }
  return `${label}: ${m.status} ct=${m.ct} «${mac}»`;
}

async function resolveFirstItem(provider, [title, ot, year, id, imdb, kp, serial]) {
  const q = new URLSearchParams({ token: TOKEN, provider, source: 'tmdb', title, original_title: ot, year, serial: String(serial), id, imdb_id: imdb, kinopoisk_id: kp });
  const v = await fetchAny(`${BASE}/api/lampa/videos?${q}`, 45000);
  let items = []; try { items = JSON.parse(v.b.toString('utf8')).items || []; } catch {}
  if (!items.length) return `items=0`;
  const it = items[0];
  const rurl = RW(it.url) + (it.url.includes('?') ? '&' : '?') + `token=${TOKEN}`;
  const resolved = await fetchAny(rurl, 40000);
  let full = ''; let rj = null;
  try { full = resolved.b.toString('utf8'); rj = JSON.parse(full); } catch {}
  if (!rj || !rj.url) return `${it.method}: resolve ${resolved.status} ${JSON.stringify(full.slice(0, 300))}`;
  return `${it.method}: resolve ${resolved.status} → ${await fullMediaChain(RW(String(rj.url).split(/\s+or\s+/i)[0]), 'play')}`;
}

for (const [key, spec] of [['videoseed-serial', ['videoseed', ['Дом дракона', 'House of the Dragon', '2022', '94997', 'tt11198330', '0', 1]]],
                            ['rhsprem', ['rhsprem', ['Интерстеллар', 'Interstellar', '2014', '157336', 'tt0816692', '462682', 0]]]]) {
  console.log(`\n===== ${key} =====`);
  console.log(await resolveFirstItem(spec[0], spec[1]));
}
console.log('\nDONE');