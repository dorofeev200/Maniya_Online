// SKAZ-MANIYA-008 §2/§4/§7/§14 — 10-seg throughput delta on the SAME filmix source.
// Paths: A=direct CDN(+hash, playable form) | B=as-playlisted (no hash) | C=via Maniya prod proxy(+hash).
// 3 rounds (cold/warm/repeated). Read-only.
const PROD='https://plugin.maniya-kvn.online'; const TOKEN='mo-admin-test-2026';
const MB=1048576, RANGE='bytes=0-'+ (MB-1);
async function gf(url,{headers={},ms=45000,range}={}){const t0=Date.now();try{const r=await fetch(url,{signal:AbortSignal.timeout(ms),headers:{'User-Agent':'Mozilla/5.0',...(range?{Range:range}:{}),...headers},redirect:'follow'});const b=Buffer.from(await r.arrayBuffer());return{status:r.status,ms:Date.now()-t0,ctype:r.headers.get('content-type')||'',len:b.length,err:'',body:b};}catch(e){return{status:'ERR',ms:-1,err:String(e).slice(0,80),len:0,ctype:'',body:null}}}
const mbps=(b,ms)=>ms>0?((b/MB)/(ms/1000)):0;             // number (MB/s); print via toFixed
const fMbps=(v)=>typeof v==='number'?v.toFixed(2):'-';
function stat(arr){if(!arr.length)return{avg:'-',p50:'-',p95:'-',min:'-',max:'-'};const s=[...arr].map(Number).sort((a,b)=>a-b);const q=(p)=>s[Math.min(s.length-1,Math.floor(p*s.length))].toFixed(2);const avg=(s.reduce((a,b)=>a+b,0)/s.length).toFixed(2);return{avg,p50:q(.5),p95:q(.95),min:s[0].toFixed(2),max:s[s.length-1].toFixed(2)};}
(async()=>{
  console.log('T008 §10-seg: target Filmix «История игрушек 5» Дубляж [4K,SDR,ru,MovieDalen] nl105.cdnsqu.com');
  const agg={A:[],C:[],Bfail:0,Btotal:0};
  for(let round=1;round<=3;round++){
    console.log(`\n— ROUND ${round} —`);
    // fresh source + hash
    const q=new URLSearchParams({token:TOKEN,provider:'filmix',source:'tmdb',title:'История игрушек 5',original_title:'Toy Story 5',year:'2026',serial:'0'});
    const vj=JSON.parse(Buffer.from(await (await fetch(`${PROD}/api/lampa/videos?${q}`)).arrayBuffer()).toString('utf8'));
    const inner=new URL(vj.items[0].url).searchParams.get('url');
    const idx=new URL(inner);
    const hash=idx.searchParams.get('hash')||'';
    const m=await gf(idx.toString(),{});
    if(m.status!==200){console.log(` round ${round} m3u8 ${m.status} — skip`);continue;}
    if(!m.body){console.log(' round m3u8 body MISSING',JSON.stringify(m).slice(0,200));continue;}
    const segs=m.body.toString('utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).slice(0,10);
    console.log(` m3u8 ${m.status} ${m.ms}ms, ${segs.length} segs, seg0=${segs[0]?.match(/\.mp4\/[^/]+$/)?.[0]||''}`);
    const base=new URL(segs[0]); base.search=''; base.hash=''; // dir level same
    for(let i=0;i<segs.length;i++){
      const seg=segs[i]; const withH=new URL(seg); if(!withH.searchParams.has('hash')&&hash)withH.searchParams.set('hash',hash);
      const proxyUrl=`${PROD}/api/lampa/proxy?url=${encodeURIComponent(withH.toString())}&token=${TOKEN}`;
      const a=await gf(withH.toString(),{range:RANGE}); // A direct
      const b=await gf(new URL(seg).toString(),{range:RANGE}); // B as-playlisted
      const c=await gf(proxyUrl,{range:RANGE}); // C via proxy
      agg.Btotal++; if(b.status===403||(typeof b.status==='number'&&b.status>=400)||b.status==='ERR')agg.Bfail++;
      if(typeof a.status==='number'&&a.status<400){a.speed=mbps(a.len,a.ms);agg.A.push(a.speed);}
      if(typeof c.status==='number'&&c.status<400){c.speed=mbps(c.len,c.ms);agg.C.push(c.speed);}
      console.log(` seg${String(i+1).padStart(2)} A=${a.status}(${a.ms}ms/${a.len}B@${fMbps(a.speed)}Mbps) B=${b.status} C=${c.status}(${c.ms}ms/${c.len}B@${fMbps(c.speed)}Mbps)`);
    }
    await new Promise(s=>setTimeout(s,2500));
  }
  console.log('\n§stat (MB/s):');
  console.log(' A direct-CDN +hash :',stat(agg.A));
  console.log(' C via Maniya proxy :',stat(agg.C));
  console.log(' B as-playlisted (no hash) 403/err:',`${agg.Bfail}/${agg.Btotal}`);
  // full-segment parity pair
  console.log('\n— full-segment parity (one 23MB frag) —');
  const q2=new URLSearchParams({token:TOKEN,provider:'filmix',source:'tmdb',title:'История игрушек 5',original_title:'Toy Story 5',year:'2026',serial:'0'});
  const vj2=JSON.parse(Buffer.from(await (await fetch(`${PROD}/api/lampa/videos?${q2}`)).arrayBuffer()).toString('utf8'));
  const h2=new URL(new URL(vj2.items[0].url).searchParams.get('url')).searchParams.get('hash')||'';
  const segF=`https://nl105.cdnsqu.com/hls/UHD_1313/Toy.Story.5.2026.D.ru.MovieDalen.4K.SDR.WEBDL.2160pp_2160.mp4/seg-1-v1-a1.ts?hash=${encodeURIComponent(h2)}`;
  const pA=await gf(segF,{ms:120000});
  const pC=await gf(`${PROD}/api/lampa/proxy?url=${encodeURIComponent(segF)}&token=${TOKEN}`,{ms:120000});
  console.log(` full direct → ${pA.status} ${pA.ms}ms ${(pA.len/MB).toFixed(1)}MB @${mbps(pA.len,pA.ms)}Mbps`);
  console.log(` full via proxy→ ${pC.status} ${pC.ms}ms ${(pC.len/MB).toFixed(1)}MB @${mbps(pC.len,pC.ms)}Mbps`);
})().catch(e=>{console.error('T008-FAIL',e);process.exit(1)});