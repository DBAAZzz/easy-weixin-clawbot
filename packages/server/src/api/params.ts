export function parsePositiveIntParam(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parsePositiveBigIntParam(value: string | undefined): bigint | null {
  if (!value || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  return BigInt(value);
}

export function parseLimitParam(value: string | undefined, fallback = 20, max = 100): number {
  const parsed = parsePositiveIntParam(value);
  if (parsed === null) {
    return fallback;
  }

  return Math.min(parsed, max);
}
