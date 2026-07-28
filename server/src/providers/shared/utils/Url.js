export function buildUrl(baseUrl, params = {}) {
  const placeholderOrigin = 'http://provider.local';
  const isRelative = String(baseUrl).startsWith('/');
  const url = new URL(baseUrl, isRelative ? placeholderOrigin : undefined);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return isRelative ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

export function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}
