/**
 * ЕДИНЫЙ МЕТА-РЕЕСТР ИСТОЧНИКОВ (presentation layer).
 *
 * Один источник истины для отображения источника в любом UI-компоненте:
 *
 *   provider/source slug → display name → icon → quality label
 *
 * Реестр — ТОЛЬКО метаданные (отрисовка/подписи). Он НЕ влияет на логику
 * провайдеров (поиск/нормализация/стримы) и НЕ хранит эмодзи внутри имён
 * провайдеров: ion иконка отделяется от source.id (slug остаётся чистым,
 * например `alloha`), отображаемое имя — отдельное поле `name`.
 *
 * Карта слагов — из исходного E-Online-плагина (AUDIT 2026-08-09,
 * E-ONLINE-REPORT §10.1): realные имена балансеров кластера Lampac.
 * Иконки — СВОИ для Maniya (не копия E-Online).
 */

export const PROVIDER_META = {
  // ── E-Online слаги (skaz-кластер / Lampac) ──────────────────────────────
  alloha: { name: 'Allo-XA', icon: '🎬', qualityLabel: '4K' },
  filmix: { name: 'Filmix', icon: '🔥', qualityLabel: '2160p' },
  kodik: { name: 'Kodik', icon: '🔗', qualityLabel: '1080p' },
  rezka: { name: 'For Serial', icon: '😉', qualityLabel: 'Full HD' },
  videoseed: { name: 'VideoS', icon: '💠', qualityLabel: 'Full HD' },
  hdvb: { name: 'XDVB', icon: '📼', qualityLabel: '4K' },
  veoveo: { name: 'Ozvuchky', icon: '🎧', qualityLabel: 'Full HD' },
  kinopub: { name: 'Lime', icon: '🌐', qualityLabel: '4K' },
  kinoflix: { name: 'KinoFlix', icon: '🎥', qualityLabel: '4K' },
  pidtor: { name: 'PidTor', icon: '🌀', qualityLabel: '4K' },
  solntse: { name: 'Solntse', icon: '☀️', qualityLabel: '4K' },
  zagonka: { name: "GET's TV", icon: '📡', qualityLabel: 'Full HD' },
  geosaitebi: { name: 'GeoVideo', icon: '🌍', qualityLabel: 'Full HD' },
  videohub: { name: 'VideoH', icon: '🗿', qualityLabel: '4K' },
  // Зарезервированные/блокированные слаги (§10.1): мета готово, источник может
  // появиться позже (rch/аккаунтные). Не видимые — потому что их нет в balancers.
  xvideocdn: { name: 'VCDN', icon: '⚡', qualityLabel: '4K' },
  vk: { name: 'RUS-1', icon: '🇷🇺', qualityLabel: 'Full HD' },
  rutube: { name: 'RUS-2', icon: '🇷🇺', qualityLabel: 'HD' },
  kinobase: { name: 'Kino', icon: '🍿', qualityLabel: '4K' },
  turboserial: { name: 'Dragon', icon: '🐉', qualityLabel: 'Full HD' },
  fancdn: { name: 'FCD', icon: '💾', qualityLabel: 'Full HD' },
  mirage: { name: 'Mirror', icon: '🎦', qualityLabel: 'Full HD' },
  fanserials: { name: 'FANS', icon: '😈', qualityLabel: 'Full HD' },
  mirkino: { name: 'KinoPUB', icon: '📀', qualityLabel: 'Full HD' },
  hdrezka: { name: 'HDRezka', icon: '🎞️', qualityLabel: '4K' },
  aniliberty: { name: 'AniLiberty', icon: '🌸', qualityLabel: 'Full HD' },
  // BALANCER-002: rhsprem — видимый источник (live probe: data-json=true, REST).
  rhsprem: { name: 'HDRezka 4K', icon: '🎞️', qualityLabel: '4K' },
  // BALANCER-002 rch-резерв (WebSocket-only, Maniya REST не играет; §10.5):
  // ashdi/kinoukr/eneyida — мета готово, в balancers НЕ входят (не светятся).
  ashdi: { name: 'Ashdi', icon: '⚡', qualityLabel: '4K' },
  kinoukr: { name: 'KinoUkr', icon: '🎬', qualityLabel: 'Full HD' },
  eneyida: { name: 'Eneyida', icon: '🛡️', qualityLabel: 'Full HD' },
  animebesst: { name: 'AniBest', icon: '🌸', qualityLabel: 'Full HD' },
  animelib: { name: 'AniTrue', icon: '🌸', qualityLabel: 'Full HD' },

  // ── Native-провайдеры Maniya (свои id) ──────────────────────────────────
  rutubemovie: { name: 'Rutube', icon: '📹', qualityLabel: 'HD' },
  cdnvideohub: { name: 'CDNVideo', icon: '☁️', qualityLabel: '4K' },
  collaps: { name: 'Collaps', icon: '🧩', qualityLabel: 'Full HD' },
  kinoteatrkg: { name: 'KinoteatrKG', icon: '🎭', qualityLabel: 'Full HD' },
  vkmovie: { name: 'VKMovie', icon: '▶️', qualityLabel: 'Full HD' }
};

/** Нейтральный fallback-значок для неизвестного источника (требование 8). */
export const PROVIDER_FALLBACK_ICON = '🎬';

/**
 * Мета по id провайдера (принимает `skaz-alloha`, `eo-alloha` и т.п. — префикс
 * служебный, ключ — сам slug). Неизвестный id → null (клиент сам подставит
 * fallback, см. PROVIDER_FALLBACK_ICON).
 */
export function providerMeta(id) {
  const slug = String(id || '').replace(/^(?:skaz-|eo-)/i, '').toLowerCase().trim();
  return PROVIDER_META[slug] || null;
}