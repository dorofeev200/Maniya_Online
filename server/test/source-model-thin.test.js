// SKAZ-MANIYA-052: thin-флаг в per-title модели. Env ставится ДО динамического
// import (config.js читает process.env при импорте). Off → ни у одной строки нет
// ключа `thin` (PROD-байт-в-байт); on + allowlist → thin:true только у skaz-строк
// слаг-балансера из SCOPE; native-строки тонкого поля НЕ получают.
process.env.SKAZ_THIN_ENABLED = '1';
process.env.SKAZ_THIN_MODULES = 'alloha,lordfilm';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { buildModel } = await import('../src/sources/sourceModel.js');
const { config } = await import('../src/config.js');

// Синтетический online[] (не зависим от живых фикстур): alloha/lordfilm/kinopub →
// skaz-близнецы (natives без них), filmix → native (ID = 'filmix').
const ONLINE = [
  { balanser: 'alloha', name: 'Alloha', url: 'http://online3.skaz.tv/lite/alloha', index: 1, show: true, rch: false, voices: 2, seasons: 0 },
  { balanser: 'lordfilm', name: 'LordFilm', url: 'http://online3.skaz.tv/lite/lordfilm', index: 2, show: true, rch: false, voices: 0, seasons: 0 },
  { balanser: 'kinopub', name: 'KinoPub', url: 'http://online8.skaz.tv/lite/kinopub', index: 3, show: true, rch: false, voices: 0, seasons: 0 },
  { balanser: 'filmix', name: 'Filmix ~ 4K', url: 'http://online3.skaz.tv/lite/filmix', index: 4, show: true, rch: false, voices: 0, seasons: 0 }
];
const SNAPSHOT = { natives: [{ id: 'filmix' }], visibleSkaz: [], nativeIdSet: new Set(['filmix']) };
const row = (model, id) => model.find((i) => i.id === id);

describe('buildModel: thin-флаг', () => {
  it('on + allowlist → thin:true у skaz-alloha/lordfilm, thin:false у skaz-kinopub, native без поля', () => {
    const model = buildModel(ONLINE, SNAPSHOT);

    const alloha = row(model, 'skaz-alloha');
    assert.ok(alloha, 'skaz-alloha есть (alloha не native в этом снимке)');
    assert.equal(alloha.thin, true, 'в allowlist → thin:true');

    const lordfilm = row(model, 'skaz-lordfilm');
    assert.equal(lordfilm.thin, true, 'в allowlist → thin:true');

    const kinopub = row(model, 'skaz-kinopub');
    assert.equal(kinopub.thin, false, 'вне allowlist → thin:false (поле ЕСТЬ, но ложно)');

    const filmix = row(model, 'filmix');
    assert.equal(filmix.thin, undefined, 'native-строка тонкого поля НЕ получает');
  });

  it('off → ни у одной строки нет ключа thin (PROD-байт)', () => {
    config.skaz.thin.enabled = false;
    try {
      const model = buildModel(ONLINE, SNAPSHOT);
      assert.ok(model.length > 0);
      for (const item of model) {
        assert.ok(!Object.prototype.hasOwnProperty.call(item, 'thin'), `${item.id}: ключ thin отсутствует при off`);
      }
    } finally {
      config.skaz.thin.enabled = true;
    }
  });
});