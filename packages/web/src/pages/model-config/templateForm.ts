export function normalizeModelIdList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function resolveNextSelectedModel(
  current: string,
  allowed: string[],
): string {
  return allowed.includes(current) ? current : "";
}
