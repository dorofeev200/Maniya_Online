/**
 * BALANCER-SEMANTICS-005-W1 — единый порядок хостов skaz-кластера.
 *
 * Раньше карточка (availability.probe) переупорядочивала пул (`reorderHosts`,
 * online8 ПОСЛЕДНИЙ), а SkazClient получал сырой `config.skaz.hosts`
 * (online8 ВТОРОЙ) → один источник обходил ноды в РАЗНОМ порядке в карточке
 * и в /videos (CLUSTER-MISMATCH, доказанный FP Паразиты/kinopub).
 *
 * Это нейтральный модуль (БЕЗ импортов) — один источник правды для ОБОИХ
 * концов: `createAvailabilityChecker` и конструктор `SkazClient`. `config.skaz.hosts`
 * не меняется — порядок применяется при конструировании.
 *
 * Online8 = легаси-резервная нода (ONLINE8-001/002): для не-kinopub её быстрый
 * 403 `disable`/503 — политика «модуль выключен», а не «контента нет» → всегда
 * в КОНЕЦ пула (последний кандидат обхода).
 */
export function isReserveHost(host) {
  return String(host || '').includes('online8');
}

/** Упорядочить пул: primary (не-online8) первыми, online8-резерв последним. */
export function orderedSkazHosts(hosts) {
  const primary = [];
  const reserve = [];
  for (const host of hosts) {
    (isReserveHost(host) ? reserve : primary).push(host);
  }
  return [...primary, ...reserve];
}
