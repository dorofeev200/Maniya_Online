#!/usr/bin/env bash
# T010 P6: real-player run wrapper against PRODUCTION :3000.
# Получает nl105 URL через prod /videos, зовёт CDP-плеер (тот же, что TASK-009 P4).
set -uo pipefail
TOK=$(node -e 'const u=require("/opt/maniya-online/server/data/users.json");const x=(Array.isArray(u)?u:[]).find(a=>a.active)||(Array.isArray(u)?u[0]:null);process.stdout.write(x?x.token:String((u[0]||{}).token||""))' 2>/dev/null)
export P4_TOKEN="$TOK"
P4_URL=$(node -e '
const T=process.env.P4_TOKEN;
(async()=>{
const q=new URLSearchParams({token:T,provider:"filmix",source:"tmdb",title:"История игрушек 5",original_title:"Toy Story 5",year:"2026",serial:"0"});
const r=await fetch("http://127.0.0.1:3000/api/lampa/videos?"+q,{signal:AbortSignal.timeout(50000)});
const j=await r.json();
const it=(j.items||[]).find(i=>i.url&&i.url.includes("cdnsqu"));
if(!it){ console.log(JSON.stringify({ok:false,reason:"NO_NL105",items:(j.items||[]).length,perr:j.provider_error})); process.exit(0);}
console.log(it.url);
})();
')
echo "P4_URL_LEN=${#P4_URL}"
export P4_URL
node /tmp/fpg-shadow/hlscheck/_t009_player.mjs 2>&1
