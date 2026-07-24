/**
 * usePlugins — shared plugin activation and configuration state.
 *
 * Minimal module-level store with subscription: all consumers (sidebar,
 * page menu, config panel) read the same set of "disabled" flags and
 * per-plugin "settings", and re-render when they change. It is loaded once
 * from `GET /api/vault/plugins` and persisted with `PUT /api/vault/plugins`.
 */
import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';

let _disabled = new Set();
let _settings = {};
let _loaded = false;
let _loading = null;
const _subs = new Set();

function _notify() {
    for (const fn of _subs) fn({ disabled: new Set(_disabled), settings: _settings, loaded: _loaded });
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
            .catch(() => { _loaded = true; _notify(); })
            .finally(() => { _loading = null; });
    }
    return _loading;
}

export function usePlugins() {
    const [state, setState] = useState({ disabled: new Set(_disabled), settings: _settings, loaded: _loaded });

    useEffect(() => {
        const sub = (next) => setState(next);
        _subs.add(sub);
        _ensureLoaded();
        return () => { _subs.delete(sub); };
    }, []);

    const { disabled, settings, loaded } = state;

    const isEnabled = useCallback((id) => !disabled.has(id), [disabled]);

    const setPluginEnabled = useCallback(async (id, enabled, options = {}) => {
        // LLM Wiki owns an AI profile in addition to its per-vault UI state.
        // Its lifecycle is therefore handled by one backend operation rather
        // than two client calls that could leave the feature and profile apart.
        if (id === 'llm-wiki') {
            const res = await axios.post('/api/vault/plugins/llm-wiki/lifecycle', {
                enabled,
                confirm_disable: options.confirmDisable === true,
            });
            _disabled = new Set(res.data?.disabled || []);
            _settings = (res.data?.settings && typeof res.data.settings === 'object')
                ? res.data.settings : _settings;
            _notify();
            return res.data;
        }
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

    return { disabled, settings, loaded, isEnabled, setPluginEnabled, getPluginSettings, setPluginSettings };
}

export default usePlugins;
