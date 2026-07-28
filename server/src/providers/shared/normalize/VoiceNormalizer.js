export function normalizeVoice(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim() || null;
}
