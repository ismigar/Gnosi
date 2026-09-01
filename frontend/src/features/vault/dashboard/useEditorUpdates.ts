import { useCallback } from 'react';
import { patchVaultPage } from '../../../shared/api/vaults';
import { toast } from '../../../shared/notifications/toast';
import { notifyError } from '../../../shared/notifications/notifyError';
import type { Page, EditorUpdate } from './types';
import type { VaultPagePatchInput } from '../../../shared/api/vaults';
import type { DashboardState } from './useDashboardState';
import type { useDataLoading } from './useDataLoading';
import type { useGlobalIndex } from './useGlobalIndex';
import type { useRecordCatalog } from './useRecordCatalog';
type Context = Pick<DashboardState, 'pages' | 'pagesRef' | 'setGlobalIndex' | 'setPages' | 'setTableNotes' | 'setTabs' | 'setVisibleTableRecordsById' | 't'> & Pick<ReturnType<typeof useDataLoading>, 'fetchPages' | 'fetchPagesByTable'> & Pick<ReturnType<typeof useGlobalIndex>, 'fetchGlobalIndex'> & Pick<ReturnType<typeof useRecordCatalog>, 'resolvePageTableId'>;
export function useEditorUpdates(context: Context) {
    const { fetchGlobalIndex, fetchPages, fetchPagesByTable, pages, pagesRef, resolvePageTableId, setGlobalIndex, setPages, setTableNotes, setTabs, setVisibleTableRecordsById, t } = context;
    const handleEditorUpdate = useCallback((pageId: string, content: string | undefined, payload: EditorUpdate = {}) => {
        setTabs(prevTabs => prevTabs.map(tab => {
            if (tab.id !== pageId)
                return tab;
            // If `content` is `undefined`, the editor has only updated
            // metadata (e.g. renaming the title via panel or header). We keep
            // the existing content — without this fallback, we used to lose the body
            // of the tab every time the page was renamed.
            return {
                ...tab,
                content: content !== undefined ? content : tab.content,
                title: payload.title ?? tab.title,
                metadata: payload.metadata ?? tab.metadata,
            };
        }));
        // Propagates the change to the global `pages` state and to the cache
        // `visibleTableRecordsById` so that, when returning to a view (Table,
        // Gallery, Kanban, Feed) after closing the tab, you see
        // the new title/metadata/content immediately without having to do a
        // manual refresh. Without this, the view reads from the previous cache and
        // shows stale data until the next `fetchPages`.
        const nextTitle = payload.title;
        const nextMetadata = payload.metadata;
        const applyPatch = (page: Page) => {
            const updated = { ...page };
            if (content !== undefined)
                updated.content = content;
            if (nextTitle !== undefined)
                updated.title = nextTitle;
            if (nextMetadata !== undefined)
                updated.metadata = nextMetadata;
            return updated;
        };
        setPages(prev => {
            const mutated = prev.some(page => page.id === pageId);
            if (!mutated)
                return prev;
            const next = prev.map(p => {
                if (p.id !== pageId)
                    return p;
                return applyPatch(p);
            });
            pagesRef.current = next;
            return next;
        });
        setTableNotes(prev => prev.map(p => p.id === pageId ? applyPatch(p) : p));
        if (nextTitle !== undefined) {
            setGlobalIndex(prev => ({ ...prev, [pageId]: nextTitle }));
        }
        setVisibleTableRecordsById(prev => {
            let changed = false;
            const next: Record<string, Page[]> = {};
            for (const [tableId, records] of Object.entries(prev)) {
                if (!Array.isArray(records)) {
                    next[tableId] = records;
                    continue;
                }
                const tableChanged = records.some(page => page.id === pageId);
                const mapped = records.map(p => {
                    if (p.id !== pageId)
                        return p;
                    return applyPatch(p);
                });
                if (tableChanged) {
                    changed = true;
                    next[tableId] = mapped;
                }
                else {
                    next[tableId] = records;
                }
            }
            return changed ? next : prev;
        });
    }, [pagesRef, setGlobalIndex, setPages, setTableNotes, setTabs, setVisibleTableRecordsById]);
    const handleUpdateNote = useCallback(async (id: string, data: VaultPagePatchInput) => {
        try {
            await patchVaultPage(id, data);
            await fetchPages();
            const page = pages.find(p => p.id === id);
            const tableIdOfPage = resolvePageTableId(page);
            if (tableIdOfPage)
                await fetchPagesByTable(tableIdOfPage);
        }
        catch (err) {
            notifyError('update-note', err, t('errors.save_note'));
            // Rethrow so optimistic callers (kanban/timeline) can revert their
            // move — otherwise a failed PATCH leaves the card stuck in the
            // destination column with the backend still holding the old value.
            throw err;
        }
    }, [fetchPages, fetchPagesByTable, pages, resolvePageTableId, t]);
    const handleMovePage = useCallback(async (pageId: string, newParentId: string) => {
        if (!pageId)
            return;
        if (pageId === newParentId)
            return;
        // Optimistic update of local state: the sidebar immediately reflects
        // the change while the PATCH is in flight.
        setPages(prev => prev.map(p => p.id === pageId
            ? { ...p, parent_id: newParentId, metadata: { ...(p.metadata || {}), parent_id: newParentId } }
            : p));
        try {
            await patchVaultPage(pageId, {
                parent_id: newParentId,
                metadata: { parent_id: newParentId },
            });
            toast.success(t('success.page_moved', "Page moved"));
            void fetchPages();
            // Refreshes globalIndex so title-based wikilinks keep
            // resolving correctly (idToTitle is used in BlockEditor without
            // automatic re-fetch). Without this, after a move it can remain
            // stale until the next load.
            void fetchGlobalIndex();
        }
        catch (err) {
            notifyError('move-page', err, t('errors.move_page'));
            // Roll back optimistic update on error
            void fetchPages();
        }
    }, [fetchGlobalIndex, fetchPages, setPages, t]);
    return { handleEditorUpdate, handleUpdateNote, handleMovePage };
}
