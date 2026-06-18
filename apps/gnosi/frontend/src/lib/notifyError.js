/**
 * notifyError.js
 *
 * Single entry point for non-fatal client-side errors. Replaces the
 * inconsistent mix of bare `console.error`, raw `toast.error`, and silent
 * swallowing scattered across the codebase.
 *
 * Behaviour:
 *   - Logs every error to the console with a `[scope]` tag for grep-ability.
 *   - Optionally shows a toast (default: yes). Pass `{toast: false}` for
 *     known-noisy paths (autosave background retries, prefetch failures).
 *   - Coalesces identical messages within `dedupeMs` so a misbehaving server
 *     can't drown the UI in 50 identical toasts.
 *   - Emits a CustomEvent('app-error') so future telemetry / a debug
 *     console UI can subscribe without touching call sites.
 *
 * Usage:
 *     import { notifyError } from '@/lib/notifyError';
 *     try { await axios.patch(...); }
 *     catch (err) { notifyError('save-page', err, t('errors.save_page')); }
 */
import { toast as hotToast } from 'react-hot-toast';

const DEFAULT_DEDUPE_MS = 4000;
const _recent = new Map(); // message → timestamp

function _shouldShow(key) {
    const now = Date.now();
    const last = _recent.get(key) || 0;
    if (now - last < DEFAULT_DEDUPE_MS) return false;
    _recent.set(key, now);
    // Cap the map so it can't grow without bound on a long session.
    if (_recent.size > 64) {
        const oldest = _recent.keys().next().value;
        _recent.delete(oldest);
    }
    return true;
}

/**
 * @param {string}  scope     - short label for the call site (e.g. 'save-page').
 * @param {Error}   err       - original error from axios / fetch / try block.
 * @param {string}  [userMsg] - human message for the toast. Falls back to a
 *                              generic translation-friendly default.
 * @param {object}  [options]
 * @param {boolean} [options.toast=true]  - show a toast?
 * @param {boolean} [options.silent=false]- suppress everything but the event.
 */
export function notifyError(scope, err, userMsg, options = {}) {
    const { toast = true, silent = false, persist = true } = options;
    const tag = `[${scope}]`;
    const status = err?.response?.status;
    const detail = err?.response?.data?.detail;
    const baseMsg = userMsg
        || (typeof detail === 'string' ? detail : detail?.message)
        || err?.message
        || 'Hi ha hagut un error inesperat.';

    if (!silent) {
        // eslint-disable-next-line no-console
        console.error(tag, baseMsg, err);
    }

    if (toast && !silent && _shouldShow(`${scope}|${baseMsg}`)) {
        hotToast.error(baseMsg, { duration: 5000 });
    }

    // Persisteix l'error al log central perquè aparegui al Control Center
    // (Logs i Historial). Fire-and-forget: no esperem resposta ni bloquegem
    // el flux UI si la xarxa cau. Saltable amb { persist: false } per a
    // errors molt sorollosos (autosave background, etc.).
    if (persist && !silent) {
        try {
            _persistNotification({
                title: `[${scope}] error`,
                message: baseMsg,
                level: 'ERROR',
            });
        } catch {
            /* no-op: el toast ja informa l'usuari */
        }
    }

    try {
        window.dispatchEvent(new CustomEvent('app-error', {
            detail: { scope, status, message: baseMsg, error: err },
        }));
    } catch {
        /* no-op */
    }
}

/** Convenience for cases where we want the error logged but no toast. */
export function logError(scope, err) {
    notifyError(scope, err, null, { toast: false });
}

/**
 * Registra un esdeveniment positiu o informatiu al log central. NO mostra
 * toast — això es deixa al caller (toast.success quan calgui). Pensat per
 * fer que el Control Center tingui un historial complet, no només errors.
 */
export function notifySuccess(scope, message) {
    _persistNotification({
        title: `[${scope}]`,
        message: String(message || ''),
        level: 'SUCCESS',
    });
}

export function notifyInfo(scope, message) {
    _persistNotification({
        title: `[${scope}]`,
        message: String(message || ''),
        level: 'INFO',
    });
}

// Exportada perquè el wrapper de toast pugui registrar `toast.error` /
// `toast.success` com a entrades del Control Center.
export function _persistNotification({ title, message, level }) {
    // useApi és un hook React i no es pot usar fora d'un component. Fem un
    // fetch directe amb els mateixos headers que `useApi.apiFetch` aplica.
    try {
        const workspaceId = (typeof localStorage !== 'undefined'
            && localStorage.getItem('gnosi_workspace_id')) || 'personal';
        const userEmail = (typeof localStorage !== 'undefined'
            && localStorage.getItem('gnosi_user_email')) || '';
        fetch('/api/system/notifications', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Workspace-ID': workspaceId,
                'X-User-ID': 'ismael-legacy',
                'X-User-Email': userEmail,
            },
            body: JSON.stringify({ title, message, level, workspace_id: workspaceId }),
            keepalive: true,
        }).catch(() => { /* fire-and-forget */ });
    } catch {
        /* localStorage absent o fetch absent — silenciem */
    }
}
