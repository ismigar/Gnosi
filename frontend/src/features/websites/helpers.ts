import type { SiteConfig } from '../../shared/api/sites';

export const configurationKey = (site: SiteConfig) => JSON.stringify({ ...site, revision: 0 });

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
/** Mail is display-only. Lifecycle operations use separate, server-bound controls. */
export function capturedDisplayHtml(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const allowed = new Set(['p', 'div', 'span', 'main', 'section', 'header', 'footer', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'br', 'hr', 'a', 'pre', 'code']);
  for (const element of template.content.querySelectorAll('*')) {
    if (!allowed.has(element.tagName.toLowerCase())) { element.remove(); continue; }
    for (const attribute of [...element.attributes]) if (!['style', 'colspan', 'rowspan', 'lang', 'dir'].includes(attribute.name)) element.removeAttribute(attribute.name);
  }
  return template.innerHTML;
}
export function filterValueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value.join(', ');
  return JSON.stringify(value);
}
