const API_PREFIX = '/api';

export function toSameOriginApiPath(resourceUrl: string) {
  if (resourceUrl.startsWith(`${API_PREFIX}/`)) {
    return resourceUrl.slice(API_PREFIX.length);
  }

  if (resourceUrl.startsWith('/runs/')) {
    return resourceUrl;
  }

  try {
    const baseUrl = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
    const url = new URL(resourceUrl, baseUrl);
    if (url.origin === baseUrl && url.pathname.startsWith(`${API_PREFIX}/`)) {
      return `${url.pathname.slice(API_PREFIX.length)}${url.search}`;
    }
  } catch {
    return null;
  }

  return null;
}
