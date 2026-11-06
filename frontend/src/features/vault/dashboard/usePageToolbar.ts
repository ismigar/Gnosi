import { useEffect } from 'react';
import { useOpenRecordActions } from './useOpenRecordActions';
import { tabBookmarkTarget } from './bookmark-target';
import { useVaultHome } from './useVaultHome';
import { fetchResourceProcessingStatus } from '../../../shared/api/resource-processing';
import { restoreResourceProcessingTask } from '../../literature';
import type { DashboardActions } from './useDashboardActions';
export function usePageToolbar(context: DashboardActions) {
    const home = useVaultHome(context);
    const { activeTabId, codeViewByTabId, editLockedByPageId, handleDeletePage, handleToggleFavorite, isPluginEnabled, llmWikiConfig, pages, resolvePageTableId, setCodeViewByTabId, setCommentsOpen, setEditLockedByPageId, setHistoryOpenSignal, setLlmWikiJobs, setShareOpen, setTranslatePageModalId, setTranslatePageMode, t, tabs, viewMode } = context;
    const currentOpenPage = activeTabId ? pages.find(p => p.id === activeTabId) : null;
    const currentOpenPageId = currentOpenPage?.id;
    const currentActiveTab = activeTabId ? tabs.find(t => t.id === activeTabId) : null;
    const bookmarkTarget = tabBookmarkTarget(currentActiveTab, context.activeViewId);
    const canToggleCodeView = viewMode === 'editor' && Boolean(currentActiveTab && !currentActiveTab.isTable && !currentActiveTab.isPdf);
    // The active tab can exist briefly before the pages index is refreshed.
    // Keep page actions available during that window, but never expose page
    // deletion for table or PDF tabs.
    const canDeleteCurrentPage = viewMode === 'editor'
        && Boolean(currentActiveTab?.id)
        && !currentActiveTab?.isTable
        && !currentActiveTab?.isPdf;
    const isCodeViewActive = canToggleCodeView ? Boolean(codeViewByTabId[currentActiveTab?.id || '']) : false;
    // Translate page: only for editable markdown pages (not tables or PDFs).
    const canTranslatePage = isPluginEnabled('translation') && viewMode === 'editor' && Boolean(currentOpenPage && currentActiveTab && !currentActiveTab.isTable && !currentActiveTab.isPdf);
    // GAP 2: if the open page is a record of a translatable table (and is not
    // itself a translation), the menu must translate the FIELDS into a submenu item
    // ('row' mode), not the body into a subpage. For normal pages, 'page' mode.
    const openPageTableId = currentOpenPage ? resolvePageTableId(currentOpenPage) : null;
    const llmWikiSourceConfig = (llmWikiConfig?.source_tables || []).find((source) => source.table_id === openPageTableId) || null;
    useEffect(() => {
        let alive = true;
        if (!isPluginEnabled('llm-wiki') || !currentOpenPageId || !openPageTableId || !llmWikiSourceConfig) {
            return () => { alive = false; };
        }
        // The configuration snapshot can predate a failed job. Load the durable
        // status for the open resource so interrupted work can always be resumed.
        fetchResourceProcessingStatus(currentOpenPageId, openPageTableId).then((job) => {
            if (!alive || job.phase === 'idle')
                return;
            restoreResourceProcessingTask({ noteId: currentOpenPageId, sourceTableId: openPageTableId,
                title: currentOpenPage.title, background: true }, job, t);
            setLlmWikiJobs((current) => ({
                ...current,
                [openPageTableId]: {
                    ...(current[openPageTableId] || {}),
                    [currentOpenPageId]: job,
                },
            }));
        }).catch((error: unknown) => {
            console.warn('Could not load the LLM Wiki status for the open resource:', error);
        });
        return () => { alive = false; };
    }, [currentOpenPageId, currentOpenPage?.title, isPluginEnabled, llmWikiSourceConfig, openPageTableId, setLlmWikiJobs, t]);
    // Page-level actions, formerly the VaultShell top-bar "…" menu. They now
    // render as inline icon buttons next to the page title (PageActionsBar,
    // wired through BlockEditor). The gating/handlers are unchanged — the set is
    // active-page-scoped and only the active pane's title shows the toolbar.
    const { recordActions, recordActionDialogs } = useOpenRecordActions(context, currentOpenPage, openPageTableId,
        viewMode === 'editor' && Boolean(currentActiveTab && !currentActiveTab.isTable && !currentActiveTab.isPdf));
    const pageActions = {
        recordActions,
        canSetHome: home.homeReady && Boolean(currentOpenPage) && canToggleCodeView,
        isHome: home.homeId === currentActiveTab?.id,
        onToggleHome: () => { void home.toggleHome(); },
        canGoHome: Boolean(home.homeId),
        onGoHome: home.goHome,
        canFavorite: Boolean(bookmarkTarget) && context.bookmarksReady,
        isFavorite: Boolean(bookmarkTarget && (bookmarkTarget.kind === 'page' ? context.bookmarkedPageIds.has(bookmarkTarget.target) : context.bookmarkedRoutes.has(bookmarkTarget.target))),
        onToggleFavorite: () => {
            if (!currentActiveTab?.id)
                return;
            void handleToggleFavorite(currentActiveTab.id);
        },
        canToggleEditLock: Boolean(currentActiveTab?.id) && viewMode === 'editor' && !currentActiveTab?.isPdf,
        isEditLocked: Boolean(currentActiveTab?.id && editLockedByPageId[currentActiveTab.id]),
        onToggleEditLock: () => {
            if (!currentActiveTab?.id)
                return;
            setEditLockedByPageId(prev => {
                const next = { ...prev };
                if (next[currentActiveTab.id]) {
                    Reflect.deleteProperty(next, currentActiveTab.id);
                }
                else {
                    next[currentActiveTab.id] = true;
                }
                return next;
            });
        },
        canToggleCodeView,
        isCodeView: isCodeViewActive,
        onToggleCodeView: () => {
            if (!canToggleCodeView || !currentActiveTab?.id)
                return;
            setCodeViewByTabId(prev => ({
                ...prev,
                [currentActiveTab.id]: !prev[currentActiveTab.id],
            }));
        },
        canOpenHistory: Boolean(currentOpenPage),
        onOpenHistory: () => {
            if (!currentOpenPage)
                return;
            setHistoryOpenSignal(prev => prev + 1);
        },
        canOpenComments: Boolean(currentOpenPage) && isPluginEnabled('page-comments'),
        onOpenComments: () => {
            if (!currentOpenPage)
                return;
            setCommentsOpen(true);
        },
        canOpenShare: Boolean(currentOpenPage) && isPluginEnabled('share-links'),
        onOpenShare: () => {
            if (!currentOpenPage)
                return;
            setShareOpen(true);
        },
        canTranslatePage: canTranslatePage && !openPageTableId,
        translateLabel: t('shell.translate_page', 'Translate page'),
        onTranslatePage: () => {
            if (!canTranslatePage || !currentOpenPage?.id)
                return;
            setTranslatePageMode('page');
            setTranslatePageModalId(currentOpenPage.id);
        },
        canDeleteCurrentPage,
        onDeleteCurrentPage: () => {
            if (!canDeleteCurrentPage)
                return;
            const page = currentOpenPage || currentActiveTab;
            if (!page)
                return;
            void handleDeletePage(page.id, page.title || t('common.untitled'));
        },
    };
    return { currentOpenPage, currentActiveTab, openPageTableId, pageActions, recordActionDialogs };
}
