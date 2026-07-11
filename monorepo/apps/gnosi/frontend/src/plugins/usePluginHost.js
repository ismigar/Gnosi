/**
 * usePluginHost — React access to third-party plugins' contributions.
 *
 * Subscribes the component to the `host.js` store (commands, views, and panels
 * that plugins have registered) and triggers the initial plugin load a single
 * time per session. Consumers (command palette, shell, sidebar) read the
 * active contributions from it and re-render when they change.
 */
import { useEffect, useState } from 'react';
import { subscribeHost, loadPlugins, isLoaded, getContributions } from './host';

let _kickoff = null;

export function usePluginHost() {
    const [state, setState] = useState(getContributions());

    useEffect(() => {
        const unsub = subscribeHost(setState);
        if (!isLoaded() && !_kickoff) {
            _kickoff = loadPlugins().finally(() => { _kickoff = null; });
        }
        return () => { unsub(); };
    }, []);

    return state; // { commands, views, sidebar }
}

/** Forces a plugin reload (e.g. after changing permissions). */
export function reloadPlugins() {
    return loadPlugins();
}

export default usePluginHost;
