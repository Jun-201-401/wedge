import { useEffect, useState } from 'react';

import { requestBlob } from '../../api/http';
import type { AuthenticatedResourceCache } from './authenticatedResourceCache';
import { toSameOriginApiPath } from './apiResourcePath';

interface ResolvedResourceUrl {
  key: string;
  url: string;
  ownerCache?: AuthenticatedResourceCache;
}

export function useAuthenticatedResourceUrl(
  resourceUrl: string | null | undefined,
  cache?: AuthenticatedResourceCache,
) {
  const [resolvedResource, setResolvedResource] = useState<ResolvedResourceUrl | null>(null);

  useEffect(() => {
    if (!resourceUrl) {
      setResolvedResource(null);
      return undefined;
    }

    const apiPath = toSameOriginApiPath(resourceUrl);
    if (!apiPath) {
      setResolvedResource({ key: resourceUrl, url: resourceUrl });
      return undefined;
    }

    let isActive = true;
    const cachedUrl = cache?.get(apiPath);
    if (cachedUrl) {
      setResolvedResource({ key: apiPath, url: cachedUrl, ownerCache: cache });
      return () => {
        isActive = false;
      };
    }

    setResolvedResource((current) => (
      current?.key === apiPath && current.ownerCache === cache ? current : null
    ));

    if (cache) {
      void cache.resolve(apiPath)
        .then((objectUrl) => {
          if (isActive) {
            setResolvedResource({ key: apiPath, url: objectUrl, ownerCache: cache });
          }
        })
        .catch(() => {
          if (isActive) {
            setResolvedResource(null);
          }
        });

      return () => {
        isActive = false;
      };
    }

    let objectUrl: string | null = null;

    void requestBlob(apiPath)
      .then((blob) => {
        if (!isActive) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setResolvedResource({ key: apiPath, url: objectUrl });
      })
      .catch(() => {
        if (isActive) {
          setResolvedResource(null);
        }
      });

    return () => {
      isActive = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [cache, resourceUrl]);

  const resourceKey = resourceUrl ? toSameOriginApiPath(resourceUrl) ?? resourceUrl : null;

  if (!resourceKey || resolvedResource?.key !== resourceKey) {
    return null;
  }

  const apiPath = resourceUrl ? toSameOriginApiPath(resourceUrl) : null;
  if (apiPath && resolvedResource.ownerCache !== cache) {
    return null;
  }

  return resolvedResource.url;
}
