/**
 * Нормализация названия для сравнения — перенос SearchNameTo.Convert из Lampac.
 *
 * lower-case, оставить только [0-9a-zа-я], ё→е, щ→ш. Пустой результат → null.
 * Используется провайдерами, которые сверяют выданные названия с поисковым
 * (RutubeMovie, Kinogo и др.).
 */
export function searchNameTo(value) {
  const text = String(value ?? '');
  if (!text) return null;

  let out = '';
  for (const ch of text) {
    let c = ch.toLowerCase();
    const code = c.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isAscii = code >= 97 && code <= 122;
    const isCyrillic = code >= 1072 && code <= 1103; // а-я (включая щ=1097)
    const isExtra = c === 'ё'; // 1105 — вне диапазона а-я
    if (!isDigit && !isAscii && !isCyrillic && !isExtra) continue;

    if (c === 'ё') c = 'е';
    else if (c === 'щ') c = 'ш';

    out += c;
  }

  return out || null;
}