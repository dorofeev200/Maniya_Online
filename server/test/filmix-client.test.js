import test from 'node:test';
import assert from 'node:assert/strict';
import { FilmixClient } from '../src/providers/filmix/FilmixClient.js';

function captureLog() {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  return () => {
    console.log = original;
    return lines;
  };
}

test('FilmixClient.videoLinks бьёт по api-fx и возвращает распарсенный JSON', async () => {
  const calls = [];
  const apiFxClient = {
    get: async (url, options) => {
      calls.push({ url, options });
      return { json: async () => ({ voiced: true }) };
    }
  };
  const client = new FilmixClient({ apiFxClient });
  const result = await client.videoLinks(59708, {});
  assert.deepEqual(result, { voiced: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api-fx\/post\/59708\/video-links$/);
});

test('FilmixClient.videoLinks возвращает null при недоступности и логирует', async () => {
  const restore = captureLog();
  try {
    const apiFxClient = {
      get: async () => { throw new Error('boom'); }
    };
    const client = new FilmixClient({ apiFxClient });
    const result = await client.videoLinks(59708, {});
    assert.equal(result, null);
    const lines = restore();
    assert.ok(lines.some((line) => line.includes('filmix_video_links_failed')), lines.join(' | '));
  } finally {
    restore();
  }
});

test('FilmixClient.card логирует провал первичной API вместо тихого null', async () => {
  const restore = captureLog();
  try {
    const primaryClient = {
      get: async () => { throw new Error('403 Cloudflare'); }
    };
    const client = new FilmixClient({ primaryClient });
    const result = await client.card(59708, {});
    assert.equal(result, null);
    const lines = restore();
    assert.ok(lines.some((line) => line.includes('filmix_card_primary_failed') && line.includes('59708')), lines.join(' | '));
  } finally {
    restore();
  }
});

test('FilmixClient.card не логирует при успешном ответе', async () => {
  const restore = captureLog();
  try {
    const primaryClient = {
      get: async () => ({ text: async () => '{"id":59708,"player_links":{}}' })
    };
    const client = new FilmixClient({ primaryClient });
    const card = await client.card(59708, {});
    assert.equal(card.id, 59708);
    const lines = restore();
    assert.ok(!lines.some((line) => line.includes('filmix_card_primary_failed')));
  } finally {
    restore();
  }
});

test('FilmixClient.searchApi без ретраев быстро уходит на fallback', async () => {
  const primaryClient = {
    get: async () => { throw new Error('geo-block'); }
  };
  const client = new FilmixClient({ primaryClient });
  const result = await client.searchApi('Властелин колец', {});
  assert.deepEqual(result, []);
});

test('FilmixClient: primary-клиент держит короткий таймаут для быстрого фолбэка (F1)', () => {
  const client = new FilmixClient({});
  assert.equal(client.primaryClient.timeoutMs, 3000);
});

test('FilmixClient.searchByExternalIds бьёт по kp и imdb параллельно (F1)', async () => {
  const events = [];
  const primaryClient = {
    get: async () => {
      events.push('start');
      await new Promise((resolve) => setTimeout(resolve, 25));
      events.push('end');
      return { json: async () => [] };
    }
  };
  const client = new FilmixClient({ primaryClient });

  await client.searchByExternalIds({ kp: '79322', imdb: 'tt0944947' }, {});

  const starts = events.filter((event) => event === 'start');
  const firstEnd = events.indexOf('end');
  assert.equal(starts.length, 2, 'оба id-запроса стартовали');
  assert.ok(firstEnd > 1, `параллельность: оба start раньше первого end — ${JSON.stringify(events)}`);
});

test('FilmixClient.searchByExternalIds фильтрует результаты по году', async () => {
  const fixture = [
    { original_title: 'Evil Dead Burn', year: 2026 },
    { original_title: 'Evil Dead (1999)', year: 1999 }
  ];
  const primaryClient = { get: async () => ({ json: async () => fixture }) };
  const client = new FilmixClient({ primaryClient });

  const results = await client.searchByExternalIds({ kp: '1', imdb: 't1', year: '2026' }, {});

  assert.equal(results.length, 2); // по одному на каждый id после фильтра года
  assert.ok(results.every((item) => item.year === 2026));
});
