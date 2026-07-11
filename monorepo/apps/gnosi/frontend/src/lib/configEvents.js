// Global configuration invalidation system.
//
// Replaces the `window.location.reload()` that the settings modals used to
// apply after editing `params.yaml` / `.env`. Now they emit an event
// and consumers subscribe for a silent refetch.
//
// Disseny:
// - `emitConfigChanged()` fires a CustomEvent on window.
// - `useConfigChanged(callback)` listens for it and calls the callback. Captures the
//   latest version of the callback with an internal ref, so the component can
//   pass an inline function without having to wrap it with `useCallback`.
//
// When to emit: in `SettingsModal` and `GlobalSettingsModal`, after every
// successful autosave to `/api/config` or `/api/env`.
//
// When to listen: in any component that does a GET to `/api/config`
// (AgentChat, VaultGraph, Dashboard, GraphPage). Components that receive
// `config` as a prop (e.g. GraphViewer) don't need to subscribe — the
// the parent refetches and updates the state, and React repaints the child.

import { useEffect, useRef } from 'react';

const CONFIG_CHANGED = 'gnosi:config-changed';

export function emitConfigChanged() {
    window.dispatchEvent(new CustomEvent(CONFIG_CHANGED));
}

export function useConfigChanged(callback) {
    const ref = useRef(callback);
    useEffect(() => { ref.current = callback; });
    useEffect(() => {
        const handler = () => ref.current?.();
        window.addEventListener(CONFIG_CHANGED, handler);
        return () => window.removeEventListener(CONFIG_CHANGED, handler);
    }, []);
}
