/**
 * toast.ts
 *
 * Wrapper around `react-hot-toast` that adds automatic persistence to the
 * Control Center for ALL toast variants: `error`, `success`,
 * `loading`, `custom`, `promise`, and the direct `toast(message)` call. The
 * remaining methods (dismiss, remove) are delegated unchanged because they don't
 * generate new content.
 *
 * Motivation: there were 200+ `toast.*` call sites that only showed an
 * ephemeral toast. Manually migrating them to `notifyError` / `notifySuccess` wasn't
 * viable. Only replacing the import in this file
 * (`from 'react-hot-toast'` → `from '<path>/lib/toast'`), all toasts
 * already in place get registered in the central log without touching the caller's
 * logic.
 *
 * Dedup: identical messages within a short window aren't duplicated in the log
 * (an autosave failing in a loop won't flood the Control Center with 50 identical
 * errors). The visual toast still shows up every time — the dedup is only
 * for persistence.
 *
 * Message extraction: plain text → as-is; JSX/objects → look for useful text
 * (props.children, message, title) before falling back to a placeholder. That way a
 * `toast.error(<div>Falten credencials</div>)` gets logged as "Falten
 * credencials" and not as "[object Object]" (which would also dedupe all
 * calls with JSX into a single one).
 */
import { resolveValue, toast as baseToast } from 'react-hot-toast';
import type {
    DefaultToastOptions,
    Renderable,
    Toast,
    ToastOptions,
    ValueOrFunction,
} from 'react-hot-toast';
import { _persistNotification } from './notifyError';

export * from 'react-hot-toast';

const PERSIST_DEDUPE_MS = 4000;
const _recentPersist = new Map<string, number>();

type PersistPrefix = 'C' | 'E' | 'I' | 'L' | 'S';
type ToastMessage = ValueOrFunction<Renderable, Toast>;

interface PromiseToastMessages<T> {
    readonly error?: ValueOrFunction<Renderable, unknown>;
    readonly loading: Renderable;
    readonly success?: ValueOrFunction<Renderable, T>;
}

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function _shouldPersist(key: string): boolean {
    const now = Date.now();
    const last = _recentPersist.get(key) || 0;
    if (now - last < PERSIST_DEDUPE_MS) return false;
    _recentPersist.set(key, now);
    if (_recentPersist.size > 64) {
        const oldest = _recentPersist.keys().next().value;
        if (oldest !== undefined) _recentPersist.delete(oldest);
    }
    return true;
}

/**
 * Extracts a representative text from the toast message.
 * Covers: strings, numbers, functions (dynamic renderer), JSX (we try
 * to read `props.children` recursively), objects with typical fields
 * (message/title/text). As a last resort, returns a placeholder identifiable
 * by type, not `[object Object]` — this way we avoid all structured
 * toasts being deduped as if they were the same.
 */
function _msgString(msg: unknown): string {
    if (msg == null) return '';
    if (typeof msg === 'string') return msg;
    if (typeof msg === 'number' || typeof msg === 'boolean') return String(msg);
    if (typeof msg === 'function') return '(dynamic)';
    if (Array.isArray(msg)) {
        return msg.map(_msgString).filter(Boolean).join(' ').trim();
    }
    if (isUnknownRecord(msg)) {
        // Element React: { props: { children: ... } }
        const props = isUnknownRecord(msg.props) ? msg.props : null;
        if (props?.children != null) {
            const childText = _msgString(props.children);
            if (childText) return childText;
        }
        // Typical "data" objects
        for (const key of ['message', 'title', 'text', 'description', 'detail']) {
            const value = msg[key];
            if (typeof value === 'string' && value) return value;
        }
        // Fallback: identifier by React component type (not all
        // calls with JSX must collapse into the same dedup bucket).
        const type = msg.type;
        const typeName = typeof type === 'string'
            ? type
            : typeof type === 'function'
                ? type.name
                : isUnknownRecord(type) && typeof type.displayName === 'string'
                    ? type.displayName
                    : '';
        return typeName ? `(${typeName})` : '(object)';
    }
    if (typeof msg === 'bigint' || typeof msg === 'symbol') return msg.toString();
    return '';
}

function _persist(level: string, message: unknown, prefix: PersistPrefix): void {
    const msg = _msgString(message);
    if (!msg) return;
    const key = `${prefix}|${msg}`;
    if (!_shouldPersist(key)) return;
    _persistNotification({
        title: prefix === 'E' ? 'UI error'
            : prefix === 'S' ? 'UI success'
            : prefix === 'L' ? 'UI loading'
            : 'UI',
        message: msg,
        level,
    });
}

// Callable function: `toast('text')` must keep working. Persists as
// INFO because the caller decided not to qualify it as error/success.
const wrapped = Object.assign(function toast(
    message: ToastMessage,
    options?: ToastOptions,
): string {
    _persist('INFO', message, 'I');
    return baseToast(message, options);
}, baseToast);

// We copy all properties from baseToast (dismiss, remove, etc.) before
// overwriting the ones we want to instrument.
wrapped.error = (message: ToastMessage, options?: ToastOptions): string => {
    _persist('ERROR', message, 'E');
    return baseToast.error(message, options);
};

wrapped.success = (message: ToastMessage, options?: ToastOptions): string => {
    _persist('SUCCESS', message, 'S');
    return baseToast.success(message, options);
};

wrapped.loading = (message: ToastMessage, options?: ToastOptions): string => {
    _persist('INFO', message, 'L');
    return baseToast.loading(message, options);
};

wrapped.custom = (message: ToastMessage, options?: ToastOptions): string => {
    _persist('INFO', message, 'C');
    return baseToast.custom(message, options);
};

// `toast.promise(promise, { loading, success, error })` — react-hot-toast
// resolves each of the three messages according to the promise's state. We persist
// the `loading` one preemptively (it's the one seen first) and let the others
// internal `.then`/`.catch` callbacks of baseToast fire success/error,
// that will also pass through our wrapper if the caller calls `toast.success(...)`
// inside. For `msgs` objects, we log each one with its level.
wrapped.promise = <T>(
    promise: Promise<T> | (() => Promise<T>),
    msgs: PromiseToastMessages<T>,
    options?: DefaultToastOptions,
): Promise<T> => {
    const pending = typeof promise === 'function' ? promise() : promise;
    if (msgs.loading) _persist('INFO', msgs.loading, 'L');
    void pending
        .then((value) => {
            const m = msgs.success ? resolveValue(msgs.success, value) : undefined;
            if (m) _persist('SUCCESS', m, 'S');
        })
        .catch((err: unknown) => {
            const m = msgs.error ? resolveValue(msgs.error, err) : undefined;
            if (m) _persist('ERROR', m, 'E');
        });
    return baseToast.promise(pending, msgs, options);
};

export const toast: typeof baseToast = wrapped;
export default toast;
