// BALANCER-SEMANTICS-005-W1 — B-HUNTER (live, staged):
// Ищем ЖИВОЙ B-кейс: нода N возвращает 2xx-non-usable, но ПОЗЖЕ по пулу есть контент.
// oldLite (raw-порядок, FAIL-NOT-RETRY) → EMPTY; NEW (continue-скан) → CONTENT.
// Плюс изоляция videoseed/Дом Дракона: nopin vs pin на СВЕЖИХ провайдерах
// (исключить перенос _hostIndex между вызовами в одном instance).
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(here, '..', 'server');
const resolve = (rel) => pathToFileURL(path.join(serverRoot, rel)).href;
const config = (await import(resolve('src/config.js'))).config;
const { providerById } = await import(resolve('src/providers/registry.js'));
const { SkazClient, isUsablePage } = await import(resolve('src/providers/skaz/SkazClient.js'));

const QUERIES = {
  'Интерстеллар': { id: '157336', imdb_id: 'tt0816692', kinopoisk_id: '437410', title: 'Интерстеллар', original_title: 'Interstellar', year: 2014, serial: 0 },
  'Форрест Гамп': { id: '13', imdb_id: 'tt0109830', kinopoisk_id: '448', title: 'Форрест Гамп', original_title: 'Forrest Gump', year: 1994, serial: 0 },
  'Дом Дракона': { id: '94997', imdb_id: 'tt11198330', title: 'Дом Дракона', original_title: 'House of the Dragon', year: 2022, serial: 1 }
};
const email = config.skaz.accountEmail;
const uid = config.skaz.uid;
const rawHosts = (config.skaz.hosts || []).filter(Boolean);
const orderedHosts = [...rawHosts].sort((a, b) => (String(a).includes('online8') ? 1 : 0) - (String(b).includes('online8') ? 1 : 0));

let token = '';
try {
  const users = JSON.parse(readFileSync(config.usersFile, 'utf8'));
  const anyUser = (Array.isArray(users) ? users.find((u) => u && u.active && u.token) : null) || (Array.isArray(users) ? users[0] : null);
  token = (anyUser && anyUser.token) || '';
} catch { token = ''; }
const userUid = crypto.createHash('sha256').update(String(token || '')).digest('hex').slice(0, 16);

const build = (host, balancer, query) => {
  const u = new URL(`${host}/lite/${balancer}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  u.searchParams.set('account_email', email);
  u.searchParams.set('uid', uid);
  return u.toString();
};

async function hostVerdict(url) {
  const started = Date.now();
  try {
    const r = await fetch(url, { headers: { accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    if (!r) return { kind: 'no-response', ms: Date.now() - started };
    if (!(r.status >= 200 && r.status < 300)) return { kind: 'non-2xx', status: r.status, ms: Date.now() - started };
    const text = await r.text().catch(() => null);
    if (text == null) return { kind: 'no-body', status: r.status, ms: Date.now() - started };
    if (isUsablePage(text)) return { kind: 'CONTENT', status: r.status, cards: (String(text).match(/data-json\s*=/g) || []).length, ms: Date.now() - started };
    return { kind: 'EMPTY-2xx', status: r.status, ms: Date.now() - started };
  } catch { return { kind: 'timeout', ms: Date.now() - started }; }
}

async function oldLite(balancer, query) {
  const attempts = [];
  for (let i = 0; i < rawHosts.length; i += 1) {
    const v = await hostVerdict(build(rawHosts[i], balancer, query));
    attempts.push({ host: rawHosts[i], v });
    if (v.kind === 'CONTENT') return { verdict: 'CONTENT', attempts };
    if (v.kind === 'EMPTY-2xx') return { verdict: 'EMPTY', attempts }; // FAIL-NOT-RETRY
    // non-2xx / timeout / no-response / no-body → continue
  }
  return { verdict: 'EMPTY', attempts };
}

async function newLite(balancer, query) {
  const client = new SkazClient({ balancer, hosts: rawHosts, accountEmail: email, uid });
  const html = await client.getLite(query);
  return { verdict: html ? 'CONTENT' : 'EMPTY', lastScan: client.lastScan, html: html ? true : false };
}

const balancers = (await import(resolve('src/providers/registry.js'))).registeredProviders()
  .filter((p) => p.enabled() && String(p.id).startsWith('skaz-'))
  .map((p) => p.balancer);

console.log(`BHUNT uid=${userUid} balancers=${balancers.length}`);
const bCases = [];
for (const [tname, query] of Object.entries(QUERIES)) {
  console.log(`\n### ${tname}`);
  for (const bal of balancers) {
    const oldRes = await oldLite(bal, query);
    const newRes = await newLite(bal, query);
    const isB = oldRes.verdict === 'EMPTY' && newRes.verdict === 'CONTENT';
    const tag = isB ? '  <<<< B-CASE (OLD EMPTY / NEW CONTENT)' : '';
    if (isB || oldRes.verdict === 'CONTENT' || newRes.verdict === 'CONTENT') {
      console.log(`  ${bal.padEnd(12)} OLD=${oldRes.verdict.padEnd(7)} NEW=${newRes.verdict.padEnd(7)} lastScan=${newRes.lastScan ? JSON.stringify(newRes.lastScan) : '-'}${tag}`);
    } else {
      console.log(`  ${bal.padEnd(12)} OLD=${oldRes.verdict.padEnd(7)} NEW=${newRes.verdict} (empty both)`);
    }
    if (isB) bCases.push({ tname, bal, oldRes, newRes });
  }
}
console.log(`\nB-CASES: ${bCases.length}`);
for (const b of bCases) {
  console.log(`  B: ${b.tname}/${b.bal} OLD EMPTY (${b.oldRes.attempts.map((a) => `${a.host.replace(/^https?:\/\//, '')}:${a.v.kind}${a.v.status ? '/' + a.v.status : ''}`).join(' > ')})`);
}

// Изоляция videoseed/Дом Дракона: СВЕЖИЙ провайдер на каждый вызов
console.log('\n### videoseed/Дом Дракона: свежие провайдеры для nopin и pin');
{
  const query = { id: '94997', imdb_id: 'tt11198330', title: 'Дом Дракона', original_title: 'House of the Dragon', year: 2022, serial: 1, source: 'tmdb' };
  const mkCtx = (host) => ({ query: { token: '', ...query, ...(host ? { host } : {}) }, request: {} });
  const provId = 'skaz-videoseed';
  const p1 = providerById(provId);
  if (p1) {
    try {
      const r1 = await p1.videos(mkCtx(null));
      console.log(`  nopin (fresh): items=${(r1?.items || []).length} err=${r1?.provider_error?.code || '-'}`);
    } catch (e) { console.log(`  nopin (fresh): EXC ${String(e).slice(0, 60)}`); }
    try {
      const r2 = await p1.videos(mkCtx('http://online3.skaz.tv'));
      console.log(`  pin online3 (fresh): items=${(r2?.items || []).length} err=${r2?.provider_error?.code || '-'}`);
    } catch (e) { console.log(`  pin online3 (fresh): EXC ${String(e).slice(0, 60)}`); }
  }
}
console.log('\nBHUNT done');