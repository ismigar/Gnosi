/**
 * usePlugins — estat compartit d'activació i configuració de plugins.
 *
 * Store mínim a nivell de mòdul amb subscripció: tots els consumidors (sidebar,
 * menú de pàgina, panell de config) llegeixen el mateix conjunt de "disabled" i
 * els "settings" per-plugin, i es re-renderitzen quan canvien. Es carrega un cop
 * de `GET /api/vault/plugins` i es persisteix amb `PUT /api/vault/plugins`.
 */
import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';

let _disabled = new Set();
let _settings = {};
let _loaded = false;
let _loading = null;
const _subs = new Set();

function _notify() {
    for (const fn of _subs) fn({ disabled: new Set(_disabled), settings: _settings });
}

function _persist() {
    return axios.put('/api/vault/plugins', {
        disabled: Array.from(_disabled),
        settings: _settings,
    });
}

async function _ensureLoaded() {
    if (_loaded) return;
    if (!_loading) {
        _loading = axios.get('/api/vault/plugins')
            .then((res) => {
                _disabled = new Set(res.data?.disabled || []);
                _settings = (res.data?.settings && typeof res.data.settings === 'object')
                    ? res.data.settings : {};
                _loaded = true;
                _notify();
            })
            .catch(() => { _loaded = true; })
            .finally(() => { _loading = null; });
    }
    return _loading;
}

export function usePlugins() {
    const [state, setState] = useState({ disabled: new Set(_disabled), settings: _settings });

    useEffect(() => {
        const sub = (next) => setState(next);
        _subs.add(sub);
        _ensureLoaded();
        return () => { _subs.delete(sub); };
    }, []);

    const { disabled, settings } = state;

    const isEnabled = useCallback((id) => !disabled.has(id), [disabled]);

    const setPluginEnabled = useCallback(async (id, enabled) => {
        const prev = new Set(_disabled);
        const next = new Set(_disabled);
        if (enabled) next.delete(id); else next.add(id);
        _disabled = next;
        _notify();
        try {
            await _persist();
        } catch {
            _disabled = prev; // Revert on failure
            _notify();
        }
    }, []);

    const getPluginSettings = useCallback((id) => settings?.[id] || {}, [settings]);

    const setPluginSettings = useCallback(async (id, patch) => {
        const prev = _settings;
        const merged = { ...(_settings[id] || {}), ...(patch || {}) };
        _settings = { ..._settings, [id]: merged };
        _notify();
        try {
            await _persist();
        } catch {
            _settings = prev; // Revert on failure
            _notify();
        }
    }, []);

    return { disabled, settings, isEnabled, setPluginEnabled, getPluginSettings, setPluginSettings };
}

export default usePlugins;
