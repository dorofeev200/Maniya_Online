// SKAZ-MANIYA-019: per-title модель источников — юнит-тесты (DI, фикстуры).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildModel,
  buildEventsParams,
  createSourceModel,
  modelCacheKey,
  resolveModelId,
  sortModelByIndex
} from '../src/sources/sourceModel.js';

function fixture(name) {
  return readFile(new URL(`./fixtures/t019-${name}.json`, import.meta.url), 'utf8').then(JSON.parse);
}

// Registry-снимок как в проде (PREIMPLEMENT-AUDIT §5): natives enabled →
// native id wins; visibleSkaz — skaz-мосты без enabled-native (show=true).
const NATIVE_IDS = ['filmix', 'kodik', 'rezka', 'alloha', 'rutubemovie', 'cdnvideohub', 'collaps', 'hdvb', 'kinotochka'];
const VISIBLE_SKAZ = [
  'kinopub', 'kinoflix', 'pidtor', 'veoveo', 'videoseed', 'solntse', 'geosaitebi',
  'zetflixdb', 'zagonka', 'xvideocdnultra', 'vkmovie', 'rhsprem'
].map((b) => ({ id: `skaz-${b}`, balancer: b }));

const SNAPSHOT = {
  natives: NATIVE_IDS.map((id) => ({ id })),
  visibleSkaz: VISIBLE_SKAZ,
  nativeIdSet: new Set(NATIVE_IDS),
  skazSlugVisible: new Set(VISIBLE_SKAZ.map((s) => s.balancer))
};

test('buildModel(mutiny): 35 items, показанные 12+2, ghost 21, KinoPub первый', async () => {
  const model = buildModel(await fixture('mutiny'), SNAPSHOT);

  assert.equal(model.length, 35, '32 кластерных + 3 Maniya-only extras');
  const shown = model.filter((i) => i.show === true);
  assert.equal(shown.length, 14, '12 кластерных shown + kodik/collaps (native extras)');
  const ghost = model.filter((i) => i.ghost === true);
  assert.equal(ghost.length, 21, 'скрытые кластерные + skaz-rhsprem (T054: skaz-экстра → ghost)');
  assert.ok(ghost.every((i) => i.show === false), 'ghost ⇔ show:false');

  const first = model[0];
  assert.equal(first.id, 'skaz-kinopub', 'первый = KinoPub (index 1)');
  assert.equal(first.index, 1);
  assert.equal(first.name, 'KinoPub', 'имя — серверное (кластерное), не из мета-реестра');
  assert.equal(first.api_url, '/api/lampa/videos?provider=skaz-kinopub');

  const filmix = model.find((i) => i.id === 'filmix');
  assert.equal(filmix.name, 'Filmix ~ 4K', 'серверное имя с качеством сохранено вербатим');
  assert.equal(filmix.quality_label, '', 'у кластерных quality_label пустой (качество в имени)');

  assert.ok(!model.some((i) => i.balanser === 'filmixtv' || i.id === 'filmixtv'), 'filmixtv отсутствует (T018 §3.3)');
});

test('fill: index ASC с tie-break; коллизии index ПРЕСЕРВУЮТСЯ (mutiny 2×index2, interst 2×index7)', async () => {
  for (const [name, collision, ids] of [
    ['mutiny', 2, ['filmix', 'skaz-sakhtv']],
    ['interst', 7, ['skaz-zagonka', 'skaz-remux']]
  ]) {
    const model = buildModel(await fixture(name), SNAPSHOT);
    const indexes = model.filter((i) => i.index != null).map((i) => i.index);
    assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b), `${name}: индекс возрастает`);

    const pair = model.filter((i) => i.index === collision);
    assert.equal(pair.length, 2, `${name}: два источника на index=${collision} — оба сохранены`);
    assert.deepEqual(pair.map((i) => i.id), ids, `${name}: детерминированный порядок в коллизии`);
  }
});

test('buildModel: показанные счётчики по свежим фикстурам (12/14/24 + 2 native extras)', async () => {
  const expected = { mutiny: [12, 21], toystory5: [14, 19], interst: [24, 9] };
  for (const [name, [shownCluster, hidden]] of Object.entries(expected)) {
    const model = buildModel(await fixture(name), SNAPSHOT);
    assert.equal(model.filter((i) => i.show).length, shownCluster + 2, `${name}: shown = кластер + 2 native extras`);
    assert.equal(model.filter((i) => i.ghost).length, hidden, `${name}: ghost = скрытые кластерные + skaz-rhsprem`);
    assert.equal(model.filter((i) => i.rch).length, 3, `${name}: rch-источники сохранены (ashdi/kinoukr/eneyida)`);
  }
});

test('resolveModelId: native enabled wins, иначе skaz-<slug>', () => {
  const cases = [
    ['lordfilm', 'skaz-lordfilm'],
    ['cdnvideohub', 'cdnvideohub'],
    ['ashdi', 'skaz-ashdi'],
    ['filmix', 'filmix'],
    ['kinotochka', 'kinotochka'],
    ['vkmovie', 'skaz-vkmovie'],
    ['rutubemovie', 'rutubemovie']
  ];
  for (const [slug, expected] of cases) {
    assert.equal(resolveModelId(slug, SNAPSHOT), expected, `slug=${slug}`);
  }
  assert.equal(resolveModelId('', SNAPSHOT), null);
});

test('TRUSTED filmix: транзиентное show:false у native-включённого filmix НЕ прячет источник', () => {
  const online = [
    { name: 'Filmix', url: 'http://online3.skaz.tv/lite/filmix', index: 2, show: false, balanser: 'filmix', rch: false, voices: 0, seasons: 0 }
  ];
  const model = buildModel(online, SNAPSHOT);
  const filmix = model.find((i) => i.id === 'filmix');
  assert.ok(filmix, 'filmix в модели');
  assert.equal(filmix.show, true, 'show = (id===\'filmix\' && nativeEnabled) ? true : o.show');
  assert.equal(filmix.ghost, false);
});

test('native/twin no-double: alloha disabled → skaz-alloha (близнец вместо native-чипа)', () => {
  const noAlloha = {
    ...SNAPSHOT,
    nativeIdSet: new Set(NATIVE_IDS.filter((id) => id !== 'alloha'))
  };
  const online = [
    { name: 'Alloha', url: 'http://online3.skaz.tv/lite/alloha', index: 4, show: true, balanser: 'alloha', rch: false, voices: 5, seasons: 0 }
  ];
  const model = buildModel(online, noAlloha);
  const alloha = model.find((i) => i.balanser === 'alloha');
  assert.equal(alloha.id, 'skaz-alloha', 'без native → skaz-мост, НЕ native-близнец-дубль');
  assert.deepEqual(model.filter((i) => i.balanser === 'alloha').length, 1, 'один чип');
});

test('voices/seasons перенесены вербатим (как из кластера)', async () => {
  const model = buildModel(await fixture('mutiny'), SNAPSHOT);
  assert.equal(model.find((i) => i.id === 'skaz-kinopub').voices, 4);
  assert.equal(model.find((i) => i.id === 'skaz-videoseed').voices, 12);
  assert.equal(model.find((i) => i.balanser === 'ashdi').rch, true);
  assert.equal(model.every((i) => i.seasons === 0), true, 'фильм: seasons=0 как в online[]');
});

test('Maniya-only extras: native (kodik/collaps) — show:true; skaz-экстра (skaz-rhsprem) — ghost (T054)', async () => {
  const model = buildModel(await fixture('mutiny'), SNAPSHOT);
  const ids = model.map((i) => i.id);
  assert.deepEqual(ids.slice(-3), ['kodik', 'collaps', 'skaz-rhsprem'], 'extras в конце, index=null');

  for (const id of ['kodik', 'collaps']) {
    const item = model.find((i) => i.id === id);
    assert.equal(item.index, null, `${id}: index null`);
    assert.equal(item.show, true, `${id}: native-экстра — свой серверный контент, кластер не критерий`);
    assert.equal(item.ghost, false);
    assert.ok(item.quality_label === '' || typeof item.quality_label === 'string');
  }

  const rhs = model.find((i) => i.id === 'skaz-rhsprem');
  assert.equal(rhs.index, null, 'skaz-rhsprem: index null');
  assert.equal(rhs.show, false, 'skaz-rhsprem: кластер не смоделировал слог → НЕ активный чип');
  assert.equal(rhs.ghost, true, 'skaz-rhsprem: остаётся в «Ещё N» (ghost), доступен вручную');
});

test('buildEventsParams: whitelist только карточных пар; никаких auth/life/checksearch клиентских параметров', () => {
  const params = buildEventsParams({
    id: '1288445',
    title: 'Мятеж',
    original_title: 'The Mutiny',
    serial: 'true',
    source: 'tmdb',
    life: 'true',
    checksearch: 'true',
    account_email: 'secret@x',
    uid: 'abc',
    extras: 'drop'
  });
  assert.deepEqual(params, {
    id: '1288445',
    title: 'Мятеж',
    original_title: 'The Mutiny',
    serial: '1',
    source: 'tmdb'
  });
  const movie = buildEventsParams({ id: '13', year: '2026' });
  assert.equal(movie.serial, '0', 'фильм → serial:0');
  assert.equal(movie.source, 'tmdb', 'source по умолчанию tmdb');
});

test('modelCacheKey: полные card params + uid; uid разъединяет кэш', () => {
  const k1 = modelCacheKey({ id: 'x', title: 'Т' }, 'u1');
  const k2 = modelCacheKey({ id: 'x', title: 'Т' }, 'u2');
  const k3 = modelCacheKey({ id: 'x', title: 'Т' }, 'u1');
  assert.notEqual(k1, k2, 'uid в ключе');
  assert.equal(k1, k3, 'тот же uid+query → тот же ключ');
});

test('createSourceModel: успех → модель; кэш-хит не ходит в events; uid разделяет кэш', async () => {
  let calls = 0;
  const client = { getOnline: async () => { calls += 1; return fixture('mutiny'); } };
  const model = createSourceModel({ client, snapshot: () => SNAPSHOT, ttlMs: 60_000 });

  const first = await model.card({ id: 'x' }, 'u1');
  assert.equal(first.cached, false);
  assert.equal(first.items.length, 35);
  assert.equal(first.items[0].id, 'skaz-kinopub');

  const hit = await model.card({ id: 'x' }, 'u1');
  assert.equal(hit.cached, true, 'кэш-хит');
  assert.equal(hit.elapsedMs, 0);
  assert.equal(calls, 1, 'кэш-хит не делает второй events-заход');

  await model.card({ id: 'x' }, 'u2');
  assert.equal(calls, 2, 'другой uid → отдельный кэш (нет утечки между юзерами)');
});

test('createSourceModel: single-flight — конкурирующие запросы делят ОДИН events-fetch', async () => {
  let inflight = 0;
  let maxInflight = 0;
  const client = {
    getOnline: async () => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 20));
      inflight -= 1;
      return fixture('toystory5');
    }
  };
  const model = createSourceModel({ client, snapshot: () => SNAPSHOT });
  const [a, b] = await Promise.all([model.card({ id: 'y' }, 'u'), model.card({ id: 'y' }, 'u')]);
  assert.equal(a.items.length, 35);
  assert.equal(b.items.length, 35);
  assert.equal(maxInflight, 1, 'единый upstream fetch для конкурентных карточек');
});

test('createSourceModel: getOnline → null (timeout/invalid/accsdb) → card() null, НЕ кэшируется', async () => {
  let attempts = 0;
  const client = { getOnline: async () => { attempts += 1; return null; } };
  const model = createSourceModel({ client, snapshot: () => SNAPSHOT });

  assert.equal(await model.card({ id: 'z' }, 'u'), null, 'events недоступны → null (fallback, не частичная модель)');
  assert.equal(await model.card({ id: 'z' }, 'u'), null);
  assert.equal(attempts, 2, 'null НЕ кэшируется — каждый запрос честно падает в старый probe-path');
});

test('sortModelByIndex: детерминированный tie-break url→balanser при равном index', () => {
  const online = [
    { name: 'B', url: 'http://a.skaz.tv/lite/y', index: 5, show: true, balanser: 'y', rch: false, voices: 0, seasons: 0 },
    { name: 'A', url: 'http://a.skaz.tv/lite/x', index: 5, show: true, balanser: 'x', rch: false, voices: 0, seasons: 0 }
  ];
  const sorted = sortModelByIndex(online);
  assert.deepEqual(sorted.map((o) => o.balanser), ['x', 'y'], 'тот же хост → по balanser');
});