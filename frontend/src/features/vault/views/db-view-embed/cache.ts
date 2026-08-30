import type { EmbedRow } from './types';
export const byTableCache = new Map<string, { ts: number; value: EmbedRow[]; }>();
const BY_TABLE_TTL_MS = 300_000;
const BY_TABLE_MAX_ENTRIES = 32;
export function byTableGet(tableId: string) {
    const e = byTableCache.get(tableId);
    if (!e) return null;
    if (Date.now() - e.ts > BY_TABLE_TTL_MS) { byTableCache.delete(tableId); return null; }
    return e.value;
}
export function byTableSet(tableId: string, value: EmbedRow[]) {
    // Refreshes the insertion position so the FIFO head doesn't evict a table
    // that was just re-read.
    if (byTableCache.has(tableId)) byTableCache.delete(tableId);
    else if (byTableCache.size >= BY_TABLE_MAX_ENTRIES) {
        const oldest = byTableCache.keys().next().value;
        if (oldest !== undefined) byTableCache.delete(oldest);
    }
    byTableCache.set(tableId, { ts: Date.now(), value });
}
