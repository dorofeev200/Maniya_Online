// SKAZ-MANIYA-009 P6: БАЛАНСЕР LATENCY PARITY — DETERMINISTIC MODEL (RESEARCH ONLY, КОД НЕ МЕНЯЕТСЯ).
//
// Сравниваем два правила выбора хоста skaz-кластера:
//   SKAZ   : ms <= fastest*1.6 + 150  → latency-пул: все хосты, чья латентность укладывается
//            в порог от самого быстрого, кандидаты; из них выбирается… (см. модель ниже).
//            Константа из TASK-008 §4 (reported поведение кластера Skaz).
//   MANIYA : orderedSkazHosts (primary→online8-резерв последним) + пин карточки +
//            сканирующий _scanLite: 503/EMPTY/timeout → следующая нода; первый content → СТОП;
//            EMPTY только когда ВСЕ ноды content-«нет».
//
// Вход: латентность dt(h) каждого хоста и его состояние s(h) ∈ {ok, timeout, 503, empty}.
// Выход: выбор каждого правила + доступность/лаг в ответе.
//
// Запуск: node scripts/_t009_balancer_parity.mjs

function skazSelection(hosts) {
  // hosts: [{h, dt, ok}] — только «живые» (не timeout/503) попадают в latency-пул? Моделируем
  // оба чтения. Классическое lampac-правило: мерить latency всех, отсечь timeout/недоступные,
  // затем пул = те, у кого dt <= fastest*1.6+150; выбрать ЛУЧШИЙ по качеству/надёжности/лаг.
  const alive = hosts.filter((x) => x.state === 'ok');
  if (alive.length === 0) return { choice: null, reason: 'no-alive', pool: [] };
  const fastest = Math.min(...alive.map((x) => x.dt));
  const threshold = fastest * 1.6 + 150;
  const pool = alive.filter((x) => x.dt <= threshold);
  const chosen = pool.reduce((a, b) => (b.dt < a.dt ? b : a)); // внутри пула берём самый быстрый
  return { choice: chosen.h, dt: chosen.dt, fastest, threshold, pool: pool.map((p) => p.h), reason: 'latency-pool' };
}

function maniyaSelection(hosts, pinned) {
  // Порядок: primary в конфиг-порядке, online8 — последний. Старт с пина (если в пуле) —
  // карточка «зарядила» этот хост контентом. Скан: первый content → выбор; 503/empty/timeout
  // → следующая; EMPTY только когда все «нет контента».
  const order = [...hosts.filter((x) => !String(x.h).includes('online8')), ...hosts.filter((x) => String(x.h).includes('online8'))];
  let start = 0;
  if (pinned) {
    const i = order.findIndex((x) => x.h === pinned);
    if (i !== -1) start = i;
  }
  for (let s = 0; s < order.length; s++) {
    const x = order[(start + s) % order.length];
    if (x.state === 'ok') return { choice: x.h, dt: x.dt, order: order.map((o) => o.h), scanned: s + 1, reason: 'first-content' };
    // timeout/503/empty → следующая нода
  }
  return { choice: null, reason: 'all-empty', order: order.map((o) => o.h) };
}

function fmt(s) { return s === 'ok' ? 'ok' : (s === 'timeout' ? 'TIMEOUT' : (s === '503' ? '503' : 'empty')); }

function runSet(label, hosts, pinned) {
  console.log(`\n=== ${label} ===`);
  console.log('  hosts: ' + hosts.map((h) => `${h.h}(${h.dt}ms,${fmt(h.state)})`).join('  '));
  const sk = skazSelection(hosts);
  const mk = maniyaSelection(hosts, pinned);
  const same = (sk.choice === null && mk.choice === null) || (sk.choice && mk.choice && sk.choice === mk.choice);
  console.log(`  SKAZ  : ${sk.choice ? `${sk.choice} (dt ${sk.dt}ms)` : 'НЕТ (fastest=' + (sk.fastest ?? '-') + ')'}  pool=${JSON.stringify(sk.pool)}`);
  console.log(`  MANIYA: ${mk.choice ? `${mk.choice} (dt ${mk.dt}ms)` : 'НЕТ'}  order=${JSON.stringify(mk.order)} pinned=${pinned ?? '-'}`);
  console.log(`  → ${same ? 'SAME HOST' : 'DIFFERENT HOST'}`);
  return { sk, mk, same };
}

console.log('# SKAZ-MANIYA-009 P6 — БАЛАНСЕР LATENCY PARITY (DETERMINISTIC MODEL)\n');

// --- Набор 1: A=50 B=70 C=100 D=500 ---
// Все живы. fastest=50, threshold=50*1.6+150=230. Пул={A,B,C}. D(500)>230 вне пула. Skaz→A.
// Maniya: порядок A,B,C,D; первый ok=A → A.
runSet('NABOR1: A=50 B=70 C=100 D=500 (все ok)', [
  { h: 'A', dt: 50, state: 'ok' }, { h: 'B', dt: 70, state: 'ok' },
  { h: 'C', dt: 100, state: 'ok' }, { h: 'D', dt: 500, state: 'ok' },
], undefined);

// --- Набор 2: A=50 B=120 C=250 D=500 ---
// threshold=50*1.6+150=230 → пул={A,B}; C(250)/D(500) вне. Skaz→A. Maniya→A.
runSet('NABOR2: A=50 B=120 C=250 D=500 (все ok)', [
  { h: 'A', dt: 50, state: 'ok' }, { h: 'B', dt: 120, state: 'ok' },
  { h: 'C', dt: 250, state: 'ok' }, { h: 'D', dt: 500, state: 'ok' },
], undefined);

// --- Набор 3: A=100 B=160 C=170 D=600 ---
// threshold=100*1.6+150=310 → пул={A,B,C}; D вне. Skaz→A. Maniya→A.
runSet('NABOR3: A=100 B=160 C=170 D=600 (все ok)', [
  { h: 'A', dt: 100, state: 'ok' }, { h: 'B', dt: 160, state: 'ok' },
  { h: 'C', dt: 170, state: 'ok' }, { h: 'D', dt: 600, state: 'ok' },
], undefined);

// --- FAULT: A=timeout B=503 C=200 D=200 ---
// Skaz: alive={C,D}, fastest=200, threshold=200*1.6+150=470, пул={C,D}, выбор C(dt200). C=fastest.
// Maniya: A timeout→skip, B 503→skip, C ok→C. Оба C.
runSet('FAULT1: A=TIMEOUT B=503 C=200 D=200', [
  { h: 'A', dt: 1, state: 'timeout' }, { h: 'B', dt: 1, state: '503' },
  { h: 'C', dt: 200, state: 'ok' }, { h: 'D', dt: 200, state: 'ok' },
], undefined);

// --- FAULT/pin: A=timeout B=503 C=200 D=200, card пин на B (быстрый по таблице, но 503) ---
// Maniya стартует с пина B → 503 → следующая C → C. Skaz: B мёртв, C. Оба C.
runSet('FAULT2: A=TIMEOUT B=503 C=200 D=200, пин=B (503)', [
  { h: 'A', dt: 1, state: 'timeout' }, { h: 'B', dt: 1, state: '503' },
  { h: 'C', dt: 200, state: 'ok' }, { h: 'D', dt: 200, state: 'ok' },
], 'B');

// --- Pin divergence: все ok, пин на D (500ms — карточка нашла контент на D) ---
// Skaz: latency-пул {A,B,C}, D(500) вне → Skaz→A. Maniya: пин D → start=D, D ok → D (500ms).
// РАЗНЫЕ ХОСТЫ. Real impact: host-bound? контент есть; лаг 500 vs 50.
runSet('PIN: A=50 B=70 C=100 D=500, пин=D (медленный, но карточка там нашла контент)', [
  { h: 'A', dt: 50, state: 'ok' }, { h: 'B', dt: 70, state: 'ok' },
  { h: 'C', dt: 100, state: 'ok' }, { h: 'D', dt: 500, state: 'ok' },
], 'D');

// --- Slow-content host: контент ТОЛЬКО на медленном D, A/B/C дают empty ---
// ВАЖНО про семантику: в Skaz latency-пул измеряет РДТ (задержку) ВСЕХ живых хостов и выбирает
// самый быстрый В ПУЛЕ — наличие контента неизвестно ДО выбора (это одно-shot, без скана).
// Поэтому «empty» для Skaz — это НЕ «не_живой» (в latency-пул он попадёт по РДТ), а результат,
// который откроется уже ПОСЛЕ выбора. Чтобы не смешивать, модель жёстко разводит два аспекта:
//   (1) latency-пул по РДТ — Skaz выберет A(50) (fastest, empty → у Skaz «фильм не найден»);
//       Maniya просканирует A→B→C (empty→skip) и найдёт D(500).
// Показываем ровно это расхождение: Skaz упирается в fastest-empty и НЕ находит контент,
// а Maniya (content-aware scan) находит.
runSet('CONTENT-ONLY-ON-SLOW: A=50(empty) B=70(empty) C=100(empty) D=500(ok — контент ТОЛЬКО на D) (семантика Skaz=latency-пул без скана контента)', [
  { h: 'A', dt: 50, state: 'empty' }, { h: 'B', dt: 70, state: 'empty' },
  { h: 'C', dt: 100, state: 'empty' }, { h: 'D', dt: 500, state: 'ok' },
], undefined);

// --- CONTENT-ONLY-ON-SLOW, честная модель Skaz (latency-pool по РДТ: живой = отвечает,
// empty тоже «живой» по РДТ, контент открывается после выбора) ---
console.log('\n=== CONTENT-ONLY-ON-SLOW (ЧЕСТНАЯ Skaz latency-pool + one-shot content) ===');
{
  const hosts = [
    { h: 'A', dt: 50, state: 'empty' }, { h: 'B', dt: 70, state: 'empty' },
    { h: 'C', dt: 100, state: 'empty' }, { h: 'D', dt: 500, state: 'ok' },
  ];
  const responders = hosts.filter((x) => x.state !== 'timeout' && x.state !== '503'); // живые по РДТ
  const fastest = Math.min(...responders.map((x) => x.dt));
  const threshold = fastest * 1.6 + 150;
  const pool = responders.filter((x) => x.dt <= threshold);
  const skPick = pool.reduce((a, b) => (b.dt < a.dt ? b : a)); // A(50), fastest
  console.log(`  SKAZ  : latency-пул по РДТ: pool=${JSON.stringify(pool.map((p) => p.h))} (threshold ${threshold}ms)`);
  console.log(`          выбор A(50ms) fastest, но A=EMPTY (контента нет) → Skaz one-shot «фильм не найден»`);
  console.log(`  MANIYA: сканирует A(empty)→B(empty)→C(empty)→D(ok 500ms) → находит D. РАЗНЫЙ РЕЗУЛЬТАТ ПО КОНТЕНТУ`);
  console.log('  → SKAZ НЕ находит контент (fastest-empty), MANIYA находит (content-aware scan).');
  console.log('  → ВЫВОД: латенси-пул Skaz проигрывает, когда контент живёт только на медленной ноде;');
  console.log('    Maniya лучше (сканирует контент). НО: Maniya платит +N запросов, Skaz честно быстрее при fastest-ok.');
}

// --- Online8 резерв: A=50(ok) B=70(ok) online8=20(ok, быстрейший но легаси) ---
// Skaz: fastest=20 (online8!), threshold=20*1.6+150=182, pool={all}, выбор online8 (dt20)!
// Maniya: online8 ПОСЛЕДНИЙ; A(50)→A.
runSet('RESERVE: A=50 B=70 online8=20 (все ok, online8 быстрейший легаси)', [
  { h: 'A', dt: 50, state: 'ok' }, { h: 'B', dt: 70, state: 'ok' },
  { h: 'online8', dt: 20, state: 'ok' },
], undefined);

console.log('\n# МОДЕЛЬ ГОТОВА — интерпретация в отчёте (18 SKAZ-MANIYA-TASK-009).');