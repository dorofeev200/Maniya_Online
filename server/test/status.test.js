import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { remainingDays, pluralDays, subscriptionStatus } from '../src/status.js';

// Фиксированное «сейчас» (UTC) — чтобы тесты не зависели от времени запуска.
const NOW = new Date('2026-08-09T10:00:00Z');

describe('remainingDays (календарный UTC-счёт)', () => {
  it('осталось 75 дней', () => {
    assert.equal(remainingDays('2026-10-23T00:00:00Z', NOW), 75);
  });
  it('осталось 30 дней', () => {
    assert.equal(remainingDays('2026-09-08T00:00:00Z', NOW), 30);
  });
  it('5, 4, 3, 2 дня', () => {
    assert.equal(remainingDays('2026-08-14T00:00:00Z', NOW), 5);
    assert.equal(remainingDays('2026-08-13T23:00:00Z', NOW), 4);
    assert.equal(remainingDays('2026-08-12T00:00:00Z', NOW), 3);
    assert.equal(remainingDays('2026-08-11T23:59:59Z', NOW), 2);
  });
  it('1 день', () => {
    assert.equal(remainingDays('2026-08-10T00:30:00Z', NOW), 1);
  });
  it('0 дней (активна сегодня, меньше суток до конца)', () => {
    assert.equal(remainingDays('2026-08-09T23:30:00Z', NOW), 0);
    assert.equal(remainingDays('2026-08-09T00:00:00Z', NOW), 0);
  });
  it('истекла (прошлый день → отрицательно)', () => {
    assert.equal(remainingDays('2026-08-08T23:59:59Z', NOW), -1);
    assert.equal(remainingDays('2026-07-01T00:00:00Z', NOW), -39);
  });
  it('время суток не влияет на день (тот же календарный день)', () => {
    // Полночь/поздний вечер в ОДНОМ календарном дне -> 0, не 1 и не -1.
    assert.equal(remainingDays('2026-08-09T00:00:01Z', NOW), 0);
    assert.equal(remainingDays('2026-08-09T23:59:59Z', NOW), 0);
  });
  it('missing expiration → null (бессрочная)', () => {
    assert.equal(remainingDays(null, NOW), null);
    assert.equal(remainingDays(undefined, NOW), null);
    assert.equal(remainingDays('', NOW), null);
  });
  it('invalid expiration → null (без NaN)', () => {
    assert.equal(remainingDays('not-a-date', NOW), null);
    assert.equal(remainingDays('', NOW), null);
    assert.equal(remainingDays(42, NOW), null);
  });
});

describe('pluralDays (склонение)', () => {
  it('1, 21, 31 → «день»', () => {
    assert.equal(pluralDays(1), 'день');
    assert.equal(pluralDays(21), 'день');
    assert.equal(pluralDays(31), 'день');
  });
  it('2, 3, 4, 22, 24 → «дня»', () => {
    assert.equal(pluralDays(2), 'дня');
    assert.equal(pluralDays(3), 'дня');
    assert.equal(pluralDays(4), 'дня');
    assert.equal(pluralDays(22), 'дня');
    assert.equal(pluralDays(24), 'дня');
  });
  it('5, 10, 11, 12, 25, 30, 75 → «дней»', () => {
    assert.equal(pluralDays(5), 'дней');
    assert.equal(pluralDays(10), 'дней');
    assert.equal(pluralDays(11), 'дней');
    assert.equal(pluralDays(12), 'дней');
    assert.equal(pluralDays(25), 'дней');
    assert.equal(pluralDays(30), 'дней');
    assert.equal(pluralDays(75), 'дней');
  });
  it('0 → «дней»', () => {
    assert.equal(pluralDays(0), 'дней');
  });
});

describe('subscriptionStatus (состояния UI)', () => {
  it('active + 75 дней → «Осталось 75 дней»', () => {
    const s = subscriptionStatus({ active: true, expiresAt: '2026-10-23T00:00:00Z' }, NOW);
    assert.equal(s.label, 'Осталось 75 дней');
    assert.equal(s.days, 75);
  });
  it('1 день → «Остался 1 день»', () => {
    const s = subscriptionStatus({ active: true, expiresAt: '2026-08-10T00:00:00Z' }, NOW);
    assert.equal(s.label, 'Остался 1 день');
    assert.equal(s.days, 1);
  });
  it('0 дней → «Остался 0 дней»', () => {
    const s = subscriptionStatus({ active: true, expiresAt: '2026-08-09T12:00:00Z' }, NOW);
    assert.equal(s.label, 'Остался 0 дней');
    assert.equal(s.days, 0);
  });
  it('бессрочная (expiresAt null) → «Подписка активна», days null', () => {
    const s = subscriptionStatus({ active: true, expiresAt: null }, NOW);
    assert.equal(s.label, 'Подписка активна');
    assert.equal(s.days, null);
  });
  it('истекла → «Подписка истекла»', () => {
    const s = subscriptionStatus({ active: true, expiresAt: '2026-08-01T00:00:00Z' }, NOW);
    assert.equal(s.label, 'Подписка истекла');
    assert.ok(s.days < 0);
  });
  it('неактивная → «Подписка истекла» даже с будущей датой', () => {
    const s = subscriptionStatus({ active: false, expiresAt: '2099-01-01T00:00:00Z' }, NOW);
    assert.equal(s.label, 'Подписка истекла');
    assert.equal(s.days, null);
  });
  it('invalid expiration + active → «Подписка активна» (без NaN/undefined)', () => {
    const s = subscriptionStatus({ active: true, expiresAt: 'bogus' }, NOW);
    assert.equal(s.label, 'Подписка активна');
    assert.equal(s.days, null);
  });
  it('missing subscription (active:undefined) → «Подписка истекла»', () => {
    const s = subscriptionStatus({}, NOW);
    assert.equal(s.label, 'Подписка истекла');
    assert.equal(s.days, null);
  });
});