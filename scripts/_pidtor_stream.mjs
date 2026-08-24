// PIDTOR-DEEPLINK-001: follow stream-эндпоинта oleg*.skaz.tv:8081/stream?link=<btih>
// + сравнение FULL redirect-цепочки. Кому: m3u8/PROXY-FULL vs 403/Empty/Торрент-гейт.
const EMAIL = process.env.SKAZ_ACCOUNT_EMAIL || '';
const UID = process.env.SKAZ_UID || '';

async function chain(url, label, max = 4) {
  let cur = url, out = [];
  for (let i = 0; i < max; i++) {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 30000);
    try {
      const r = await fetch(cur, { redirect: 'manual', headers: { Origin: 'http://lampa.mx', accept: '*/*' }, signal: c.signal });
      const loc = r.headers.get('location');
      const ct = (r.headers.get('content-type') || '').split(';')[0];
      const buf = Buffer.from(await r.arrayBuffer());
      const mac = buf.slice(0, 40).toString('latin1');
      const m3 = /^#EXTM3U/.test(mac) ? ` m3u8[${buf.length}B]` : '';
      const jsn = /^\s*[{[]/.test(mac) || ct === 'application/json' ? ` json[${buf.length}B]` : '';
      out.push(`${label}#${i}: ${r.status} ${ct || '(none)'}${m3}${jsn} ${loc ? '→' + loc.slice(0, 90) : ''} «${mac.slice(0, 40)}»`);
      if (!loc) return out.join('\n');
      cur = loc;
    } catch (e) { out.push(`${label}#${i}: ERR ${String(e.message || e).slice(0, 60)}`); return out.join('\n'); }
    finally { clearTimeout(t); }
  }
  return out.join('\n') + '\n(LIMIT-CYCLES)';
}

const links = [
  ['дюна', '287b98779b03bd033a8300f73f08929a64ac2efd', '1'],
  ['интерстеллар', '92e5c663ec1eef104d144a7dccb63ca5c9c845f8', '1'],
];
for (const [name, btih, index] of links) {
  const u = `http://oleg3.skaz.tv:8081/stream?link=${btih}&index=${index}&play=true&account_email=${encodeURIComponent(EMAIL)}&uid=${UID}&origin=http://lampa.mx`;
  console.log(`===== ${name}: ${u.slice(0, 120)}`);
  console.log(await chain(u, name), '\n');
}
console.log('DONE');