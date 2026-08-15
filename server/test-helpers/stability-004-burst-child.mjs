// STABILITY-004 BURST child: воспроизведение production-краша в масштабе.
// Live-сценарий (journald 17:34:25): несколько параллельных карточек + короткий
// card-дедлайн; probe.present() (collaps embed → HttpError 422) завершается ПОСЛЕ
// исчерпания дедлайна; orphan-промис → unhandledRejection → краш процесса.
//
// Здесь: BURST_CARDS параллельных nativeProbe-вызовов с ИСТЕКШИМ дедлайном, каждый
// под ним — collaps-стаб, который отвергает ПОЗЖЕ (150-350мс, разброс как в проде).
// С фиксом (attempt.catch) все поздние rejection-ы поглощены → orphans=0 → exit 0.
// Каждый поздний reject-путь покрыт (422/403/timeout/ECONNRESET/plain).
// Импорт через env-путь, чтобы тот же сценарий прогнать против OLD и NEW копий
// availability.js (тест OLD-vs-NEW): IMPORT_SRC указывает на модуль.
const { nativeProbe } = await import(process.env.IMPORT_SRC || '../src/availability.js');

const CARDS = Number(process.env.BURST_CARDS || 20);
const DELAY = Number(process.env.BURST_DELAY_MS || 150);

let orphans = 0;
process.on('unhandledRejection', (reason) => {
  orphans += 1;
  process.stderr.write(`[UNHANDLED-REJECTION-${orphans}] ${reason && reason.message}\n`);
});

// Способы позднего reject — как в live-проде (Collaps embed 422/403/5xx/ECONNRESET/timeout).
const FAILURES = [
  () => Object.assign(new Error('Collaps HTTP 422'), { statusCode: 422 }),
  () => Object.assign(new Error('Collaps HTTP 403'), { statusCode: 403 }),
  () => Object.assign(new Error('Collaps HTTP 500'), { statusCode: 500 }),
  () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
  () => new Error('native:collaps timeout'),
  () => new Error('connect ECONNREFUSED 94.249.239.63:80'),
];

function lateProbe(failure, delayMs) {
  return {
    id: 'collaps',
    recordByKeys: () => new Promise((_, reject) => {
      setTimeout(() => reject(failure()), delayMs);
    }),
    client: { search: async () => ({ results: [] }) }
  };
}

// Все карточки — параллельно, дедлайн уже в прошлом (как после burst-перегрузки).
const deadline = Date.now() - 50;
const tasks = [];
for (let i = 0; i < CARDS; i += 1) {
  const failure = FAILURES[i % FAILURES.length];
  const delay = DELAY + ((i * 37) % 200); // разброс времени reject'а
  const probe = lateProbe(failure, delay);
  tasks.push(
    nativeProbe(probe, { imdb_id: 'tt0109830', title: 'Форрест Гамп', serial: 0 }, {}, deadline)
      .then((v) => `card${i}:${v.reason}`)
  );
}

const results = await Promise.all(tasks);
// Все вердикты — inconclusive (deadline), НЕ host-block: 422 пришёл после исчерпания.
const allInconclusive = results.every((r) => r.endsWith(':error'));
// Ждём, пока ВСЕ поздние rejection-ы успели сработать (максимальный delay + запас).
const maxDelay = DELAY + (((CARDS - 1) * 37) % 200);
await new Promise((resolve) => setTimeout(resolve, maxDelay + 300));

process.stdout.write(`CARDS:${CARDS} VERDICTS:${allInconclusive ? 'all-inconclusive' : 'MIXED'} ORPHANS:${orphans}\n`);
process.exit(orphans === 0 && allInconclusive ? 0 : 1);
