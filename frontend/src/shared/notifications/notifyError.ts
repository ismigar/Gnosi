/**
 * notifyError.ts
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
 *   - Emits the typed `app-error` application event so future telemetry / a debug
 *     console UI can subscribe without touching call sites.
 *
 * Usage:
 *     import { notifyError } from '@/lib/notifyError';
 *     try { await axios.patch(...); }
 *     catch (err) { notifyError('save-page', err, t('errors.save_page')); }
 */
import { toast as hotToast } from 'react-hot-toast';
import { emitAppEvent } from '../platform/app-events';
import {
    defineStorageKey,
    readStorage,
    stringStorageCodec,
} from '../platform/browser-storage';
import { createSystemNotification } from '../api/system';

export interface NotifyErrorOptions {
    readonly persist?: boolean;
    readonly silent?: boolean;
    readonly toast?: boolean;
}

export interface PersistNotificationInput {
    readonly level: string;
    readonly message: string;
    readonly title: string;
}

const DEFAULT_DEDUPE_MS = 4000;
const WORKSPACE_ID_KEY = defineStorageKey(
    'gnosi_workspace_id',
    stringStorageCodec,
);
const _recent = new Map<string, number>(); // message → timestamp

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorProperty(error: unknown, key: string): unknown {
    return isUnknownRecord(error) ? error[key] : undefined;
}

function errorResponseProperty(error: unknown, key: string): unknown {
    const response = errorProperty(error, 'response');
    return isUnknownRecord(response) ? response[key] : undefined;
}

function errorDetail(error: unknown): unknown {
    const data = errorResponseProperty(error, 'data');
    return isUnknownRecord(data) ? data.detail : undefined;
}

function detailMessage(detail: unknown): string | null {
    if (typeof detail === 'string') return detail;
    if (!isUnknownRecord(detail)) return null;
    return typeof detail.message === 'string' ? detail.message : null;
}

function messageFromUnknown(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
}

function stringifyNotificationMessage(value: unknown): string {
    if (!value) return '';
    try {
        return Reflect.apply(String, undefined, [value]);
    } catch {
        return '';
    }
}

function _shouldShow(key: string): boolean {
    const now = Date.now();
    const last = _recent.get(key) || 0;
    if (now - last < DEFAULT_DEDUPE_MS) return false;
    _recent.set(key, now);
    // Cap the map so it can't grow without bound on a long session.
    if (_recent.size > 64) {
        const oldest = _recent.keys().next().value;
        if (oldest !== undefined) _recent.delete(oldest);
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
export function notifyError(
    scope: string,
    err: unknown,
    userMsg?: string | null,
    options: NotifyErrorOptions = {},
): void {
    const { toast = true, silent = false, persist = true } = options;
    const tag = `[${scope}]`;
    const status = errorResponseProperty(err, 'status');
    const detail = errorDetail(err);
    const baseMsg = userMsg
        || detailMessage(detail)
        || messageFromUnknown(errorProperty(err, 'message'))
        || 'Hi ha hagut un error inesperat.';

    if (!silent) {
        console.error(tag, baseMsg, err);
    }

    if (toast && !silent && _shouldShow(`${scope}|${baseMsg}`)) {
        hotToast.error(baseMsg, { duration: 5000 });
    }

    // Persists the error to the central log so it shows up in the Control Center
    // (Logs i Historial). Fire-and-forget: no esperem resposta ni bloquegem
    // the UI flow if the network goes down. Skippable with { persist: false } for
    // very noisy errors (background autosave, etc.).
    if (persist && !silent) {
        try {
            _persistNotification({
                title: `[${scope}] error`,
                message: baseMsg,
                level: 'ERROR',
            });
        } catch {
            /* no-op: the toast already informs the user */
        }
    }

    try {
        emitAppEvent('app-error', {
            scope,
            status,
            message: baseMsg,
            error: err,
        });
    } catch {
        /* no-op */
    }
}

/** Convenience for cases where we want the error logged but no toast. */
export function logError(scope: string, err: unknown): void {
    notifyError(scope, err, null, { toast: false });
}

/**
 * Logs a positive or informational event to the central log. Does NOT show a
 * toast — that is left to the caller (toast.success when needed). Intended to
 * make the Control Center have a complete history, not just errors.
 */
export function notifySuccess(scope: string, message: unknown): void {
    _persistNotification({
        title: `[${scope}]`,
        message: stringifyNotificationMessage(message),
        level: 'SUCCESS',
    });
}

export function notifyInfo(scope: string, message: unknown): void {
    _persistNotification({
        title: `[${scope}]`,
        message: stringifyNotificationMessage(message),
        level: 'INFO',
    });
}

// Exported so the toast wrapper can log `toast.error` /
// `toast.success` as Control Center entries.
export function _persistNotification({
    title,
    message,
    level,
}: PersistNotificationInput): void {
    // useApi is a React hook and cannot be used outside a component. The shared
    // typed client still applies the same request context without a hook.
    try {
        const workspaceId = readStorage(WORKSPACE_ID_KEY) || 'personal';
        void createSystemNotification(
            { title, message, level, workspace_id: workspaceId },
            true,
        ).catch(() => { /* fire-and-forget */ });
    } catch {
        /* Browser storage or network transport unavailable — ignore. */
    }
}
