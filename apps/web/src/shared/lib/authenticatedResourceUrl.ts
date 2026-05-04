import { useEffect, useState } from 'react';

import { requestBlob } from '../../api/http';

const API_PREFIX = '/api';

function toApiPath(resourceUrl: string) {
  if (resourceUrl.startsWith(`${API_PREFIX}/`)) {
    return resourceUrl.slice(API_PREFIX.length);
  }

  if (resourceUrl.startsWith('/runs/')) {
    return resourceUrl;
  }

  try {
    const url = new URL(resourceUrl, window.location.origin);
    if (url.origin === window.location.origin && url.pathname.startsWith(`${API_PREFIX}/`)) {
      return `${url.pathname.slice(API_PREFIX.length)}${url.search}`;
    }
  } catch {
    return null;
  }

  return null;
}

export function useAuthenticatedResourceUrl(resourceUrl: string | null | undefined) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!resourceUrl) {
      setResolvedUrl(null);
      return undefined;
    }

    const apiPath = toApiPath(resourceUrl);
    if (!apiPath) {
      setResolvedUrl(resourceUrl);
      return undefined;
    }

    let isActive = true;
    let objectUrl: string | null = null;
    setResolvedUrl(null);

    void requestBlob(apiPath)
      .then((blob) => {
        if (!isActive) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setResolvedUrl(objectUrl);
      })
      .catch(() => {
        if (isActive) {
          setResolvedUrl(null);
        }
      });

    return () => {
      isActive = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [resourceUrl]);

  return resolvedUrl;
}
