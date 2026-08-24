// MANIYA-STAGING (TASK-032 Phase 17): эквивалент PROD-режима (MANIYA_STAGING_ENABLED
// НЕ задан → default false). /version, /api/lampa/version и /staging/<short>.js
// обязаны быть 404 — staging-контур не светится вне staging. Сборка вне publicDir
// не раздаётся и здесь.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = '*';
process.env.RATE_LIMIT_MAX = '1000';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:3399';
process.env.USERS_FILE = new URL('./fixtures/users.json', import.meta.url).pathname;
process.env.VIDEOS_FILE = new URL('./fixtures/videos.json', import.meta.url).pathname;
process.env.FILMIX_ENABLED = '0';
// MANIYA_STAGING_ENABLED сознательно НЕ задан.

const { server } = await import('../src/index.js');

const base = 'http://127.0.0.1:3399';
const LAMPA_UA = 'Mozilla/5.0 Lampa/0.20.4';
const lampaFetch = (url) => fetch(url, { headers: { 'User-Agent': LAMPA_UA } });

before(async () => {
  await new Promise((resolve) => server.listen(3399, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('Phase 17 — staging контур выключен (подобие PROD)', () => {
  it('/version → 404', async () => {
    const response = await fetch(`${base}/version`);
    assert.equal(response.status, 404);
  });

  it('/api/lampa/version → 404', async () => {
    const response = await fetch(`${base}/api/lampa/version`);
    assert.equal(response.status, 404);
  });

  it('/staging/<short>.js → 404 даже с Lampa-UA', async () => {
    const response = await lampaFetch(`${base}/staging/4f3a9c21e7b64d08a5c2f1e9.js`);
    assert.equal(response.status, 404);
  });

  it('/maniya-online-staging.js via sendStatic → 404', async () => {
    const response = await lampaFetch(`${base}/maniya-online-staging.js`);
    assert.equal(response.status, 404);
  });

  it('/health и /api/lampa/health остаются рабочими', async () => {
    const h = await fetch(`${base}/health`);
    assert.equal(h.status, 200);
    const ah = await fetch(`${base}/api/lampa/health`);
    assert.equal(ah.status, 200);
  });
});