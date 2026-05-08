const HTTP_URL_PATTERN = /^https?:\/\//i;
const LOCALHOST = 'localhost';
const LOCALHOST_SUFFIX = '.localhost';

export function normalizeAnalysisUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const candidate = HTTP_URL_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    const isHttpUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    const normalizedHost = parsed.hostname.toLowerCase();
    const isLocalhost = normalizedHost === LOCALHOST || normalizedHost.endsWith(LOCALHOST_SUFFIX);
    const isLikelyHost = normalizedHost.includes('.');

    if (!isHttpUrl || isLocalhost || !isLikelyHost) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}
