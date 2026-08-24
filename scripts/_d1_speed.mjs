// D1-speed: размер/скорость /proxy-пути для Alloha (Interstellar) с ноутбука.
import { readFileSync } from 'node:fs';
const BASE = 'http://95.85.241.121';
const users = JSON.parse(readFileSync('backup/snapshots/20260824-180712/users.json', 'utf8'));
const arr = Array.isArray(users) ? users : (users.users || []);
const TOKEN = (arr.find(u=>u.plan==='staging-test'&&u.active)||arr.find(u=>u.active)).token;
const CARD = { source:'tmdb', id:'157336', imdb_id:'tt0816692', kinopoisk_id:'462682', title:'Интерстеллар', original_title:'Interstellar', year:'2014', serial:'0' };
async function get(url,{headers={},readBody=true,timeout=20000,range}={}){
  const t0=Date.now(); let r;
  try{ r=await fetch(url,{signal:AbortSignal.timeout(timeout),headers:{'User-Agent':'Mozilla/5.0 Chrome/126','Accept':'application/vnd.apple.mpegurl,*/*',...(range?{Range:range}:{}),...headers}}); }
  catch(e){ return {err:String(e.message||e),ms:Date.now()-t0,status:0}; }
  const ms=Date.now()-t0, ct=String(r.headers.get('content-type')||'').split(';')[0];
  if(!readBody){ await r.body?.cancel?.().catch?.(()=>{}); return {ms,status:r.status,ct}; }
  const buf=Buffer.from(await r.arrayBuffer().catch(()=>new Uint8Array(0)));
  return {ms,status:r.status,ct,bytes:buf.length,text:buf.toString('utf8')};
}
const q=new URLSearchParams({token:TOKEN,provider:'skaz-alloha',...CARD});
const v=await get(`${BASE}/api/lampa/videos?${q}`);
const items=JSON.parse(v.text).items||[]; const call=items[0];
const rd=await get(`${BASE}${new URL(call.url).pathname}${new URL(call.url).search}&token=${TOKEN}`);
const play=JSON.parse(rd.text||'{}');
const primary=String(play.url||'').split(/\s+or\s+/i)[0];
console.log('play.url:', primary.slice(0,110),'…');
console.log('resolve ms:', rd.ms);
// мастер через /proxy
const m=await get(primary); console.log(`master: ${m.status} ${m.ms}ms ${m.bytes}B ct=${m.ct}`);
// variant 1080p URI
const varLine=m.text.split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).pop();
if(varLine){
  const vu=new URL(varLine,primary).toString();
  const vr=await get(vu); console.log(`variant: ${vr.status} ${vr.ms}ms ${vr.bytes}B`);
  const segLine=vr.text.split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).pop();
  if(segLine){
    const su=new URL(segLine,vu).toString();
    // замер скорости: 4MB чанк
    const t0=Date.now();
    const sr=await get(su,{range:'bytes=0-4194303',timeout:60000});
    const dt=(Date.now()-t0)/1000;
    console.log(`segment 4MB: ${sr.status} ${sr.bytes}B ${dt.toFixed(1)}s → ${(sr.bytes/1048576/dt).toFixed(2)} MB/s`);
    const t1=Date.now();
    const sr2=await get(su,{range:'bytes=0-1048575',timeout:30000});
    const dt2=(Date.now()-t1)/1000;
    console.log(`segment 1MB повтор: ${sr2.status} ${sr2.bytes}B ${dt2.toFixed(1)}s → ${(sr2.bytes/1048576/dt2).toFixed(2)} MB/s`);
  }
}
