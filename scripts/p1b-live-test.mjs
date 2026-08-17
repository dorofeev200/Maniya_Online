// P1-B Live test: SKAZ Alloha quality-or, 2160p, 1080p, primary/reserve, single URL
// Read-only, run on VPS: node scripts/p1b-live-test.mjs

const BASE = 'http://127.0.0.1:3000';
// SECURITY-001: TOKEN — только из env PROD_TOKEN (см. _creds.mjs).
const TOKEN = process.env.PROD_TOKEN || '';

// Interstellar — known to work with alloha
const MOVIE = {
  id: '284647', imdb_id: 'tt0816692', kinopoisk_id: '437410',
  title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0'
};

const PROVIDER = 'skaz-alloha';

function log(section, msg) {
  console.log(`[${section}] ${msg}`);
}

async function apiVideos() {
  const q = new URLSearchParams({ token: TOKEN, provider: PROVIDER, ...MOVIE });
  const r = await fetch(`${BASE}/api/lampa/videos?${q}`, { signal: AbortSignal.timeout(30000) });
  const json = await r.json();
  log('VIDEOS', `status=${r.status}, items=${json.items?.length || 0}`);
  return json;
}

async function apiResolveVideo(voiceIndex = 0) {
  const q = new URLSearchParams({ token: TOKEN, provider: PROVIDER, voice: String(voiceIndex), ...MOVIE });
  const r = await fetch(`${BASE}/api/lampa/video?${q}`, { signal: AbortSignal.timeout(30000) });
  const json = await r.json();
  log('RESOLVE', `voice=${voiceIndex} status=${r.status} method=${json.method || 'none'} title=${(json.title || '').slice(0, 40)}`);
  return json;
}

async function probeUrl(url, label) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (r.status === 200 && (ct.includes('mpegurl') || ct.includes('video/') || ct.includes('mp4') || ct.includes('mpeg'))) {
      return { label, ok: true, status: r.status, type: ct.split('/').pop()?.split(';')[0] };
    }
    const body = await r.text().catch(() => '');
    if (r.status === 200 && body.startsWith('#EXTM3U')) {
      return { label, ok: true, status: 200, type: 'hls', firstLine: body.split('\n')[0] };
    }
    return { label, ok: false, status: r.status, type: ct.split('/').pop()?.split(';')[0], body: body.slice(0, 80) };
  } catch (e) {
    return { label, ok: false, err: String(e.message).slice(0, 60) };
  }
}

// Extract the 'or'-split parts from a proxied URL
function extractOrUrls(proxiedUrl) {
  // Proxied URL looks like: /proxy?url=ENCODED_URL1%20or%20ENCODED_URL2...&origin=...
  const urlParam = new URL(proxiedUrl).searchParams.get('url');
  if (!urlParam) return [];
  const parts = urlParam.split(/\s+or\s+|\s*%20or%20\s*/gi).map(s => s.trim()).filter(Boolean);
  return parts;
}

async function main() {
  console.log('=== P1-B LIVE TEST: SKAZ Alloha ===');
  console.log(`Movie: ${MOVIE.title} (${MOVIE.year}) tmdb=${MOVIE.id}`);
  console.log(`Provider: ${PROVIDER}`);
  console.log('');

  // 1. Get videos list
  const videos = await apiVideos();
  const callItems = (videos.items || []).filter(it => it.method === 'call');
  const playItems = (videos.items || []).filter(it => it.method === 'play');

  log('SUMMARY', `call=${callItems.length} play=${playItems.length}`);

  if (callItems.length === 0) {
    log('ERROR', 'No call items — cannot test resolveVideo');
    return;
  }

  // 2. Resolve first call item (voice 0)
  console.log('\n--- Resolve voice=0 (first call item) ---');
  const resolved = await apiResolveVideo(0);
  if (!resolved || !resolved.url) {
    log('ERROR', 'Resolve failed — no URL');
    return;
  }

  // 3. Check URL for 'or' pattern
  console.log('\n--- Primary/Reserve URL check ---');
  const orParts = extractOrUrls(resolved.url);
  if (orParts.length > 1) {
    log('URL-OR', `✓ split into ${orParts.length} URLs (primary + reserve)`);
  } else if (orParts.length === 1) {
    log('URL-OR', `Single URL (no reserve), length=${orParts[0].length}`);
  }
  for (let i = 0; i < orParts.length; i++) {
    const label = orParts.length > 1 ? (i === 0 ? 'primary' : 'reserve') : 'url';
    const result = await probeUrl(orParts[i], `${label}`);
    log('PROBE', `${label}: ${result.ok ? 'OK:' + result.type : 'FAIL:' + (result.err || result.status + ':' + result.type)}`);
  }

  // 4. Check quality map
  console.log('\n--- Quality Map ---');
  const qualityKeys = Object.keys(resolved.quality || {});
  log('QUALITY', `keys: ${qualityKeys.join(', ') || '(none)'}`);

  let foundOr = false;
  let foundSingle = false;
  for (const [label, proxiedUrl] of Object.entries(resolved.quality || {})) {
    const parts = extractOrUrls(proxiedUrl);
    if (parts.length > 1) {
      foundOr = true;
      log('QUALITY-OR', `${label}: ${parts.length} URLs (primary+reserve)`);
      for (let i = 0; i < parts.length; i++) {
        const tag = parts.length > 1 ? (i === 0 ? 'primary' : 'reserve') : 'url';
        const result = await probeUrl(parts[i], `${label}/${tag}`);
        log('Q-PROBE', `${label} ${tag}: ${result.ok ? 'OK:' + result.type : 'FAIL:' + (result.err || result.status + ':' + result.type)}`);
      }
    } else if (parts.length === 1) {
      foundSingle = true;
      // Just probe first single quality to verify it works
      if (label === qualityKeys[0] || label === qualityKeys[qualityKeys.length - 1]) {
        const result = await probeUrl(parts[0], `${label}`);
        log('Q-PROBE', `${label} single: ${result.ok ? 'OK:' + result.type : 'FAIL:' + (result.err || result.status + ':' + result.type)}`);
      }
    }
  }
  if (!foundOr) log('QUALITY-OR', '(no or-split qualities found — all single URLs)');
  if (foundSingle) log('QUALITY-SINGLE', 'Single-URL qualities present ✓');

  // 5. 2160p check
  console.log('\n--- 2160p / 1080p specific checks ---');
  for (const target of ['2160p', '1080p']) {
    if (resolved.quality[target]) {
      const parts = extractOrUrls(resolved.quality[target]);
      log(target, `found, parts=${parts.length}`);
      for (let i = 0; i < parts.length; i++) {
        const label = parts.length > 1 ? (i === 0 ? 'primary' : 'reserve') : 'url';
        const result = await probeUrl(parts[i], `${target}/${label}`);
        log(`${target}-PROBE`, `${label}: ${result.ok ? 'OK:' + result.type : 'FAIL:' + (result.err || result.status + ':' + result.type)}`);
      }
    } else {
      log(target, 'NOT in quality map');
    }
  }

  // 6. Subtitle check
  console.log('\n--- Subtitles ---');
  log('SUBS', `count=${(resolved.subtitles || []).length}`);
  for (const sub of (resolved.subtitles || []).slice(0, 3)) {
    log('SUB', `${sub.label}: ${(sub.url || '').slice(0, 80)}`);
  }

  console.log('\n=== LIVE TEST COMPLETE ===');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
