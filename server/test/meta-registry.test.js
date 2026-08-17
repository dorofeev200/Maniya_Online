import test from 'node:test';
import assert from 'node:assert/strict';

import { PROVIDER_FALLBACK_ICON, PROVIDER_META, providerMeta } from '../src/providers/meta.js';

/**
 * Единый мета-реестр источников (ВИЗУАЛЬНЫЕ ЗНАЧКИ): одно место, где определяется
 * Display Name / Icon / Quality Label провайдера для UI. Реестр НЕ влияет на
 * бизнес-логику провайдеров и НЕ хранит эмодзи в source.id/name.
 */
test('meta: у каждого реального источника есть name + icon (не пустые)', () => {
  assert.ok(Object.keys(PROVIDER_META).length >= 20, 'реестр не пуст');

  for (const [slug, meta] of Object.entries(PROVIDER_META)) {
    assert.ok(String(meta.name || '').trim(), `[${slug}] name не пуст`);
    assert.ok(String(meta.icon || '').trim(), `[${slug}] icon не пуст`);
    assert.match(meta.name, /^[A-Za-z0-9(\)\-'"·\s+.]+$/, `[${slug}] name чистый текст (без эмодзи)`);
  }
});

test('meta: иконка — НЕ часть slug/id, отображаемое имя отдельно', () => {
  // Требование: «иконка ПЕРЕД названием, но НЕ вносить эмодзи в source.id/name».
  // Слаг источника остаётся чистым — эмодзи живёт только в поле icon реестра.
  const alloha = providerMeta('alloha');
  assert.equal(alloha.icon, '🎬');
  assert.equal(alloha.name, 'Allo-XA');
  assert.equal(alloha.qualityLabel, '4K');
});

test('meta: providerMeta принимает префиксные id (skaz-*/eo-*) и сдвигает регистр', () => {
  assert.equal(providerMeta('skaz-alloha'), providerMeta('alloha'));
  assert.equal(providerMeta('eo-REZKA'), providerMeta('rezka'));
  // Просто префиксы — служебные; без префикса тоже.
  assert.equal(providerMeta('videoseed').name, 'VideoS');
  assert.ok(providerMeta('alloha').qualityLabel);
});

test('meta: неизвестный id → null; fallback-иконка отдельной константой', () => {
  assert.equal(providerMeta('nonsense'), null);
  assert.equal(providerMeta(''), null);
  assert.equal(providerMeta(null), null);
  assert.equal(PROVIDER_FALLBACK_ICON, '🎬');
});

test('meta: покрытие — все slags, которые реально видит/породит провайдер', () => {
  // Слаги из SKAZ_BALANCERS + нативные id провайдеров (registry.js). Если какой-то
  // источник включён в /sources без меты — клиент получит fallback 🎬. Это ок, но
  // тест фиксирует, что основные рынки всё же описаны.
  const expected = [
    'alloha', 'videoseed', 'kinopub', 'kinoflix', 'veoveo', 'pidtor', 'solntse',
    'filmix', 'filmixtv', 'rezka', 'hdvb', 'rutubemovie', 'kodik', 'zagonka',
    'geosaitebi', 'videohub',
    'cdnvideohub', 'collaps', 'kinoteatrkg', 'vkmovie',
    'xvideocdn', 'vk', 'rutube', 'kinobase', 'turboserial', 'fancdn', 'mirage',
    'fanserials', 'mirkino', 'hdrezka', 'aniliberty', 'animebesst', 'animelib'
  ];
  const missing = expected.filter((slug) => !providerMeta(slug));
  assert.deepEqual(missing, [], `слаги без меты: ${missing.join(', ')}`);
});