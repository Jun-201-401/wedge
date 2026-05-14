import { HOME_PATH } from '../../../shared/lib/appPaths';

const DEFAULT_AUTH_REDIRECT_ORIGIN = 'https://wedge.local';

export function getSafeAuthRedirectPath(search: string, origin = DEFAULT_AUTH_REDIRECT_ORIGIN) {
  const params = new URLSearchParams(search);
  const nextPath = params.get('next');

  if (!nextPath) {
    return HOME_PATH;
  }

  try {
    const nextUrl = new URL(nextPath, origin);

    if (nextUrl.origin !== origin) {
      return HOME_PATH;
    }

    return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  } catch {
    return HOME_PATH;
  }
}
