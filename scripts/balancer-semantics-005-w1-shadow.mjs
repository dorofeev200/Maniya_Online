// BALANCER-SEMANTICS-005-W1 — SHADOW/COMPARE (STAGED в /tmp/shadow-w1, НЕ деплой):
// OLD (pre-W1 клиент: raw-порядок hosts + FAIL-NOT-RETRY) vs NEW (orderedSkazHosts +
// continue-скан) на одних и тех же тайтлах и балансерах.
//
// ПРОБА: карточка Паразиты/kinopub → OLD /videos EMPTY (B), NEW /videos CONTENT (A).
//
// OLDv  — симуляция pre-W1 SkazClient.getLite (доказана аудитом §2): сырой
//         config.skaz.hosts (online8 ВТОРОЙ), старт с hosts[0], СТОП на первом 2xx
//         (non-usable → null, FAIL-NOT-RETRY), не-2xx/timeout → следующая нода.
// NEWv  — провайдер (SKI NEW код): двигай без пина (чистая ротация) и с пином.
// CARD  — availability legacy vs abstain(defaultChecker — текущий прод);
//         вердикты skaz совпадают до/после W1 (W1 менять карточку не должен).
//
// Запуск на VPS (STAGED):
//   cd /tmp/shadow-w1/server && NODE_ENV=production node ../scripts/balancer-semantics-005-w1-shadow.mjs
// Секреты НЕ печатаются (len/маски).
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(here, '..', 'server');
const resolve = (rel) => pathToFileURL(path.join(serverRoot, rel)).href;
const config = (await import(resolve('src/config.js'))).config;
const { registeredProviders, providerById } = await import(resolve('src/providers/registry.js'));
const { createAvailabilityChecker } = await import(resolve('src/availability.js'));
const { SkazClient, isUsablePage } = await import(resolve('src/providers/skaz/SkazClient.js'));

// ===== 10 тайтлов (карточки как с реальных устройств) =====
const CARDS = [
  { label: 'Одиссея 2026', bal: null, query: { id: '1368337', imdb_id: 'tt33764258', title: 'Одиссея', original_title: 'The Odyssey', original_language: 'en', source: 'tmdb', year: 2026, serial: 0 } },
  { label: 'Последний дом 2026', bal: null, query: { id: '1284041', imdb_id: 'tt32268156', title: 'Последний дом', original_title: 'The Last House', original_language: 'en', source: 'tmdb', year: 2026, serial: 0 } },
  { label: 'Интерстеллар 2014', bal: null, query: { id: '157336', imdb_id: 'tt0816692', kinopoisk_id: '437410', title: 'Интерстеллар', original_title: 'Interstellar', original_language: 'en', source: 'tmdb', year: 2014, serial: 0 } },
  { label: 'Форрест Гамп 1994', bal: null, query: { id: '13', imdb_id: 'tt0109830', kinopoisk_id: '448', title: 'Форрест Гамп', original_title: 'Forrest Gump', original_language: 'en', source: 'tmdb', year: 1994, serial: 0 } },
  { label: 'Матрица 1999', bal: null, query: { id: '603', imdb_id: 'tt0133093', kinopoisk_id: '301', title: 'Матрица', original_title: 'The Matrix', original_language: 'en', source: 'tmdb', year: 1999, serial: 0 } },
  { label: 'Дюна 2 2024', bal: null, query: { id: '693134', imdb_id: 'tt15239678', title: 'Дюна: Часть вторая', original_title: 'Dune: Part Two', original_language: 'en', source: 'tmdb', year: 2024, serial: 0 } },
  { label: 'Скайуокер 2019', bal: null, query: { id: '181812', imdb_id: 'tt2527338', title: 'Звёздные войны: Скайуокер. Восход', original_title: 'Star Wars: The Rise of Skywalker', original_language: 'en', source: 'tmdb', year: 2019, serial: 0 } },
  { label: 'Паразиты 2019', bal: null, query: { id: '496243', imdb_id: 'tt6751668', kinopoisk_id: '1128824', title: 'Паразиты', original_title: 'Parasite', original_language: 'ko', source: 'tmdb', year: 2019, serial: 0 } },
  { label: 'Дом Дракона serial 2022', bal: null, query: { id: '94997', imdb_id: 'tt11198330', title: 'Дом Дракона', original_title: 'House of the Dragon', original_language: 'en', source: 'tmdb', year: 2022, serial: 1 } },
  { label: 'Аватар 2009', bal: null, query: { id: '19995', imdb_id: 'tt0499549', kinopoisk_id: '251733', title: 'Аватар', original_title: 'Avatar', original_language: 'en', source: 'tmdb', year: 2009, serial: 0 } }
];

const email = config.skaz.accountEmail;
const uid = config.skaz.uid;
const origin = config.skaz.origin || 'http://lampa.mx';
const hosts = (config.skaz.hosts || []).filter(Boolean);
const rawHosts = config.skaz.hosts && config.skaz.hosts.length ? config.skaz.hosts : hosts;

let token = '';
try {
  const users = JSON.parse(readFileSync(config.usersFile, 'utf8'));
  const anyUser = (Array.isArray(users) ? users.find((u) => u && u.active && u.token) : null) || (Array.isArray(users) ? users[0] : null);
  token = (anyUser && anyUser.token) || '';
} catch { token = ''; }
const userUid = crypto.createHash('sha256').update(String(token || '')).digest('hex').slice(0, 16);

// Маска: пароль/токен в вывод НЕ попадают.
console.log(`env: email_len=${email.length} uid_len=${uid.length} userUid=${userUid} hosts=${hosts.length} raw_order=${rawHosts.map((h) => h.replace(/^https?:\/\//, '')).join(',')}`);
console.log('');

// ===== OLD-клиент (pre-W1, симуляция) =====
function oldLite(balancer, query) {
  const attempts = [];
  const build = (targetHost) => {
    const u = new URL(`${targetHost}/lite/${balancer}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    u.searchParams.set('account_email', email);
    u.searchParams.set('uid', uid);
    return u.toString();
  };
  // pre-W1: старт с hosts[0] (свежий процесс/_hostIndex=0), пул в СЫРОМ порядке.
  return new Promise((resolve) => {
    (async () => {
      for (let i = 0; i < rawHosts.length; i += 1) {
        const host = rawHosts[i];
        const started = Date.now();
        try {
          const r = await fetch(build(host), { headers: { accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(12_000) });
          if (!r) { attempts.push({ host, ms: Date.now() - started, verdict: 'no-response' }); continue; }
          const status = r.status;
          const ms = Date.now() - started;
          if (!(status >= 200 && status < 300)) { attempts.push({ host, status, ms, verdict: 'non-2xx' }); continue; }
          const text = await r.text().catch(() => null);
          if (text == null) { attempts.push({ host, status, ms, verdict: 'no-body' }); continue; }
          if (isUsablePage(text)) {
            attempts.push({ host, status, ms, verdict: 'CONTENT', cards: (String(text).match(/data-json\s*=/g) || []).length });
            return resolve({ attempts, html: text, verdict: 'CONTENT' });
          }
          attempts.push({ host, status, ms, verdict: 'EMPTY-2xx' });
          return resolve({ attempts, html: null, verdict: 'EMPTY' }); // FAIL-NOT-RETRY: стоп на первом 2xx
        } catch { attempts.push({ host, ms: Date.now() - started, verdict: 'timeout' }); }
      }
      resolve({ attempts, html: null, verdict: 'EMPTY' });
    })();
  });
}

// ===== CARD: legacy vs abstain =====
const legacyChecker = createAvailabilityChecker({ reservePolicy: 'legacy' });
const abstainChecker = createAvailabilityChecker({ reservePolicy: 'abstain' }); // текущий прод (ONLINE8-002)

async function cardRows(checker, query) {
  try {
    const payload = await checker.card(query, userUid);
    const out = {};
    for (const row of payload.sources) {
      out[row.id] = {
        show: row.show,
        auth: row.authoritative,
        host: row.host ? row.host.replace(/^https?:\/\//, '') : '',
        trusted: Boolean(row.trusted),
        accsdb: Boolean(row.accsdb),
        inconclusive: Boolean(row.inconclusive)
      };
    }
    return out;
  } catch (e) { return { error: e.message }; }
}

// ===== NEW provider videos =====
function skazProviderFor(providerId) {
  const p = providerById(providerId);
  if (!p || typeof p.videos !== 'function') return null;
  return p;
}
function pvCtx(query, host) {
  const q = { token: '', ...query, source: 'tmdb' };
  if (host) q.host = host;
  return { query: q, request: {} };
}
async function newVideos(provider, query, host) {
  try {
    const payload = await provider.videos(pvCtx(query, host));
    return { items: (payload?.items || []).length, providerError: payload?.provider_error?.code || null };
  } catch (e) { return { items: -1, providerError: 'EXC ' + String(e).slice(0, 40) }; }
}

async function main() {
  const skazProviders = registeredProviders().filter((p) => p.enabled() && String(p.id).startsWith('skaz-'));
  const nativeCollaps = registeredProviders().find((p) => p.enabled() && p.id === 'collaps');

  for (const card of CARDS) {
    console.log(`\n===== ${card.label} =====`);
    const cardLegacy = await cardRows(legacyChecker, card.query);
    const cardNew = await cardRows(abstainChecker, card.query);

    const rows = await Promise.all(skazProviders.map(async (provider) => {
      const bal = provider.balancer;
      const legRow = cardLegacy[provider.id];
      const newRow = cardNew[provider.id];
      const row = {
        bal,
        leg: legRow ? `${legRow.show ? 'show' : 'hide'}${legRow.auth ? '*' : ''}${legRow.trusted ? '(t)' : ''}${legRow.accsdb ? '(acc)' : ''}${legRow.host ? '@' + legRow.host : ''}` : '?',
        new: newRow ? `${newRow.show ? 'show' : 'hide'}${newRow.auth ? '*' : ''}${newRow.trusted ? '(t)' : ''}${newRow.accsdb ? '(acc)' : ''}${newRow.host ? '@' + newRow.host : ''}` : '?'
      };
      // OLDv: полный pre-W1 скан для всех skaz-рядов (FOUND/hide — всё):
      // карточка решила показ/скрытие; OLD-клиент сам отвечает «есть/нет контент».
      const oldv = await oldLite(bal, card.query);
      row.old = `${oldv.verdict} ${oldv.attempts.map((a) => `${a.host.replace(/^https?:\/\//, '')}:${a.verdict}${a.status ? '/' + a.status : ''}`).join(' > ')}`;
      row.oldFinal = oldv.verdict;
      // NEWv без пина и с пином (пин — только при authoritative FOUND c host).
      const v0 = await newVideos(provider, card.query, null);
      row.new0 = `${v0.items}${v0.providerError ? ` (${v0.providerError})` : ''}`;
      const pinable = newRow && newRow.show && newRow.auth && newRow.host && !newRow.trusted && !newRow.accsdb;
      if (pinable) {
        const v1 = await newVideos(provider, card.query, newRow.host);
        row.new1 = `${v1.items}${v1.providerError ? ` (${v1.providerError})` : ''}`;
      } else { row.new1 = '-'; }
      // классификация (B→A probe, ←ALL)
      if (row.oldFinal === 'EMPTY' && Number.parseInt(v0.items, 10) > 0) {
        row.fix = 'B→A!!';
      } else if (Number.parseInt(v0.items, 10) > 0) {
        row.fix = 'CONTENT';
      } else if (row.oldFinal === 'EMPTY') {
        row.fix = 'EMPTY(same)';
      } else if (row.oldFinal === 'CONTENT') {
        row.fix = 'CONTENT-OLD-NOW-EMPTY';
      } else {
        row.fix = 'UNABLE';
      }
      return row;
    }));

    // строка коллапса (native без skaz-близнеца — ВНЕ W1, регрессия F)
    if (nativeCollaps) {
      const cr = cardLegacy['collaps'] || cardNew['collaps'];
      rows.push({ bal: 'collaps[separate-native]', leg: `${cr ? (cr.show ? 'show' : 'hide') : '?'}`, new: `${cr ? (cr.show ? 'show' : 'hide') : '?'}`, old: '-', oldFinal: 'n/a', new0: '-', new1: '-', fix: cr ? (cr.show ? 'CONTENT?' : 'hide') : '?' });
    }

    for (const r of rows) {
      console.log(
        `  ${r.bal.padEnd(24)} CARD-legacy=${r.leg.padEnd(30)} CARD-new=${r.new.padEnd(30)} CLASS=${r.fix.padEnd(14)}\n` +
        `      OLDv: ${(r.old || '-').padEnd(72)}\n` +
        `      NEWv: nopin=${r.new0}  pin=${r.new1}`
      );
    }
  }

  // ПЛЕЙБЕК (E): для Контент-кейсов (kinopub = главный B→A) — реальный поток:
  // пин-нода из карточки → pinned getLite → raw stream → resolveStream → манифест с Origin.
  for (const card of [CARDS[7], CARDS[3]]) { // Паразиты, Форрест Гамп
    const cr = await cardNewFor(card); // skaz-kinopub row из abstain-карточки
    const pinHost = (cr && cr.show && cr.auth && cr.host && !cr.trusted && !cr.accsdb) ? cr.host : null;
    console.log(`\n===== PLAYBACK ${card.label} skaz-kinopub (pin=${pinHost || 'none'}) =====`);
    const client = new SkazClient({ balancer: 'kinopub', hosts, accountEmail: email, uid });
    const url = client.buildLiteUrl(card.query, { pinnedHost: pinHost || undefined });
    const html = await client.openLiteUrl(url, { pinnedHost: pinHost || undefined }).catch(() => null);
    if (!html) { console.log('  lite → null (страница не получена)'); continue; }
    const m = String(html).match(/data-json='([^']+)'/);
    if (!m) { console.log('  HTML без data-json кард'); continue; }
    let j;
    try { j = JSON.parse(String(m[1]).replace(/&quot;/g, '"')); } catch { j = null; }
    if (!j) { console.log('  кард непарсится'); continue; }
    console.log(`  кард method=${j.method} translate="${String(j.translate || '').slice(0, 20)}"`);
    try {
      if (j.method === 'play') {
        const final = await client.resolveStream(String(j.stream || j.url || ''));
        console.log(`  resolveStream(play) → ${final ? 'RESOLVED' : 'NULL'}`);
        if (final) await probeManifest(final);
      } else if (j.method === 'call') {
        const json = await client.resolveVideoJson(String(j.stream || j.url || ''));
        console.log(`  resolveVideoJson(call) → ${json?.method || 'NULL'}`);
        if (json && json.method === 'play') {
          const final = await client.resolveStream(String(json.url || '').split(/\s+or\s+/i)[0]);
          console.log(`  resolveStream(call→play) → ${final ? 'RESOLVED' : 'NULL'}`);
          if (final) await probeManifest(final);
        }
      } else {
        console.log(`  method=${j.method} — скип (не плей/колл)`);
      }
    } catch (e) {
      console.log(`  playback ERR: ${String(e.message || e).slice(0, 120)}`);
    }
  }

  console.log('\n===== ИТОГ =====');
  console.log('W1-SHADOW: run complete — CLASS=B→A!! строки = доказательство фикса kinopub/Паразиты.');
}

const abstainRowsCache = new Map();
async function cardNewFor(card) {
  const key = card.label;
  if (!abstainRowsCache.has(key)) abstainRowsCache.set(key, await cardRows(abstainChecker, card.query));
  return abstainRowsCache.get(key)['skaz-kinopub'] || null;
}
async function probeManifest(url) {
  try {
    const r = await fetch(url, { headers: { accept: '*/*', Origin: origin }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    const text = await r.text().catch(() => '');
    const isM3u8 = String(url).includes('.m3u8') || /#EXTM3U/.test(String(text));
    console.log(`  manifest probe: status=${r.status} len=${text.length} m3u8=${isM3u8}`);
  } catch (e) {
    console.log(`  manifest probe ERR: ${String(e.message || e).slice(0, 100)}`);
  }
}

await main();