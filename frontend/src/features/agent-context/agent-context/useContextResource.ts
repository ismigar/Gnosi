import { useEffect, useState, useSyncExternalStore } from 'react';
import { currentRequestContext } from '../../../shared/api/request-context';
import { subscribeAppEvent } from '../../../shared/platform/app-events';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';

const contextKey = (): string => {
    const { vaultId, workspaceId, userId } = currentRequestContext();
    return JSON.stringify([vaultId, workspaceId, userId]);
};
const subscribe = (notify: () => void): (() => void) => {
    const stops = [
        subscribeAppEvent('gnosi:vault-changed', notify),
        subscribeAppEvent('gnosi:config-changed', notify),
        subscribeWindowEvent('storage', notify),
    ];
    return () => { stops.forEach(stop => { stop(); }); };
};
export const useContextKey = (): string => useSyncExternalStore(subscribe, contextKey, contextKey);

export interface ContextResource<T> {
    readonly data: T | null;
    readonly error: boolean;
    readonly loading: boolean;
}
export function useContextResource<T>(
    load: (signal: AbortSignal) => Promise<T>,
    enabled: boolean,
    revision = 0,
): ContextResource<T> {
    const context = useContextKey();
    const key = `${context}:${String(revision)}`;
    const [result, setResult] = useState<{ key: string; data: T | null; error: boolean } | null>(null);
    const current = result?.key === key ? result : null;
    const settled = current !== null;
    useEffect(() => {
        if (!enabled || settled) return;
        const controller = new AbortController();
        void load(controller.signal).then(data => {
            if (!controller.signal.aborted && context === contextKey()) setResult({ key, data, error: false });
        }).catch(() => {
            if (!controller.signal.aborted && context === contextKey()) setResult({ key, data: null, error: true });
        });
        return () => { controller.abort(); };
    }, [load, enabled, settled, key, context]);
    return { data: current?.data ?? null, error: current?.error ?? false, loading: enabled && !settled };
}
