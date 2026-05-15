import { useEffect, useState } from 'react';

import { requestBlob } from '../../api/http';
import type { AuthenticatedResourceCache } from './authenticatedResourceCache';
import { toSameOriginApiPath } from './apiResourcePath';

export function useAuthenticatedResourceUrl(
  resourceUrl: string | null | undefined,
  cache?: AuthenticatedResourceCache,
) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!resourceUrl) {
      setResolvedUrl(null);
      return undefined;
    }

    const apiPath = toSameOriginApiPath(resourceUrl);
    if (!apiPath) {
      setResolvedUrl(resourceUrl);
      return undefined;
    }

    let isActive = true;
    const cachedUrl = cache?.get(apiPath);
    if (cachedUrl) {
      setResolvedUrl(cachedUrl);
      return () => {
        isActive = false;
      };
    }

    if (cache) {
      void cache.resolve(apiPath)
        .then((objectUrl) => {
          if (isActive) {
            setResolvedUrl(objectUrl);
          }
        })
        .catch(() => {
          if (isActive) {
            setResolvedUrl(null);
          }
        });

      return () => {
        isActive = false;
      };
    }

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
  }, [cache, resourceUrl]);

  return resolvedUrl;
}
