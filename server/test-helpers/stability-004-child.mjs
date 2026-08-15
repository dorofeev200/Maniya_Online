// STABILITY-004 process-level child (NEW code): поздний reject probe-промиса после
// исчерпания card-дедлайна НЕ должен стать unhandledRejection и НЕ должен уронить
// процесс. Репродукция live-кейса journald 17:34:25 (HttpError: Collaps HTTP 422).
//
// Сценарий: attempt() уже вернул deadline-reject (дедлайн в прошлом), а под ним
// (probe.present → recordByKeys) работает async-функция, которая завершится HttpError
// 422 ПОЗЖЕ. С фиксом (promise.catch(() => {}) в attempt) поздний reject поглощается
// → orphans=0 → exit 0. Без фикса — orphan → exit 1.
import { nativeProbe } from '../src/availability.js';

let orphans = 0;
process.on('unhandledRejection', (reason) => {
  orphans += 1;
  process.stderr.write(`ORPHAN:${reason && reason.message}\n`);
});

// Collaps-стаб: recordByKeys работает ~150мс и завершается HttpError 422
// (реальный live-кейс: host-block от embed-хоста при исчерпанном дедлайне).
const probe = {
  id: 'collaps',
  recordByKeys: () => new Promise((_, reject) => {
    setTimeout(() => reject(Object.assign(new Error('Collaps HTTP 422'), { statusCode: 422 })), 150);
  }),
  client: { search: async () => [] }
};

// Дедлайн уже в прошлом → attempt уходит в ветку remaining<=0 (deadline-reject).
const deadline = Date.now() - 1;
const v = await nativeProbe(probe, { imdb_id: 'tt0109830' }, {}, deadline);
process.stdout.write(`RESULT:${v.reason}:show=${v.show}:inconclusive=${Boolean(v.inconclusive)}\n`);
// Даём позднему reject (150мс) шанс сработать ДО выхода.
await new Promise((resolve) => setTimeout(resolve, 400));
process.stdout.write(`ORPHANS:${orphans}\n`);
process.exit(orphans ? 1 : 0);
