/**
 * Статус подписки Maniya Online — вычисление оставшихся дней и склонений.
 * Единый источник истины для сервера (`/api/lampa/subscription/check` → badge
 * «MOnlineStatus» в Lampa) и unit-тестов. Намеренно чистый модуль без I/O.
 *
 * Принцип расчёта дней: КАЛЕНДАРНЫЕ дни (не 24-часовые интервалы) в часовом
 * поясе пользователя, чтобы у полуночи не «терялся» день и граница UTC не
 * сдвигала дату истечения для поясов, отличных от UTC.
 *
 * day number = floor((timestamp − offsetMinutes*60000) / 86400000), где
 * offsetMinutes — `Date.prototype.getTimezoneOffset()` клиента (UTC − local).
 * По умолчанию offset 0 → UTC-календарь (обратная совместимость для вызовов
 * без tz). Разница дней = календарная дата(истечения) − календарная дата(сейчас).
 */

export const DAY_MS = 86_400_000;

/** Календарный номер дня для timestamp (мс) в поясе offsetMinutes ({getTimezoneOffset}-стиль). */
export function utcDay(timestamp, offsetMinutes = 0) {
  return Math.floor((timestamp - offsetMinutes * 60000) / DAY_MS);
}

/**
 * Сколько календарных дней осталось до expiresAt на момент now в поясе
 * options.offsetMinutes (минуты `getTimezoneOffset`, по умолчанию UTC).
 * Возвращает целое (может быть <= 0, если срок истёк). expiresAt — ISO-строка
 * или Date; если отсутствует/невалиден → null (бессрочная подписка).
 */
export function remainingDays(expiresAt, now = new Date(), options = {}) {
  if (expiresAt == null || expiresAt === '') return null;
  // Только строки ISO/Date — число 42 не должно превращаться в дату 1970-01-01.
  const raw = typeof expiresAt === 'string' ? expiresAt : expiresAt instanceof Date ? expiresAt : null;
  if (!raw) return null;
  const exp = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(exp.getTime())) return null;
  const n = now instanceof Date ? now : new Date(now);
  const offset = Number.isInteger(options.offsetMinutes) ? options.offsetMinutes : 0;
  return utcDay(exp.getTime(), offset) - utcDay(n.getTime(), offset);
}

/**
 * Русское склонение слова «день» для числа n (как в задании):
 * 1/21/31 → «день», 2–4/22–24 → «дня», 0/5–20/25+ → «дней».
 */
export function pluralDays(n) {
  const abs = Math.abs(Number(n) || 0);
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 19) return 'дней';
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дня';
  return 'дней';
}

/**
 * Готовая строка статуса для UI badge.
 * - active=false             → «Подписка истекла» (в т.ч. expired по дате).
 * - expiresAt === null       → «Подписка активна» (бессрочно) — дней нет.
 * - days === 1               → «Остался 1 день» (род. падеж глагола).
 * - days > 1                 → «Осталось N день/дня/дней».
 * - days === 0               → «Осталось 0 дней» (активна сегодня).
 * - invalid/отсутствует дата → label по active без дней (без «undefined/NaN»).
 */
export function subscriptionStatus({ active, expiresAt, offsetMinutes }, now = new Date()) {
  if (!active) return { label: 'Подписка истекла', days: null };
  const days = remainingDays(expiresAt, now, { offsetMinutes });
  if (days === null) return { label: 'Подписка активна', days: null };
  if (days < 0) return { label: 'Подписка истекла', days };
  const label = days === 1
    ? 'Остался 1 день'
    : days === 0
      ? 'Остался 0 дней'
      : `Осталось ${days} ${pluralDays(days)}`;
  return { label, days };
}