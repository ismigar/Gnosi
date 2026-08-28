/**
 * pageEtagInterceptor.js
 *
 * Axios interceptors that wire optimistic concurrency for /api/vault/pages
 * automatically — without touching every save site in the codebase.
 *
 * Why:
 *   When a user edits a note on two devices (laptop + phone) and OneDrive
 *   syncs in the background, the second save can silently overwrite the
 *   first. The backend already supports an `expected_etag` field on
 *   PATCH/PUT and returns 409 if it doesn't match. This module:
 *
 *     1. Captures `etag` from every GET /api/vault/pages/{id} response.
 *     2. Auto-attaches `expected_etag` to PATCH/PUT bodies for that page.
 *     3. Updates the cached etag from the save response so the *next* save
 *        is also protected.
 *     4. Listens for 409 responses and dispatches a `pageEtagConflict`
 *        DOM event so any UI layer can show a "reload or overwrite" toast.
 *
 * Setup: import this once at app boot (main.jsx) — `installPageEtagInterceptor()`.
 *
 * Escape hatch: pass `force: true` in the request body to skip the etag check
 * (useful for "overwrite anyway" buttons in conflict toasts).
 */
import axios from '../shared/api/legacy-http';
import { setActiveVaultCookie } from './fileResource.js';

// Global axios timeout: prevents requests to slow IMAP / external APIs from
// hanging forever. Without a client-side cap a stuck server-side socket can
// leave a tab pending indefinitely. 30s gives slow servers room while still
// surfacing real failures.
if (!axios.defaults.timeout) {
    axios.defaults.timeout = 30000;
}

// In-memory cache: pageId → last known etag string.
const etagByPage = new Map();

const PAGE_URL_RE = /\/(?:api\/vault|api\/v1\/vaults\/[^/]+\/knowledge)\/pages\/([^/?#]+)(?:[/?#]|$)/;

function extractPageId(url) {
    if (!url) return null;
    const m = String(url).match(PAGE_URL_RE);
    if (!m) return null;
    // by-table, history, duplicate, etc. → ignore. We only want the bare
    // /pages/{id} form.
    if (m[1] === 'by-table' || m[1] === 'history') return null;
    try {
        return decodeURIComponent(m[1]);
    } catch {
        return m[1];
    }
}

let installed = false;

export function installPageEtagInterceptor() {
    if (installed) return;
    installed = true;

    // Request: auto-attach expected_etag on PATCH/PUT to /pages/{id}
    axios.interceptors.request.use((config) => {
        try {
            // Personal multi-vault mode: the chosen active vault is propagated to EVERY request
            // (nothing selected → the backend uses the main vault: backward compatibility).
            try {
                // An explicit X-Vault-Id header from the request TAKES PRECEDENCE (e.g. cloning Notion into a
                // separate vault without changing the current global vault); only if there isn't one do we set
                // the active vault from localStorage.
                const explicit = config.headers && config.headers['X-Vault-Id'];
                const vid = typeof localStorage !== 'undefined' ? localStorage.getItem('gnosi_active_vault') : null;
                if (!explicit && vid) config.headers = { ...(config.headers || {}), 'X-Vault-Id': vid };
                // Keeps the same-origin cookie synchronized with localStorage (source
                // of truth) so that NON-axios requests (raw fetch, <img>, SSE,
                // /api/chat, WebSocket) also carry the vault. Auto-repairs the cookie
                // if it has expired or the browser has deleted it. We don't set it if a
                // explicit X-Vault-Id takes precedence (we let the cookie reflect the
                // global vault, not the one-off destination of a clone).
                if (!explicit) setActiveVaultCookie(vid);
            } catch { /* localStorage no disponible */ }
            const method = (config.method || 'get').toLowerCase();
            if (method !== 'patch' && method !== 'put') return config;
            const pageId = extractPageId(config.url);
            if (!pageId) return config;
            const etag = etagByPage.get(pageId);
            if (!etag) return config;
            // Attach only if the body is a plain object and the caller hasn't
            // already provided expected_etag or asked for force.
            if (
                config.data &&
                typeof config.data === 'object' &&
                !Array.isArray(config.data) &&
                !('expected_etag' in config.data) &&
                !config.data.force
            ) {
                config.data = { ...config.data, expected_etag: etag };
            }
        } catch (e) {
            // Never break the request flow because of interceptor logic
            console.warn('pageEtagInterceptor request hook failed:', e);
        }
        return config;
    });

    // Response: capture etag from successful GET/PATCH/PUT
    axios.interceptors.response.use(
        (response) => {
            try {
                const url = response?.config?.url;
                const pageId = extractPageId(url);
                if (!pageId) return response;
                const etag = response?.data?.etag;
                if (etag) etagByPage.set(pageId, etag);
                // Invalidates the WikilinkHoverPreview preview cache on
                // successful PATCH/PUT: without this, the cached excerpt (TTL 5
                // min) survives the change and the hover shows "Empty page"
                // or stale text until it expires.
                const method = (response?.config?.method || 'get').toLowerCase();
                if (method === 'patch' || method === 'put') {
                    window.dispatchEvent(
                        new CustomEvent('gnosi:invalidatePreview', { detail: { pageId } }),
                    );
                }
            } catch (e) {
                console.warn('pageEtagInterceptor response hook failed:', e);
            }
            return response;
        },
        async (error) => {
            // On 409 etag_mismatch, broadcast an event so the UI can react
            try {
                const status = error?.response?.status;
                const detail = error?.response?.data?.detail;
                const isEtagConflict =
                    status === 409 &&
                    (detail?.error === 'etag_mismatch' || detail?.error === 'etag_mismatch_force');
                if (isEtagConflict) {
                    const pageId = extractPageId(error?.config?.url);
                    // Update cache to the server's current etag so subsequent
                    // saves won't keep failing if the user picks "overwrite".
                    if (pageId && detail?.current_etag) {
                        etagByPage.set(pageId, detail.current_etag);
                    }
                    // Auto-retry ONCE per request with the new etag. Without
                    // this, when several PATCHes end up overlapping (autosave
                    // with a timeout that unhooks the chain, OneDrive touching the
                    // mtime with no real changes), they all carry the old etag and all
                    // return 409 — the user sees the toast but the changes are not
                    // saved. Here we retry with `current_etag` so that the
                    // Let the PATCH "win" if it's still valid; we only broadcast
                    // the conflict if the retry also fails.
                    const cfg = error?.config;
                    const canRetry = cfg && !cfg._etagRetried && pageId && detail?.current_etag;
                    if (canRetry) {
                        cfg._etagRetried = true;
                        // By the time the RESPONSE interceptor runs, axios has already
                        // applied transformRequest, so cfg.data is a JSON STRING — the
                        // old `typeof === 'object'` check was false, so the retry
                        // re-sent the STALE etag and 409'd again. Parse, inject the
                        // fresh etag, re-stringify. Skip the retry if it isn't JSON.
                        let nextBody = null;
                        if (cfg.data && typeof cfg.data === 'object') {
                            nextBody = { ...cfg.data, expected_etag: detail.current_etag };
                        } else if (typeof cfg.data === 'string') {
                            try {
                                const parsed = JSON.parse(cfg.data);
                                parsed.expected_etag = detail.current_etag;
                                nextBody = JSON.stringify(parsed);
                            } catch {
                                nextBody = null;
                            }
                        }
                        if (nextBody !== null) {
                            cfg.data = nextBody;
                            try {
                                return await axios.request(cfg);
                            } catch (retryErr) {
                                // If the retry also fails with etag, let it go
                                // through the normal path (conflict toast).
                                error = retryErr;
                            }
                        }
                    }
                    window.dispatchEvent(
                        new CustomEvent('pageEtagConflict', {
                            detail: {
                                pageId,
                                currentEtag: detail?.current_etag,
                                expectedEtag: detail?.expected_etag,
                                message: detail?.message,
                                originalRequest: error?.config,
                            },
                        }),
                    );
                }
            } catch (e) {
                console.warn('pageEtagInterceptor error hook failed:', e);
            }
            return Promise.reject(error);
        },
    );
}

/** Manually clear the cached etag for a page (e.g., after a hard reload). */
export function clearPageEtag(pageId) {
    if (pageId) etagByPage.delete(pageId);
}

/** Read-only access for debugging / tests. */
export function getCachedEtag(pageId) {
    return etagByPage.get(pageId) || null;
}
