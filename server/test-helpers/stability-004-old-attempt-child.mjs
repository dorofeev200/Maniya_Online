// STABILITY-004 negative-control child (OLD attempt, без catch): тот же сценарий,
// но attempt возвращает deadline-reject БЕЗ rejection-consumer для уже запущенного
// promise → поздний reject = unhandledRejection = orphan (детектируется счётчиком).
//
// Доказывает, что процесс-level тест ДЕЙСТВИТЕЛЬНО ловит регрессию: старый паттерн
// даёт orphans=1 → exit 1. Используется только для верификации harness'а (сам фикс
// проверяется stability-004-child.mjs против РЕАЛЬНОГО nativeProbe).
let orphans = 0;
process.on('unhandledRejection', (reason) => {
  orphans += 1;
  process.stderr.write(`ORPHAN:${reason && reason.message}\n`);
});

const probe = {
  id: 'collaps',
  recordByKeys: () => new Promise((_, reject) => {
    setTimeout(() => reject(Object.assign(new Error('Collaps HTTP 422'), { statusCode: 422 })), 150);
  }),
  client: { search: async () => [] }
};

// Имитация СТАРОГО attempt (до фикса): при remaining<=0 — deadline-reject БЕЗ
// promise.catch. Тот самый код, что крашил прод.
function oldAttempt(promise, deadline, label) {
  const remaining = Math.max(0, deadline - Date.now());
  if (remaining <= 0) return Promise.reject(new Error(`${label} deadline`));
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timeout`)), remaining);
  });
  return Promise.race([promise, timeout]);
}

// Жизненный цикл как в nativeProbe: promise создан (уже работает), передан в attempt.
const presentPromise = probe.recordByKeys();
const verdict = await oldAttempt(presentPromise, Date.now() - 1, 'native:collaps')
  .catch(() => ({ reason: 'deadline' }));
process.stdout.write(`RESULT:${verdict.reason}\n`);
// Даём позднему reject (150мс) сработать.
await new Promise((resolve) => setTimeout(resolve, 400));
process.stdout.write(`ORPHANS:${orphans}\n`);
process.exit(orphans ? 1 : 0);
