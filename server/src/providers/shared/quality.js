export function normalizeQuality(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'auto';
  const numeric = raw.match(/(2160|1440|1080|720|480|360|240)/);
  if (numeric) return `${numeric[1]}p`;
  if (/auto|adaptive|hls/i.test(raw)) return 'auto';
  return raw.endsWith('p') ? raw : `${raw}p`;
}

export function sortStreamsByQuality(streams) {
  return [...streams].sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));
}

function qualityRank(value) {
  const match = String(value || '').match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}
