/**
 * electron.js — helpers for running inside the Gnosi desktop (Electron) shell.
 *
 * The packaged app loads the SPA from the `app://` scheme, so relative
 * `/api/...` requests are proxied to the backend by the main process and need
 * no special handling here. The one exception is the collaboration WebSocket:
 * the `app://` protocol handler does not intercept `ws://` upgrades, so the WS
 * client must connect to the backend host directly. `getBackendOrigin()`
 * resolves that host (cached) and is a no-op outside Electron.
 */

/** True when running inside the Electron renderer (packaged or `--dev`). */
export const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

let backendOriginPromise = null;

/**
 * Resolves the backend origin (e.g. `http://localhost:5002`) for direct
 * connections such as the collaboration WebSocket. Returns `null` outside
 * Electron, where relative URLs are correct.
 *
 * The IPC call is async, so the first call may return null until the value is
 * cached. Callers that must wait should use `await ensureBackendOrigin()`.
 *
 * @returns {string|null} cached backend origin, or null if not yet known / not Electron
 */
export function getBackendOrigin() {
  if (!isElectron) return null;
  if (backendOriginPromise) {
    // Best-effort synchronous read of the cached value.
    let cached = null;
    backendOriginPromise.then((v) => { cached = v; }).catch(() => {});
    return cached;
  }
  ensureBackendOrigin();
  return null;
}

/**
 * Ensures the backend origin is resolved and cached. Resolves to the origin
 * string in Electron, or null otherwise.
 *
 * @returns {Promise<string|null>}
 */
export async function ensureBackendOrigin() {
  if (!isElectron) return null;
  if (!backendOriginPromise) {
    backendOriginPromise = window.electronAPI
      .getBackendURL()
      .catch(() => null);
  }
  return backendOriginPromise;
}
