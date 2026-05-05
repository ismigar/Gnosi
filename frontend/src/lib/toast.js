/**
 * toast.js
 *
 * Wrapper sobre `react-hot-toast` que afegeix persistència automàtica al
 * Control Center per a `toast.error` i `toast.success`. La resta de mètodes
 * (toast(), toast.loading, toast.dismiss, toast.promise, toast.custom, ...)
 * es deleguen sense canvis.
 *
 * Motivació: hi havia 200+ call sites de `toast.error(...)` i `toast.success(...)`
 * que només mostraven un toast efímer. Migrar-los manualment a `notifyError` /
 * `notifySuccess` no era viable. Substituint només l'import a aquest fitxer
 * (`from 'react-hot-toast'` → `from '<path>/lib/toast'`), tots els toasts ja
 * existents queden registrats al log central sense tocar la lògica del caller.
 *
 * Dedup: missatges idèntics dins d'una finestra curta no es duplican al log
 * (un autosave fallant en bucle no inflarà el Control Center amb 50 errors
 * iguals). El toast visual segueix sortint cada vegada — la dedup és només
 * per a la persistència.
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

function _msgString(msg) {
    if (msg == null) return '';
    if (typeof msg === 'string') return msg;
    if (typeof msg === 'function') return '(dynamic)';
    try { return String(msg); } catch { return ''; }
}

// Funció callable: `toast('text')` ha de seguir funcionant.
const wrapped = function toast(message, options) {
    return baseToast(message, options);
};

// Copiem totes les propietats del baseToast (loading, dismiss, promise,
// custom, remove, etc.) abans de sobreescriure error/success.
Object.assign(wrapped, baseToast);

wrapped.error = (message, options) => {
    const msg = _msgString(message);
    if (msg && _shouldPersist(`E|${msg}`)) {
        _persistNotification({ title: 'UI error', message: msg, level: 'ERROR' });
    }
    return baseToast.error(message, options);
};

wrapped.success = (message, options) => {
    const msg = _msgString(message);
    if (msg && _shouldPersist(`S|${msg}`)) {
        _persistNotification({ title: 'UI', message: msg, level: 'SUCCESS' });
    }
    return baseToast.success(message, options);
};

export const toast = wrapped;
export default wrapped;
