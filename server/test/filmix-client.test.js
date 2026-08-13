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

// ── Search routing (api-fx primary, filmix.my v2 fallback) ─────────────

test('FilmixClient.searchApiFx бьёт по api-fx/list и возвращает items', async () => {
  const calls = [];
  const httpClient = {
    get: async (url, opts) => {
      calls.push({ url, opts });
      return { json: async () => ({ items: [{ id: 59708, title: '6-ой раунд' }] }) };
    }
  };
  const client = new FilmixClient({ httpClient });
  const items = await client.searchApiFx('Round 6', {});
  assert.equal(items.length, 1);
  assert.match(calls[0].url, /\/api-fx\/list/);
  assert.equal(new URL(calls[0].url).searchParams.get('search'), 'Round 6');
  assert.equal(new URL(calls[0].url).searchParams.get('limit'), '48');
});

test('FilmixClient.searchApiFx без учётки не добавляет auth-заголовки', async () => {
  const calls = [];
  const httpClient = {
    get: async (url, opts) => {
      calls.push({ url, opts });
      return { json: async () => ({ items: [] }) };
    }
  };
  const client = new FilmixClient({ httpClient });
  await client.searchApiFx('Round 6', {});
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].opts.headers.Authorization, 'без учётки Authorization не должен быть');
  assert.ok(!calls[0].opts.headers.hash, 'без учётки hash не должен быть');
});

test('FilmixClient.searchApiFx при ошибке логирует и возвращает []', async () => {
  const restore = captureLog();
  try {
    const httpClient = { get: async () => { throw new Error('boom'); } };
    const client = new FilmixClient({ httpClient });
    const items = await client.searchApiFx('Round 6', {});
    assert.deepEqual(items, []);
    const lines = restore();
    assert.ok(lines.some((line) => line.includes('filmix_api_fx_search_failed')), lines.join(' | '));
  } finally {
    restore();
  }
});

test('FilmixClient.searchApiV2 ходит в filmix.my/api/v2/search через primary-клиент', async () => {
  const calls = [];
  const primaryClient = {
    get: async (url, opts) => {
      calls.push({ url, opts });
      return { json: async () => [{ id: 1, title: 'Test' }] };
    }
  };
  const client = new FilmixClient({ primaryClient });
  const items = await client.searchApiV2('Властелин колец', {});
  assert.equal(items.length, 1);
  assert.match(calls[0].url, /\/api\/v2\/search/);
  assert.equal(new URL(calls[0].url).searchParams.get('story'), 'Властелин колец');
  assert.equal(new URL(calls[0].url).searchParams.get('user_dev_apk'), '2.2.13', 'должны быть appArgs');
});

test('FilmixClient.searchApiV2 без ретраев быстро уходит на fallback', async () => {
  const primaryClient = {
    get: async () => { throw new Error('geo-block'); }
  };
  const client = new FilmixClient({ primaryClient });
  const result = await client.searchApiV2('Властелин колец', {});
  assert.deepEqual(result, []);
});

test('FilmixClient.search идёт в api-fx primary и не трогает v2 при находке', async () => {
  const calls = [];
  const httpClient = {
    get: async (url) => {
      calls.push(url.includes('/api-fx/') ? 'api-fx' : 'api-fx');
      return { json: async () => ({ items: [{ id: 1, title: 'Тест', original_title: 'Test', year: 2020 }] }) };
    }
  };
  const primaryClient = {
    get: async () => { calls.push('v2'); return { json: async () => [] }; }
  };
  const client = new FilmixClient({ httpClient, primaryClient });
  const result = await client.search({ title: 'Тест', originalTitle: 'Test', year: 2020 }, {});
  assert.equal(result.items.length, 1);
  assert.deepEqual(calls, ['api-fx'], 'fallback v2 не должен вызываться при находке');
});

test('FilmixClient.search фолбэчит на v2 (два стори-попа) при пустом api-fx', async () => {
  const storyCalls = [];
  const httpClient = {
    get: async () => ({ json: async () => ({ items: [] }) })
  };
  const primaryClient = {
    get: async (url) => {
      storyCalls.push(new URL(url).searchParams.get('story'));
      return { json: async () => [] };
    }
  };
  const client = new FilmixClient({ httpClient, primaryClient });
  const result = await client.search({ title: 'Тест', originalTitle: 'Round 6' }, {});
  assert.deepEqual(result.items, []);
  assert.deepEqual(storyCalls, ['Тест', 'Round 6'], 'первый стори = title, второй = originalTitle');
});

test('FilmixClient.search фолбэчит на v2 при ошибке api-fx', async () => {
  let apiFxCalls = 0;
  const httpClient = {
    get: async () => { apiFxCalls++; throw new Error('boom'); }
  };
  let v2Calls = 0;
  const primaryClient = {
    get: async () => { v2Calls++; return { json: async () => [{ id: 1, title: 'Test', year: 2020 }] }; }
  };
  const client = new FilmixClient({ httpClient, primaryClient });
  const result = await client.search({ title: 'Тест', originalTitle: 'Round 6' }, {});
  assert.equal(apiFxCalls, 1);
  assert.equal(v2Calls, 1, 'первый v2-стори дал результат → второй не нужен');
  assert.equal(result.items.length, 1);
});

test('FilmixClient: searchByExternalIds удалён из роутинга', () => {
  const client = new FilmixClient({});
  assert.equal(typeof client.searchByExternalIds, 'undefined');
});

test('FilmixClient: primary-клиент держит короткий таймаут для быстрого фолбэка (F1)', () => {
  const client = new FilmixClient({});
  assert.equal(client.primaryClient.timeoutMs, 3000);
});

// ── FilmixTV auth flow ───────────────────────────────────────────────

test('FilmixClient.ensureTvAccessToken возвращает null без учётки', async () => {
  const client = new FilmixClient({});
  const result = await client.ensureTvAccessToken();
  assert.equal(result, null);
});

test('FilmixClient.ensureTvAccessToken получает hash и accessToken', async () => {
  const calls = [];
  const tvAuthClient = {
    get: async (url) => {
      calls.push({ method: 'GET', url });
      return { json: async () => ({ token: 'hash_abc123' }) };
    },
    post: async (url, body, opts) => {
      calls.push({ method: 'POST', url, body, opts });
      return { json: async () => ({ accessToken: 'bearer_token_xyz', refreshToken: 'refresh_token' }) };
    }
  };
  const apiFxClient = { get: async () => ({ json: async () => ({}) }) };
  const primaryClient = { get: async () => ({ json: async () => [] }) };
  const httpClient = { get: async () => ({ json: async () => ({ items: [] }) }) };

  const client = new FilmixClient({
    tvUser: 'test@example.com',
    tvPassword: 'secret123',
    tvAuthClient,
    apiFxClient,
    primaryClient,
    httpClient
  });

  const result = await client.ensureTvAccessToken();
  assert.ok(result, 'должен вернуть объект токена');
  assert.equal(result.hash, 'hash_abc123');
  assert.equal(result.accessToken, 'bearer_token_xyz');
  assert.ok(result.expiresAt > Date.now(), 'expiresAt в будущем');

  // Проверяем порядок вызовов
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/api-fx\/request-token$/);
  assert.match(calls[1].url, /\/api-fx\/auth$/);
  assert.equal(JSON.parse(calls[1].body).user_name, 'test@example.com');
  assert.equal(JSON.parse(calls[1].body).user_passw, 'secret123');
  assert.equal(JSON.parse(calls[1].body).session, true);
  assert.equal(calls[1].opts.headers.hash, 'hash_abc123');
});

test('FilmixClient.ensureTvAccessToken кэширует токен на 4 мин', async () => {
  let getCount = 0;
  const tvAuthClient = {
    get: async () => {
      getCount++;
      return { json: async () => ({ token: `hash_${getCount}` }) };
    },
    post: async () => {
      return { json: async () => ({ accessToken: `token_${getCount}` }) };
    }
  };
  const apiFxClient = { get: async () => ({ json: async () => ({}) }) };
  const primaryClient = { get: async () => ({ json: async () => [] }) };
  const httpClient = { get: async () => ({ json: async () => ({ items: [] }) }) };

  const client = new FilmixClient({
    tvUser: 'test@example.com',
    tvPassword: 'secret123',
    tvAuthClient,
    apiFxClient,
    primaryClient,
    httpClient
  });

  const first = await client.ensureTvAccessToken();
  const second = await client.ensureTvAccessToken();
  const third = await client.ensureTvAccessToken();

  assert.equal(first.accessToken, 'token_1');
  assert.equal(second.accessToken, 'token_1'); // из кэша
  assert.equal(third.accessToken, 'token_1');  // из кэша
  assert.equal(getCount, 1, 'auth должен вызваться ровно 1 раз при активном кэше');
});

test('FilmixClient.ensureTvAccessToken сбрасывает кэш при ошибке auth', async () => {
  let getCount = 0;
  const tvAuthClient = {
    get: async () => {
      getCount++;
      if (getCount <= 1) return { json: async () => ({ token: 'hash_bad' }) };
      return { json: async () => ({ token: 'hash_good' }) };
    },
    post: async () => {
      if (getCount <= 1) throw new Error('auth timeout');
      return { json: async () => ({ accessToken: 'token_recovered' }) };
    }
  };
  const apiFxClient = { get: async () => ({ json: async () => ({}) }) };
  const primaryClient = { get: async () => ({ json: async () => [] }) };
  const httpClient = { get: async () => ({ json: async () => ({ items: [] }) }) };

  const client = new FilmixClient({
    tvUser: 'test@example.com',
    tvPassword: 'secret123',
    tvAuthClient,
    apiFxClient,
    primaryClient,
    httpClient
  });

  const first = await client.ensureTvAccessToken();
  assert.equal(first, null, 'первый вызов — ошибка auth → null');

  const second = await client.ensureTvAccessToken();
  assert.ok(second, 'второй вызов — после сброса кэша — восстанавливается');
  assert.equal(second.accessToken, 'token_recovered');
});

test('FilmixClient.tvAuthHeaders возвращает заголовки для api-fx', async () => {
  const tvAuthClient = {
    get: async () => ({ json: async () => ({ token: 'hash_hdr' }) }),
    post: async () => ({ json: async () => ({ accessToken: 'bearer_hdr' }) })
  };
  const apiFxClient = { get: async () => ({ json: async () => ({}) }) };
  const primaryClient = { get: async () => ({ json: async () => [] }) };
  const httpClient = { get: async () => ({ json: async () => ({ items: [] }) }) };

  const client = new FilmixClient({
    tvUser: 'test@example.com',
    tvPassword: 'secret123',
    tvAuthClient,
    apiFxClient,
    primaryClient,
    httpClient
  });

  const headers = await client.tvAuthHeaders();
  assert.deepEqual(headers, {
    Authorization: 'Bearer bearer_hdr',
    hash: 'hash_hdr'
  });
});

test('FilmixClient.tvAuthHeaders возвращает null без учётки', async () => {
  const client = new FilmixClient({});
  const headers = await client.tvAuthHeaders();
  assert.equal(headers, null);
});

test('FilmixClient.videoLinks добавляет auth-заголовки при наличии учётки', async () => {
  const calls = [];
  const tvAuthClient = {
    get: async () => ({ json: async () => ({ token: 'hash_vl' }) }),
    post: async () => ({ json: async () => ({ accessToken: 'bearer_vl' }) })
  };
  const apiFxClient = {
    get: async (url, opts) => {
      calls.push({ url, opts });
      return { json: async () => [{ voiceover: 'Test', files: [] }] };
    }
  };
  const primaryClient = { get: async () => ({ json: async () => [] }) };
  const httpClient = { get: async () => ({ json: async () => ({ items: [] }) }) };

  const client = new FilmixClient({
    tvUser: 'test@example.com',
    tvPassword: 'secret123',
    tvAuthClient,
    apiFxClient,
    primaryClient,
    httpClient
  });

  const result = await client.videoLinks(12345, {});
  assert.ok(Array.isArray(result));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer bearer_vl');
  assert.equal(calls[0].opts.headers.hash, 'hash_vl');
});

test('FilmixClient.videoLinks без учётки не добавляет auth-заголовки', async () => {
  const calls = [];
  const apiFxClient = {
    get: async (url, opts) => {
      calls.push({ url, opts });
      return { json: async () => [{ voiceover: 'Test', files: [] }] };
    }
  };
  const primaryClient = { get: async () => ({ json: async () => [] }) };
  const httpClient = { get: async () => ({ json: async () => ({ items: [] }) }) };

  const client = new FilmixClient({ apiFxClient, primaryClient, httpClient });

  await client.videoLinks(12345, {});
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].opts.headers.Authorization, 'без учётки Authorization не должен быть');
  assert.ok(!calls[0].opts.headers.hash, 'без учётки hash не должен быть');
});

test('FilmixClient.searchApiFx с учёткой добавляет auth-заголовки', async () => {
  const calls = [];
  const tvAuthClient = {
    get: async () => ({ json: async () => ({ token: 'hash_sf' }) }),
    post: async () => ({ json: async () => ({ accessToken: 'bearer_sf' }) })
  };
  const httpClient = {
    get: async (url, opts) => {
      calls.push({ url, opts });
      return { json: async () => ({ items: [{ id: 1, title: 'Test' }] }) };
    }
  };
  const apiFxClient = { get: async () => ({ json: async () => ({}) }) };
  const primaryClient = { get: async () => { throw new Error('geo-block'); } };

  const client = new FilmixClient({
    tvUser: 'test@example.com',
    tvPassword: 'secret123',
    tvAuthClient,
    apiFxClient,
    primaryClient,
    httpClient
  });

  const items = await client.searchApiFx('Primary', {});
  assert.ok(items.length > 0);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer bearer_sf');
  assert.equal(calls[0].opts.headers.hash, 'hash_sf');
});
