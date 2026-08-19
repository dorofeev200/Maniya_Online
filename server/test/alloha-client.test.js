import test from 'node:test';
import assert from 'node:assert/strict';
import { AllohaClient } from '../src/providers/alloha/AllohaClient.js';

function makeFakeHttpClient() {
  return {
    calls: [],
    async get(path, options = {}) {
      this.calls.push({ path, options });
      return {
        status: 200,
        ok: true,
        url: path,
        headers: {},
        body: { cancel: () => {} },
        json: async () => ({ data: { file: null } })
      };
    }
  };
}

test('AllohaClient.streams() with directorsCut=true/false does not throw and passes directors_cut param', async () => {
  const httpClient = makeFakeHttpClient();
  const linkClient = makeFakeHttpClient();
  const client = new AllohaClient({
    token: 'test-token',
    httpClient,
    timeoutMs: 100
  });
  client.linkClient = linkClient;

  await client.streams({ token: 'movie-token', directorsCut: true });
  assert.ok(linkClient.calls.length > 0, 'linkClient should be called');
  assert.match(linkClient.calls[0].path, /[?&]directors_cut=true(&|$)/, 'directorsCut=true should set directors_cut=true');

  linkClient.calls.length = 0;
  await client.streams({ token: 'movie-token', directorsCut: false });
  assert.ok(!/[?&]directors_cut=/.test(linkClient.calls[0].path), 'directorsCut=false should omit directors_cut');
});
