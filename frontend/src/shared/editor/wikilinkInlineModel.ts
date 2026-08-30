import { resolveVaultTitle } from '../api/vaults';


export type WikilinkTitleIndex = Readonly<Record<string, string>>;


export type WikilinkTitleResolver = (
  title: string,
) => Promise<{ readonly id?: string | null }>;


interface ResolutionCacheEntry {
  readonly timestamp: number;
  readonly value: string | null;
}


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TITLE_CACHE_TTL_MS = 5 * 60 * 1000;
const titleResolutionCache = new Map<string, ResolutionCacheEntry>();


function readResolutionCache(key: string): string | null | undefined {
  const entry = titleResolutionCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > TITLE_CACHE_TTL_MS) {
    titleResolutionCache.delete(key);
    return undefined;
  }
  return entry.value;
}


function writeResolutionCache(key: string, value: string | null): void {
  titleResolutionCache.set(key, { timestamp: Date.now(), value });
}


export function clearWikilinkResolutionCache(): void {
  titleResolutionCache.clear();
}


export function isUuidTarget(value: string): boolean {
  return UUID_RE.test(value);
}


/** Resolve a UUID or title from the live local vault index. */
export function resolveWikilinkTargetLocal(
  raw: string | null | undefined,
  idToTitle: WikilinkTitleIndex,
): string | null | undefined {
  if (!raw) return raw;
  const hashIndex = raw.indexOf('#');
  const base = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  if (!base) return raw;
  if (isUuidTarget(base)) return base;
  const normalizedTarget = base.toLowerCase().trim();
  for (const [id, title] of Object.entries(idToTitle)) {
    if (title.toLowerCase().trim() === normalizedTarget) return id;
  }
  return base;
}


/** Fall back to the backend when a title is absent from the local index. */
export async function resolveWikilinkTarget(
  raw: string | null | undefined,
  idToTitle: WikilinkTitleIndex,
  resolveTitle: WikilinkTitleResolver = resolveVaultTitle,
): Promise<string | null | undefined> {
  const local = resolveWikilinkTargetLocal(raw, idToTitle);
  if (!local || isUuidTarget(local)) return local;
  const cacheKey = local.toLowerCase().trim();
  const cached = readResolutionCache(cacheKey);
  if (cached !== undefined) return cached || local;
  try {
    const result = await resolveTitle(local);
    const id = result.id || null;
    writeResolutionCache(cacheKey, id);
    return id || local;
  } catch {
    writeResolutionCache(cacheKey, null);
    return local;
  }
}
