const qualityMap = new Map([
  ['2160', '4K'], ['2160p', '4K'], ['uhd', '4K'], ['4k', '4K'],
  ['1440', '1440p'], ['1440p', '1440p'],
  ['1080', '1080p'], ['1080p', '1080p'], ['fhd', '1080p'],
  ['720', '720p'], ['720p', '720p'], ['hd', '720p'],
  ['480', '480p'], ['480p', '480p'], ['360', '360p'], ['360p', '360p']
]);

export function normalizeQuality(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  return qualityMap.get(text) || value;
}
