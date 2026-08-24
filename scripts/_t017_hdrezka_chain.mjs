// T017-d: HDrezka полная цепочка на 3 контрольных title (GET-only).
import https from 'node:https';
const D='plugin.maniya-kvn.online', T='mo-6678c195e56c3af34d4ebecb5f37f11c';
const ag=new https.Agent({keepAlive:true});
const GET=async(u,ms=75000)=>{const t0=Date.now();try{const r=await fetch(u,{agent:ag,signal:AbortSignal.timeout(ms)});const b=await r.text().catch(()=>'');let j=null;try{j=JSON.parse(b)}catch{};return{s:r.status,ms:Date.now()-t0,j,b}}catch(e){return{s:0,ms:Date.now()-t0,e:String(e).slice(0,60)}}};
const films=[
 {k:'toystory5',id:'1084244',imdb:'tt29355505',t:'История игрушек 5',on:'Toy Story 5',y:'2026'},
 {k:'forrest',id:'536534',imdb:'tt0109830',t:'Форрест Гамп',on:'Forrest Gump',y:'1994'},
 {k:'interst',id:'157372',imdb:'tt0816692',t:'Интерстеллар',on:'Interstellar',y:'2014'},
];
for(const f of films){
 const q=new URLSearchParams({token:T,provider:'rezka',id:f.id,title:f.t,original_title:f.on,original_language:'en',serial:'0',year:f.y,source:'tmdb',imdb_id:f.imdb});
 const v=await GET(`https://${D}/api/lampa/videos?${q}`);
 const items=v.j?.items||[];const call=items.find(x=>x.method==='call'&&x.url);
 console.log(`${f.k}: /videos ${v.s} ${v.ms}ms items=${items.length} firstCall=${call?'yes':'no'}`);
 if(!call)continue;
 const r2=await GET(call.url);
 const play=r2.j?.url||'';
 console.log(`  /video ${r2.s} ${r2.ms}ms method=${r2.j?.method||'-'} play=${play?play.slice(0,90):'(none)'}`);
 if(!play)continue;
 const m=await GET(play);
 console.log(`  proxy->manifest ${m.s} ${m.ms}ms ct=${(m.b.slice(0,7))} len=${m.b.length}`);
 if(/EXTM3U/.test(m.b)){
   const L=m.b.split('\n').map(x=>x.trim()).filter(Boolean);
   const seg=(L.find(l=>!l.startsWith('#')&&/\.m4s|\.ts/.test(l)))||'';
   if(seg){
     const s1=seg.startsWith('http')?seg:new URL(seg,play).toString();
     const sr=await GET(s1.startsWith('http')?s1:`https://${D}/api/lampa/proxy?url=${encodeURIComponent(s1)}`);
     console.log(`  segment ${sr.s} ${sr.ms}ms bytes=${sr.b.length}`);
   }
 }
}
