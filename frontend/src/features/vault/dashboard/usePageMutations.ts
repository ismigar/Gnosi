import type { Metadata } from './types';
import { useCallback } from 'react';
import { tabBookmarkTarget } from './bookmark-target';
import { useBookmarks } from '../../../shared/bookmarks/useBookmarks';
import { bulkApplyVaultTemplate } from '../../../shared/api/vaults';
import { duplicateVaultPage } from '../../../shared/api/vaults';
import { patchVaultTableProperty } from '../../../shared/api/vaults';
import { patchVaultPage } from '../../../shared/api/vaults';
import { toast } from '../../../shared/notifications/toast';
import { notifyError } from '../../../shared/notifications/notifyError';
import type { Table } from './types';
import type { DashboardState } from './useDashboardState';
import type { useDataLoading } from './useDataLoading';
import type { useGlobalIndex } from './useGlobalIndex';
import type { usePageLoading } from './usePageLoading';
import type { useRecordCatalog } from './useRecordCatalog';
type Context = Pick<DashboardState, 'pagesRef' | 'activeViewId' | 'setActiveTableId' | 'setIsSchemaModalOpen' | 'setTabs' | 't' | 'tabs'> & Pick<ReturnType<typeof useDataLoading>, 'fetchPages' | 'fetchPagesByTable' | 'fetchRegistry'> & Pick<ReturnType<typeof useGlobalIndex>, 'fetchGlobalIndex'> & Pick<ReturnType<typeof usePageLoading>, 'loadPage'> & Pick<ReturnType<typeof useRecordCatalog>, 'resolvePageTableId'>;
export function usePageMutations(context: Context) {
    const { fetchGlobalIndex, fetchPages, fetchPagesByTable, fetchRegistry, loadPage, pagesRef, resolvePageTableId, setActiveTableId, setIsSchemaModalOpen, setTabs, t, tabs } = context;
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
            await patchVaultPage(pageId, { title: newTitle });
            setTabs(prev => prev.map(t => t.id === pageId
                ? { ...t, title: newTitle, metadata: { ...t.metadata, title: newTitle } }
                : t));
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
    const bookmarks = useBookmarks();
    const handleToggleFavorite = useCallback(async (pageId: string) => {
        if (!pageId || !bookmarks.isReady || bookmarks.isPending)
            return;
        const page = tabs.find(item => item.id === pageId) || pagesRef.current.find(item => item.id === pageId);
        const destination = tabBookmarkTarget(page, context.activeViewId);
        if (!page || !destination) return;
        try {
            if (destination.kind === 'page') await bookmarks.setPage(destination.target, page.title, !bookmarks.pageIds.has(destination.target));
            else await bookmarks.setRoute(destination.target, page.title, !bookmarks.routeTargets.has(destination.target));
        } catch (error) {
            notifyError('page-bookmark', error, t('bookmarks.save_failed', 'Could not save the bookmark. Try again.'));
        }
    }, [bookmarks, context.activeViewId, pagesRef, tabs, t]);
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
    return { handleDuplicatePage, handleRenamePage, handleToggleFavorite, handleEditSchema, handleAddSchemaOption, handleApplyTemplate, bookmarkedPageIds: bookmarks.pageIds, bookmarkedRoutes: bookmarks.routeTargets, bookmarksReady: bookmarks.isReady && !bookmarks.isPending };
}
