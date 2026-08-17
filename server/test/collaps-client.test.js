import test from 'node:test';
import assert from 'node:assert/strict';

import { HttpError } from '../src/errors.js';
import { CollapsClient } from '../src/providers/collaps/CollapsClient.js';

/**
 * GAP-013 regression: embed-host Collaps.
 *
 * Диагностика (docs/collaps-shape-fix-001-report.md §G): embed-путь upstream
 * закрыт серверно (422 0b на /embed/* у api.ortified.ws И api.luxembd.ws — полный
 * браузерный набор headers, curl+node, любой IP; root `/`=200 c заглушкой). Это
 * внешний блокер. Кодовая часть, которую МЫ исправляем: клиент обязан ходить на
 * актуальный для Lampac master хост (api.luxembd.ws, а не мёртвый api.ortified.ws)
 * и управляться через COLLAPS_EMBED_HOST; 422 на embed остаётся честным
 * upstream-refusal (provider_error), а НЕ молчаливым EMPTY.
 */

/** fetchImpl-заглушка, возвращающая HTTP-ответ и запоминающая URL. */
function stubFetch(status, body = '') {
  const state = { urls: [] };
  state.fn = async (url) => {
    state.urls.push(url.toString());
    return new Response(body, { status });
  };
  return state;
}

/** Тест-обёртка для env: сохраняет/восстанавливает переменную. */
function withEnv(key, value, fn) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

test('GB-1 embed использует дефолт актуального Lampac master (api.luxembd.ws)', () =>
  withEnv('COLLAPS_EMBED_HOST', undefined, async () => {
    const stub = stubFetch(200, '<html>makePlayer({...})</html>');
    const client = new CollapsClient({ token: 't', fetchImpl: stub.fn });

    await client.embed({ kinopoiskId: 301 });

    assert.equal(stub.urls.length, 1);
    assert.equal(stub.urls[0], 'https://api.luxembd.ws/embed/kp/301');
  }));

test('GB-2 COLLAPS_EMBED_HOST переопределяет дефолт (миграция апстрима возможна без кода)', () =>
  withEnv('COLLAPS_EMBED_HOST', 'https://api.next.ws', async () => {
    const stub = stubFetch(200, 'ok');
    const client = new CollapsClient({ token: 't', fetchImpl: stub.fn });

    await client.embed({ kinopoiskId: 301 });

    assert.equal(stub.urls[0], 'https://api.next.ws/embed/kp/301');
  }));

test('GB-3 маршруты: kp→/embed/kp/, imdb→/embed/imdb/, orid→/embed/movie/', () =>
  withEnv('COLLAPS_EMBED_HOST', undefined, async () => {
    const stub = stubFetch(200, 'ok');
    const client = new CollapsClient({ token: 't', fetchImpl: stub.fn });

    await client.embed({ kinopoiskId: 258687 });
    await client.embed({ imdbId: '0816692' });
    await client.embed({ orid: 180 });

    assert.deepEqual(stub.urls, [
      'https://api.luxembd.ws/embed/kp/258687',
      'https://api.luxembd.ws/embed/imdb/0816692',
      'https://api.luxembd.ws/embed/movie/180'
    ]);
  }));

test('GB-4 422 на embed → HttpError upstream-refusal (НЕ EMPTY, сигнал для availability)', () =>
  withEnv('COLLAPS_EMBED_HOST', undefined, async () => {
    const client = new CollapsClient({ token: 't', fetchImpl: stubFetch(422).fn });

    await assert.rejects(
      () => client.embed({ kinopoiskId: 301 }),
      (err) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.statusCode, 422);
        assert.equal(err.code, 'collaps_http_error');
        assert.equal(err.details.kind, 'upstream-refusal');
        return true;
      }
    );
  }));

test('GB-5 404 на embed → HttpError invalid-route (остаётся классификацией диагностики)', () => {
  const client = new CollapsClient({ token: 't', fetchImpl: stubFetch(404).fn });
  return assert.rejects(
    () => client.embed({ imdbId: 'nope' }),
    (err) => {
      assert.equal(err.details.kind, 'invalid-route');
      return true;
    }
  );
});

test('GB-6 без канон-ключей или без токена embed не сетит URL', () => {
  const client = new CollapsClient({ token: 't', fetchImpl: stubFetch(200).fn });
  return client.embed({}).then((r) => {
    assert.equal(r.text, '');
    assert.equal(r.embedHost, 'https://api.luxembd.ws');
  });
});