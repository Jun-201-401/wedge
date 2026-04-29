import { CREATE_ANALYSIS_PATH } from '../../../shared/lib/appPaths';

const DEFAULT_AUTH_REDIRECT_ORIGIN = 'https://wedge.local';

export function getSafeAuthRedirectPath(search: string, origin = DEFAULT_AUTH_REDIRECT_ORIGIN) {
  const params = new URLSearchParams(search);
  const nextPath = params.get('next');

  if (!nextPath) {
    return CREATE_ANALYSIS_PATH;
  }

  try {
    const nextUrl = new URL(nextPath, origin);

    if (nextUrl.origin !== origin) {
      return CREATE_ANALYSIS_PATH;
    }

    return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  } catch {
    return CREATE_ANALYSIS_PATH;
  }
}
