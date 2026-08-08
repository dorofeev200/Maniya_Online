import test from 'node:test';
import assert from 'node:assert/strict';

// Живая матрица E-Online: каждый балансер из EO_BALANCERS проходит полный
// контур «поиск → страница → резолв потока → финальный манифест (200)».
// По умолчанию пропущен. Включение:
//   cd server && NODE_ENV=test EO_LIVE=1 EO_ACCOUNT_EMAIL=… EO_UID=… node --test test/eolive.test.js
//
// Результат по КАЖДОМУ балансу логируется одной строкой OK/FAIL — это гейт
// подключения источника в Maniya: «сломанный баланс не светится».
const live = process.env.EO_LIVE === '1';

import { EoClient } from '../src/providers/eonline/EoClient.js';
import { EoNormalizer } from '../src/providers/eonline/EoNormalizer.js';
import { EoProvider } from '../src/providers/eonline/EoProvider.js';
import { config } from '../src/config.js';

const accountEmail = config.eonline.accountEmail;
const uid = config.eonline.uid;
const balancers = config.eonline.balancers;

// Параметры «поисковых» запросов. ❗ Тестируем НЕСКОЛЬКО фильмов: один тайтл —
// только одна точка покрытия каталога (Filmix может играть один фильм и не
// играть другой). Матрица большего числа тайтлов выявляет реальное покрытие.
const MOVIES = [
  {
    id: '284647',
    imdb_id: 'tt0816692',
    kinopoisk_id: '437410',
    title: 'Интерстеллар',
    original_title: 'Interstellar',
    year: '2014'
  },
  {
    id: '329',
    imdb_id: 'tt0133093',
    kinopoisk_id: '301',
    title: 'Матрица',
    original_title: 'The Matrix',
    year: '1999'
  },
  {
    id: '175508',
    imdb_id: 'tt0468569',
    kinopoisk_id: '111543',
    title: 'Тёмный рыцарь',
    original_title: 'The Dark Knight',
    year: '2008'
  }
].map((entry) => ({ ...entry, serial: '0' }));

const SERIAL = {
  id: '1399',
  imdb_id: 'tt0944947',
  kinopoisk_id: '79322',
  title: 'Игра престолов',
  original_title: 'Game of Thrones',
  serial: '1'
};

function makeProvider(balancer) {
  const client = new EoClient({
    balancer,
    hosts: config.eonline.hosts,
    skazHosts: config.eonline.skazHosts,
    accountEmail,
    uid,
    origin: config.eonline.origin
  });
  return new EoProvider({
    id: `eonline-${balancer}`,
    title: balancer,
    balancer,
    client,
    normalizer: new EoNormalizer()
  });
}

/** Вынуть raw URL из проксированной ссылки /api/lampa/proxy?url=… */
function rawOf(lampUrl) {
  try {
    const parsed = new URL(lampUrl);
    return parsed.searchParams.get('url') || lampUrl;
  } catch {
    return lampUrl;
  }
}

/** Играемый ответ: 2xx + медиа-тип (m3u8/mp4/mp2t/video) ИЛИ HLS-тело. */
function isPlayable(v) {
  if (!v || !v.ok) return false;
  const contentType = String(v.contentType || '').toLowerCase();
  const mediaLike = /mpegurl|x-mpegurl|dash\+xml|video\/|octet-stream|mpeg|mp4/.test(contentType);
  if (mediaLike) return true;
  return /#EXTM3U|#EXT-X-STREAM-INF|#EXTINF/.test(String(v.body || '').slice(0, 2000));
}

/** Резолв item-URL → финальный манифест → проверка 2xx + HLS-тело. */
async function verifyFinal(provider, lampUrl) {
  let raw = rawOf(lampUrl);
  // Если item.url пришёл уже «как есть» (не прокси) — всё равно резолвим.
  if (!String(lampUrl).includes('/api/lampa/proxy')) {
    const resolved = await provider.client.resolveStream(lampUrl);
    if (resolved) raw = resolved;
  }
  const response = await fetch(raw, {
    headers: { Origin: config.eonline.origin },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.text().catch(() => '');
  return {
    ok: response.ok,
    status: response.status,
    body,
    contentType: response.headers.get('content-type')
  };
}

test('E-Online live: матрица балансеров × несколько фильмов', { skip: !live && 'только с EO_LIVE=1' }, async () => {
  assert.ok(accountEmail && uid, 'EO_ACCOUNT_EMAIL и EO_UID обязательны для live');
  assert.ok(balancers.length >= 1, 'EO_BALANCERS не пуст');

  const report = [];
  for (const balancer of balancers) {
    const row = { balancer, lite: '-', perMovie: {}, serial: '↑', okMovies: 0, ms: 0, note: '' };
    const start = Date.now();
    try {
      const provider = makeProvider(balancer);

      // --- первичный статус lite-страницы (по первому фильму) ---
      const probe = await probeLite(provider.client, pageParams(MOVIES[0]));
      row.lite = String(probe.status) + gateMark(probe);
      if (probe.status < 200 || probe.status >= 300) {
        throw new Error(`lite HTTP ${probe.status}${gateMark(probe)}`);
      }

      // --- каждый фильм: страница → items → резолв потока → играемый манифест ---
      for (const entry of MOVIES) {
        const ctx = { query: { token: 'live-token', ...entry } };
        const res = await provider.videos(ctx);
        const item = res.items[0];
        if (!item) {
          row.perMovie[entry.title] = 'НЕТ';
          continue;
        }
        const v = await verifyFinal(provider, item.url);
        row.perMovie[entry.title] = isPlayable(v) ? 'OK' : `HTTP${v.status}`;
        if (isPlayable(v)) row.okMovies += 1;
      }

      // --- сериал (только у балансеров с сериалами; требует s1..e1) ---
      const serialCtx = { query: { token: 'live-token', ...SERIAL } };
      const serialRes = await provider.videos(serialCtx);
      const ep = serialRes.items[0];
      if (ep) {
        const v = await verifyFinal(provider, ep.url);
        row.serial = isPlayable(v) ? `ep${ep.episode}` : `HTTP${v.status}`;
      } else {
        row.serial = 'no-episodes';
      }

      row.ms = Date.now() - start;
    } catch (error) {
      row.note = String(error?.message || error).slice(0, 80);
      row.ms = Date.now() - start;
      for (const entry of MOVIES) row.perMovie[entry.title] = 'ERR';
    }
    report.push(row);

    const cells = Object.entries(row.perMovie)
      .map(([title, status]) => `${title}:${status}`)
      .join('  ');
    const mark = row.okMovies >= Math.ceil(MOVIES.length / 2) ? '✔' : '✘';
    const note = row.note ? ` — ${row.note}` : '';
    console.log(`  ${mark} ${balancer.padEnd(12)} lite=${row.lite} [${cells}] serial=${row.serial} ${row.ms}ms${note}`);
  }

  // Сводный итог: баланс «жив по каталогу», если большинство фильмов играют.
  const good = report.filter((row) => row.okMovies >= Math.ceil(MOVIES.length / 2));
  console.log(`\nФильм-источники с покрытием ≥ ${Math.ceil(MOVIES.length / 2)}/${MOVIES.length}: ${good.length} из ${report.length}`);
  console.log(`EO_BALANCERS_LIVE=${good.map((row) => row.balancer).join(',')}`);
  assert.ok(good.length >= 1, `хотя бы один баланс должен пройти live (был 0/${report.length})`);
});

/** lite-параметры, как в videos (без token — его добавит buildLiteUrl). */
function pageParams(entry) {
  const params = { ...entry };
  delete params.token;
  return params;
}

/** Первичный GET lite/<balancer>: статус + тело (для детекта гейта). */
async function probeLite(client, params) {
  const url = client.buildLiteUrl(params);
  try {
    const response = await fetch(url, {
      headers: { accept: '*/*', Origin: client.origin },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000)
    });
    const text = await response.text().catch(() => '');
    return { status: response.status, text };
  } catch {
    return { status: 0, text: '' };
  }
}

/** Маркер, если OpenResty/стенд блокирует (403/429/CF-шапки/JSON-ответ). */
function gateMark(probe) {
  const head = String(probe.text || '').slice(0, 300).toLowerCase();
  if (probe.status === 403 || probe.status === 429) return ':gate';
  if (/\brch\b|cloudflare|cf-ray|access denied|forbidden/.test(head)) return ':gate';
  if (head.startsWith('{') || head.startsWith('[')) return ':json';
  return '';
}
