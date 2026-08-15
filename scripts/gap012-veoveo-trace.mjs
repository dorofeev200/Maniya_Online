#!/usr/bin/env node
// GAP-012 ЭТАП 2 — live trace veoveo (READ-ONLY).
//
// Против ПРОД API на VPS (http://127.0.0.1:3000), только GET-запросы. Ничего не
// коммитит и не деплоит. Цель — установить ТОЧНЫЙ источник 403:
//   (1) наш прокси `validateProxyTarget` → 403 proxy_host_forbidden / 400 scheme;
//   (2) upstream veoveo CDN → 403 проброшен насквозь (тело = тело upstream).
// Различаем по телу ответа прокси (наш JSON {error:{code}} vs upstream HTML/текст).
//
// Для каждого тайтла: /sources/card verdict → /videos items (skaz-veoveo) →
// целевой URL (декодировать `url` из /api/lampa/proxy) → proxy-probe с Range →
// классификация. Сериал: items play с season/episode. Повтор forrest ×3.
//
// Usage (on VPS):
//   node gap012-veoveo-trace.mjs            # полный прогон
//   node gap012-veoveo-trace.mjs <key>      # только один тайтл
//   node gap012-veoveo-trace.mjs forrest    # повторный тайтл (×3 внутри)
import { readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3000';

// Прод-токен (только для localhost-запросов, НЕ выводится в отчёт).
let TOKEN = '';
try {
  const users = JSON.parse(readFileSync('/opt/maniya-online/server/data/users.json', 'utf8'));
  const arr = Array.isArray(users) ? users : [users];
  const user = arr.find((u) => u.token) || arr[0];
  TOKEN = user?.token || '';
} catch { /* токен не нужен для диагностики, но нужен для прод-API */ }
if (!TOKEN) { console.error('NO_TOKEN'); process.exit(2); }

const TITLES = [
  { key: 'odyssey', id: '1368337', kp: '6385370', imdb: 'tt33764258', title: 'Одиссея', original_title: 'The Odyssey', year: 2026, serial: 0 },
  { key: 'last_house', id: '1284041', kp: '', imdb: 'tt32268156', title: 'Последний дом', original_title: 'The Last House', year: 2026, serial: 0 },
  { key: 'forrest', id: '14', kp: '448', imdb: 'tt0109830', title: 'Форрест Гамп', original_title: 'Forrest Gump', year: 1994, serial: 0 },
  { key: 'matrix', id: '603', kp: '301', imdb: 'tt0133093', title: 'Матрица', original_title: 'The Matrix', year: 1999, serial: 0 },
  { key: 'interstellar', id: '157336', kp: '437410', imdb: 'tt0816692', title: 'Интерстеллар', original_title: 'Interstellar', year: 2014, serial: 0 },
  { key: 'hotd', id: '94997', kp: '1316601', imdb: 'tt11198330', title: 'Дом Дракона', original_title: 'House of the Dragon', year: 2022, serial: 1 },
  { key: 'oa', id: '67180', kp: '1008365', imdb: 'tt4491250', title: 'The OA', original_title: 'The OA', year: 2016, serial: 1 },
  { key: 'silo', id: '125988', kp: '4541515', imdb: 'tt14688458', title: 'Укрытие', original_title: 'Silo', year: 2023, serial: 1 },
  { key: 'dune2', id: '693134', kp: '4605820', imdb: 'tt15239678', title: 'Дюна: Часть вторая', original_title: 'Dune: Part Two', year: 2024, serial: 0 },
  { key: 'tlou', id: '100088', kp: '4132429', imdb: 'tt3581920', title: 'Одни из нас', original_title: 'The Last of Us', year: 2023, serial: 1 },
  // Запасные популярные тайтлы — ищем «веoveo реально играет».
  { key: 'dune1', id: '438631', kp: '453582', imdb: 'tt1160419', title: 'Дюна', original_title: 'Dune', year: 2021, serial: 0 },
  { key: 'avatar', id: '199999', kp: '25121', imdb: 'tt0499549', title: 'Аватар', original_title: 'Avatar', year: 2009, serial: 0 },
  { key: 'spiderman_nwh', id: '634649', kp: '4633702', imdb: 'tt10872600', title: 'Человек-паук: Нет пути домой', original_title: 'Spider-Man: No Way Home', year: 2021, serial: 0 },
  { key: 'titanic', id: '597', kp: '2213', imdb: 'tt0120338', title: 'Титаник', original_title: 'Titanic', year: 1997, serial: 0 },
  { key: 'joker', id: '475557', kp: '1043670', imdb: 'tt7286456', title: 'Джокер', original_title: 'Joker', year: 2019, serial: 0 }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cardQuery(t) {
  const q = {
    id: String(t.id),
    title: t.title,
    original_title: t.original_title,
    year: String(t.year),
    original_language: 'en',
    source: 'tmdb',
    serial: String(t.serial)
  };
  if (t.imdb) q.imdb_id = t.imdb;
  if (t.kp) q.kinopoisk_id = String(t.kp);
  return q;
}

function toQuery(params) {
  const url = new URL(BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.searchParams.toString();
}

async function apiGet(path, params) {
  params.token = TOKEN;
  const url = `${BASE}${path}?${toQuery(params)}`;
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (e) {
    return { err: String((e && e.message) || e), ms: Date.now() - t0 };
  }
  const ms = Date.now() - t0;
  const text = await res.text().catch(() => '');
  let body = null;
  try { body = JSON.parse(text); } catch { /* не-JSON */ }
  return { status: res.status, ms, body, rawHead: text.slice(0, 100) };
}

/** Из прокси-URL `/api/lampa/proxy?url=...` вытащить целевой URL + host. */
function decodeTarget(proxyUrl) {
  try {
    const u = new URL(proxyUrl);
    if (u.pathname !== '/api/lampa/proxy') return { kind: 'non-proxy', url: proxyUrl };
    const target = u.searchParams.get('url') || '';
    const t = new URL(target);
    return { kind: 'proxy', target, host: t.host, protocol: t.protocol, origin: u.searchParams.get('origin') || '', ref: u.searchParams.get('ref') || '' };
  } catch {
    return { kind: 'parse-fail', url: String(proxyUrl || '').slice(0, 120) };
  }
}

/** HEAD-подобный probe прокси с Range (как плеер). Тело обрезаем до 4KB. */
async function proxyProbe(proxyUrl) {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(proxyUrl, { headers: { range: 'bytes=0-4096', accept: '*/*' } });
  } catch (e) {
    return { err: String((e && e.message) || e), ms: Date.now() - t0 };
  }
  const ms = Date.now() - t0;
  const ct = res.headers.get('content-type') || '';
  const cl = res.headers.get('content-length') || '';
  // Читаем ТОЛЬКО первые ~4KB и закрываем соединение — иначе при игноре Range
  // upstream'ом скачаем весь медиа-файл (сотни МБ).
  let buf = Buffer.alloc(0);
  const reader = res.body?.getReader?.();
  if (reader) {
    try {
      while (buf.byteLength < 4096) {
        const { done, value } = await reader.read();
        if (done) break;
        buf = Buffer.concat([buf, Buffer.from(value)]);
      }
    } catch { /* прерванный стрим — ок для probe */ }
    await reader.cancel().catch(() => {});
  } else {
    buf = Buffer.from(await res.arrayBuffer().catch(() => new Uint8Array(0)));
  }
  const head = buf.subarray(0, 256).toString('utf8');
  const mediaKind = mediaKindOf(ct, head);
  let form = '';
  if (res.status === 403 || res.status === 400) {
    const t = head.trimStart();
    if (t.startsWith('{')) form = 'our-json';
    else if (t.startsWith('<')) form = 'upstream-html';
    else form = 'upstream-text';
  }
  return { status: res.status, ms, ct, cl, bytes: buf.byteLength, head: head.slice(0, 140).replace(/\n/g, '\\n'), mediaKind, form };
}

function mediaKindOf(ct, head) {
  if (/mpegurl/i.test(ct)) return 'hls';
  if (/dash/i.test(ct)) return 'dash';
  if (/^ftyp/.test(head)) return 'mp4';
  if (head.charCodeAt(0) === 0x47) return 'mp2t';
  if (/^#EXTM3U/.test(head)) return 'hls';
  if (/video\/mp2t|video\/ts/i.test(ct)) return 'mp2t';
  if (/^video\//i.test(ct)) return 'video';
  return 'other';
}

/** Первые 300 символов манифеста: переписаны ли сегменты на наш прокси. */
function manifestCheck(head) {
  if (!/^#EXTM3U/.test(head)) return null;
  const hasProxy = head.includes('/api/lampa/proxy');
  const firstUrl = head.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) || '';
  return { hasProxySegments: hasProxy, firstSegment: firstUrl.slice(0, 140) };
}

async function traceTitle(t, repeat = 0) {
  const q = cardQuery(t);
  const row = { key: t.key, title: t.title, year: t.year, serial: t.serial, repeat, out: [] };

  // 1) card verdict
  const card = await apiGet('/api/lampa/sources/card', { ...q });
  let veoveoRow = null;
  if (Array.isArray(card.body?.sources)) {
    veoveoRow = card.body.sources.find((s) => s.id === 'skaz-veoveo') || null;
  }
  row.card = {
    status: card.status, ms: card.ms,
    cached: card.body?.meta?.cached ?? null, elapsed_ms: card.body?.meta?.elapsed_ms ?? null,
    veoveoShow: veoveoRow ? Boolean(veoveoRow.show) : null,
    total: Array.isArray(card.body?.sources) ? card.body.sources.length : null
  };

  // 2) videos (skaz-veoveo)
  const videos = await apiGet('/api/lampa/videos', { ...q, provider: 'skaz-veoveo' });
  const items = Array.isArray(videos.body?.items) ? videos.body.items : [];
  row.videos = {
    status: videos.status, ms: videos.ms,
    items: items.length,
    seasons: Array.isArray(videos.body?.seasons) ? videos.body.seasons.length : null,
    voices: Array.isArray(videos.body?.voices) ? videos.body.voices.length : null,
    provider_error: videos.body?.provider_error || null
  };

  // 3) per-item: target + proxy probe (первые play/call; для сериала — первую серию)
  const seen = { play: 0, call: 0 };
  for (const item of items.slice(0, 12)) {
    const isSerial = item.type === 'serial';
    if (item.method === 'play') {
      if (seen.play >= 2) continue;
      seen.play += 1;
      const dec = decodeTarget(item.url);
      const probe = dec.kind === 'proxy' ? await proxyProbe(item.url) : null;
      row.out.push({
        slot: isSerial ? 'ep' : 'mov', method: 'play',
        title: item.title || '', episode: item.episode ?? null,
        dec, probe, manifest: probe ? manifestCheck(probe.head) : null
      });
    } else if (item.method === 'call') {
      if (seen.call >= 1) continue;
      seen.call += 1;
      // ленивый резолв голоса/серии
      const vidParams = { ...q, provider: 'skaz-veoveo' };
      const vIdx = item.voice_index ?? null;
      // Lampa шлёт голос в query.voice; у нас индекс = порядковый номер call-карточки.
      // Определяем индекс по url резолва (buildResolveUrl содержит voice=N).
      const m = String(item.url || '').match(/voice=(\d+)/);
      if (m) vidParams.voice = m[1];
      if (item.season != null) vidParams.season = String(item.season);
      if (item.episode != null) vidParams.episode = String(item.episode);
      const vid = await apiGet('/api/lampa/video', vidParams);
      const resolved = vid.body || null;
      const dec = resolved?.url ? decodeTarget(resolved.url) : null;
      const probe = dec?.kind === 'proxy' ? await proxyProbe(resolved.url) : null;
      row.out.push({
        slot: isSerial ? 'ep' : 'mov', method: 'call',
        title: item.title || '', episode: item.episode ?? null,
        resolveStatus: vid.status, resolveMs: vid.ms,
        resolvedMethod: resolved?.method || null,
        dec, probe, manifest: probe ? manifestCheck(probe.head) : null
      });
    }
  }

  return row;
}

async function main() {
  const only = process.argv[2];
  const targets = only ? TITLES.filter((t) => t.key === only) : TITLES;
  if (!targets.length) { console.error(`unknown title: ${only}`); process.exit(2); }
  const rows = [];
  for (const t of targets) {
    // повторы: forrest ×3 (карточка кэшируется продом — повтор кард = hit, но /videos
    // и прокси идут в кластер каждый раз → стабильность/флап 403).
    const repeats = t.key === 'forrest' ? 3 : 1;
    for (let r = 0; r < repeats; r += 1) {
      const row = await traceTitle(t, r);
      rows.push(row);
      console.log(JSON.stringify(row));
      await sleep(150);
    }
  }
  console.log('TRACE_DONE');
  console.error(`titles=${targets.length} rows=${rows.length}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
