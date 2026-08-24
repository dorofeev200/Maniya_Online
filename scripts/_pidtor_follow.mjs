// PIDTOR-DEEPLINK-001: решающий GET-follow pidtor s<hash>-URL (с Origin lampa.mx и creds).
// Если тело magnet:/torrent → MAGNET-ONLY. Если m3u8/MP4/redirect → HTTP-таргет есть.
const EMAIL = process.env.SKAZ_ACCOUNT_EMAIL || '';
const UID = process.env.SKAZ_UID || '';
const HOSTS = ['http://online3.skaz.tv', 'http://94.249.239.63', 'http://94.249.239.37'];

async function follow(url, label) {
  const out = [];
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 25000);
  try {
    const r = await fetch(url, {
      redirect: 'manual',
      headers: { Origin: 'http://lampa.mx', accept: '*/*' },
      signal: controller.signal
    });
    const loc = r.headers.get('location');
    const ct = (r.headers.get('content-type') || '').split(';')[0];
    const buf = Buffer.from(await r.arrayBuffer());
    const text = buf.length <= 600 ? buf.toString('utf8') : buf.slice(0, 300).toString('utf8');
    out.push(`${label}: status=${r.status} ct=${ct || '(none)'} loc=${String(loc || '').slice(0, 80)} body=${JSON.stringify(text.slice(0, 200))}`);
    if (loc) {
      // логика как у клиента: если редирект на magnet/торрент — подтверждение;
      // если на m3u8 — HTTP-таргет.
      const redir = loc.startsWith('magnet:') ? 'MAGNET-REDIRECT' : (loc.includes('.m3u8') ? 'M3U8-REDIRECT' : `REDIRECT->${loc.slice(0, 90)}`);
      out.push(`  ${redir}`);
    }
  } catch (e) {
    out.push(`${label}: ERR ${String(e.message || e).slice(0, 60)}`);
  } finally { clearTimeout(t); }
  return out.join('\n');
}

const samples = [
  ['дюна-1', 'http://online3.skaz.tv/lite/pidtor/s287b98779b03bd033a8300f73f08929a64ac2efd?tr=udp%3a%2f%2fexodus.desync.com%3a6969&tr=http%3a%2f%2fbt.piratebay.com%3a80%2fannounce&account_email=' + encodeURIComponent(EMAIL) + '&uid=' + UID],
  ['дюна-2', 'http://online3.skaz.tv/lite/pidtor/s1ef0d06e9cc01be4885ac56655c7fee0f76de588?tr=udp%3a%2f%2fexodus.desync.com%3a6969&tr=http%3a%2f%2fbt.piratebay.com%3a80%2fannounce&account_email=' + encodeURIComponent(EMAIL) + '&uid=' + UID],
  ['интерстеллар-1', 'http://online3.skaz.tv/lite/pidtor/s92e5c663ec1eef104d144a7dccb63ca5c9c845f8?tr=http%3a%2f%2fretracker.local%2fannounce&tr=udp%3a%2f%2ftorrent.tm%3a6969&account_email=' + encodeURIComponent(EMAIL) + '&uid=' + UID],
  ['интерстеллар-2', 'http://online3.skaz.tv/lite/pidtor/sdf5852a7a108110dd4e066bdc0e601c832b064f4?tr=http%3a%2f%2fbt.t-ru.org%2fann%3fmagnet&account_email=' + encodeURIComponent(EMAIL) + '&uid=' + UID],
];
for (const [label, url] of samples) console.log(await follow(url, label), '\n');
console.log('DONE');