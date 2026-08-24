// T017-b: ViruseProject play-URL через прод. GET-only.
import https from 'node:https';
const D='plugin.maniya-kvn.online', T='mo-6678c195e56c3af34d4ebecb5f37f11c';
const ag=new https.Agent({keepAlive:true});
const GET=async(u,ms=90000)=>{const t0=Date.now();try{const r=await fetch(u,{agent:ag,signal:AbortSignal.timeout(ms)});const b=await r.text().catch(()=>'');let j=null;try{j=JSON.parse(b)}catch{};return{s:r.status,ms:Date.now()-t0,j,b,h:{ct:r.headers.get('content-type')||''}}}catch(e){return{s:0,ms:Date.now()-t0,e:String(e).slice(0,80)}}};
const q=new URLSearchParams({token:T,provider:'skaz-alloha',id:'1288445',title:'Мятеж',original_title:'Mutiny',original_language:'en',serial:'0',year:'2026',source:'tmdb',imdb_id:'tt32338669',clarification:'0',similar:'false'});
const v=await GET(`https://${D}/api/lampa/videos?${q}`);
const it=(v.j?.items||[]).find(x=>/virus/i.test(String(x.translate||x.title)));
console.log('videos',v.s,v.ms,'virus item:',it?`[${it.method}] ${it.translate}`:'NOT FOUND');
if(!it){process.exit(0)}
const call=await GET(it.url);
console.log('video',call.s,call.ms,'items=',call.j?.items?.length);
const p=(call.j?.items||[])[0];
console.log('play item:',JSON.stringify({title:p?.title,quality:p?.quality,url:(p?.url||'').slice(0,140)}).slice(0,400));
const play=(p?.url||p?.play?.url||'');
if(!play){console.log('no play url');process.exit(0)}
// манифест через прод-прокси
const throughProxy = s=>s.startsWith('http')&&!s.includes(D);
const m=throughProxy(play)?`https://${D}/api/lampa/proxy?url=${encodeURIComponent(play)}`:play;
const mf=await GET(m);
if(mf.s===0||!/m3u8|M3U8/.test(mf.h.ct||'')){console.log('manifest http',mf.s,mf.ms,mf.h.ct,mf.e||'',mf.b.slice(0,120));process.exit(0)}
const lines=mf.b.split('\n').filter(l=>l.trim());
const vlines=lines.map(l=>l.trim()).filter(l=>/^#EXT-X-STREAM-INF|^#EXT-X-MEDIA|^https?:|^#EXT-X-VERSION/.test(l));
console.log('manifest',mf.s,mf.ms,'bytes',mf.b.length,'type:',/STREAM-INF/.test(mf.b)?'MASTER':/^#EXTINF/.test(mf.b)?'MEDIA':'?');
if(/STREAM-INF/.test(mf.b)){
  for(let i=0;i<vlines.length-1;i++){if(/STREAM-INF/.test(vlines[i])){console.log(vlines[i]);console.log('  -->',vlines[i+1].slice(0,110))}}
} else {
  const infs=lines.filter(l=>/^#EXTINF/.test(l.trim()));
  const bits=infs.map(l=>(parseFloat((l.trim().replace('#EXTINF:','').split(',')[0])))*infs.length>0?0:0);
  const avg=(infs.reduce((a,l)=>a+parseFloat((l.trim().replace('#EXTINF:','').split(',')[0])),0));
  const target=lines.find(l=>/BANDWIDTH|AVERAGE-BANDWIDTH/.test(l));
  console.log('segments=',infs.length,'sumExtinf(s)=',avg.toFixed(1),'avgSeg(s)=',infs.length?(avg/infs.length).toFixed(2):0,'targetDur:',target);
}
// время манифеста: повторный через прокси для холода/тепла не нужен — достаточно первого.

// печатать ключевые пути сегментов (первый сегмент) для прямого замерить нельзя (нет full URLs, если HLS-сегменты относительные)
const seg=lines.find(l=>/^[^#]/.test(l.trim())&&/\.(ts|m4s)/.test(l));
if(seg)console.log('first seg:',seg.slice(0,150));