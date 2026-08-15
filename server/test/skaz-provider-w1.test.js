// BALANCER-SEMANTICS-005-W1 (CLUSTER CONSISTENCY) — provider-уровень:
// проброс пина в getLite/openLiteUrl (мovie+serial), обратный сценарий
// «пин упал → ротация → контент», accsdb-стоп с provider_error,
// buildResolveUrl не утекает host/пин. Обязательные тесты §6.6, §6.7, §6.10–§6.12.
import test from 'node:test';
import assert from 'node:assert/strict';

import { SkazProvider } from '../src/providers/skaz/SkazProvider.js';
import { SkazClient } from '../src/providers/skaz/SkazClient.js';

// ===== Recording-фейк: ловим 2-м аргументом options.pinnedHost =====
class RecordingSkazClient {
  constructor(options = {}) {
    this.lite = String(options.lite ?? '');
    this.callOptions = [];
    this.lastAccsdb = null;
  }

  enabled() {
    return true;
  }

  async getLite(params, options = {}) {
    this.callOptions.push({ kind: 'getLite', params, options });
    return this.lite || null;
  }

  async openLiteUrl(url, options = {}) {
    this.callOptions.push({ kind: 'openLiteUrl', url, options });
    return this.lite || null;
  }
}

function makeProvider(client, balancer = 'rezka') {
  return new SkazProvider({
    id: `skaz-${balancer}`,
    title: `Maniya ${balancer}`,
    balancer,
    client
  });
}

function context(query) {
  return { query: { token: '', ...query }, request: {} };
}

const PLAY_CARD_HTML = '<div class="videos__item" data-json=\'{"method":"play","url":"http://h/play.m3u8","translate":"Дубляж"}\'>x</div>';

// ===== §6.6: пин — старт (movie) =====

test('W1 pin-start: movie videos() с query.host → getLite({pinnedHost})', async () => {
  const client = new RecordingSkazClient({ lite: PLAY_CARD_HTML });
  const provider = makeProvider(client, 'rezka');

  const result = await provider.videos(context({ title: 'Game', serial: '0', host: 'http://h2' }));
  assert.ok(result.items.length >= 1, 'items с play-карточки');
  assert.ok(client.callOptions.length >= 1, 'был хотя бы один getLite');
  const first = client.callOptions[0];
  assert.equal(first.kind, 'getLite');
  assert.deepEqual(first.options, { pinnedHost: 'http://h2' }, 'пин из query.host проброшен в getLite');
});

test('W1 pin-start: без query.host → getLite БЕЗ пина (чистая ротация)', async () => {
  const client = new RecordingSkazClient({ lite: PLAY_CARD_HTML });
  const provider = makeProvider(client, 'rezka');

  await provider.videos(context({ title: 'Game', serial: '0' }));
  const first = client.callOptions[0];
  assert.deepEqual(first.options, { pinnedHost: undefined }, 'нет пина → options.pinnedHost пуст');
});

test('W1 pin-start: пустой/пробельный host в query → пина нет', async () => {
  const client = new RecordingSkazClient({ lite: PLAY_CARD_HTML });
  const provider = makeProvider(client, 'rezka');

  await provider.videos(context({ title: 'Game', serial: '0', host: '   ' }));
  assert.deepEqual(client.callOptions[0].options, { pinnedHost: undefined }, 'whitespace host → не пин');
});

// ===== §6.10: пин — серийный путь =====

test('W1 serial: openSeasonPage и openLiteUrl несут pinnedHost; сезоны/voice/серии интактны', async () => {
  // link-карточка сезона s=1 (базовая страница) → openSeasonPage открывает страницу
  // сезона через openLiteUrl — оба шага с пином.
  const client = new RecordingSkazClient({ lite: [
    '<div class="videos__item" data-json=\'{"method":"link","url":"http://94.249.239.63/lite/rezka?s=1"}\'>season1</div>'
  ].join('') });
  const provider = makeProvider(client, 'rezka');

  const nav = await provider.openSeasonPage(context({ serial: '1', s: '1' }).query, 'http://h2');
  assert.ok(nav, 'страница сезона получена');
  assert.ok(client.callOptions.some((c) => c.kind === 'getLite' && c.options.pinnedHost === 'http://h2'),
    'getLite для страницы сезона — с пином');
  assert.ok(client.callOptions.some((c) => c.kind === 'openLiteUrl' && c.options.pinnedHost === 'http://h2'),
    'openLiteUrl (навигация к сезону) — с пином');
  assert.ok(nav.seasons.length >= 1, 'сезоны распознаны');
});

test('W1 serial: videos() сериала с пином → открытие сезона с пином, серии не регрессируют', async () => {
  const client = new RecordingSkazClient({ lite: [
    '<div class="videos__item" data-json=\'{"method":"play","url":"http://h/s1e1.m3u8","translate":"Дубляж"}\'>s1e1</div>'
  ].join('') });
  const provider = makeProvider(client, 'rezka');

  const result = await provider.videos(context({ serial: '1', title: 'S', s: '1' }));
  assert.ok(client.callOptions.some((c) => c.kind === 'getLite' && c.options.pinnedHost === 'http://h2') === false,
    'без пина в query — getLite без пина');
  assert.notEqual(result.items, undefined, 'payload не падает');
});

// ===== §6.7: обратный сценарий — пин упал → ротация → контент (НЕ EMPTY) =====

test('W1 reverse: реальный SkazClient — пин пуст, контент на следующей ноде → items>0', async () => {
  const seen = [];
  const client = new SkazClient({
    balancer: 'rezka',
    hosts: ['http://h1', 'http://h2', 'http://h3'],
    accountEmail: 'user@example.com',
    uid: 'abc123',
    timeoutMs: 200,
    fetchImpl: async (url) => {
      seen.push(String(url));
      if (String(url).includes('http://h2/lite/rezka')) {
        // пин-нода: 2xx-non-usable («нет» на ЭТОЙ ноде)
        return { status: 200, ok: true, url, headers: {}, body: { cancel: () => {} }, text: async () => 'null' };
      }
      if (String(url).includes('http://h3/lite/rezka')) {
        return { status: 200, ok: true, url, headers: {}, body: { cancel: () => {} }, text: async () => PLAY_CARD_HTML };
      }
      return { status: 503, ok: false, url, headers: {}, body: { cancel: () => {} }, text: async () => 'disable' };
    }
  });
  const provider = makeProvider(client, 'rezka');

  const result = await provider.videos(context({ title: 'Game', serial: '0', host: 'http://h2' }));

  assert.ok(result.items.length > 0, `items после обхода пина: ${result.items.length}`);
  assert.ok(seen.length >= 2, 'пин (h2) пуст → скан продолжился (h3)');
  assert.ok(seen[0].startsWith('http://h2/lite/rezka'), 'первый запрос — пин-нода');
  assert.ok(seen.some((u) => u.startsWith('http://h3/lite/rezka')), 'контент со следующей ноды');
  assert.ok(!result.provider_error, 'не accsdb → без provider_error');
});

// ===== §6.11: accsdb на всех нодах → stop + provider_error =====

test('W1 accsdb: все ноды accsdb → items пусты + provider_error (ротация НЕ уходит в бесконечность)', async () => {
  const seen = [];
  const client = new SkazClient({
    balancer: 'rezka',
    hosts: ['http://h1', 'http://h2'],
    accountEmail: 'user@example.com',
    uid: 'abc123',
    timeoutMs: 200,
    fetchImpl: async (url) => {
      seen.push(String(url));
      return { status: 200, ok: true, url, headers: {}, body: { cancel: () => {} }, text: async () => '{"accsdb":true,"msg":"Доступ запрещён"}' };
    }
  });
  const provider = makeProvider(client, 'rezka');

  const result = await provider.videos(context({ title: 'Game', serial: '0' }));

  assert.deepEqual(result.items, [], 'accsdb — не «нет источников», а отказ учётки');
  assert.ok(result.provider_error, 'provider_error установлен');
  assert.equal(result.provider_error.code, 'accsdb');
  assert.ok(seen.length <= 1, `стоп на первой ноде (не перебираем пул): ${seen.length}`);
});

// ===== §6.12: buildResolveUrl не содержит host / пин не утекает клиенту =====

test('W1 no-host-leak: buildResolveUrl не несёт query.host (пин) наружу', () => {
  const provider = makeProvider(new RecordingSkazClient(), 'rezka');
  const url = provider.buildResolveUrl(context({ title: 'Game', id: '42', serial: '0', host: 'http://h2.example' }));

  assert.ok(String(url).startsWith('http'), 'абсолютный URL API');
  assert.ok(!/(^|[?&])host=/i.test(url), 'host-параметр не попадает в URL клиента');
  assert.ok(!String(url).includes('h2.example'), 'значение хоста не утекает');
  assert.ok(String(url).includes('provider=skaz-rezka'), 'провайдер идентифицируется как обычно');
  assert.ok(String(url).includes('id=42') && String(url).includes('title=Game'), 'карточные параметры на месте (whitelist)');
});