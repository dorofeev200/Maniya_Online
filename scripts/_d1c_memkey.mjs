// D1C read-only: does skaz.tv/proxy/<token> expand to vkvideo.cloud when fetched from same IP?
// And does adding memkey (card session) change mint shape? Laptop = residential (31.40.208.146).
const BASE = 'http://online5.skaz.tv/lite/lordfilm/video.m3u8';
const EMAIL = 'dorofeevigor20%40gmail.com';
const UID = 'wnoralpp';
const NWS = 'ivplxwmxtmmyee1roiizjjru5c7flset';
const MEMK = '0aad6c16631e52b2ae6152061f4d5ba9';
const TITLE = '%D0%9C%D1%8F%D1%82%D0%B5%D0%B6';
const UA_D = 'Mozilla/5.0 (Linux; Android 10; Lampa) AppleWebKit/537.36 Lampa/0.16.2';
const ORIGIN = { 'Origin': 'http://lampa.mx', 'Referer': 'http://lampa.mx/' };

async function get(url, headers, ms = 15000) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
    const text = await r.text();
    return { status: r.status, ms: Date.now() - t0, bytes: text.length, text, ct: String(r.headers.get('content-type') || '').split(';')[0] };
  } catch (e) { return { err: String(e.message || e).slice(0, 90), ms: Date.now() - t0 }; }
}
const maskTok = (s) => s.replace(/(https?:\/\/[\w.:-]+\/)([A-Za-z0-9_\-]{12,})(\/|\s|$)/g, '$1<TOK>$3');
function shapeOf(j) {
  const u = String(j.url || '');
  const primary = u.split(/\s+or\s+/i)[0].trim();
  let host = ''; try { host = new URL(primary).host; } catch {}
  const shape = primary.includes('/proxy') ? 'skaz.proxy' : primary.includes('vkvideo') ? 'vkvideo' : (u ? 'other' : 'none');
  return { primary, host, shape };
}

const variants = [
  ['v1_base', `vkId=15566040291925`],
  ['v2_memkey', `vkId=15566040291925&memkey=${MEMK}`],
  ['v3_vk2_memkey', `vkId=18186437810910&memkey=${MEMK}`],
  ['v4_vk3_memkey', `vkId=18187515419358&memkey=${MEMK}`],
];

for (const [name, extra] of variants) {
  const url = `${BASE}?${extra}&title=${TITLE}&account_email=${EMAIL}&uid=${UID}&nws_id=${NWS}`;
  const m = await get(url, { 'User-Agent': UA_D, ...ORIGIN });
  if (m.err) { console.log(`${name}: mint ERR ${m.err}`); continue; }
  let j = {}; try { j = JSON.parse(m.text); } catch {}
  const { primary, host, shape } = shapeOf(j);
  console.log(`${name}: mint HTTP ${m.status} ${m.ms}ms shape=${shape} host=${host}`);
  if (!primary) continue;
  const p = await get(primary, { 'User-Agent': UA_D, ...ORIGIN, 'Accept': 'application/vnd.apple.mpegurl,*/*' }, 12000);
  if (p.err) { console.log(`   fetch(same-laptop): ERR ${p.err}`); continue; }
  const hasVk = /vkvideo\.cloud/.test(p.text);
  const isHls = /#EXTM3U|#EXT-X-/.test(p.text);
  let jj = null; try { jj = JSON.parse(p.text); } catch {}
  console.log(`   fetch(same-laptop): HTTP ${p.status} ${p.ms}ms ct=${p.ct} bytes=${p.bytes} vkvideo=${hasVk} hls=${isHls} json=${!!jj}`);
  if (jj && jj.url) {
    const again = shapeOf(jj);
    console.log(`   -> body is play-descriptor! shape=${again.shape} host=${again.host} (разворот произошёл)`);
  } else if (hasVk) {
    console.log(`   prefix(masked): ${maskTok(p.text.slice(0, 160))}`);
  }
}
console.log('DONE');