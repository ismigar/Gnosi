import { useEffect, useEffectEvent } from 'react';
import { useActiveVaultId } from '../../../shared/hooks/useActiveVaultId';
import { getActiveVaultId } from '../../../shared/api/vault-context';
import { subscribeWindowEvent, subscribeDocumentEvent } from '../../../shared/platform/browser-events';

/** Refresh projections only: callers must never reload an open document. */
export function useExternalCatalogRefresh<T>(
    load: (signal: AbortSignal) => Promise<T>,
    apply: (value: T) => void,
) {
    const vaultId = useActiveVaultId();
    const loadLatest = useEffectEvent(load);
    const applyLatest = useEffectEvent(apply);
    useEffect(() => {
        let pending: AbortController | undefined;
        let disposed = false;
        const refresh = async () => {
            if (disposed || pending || document.visibilityState === 'hidden') return;
            const request = new AbortController();
            pending = request;
            try {
                const result = await loadLatest(request.signal);
                if (!request.signal.aborted && getActiveVaultId() === vaultId) {
                    applyLatest(result);
                }
            } catch {
                // Background refresh is best effort. Keep the previous catalog
                // on offline/503 errors; the next visible tick retries it.
            } finally {
                pending = undefined;
            }
        };
        const onVisible = () => { void refresh(); };
        const timer = window.setInterval(onVisible, 15_000);
        const stopFocus = subscribeWindowEvent('focus', onVisible);
        const stopVisibility = subscribeDocumentEvent('visibilitychange', onVisible);
        return () => {
            disposed = true;
            pending?.abort();
            window.clearInterval(timer);
            stopFocus();
            stopVisibility();
        };
    }, [vaultId]);
}
