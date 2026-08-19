import test from 'node:test';
import assert from 'node:assert/strict';
import { SkazRchClient } from '../src/providers/skaz/SkazRchClient.js';

test('SkazRchClient._executePushed() uses a string User-Agent for apk rchtype', async () => {
  const seen = [];
  const client = new SkazRchClient({
    nwsUrl: 'wss://example.com/nws',
    host: 'example.com',
    rchtype: 'apk',
    timeoutMs: 100,
    fetchImpl: async (url, options = {}) => {
      seen.push({ url: String(url), headers: options.headers || {} });
      return {
        status: 200,
        ok: true,
        url: String(url),
        headers: new Headers(),
        text: async () => ''
      };
    },
    validateUrl: async (value) => new URL(String(value))
  });

  await client._executePushed('https://allowed-host.example.com/path', '', null, false);

  const pushedCall = seen.find((c) => c.url === 'https://allowed-host.example.com/path');
  assert.ok(pushedCall, 'pushed URL should be fetched');
  const ua = pushedCall.headers['user-agent'];
  assert.equal(typeof ua, 'string', 'User-Agent must be a string');
  assert.ok(ua.startsWith('Mozilla/5.0'), `User-Agent should be a browser UA, got: ${ua}`);
  assert.ok(!ua.includes('function'), `User-Agent must not be function source, got: ${ua}`);
});
