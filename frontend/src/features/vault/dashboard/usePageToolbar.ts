import { useEffect } from 'react';
import { fetchResourceProcessingStatus } from '../../../shared/api/resource-processing';
import type { DashboardActions } from './useDashboardActions';
export function usePageToolbar(context: DashboardActions) {
    const { activeTabId, codeViewByTabId, editLockedByPageId, handleDeletePage, handleToggleFavorite, isPluginEnabled, llmWikiConfig, llmWikiJobs, pages, registry, resolvePageTableId, setCodeViewByTabId, setCommentsOpen, setEditLockedByPageId, setHistoryOpenSignal, setLlmWikiJobs, setResourceToProcess, setShareOpen, setTranslatePageModalId, setTranslatePageMode, t, tabs, viewMode } = context;
    const currentOpenPage = activeTabId ? pages.find(p => p.id === activeTabId) : null;
    const currentOpenPageId = currentOpenPage?.id;
    const currentActiveTab = activeTabId ? tabs.find(t => t.id === activeTabId) : null;
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
    const openPageTable = openPageTableId ? registry.tables.find(t => t.id === openPageTableId) : null;
    const openPageIsTranslatableRecord = Boolean(openPageTable?.translation_enabled)
        && !currentOpenPage?.metadata?.translation_lang;
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
    }, [currentOpenPageId, isPluginEnabled, llmWikiSourceConfig, openPageTableId, setLlmWikiJobs]);
    const llmWikiResourceJob = llmWikiJobs[openPageTableId || '']?.[currentOpenPage?.id || ''] || null;
    const llmWikiResourceRunning = Boolean(llmWikiResourceJob?.running);
    const llmWikiResourceRetryable = ['partial', 'error'].includes(llmWikiResourceJob?.phase || '');
    const llmWikiResourceProcessed = currentOpenPage?.metadata?.['Processat pel Cervell']
        || currentOpenPage?.metadata?.['processat pel cervell']
        || llmWikiConfig?.processed_resources?.[openPageTableId || '']?.[currentOpenPage?.id || ''];
    const canProcessOpenResource = isPluginEnabled('llm-wiki')
        && Boolean(llmWikiSourceConfig)
        && !llmWikiResourceRunning;
    const llmWikiResourceLabel = llmWikiResourceRetryable
        ? t('table.reprocess_resource_error', "Resume interrupted processing")
        : !llmWikiResourceProcessed
            ? t('table.process_resource', "Process resource (Brain)")
            : t('table.reprocess_resource', "Reprocess resource (processed on {{date}})", {
                date: typeof llmWikiResourceProcessed === 'number'
                    ? new Date(llmWikiResourceProcessed * 1000).toLocaleDateString()
                    : llmWikiResourceProcessed,
            });
    // Page-level actions, formerly the VaultShell top-bar "…" menu. They now
    // render as inline icon buttons next to the page title (PageActionsBar,
    // wired through BlockEditor). The gating/handlers are unchanged — the set is
    // active-page-scoped and only the active pane's title shows the toolbar.
    const pageActions = {
        canFavorite: Boolean(currentActiveTab?.id),
        isFavorite: currentActiveTab?.metadata?.favorite === true || currentActiveTab?.metadata?.favorite === 'true',
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
        canTranslatePage,
        translateLabel: openPageIsTranslatableRecord
            ? t('shell.translate_record', "Translate record")
            : t('shell.translate_page', "Translate page"),
        onTranslatePage: () => {
            if (!canTranslatePage || !currentOpenPage?.id)
                return;
            setTranslatePageMode(openPageIsTranslatableRecord ? 'row' : 'page');
            setTranslatePageModalId(currentOpenPage.id);
        },
        canProcessResource: canProcessOpenResource,
        processResourceLabel: llmWikiResourceLabel,
        onProcessResource: () => {
            if (!canProcessOpenResource || !currentOpenPage?.id || !openPageTableId)
                return;
            setResourceToProcess({
                noteId: currentOpenPage.id,
                title: currentOpenPage.title || '',
                sourceTableId: openPageTableId,
                force: Boolean(llmWikiResourceProcessed) || llmWikiResourceRetryable,
            });
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
    return { currentOpenPage, currentActiveTab, openPageTableId, pageActions };
}
