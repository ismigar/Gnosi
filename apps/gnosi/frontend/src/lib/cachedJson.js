// Lightweight in-flight + short-TTL JSON cache for idempotent GETs.
//
// Why: several pages mount multiple components that each fetch the same
// "global" endpoints (e.g. /api/integrations, /api/config). React StrictMode
// doubles every fetch in development, so a page that renders 3 mail panels
// can issue 6 identical requests in a single navigation. This util collapses
// concurrent calls to one network request and keeps the parsed JSON for a
// short window so a follow-up render gets a free hit.
//
// Use this only for endpoints that are safe to share across callers.
// Returns a fresh deep clone of the data each time so callers can mutate
// it without affecting other consumers.

const inflight = new Map();
const cache = new Map();
const DEFAULT_TTL = 500;

function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

export async function cachedJson(url, { ttl = DEFAULT_TTL, fetchOpts } = {}) {
    const now = Date.now();
    const cached = cache.get(url);
    if (cached && (now - cached.t) < ttl) return clone(cached.data);
    if (inflight.has(url)) {
        const data = await inflight.get(url);
        return clone(data);
    }
    const p = fetch(url, fetchOpts).then(async (r) => {
        if (!r.ok) throw new Error(`${url}: ${r.status}`);
        const data = await r.json();
        cache.set(url, { t: Date.now(), data });
        inflight.delete(url);
        return data;
    }).catch((err) => {
        inflight.delete(url);
        throw err;
    });
    inflight.set(url, p);
    const data = await p;
    return clone(data);
}

export function invalidateCachedJson(url) {
    cache.delete(url);
}
