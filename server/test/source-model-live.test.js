// SKAZ-MANIYA-019: LIVE-сверка per-title модели с реаальным кластером.
// Включение: T019_LIVE=1 (иначе — skip). Требует рабочего SKAZ_ACCOUNT_EMAIL/SKAZ_UID
// в server/.env (creds кластера). READ-ONLY GET, ничего не мутирует.
import test from 'node:test';
import assert from 'node:assert/strict';

import { sourceModel } from '../src/sources/sourceModel.js';

const LIVE = process.env.T019_LIVE === '1';

const CARDS = [
  { name: 'mutiny', q: { id: '1288445', title: 'Мятеж', original_title: 'The Mutiny', year: '2026', serial: '0', source: 'tmdb' } },
  { name: 'toystory5', q: { id: '348447', title: 'История игрушек 5', original_title: 'Toy Story 5', year: '2026', serial: '0', source: 'tmdb' } },
  { name: 'interst', q: { id: '157336', title: 'Интерстеллар', original_title: 'Interstellar', year: '2014', serial: '0', source: 'tmdb' } }
];

test('live: lite/events на 3 карточках → детерминированная модель (32+, KinoPub первый, ghost+rch)', {
  skip: !LIVE && 'T019_LIVE=1 — живой кластер'
}, async () => {
  for (const { name, q } of CARDS) {
    const res = await sourceModel.card(q, 't019-live');
    assert.notEqual(res, null, `${name}: события недоступны — ожидался валидный online[] (проверь сеть/creds)`);
    assert.ok(res.items.length >= 32, `${name}: >= 32 items`);
    assert.equal(res.items[0].index, 1, `${name}: первый index=1`);
    assert.equal(res.items[0].balanser, 'kinopub', `${name}: первый = KinoPub`);

    const shown = res.items.filter((i) => i.show);
    const ghost = res.items.filter((i) => i.ghost);
    assert.ok(shown.length >= 10, `${name}: показаны (${shown.length})`);
    assert.ok(ghost.length >= 1, `${name}: есть скрытые ghost (${ghost.length})`);
    assert.ok(res.items.filter((i) => i.rch).length >= 1, `${name}: rch-источники присутствуют`);
    assert.equal(res.items.filter((i) => i.balanser === 'filmixtv').length, 0, `${name}: filmixtv отсутствует`);
  }
});