/**
 * toast.js
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
import { toast as baseToast } from 'react-hot-toast';
import { _persistNotification } from './notifyError';

export * from 'react-hot-toast';

const PERSIST_DEDUPE_MS = 4000;
const _recentPersist = new Map();

function _shouldPersist(key) {
    const now = Date.now();
    const last = _recentPersist.get(key) || 0;
    if (now - last < PERSIST_DEDUPE_MS) return false;
    _recentPersist.set(key, now);
    if (_recentPersist.size > 64) {
        const oldest = _recentPersist.keys().next().value;
        _recentPersist.delete(oldest);
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
function _msgString(msg) {
    if (msg == null) return '';
    if (typeof msg === 'string') return msg;
    if (typeof msg === 'number' || typeof msg === 'boolean') return String(msg);
    if (typeof msg === 'function') return '(dynamic)';
    if (Array.isArray(msg)) {
        return msg.map(_msgString).filter(Boolean).join(' ').trim();
    }
    if (typeof msg === 'object') {
        // Element React: { props: { children: ... } }
        if (msg.props && msg.props.children != null) {
            const childText = _msgString(msg.props.children);
            if (childText) return childText;
        }
        // Typical "data" objects
        for (const key of ['message', 'title', 'text', 'description', 'detail']) {
            if (typeof msg[key] === 'string' && msg[key]) return msg[key];
        }
        // Fallback: identifier by React component type (not all
        // calls with JSX must collapse into the same dedup bucket).
        const typeName = msg.type?.displayName || msg.type?.name
            || (typeof msg.type === 'string' ? msg.type : '');
        return typeName ? `(${typeName})` : '(object)';
    }
    try { return String(msg); } catch { return ''; }
}

function _persist(level, message, prefix) {
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
const wrapped = function toast(message, options) {
    _persist('INFO', message, 'I');
    return baseToast(message, options);
};

// We copy all properties from baseToast (dismiss, remove, etc.) before
// overwriting the ones we want to instrument.
Object.assign(wrapped, baseToast);

wrapped.error = (message, options) => {
    _persist('ERROR', message, 'E');
    return baseToast.error(message, options);
};

wrapped.success = (message, options) => {
    _persist('SUCCESS', message, 'S');
    return baseToast.success(message, options);
};

wrapped.loading = (message, options) => {
    _persist('INFO', message, 'L');
    return baseToast.loading(message, options);
};

wrapped.custom = (message, options) => {
    _persist('INFO', message, 'C');
    return baseToast.custom(message, options);
};

// `toast.promise(promise, { loading, success, error })` — react-hot-toast
// resolves each of the three messages according to the promise's state. We persist
// the `loading` one preemptively (it's the one seen first) and let the others
// internal `.then`/`.catch` callbacks of baseToast fire success/error,
// that will also pass through our wrapper if the caller calls `toast.success(...)`
// inside. For `msgs` objects, we log each one with its level.
wrapped.promise = (promise, msgs, options) => {
    if (msgs && typeof msgs === 'object') {
        if (msgs.loading) _persist('INFO', msgs.loading, 'L');
        promise
            .then((value) => {
                const m = typeof msgs.success === 'function' ? msgs.success(value) : msgs.success;
                if (m) _persist('SUCCESS', m, 'S');
            })
            .catch((err) => {
                const m = typeof msgs.error === 'function' ? msgs.error(err) : msgs.error;
                if (m) _persist('ERROR', m, 'E');
            });
    }
    return baseToast.promise(promise, msgs, options);
};

export const toast = wrapped;
export default wrapped;
