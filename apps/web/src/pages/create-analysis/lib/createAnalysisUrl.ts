const HTTP_URL_PATTERN = /^https?:\/\//i;

export function normalizeAnalysisUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const candidate = HTTP_URL_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    const isHttpUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    const isLikelyHost = parsed.hostname === 'localhost' || parsed.hostname.includes('.');

    if (!isHttpUrl || !isLikelyHost) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}
