import type { Metadata } from './types';
import { text, readPage } from './readers';
import { useCallback } from 'react';
import { bulkApplyVaultTemplate } from '../../shared/api/vaults';
import { duplicateVaultPage } from '../../shared/api/vaults';
import { fetchVaultPage } from '../../shared/api/vaults';
import { patchVaultTableProperty } from '../../shared/api/vaults';
import { saveVaultPage } from '../../shared/api/vaults';
import { toast } from '../../lib/toast';
import { notifyError } from '../../lib/notifyError';
import type { Table } from './types';
import type { DashboardState } from './useDashboardState';
import type { useDataLoading } from './useDataLoading';
import type { useGlobalIndex } from './useGlobalIndex';
import type { usePageLoading } from './usePageLoading';
import type { useRecordCatalog } from './useRecordCatalog';
type Context = Pick<DashboardState, 'pagesRef' | 'setActiveTableId' | 'setIsSchemaModalOpen' | 'setPages' | 'setTabs' | 't' | 'tabs'> & Pick<ReturnType<typeof useDataLoading>, 'fetchPages' | 'fetchPagesByTable' | 'fetchRegistry'> & Pick<ReturnType<typeof useGlobalIndex>, 'fetchGlobalIndex'> & Pick<ReturnType<typeof usePageLoading>, 'loadPage'> & Pick<ReturnType<typeof useRecordCatalog>, 'resolvePageTableId'>;
export function usePageMutations(context: Context) {
    const { fetchGlobalIndex, fetchPages, fetchPagesByTable, fetchRegistry, loadPage, pagesRef, resolvePageTableId, setActiveTableId, setIsSchemaModalOpen, setPages, setTabs, t, tabs } = context;
    const handleDuplicatePage = useCallback(async (pageId: string) => {
        try {
            const duplicate = await duplicateVaultPage(pageId);
            toast.success(t('success.page_duplicated'));
            await fetchPages();
            void loadPage(duplicate.id);
        }
        catch {
            toast.error(t('errors.duplicate_page'));
        }
    }, [fetchPages, loadPage, t]);
    const handleRenamePage = useCallback(async (pageId: string, newTitle: string) => {
        try {
            const page = readPage(await fetchVaultPage(pageId));
            const { content, metadata } = page;
            const updatedMeta: Metadata = { ...metadata, title: newTitle };
            await saveVaultPage(pageId, {
                title: newTitle,
                content: content || '',
                is_database: Boolean(updatedMeta.is_database),
                parent_id: text(updatedMeta.parent_id) || null,
                metadata: updatedMeta
            });
            setTabs(prev => prev.map(t => t.id === pageId ? { ...t, title: newTitle, metadata: updatedMeta } : t));
            await fetchPages();
            // Refreshes globalIndex so the new title appears in the lookup
            // title→id (pending `[[Old title]]` wikilinks will remain
            // unmatched, but `[[Nou títol]]` will resolve correctly; the
            // backend doesn't do an automatic "rewrite" of the wikilinks
            // that already exist, either; that would require a separate job).
            void fetchGlobalIndex();
            toast.success(t('success.title_updated'));
        }
        catch {
            toast.error(t('errors.rename_page'));
        }
    }, [fetchGlobalIndex, fetchPages, setTabs, t]);
    const handleToggleFavorite = useCallback(async (pageId: string) => {
        if (!pageId)
            return;
        // Computes the new value from local state (it resolves faster than
        // a GET, and also serves as the basis for the optimistic patch that makes
        // the Favorites section appear right away in the sidebar without
        // waiting for the subsequent PUT + fetchPages).
        const currentPage = pagesRef.current.find(p => p.id === pageId)
            || tabs.find(t => t.id === pageId);
        const wasFav = currentPage?.metadata?.favorite === true
            || currentPage?.metadata?.favorite === 'true';
        const nextFav = !wasFav;
        // 1) Optimista: actualitza pages i tabs immediatament.
        setPages(prev => {
            const next = prev.map(p => p.id === pageId
                ? { ...p, metadata: { ...(p.metadata || {}), favorite: nextFav } }
                : p);
            pagesRef.current = next;
            return next;
        });
        setTabs(prevTabs => prevTabs.map(t => t.id === pageId
            ? { ...t, metadata: { ...(t.metadata || {}), favorite: nextFav } }
            : t));
        // 2) Persistence to the backend. We need the current content for the
        // PUT (not lose the note body); if the GET or the PUT fail,
        // we revert the optimistic update so as not to mislead the user.
        try {
            const page = readPage(await fetchVaultPage(pageId));
            const { content, metadata, title } = page;
            const updatedMeta: Metadata = { ...metadata, favorite: nextFav };
            await saveVaultPage(pageId, {
                title: title,
                content: content || '',
                is_database: Boolean(updatedMeta.is_database),
                parent_id: text(updatedMeta.parent_id) || null,
                metadata: updatedMeta,
            });
            // We don't wait for fetchPages (it's slow on saturated networks); the
            // optimistic patch has already refreshed the UI.
        }
        catch (err) {
            console.error(err);
            // Revertir optimista
            setPages(prev => {
                const next = prev.map(p => p.id === pageId
                    ? { ...p, metadata: { ...(p.metadata || {}), favorite: wasFav } }
                    : p);
                pagesRef.current = next;
                return next;
            });
            setTabs(prevTabs => prevTabs.map(tt => tt.id === pageId
                ? { ...tt, metadata: { ...(tt.metadata || {}), favorite: wasFav } }
                : tt));
            toast.error(t('errors.toggle_favorites'));
        }
    }, [pagesRef, tabs, setPages, setTabs, t]);
    const handleEditSchema = useCallback((table: Partial<Table> | null | undefined, tabMetadata?: Metadata) => {
        const tid = table?.id || resolvePageTableId({ metadata: tabMetadata });
        if (!tid) {
            toast(t('common.wiki_no_table'));
            return;
        }
        setActiveTableId(tid);
        setIsSchemaModalOpen(true);
    }, [resolvePageTableId, setActiveTableId, setIsSchemaModalOpen, t]);
    const handleAddSchemaOption = useCallback(async (tableId: string, fieldId: string, nextOptions: readonly unknown[]) => {
        if (!tableId || !fieldId || !Array.isArray(nextOptions))
            return;
        try {
            await patchVaultTableProperty(tableId, fieldId, {
                config: { options: nextOptions },
            });
            await fetchRegistry();
        }
        catch (err) {
            notifyError('add-schema-option', err, t('errors.add_schema_option'));
        }
    }, [fetchRegistry, t]);
    const handleApplyTemplate = useCallback(async (selectedIds: ReadonlySet<string>, templateId: string, tableId: string | null) => {
        const pageIds = [...selectedIds];
        if (pageIds.length === 0 || !templateId)
            return;
        try {
            const response = await bulkApplyVaultTemplate({
                page_ids: pageIds,
                template_id: templateId,
            });
            const updated = response.updated || 0;
            const failed = (response.errors.length || 0) + (response.conflicts.length || 0);
            if (updated > 0) {
                toast.success(t('bulk_actions.template_applied', { count: updated }));
                await fetchPagesByTable(tableId);
            }
            if (failed > 0)
                toast.error(t('bulk_actions.template_apply_partial_error', { count: failed }));
        }
        catch (error) {
            console.error('Could not apply template to selected records:', error);
            toast.error(t('bulk_actions.template_apply_error'));
        }
    }, [fetchPagesByTable, t]);
    return { handleDuplicatePage, handleRenamePage, handleToggleFavorite, handleEditSchema, handleAddSchemaOption, handleApplyTemplate };
}
