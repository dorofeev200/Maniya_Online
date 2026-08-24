// T018 spot — закрыть классификацию "shown but 0 items" (mutiny) + правильный static /sources.
// GET-only.
import { config } from '../server/src/config.js';
const BASE = 'https://plugin.maniya-kvn.online';
const TOKEN = process.env.TOKEN || 'mo-6678c195e56c3af34d4ebecb5f37f11c';
const CLUSTER = 'http://online3.skaz.tv';
const EMAIL = String(config.skaz?.accountEmail || '').trim();
const UID = String(config.skaz?.uid || '').trim();

const cardQuery = `id=1288445&imdb_id=tt32338669&kinopoisk_id=1288445&title=%D0%9C%D1%8F%D1%82%D0%B5%D0%B6&original_title=Mutiny&serial=0&year=2026&source=tmdb&account_email=${encodeURIComponent(EMAIL)}&uid=${UID}`;

const get = async (url, ms = 30000) => {
  const t0 = Date.now();
  const c = new AbortController();
  const tm = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal });
    const t = await r.text().catch(() => '');
    return { status: r.status, ms: Date.now() - t0, body: t };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, err: String(e).slice(0, 120) };
  } finally { clearTimeout(tm); }
};

// 1. Static /sources (правильно)
const st = await get(`${BASE}/api/lampa/sources?token=${TOKEN}`, 30000);
const stj = JSON.parse(st.body);
console.log('STATIC status', st.status, 'ms', st.ms, 'count', (stj.sources || []).length);
for (const s of (stj.sources || [])) console.log('  ', s.id, '|', s.name, '|', s.icon, '|', s.quality_label);

// 2. Cluster deep links: videoseed, filmix, veoveo, collaps(нет), pidtor для mutiny
const bal = ['videoseed', 'filmix', 'veoveo', 'pidtor'];
for (const b of bal) {
  let r = await get(`${CLUSTER}/lite/${b}?${cardQuery}&clarification=0&similar=false`, 30000);
  if (r.status === 0) {
    // транзиент — один повтор
    await new Promise((q) => setTimeout(q, 800));
    r = await get(`${CLUSTER}/lite/${b}?${cardQuery}&clarification=0&similar=false`, 30000);
  }
  const body = r.body || '';
  const foundVideo = /data-json/.test(body);
  const lines = body.trim().split(/\r?\n/);
  const first = (lines[0] || '').slice(0, 90);
  // количество data-json карточек
  const cards = (body.match(/data-json=/g) || []).length;
  console.log(`\n[lite/${b}]`, 'status', r.status, 'ms', r.ms, 'bytes', body.length, 'data-json', cards, 'first:', first);
  // извлечь один data-json (первые 200 символов контента)
  const m = body.match(/data-json="([^"]{0,260})/);
  if (m) console.log('   snippet:', m[1].slice(0, 200));
}

// 3. Maniya /videos для тех же skaz-провайдеров (mirror)
for (const b of bal) {
  const r = await get(`${BASE}/api/lampa/videos?provider=skaz-${b}&source=tmdb&id=1288445&imdb_id=tt32338669&kinopoisk_id=1288445&title=%D0%9C%D1%8F%D1%82%D0%B5%D0%B6&original_title=Mutiny&year=2026&serial=0&clarification=0&similar=false&token=${TOKEN}`, 60000);
  const j = JSON.parse(r.body);
  console.log(`[/videos skaz-${b}]`, 'status', r.status, 'ms', r.ms, 'items', (j.items || []).length, 'perr', j.provider_error?.code || null);
}