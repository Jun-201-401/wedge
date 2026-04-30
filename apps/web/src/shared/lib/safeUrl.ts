export function getSafeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

export function getSafeResourceUrl(value: string | null | undefined) {
  if (!value) {
    return '';
  }

  if (value.startsWith('/') && !value.startsWith('//')) {
    return value;
  }

  return getSafeHttpUrl(value);
}
