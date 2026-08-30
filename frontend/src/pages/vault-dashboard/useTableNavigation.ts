import { useCallback } from 'react';
import { createVaultView } from '../../shared/api/vault-views';
import { toast } from '../../lib/toast';
import { v4 as uuidv4 } from 'uuid';
import { buildTableTabId } from './tab-model';
import { getTableIdFromTab } from './tab-model';
import type { Page } from './types';
import type { DashboardState } from './useDashboardState';
import type { useDataLoading } from './useDataLoading';
import type { useNavigationHistory } from './useNavigationHistory';
import type { useRecordCatalog } from './useRecordCatalog';
import type { useViewCatalog } from './useViewCatalog';
type Context = Pick<DashboardState, 'activeTableId' | 'isRegistryLoading' | 'pages' | 'registry' | 'setActiveTabId' | 'setActiveTableId' | 'setActiveViewId' | 'setRecordReturnFocus' | 'setSchema' | 'setTableNotes' | 'setTableTemplates' | 'setTabs' | 'setViewMode' | 'setViews' | 't' | 'tabs' | 'viewCreationInProgressRef' | 'views'> & Pick<ReturnType<typeof useDataLoading>, 'fetchPagesByTable' | 'fetchRegistry'> & Pick<ReturnType<typeof useNavigationHistory>, 'pushToHistory'> & Pick<ReturnType<typeof useRecordCatalog>, 'getSchemaFromTableId' | 'getTableVisibleRecords' | 'getVisibleTableRecords' | 'resolvePageTableId'> & Pick<ReturnType<typeof useViewCatalog>, 'buildMainViewBody' | 'getPreferredInitialViewId' | 'migrateMainViewForTable'>;
export function useTableNavigation(context: Context) {
    const { activeTableId, buildMainViewBody, fetchPagesByTable, fetchRegistry, getPreferredInitialViewId, getSchemaFromTableId, getTableVisibleRecords, getVisibleTableRecords, isRegistryLoading, migrateMainViewForTable, pages, pushToHistory, registry, resolvePageTableId, setActiveTabId, setActiveTableId, setActiveViewId, setRecordReturnFocus, setSchema, setTableNotes, setTableTemplates, setTabs, setViewMode, setViews, tabs, viewCreationInProgressRef, t } = context;
    const handleTableSelect = useCallback(async (tableId: string, viewId: string | null = null, fromHistory = false) => {
        // If a table tab is already open, switch focus to it
        const existingTableTab = tabs.find(t => t.isTable && getTableIdFromTab(t) === tableId);
        if (existingTableTab) {
            if (!fromHistory)
                pushToHistory({ type: 'table', id: tableId, subId: viewId });
            setActiveTabId(existingTableTab.id);
            setActiveTableId(tableId);
            setViewMode('editor');
            if (viewId)
                setActiveViewId(viewId);
            return;
        }
        // If the table is already the active inline view and there's no view change, do nothing
        if (!fromHistory && activeTableId === tableId && !viewId)
            return;
        if (!fromHistory) {
            pushToHistory({ type: 'table', id: tableId, subId: viewId });
        }
        setActiveTableId(tableId);
        setViewMode('table');
        setActiveTabId(null);
        // Search for notes belonging to this table.
        // Single source: resolved_table_id (backend). Legacy fallback: metadata table_id/database_table_id.
        const matchesTable = (p: Page) => {
            const resolvedTableId = resolvePageTableId(p);
            return resolvedTableId === tableId;
        };
        const filtered = getTableVisibleRecords(tableId);
        setTableNotes(filtered);
        // Search for templates for this table
        const templates = pages.filter(p => matchesTable(p) && p.metadata?.is_template);
        setTableTemplates(templates);
        void fetchPagesByTable(tableId);
        if (registry.tables.find(t => t.id === tableId)) {
            setSchema(getSchemaFromTableId(tableId));
        }
        // Get default view for table
        // Reset views state to prevent stale views from other tables
        setViews([]);
        setActiveViewId(null);
        // Find existing views in registry for this table to set as initial active view
        const tableViews = registry.views.filter(v => v.table_id === tableId);
        if (viewId) {
            setActiveViewId(viewId);
        }
        else {
            setActiveViewId(getPreferredInitialViewId(tableViews));
        }
        // Instant migration of old tables to views system: if no views
        // exist for this table, create a default one.
        //
        // The `!isRegistryLoading` guard is critical — without it, opening a
        // table while the initial /api/vault/registry fetch is still in
        // flight would see an empty `registry.views` array and trigger an
        // auto-creation, even though a main view already exists on disk.
        // That's exactly how duplicate "Vista principal" rows piled up on
        // every page reload.
        if (!isRegistryLoading &&
            Array.isArray(registry.views) &&
            tableViews.length === 0 &&
            !viewCreationInProgressRef.current.has(tableId)) {
            const defaultId = uuidv4();
            viewCreationInProgressRef.current.add(tableId);
            createVaultView({
                id: defaultId,
                table_id: tableId,
                ...buildMainViewBody(tableId),
            }).then(() => fetchRegistry()).catch((err: unknown) => { console.error("Error auto-creating view:", err); })
                .finally(() => viewCreationInProgressRef.current.delete(tableId));
        }
        else if (!isRegistryLoading && Array.isArray(registry.views) && tableViews.length > 0) {
            // Migrate an existing main view to the canonical definition.
            migrateMainViewForTable(tableId);
        }
        return Promise.resolve();
    }, [tabs, activeTableId, setActiveTableId, setViewMode, setActiveTabId, getTableVisibleRecords, setTableNotes, pages, setTableTemplates, fetchPagesByTable, registry.tables, registry.views, setViews, setActiveViewId, isRegistryLoading, viewCreationInProgressRef, pushToHistory, resolvePageTableId, setSchema, getSchemaFromTableId, getPreferredInitialViewId, buildMainViewBody, fetchRegistry, migrateMainViewForTable]);
    const returnToTableFromBreadcrumb = useCallback((tableId: string, viewId: string | null = null) => {
        setRecordReturnFocus(current => {
            if (!current || current.tableId !== tableId)
                return current;
            return { ...current, isArmed: true };
        });
        void handleTableSelect(tableId, viewId);
    }, [handleTableSelect, setRecordReturnFocus]);
    const handleOpenTableAsTab = async (tableId: string) => {
        try {
            const existingTab = tabs.find(t => t.isTable && getTableIdFromTab(t) === tableId);
            if (existingTab) {
                pushToHistory({ type: 'table', id: tableId });
                setActiveTabId(existingTab.id);
                setActiveTableId(tableId);
                setViewMode('editor');
                return;
            }
            const table = registry.tables.find(t => t.id === tableId);
            if (!table) {
                toast.error(t('errors.table_not_found'));
                return;
            }
            const newTab = {
                id: buildTableTabId(tableId),
                title: table.name || t('common.untitled'),
                isTable: true,
                tableId
            };
            setTabs(prev => (prev.some(t => t.id === newTab.id && t.isTable) ? prev : [...prev, newTab]));
            pushToHistory({ type: 'table', id: tableId });
            setActiveTabId(newTab.id);
            setViewMode('editor');
            setActiveTableId(tableId);
            // Fetch table data
            const matchesTable = (p: Page) => {
                const resolvedTableId = resolvePageTableId(p);
                return resolvedTableId === tableId;
            };
            const filtered = getVisibleTableRecords(pages, tableId);
            setTableNotes(filtered);
            const templates = pages.filter(p => matchesTable(p) && p.metadata?.is_template);
            setTableTemplates(templates);
            void fetchPagesByTable(tableId);
            setSchema(getSchemaFromTableId(tableId));
            setViews([]);
            setActiveViewId(null);
            const tableViews = registry.views.filter(v => v.table_id === tableId);
            setActiveViewId(getPreferredInitialViewId(tableViews));
            // Same guard as in handleTableOpen above: never auto-create a
            // default view while the registry is still loading — the empty
            // array there is "we don't know yet", not "no views exist".
            if (!isRegistryLoading &&
                Array.isArray(registry.views) &&
                tableViews.length === 0 &&
                !viewCreationInProgressRef.current.has(tableId)) {
                const defaultId = uuidv4();
                viewCreationInProgressRef.current.add(tableId);
                createVaultView({
                    id: defaultId,
                    table_id: tableId,
                    ...buildMainViewBody(tableId),
                }).then(() => fetchRegistry()).catch((err: unknown) => { console.error("Error auto-creating view:", err); })
                    .finally(() => viewCreationInProgressRef.current.delete(tableId));
            }
            else if (!isRegistryLoading && Array.isArray(registry.views) && tableViews.length > 0) {
                migrateMainViewForTable(tableId);
            }
        }
        catch (err) {
            console.error("Error opening the table:", err);
            toast.error(t('errors.open_table')); // Add error.open_table if missing
        }
        return Promise.resolve();
    };
    return { handleTableSelect, returnToTableFromBreadcrumb, handleOpenTableAsTab };
}
