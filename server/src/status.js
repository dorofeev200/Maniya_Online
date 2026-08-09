/**
 * Статус подписки Maniya Online — вычисление оставшихся дней и склонений.
 * Единый источник истины для сервера (`/api/lampa/subscription/check` → badge
 * «MOnlineStatus» в Lampa) и unit-тестов. Намеренно чистый модуль без I/O.
 *
 * Принцип расчёта дней: КАЛЕНДАРНЫЕ дни в UTC (не 24-часовые интервалы),
 * чтобы у пользователя не «висел» лишний час у полуночи и часовые пояса
 * не ломали результат. day number = floor(timestamp / 86400000) в UTC,
 * разница дней = календарная дата(истечения) − календарная дата(сейчас).
 */

export const DAY_MS = 86_400_000;

/** Календарный номер дня по UTC для timestamp (мс). */
export function utcDay(timestamp) {
  return Math.floor(timestamp / DAY_MS);
}

/**
 * Сколько календарных дней осталось до expiresAt (UTC-календарь) на момент now.
 * Возвращает целое (может быть <= 0, если срок истёк). expiresAt — ISO-строка
 * или Date; если отсутствует/невалиден → null (бессрочная подписка).
 */
export function remainingDays(expiresAt, now = new Date()) {
  if (expiresAt == null || expiresAt === '') return null;
  // Только строки ISO/Date — число 42 не должно превращаться в дату 1970-01-01.
  const raw = typeof expiresAt === 'string' ? expiresAt : expiresAt instanceof Date ? expiresAt : null;
  if (!raw) return null;
  const exp = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(exp.getTime())) return null;
  const n = now instanceof Date ? now : new Date(now);
  return utcDay(exp.getTime()) - utcDay(n.getTime());
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
export function subscriptionStatus({ active, expiresAt }, now = new Date()) {
  if (!active) return { label: 'Подписка истекла', days: null };
  const days = remainingDays(expiresAt, now);
  if (days === null) return { label: 'Подписка активна', days: null };
  if (days < 0) return { label: 'Подписка истекла', days };
  const label = days === 1
    ? 'Остался 1 день'
    : days === 0
      ? 'Остался 0 дней'
      : `Осталось ${days} ${pluralDays(days)}`;
  return { label, days };
}