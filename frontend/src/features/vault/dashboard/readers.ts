import type { Page, View, ViewDraft, Table, Database, Registry, WikiConfig } from './types';
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
export function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
export function stringValue(value: unknown): string {
  if (value !== null && typeof value === 'object')
    return Object.prototype.toString.call(value);
  return String(value);
}
export function readPage(value: unknown): Page {
  const page = record(value);
  if (typeof page.id !== 'string')
    throw new TypeError('Invalid Vault page ID');
  return { ...page, id: page.id, title: text(page.title) };
}
export function readPages(value: unknown): Page[] {
  return Array.isArray(value) ? value.map(readPage) : [];
}
export function readView(value: unknown): View {
  const view = record(value);
  if (typeof view.id !== 'string')
    throw new TypeError('Invalid Vault view ID');
  return { ...view, id: view.id, name: text(view.name), type: text(view.type, 'table') };
}
export function readViewDraft(value: unknown): ViewDraft {
  return record(value);
}
export function readTable(value: unknown): Table {
  const table = record(value);
  if (typeof table.id !== 'string')
    throw new TypeError('Invalid Vault table ID');
  return { ...table, id: table.id, name: text(table.name), database_id: text(table.database_id) };
}
export function readDatabase(value: unknown): Database {
  const database = record(value);
  if (typeof database.id !== 'string')
    throw new TypeError('Invalid Vault database ID');
  return { ...database, id: database.id, name: text(database.name) };
}
export function readRegistry(value: unknown): Registry {
  const registry = record(value);
  return {
    databases: Array.isArray(registry.databases) ? registry.databases.map(readDatabase) : [],
    tables: Array.isArray(registry.tables) ? registry.tables.map(readTable) : [],
    views: Array.isArray(registry.views) ? registry.views.map(readView) : [],
  };
}
export function readWikiConfig(value: unknown): WikiConfig | null {
  return isRecord(value) ? value : null;
}
export function errorStatus(error: unknown): number | undefined {
  const value = record(record(error).response).status;
  return typeof value === 'number' ? value : undefined;
}
export function retryAfter(error: unknown): number {
  const headers = record(record(error).response).headers;
  return Number(headers instanceof Headers ? headers.get('retry-after') : undefined) || 2;
}
export function isAbortLikeError(error: unknown): boolean {
  if (!error)
    return false;
  const value = record(error);
  const code = text(value.code).toUpperCase();
  const name = text(value.name).toLowerCase();
  const message = text(value.message).toLowerCase();
  return code === 'ERR_CANCELED' || name === 'cancelederror'
    || message.includes('aborted') || message.includes('canceled') || message.includes('cancelled');
}
// Cancellation may change while awaiting another request; do not narrow it across awaits.
export function wasAborted(signal: AbortSignal): boolean { return signal.aborted; }
export function readDocumentKind(value: unknown): 'pdf' | 'epub' | 'snapshot' {
  return value === 'epub' || value === 'snapshot' ? value : 'pdf';
}
