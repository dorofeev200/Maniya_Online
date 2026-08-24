// SKAZ-MANIYA-008 §16/§9/§10/§7 — LIVE parity через локальный инстанс :3301
// (NODE_ENV=test + test fixtures USERS/VIDEOS, реальные .env creds skaz/TMDB).
// A: HLS hash live-проверка §7 (переписанные сегменты несут hash плейлиста, 206 TS)
// B: bench 20× §13 map: статус/items/elapsed/call-url/provider_error
// C: cross-query 50 §9: цикл по 5 тайтлам/провайдерам, stateLeak=0 визуально вся url у прокси
// D: concurrency 20/20 §10: параллельные /videos + /video
// Output = DATA отчёта. Read-only для кластера, прод НЕ трогает.
const BASE='http://127.0.0.1:3301';
const TOKEN='unit-test-token';
const O = (o)=>JSON.stringify(o);
const callUrlLeak = (item)=>!String(item?.url||'').startsWith(`${BASE}/api/lampa/`);
const TAG=process.argv[2]||'';

const QUERIES = [
  {label:'filmix-movie', q:{provider:'filmix',source:'tmdb',title:'История игрушек 5',original_title:'Toy Story 5',year:'2026',serial:'0'}},
  {label:'alloha-movie', q:{provider:'alloha',source:'tmdb',title:'Интерстеллар',original_title:'Interstellar',year:'2014',serial:'0'}},
  {label:'videoseed-serial', q:{provider:'videoseed',source:'tmdb',title:'Друзья',original_title:'Friends',year:'2004',serial:'1'}},
  {label:'rezka-movie', q:{provider:'rezka',source:'tmdb',title:'Интерстеллар',original_title:'Interstellar',year:'2014',serial:'0'}},
  {label:'kinopub-serial', q:{provider:'kinopub',source:'tmdb',title:'Одиссея',original_title:'The Odyssey',year:'2026',serial:'1'}},
];
async function videos(query){
  const u=new URL(`${BASE}/api/lampa/videos`); u.searchParams.set('token',TOKEN);
  for(const[k,v]of Object.entries(query)) u.searchParams.set(k,String(v));
  const t0=Date.now();
  const r=await fetch(u);
  const j=await r.json().catch(()=>null);
  return {status:r.status, ms:Date.now()-t0, j};
}
async function video(query){
  const u=new URL(`${BASE}/api/lampa/video`); u.searchParams.set('token',TOKEN);
  for(const[k,v]of Object.entries(query)) u.searchParams.set(k,String(v));
  const r=await fetch(u); const j=await r.json().catch(()=>null);
  return {status:r.status, j};
}
(async()=>{
  if(TAG==='hls'){
    // ===== A. §7 live: filmix HLS hash propagation через локальный прокси =====
    console.log('— A. HLS hash live (§7) —');
    const q=QUERIES[0].q;
    const {status,j}=await videos(q);
    if(status!==200||!j?.items?.length){console.log(`HLS: /videos ${status} items=${j?.items?.length} provider_error=${O(j?.provider_error||null)}`);process.exit(0);}
    const item=j.items.find(i=>i.method==='play'&&i.url?.includes('/proxy'));
    if(!item){console.log('HLS: нет play-прокси item → НЕ применимо (классифицируем HLS=N/A)');process.exit(0);}
    console.log(' item0.method='+item.method+' url.init='+item.url.slice(0,110));
    const inner=new URL(item.url).searchParams.get('url');
    const hash=new URL(inner).searchParams.get('hash')||'';
    console.log(' inner m3u8 hash?='+(hash?'ДА ('+hash.length+'ch)':'НЕТ'));
    const m=await fetch(item.url);
    const manifest=await m.text();
    const segs=manifest.split(/\r?\n/).filter(l=>l&&!l.startsWith('#'));
    const withHash=segs.filter(l=>l.includes(encodeURIComponent('hash='))||l.includes('hash=')).length;
    const seg=segs.find(l=>l.includes('.ts'))||segs[0];
    console.log(` rewritten: seg=${segs.length} c/hash=${withHash} | образец: …${seg?.slice(-90)}`);
    // fetch первого seg через локальный прокси (Range)
    const innerSeg=new URL(seg||'').searchParams.get('url')||seg;
    const sR=await fetch(seg,{headers:{Range:'bytes=0-1048575'}});
    const sT=(sR.headers.get('content-type')||'').toLowerCase();
    console.log(` proxy-seg fetch: HTTP=${sR.status} ctype=${sT} | hash в seg-URL=${decodeURIComponent(innerSeg).includes('hash=')}`);
    const ok = m.status===200
      && (withHash===segs.length)
      && ((sR.status===200||sR.status===206)&&(sT.includes('mp2t')||sT.includes('video/mp')))
      && decodeURIComponent(innerSeg||'').includes('hash=');
    console.log(' HLS-PARITY-PASS='+ok);
    process.exit(0);
  }
  if(TAG==='bench'){
    console.log('— B. bench 20× '+QUERIES[0].label+' —');
    const q=QUERIES[0].q;
    const out=[];
    for(let i=0;i<20;i++){
      const r=await videos(q);
      const items=r.j?.items||[];
      out.push({i,status:r.status,items:items.length,seasons:r.j?.seasons?.length||0,ms:r.ms,provider_error:r.j?.provider_error?.code||null,leaks:items.filter(callUrlLeak).length});
    }
    const sum=(a)=>a.reduce((x,y)=>x+y,0);
    const ok=out.filter(x=>x.status===200).length;
    const ms=out.map(x=>x.ms);
    console.log(' bench: 20/20 status200='+ok+' leak-sum='+sum(out.map(x=>x.leaks))+' provider_error='+O([...new Set(out.map(x=>x.provider_error))].filter(Boolean)));
    console.log(' elapsed(ms) min/avg/max/p95 = '+Math.min(...ms)+'/'+Math.round(sum(ms)/20)+'/'+Math.max(...ms)+'/'+[...ms].sort((a,b)=>a-b)[Math.floor(20*.95)]);
    process.exit(0);
  }
  if(TAG==='cross'){
    console.log('— C. cross-query 50 (§9) —');
    const sum=(a)=>a.reduce((x,y)=>x+y,0);
    let leaks=0, errs=0, empties=0, providerErrors=0, perrTypes={};
    const forms=[];
    for(let i=0;i<50;i++){
      const Q=QUERIES[i%QUERIES.length];
      const {status,j}=await videos(Q.q);
      const items=j?.items||[];
      if(items.some(callUrlLeak)) leaks++;
      if(status!==200) errs++; else if(!items.length) empties++;
      if(j?.provider_error){providerErrors++; perrTypes[j.provider_error.code]=(perrTypes[j.provider_error.code]||0)+1;}
      if(!items.length){forms.push(`${Q.label}=EMPTY${j?.provider_error?':'+j.provider_error.code:''}`);continue;}
      // сериал → резолв ep1 и ep2 (state-переходы)
      if(Q.q.serial==='1'&&j.seasons?.length){
        for(const ep of [1,2]){
          const v=await video({...Q.q,voice:'0',season:String(j.seasons[0].number||1),episode:String(ep)});
          const vi=v.j;
          if(vi?.url&&callUrlLeak(vi)) leaks++;
          if(v.status!==200) errs++;
          if(ep===1) forms.push(`${Q.label}=serialItems${items.length}seasons${j.seasons.length}ep1@${v.status}:${vi?.method||'?'}`);
        }
      }else{
        forms.push(`${Q.label}=items${items.length}`);
      }
    }
    console.log(' cross: 50 req, status!=200='+errs+' empty='+empties+' provider_error='+providerErrors+' perrTypes='+O(perrTypes));
    console.log(' call-url/state leak (не-прокси url): '+leaks);
    console.log(' forms: '+forms.slice(0,14).join(' | '));
    process.exit(0);
  }
  if(TAG==='concurrent'){
    console.log('— D. concurrency 20/20 (§10) —');
    const jobs=[];
    for(let i=0;i<20;i++){
      const Q=QUERIES[i%QUERIES.length];
      jobs.push(videos(Q.q).then(r=>r));
    }
    const rs=await Promise.all(jobs);
    const ok=rs.filter(r=>r.status===200).length;
    const leaked=rs.flatMap(r=>(r.j?.items||[]).filter(callUrlLeak)).length;
    console.log(' 20 /videos: 200×'+ok+' leak='+leaked);
    const res=rs.flatMap(r=>r.j?.items||[]);
    const callers=[];
    for(let i=0;i<20&&i<res.length;i++){
      const item=res[i];
      if(item?.method!=='call') continue;
      const q=new URL(item.url).searchParams;
      callers.push({provider:q.get('provider'),season:q.get('season'),episode:q.get('episode'),voice:q.get('voice')});
    }
    const vr=[];
    for(const c of callers.slice(0,6)){
      const {status,j}=await video(c);
      vr.push(`${c.provider||'?'}@s${c.season||'-'}e${c.episode||'-'}:${status}:${j?.method||j?.provider_error?.code||'-'}`);
    }
    console.log(' resolve batch: 20 callers → '+callers.length+' сублимация '+vr.length+': '+vr.join(' | '));
    process.exit(0);
  }
  console.log('USAGE: node _t008_parity.mjs <hls|bench|cross|concurrent>');
})().catch(e=>{console.error('T008-PARITY-FAIL',e);process.exit(1)});