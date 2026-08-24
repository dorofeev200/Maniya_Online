// KODIK-PLAYBACK-FIX-001 — PRODUCTION VERIFICATION (live, READ-ONLY).
// Цель: доказать, что после добавления solodcdn.com в proxy.allowHosts:
//   У 403 proxy_host_forbidden на Kodik CDN больше не возникает;
//   У master/variant/segment/Range через Maniya-прокси отдают 200/206;
//   У оба CDN-корня (sky, cloud) и serving-ноды редиректов покрыты одним суффиксом;
//   У регрессии провайдеров (filmix/alloha/veoveo/rezka/kinopub/videoseed) нет.
// Ничего не меняет на сервере. Секреты не печатаются.
import { loadUserA } from './_creds.mjs';

const BASE = process.env.PROD_BASE_URL || 'https://plugin.maniya-kvn.online';
const userA = loadUserA();
if (!userA?.token) { console.log('FATAL: прод-токен не найден (temp prod-verify-users.json / PROD_TOKEN)'); process.exit(2); }
const TOKEN = userA.token;

const UA = 'Mozilla/5.0 (KODIK-PLAYBACK-FIX-001 verify)';

// Тайтлы из аудита: обязателен Паразиты + 5 контрольных (фильмы ko/ja + сериал).
const KODIK_TITLES = [
  { label: 'Паразиты 2019 (ko)',        query: { id: '496243', imdb_id: 'tt6751668',  title: 'Паразиты',        original_title: 'Parasite',       original_language: 'ko', source: 'tmdb', year: 2019, serial: 0 } },
  { label: 'Унесённые призраками 2001 (ja)', query: { id: '129', imdb_id: 'tt0245429', title: 'Унесённые призраками', original_title: 'Spirited Away',  original_language: 'ja', source: 'tmdb', year: 2001, serial: 0 } },
  { label: 'Мой сосед Тоторо 1988 (ja)', query: { id: '8392', imdb_id: 'tt0096283',   title: 'Мой сосед Тоторо',   original_title: 'My Neighbor Totoro', original_language: 'ja', source: 'tmdb', year: 1988, serial: 0 } },
  { label: 'Олдбой 2003 (ko)',          query: { id: '670', imdb_id: 'tt0364569',    title: 'Олдбой',            original_title: 'Oldboy',             original_language: 'ko', source: 'tmdb', year: 2003, serial: 0 } },
  { label: 'Поезд в Пусан 2016 (ko)',   query: { id: '416477', imdb_id: 'tt5700672', title: 'Поезд в Пусан',     original_title: 'Train to Busan',     original_language: 'ko', source: 'tmdb', year: 2016, serial: 0 } },
  { label: 'Игра в кальмара 2021 (ko, serial)', query: { id: '93405', imdb_id: 'tt10919420', title: 'Игра в кальмара', original_title: 'Squid Game', original_language: 'ko', source: 'tmdb', year: 2021, serial: 1 } }
];

const REGRESSION = [
  { id: 'filmix',    label: 'filmix',    card: { id: '13', imdb_id: 'tt0109830', title: 'Форрест Гамп', original_title: 'Forrest Gump', source: 'tmdb', year: 1994, serial: 0 } },
  { id: 'veoveo',    label: 'veoveo',    card: { id: '13', imdb_id: 'tt0109830', title: 'Форрест Гамп', original_title: 'Forrest Gump', source: 'tmdb', year: 1994, serial: 0 } },
  { id: 'alloha',    label: 'alloha',    card: { id: '13', imdb_id: 'tt0109830', title: 'Форрест Гамп', original_title: 'Forrest Gump', source: 'tmdb', year: 1994, serial: 0 } },
  { id: 'rezka',     label: 'rezka',     card: { id: '13', imdb_id: 'tt0109830', title: 'Форрест Гамп', original_title: 'Forrest Gump', source: 'tmdb', year: 1994, serial: 0 } },
  { id: 'kinopub',   label: 'kinopub',   card: { id: '1284041', imdb_id: 'tt32268156', title: 'Последний дом', original_title: 'The Last House', source: 'tmdb', year: 2026, serial: 0 } },
  { id: 'videoseed', label: 'videoseed', card: { id: '13', imdb_id: 'tt0109830', title: 'Форрест Гамп', original_title: 'Forrest Gump', source: 'tmdb', year: 1994, serial: 0 } }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function api(path, query = {}, opts = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  if (!url.searchParams.has('token')) url.searchParams.set('token', TOKEN);
  const t0 = Date.now();
  return fetch(url, {
    headers: opts.headers || { accept: 'application/json', 'user-agent': UA },
    redirect: opts.redirect || 'follow',
    signal: AbortSignal.timeout(opts.timeout || 90_000)
  }).then(async (r) => {
    const ms = Date.now() - t0;
    const text = await r.text().catch(() => '');
    let body = null; try { body = JSON.parse(text); } catch { /* non-json */ }
    return { status: r.status, ms, headers: r.headers, body, raw: text, url: r.url };
  }).catch((e) => ({ status: 0, ms: Date.now() - t0, body: null, raw: 'ERR ' + String((e && e.message) || e).slice(0, 80) }));
}

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

// Прямой GET к CDN с manual redirect — увидеть 302 Location (serving-нода).
async function directChain(u) {
  const out = [];
  let cur = u;
  for (let i = 0; i < 5; i += 1) {
    const r = await fetch(cur, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'user-agent': UA } }).catch((e) => null);
    if (!r) { out.push(`${cur} → ERR`); break; }
    out.push(`${cur} → ${r.status}`);
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) { cur = new URL(loc, cur).toString(); continue; }
    break;
  }
  return out;
}

async function firstPlayable(provider, query) {
  // /videos → items[0]. Для movie twin-first: item = method:"call" с абсолютным
  // url (/api/lampa/video?provider=skaz-kodik&voice=N&token=…) → следуем ему.
  // Для method:"play" url уже несёт proxied-манифест.
  const v = await api('/api/lampa/videos', { provider, ...query });
  if (v.status !== 200) return { step: 'videos', ...v, note: 'videos non-200' };
  const items = Array.isArray(v.body?.items) ? v.body.items : [];
  if (!items.length) return { step: 'videos', ...v, note: 'items=0' };
  const first = items[0];
  if (first?.method === 'play' && first?.url) return { step: 'videos', item: first, videosRaw: v.raw.slice(0, 300) };
  if (first?.method === 'call' && first?.url) {
    const resolved = await api(new URL(first.url, BASE).toString());
    if (resolved.status !== 200 || !resolved.body?.url) return { step: 'video', ...resolved, note: 'video non-200/нет url', videosRaw: v.raw.slice(0, 300) };
    return { step: 'video', item: resolved.body, videoRaw: resolved.raw.slice(0, 300), videosRaw: v.raw.slice(0, 300) };
  }
  return { step: 'videos', ...v, note: 'item без url' };
}

function extractCdnUrls(playable) {
  // playable.url = "/api/lampa/proxy?url=<enc>&token=…" или "... or ..." (multi-quality)
  const urls = String(playable?.url || '').split(/\s+or\s+/).map((s) => s.trim()).filter(Boolean);
  const cdn = [];
  for (const u of urls) {
    const m = /[?&]url=([^&]+)/.exec(u);
    if (m) { try { cdn.push(decodeURIComponent(m[1])); } catch { cdn.push(m[1]); } }
  }
  return { proxied: urls, cdn };
}

async function proxyCheck(proxiedUrl) {
  const r = await api(proxiedUrl, {}, { timeout: 120000 });
  return { status: r.status, ms: r.ms, contentType: String(r.headers?.get ? r.headers.get('content-type') : ''), body: r.raw };
}

function firstSegment(manifestBody) {
  // Из переписанного прокси-манифеста первая не-пустая не-# строка = прокси-ссылка сегмента
  for (const line of String(manifestBody).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    return t;
  }
  return '';
}

async function main() {
  const report = { title: 'KODIK-PLAYBACK-FIX-001 production verification', date: new Date().toISOString(), token: TOKEN.slice(0, 6) + '…', kodik: [], regression: [], sources: [] };
  console.log('== KODIK-PLAYBACK-FIX-001 PROD VERIFY == token=' + TOKEN.slice(0, 6) + '… base=' + BASE);

  // 0) /sources — какие id Kodik провайдеров есть
  const src = await api('/api/lampa/sources');
  const sources = Array.isArray(src.body?.sources) ? src.body.sources : [];
  report.sources = sources.map((s) => ({ id: s.id, show: s.show }));
  const kodikIds = sources.map((s) => s.id).filter((id) => /kodik/i.test(id));
  console.log('  sources: ' + sources.length + ', kodik-провайдеры: ' + (kodikIds.join(', ') || 'НЕТ!'));
  if (!kodikIds.length) { console.log('КРИТ: kodik провайдеров в /sources нет'); process.exitCode = 1; }

  const provider = kodikIds.includes('skaz-kodik') ? 'skaz-kodik' : kodikIds[0];
  console.log('  → kodik provider для проверки: ' + provider);

  // 1) Kodik-плейбек: 6 тайтлов (ретраи: CDN бывает отдаёт 404 на протухшем слоте)
  for (const T of KODIK_TITLES) {
    const row = { label: T.label, query: T.query, provider, attempts: [] };
    console.log(`\n[${T.label}] videos(${provider})…`);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const flat = { attempt };
      try {
        const p = await firstPlayable(provider, T.query);
        row.firstPlayable = p;
        if (p.step !== 'videos' && p.step !== 'video') { flat.result = 'FAIL_ITEMS'; flat.note = p.note || 'no playable'; row.attempts.push(flat); break; }
        const { proxied, cdn } = extractCdnUrls(p.item);
        row.cdnUrls = cdn.map((u) => ({ host: hostOf(u), url: u }));
        if (!cdn.length) { flat.result = 'FAIL_NOCDN'; flat.note = 'CDN-url из playable не извлечены'; row.attempts.push(flat); break; }
        const initial = hostOf(cdn[0]);
        row.initialHost = initial;
        console.log(`  [#${attempt}] CDN initial: ${initial} (${cdn.length} url)`);

        flat.directChain = await directChain(cdn[0]);
        console.log('  direct chain: ' + flat.directChain.join(' → '));
        await sleep(250);

        const master = await proxyCheck(proxied[0]);
        flat.master = { status: master.status, ms: master.ms, contentType: master.contentType };
        const masterOkBody = master.body || '';
        console.log(`  master via proxy: ${master.status} ${master.contentType} (${masterOkBody.length} bytes, ${master.ms}ms)`);
        if (master.status === 403 && /proxy_host_forbidden/.test(masterOkBody)) { flat.result = 'FAIL_403'; flat.note = 'снова 403 proxy_host_forbidden!'; row.attempts.push(flat); break; }
        if (master.status !== 200) { flat.result = 'FAIL_MASTER'; flat.note = 'master non-200'; row.attempts.push(flat); continue; }

        const segUrl = firstSegment(masterOkBody);
        flat.segmentSrc = segUrl ? segUrl.slice(0, 160) : '';
        if (!segUrl) { flat.result = 'FAIL_NOSEG'; flat.note = 'сегментов в манифесте нет'; row.attempts.push(flat); break; }
        const seg = await proxyCheck(segUrl);
        flat.segment = { status: seg.status, ms: seg.ms, contentType: seg.contentType };
        console.log(`  segment via proxy: ${seg.status} ${seg.contentType} (${seg.ms}ms)`);

        const rangeUrl = new URL(segUrl, BASE);
        const rn = await api(rangeUrl.toString(), {}, { headers: { accept: '*/*', 'user-agent': UA, range: 'bytes=0-1023' }, timeout: 60000 });
        flat.range = { status: rn.status, contentRange: String(rn.headers?.get ? rn.headers.get('content-range') : ''), accepted: String(rn.headers?.get ? rn.headers.get('accept-ranges') : '') };
        console.log(`  range via proxy: ${rn.status} content-range=${flat.range.contentRange}`);

        flat.result = (master.status === 200 && seg.status >= 200 && seg.status < 300 && rn.status === 206) ? 'PASS' : 'FAIL_RANGE';
        row.attempts.push(flat);
        if (flat.result === 'PASS') break;
      } catch (e) {
        flat.result = 'FAIL_EXC'; flat.note = String((e && e.message) || e).slice(0, 200);
        row.attempts.push(flat);
      }
      await sleep(1500);
    }
    const last = row.attempts[row.attempts.length - 1];
    row.result = last?.result === 'PASS' ? 'PASS' : (last?.result || 'FAIL');
    console.log('  RESULT: ' + row.result + (row.result === 'PASS' ? '' : ' (' + (last?.note || last?.result) + ')'));
    report.kodik.push(row);
    await sleep(1000);
  }

  // 2) /sources/card — показ карточек не изменился (skaz-kodik show:true на Kodik-тайтлах)
  console.log('\n== card-availability (skaz-kodik) ==');
  for (const T of KODIK_TITLES) {
    const r = await api('/api/lampa/sources/card', T.query);
    const rows = Array.isArray(r.body?.sources) ? r.body.sources : [];
    const k = rows.find((s) => s.id === 'skaz-kodik' || s.id === 'kodik');
    console.log(`  ${T.label}: kodik card=${k ? (k.show ? 'show' : 'hide') : 'n/a'} meta=${JSON.stringify(r.body?.meta || {})}`);
    await sleep(600);
  }

  // 3) Regression: /videos + первые playable через прокси для 6 провайдеров
  console.log('\n== regression /videos + playback ==');
  const pickSource = (kw) => sources.map((s) => s.id).find((id) => new RegExp(kw).test(id)) || '';
  for (const R of REGRESSION) {
    const providerId = pickSource(R.id) || R.id;
    const row = { id: R.id, label: R.label, providerUsed: providerId, attempts: [] };
    let p = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      p = await firstPlayable(providerId, R.card);
      row.attempts.push({ attempt, step: p.step, status: p.status, note: p.note || null });
      if (p.step === 'videos' || p.step === 'video') break;
      await sleep(5000);
    }
    row.firstPlayable = p;
    if (p.step !== 'videos' && p.step !== 'video' || !p.item) {
      row.result = 'FAIL_ITEMS'; console.log(`  ${R.id}: FAIL (${p.note || 'no items'})`); report.regression.push(row); continue;
    }
    const { proxied, cdn } = extractCdnUrls(p.item);
    row.cdnHost = cdn.length ? hostOf(cdn[0]) : '';
    if (proxied.length) {
      const m = await proxyCheck(proxied[0]);
      row.proxy = { status: m.status, ms: m.ms, contentType: m.contentType };
      row.result = m.status === 200 ? 'PASS' : (m.status === 403 ? 'FAIL_403' : 'FAIL_PROXY');
      console.log(`  ${R.id}: items -> ${row.cdnHost} master ${m.status} ${m.contentType} (${m.ms}ms, ${(p.step)})`);
    } else {
      row.result = 'FAIL_NOPROXY';
      console.log(`  ${R.id}: items есть, но нет прокси-URL`);
    }
    report.regression.push(row);
    await sleep(800);
  }

  // 4) Episode-level /videos эндпоинт цел
  console.log('\n== эндпоинт /sources/sources ==');
  const s2 = await api('/api/lampa/sources');
  console.log('  /sources: ' + s2.status + ' count=' + (Array.isArray(s2.body?.sources) ? s2.body.sources.length : 0));

  // Итог
  const kodikPass = report.kodik.filter((r) => r.result === 'PASS').length;
  const kodikFail = report.kodik.filter((r) => r.result !== 'PASS').length;
  const regPass = report.regression.filter((r) => r.result === 'PASS').length;
  const regFail = report.regression.filter((r) => r.result !== 'PASS').length;
  const forbidden = report.kodik.some((r) => r.range?.status === 403 || (r.master?.status === 403 && /proxy_host_forbidden/.test(String(r.master?.body || ''))));
  console.log('\n===== VERDICT =====');
  console.log(`  Kodik: ${kodikPass} PASS, ${kodikFail} FAIL (из ${report.kodik.length})`);
  console.log(`  Regression: ${regPass} PASS, ${regFail} FAIL (из ${report.regression.length})`);
  console.log(`  proxy_host_forbidden повторно: ${forbidden ? 'ДА — КРИТ' : 'нет'}`);
  console.log(forbidden ? 'VERDICT: FAIL' : (kodikFail === 0 && regFail === 0 ? 'VERDICT: PASS' : 'VERDICT: PARTIAL'));
  report.verdict = { kodikPass, kodikFail, regPass, regFail, forbidden };
  const fs = await import('node:fs');
  fs.writeFileSync(process.env.OUT_FILE || `${process.env.TEMP || 'C:/Users/Admin/AppData/Local/Temp'}/kodik-playback-fix-001-verify.json`, JSON.stringify(report, null, 2));
  console.log('  json → kodik-playback-fix-001-verify.json');
}

main().catch((e) => { console.error('FATAL ' + ((e && e.stack) || e)); process.exitCode = 1; });