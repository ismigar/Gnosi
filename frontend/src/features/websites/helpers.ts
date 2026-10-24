export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const result = [...items];
  const item = result.splice(index, 1)[0];
  if (item !== undefined) result.splice(index + direction, 0, item);
  return result;
}
export function splitList(value: string): string[] { return value.split(/[\n,]/u).map(item => item.trim()).filter(Boolean); }
export function newId(prefix: string): string { return `${prefix}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`; }
export function escaped(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
export function safePreviewDocument(html: string): string {
  const policy = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'";
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">${html}`;
}
export function filterValueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value.join(', ');
  return JSON.stringify(value);
}
