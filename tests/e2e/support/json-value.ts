/** Validate JSON at test boundaries instead of spreading library-returned any. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function requireJsonObject(value: unknown): Record<string, unknown> {
  if (!isJsonObject(value)) throw new Error('Expected a JSON object in the test contract');
  return value;
}

export function requireStringList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Expected a string list in the test contract');
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new Error('Expected only strings in the test contract');
    result.push(item);
  }
  return result;
}
