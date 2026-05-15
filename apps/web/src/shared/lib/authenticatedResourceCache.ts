interface AuthenticatedResourceCacheOptions {
  maxEntries: number;
  maxBytes: number;
  fetchBlob: (resourceUrl: string) => Promise<Blob>;
}

interface ReadyCacheEntry {
  objectUrl: string;
  sizeBytes: number;
}

export interface AuthenticatedResourceCache {
  get: (resourceUrl: string) => string | null;
  resolve: (resourceUrl: string) => Promise<string>;
  prefetch: (resourceUrls: string[]) => Promise<void>;
  clear: () => void;
}

export function createAuthenticatedResourceCache({
  maxEntries,
  maxBytes,
  fetchBlob,
}: AuthenticatedResourceCacheOptions): AuthenticatedResourceCache {
  const readyEntries = new Map<string, ReadyCacheEntry>();
  const pendingEntries = new Map<string, Promise<string>>();

  function touch(resourceUrl: string, entry: ReadyCacheEntry) {
    readyEntries.delete(resourceUrl);
    readyEntries.set(resourceUrl, entry);
  }

  function revoke(entry: ReadyCacheEntry) {
    URL.revokeObjectURL(entry.objectUrl);
  }

  function totalBytes() {
    let bytes = 0;

    for (const entry of readyEntries.values()) {
      bytes += entry.sizeBytes;
    }

    return bytes;
  }

  function evictOverflow() {
    while (readyEntries.size > maxEntries) {
      const oldest = readyEntries.entries().next().value as [string, ReadyCacheEntry] | undefined;
      if (!oldest) {
        return;
      }

      readyEntries.delete(oldest[0]);
      revoke(oldest[1]);
    }

    while (readyEntries.size > 1 && totalBytes() > maxBytes) {
      const oldest = readyEntries.entries().next().value as [string, ReadyCacheEntry] | undefined;
      if (!oldest) {
        return;
      }

      readyEntries.delete(oldest[0]);
      revoke(oldest[1]);
    }
  }

  function get(resourceUrl: string) {
    const entry = readyEntries.get(resourceUrl);
    if (!entry) {
      return null;
    }

    touch(resourceUrl, entry);
    return entry.objectUrl;
  }

  function resolve(resourceUrl: string) {
    const cachedObjectUrl = get(resourceUrl);
    if (cachedObjectUrl) {
      return Promise.resolve(cachedObjectUrl);
    }

    const pendingObjectUrl = pendingEntries.get(resourceUrl);
    if (pendingObjectUrl) {
      return pendingObjectUrl;
    }

    const pending = fetchBlob(resourceUrl)
      .then((blob) => {
        const entry = {
          objectUrl: URL.createObjectURL(blob),
          sizeBytes: blob.size,
        };

        readyEntries.set(resourceUrl, entry);
        evictOverflow();

        const retainedEntry = readyEntries.get(resourceUrl);
        return retainedEntry?.objectUrl ?? entry.objectUrl;
      })
      .finally(() => {
        pendingEntries.delete(resourceUrl);
      });

    pendingEntries.set(resourceUrl, pending);
    return pending;
  }

  async function prefetch(resourceUrls: string[]) {
    await Promise.all([...new Set(resourceUrls)].map((resourceUrl) => (
      resolve(resourceUrl).then(() => undefined, () => undefined)
    )));
  }

  function clear() {
    for (const entry of readyEntries.values()) {
      revoke(entry);
    }

    readyEntries.clear();
    pendingEntries.clear();
  }

  return {
    get,
    resolve,
    prefetch,
    clear,
  };
}
