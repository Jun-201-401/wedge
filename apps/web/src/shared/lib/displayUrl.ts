const DEFAULT_DISPLAY_URL_MAX_LENGTH = 72;

function truncateMiddle(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  const safeMaxLength = Math.max(12, maxLength);
  const headLength = Math.ceil((safeMaxLength - 1) * 0.68);
  const tailLength = safeMaxLength - headLength - 1;

  return `${value.slice(0, headLength)}…${value.slice(-tailLength)}`;
}

export function formatDisplayUrl(value: string, maxLength = DEFAULT_DISPLAY_URL_MAX_LENGTH) {
  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./i, '');
    const path = url.pathname === '/' ? '' : url.pathname;
    const queryMarker = url.search ? '?…' : '';

    return truncateMiddle(`${host}${path}${queryMarker}`, maxLength);
  } catch {
    return truncateMiddle(trimmed, maxLength);
  }
}
