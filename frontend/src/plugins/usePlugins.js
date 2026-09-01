/** Shared, versioned plugin activation and configuration state. */
import { useCallback, useEffect, useState } from 'react';
import {
    fetchPluginState,
    setPluginLifecycle,
} from '../shared/api/plugins';
import { updatePluginSettings } from '../shared/api/plugin-runtime';

import { BUILTIN_PLUGINS } from './registry';

const EMPTY_STATE = {
    disabled: new Set(),
    enabledBuiltin: new Set(),
    enabledThirdParty: new Set(),
    settings: {},
    builtins: BUILTIN_PLUGINS,
    loaded: false,
};

let _state = EMPTY_STATE;
let _loading = null;
const _subs = new Set();

function _snapshot(payload = {}) {
    return {
        disabled: new Set(payload.disabled || []),
        enabledBuiltin: new Set(payload.enabled_builtin || []),
        enabledThirdParty: new Set(payload.enabled_third_party || []),
        settings: payload.settings && typeof payload.settings === 'object'
            ? payload.settings : {},
        builtins: Array.isArray(payload.builtins) && payload.builtins.length
            ? payload.builtins : BUILTIN_PLUGINS,
        loaded: true,
    };
}

function _notify() {
    for (const subscriber of _subs) subscriber(_state);
}

function _apply(payload) {
    _state = _snapshot(payload);
    _notify();
    return _state;
}

async function _load(force = false) {
    if (_state.loaded && !force) return _state;
    if (!_loading) {
        _loading = fetchPluginState()
            .then((payload) => _apply(payload || {}))
            .catch(() => {
                _state = { ...EMPTY_STATE, loaded: true };
                _notify();
                return _state;
            })
            .finally(() => { _loading = null; });
    }
    return _loading;
}

export function reloadPluginState() {
    return _load(true);
}

export function usePlugins() {
    const [state, setState] = useState(_state);

    useEffect(() => {
        _subs.add(setState);
        void _load();
        const refresh = () => {
            _state = EMPTY_STATE;
            _notify();
            void _load(true);
        };
        window.addEventListener('gnosi:vault-changed', refresh);
        return () => {
            _subs.delete(setState);
            window.removeEventListener('gnosi:vault-changed', refresh);
        };
    }, []);

    const isEnabled = useCallback((id) => (
        state.enabledBuiltin.has(id) || state.enabledThirdParty.has(id)
    ), [state.enabledBuiltin, state.enabledThirdParty]);

    const setPluginEnabled = useCallback(async (id, enabled, options = {}) => {
        const payload = await setPluginLifecycle(id, {
            enabled,
            confirm_dependencies: options.confirmDependencies === true,
            confirm_disable: options.confirmDisable === true,
        });
        _apply(payload || {});
        return payload;
    }, []);

    const getPluginSettings = useCallback(
        (id) => state.settings?.[id] || {},
        [state.settings],
    );

    const setPluginSettings = useCallback(async (id, patch) => {
        const previous = _state;
        const merged = { ...(_state.settings?.[id] || {}), ...(patch || {}) };
        _state = {
            ..._state,
            settings: { ..._state.settings, [id]: merged },
        };
        _notify();
        try {
            const response = await updatePluginSettings(id, patch || {});
            _state = {
                ..._state,
                settings: {
                    ..._state.settings,
                    [id]: response.settings || merged,
                },
            };
            _notify();
        } catch (error) {
            _state = previous;
            _notify();
            throw error;
        }
    }, []);

    return {
        ...state,
        isEnabled,
        setPluginEnabled,
        getPluginSettings,
        setPluginSettings,
        reload: reloadPluginState,
    };
}

export default usePlugins;
