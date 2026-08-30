function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringifyNonObject(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean' ||
    typeof value === 'symbol' ||
    typeof value === 'function'
  ) {
    return String(value);
  }
  return '';
}

/** Returns whether a resource reference contains at least one usable value. */
export function hasResourceReference(value?: unknown): boolean {
  if (isUnknownArray(value)) {
    return value.some((item) => hasResourceReference(item));
  }

  if (isUnknownRecord(value)) {
    return Object.values(value).some((item) => hasResourceReference(item));
  }

  return stringifyNonObject(value).trim().length > 0;
}
