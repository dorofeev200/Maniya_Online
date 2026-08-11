// PERF MEASUREMENT (directive C-track B): STARTUP LATENCY, «Человек-паук: Нет пути домой»
// (2021), provider skaz-alloha (Allo-XA), перевод HDrezka Studio, качество 1080p.
//
// Цель — замерить МЕДИАНУ (>=3 запусков) по стадиям T0..T8 в двух цепях:
//   A. E-Online-путь (прямой, без нашего сервера/прокси): lite-страница → resolveVideoJson
//      → мастер-манифест CDN → variant 1080p → init → сегмент.
//   B. Maniya-путь (через наш сервер):
//      BEFORE (eager, старый код): /api/lampa/videos → items уже резолвнуты play-URL → мастер.
//      AFTER (lazy, текущий код):  /api/lampa/videos (быстрые call-items) →
//                                  /api/lampa/video (1 резолв выбранного голоса) → мастер.
// Обе цепи идут с ОДНОГО хоста (VPS: 127.0.0.1) — один DNS, одна сеть до CDN →
// разница = ТОЛЬКО наша серверная/прокси-наценка + eager-vs-lazy число резолвов.
//
// Стадии (что тут измеряем):
//   T0 = старт run'а (нажатие Play)
//   T1 = запрос стартовал
//   T2 = ответ провайдера (videos payload / lite-страница)
//   T3 = дескриптор потока готов (JSON video / item.url)
//   T3b = lazy-резолв выбранного голоса (/api/lampa/video) [только AFTER]
//   T4 = мастер-манифест (TTFB)
//   T4b = вариант 1080p (TTFB) [если мастер — ремап]
//   T5 = init-сегмент (TTFB) [если EXT-X-MAP; иначе skip]
//   T6 = первый медиа-сегмент (TTFB + TTL)
//   T7 = данные декодируемы (аппроксимация = T6 TTFB)
//   T8 = первый кадр (аппроксимация = T6 TTL: сегмент скачан)
//
// Запуск: node scripts/startup-latency.mjs [--runs N] [--mode both|direct|proxy]
//         [--base http://127.0.0.1:PORT] [--voice N]
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Локальный репозиторий: scripts/../server/src/config.js. VPS-деплой: scripts/../src/config.js.
const serverDir = [path.join(here, '..', 'server'), path.join(here, '..')].find((dir) => existsSync(path.join(dir, 'src', 'config.js')));
if (!serverDir) { console.error('ERR: не найден server/src/config.js'); process.exit(2); }
const config = (await import(path.join(serverDir, 'src', 'config.js'))).config;

const args = process.argv.slice(2);
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const runs = Number(argOf('--runs')) || 5;
const mode = String(argOf('--mode') || 'both').toLowerCase();
const base = argOf('--base') || 'http://127.0.0.1:3000';
const voice = Number(argOf('--voice')) || 0;

const SPIDER = {
  id: '634649', tmdb_id: '634649', imdb_id: 'tt10872600', kinopoisk_id: '1309570',
  title: 'Человек-паук: Нет пути домой', original_title: 'Spider-Man: No Way Home',
  serial: '0', year: '2021'
};

const users = JSON.parse(readFileSync(config.usersFile, 'utf8'));
const token = (Array.isArray(users) && (users.find((x) => x && x.active && x.token) || users[0])?.token) || '';
const accountEmail = config.skaz.accountEmail;
const uid = config.skaz.uid;
const origin = config.skaz.origin;
const skazHosts = config.skaz.hosts;

if (!token || !accountEmail || !uid) {
  console.error('ERR: нет token/accountEmail/uid — нужны data/users.json + .env (SKAZ_*/EO_*)');
  process.exit(2);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const MANIFEST_HEADERS = { 'Accept': 'application/vnd.apple.mpegurl,*/*', 'User-Agent': UA };

let requestCount = 0; // всего HTTP-запросов от T0 до первого кадра (все цепи)

// Один запрос: [ttfb_ms, ttl_ms, status, ct, bytes, text|null]
async function oneFetch(url, opts = {}, headers = {}, readBody = true) {
  requestCount += 1;
  const t0 = Date.now();
  let ttfb = 0;
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(25000), headers: { 'User-Agent': UA, ...headers }, ...opts });
    ttfb = Date.now() - t0;
    const ct = String(r.headers.get('content-type') || '').split(';')[0];
    if (!readBody) {
      await r.body?.cancel?.().catch?.(() => {});
      return { ttfb, ttl: Date.now() - t0, status: r.status, ct, bytes: 0, text: null };
    }
    const buf = Buffer.from(await r.arrayBuffer().catch(() => new Uint8Array(0)));
    return { ttfb, ttl: Date.now() - t0, status: r.status, ct, bytes: buf.length, text: buf.toString('utf8') };
  } catch (e) {
    return { ttfb, ttl: Date.now() - t0, status: 0, ct: '', bytes: 0, text: null, error: e.message };
  }
}

function parseMedia(manifest) {
  const text = String(manifest || '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const streamInf = /#EXT-X-STREAM-INF/i.test(text);
  const xmap = (text.match(/#EXT-X-MAP:[^\n]*URI="([^"]+)"/) || [])[1] || null;
  const media = lines.filter((l) => l && !l.startsWith('#'));
  return { streamInf, xmap, media, text };
}

function resolveUrl(ref, baseUrl) {
  try { return ref == null ? null : new URL(String(ref), baseUrl).toString(); } catch { return null; }
}

// Выбор варианта 1080p из мастер-ремапа (RESOLUTION=1920x1080), иначе первый.
function pickVariant(masterText, masterUrl) {
  const lines = String(masterText || '').split(/\r?\n/);
  const block = [];
  const variants = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { if (block.length) variants.push([...block]); block.length = 0; continue; }
    block.push(trimmed);
    if (!trimmed.startsWith('#')) { variants.push([...block]); block.length = 0; }
  }
  if (block.length) variants.push([...block]);
  let picked = variants[0] || null;
  for (const v of variants) {
    if (/#EXT-X-STREAM-INF[^\n]*RESOLUTION=1920x1080/i.test(v.join('\n'))) { picked = v; break; }
  }
  if (!picked) return null;
  const urlLine = picked.filter((l) => !l.startsWith('#')).pop() || '';
  const url = resolveUrl(urlLine, masterUrl);
  return { url, attr: picked.find((l) => l.startsWith('#EXT-X-STREAM-INF')) || '' };
}

// ══════════════ ЦЕПЬ A: E-ONLINE (прямой) ══════════════
async function directLite(balancer, params) {
  for (let i = 0; i < skazHosts.length; i++) {
    const u = new URL(`${skazHosts[i % skazHosts.length]}/lite/${balancer}`);
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    u.searchParams.set('account_email', accountEmail);
    u.searchParams.set('uid', uid);
    const r = await oneFetch(u.toString(), {}, { accept: '*/*' });
    if (r.status >= 200 && r.status < 300 && /text\/html/.test(r.ct)) return { url: u.toString(), r };
  }
  return { url: '', r: { ttfb: 0, status: 0 } };
}

async function directVideoJson(streamUrl) {
  let target;
  try {
    const v = new URL(streamUrl);
    v.searchParams.set('account_email', accountEmail);
    v.searchParams.set('uid', uid);
    v.pathname = v.pathname.replace(/\.m3u8$/i, '');
    v.searchParams.delete('play');
    target = v.toString();
  } catch { return { r: { status: 0 }, json: null }; }
  const r = await oneFetch(target, {}, { accept: '*/*', Origin: origin });
  let json = null;
  try { json = JSON.parse(r.text || ''); } catch {}
  return { r, json };
}

// data-json в lite-странице экранирует & как & (= как =, слэш как \/):
// вытащенный regex'ом URL — JSON-строка, а не URL. Декодируем ESC-последовательности.
function decodeJsonEscapes(raw) {
  return String(raw || '')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\\//g, '/')
    .replace(/\\u003[a-f]/gi, (m) => String.fromCharCode(parseInt(m.slice(2), 16)));
}

// ══════════════ ОБЩИЙ прогон HLS-цепи от «мастера» ══════════════
async function runHlsChain(masterUrl) {
  const trace = [];
  // T4: мастер
  const m = await oneFetch(masterUrl, {}, MANIFEST_HEADERS);
  trace.push({ stage: 'T4_master_ttfb', ms: m.ttfb, status: m.status, ct: m.ct, bytes: m.bytes });
  const masterInfo = parseMedia(m.text);

  // вариант 1080p: T4b
  let renderUrl = masterUrl;
  let renderText = m.text || '';
  if (masterInfo.streamInf && masterInfo.media.length) {
    const variant = pickVariant(renderText, masterUrl);
    if (variant?.url) {
      const v = await oneFetch(variant.url, {}, MANIFEST_HEADERS);
      trace.push({ stage: 'T4b_variant_ttfb', ms: v.ttfb, status: v.status, ct: v.ct, note: variant.attr.trim().slice(0, 60) });
      if (v.status >= 200 && v.status < 300) { renderUrl = variant.url; renderText = v.text || ''; }
    }
  }
  const renderInfo = parseMedia(renderText);

  // T5: init
  if (renderInfo.xmap) {
    const initUrl = resolveUrl(renderInfo.xmap, renderUrl);
    const i = await oneFetch(initUrl, {}, { 'User-Agent': UA, Range: 'bytes=0-1048575' });
    trace.push({ stage: 'T5_init_ttfb', ms: i.ttfb, status: i.status, ct: i.ct, bytes: i.bytes });
    trace.push({ stage: 'T5_init_ttl', ms: i.ttl });
  } else {
    trace.push({ stage: 'T5_init', ms: 0, note: 'no-EXT-X-MAP' });
  }

  // T6: первый сегмент
  if (renderInfo.media.length) {
    const segUrl = resolveUrl(renderInfo.media[0], renderUrl);
    const s = await oneFetch(segUrl, {}, { 'User-Agent': UA, Range: 'bytes=0-1048575' });
    trace.push({ stage: 'T6_seg_ttfb', ms: s.ttfb, status: s.status, ct: s.ct, bytes: s.bytes });
    trace.push({ stage: 'T6_seg_ttl', ms: s.ttl });
  } else {
    trace.push({ stage: 'T6_seg', ms: 0, note: 'no segments' });
  }
  return { trace };
}

async function runDirectChain() {
  requestCount = 0;
  const trace = [];
  const liteParams = {
    id: SPIDER.id, imdb_id: SPIDER.imdb_id, kinopoisk_id: SPIDER.kinopoisk_id,
    title: SPIDER.title, original_title: SPIDER.original_title, serial: '0', year: SPIDER.year, source: 'tmdb'
  };
  const { url: liteUrl, r: liteR } = await directLite('alloha', liteParams);
  trace.push({ stage: 'T2_lite', ms: liteR.ttfb, status: liteR.status, ct: liteR.ct });

  let playUrl = null;
  if (liteR.text) {
    const m3u8s = [...liteR.text.matchAll(/([^"'\s<>]+\.m3u8[^"'\s<>]*)/gi)].map((x) => decodeJsonEscapes(x[1]).trim());
    const streamUrl = m3u8s[voice] !== undefined ? resolveUrl(m3u8s[voice], liteUrl) : null;
    if (streamUrl) {
      const vj = await directVideoJson(streamUrl);
      trace.push({ stage: 'T3_resolveJson', ms: vj.r.ttfb, status: vj.r.status, okJson: Boolean(vj.json) });
      playUrl = vj.json?.url ? String(vj.json.url).split(/\s+or\s+/i)[0].trim() : null;
    }
  }
  trace.push({ stage: 'T3_descriptor', ms: 0, playUrl: playUrl ? playUrl.slice(0, 50) : null });
  if (!playUrl) return { trace, reqs: requestCount, verdict: `FAIL:no-play-url (voices=${voice})` };

  const { trace: hls } = await runHlsChain(playUrl);
  trace.push(...hls);
  return { trace, reqs: requestCount, verdict: 'OK' };
}

async function runProxyChain() {
  requestCount = 0;
  const trace = [];
  const q = new URLSearchParams({ token, provider: 'skaz-alloha', voice: String(voice), ...SPIDER });
  const vr = await oneFetch(`${base}/api/lampa/videos?${q}`, {}, MANIFEST_HEADERS);
  trace.push({ stage: 'T2_videos', ms: vr.ttfb, status: vr.status, ct: vr.ct, bytes: vr.bytes });
  let item0 = null;
  try { item0 = (JSON.parse(vr.text || '{}') || {}).items?.[voice] || (JSON.parse(vr.text || '{}') || {}).items?.[0] || null; } catch {}
  trace.push({ stage: 'T3_descriptor', ms: 0, hasItem: Boolean(item0), method: item0?.method || null, title: item0?.title || null });
  if (!item0) return { trace, reqs: requestCount, verdict: 'FAIL:no-items' };

  const rewriteLocal = (url) => {
    try { const u = new URL(url); const b = new URL(base); u.protocol = b.protocol; u.host = b.host; return u.toString(); } catch { return url; }
  };

  let masterProxyUrl = null;
  if (item0.method === 'call') {
    // ЛЕНИВАЯ цепь (AFTER): дескриптор выбранного голоса только на Play.
    const lr = await oneFetch(rewriteLocal(item0.url), {}, MANIFEST_HEADERS);
    trace.push({ stage: 'T3b_video', ms: lr.ttfb, status: lr.status, ct: lr.ct });
    let item = null;
    try { item = JSON.parse(lr.text || '{}'); } catch {}
    masterProxyUrl = item?.url || null;
  } else {
    // EAGER-цепь (BEFORE): items уже play-дескрипторы.
    masterProxyUrl = item0.url || null;
  }
  if (masterProxyUrl) masterProxyUrl = rewriteLocal(masterProxyUrl);
  trace.push({ stage: 'T3_play', ms: 0, hasUrl: Boolean(masterProxyUrl), url: masterProxyUrl ? masterProxyUrl.slice(0, 50) : null });
  if (!masterProxyUrl) return { trace, reqs: requestCount, verdict: 'FAIL:no-play-url' };

  const { trace: hls } = await runHlsChain(masterProxyUrl);
  trace.push(...hls);
  return { trace, reqs: requestCount, verdict: 'OK' };
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const STAGES = ['T2_lite', 'T2_videos', 'T3_resolveJson', 'T3b_video', 'T4_master_ttfb', 'T4b_variant_ttfb', 'T5_init_ttfb', 'T5_init_ttl', 'T6_seg_ttfb', 'T6_seg_ttl'];

async function runSet(label, fn) {
  const acc = new Map();
  const verdicts = [];
  const reqsAll = [];
  const serials = [];
  for (let i = 0; i < runs; i++) {
    const res = await fn();
    verdicts.push(res.verdict);
    reqsAll.push(res.reqs);
    const byStage = {};
    for (const s of res.trace) byStage[s.stage] = s.ms ?? null;
    for (const st of STAGES) {
      if (byStage[st] != null) {
        if (!acc.has(st)) acc.set(st, []);
        acc.get(st).push(byStage[st]);
      }
    }
    // Серийный путь до первого кадра: sum стадий (T6_ttl включает ttfb).
    const serialPath = ['T2_lite', 'T2_videos', 'T3_resolveJson', 'T3b_video', 'T4_master_ttfb', 'T4b_variant_ttfb', 'T5_init_ttfb'].filter((s) => byStage[s] != null);
    const serial = serialPath.reduce((sum, s) => sum + (byStage[s] || 0), 0) + (byStage.T6_seg_ttl || byStage.T6_seg_ttfb || 0);
    serials.push(serial);
  }
  console.log(`\n## ${label} — runs=${runs} (${verdicts.join('/')})`);
  for (const st of STAGES) {
    const vals = acc.get(st);
    if (!vals) continue;
    console.log(`  ${st.padEnd(20)} median=${median(vals).toFixed(0).padStart(5)}ms  raw=[${vals.map((v) => v.toFixed(0)).join(', ')}]`);
  }
  console.log(`  ${'SER_TO_FRAME'.padEnd(20)} median=${median(serials).toFixed(0).padStart(5)}ms  raw=[${serials.map((v) => v.toFixed(0)).join(', ')}]`);
  console.log(`  ${'REQS_TO_FRAME'.padEnd(20)} median=${median(reqsAll)}  raw=[${reqsAll.join(', ')}]`);
}

console.log(`runs=${runs} mode=${mode} base=${base} voice=${voice}`);
if (mode === 'both' || mode === 'direct') await runSet('A. E-ONLINE (прямая цепь)', runDirectChain);
if (mode === 'both' || mode === 'proxy') await runSet('B. MANIYA (через сервер)', runProxyChain);
console.log('\ndone');