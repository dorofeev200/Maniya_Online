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
