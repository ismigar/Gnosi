/**
 * toast.js
 *
 * Wrapper sobre `react-hot-toast` que afegeix persistència automàtica al
 * Control Center per a TOTES les variants de toast: `error`, `success`,
 * `loading`, `custom`, `promise` i la crida directa `toast(message)`. La
 * resta de mètodes (dismiss, remove) es deleguen sense canvis perquè no
 * generen contingut nou.
 *
 * Motivació: hi havia 200+ call sites de `toast.*` que només mostraven un
 * toast efímer. Migrar-los manualment a `notifyError` / `notifySuccess` no
 * era viable. Substituint només l'import a aquest fitxer
 * (`from 'react-hot-toast'` → `from '<path>/lib/toast'`), tots els toasts
 * ja existents queden registrats al log central sense tocar la lògica del
 * caller.
 *
 * Dedup: missatges idèntics dins d'una finestra curta no es duplican al log
 * (un autosave fallant en bucle no inflarà el Control Center amb 50 errors
 * iguals). El toast visual segueix sortint cada vegada — la dedup és només
 * per a la persistència.
 *
 * Extracció de missatge: text pla → tal qual; JSX/objectes → cerca text útil
 * (props.children, message, title) abans de caure a un placeholder. Així un
 * `toast.error(<div>Falten credencials</div>)` queda registrat com "Falten
 * credencials" i no com "[object Object]" (que a més deduparia totes les
 * crides amb JSX en una de sola).
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
 * Extreu un text representatiu del missatge del toast.
 * Cobreix: strings, números, funcions (renderer dinàmic), JSX (intentem
 * llegir `props.children` recursivament), objectes amb camps típics
 * (message/title/text). En últim recurs retorna un placeholder identificable
 * per tipus, no `[object Object]` — així evitem que tots els toasts
 * estructurats es deduplin com si fossin el mateix.
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
        // Objectes "data" típics
        for (const key of ['message', 'title', 'text', 'description', 'detail']) {
            if (typeof msg[key] === 'string' && msg[key]) return msg[key];
        }
        // Fallback: identificador per tipus de component React (no totes les
        // crides amb JSX han de col·lapsar en el mateix bucket de dedup).
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

// Funció callable: `toast('text')` ha de seguir funcionant. Persisteix com a
// INFO perquè el caller ha decidit no qualificar-ho com error/success.
const wrapped = function toast(message, options) {
    _persist('INFO', message, 'I');
    return baseToast(message, options);
};

// Copiem totes les propietats del baseToast (dismiss, remove, etc.) abans de
// sobreescriure les que volem instrumentar.
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
// resol cadascun dels tres missatges segons l'estat del promise. Persistim
// preventivament el `loading` (és el que es veu primer) i deixem que els
// callbacks `.then`/`.catch` interns de baseToast disparin success/error,
// que també passaran pel nostre wrapper si el caller fa `toast.success(...)`
// dins. Per als objectes `msgs`, registrem cadascun amb el seu nivell.
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
