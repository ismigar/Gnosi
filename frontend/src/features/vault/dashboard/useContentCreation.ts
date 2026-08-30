import React from 'react';
import { useCallback } from 'react';
import { saveDrawing } from '../../../shared/api/drawings';
import { createVaultPage } from '../../../shared/api/vaults';
import { createVaultDatabase } from '../../../shared/api/vaults';
import { createVaultTable } from '../../../shared/api/vaults';
import { createVaultView } from '../../../shared/api/vault-views';
import { updateVaultView } from '../../../shared/api/vault-views';
import { toast } from '../../../shared/notifications/toast';
import { v4 as uuidv4 } from 'uuid';
import type { ViewDraft } from './types';
import { readTable } from './readers';
import type { DashboardState } from './useDashboardState';
import type { useDataLoading } from './useDataLoading';
import type { useNavigationHistory } from './useNavigationHistory';
import type { usePageLoading } from './usePageLoading';
import type { useViewCatalog } from './useViewCatalog';
type Context = Pick<DashboardState, 'activeTableId' | 'i18n' | 'onViewConfigSavedRef' | 'promptModal' | 'registry' | 'setActiveTabId' | 'setActiveViewId' | 'setIsViewConfigOpen' | 'setPromptModal' | 'setTabs' | 'setViewMode' | 'setViewToConfigure' | 't' | 'views'> & Pick<ReturnType<typeof useDataLoading>, 'fetchPages' | 'fetchRegistry'> & Pick<ReturnType<typeof useNavigationHistory>, 'pushToHistory'> & Pick<ReturnType<typeof usePageLoading>, 'loadPage'> & Pick<ReturnType<typeof useViewCatalog>, 'buildMainViewBody'>;
export function useContentCreation(context: Context) {
    const { activeTableId, buildMainViewBody, fetchPages, fetchRegistry, i18n, loadPage, onViewConfigSavedRef, promptModal, pushToHistory, registry, setActiveTabId, setActiveViewId, setIsViewConfigOpen, setPromptModal, setTabs, setViewMode, setViewToConfigure, t, } = context;
    const closePromptModal = useCallback(() => {
        setPromptModal({
            isOpen: false,
            defaultTitle: '',
            parentId: null,
            isDatabase: false,
            isDrawing: false,
            isDashboard: false,
            isView: false,
            isRename: false,
            isTemplate: false,
            targetView: null,
            viewType: null,
            inputValue: '',
            isLoading: false
        });
    }, [setPromptModal]);
    const handleConfigureView = useCallback((view: ViewDraft, onSaved?: (view: ViewDraft) => unknown) => {
        onViewConfigSavedRef.current = onSaved;
        setViewToConfigure(view);
        setIsViewConfigOpen(true);
        // if view is an existing one, pendingView remains null
    }, [onViewConfigSavedRef, setIsViewConfigOpen, setViewToConfigure]);
    const handleAddView = (type: string) => {
        // Templates follow the prompt flow (they are not a view).
        if (type === 'template') {
            setPromptModal({
                isOpen: true,
                defaultTitle: t('common.new_template'),
                parentId: null,
                isDatabase: false,
                isDrawing: false,
                isView: false,
                isTemplate: true,
                inputValue: '',
                isLoading: false
            });
            return;
        }
        // Normal view: opens the PageViewModal to create the view directly.
        handleConfigureView({ type: type || 'table', name: '' });
    };
    const handleOpenCreatePrompt = (parentId: string | null = null, isDatabase = false, isDrawing = false, isDashboard = false) => {
        let defaultTitle = isDatabase ? t('common.new_database') : t('common.new_page');
        if (isDrawing)
            defaultTitle = t('common.new_drawing');
        if (isDashboard)
            defaultTitle = t('common.new_dashboard');
        setPromptModal({
            isOpen: true,
            defaultTitle,
            parentId,
            isDatabase,
            isDrawing,
            isDashboard,
            isView: false,
            isRename: false,
            targetView: null,
            viewType: null,
            inputValue: defaultTitle,
            isLoading: false
        });
    };
    const executeCreateContent = async (e?: React.SyntheticEvent) => {
        if (e)
            e.preventDefault();
        const { inputValue, parentId, isDatabase, isDrawing, isDashboard, isRename, isTemplate, templateTableId, isApp, databaseId } = promptModal;
        const title = inputValue.trim();
        if (!title) {
            closePromptModal();
            return;
        }
        try {
            setPromptModal(prev => ({ ...prev, isLoading: true }));
            if (isTemplate) {
                const created = await createVaultPage({
                    title: title,
                    content: ``,
                    is_database: false,
                    metadata: {
                        is_template: true,
                        table_id: templateTableId || activeTableId,
                        database_table_id: templateTableId || activeTableId
                    }
                });
                await fetchPages();
                toast.success(t('success.template_created')); // Add success.template_created
                void loadPage(created.id);
            }
            else if (isApp) {
                await createVaultDatabase({ name: title });
                await fetchRegistry();
                toast.success(t('success.app_created', { name: title }));
            }
            else if (isRename) {
                const view = promptModal.targetView;
                if (!view)
                    throw new Error("No view selected for renaming");
                const viewId = view.id;
                const isDefault = viewId === 'default' || !registry.views.find(v => v.id === viewId);
                const updated = { ...view, name: title };
                if (isDefault) {
                    const newView = {
                        ...view,
                        ...buildMainViewBody(view.table_id || activeTableId),
                        id: uuidv4(),
                        table_id: view.table_id || activeTableId,
                        name: title,
                        order: 0,
                    };
                    await createVaultView(newView);
                    setActiveViewId(newView.id);
                }
                else if (viewId) {
                    await updateVaultView(viewId, updated);
                }
                await fetchRegistry();
                toast.success(t('success.view_renamed'));
            }
            else if (isDrawing) {
                const drawingId = uuidv4();
                await saveDrawing(drawingId, {
                    title: title,
                    data: {},
                    metadata: {}
                });
                setActiveTabId(drawingId);
                setViewMode('drawing');
                setTabs(prev => (prev.some(t => t.id === drawingId) ? prev : [...prev, { id: drawingId, title: title, isDrawing: true }]));
                pushToHistory({ type: 'drawing', id: drawingId });
            }
            else if (isDatabase && databaseId) {
                // Table inside a Database (App)
                const table = readTable(await createVaultTable({
                    name: title,
                    database_id: databaseId,
                    locale: i18n.resolvedLanguage || i18n.language,
                    properties: [{ name: "Status", type: "select" }]
                }));
                await createVaultView({
                    id: uuidv4(),
                    table_id: table.id,
                    ...buildMainViewBody(table.id),
                });
                await fetchRegistry();
                toast.success(t('success.table_created', { name: title }));
            }
            else {
                const created = await createVaultPage({
                    title: title,
                    content: isDashboard ? '{\n  \n}' : ``,
                    parent_id: parentId,
                    is_database: isDatabase,
                    metadata: isDashboard
                        ? {
                            is_dashboard: true,
                            content_format: 'json',
                        }
                        : undefined,
                });
                await fetchPages();
                void loadPage(created.id);
            }
            closePromptModal();
        }
        catch {
            toast.error(t('errors.create_content'));
            setPromptModal(prev => ({ ...prev, isLoading: false }));
        }
    };
    return { closePromptModal, handleConfigureView, handleAddView, handleOpenCreatePrompt, executeCreateContent };
}
