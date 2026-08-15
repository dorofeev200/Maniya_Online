#!/usr/bin/env node
// GAP-012 ЭТАП 7 — LIVE SHADOW: OLD (прод :3000, без фикса) vs NEW (shadow :3100, с фиксом).
// Только GET/read-only. Сравнивает вердикт для одних и тех же тайтлов и классифицирует:
//   FIXED        OLD 403 → NEW 200 (фикс вылечил ровно целевую проблему)
//   STILL_403    OLD 403 → NEW 403 (фикс НЕ покрыл — потенциальный FP/недолечено)
//   REGRESSION   OLD 200 → NEW 403 (фикс сломал работавший случай)
//   SAME_GOOD    OLD 200 → NEW 200 (и так работало — фикс не задел)
//   HIDDEN       card.show=false (veoveo скрыт кластером — вне прокси-фикса)
//
// Usage (on VPS):
//   node gap012-veoveo-shadow.mjs [oldBase] [newBase]
import { readFileSync } from 'node:fs';

const OLD = process.argv[2] || 'http://127.0.0.1:3000';
const NEW = process.argv[3] || 'http://127.0.0.1:3100';

let TOKEN = '';
try {
  const users = JSON.parse(readFileSync('/tmp/maniya-shadow/data/users.json', 'utf8'));
  const arr = Array.isArray(users) ? users : [users];
  const user = arr.find((u) => u.token) || arr[0];
  TOKEN = user?.token || '';
} catch { /* fallback */ }
if (!TOKEN) { console.error('NO_TOKEN'); process.exit(2); }

const TITLES = [
  { key: 'odyssey', id: '1368337', kp: '6385370', imdb: 'tt33764258', title: 'Одиссея', year: 2026, serial: 0 },
  { key: 'last_house', id: '1284041', kp: '', imdb: 'tt32268156', title: 'Последний дом', year: 2026, serial: 0 },
  { key: 'forrest', id: '14', kp: '448', imdb: 'tt0109830', title: 'Форрест Гамп', year: 1994, serial: 0 },
  { key: 'matrix', id: '603', kp: '301', imdb: 'tt0133093', title: 'Матрица', year: 1999, serial: 0 },
  { key: 'interstellar', id: '157336', kp: '437410', imdb: 'tt0816692', title: 'Интерстеллар', year: 2014, serial: 0 },
  { key: 'hotd', id: '94997', kp: '1316601', imdb: 'tt11198330', title: 'Дом Дракона', year: 2022, serial: 1 },
  { key: 'oa', id: '67180', kp: '1008365', imdb: 'tt4491250', title: 'The OA', year: 2016, serial: 1 },
  { key: 'silo', id: '125988', kp: '4541515', imdb: 'tt14688458', title: 'Укрытие', year: 2023, serial: 1 },
  { key: 'dune2', id: '693134', kp: '4605820', imdb: 'tt15239678', title: 'Дюна: Часть вторая', year: 2024, serial: 0 },
  { key: 'tlou', id: '100088', kp: '4132429', imdb: 'tt3581920', title: 'Одни из нас', year: 2023, serial: 1 },
  { key: 'avatar', id: '199999', kp: '25121', imdb: 'tt0499549', title: 'Аватар', year: 2009, serial: 0 },
  { key: 'joker', id: '475557', kp: '1043670', imdb: 'tt7286456', title: 'Джокер', year: 2019, serial: 0 }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cardQuery(t) {
  const q = {
    id: String(t.id), title: t.title, original_title: t.original_title, year: String(t.year),
    original_language: 'en', source: 'tmdb', serial: String(t.serial)
  };
  if (t.imdb) q.imdb_id = t.imdb;
  if (t.kp) q.kinopoisk_id = String(t.kp);
  return q;
}

async function apiGet(base, path, params) {
  params.token = TOKEN;
  const url = `${base}${path}?${Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}`;
  const t0 = Date.now();
  let res;
  try { res = await fetch(url, { headers: { accept: 'application/json' } }); }
  catch (e) { return { err: String((e && e.message) || e), ms: Date.now() - t0 }; }
  const ms = Date.now() - t0;
  const text = await res.text().catch(() => '');
  let body = null;
  try { body = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, ms, body };
}

function decodeTarget(proxyUrl) {
  try {
    const u = new URL(proxyUrl);
    if (u.pathname !== '/api/lampa/proxy') return { kind: 'non-proxy', url: proxyUrl };
    return { kind: 'proxy', target: u.searchParams.get('url') || '', host: (() => { try { return new URL(u.searchParams.get('url') || '').host; } catch { return ''; } })() };
  } catch { return { kind: 'parse-fail' }; }
}

// item.url — абсолютный прокси-URL на PUBLIC base (plugin.maniya-kvn.online).
// Чтобы проверить ИМЕННО этот инстанс (OLD :3000 / NEW :3100), хост переписываем
// на base инстанса — query (url, token, origin, ref) сохраняются.
function rewriteProxyUrl(proxyUrl, base) {
  try {
    const u = new URL(proxyUrl);
    const b = new URL(base);
    u.protocol = b.protocol;
    u.host = b.host;
    u.port = b.port;
    return u.toString();
  } catch { return proxyUrl; }
}

async function proxyProbe(proxyUrl) {
  const t0 = Date.now();
  let res;
  try { res = await fetch(proxyUrl, { headers: { range: 'bytes=0-4096', accept: '*/*' } }); }
  catch (e) { return { err: String((e && e.message) || e), ms: Date.now() - t0 }; }
  const ms = Date.now() - t0;
  const ct = res.headers.get('content-type') || '';
  let buf = Buffer.alloc(0);
  const reader = res.body?.getReader?.();
  if (reader) {
    try {
      while (buf.byteLength < 4096) {
        const { done, value } = await reader.read();
        if (done) break;
        buf = Buffer.concat([buf, Buffer.from(value)]);
      }
    } catch { /* ok */ }
    await reader.cancel().catch(() => {});
  } else {
    buf = Buffer.from(await res.arrayBuffer().catch(() => new Uint8Array(0)));
  }
  const head = buf.subarray(0, 256).toString('utf8');
  let kind = 'other';
  if (/mpegurl/i.test(ct) || /^#EXTM3U/.test(head)) kind = 'hls';
  else if (head.charCodeAt(0) === 0x47) kind = 'mp2t';
  else if (/^ftyp/.test(head)) kind = 'mp4';
  const form = (res.status === 403 || res.status === 400) ? (head.trimStart().startsWith('{') ? 'our-json' : 'upstream') : '';
  return { status: res.status, ms, kind, form, firstUrl: head.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#'))?.slice(0, 120) || '' };
}

async function probeTitle(base, t) {
  const q = cardQuery(t);
  const card = await apiGet(base, '/api/lampa/sources/card', { ...q });
  const veoveo = Array.isArray(card.body?.sources) ? card.body.sources.find((s) => s.id === 'skaz-veoveo') : null;
  const show = veoveo ? Boolean(veoveo.show) : false;

  const videos = await apiGet(base, '/api/lampa/videos', { ...q, provider: 'skaz-veoveo' });
  const items = Array.isArray(videos.body?.items) ? videos.body.items : [];
  const probes = [];
  let playSeen = 0, callSeen = 0;
  for (const item of items.slice(0, 14)) {
    if (item.method === 'play' && playSeen < 2) {
      playSeen += 1;
      const dec = decodeTarget(item.url);
      const probe = dec.kind === 'proxy' ? await proxyProbe(rewriteProxyUrl(item.url, base)) : { status: 'non-proxy' };
      probes.push({ method: 'play', probe });
    } else if (item.method === 'call' && callSeen < 1) {
      callSeen += 1;
      const vidParams = { ...q, provider: 'skaz-veoveo' };
      const m = String(item.url || '').match(/voice=(\d+)/);
      if (m) vidParams.voice = m[1];
      if (item.season != null) vidParams.season = String(item.season);
      if (item.episode != null) vidParams.episode = String(item.episode);
      const vid = await apiGet(base, '/api/lampa/video', vidParams);
      const dec = vid.body?.url ? decodeTarget(vid.body.url) : null;
      const probe = dec?.kind === 'proxy' ? await proxyProbe(rewriteProxyUrl(vid.body.url, base)) : null;
      probes.push({ method: 'call', resolveStatus: vid.status, probe });
    }
  }
  return { show, videos: items.length, probes };
}

async function main() {
  const out = [];
  for (const t of TITLES) {
    const oldR = await probeTitle(OLD, t);
    const newR = await probeTitle(NEW, t);
    await sleep(120);

    const oldOk = oldR.probes.some((p) => p.probe && p.probe.status >= 200 && p.probe.status < 300);
    const newOk = newR.probes.some((p) => p.probe && p.probe.status >= 200 && p.probe.status < 300);
    const old403 = oldR.probes.some((p) => p.probe && p.probe.status === 403);
    const new403 = newR.probes.some((p) => p.probe && p.probe.status === 403);
    let verdict;
    if (!newR.show) verdict = 'HIDDEN';
    else if (!oldOk && newOk && old403 && !new403) verdict = 'FIXED';
    else if (oldOk && !newOk) verdict = 'REGRESSION';
    else if (old403 && new403) verdict = 'STILL_403';
    else if (oldOk && newOk) verdict = 'SAME_GOOD';
    else verdict = 'OTHER';

    const row = {
      key: t.key, title: t.title, verdict,
      old: { show: oldR.show, videos: oldR.videos, probes: oldR.probes.map((p) => ({ m: p.method, s: p.probe?.status, k: p.probe?.kind, f: p.probe?.form })) },
      new: { show: newR.show, videos: newR.videos, probes: newR.probes.map((p) => ({ m: p.method, s: p.probe?.status, k: p.probe?.kind, f: p.probe?.form, u: p.probe?.firstUrl })) }
    };
    out.push(row);
    console.log(JSON.stringify(row));
  }
  console.log('SHADOW_DONE');
  console.error(`titles=${TITLES.length}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
