// Bit more proof: full vs Range through proxy, second fragment, error text.
const PROD='https://plugin.maniya-kvn.online'; const TOKEN='mo-admin-test-2026';
async function gf(url,{headers={},ms=60000}={}){const t0=Date.now();try{const r=await fetch(url,{signal:AbortSignal.timeout(ms),headers});const b=Buffer.from(await r.arrayBuffer());return{status:r.status,ms:Date.now()-t0,ctype:r.headers.get('content-type')||'',len:b.length,body:b,err:''};}catch(e){return{status:'ERR',err:String(e).slice(0,120),body:Buffer.alloc(0),ms:-1,cType:''}}}
(async()=>{
  const q=new URLSearchParams({token:TOKEN,provider:'filmix',source:'tmdb',title:'История игрушек 5',original_title:'Toy Story 5',year:'2026',serial:'0'});
  const j=JSON.parse(Buffer.from(await (await fetch(`${PROD}/api/lampa/videos?${q}`)).arrayBuffer()).toString('utf8'));
  const inner=new URL(j.items[0].url).searchParams.get('url');
  const hash=new URL(inner).searchParams.get('hash')||'';
  console.log('hash len',hash.length);
  const mk=(u)=>`${PROD}/api/lampa/proxy?url=${encodeURIComponent(u)}&token=${TOKEN}`;
  const base='https://nl105.cdnsqu.com/hls/UHD_1313/Toy.Story.5.2026.D.ru.MovieDalen.4K.SDR.WEBDL.2160pp_2160.mp4';
  for(const [name,u,h] of [
    ['seg1 full +hash',mk(base+'/seg-1-v1-a1.ts?hash='+encodeURIComponent(hash)),{}],
    ['seg1 Range(1MB) +hash',mk(base+'/seg-1-v1-a1.ts?hash='+encodeURIComponent(hash)),{'Range':'bytes=0-1048576'}],
    ['seg2 Range(1MB) +hash',mk(base+'/seg-2-v1-a1.ts?hash='+encodeURIComponent(hash)),{'Range':'bytes=0-1048576'}],
    ['seg3 full +hash',mk(base+'/seg-3-v1-a1.ts?hash='+encodeURIComponent(hash)),{}],
  ]){
    const r=await gf(u,{headers:{'User-Agent':'Lampa/2.4.7',...h}});
    console.log(`${r.status} ${r.ms}ms ct=${r.ctype} len=${r.len} ${name}`+(r.err?' ERR='+r.err:''));
  }
})();