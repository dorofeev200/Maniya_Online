// STABILITY-004 — orphaned promise / process crash protection.
// Корень (docs/balancer-architecture-audit-001-report.md §12): attempt() в
// availability.js при remaining<=0 возвращал deadline-reject БЕЗ rejection-consumer
// для уже запущенного probe-промиса → его поздний reject (HttpError 422/403,
// timeout, ECONNRESET) = unhandledRejection → краш Node-процесса (live: journald
// 17:34:25, exit status=1, systemd restart). Фикс: promise.catch(() => {}) перед
// deadline-reject — вердикт availability НЕ меняется, гасится только «никому не
// нужный» поздний rejection.
// Env до динамического import (паттерн availability-hidden-twin.test.js).
process.env.NODE_ENV = 'test';
process.env.SKAZ_ENABLED = '1';
process.env.SKAZ_ACCOUNT_EMAIL = 'user@example.com';
process.env.SKAZ_UID = 'abc123';
process.env.SKAZ_BALANCERS = 'alloha,filmix,rezka';
process.env.SKAZ_HOSTS = 'http://h1,http://h2';
process.env.SKAZ_CHECK_TIMEOUT_MS = '200';
process.env.FILMIX_ENABLED = '0';
process.env.REZKA_ENABLED = '0';
process.env.KODIK_ENABLED = '0';
process.env.ALLOHA_ENABLED = '0';
process.env.RUTUBEMOVIE_ENABLED = '0';
process.env.CDNVIDEOHUB_ENABLED = '0';
process.env.COLLAPS_ENABLED = '0';
process.env.HDVB_ENABLED = '0';

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { nativeProbe } = await import('../src/availability.js');
const { HttpError } = await import('../src/errors.js');

// Счётчик сиротских rejection-ов В ЭТОМ процессе: с фиксом любой поздний reject
// под истёкшим дедлайном должен быть поглощён (attempt.catch), не став
// unhandledRejection. Тесты после окна позднего reject'а проверяют orphans===0.
let orphans = 0;
process.on('unhandledRejection', (reason) => {
  orphans += 1;
  process.stderr.write(`[UNHANDLED-REJECTION-${orphans}] ${reason && reason.message}\n`);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const EXPIRED_DEADLINE = () => Date.now() - 100; // уже в прошлом → attempt: remaining<=0
const FUTURE_DEADLINE = () => Date.now() + 10_000;

// Collaps-стаб: recordByKeys завершится заданным способом через delayMs.
// id:'collaps' — чтобы nativeProbe взял NATIVE_PROBES.collaps.present (вызовет
// provider.recordByKeys при cardKey).
function lateProbe({ rejectWith = null, resolveWith = null, delayMs = 120 } = {}) {
  return {
    id: 'collaps',
    recordByKeys: () => new Promise((resolve, reject) => {
      setTimeout(() => {
        if (rejectWith) reject(rejectWith);
        else resolve(resolveWith);
      }, delayMs);
    }),
    client: { search: async () => ({ results: [] }) }
  };
}

function collapsQuery() {
  return { imdb_id: 'tt0109830', title: 'Форрест Гамп', serial: 0 };
}

// ===== 1-6: поздние reject/resolve ПОСЛЕ исчерпания дедлайна → процесс НЕ падает,
//        вердикт НЕ меняется (deadline → inconclusive show). =====

test('STABILITY-004: promise reject после deadline → процесс НЕ падает (orphans=0), вердикт inconclusive', async () => {
  const probe = lateProbe({ rejectWith: new Error('late reject') });
  const v = await nativeProbe(probe, collapsQuery(), {}, EXPIRED_DEADLINE());
  assert.equal(v.show, true, 'deadline → inconclusive show (вердикт не меняется)');
  assert.equal(v.inconclusive, true);
  assert.equal(v.reason, 'error');
  await sleep(250); // окно позднего reject'а
  assert.equal(orphans, 0, 'поздний reject поглощён — unhandledRejection НЕ возник');
});

test('STABILITY-004: promise resolve после deadline → процесс НЕ падает (orphans=0), вердикт inconclusive', async () => {
  const probe = lateProbe({ resolveWith: { provider: 'collaps', type: 'movie' } });
  const v = await nativeProbe(probe, collapsQuery(), {}, EXPIRED_DEADLINE());
  assert.equal(v.show, true, 'deadline → inconclusive show');
  assert.equal(v.inconclusive, true);
  await sleep(250);
  assert.equal(orphans, 0, 'поздний resolve — не проблема, но и rejection-а нет');
});

test('STABILITY-004: HttpError 422 после deadline → процесс НЕ падает (orphans=0), вердикт inconclusive (НЕ host-block)', async () => {
  const probe = lateProbe({ rejectWith: new HttpError(422, 'collaps_http_error', 'Collaps HTTP 422') });
  const v = await nativeProbe(probe, collapsQuery(), {}, EXPIRED_DEADLINE());
  // Важно: 422 пришёл ПОСЛЕ deadline → attempt уже вернул deadline-reject → в catch
  // попал deadline, а НЕ HttpError → inconclusive (не authoritative host-block).
  assert.equal(v.show, true);
  assert.equal(v.inconclusive, true);
  assert.equal(v.reason, 'error');
  await sleep(250);
  assert.equal(orphans, 0, 'поздний HttpError 422 поглощён — процесса краш НЕТ');
});

test('STABILITY-004: HttpError 403 после deadline → процесс НЕ падает (orphans=0)', async () => {
  const probe = lateProbe({ rejectWith: new HttpError(403, 'collaps_forbidden', 'Collaps HTTP 403') });
  const v = await nativeProbe(probe, collapsQuery(), {}, EXPIRED_DEADLINE());
  assert.equal(v.show, true);
  assert.equal(v.inconclusive, true);
  await sleep(250);
  assert.equal(orphans, 0);
});

test('STABILITY-004: timeout после deadline → процесс НЕ падает (orphans=0)', async () => {
  const probe = lateProbe({ rejectWith: new Error('native:collaps timeout') });
  const v = await nativeProbe(probe, collapsQuery(), {}, EXPIRED_DEADLINE());
  assert.equal(v.show, true);
  assert.equal(v.inconclusive, true);
  await sleep(250);
  assert.equal(orphans, 0);
});

test('STABILITY-004: ECONNRESET после deadline → процесс НЕ падает (orphans=0)', async () => {
  const probe = lateProbe({ rejectWith: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });
  const v = await nativeProbe(probe, collapsQuery(), {}, EXPIRED_DEADLINE());
  assert.equal(v.show, true);
  assert.equal(v.inconclusive, true);
  await sleep(250);
  assert.equal(orphans, 0);
});

// ===== 7-8: НОРМАЛЬНЫЕ пробы — поведение/вердикт НЕ изменились. =====

test('STABILITY-004: normal successful probe → поведение не изменилось (show, found)', async () => {
  const probe = lateProbe({ resolveWith: { provider: 'collaps', type: 'movie' }, delayMs: 5 });
  const v = await nativeProbe(probe, collapsQuery(), {}, FUTURE_DEADLINE());
  assert.equal(v.show, true);
  assert.equal(v.authoritative, true);
  assert.equal(v.reason, 'found');
});

test('STABILITY-004: normal failed probe (пустой embed) → availability result не изменился (absent)', async () => {
  const probe = lateProbe({ resolveWith: null, delayMs: 5 });
  const v = await nativeProbe(probe, collapsQuery(), {}, FUTURE_DEADLINE());
  assert.equal(v.show, false);
  assert.equal(v.authoritative, true);
  assert.equal(v.reason, 'absent');
});

test('STABILITY-004: normal HttpError 422 (до deadline) → host-block сохраняется (GAP-002 не задет)', async () => {
  const probe = lateProbe({ rejectWith: new HttpError(422, 'collaps_http_error', 'Collaps HTTP 422'), delayMs: 5 });
  const v = await nativeProbe(probe, collapsQuery(), {}, FUTURE_DEADLINE());
  assert.equal(v.show, false);
  assert.equal(v.authoritative, true);
  assert.equal(v.reason, 'host-block');
  assert.equal(v.status, 422);
});

test('STABILITY-004: normal timeout по дедлайну (remaining>0 → race) → inconclusive, orphan НЕ возник', async () => {
  const probe = lateProbe({ resolveWith: { provider: 'collaps' }, delayMs: 500 });
  const v = await nativeProbe(probe, collapsQuery(), {}, Date.now() + 40); // remaining=40ms
  assert.equal(v.show, true);
  assert.equal(v.inconclusive, true);
  await sleep(600); // ждём поздний resolve (500ms) — race уже отработал, reject'а нет
  assert.equal(orphans, 0);
});

// ===== PROCESS-LEVEL: отдельный Node-процесс воспроизводит orphan-сценарий. =====
// NEW code (stability-004-child.mjs): поздний reject после deadline → exit 0,
// ORPHANS:0, RESULT:error:show=true. Это доказывает отсутствие unhandledRejection
// на УРОВНЕ ПРОЦЕССА, а не только unit-вызов catch.
function runChild(relativePath) {
  // Дочерние сценарии лежат в server/test-helpers/ (вне test/ — иначе node --test
  // выполнял бы их как тесты, а negative-control намеренно выходит с кодом 1).
  const childPath = fileURLToPath(new URL(`../test-helpers/${relativePath}`, import.meta.url));
  const result = spawnSync(process.execPath, [childPath], {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NODE_ENV: 'test' }
  });
  return result;
}

test('STABILITY-004 (process-level): NEW code — поздний reject после deadline → процесс выходит 0, ORPHANS:0', () => {
  const r = runChild('stability-004-child.mjs');
  assert.equal(r.status, 0, `процесс должен завершиться штатно (не crash), stderr=${r.stderr}`);
  assert.ok(r.stdout.includes('RESULT:error:show=true'), `вердикт не изменился: ${r.stdout}`);
  assert.ok(r.stdout.includes('ORPHANS:0'), `unhandledRejection не возник: ${r.stdout}`);
});

test('STABILITY-004 (process-level, negative control): OLD attempt без catch → orphan ДЕТЕКТИРУЕТСЯ (exit 1)', () => {
  const r = runChild('stability-004-old-attempt-child.mjs');
  assert.equal(r.status, 1, `старый паттерн даёт orphan → exit 1 (harness ловит регрессию), stdout=${r.stdout}`);
  assert.ok(r.stderr.includes('ORPHAN:'), `harness обязан зафиксировать unhandledRejection: ${r.stderr}`);
  assert.ok(r.stdout.includes('ORPHANS:1'), `счётчик orphan=1: ${r.stdout}`);
});
