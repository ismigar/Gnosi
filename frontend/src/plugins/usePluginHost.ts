/**
 * usePluginHost — React access to third-party plugins' contributions.
 *
 * Subscribes the component to the `host.js` store (commands, views, and panels
 * that plugins have registered) and triggers the initial plugin load a single
 * time per session. Consumers (command palette, shell, sidebar) read the
 * active contributions from it and re-render when they change.
 */
import { useEffect, useState } from 'react';
import { subscribeAppEvent } from '../shared/platform/app-events';
import {
    subscribeHost,
    loadPlugins,
    isLoaded,
    getContributions,
    type PluginHostContributions,
} from './host';

let _kickoff: Promise<void> | null = null;

function kickoffPluginLoad(): Promise<void> {
    if (!_kickoff) {
        _kickoff = loadPlugins().finally(() => { _kickoff = null; });
    }
    return _kickoff;
}

export function usePluginHost(): PluginHostContributions {
    const [state, setState] = useState(getContributions());

    useEffect(() => {
        const unsub = subscribeHost(setState);
        if (!isLoaded()) void kickoffPluginLoad();
        const refresh = () => { void kickoffPluginLoad(); };
        const unsubscribeVault = subscribeAppEvent('gnosi:vault-changed', refresh);
        return () => {
            unsub();
            unsubscribeVault();
        };
    }, []);

    return state; // { commands, views, sidebar, settingsPanels }
}

/** Forces a plugin reload (e.g. after changing permissions). */
export function reloadPlugins(): Promise<void> {
    return kickoffPluginLoad();
}

export default usePluginHost;
