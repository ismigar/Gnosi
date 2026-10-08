import { useEffect, useState } from 'react';
import { currentRequestContext } from '../api/request-context';
import { fetchVaultPage } from '../api/vaults';
import { pageReferenceId, pageReferenceTitle, type PageTitleIndex } from './pageReferenceTitle';

/** Hydrate a reference missing from the current index without displaying its ID. */
export function usePageReferenceTitle(reference: string, index: PageTitleIndex, hint = '', fallback?: string): string {
    const id = pageReferenceId(reference);
    const context = currentRequestContext();
    const scope = `${context.workspaceId}:${context.vaultId}:${context.userId}`;
    const [loaded, setLoaded] = useState<{ id: string; scope: string; title: string } | null>(null);
    useEffect(() => {
        if (!/^[0-9a-f-]{36}$/iu.test(id) || index[id]) return;
        const controller = new AbortController();
        void fetchVaultPage(id, controller.signal).then(page => {
            if (controller.signal.aborted) return;
            const title = typeof page.title === 'string' ? page.title
                : (typeof page.metadata.title === 'string' ? page.metadata.title : '');
            if (title) setLoaded({ id, scope, title });
        }).catch(() => { /* Unavailable pages retain the localized placeholder. */ });
        return () => { controller.abort(); };
    }, [id, index, scope]);
    const title = loaded?.id === id && loaded.scope === scope ? loaded.title : hint;
    return pageReferenceTitle(reference, index, title, fallback);
}
