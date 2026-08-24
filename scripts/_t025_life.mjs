// TASK-025 evidence gap: does SKAZ-shaped request `lite/events?life=true&<full card incl kp override>` return
// the SAME per-title model as ours (parity under SKAZ wire params)? READ-ONLY, output sanitized.
import { writeFileSync, mkdirSync } from 'node:fs';
const { config } = await import('../server/src/config.js');
const HOSTS = config.skaz.hosts;
const email = encodeURIComponent(String(config.skaz.accountEmail || '').trim());
const uid = encodeURIComponent(String(config.skaz.uid || '').trim());
const SAN = (s) => String(s).replace(new RegExp('account_email=[^&]*'), 'account_email=R').replace(new RegExp('uid=[^&]*'), 'uid=R').replace(new RegExp('nws_id=[^&]*'), 'nws_id=R').replace(new RegExp('memkey=[^&]*'), 'memkey=R');
const getT = async (u, ms = 8000) => {
  const t0 = Date.now(); const c = new AbortController(); const tm = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(u, { headers: { Origin: config.skaz.origin }, signal: c.signal });
    return { status: r.status, ms: Date.now() - t0, text: await r.text() };
  } catch (e) { return { status: 0, ms: Date.now() - t0, text: '', err: String(e) }; }
  finally { clearTimeout(tm); }
};
const BASE = 'kinopoisk_id=5582050&title=%D0%9C%D1%8F%D1%82%D0%B5%D0%B6&original_title=Mutiny&serial=0&original_language=en&year=2026&source=tmdb&clarification=0&similar=false&rchtype=web&cub_id=452257384';
mkdirSync('docs/t025', { recursive: true });
const out = {};
// 1) withsearch → nws token bootstrap (RCH)
const ws = await getT(`${HOSTS[0]}/lite/withsearch?account_email=${email}&uid=${uid}`);
out.withsearch = { status: ws.status, ms: ws.ms, len: ws.text.length };
const nws = (ws.text.match(/nws_id=([a-f0-9]+)/i) || [])[1] || '';
out.withsearch.nws_got = Boolean(nws);
// 2) lite/events?life=true with FULL skaz params (+nws)
const evt = await getT(`${HOSTS[0]}/lite/events?life=true&${BASE}&account_email=${email}&uid=${uid}${nws ? `&nws_id=${nws}` : ''}`);
const rows = (() => { try { const j = JSON.parse(evt.text); const a = Array.isArray(j) ? j : j.online; return a; } catch { return null; } })();
out.events = { status: evt.status, ms: evt.ms, len: evt.text.length, count: rows ? rows.length : null, first: rows?.[0]?.name, firstIndex: rows?.[0]?.index, shown: rows ? rows.filter((r) => r.show === true).length : null, preview: SAN(evt.text.slice(0, 260)) };
writeFileSync('docs/t025/life-events-parity.json', JSON.stringify(out, null, 2), 'utf8');
console.log('withsearch', out.withsearch);
console.log('events?life=true', JSON.stringify(out.events));