export function normalizeSearchText(text: string): string {
  return text.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

export function normalizeSearchQuery(value: string | null | undefined): string {
  return (value ?? "").trim().replaceAll(/\s+/g, " ").toLowerCase();
}

export function meaningfulTokens(value: string): string[] {
  return normalizeTextForMatch(value)
    .split(" ")
    .filter((token) => token.length >= 2 && !/^(add|to|the|for|보기|상세|선택|담기)$/.test(token));
}

function normalizeTextForMatch(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replaceAll(/\s+/g, " ");
}
