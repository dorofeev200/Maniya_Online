// SKAZ-MANIYA-002 §критерий 9: Maniya НЕ должен отдавать call-url вместо resolved
// stream. Ленивый резолв /api/lampa/video обязан возвращать /proxy/<hash> (или
// реальный CDN-стрим провайдера), а НЕ обёрнутый в прокси call-url
// `/lite/<balancer>/video/<token>` — иначе плеер получает клиентскую ссылку
// резолва, а не играбельный стрим.
//
// Детерминированный (без сети): мок-клиент имитирует сервер Skaz, который на
// call-url отвечает JSON `/proxy/<hash>`. Проверяем, что resolveCardItem
// оборачивает в прокси ИМЕННО /proxy/<hash>, а не call-токен.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SkazProvider } from '../src/providers/skaz/SkazProvider.js';

class FakeClient {
  constructor({ videoJson, resolveResult }) {
    this.videoJson = videoJson == null ? null : videoJson;
    this.resolveResult = resolveResult || 'http://mock.stream.voidboost.one/s/key/master.m3u8';
    this.calls = [];
  }
  enabled() { return true; }
  async resolveVideoJson(streamUrl) {
    this.calls.push(['resolveVideoJson', streamUrl]);
    if (this.videoJson == null) return null;
    return typeof this.videoJson === 'string' ? JSON.parse(this.videoJson) : this.videoJson;
  }
  async resolveStream(url) {
    this.calls.push(['resolveStream', url]);
    return this.resolveResult;
  }
}

function makeProvider(client) {
  return new SkazProvider({ id: 'skaz-videoseed', title: 'Maniya videoseed', balancer: 'videoseed', client });
}

function ctx(query) {
  return { query: { token: '', ...query }, request: {} };
}

const CALL_TOKEN = 'http://online3.skaz.tv/lite/videoseed/video/NCL5+ZV2EXG/play=true';
const PROXY_HASH = 'http://online3.skaz.tv/proxy/04bbd07573fbd5c38ae413d5ccacf391.m3u8';

// call-карточка movie с ПУСТЫМ stream (токен в url) — худший случай.
const movieCardHtml = [
  '<div class="videos__item" data-json=\'{"method":"call","url":"' + CALL_TOKEN + '","stream":"","translate":"Дубляж"}\'>Дубляж</div>'
].join('');

test('movie call-карточка stream="" url=<токен> → item.url = proxy(/proxy/<hash>), НЕ call-url', async () => {
  const client = new FakeClient({ videoJson: { method: 'play', url: PROXY_HASH, quality: {}, subtitles: [] } });
  client.lite = movieCardHtml;
  client.getLite = async () => movieCardHtml;
  const provider = makeProvider(client);
  const item = await provider.resolveVideo(ctx({ serial: '0', voice: '0' }));
  assert.ok(item, 'дескриптор');
  // через прокси (buildProxyUrl с конфиг publicBaseUrl)
  const u = String(item.url);
  assert.ok(u.includes('/api/lampa/proxy'), `URL через прокси: ${u}`);
  const inner = decodeURIComponent(u.split('?url=')[1] || '');
  assert.ok(inner.includes('/proxy/04bbd075'), `внутри прокси — /proxy/<hash>: ${inner.slice(0, 90)}`);
  assert.ok(!/\/lite\/videoseed\/video\//.test(inner), 'внутри прокси НЕ call-url');
});

test('movie call-карточка stream=НЕпусто (обычный) → всё равно resolved /proxy, НЕ call-url', async () => {
  const html = [
    '<div class="videos__item" data-json=\'{"method":"call","url":"' + CALL_TOKEN + '","stream":"' + CALL_TOKEN + '.m3u8","translate":"Дубляж"}\'>Дубляж</div>'
  ].join('');
  const client = new FakeClient({ lite_ok: true, videoJson: { method: 'play', url: PROXY_HASH, quality: {}, subtitles: [] } });
  // подменяем getLite через открытый хук: используем объект с lite
  client.lite = html;
  client.getLite = async () => html;
  const provider = makeProvider(client);
  const item = await provider.resolveVideo(ctx({ serial: '0', voice: '0' }));
  assert.ok(item, 'дескриптор');
  const inner = decodeURIComponent(String(item.url).split('?url=')[1] || '');
  assert.ok(inner.includes('/proxy/04bbd075'), `внутри прокси — /proxy/<hash>`);
  assert.ok(!/\/lite\/videoseed\/video\//.test(inner), 'не call-url');
});

test('JSON-режим недоступен → фолбэк resolveStream: возвращает resolved CDN, НЕ call-url', async () => {
  const client = new FakeClient({ videoJson: null, resolveResult: 'http://mock.stream.voidboost.one/s/key/master.m3u8' });
  client.lite = movieCardHtml;
  client.getLite = async () => movieCardHtml;
  const provider = makeProvider(client);
  const item = await provider.resolveVideo(ctx({ serial: '0', voice: '0' }));
  assert.ok(item, 'дескриптор через фолбэк');
  const inner = decodeURIComponent(String(item.url).split('?url=')[1] || '');
  assert.ok(!/\/lite\/videoseed\/video\//.test(inner), 'фолбэк не отдаёт call-url');
  assert.ok(inner.includes('.m3u8'), `фолбэк отдаёт resolved стрим: ${inner.slice(0, 80)}`);
  assert.ok(client.calls.some(([name]) => name === 'resolveStream'), 'использован resolveStream');
});
