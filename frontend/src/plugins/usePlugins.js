/**
 * usePlugins — estat compartit d'activació de plugins (features opcionals).
 *
 * Store mínim a nivell de mòdul amb subscripció: tots els consumidors (sidebar,
 * menú de pàgina, panell de config) llegeixen el mateix conjunt de "disabled" i
 * es re-renderitzen quan canvia. Es carrega un cop de `GET /api/vault/plugins`.
 */
import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';

let _disabled = new Set();
let _loaded = false;
let _loading = null;
const _subs = new Set();

function _notify() {
    for (const fn of _subs) fn(new Set(_disabled));
}

async function _ensureLoaded() {
    if (_loaded) return;
    if (!_loading) {
        _loading = axios.get('/api/vault/plugins')
            .then((res) => {
                _disabled = new Set(res.data?.disabled || []);
                _loaded = true;
                _notify();
            })
            .catch(() => { _loaded = true; })
            .finally(() => { _loading = null; });
    }
    return _loading;
}

export function usePlugins() {
    const [disabled, setDisabled] = useState(new Set(_disabled));

    useEffect(() => {
        const sub = (next) => setDisabled(next);
        _subs.add(sub);
        _ensureLoaded();
        return () => { _subs.delete(sub); };
    }, []);

    const isEnabled = useCallback((id) => !disabled.has(id), [disabled]);

    const setPluginEnabled = useCallback(async (id, enabled) => {
        const next = new Set(_disabled);
        if (enabled) next.delete(id); else next.add(id);
        _disabled = next;
        _notify();
        try {
            await axios.put('/api/vault/plugins', { disabled: Array.from(next) });
        } catch {
            // Revert on failure
            const reverted = new Set(_disabled);
            if (enabled) reverted.add(id); else reverted.delete(id);
            _disabled = reverted;
            _notify();
        }
    }, []);

    return { disabled, isEnabled, setPluginEnabled };
}

export default usePlugins;
