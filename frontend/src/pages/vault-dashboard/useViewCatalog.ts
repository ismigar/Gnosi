import { useCallback } from 'react';
import { updateVaultView } from '../../shared/api/vault-views';
import { MAIN_VIEW_NAME } from '../../components/Vault/viewConstants';
import { isMainView } from '../../components/Vault/viewConstants';
import { isProtectedMainView } from '../../components/Vault/viewConstants';
import type { View } from './types';
import type { DashboardState } from './useDashboardState';
import type { useDataLoading } from './useDataLoading';
type Context = Pick<DashboardState, 'registry' | 'viewCreationInProgressRef' | 'views'> & Pick<ReturnType<typeof useDataLoading>, 'fetchRegistry'>;
export function useViewCatalog(context: Context) {
    const { fetchRegistry, registry, viewCreationInProgressRef, views } = context;
    const buildMainViewBody = useCallback((tableId: string | null): Partial<View> & {
        name: string;
        type: string;
        visibleProperties: string[];
    } => {
        const table = registry.tables.find(t => t.id === tableId);
        const propNames = (table?.properties || []).map(p => p.name).filter((name): name is string => Boolean(name)).filter(n => n !== 'title');
        const sort = { field: 'title', direction: 'asc' };
        return {
            name: table?.name || MAIN_VIEW_NAME,
            type: 'table',
            sort,
            sorts: [{ ...sort }],
            filters: [],
            filter: null,
            filterTree: null,
            groupBy: null,
            group_by: null,
            groupSort: null,
            group_sort: null,
            groupSortDir: 'asc',
            group_sort_dir: 'asc',
            visibleProperties: ['title', ...propNames],
            is_main: true,
        };
    }, [registry.tables]);
    const ensureMainViewForTable = useCallback((tableViews: readonly View[] = [], tableId: string | null = null): View[] => {
        if (tableViews.length === 0) {
            return [{
                    id: 'default',
                    table_id: tableId,
                    ...buildMainViewBody(tableId),
                }];
        }
        return tableViews.map(v => {
            if (!isProtectedMainView(v)) {
                return { ...v, is_main: isMainView(v, tableViews) };
            }
            return {
                ...v,
                ...buildMainViewBody(tableId),
                id: v.id,
                table_id: v.table_id || tableId,
                is_main: true,
            };
        });
    }, [buildMainViewBody]);
    const migrateMainViewForTable = useCallback((tableId: string | null) => {
        if (!tableId)
            return;
        const tableViews = registry.views.filter(v => v.table_id === tableId);
        const mainView = tableViews.find(v => isMainView(v, tableViews));
        if (!mainView || mainView.id === 'default')
            return; // virtual, not persisted
        const canonical = buildMainViewBody(tableId);
        const needsMigration = Object.entries(canonical).some(([key, value]) => JSON.stringify(mainView[key]) !== JSON.stringify(value));
        if (!needsMigration)
            return;
        if (viewCreationInProgressRef.current.has(`migrate-${tableId}`))
            return;
        viewCreationInProgressRef.current.add(`migrate-${tableId}`);
        updateVaultView(mainView.id, {
            ...mainView,
            ...canonical,
            id: mainView.id,
            table_id: tableId,
        })
            .then(() => fetchRegistry())
            .catch((err: unknown) => { console.error("Error migrating main view:", err); })
            .finally(() => viewCreationInProgressRef.current.delete(`migrate-${tableId}`));
    }, [registry.views, buildMainViewBody, viewCreationInProgressRef, fetchRegistry]);
    const getTableViews = useCallback((tableId: string | null) => {
        const persisted = registry.views.filter(v => v.table_id === tableId);
        const localOnly = views.filter(v => v.table_id === tableId && !persisted.find(pv => pv.id === v.id));
        const allViews = [...persisted, ...localOnly];
        // Returns all views (including embedded/dashboard ones). VaultViewsHeader filters
        // visible tab strip views using isViewHidden, but keeps all views in the "+" management panel
        // so users can manage and unhide dashboard views as table tabs.
        return ensureMainViewForTable(allViews, tableId);
    }, [registry.views, views, ensureMainViewForTable]);
    const sidebarViews = [
        ...registry.views,
        ...registry.tables
            .filter(table => {
            const tableViews = registry.views.filter(view => view.table_id === table.id);
            return !tableViews.some(view => isMainView(view, tableViews));
        })
            .map(table => ({
            id: 'default',
            table_id: table.id,
            ...buildMainViewBody(table.id),
        })),
    ];
    const getPreferredInitialViewId = useCallback((tableViews: readonly View[] = []) => {
        if (tableViews.length === 0)
            return 'default';
        const normalized = ensureMainViewForTable(tableViews);
        const preferredView = normalized.find(v => v.is_main) || normalized.find(v => v.type === 'table') || normalized[0];
        return preferredView?.id || 'default';
    }, [ensureMainViewForTable]);
    return { buildMainViewBody, ensureMainViewForTable, migrateMainViewForTable, getTableViews, sidebarViews, getPreferredInitialViewId };
}
