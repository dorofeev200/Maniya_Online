// T017-c: замер >=30 последовательных сегментов ViruseProject.
// proxy = реальный путь TV (client->Moscow proxy->vkvideo.cloud), direct = raw CDN.
import fs from 'node:fs';
const DOMAIN='plugin.maniya-kvn.online';
const TOKEN='mo-6678c195e56c3af34d4ebecb5f37f11c';
import https from 'node:https';
const AGENT=new https.Agent({keepAlive:true});
const [,,START,N,LEG]=process.argv; // START=номер первого сегмента (1-base), N=кол-во, LEG=proxy|direct|both
const start=parseInt(START||'1',10), n=parseInt(N||'30',10), leg=LEG||'both';
const media=fs.readFileSync(process.env.TEMP+'/t017_media.m3u8','utf8');
const L=media.split('\n').map(x=>x.trim()).filter(Boolean);
const segUrls=L.filter(l=>/^https/.test(l)&&/seg-\d+-f1-v1-a1\.m4s/.test(l));
const idx=start-1;
const pick=segUrls.slice(idx,idx+n).map(u=>({u,id:/seg-(\d+)-f1-v1-a1\.m4s/.exec(u)[1]}));
if(!pick.length){console.log('no segs in range; total',segUrls.length);process.exit(0)}
const durMap=new Map();{
  let i=0;for(let k=0;k<L.length;k++){if(/^#EXTINF/.test(L[k])){const d=parseFloat(L[k].replace('#EXTINF:','').split(',')[0]);const nxt=L[k+1];if(nxt&&/^https/.test(nxt)&&/seg-(\d+)-f1-v1-a1\.m4s/.exec(nxt))durMap.set(/seg-(\d+)/.exec(nxt)[1],d)}}
}
const fetchSeg=async(u,ms=30000)=>{const t0=Date.now();try{const r=await fetch(u,{agent:AGENT,signal:AbortSignal.timeout(ms)});const ab=await r.arrayBuffer();return{s:r.status,ms:Date.now()-t0,b:ab.byteLength,cr:r.headers.get('content-range')||''}}catch(e){return{s:0,ms:Date.now()-t0,b:0,e:String(e).slice(0,40),cr:''}}};
const inner=u=>{const x=new URL(u);return decodeURIComponent(x.searchParams.get('url')||'')};
console.log(`leg=${leg} n=${n} from seg ${pick[0].id}`);
const stat=(rows)=>{const ms=rows.map(r=>r.ms).sort((a,b)=>a-b);const ok=rows.filter(r=>r.s===200||r.s===0&&r.b>0);
  const sum=ok.length?ok.reduce((a,r)=>a+Math.round(r.b*8/1024/1024*100)/100,0):0;
  const dur=rows.map((r,i)=>{const dd=durMap.get(pick[i].id);return dd||10}).reduce((a,b)=>a+b,0);
  const avg=ms.reduce((a,b)=>a+b,0)/ms.length;
  const p=(q)=>ms[Math.min(ms.length-1,Math.floor(q*ms.length))];
  const worst5=ms.slice(-5);
  const mbps=(m)=>Math.round((m.b||0)*8/1024/1024/(m.ms/1000)*100)/100;
  const per=ok.map(m=>({id:pick[rows.indexOf(m)].id,ms:m.ms,MB:Math.round(m.b/1048576*100)/100,Mbps:mbps(m)}));
  const mbpsArr=ok.map(m=>mbps(m));
  const m50=mbpsArr.sort((a,b)=>b-a)[Math.floor(mbpsArr.length/2)]||0;
  const minM=Math.min(...mbpsArr);const maxM=Math.max(...mbpsArr);
  const bytesOk=ok.reduce((a,r)=>a+r.b,0);
  const bpsActual=bytesOk*8/Math.max(dur,1);
  console.log(`  segs=${rows.length} ok=${ok.length} bytes=${(bytesOk/1048576).toFixed(1)}MB sumDur=${dur.toFixed(1)}s AVG_bps=${(bpsActual/1e6).toFixed(2)}Mbps`);
  console.log(`  ms: avg=${avg.toFixed(0)} p50=${p(.5).toFixed(0)} p95=${p(.95).toFixed(0)} min=${ms[0].toFixed(0)} worst5=${worst5.join(',')}`);
  console.log(`  segMbps: p50=${m50.toFixed(2)} min=${minM.toFixed(2)} max=${maxM.toFixed(2)}`);
  console.log(`  statuses=${rows.map(r=>r.s).join(',')}`);
  return {avg, per};
};
if(leg==='both'||leg==='proxy'){
  console.log('PROXY (real TV path):');
  const rows=[];for(const s of pick){rows.push(await fetchSeg(s.u))}
  const pr=stat(rows);global.__proxy=pr;
}
if(leg==='both'||leg==='direct'){
  console.log('DIRECT (raw vkvideo.cloud):');
  const rows=[];for(const s of pick){rows.push(await fetchSeg(inner(s.u)))}
  const dr=stat(rows);
  if(global.__proxy&&dr.avg){console.log(`overhead: proxyAvg=${global.__proxy.avg.toFixed(0)}ms directAvg=${dr.avg.toFixed(0)}ms ratio=${(global.__proxy.avg/dr.avg).toFixed(2)}x`)}
}