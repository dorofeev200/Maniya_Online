const languageMap = new Map([
  ['ru', 'ru'], ['rus', 'ru'], ['рус', 'ru'], ['русский', 'ru'],
  ['en', 'en'], ['eng', 'en'], ['english', 'en'], ['английский', 'en'],
  ['uk', 'uk'], ['ua', 'uk'], ['ukr', 'uk'], ['украинский', 'uk']
]);

export function normalizeLanguage(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  return languageMap.get(text) || text;
}
