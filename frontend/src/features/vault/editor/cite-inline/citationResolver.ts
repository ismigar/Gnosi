import {
    resolveCitationKey as resolveCitationKeyApi,
} from '../../../../shared/api/citations';
import {
    fetchVaultPage,
    type VaultPage,
} from '../../../../shared/api/vaults';
import {
    recursosPageToCsl,
    type CslItem,
} from '../../../../shared/citations/cslEngine';


export interface ResolvedCitation {
    readonly cslItem: CslItem | null;
    readonly id: string;
    readonly page: VaultPage | null;
}


interface CitationCacheEntry {
    readonly timestamp: number;
    readonly value: ResolvedCitation | null;
}


const CACHE_TTL_MS = 5 * 60 * 1_000;
const citationCache = new Map<string, CitationCacheEntry>();


function readCache(key: string): ResolvedCitation | null | undefined {
    const entry = citationCache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        citationCache.delete(key);
        return undefined;
    }
    return entry.value;
}


function writeCache(key: string, value: ResolvedCitation | null): void {
    citationCache.set(key, { timestamp: Date.now(), value });
}


export function clearCitationCache(): void {
    citationCache.clear();
}


export async function resolveCitationKey(
    key: string,
    signal?: AbortSignal,
): Promise<ResolvedCitation | null> {
    const cached = readCache(key);
    if (cached !== undefined) return cached;
    try {
        const resolved = await resolveCitationKeyApi(key, signal);
        const id = resolved.id;
        if (!id) {
            writeCache(key, null);
            return null;
        }
        try {
            const page = await fetchVaultPage(id, signal);
            const value = { id, page, cslItem: recursosPageToCsl(page) };
            if (!signal?.aborted) writeCache(key, value);
            return value;
        } catch (error) {
            if (signal?.aborted) throw error;
            const value = { id, page: null, cslItem: null };
            writeCache(key, value);
            return value;
        }
    } catch (error) {
        if (signal?.aborted) throw error;
        writeCache(key, null);
        return null;
    }
}
