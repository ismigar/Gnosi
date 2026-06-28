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
import axios from 'axios';

// Global axios timeout: prevents requests to slow IMAP / external APIs from
// hanging forever. Without a client-side cap a stuck server-side socket can
// leave a tab pending indefinitely. 30s gives slow servers room while still
// surfacing real failures.
if (!axios.defaults.timeout) {
    axios.defaults.timeout = 30000;
}

// In-memory cache: pageId → last known etag string.
const etagByPage = new Map();

const PAGE_URL_RE = /\/api\/vault\/pages\/([^/?#]+)(?:[/?#]|$)/;

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
            // Mode personal multi-vault: el vault actiu triat es propaga a CADA petició
            // (sense res triat → el backend usa el vault principal: compatibilitat enrere).
            try {
                const vid = typeof localStorage !== 'undefined' ? localStorage.getItem('gnosi_active_vault') : null;
                if (vid) config.headers = { ...(config.headers || {}), 'X-Vault-Id': vid };
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
                // Invalida el preview cache del WikilinkHoverPreview en
                // PATCH/PUT exitós: sense això, l'extracte cachejat (TTL 5
                // min) sobreviu al canvi i el hover mostra "Pàgina buida"
                // o text obsolet fins que caduqui.
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
                    // Auto-retry UNA VEGADA per request amb el nou etag. Sense
                    // això, quan diversos PATCH es queden encavalcats (autosave
                    // amb timeout que despenja la cadena, OneDrive tocant el
                    // mtime sense canvis reals), tots porten l'etag vell i tots
                    // tornen 409 — l'usuari veu el toast però els canvis no es
                    // guarden. Aquí reintentem amb `current_etag` perquè el
                    // PATCH "guanyi" si encara és vàlid; només broadcastegem
                    // el conflicte si el reintent també falla.
                    const cfg = error?.config;
                    const canRetry = cfg && !cfg._etagRetried && pageId && detail?.current_etag;
                    if (canRetry) {
                        cfg._etagRetried = true;
                        try {
                            const nextBody = (cfg.data && typeof cfg.data === 'object')
                                ? { ...cfg.data, expected_etag: detail.current_etag }
                                : cfg.data;
                            cfg.data = nextBody;
                            return await axios.request(cfg);
                        } catch (retryErr) {
                            // Si el reintent també falla amb etag, deixem que
                            // surti pel camí normal (toast de conflicte).
                            error = retryErr;
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
