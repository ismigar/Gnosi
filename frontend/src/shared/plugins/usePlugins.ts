/** Shared, versioned plugin activation and configuration state. */
import { useCallback, useEffect, useState } from 'react';
import {
    fetchPluginState,
    setPluginLifecycle,
    type PluginState,
} from '../api/plugins';
import { updatePluginSettings } from '../api/plugin-runtime';
import { subscribeAppEvent } from '../platform/app-events';
import { getActiveVaultId } from '../api/vault-context';
import { GnosiApiError } from '../api/errors';

import { BUILTIN_PLUGINS } from './registry';
import type { BuiltinPluginDefinition } from './registry';

export const PLUGIN_BOOTSTRAP_TIMEOUT_MS = 10_000;

type UnknownRecord = Record<string, unknown>;

interface PluginSnapshot {
    authenticationRequired?: true;
    builtins: readonly (BuiltinPluginDefinition | UnknownRecord)[];
    disabled: Set<string>;
    enabledBuiltin: Set<string>;
    enabledThirdParty: Set<string>;
    loaded: boolean;
    loadError: boolean;
    settings: Readonly<Record<string, unknown>>;
}

interface PluginLifecycleOptions {
    confirmDependencies?: boolean;
    confirmDisable?: boolean;
}

export interface PluginsState extends PluginSnapshot {
    getPluginSettings: (id: string) => unknown;
    isEnabled: (id: string) => boolean;
    reload: () => Promise<PluginSnapshot>;
    setPluginEnabled: (
        id: string,
        enabled: boolean,
        options?: PluginLifecycleOptions,
    ) => Promise<PluginState>;
    setPluginSettings: (
        id: string,
        patch: Readonly<Record<string, unknown>>,
    ) => Promise<void>;
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const EMPTY_STATE: PluginSnapshot = {
    disabled: new Set<string>(),
    enabledBuiltin: new Set<string>(),
    enabledThirdParty: new Set<string>(),
    settings: {},
    builtins: BUILTIN_PLUGINS,
    loaded: false,
    loadError: false,
};

let _state = EMPTY_STATE;
let _stateVaultId = getActiveVaultId();
let _loadGeneration = 0;
let _loading: Promise<PluginSnapshot> | null = null;
let _loadingController: AbortController | null = null;
const _subs = new Set<(state: PluginSnapshot) => void>();

function _snapshot(payload: PluginState = {}): PluginSnapshot {
    return {
        disabled: new Set(payload.disabled || []),
        enabledBuiltin: new Set(payload.enabled_builtin || []),
        enabledThirdParty: new Set(payload.enabled_third_party || []),
        settings: payload.settings && typeof payload.settings === 'object'
            ? payload.settings : {},
        builtins: Array.isArray(payload.builtins) && payload.builtins.length
            ? payload.builtins : BUILTIN_PLUGINS,
        loaded: true,
        loadError: false,
    };
}

function _notify(): void {
    for (const subscriber of _subs) subscriber(_state);
}

function _apply(payload: PluginState): PluginSnapshot {
    _state = _snapshot(payload);
    _notify();
    return _state;
}

function _syncActiveVault(): void {
    const vaultId = getActiveVaultId();
    if (_stateVaultId === vaultId) return;
    _stateVaultId = vaultId;
    _loadGeneration += 1;
    _loadingController?.abort();
    _loadingController = null;
    _loading = null;
    _state = EMPTY_STATE;
    _notify();
}

function _isCurrentVault(generation: number, vaultId: string): boolean {
    return generation === _loadGeneration && vaultId === getActiveVaultId();
}

async function _fetchPluginStateWithTimeout(controller: AbortController): Promise<PluginState> {
    let clearRequestTimeout = (): void => undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
        const timeoutId = setTimeout(() => {
            controller.abort();
            reject(new DOMException('Plugin request timed out', 'TimeoutError'));
        }, PLUGIN_BOOTSTRAP_TIMEOUT_MS);
        clearRequestTimeout = () => {
            clearTimeout(timeoutId);
        };
    });
    try {
        return await Promise.race([
            fetchPluginState(controller.signal),
            timeout,
        ]);
    } finally {
        clearRequestTimeout();
    }
}

async function _load(force = false): Promise<PluginSnapshot> {
    _syncActiveVault();
    if (_state.loaded && !force) return _state;
    if (!_loading) {
        const generation = _loadGeneration;
        const vaultId = _stateVaultId;
        const controller = new AbortController();
        const isCurrent = () => _isCurrentVault(generation, vaultId);
        const pending = _fetchPluginStateWithTimeout(controller)
            .then((payload) => isCurrent() ? _apply(payload) : _state)
            .catch((error: unknown) => {
                // A failed read is not evidence that every plugin was disabled.
                if (isCurrent()) {
                    _state = { ..._state, loadError: true };
                    // Preserve an explicit authentication denial through later
                    // transport errors until a successful read or vault switch.
                    if (error instanceof GnosiApiError && error.status === 401
                        && isRecord(error.payload)
                        && error.payload.detail === 'Authentication required') {
                        _state.authenticationRequired = true;
                    }
                    _notify();
                }
                return _state;
            })
            .finally(() => {
                if (_loading !== pending) return;
                _loading = null;
                _loadingController = null;
            });
        _loading = pending;
        _loadingController = controller;
    }
    return _loading;
}

export function reloadPluginState(): Promise<PluginSnapshot> {
    return _load(true);
}

export function usePlugins(): PluginsState {
    const [state, setState] = useState(() => (
        _stateVaultId === getActiveVaultId() ? _state : EMPTY_STATE
    ));

    useEffect(() => {
        _subs.add(setState);
        void _load();
        const refresh = () => {
            // All subscribers to one vault switch share the same new request.
            _syncActiveVault();
            void _load(true);
        };
        const unsubscribeVault = subscribeAppEvent('gnosi:vault-changed', refresh);
        return () => {
            _subs.delete(setState);
            unsubscribeVault();
        };
    }, []);

    const isEnabled = useCallback((id: string) => (
        state.enabledBuiltin.has(id) || state.enabledThirdParty.has(id)
    ), [state.enabledBuiltin, state.enabledThirdParty]);

    const setPluginEnabled = useCallback(async (
        id: string,
        enabled: boolean,
        options: PluginLifecycleOptions = {},
    ) => {
        _syncActiveVault();
        const generation = _loadGeneration;
        const vaultId = _stateVaultId;
        const payload = await setPluginLifecycle(id, {
            enabled,
            confirm_dependencies: options.confirmDependencies === true,
            confirm_disable: options.confirmDisable === true,
        });
        if (_isCurrentVault(generation, vaultId)) _apply(payload);
        return payload;
    }, []);

    const getPluginSettings = useCallback(
        (id: string): unknown => state.settings[id] || {},
        [state.settings],
    );

    const setPluginSettings = useCallback(async (
        id: string,
        patch: Readonly<Record<string, unknown>>,
    ): Promise<void> => {
        _syncActiveVault();
        const generation = _loadGeneration;
        const vaultId = _stateVaultId;
        const previous = _state;
        const current = _state.settings[id];
        const merged = { ...(isRecord(current) ? current : {}), ...patch };
        _state = {
            ..._state,
            settings: { ..._state.settings, [id]: merged },
        };
        _notify();
        try {
            const response = await updatePluginSettings(id, patch);
            if (!_isCurrentVault(generation, vaultId)) return;
            _state = {
                ..._state,
                settings: {
                    ..._state.settings,
                    [id]: response.settings,
                },
            };
            _notify();
        } catch (error) {
            if (_isCurrentVault(generation, vaultId)) {
                _state = previous;
                _notify();
            }
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
