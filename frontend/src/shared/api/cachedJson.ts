import { transportFetch } from './transports';


interface CacheEntry {
  readonly data: unknown;
  readonly t: number;
}


export interface CachedJsonOptions {
  readonly fetchOpts?: RequestInit;
  readonly ttl?: number;
}


const inflight = new Map<string, Promise<unknown>>();
const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL = 500;


function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}


export async function cachedJson<T = unknown>(
  url: string,
  { ttl = DEFAULT_TTL, fetchOpts }: CachedJsonOptions = {},
): Promise<T> {
  const now = Date.now();
  const cached = cache.get(url);
  if (cached && (now - cached.t) < ttl) return clone(cached.data) as T;
  if (inflight.has(url)) {
    const data = await inflight.get(url);
    return clone(data) as T;
  }
  const pending: Promise<unknown> = transportFetch(url, fetchOpts)
    .then(async (response) => {
      if (!response.ok) throw new Error(`${url}: ${String(response.status)}`);
      const data = await response.json() as unknown;
      cache.set(url, { t: Date.now(), data });
      inflight.delete(url);
      return data;
    })
    .catch((error: unknown) => {
      inflight.delete(url);
      throw error;
    });
  inflight.set(url, pending);
  const data = await pending;
  return clone(data) as T;
}


export function invalidateCachedJson(url: string): void {
  cache.delete(url);
}
