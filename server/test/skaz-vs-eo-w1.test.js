// BALANCER-SEMANTICS-005-W1 §6.14 — EoClient-паритет на FOUND-кейсах.
// EoClient остаётся «старым» клиентом (FAIL-NOT-RETRY, эталон сравнения):
// - FOUND (usable HTML на стартовой ноде) → SkazClient обязан СОВПАДАТЬ с EoClient;
// - 2xx-non-usable на стартовой ноде → НАМЕРЕННОЕ расхождение: EoClient → null
//   (стоп на первом 2xx), SkazClient → скан продолжается → HTML (W1 фикс (b)).
import test from 'node:test';
import assert from 'node:assert/strict';

import { EoClient } from '../src/providers/eonline/EoClient.js';
import { SkazClient } from '../src/providers/skaz/SkazClient.js';

function response(status, body = '') {
  return {
    status,
    ok: status >= 200 && status < 300,
    url: '',
    headers: {},
    body: { cancel: () => {} },
    text: async () => String(body)
  };
}

const HOSTS = ['http://h1', 'http://h2'];
const ACCOUNT = { accountEmail: 'user@example.com', uid: 'abc123' };
const USABLE = '<div class="videos__item" data-json=\'{"method":"play","url":"http://h/p.m3u8"}\'>x</div>';

test('W1 EoClient-паритет: FOUND на стартовой ноде → оба клиента возвращают HTML', async () => {
  const mkFetch = () => async () => response(200, USABLE);
  const eo = new EoClient({ balancer: 'rezka', hosts: HOSTS, fetchImpl: mkFetch(), ...ACCOUNT });
  const skaz = new SkazClient({ balancer: 'rezka', hosts: HOSTS, fetchImpl: mkFetch(), ...ACCOUNT });

  const eoHtml = await eo.getLite({ title: 'Game' });
  const skazHtml = await skaz.getLite({ title: 'Game' });
  assert.ok(eoHtml, 'EoClient находит контент');
  assert.ok(skazHtml, 'SkazClient находит контент');
  assert.equal(Boolean(skazHtml), Boolean(eoHtml), 'FOUND → паритет (оба контент)');
  assert.equal(skazHtml, eoHtml, 'при совпадении ответа — совпадает и тело');
});

test('W1 EoClient-паритет: non-usable 2xx на стартовой ноде → НАМЕРЕННОЕ расхождение (skaz впереди)', async () => {
  const seen = [];
  const mkFetch = (label) => async (url) => {
    seen.push(`${label}:${String(url).includes('http://h2') ? 'h2' : 'h1'}:${String(url).includes('null=1') ? 'null' : 'ok'}`);
    if (String(url).includes('http://h2')) return response(200, USABLE);
    return response(200, 'null');
  };
  const eo = new EoClient({ balancer: 'rezka', hosts: HOSTS, fetchImpl: mkFetch('eo'), ...ACCOUNT });
  const skaz = new SkazClient({ balancer: 'rezka', hosts: HOSTS, fetchImpl: mkFetch('skaz'), ...ACCOUNT });

  // h1 → 2xx non-usable, h2 → usable. Тот же пул, та же стартовая нода.
  const eoHtml = await eo.getLite({ null: 1 });
  const skazHtml = await skaz.getLite({ null: 1 });

  assert.equal(eoHtml, null, 'EoClient: FAIL-NOT-RETRY → null на первом 2xx (эталон, НЕ прод)');
  assert.ok(skazHtml, 'SkazClient: скан продолжается → контент со 2-й ноды (W1)');
  // Расхождение зафиксировано и намеренно — оно не регрессия, а цель W1.
  assert.notEqual(Boolean(skazHtml), Boolean(eoHtml));
});