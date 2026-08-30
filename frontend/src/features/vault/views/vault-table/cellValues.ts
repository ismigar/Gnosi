import type { ReactNode } from 'react';
import { displayString } from './fieldConfig';
import type { TableCell } from './types';

/** Date's legacy ToPrimitive path, including numbers/null and imported values. */
export function metadataDate(value: unknown): Date {
  const result: unknown = Reflect.construct(Date, [value]);
  if (!(result instanceof Date)) throw new TypeError('Invalid date constructor');
  return result;
}

/** Preserve React scalar/array children; object metadata remains an error. */
export function cellNode(value: unknown): ReactNode {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const values: readonly unknown[] = value;
    return values.map(cellNode);
  }
  throw new TypeError('Objects are not valid as a table cell child');
}

export function tableCell(value: { rowId?: unknown; field?: unknown; } | null): TableCell | null {
  return value && typeof value.rowId === 'string' && typeof value.field === 'string' ? { rowId: value.rowId, field: value.field } : null;
}

export function tableText(value: unknown): string { return displayString(value ?? ''); }

export function tableClipboard(): Partial<Pick<Clipboard, 'readText' | 'writeText'>> | undefined {
  return navigator.clipboard;
}
