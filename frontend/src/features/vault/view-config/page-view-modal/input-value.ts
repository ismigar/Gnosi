/** DOM text controls use the same string coercion as React's legacy value prop. */
export function inputValue(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (Array.isArray(value)) return value.map(item => item == null ? '' : inputValue(item)).join(',');
    return Object.prototype.toString.call(value);
}
