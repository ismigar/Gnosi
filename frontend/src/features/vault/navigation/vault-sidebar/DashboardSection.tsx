import { SectionHeader } from './NavigationRows';
import { PageTreeItem } from './PageTreeItem';
import type { SidebarController } from './useSidebarController';
export function DashboardSection({ view }: { view: SidebarController; }) {
    const { t, isDashboardExpanded, setIsDashboardExpanded, setExpandedDashboardNodes, isEditor, onCreateDashboardPage, dashboardRootPages, dashboardChildrenMap, expandedDashboardNodes, handleToggleDashboardExpand, activePageId, onPageSelect, onOpenParallel, onCreatePage, onRenamePage, onDuplicatePage, onDeletePage, onToggleFavorite, role, menuState, setMenuState } = view;
    return (<>
        <SectionHeader
            label={t('sidebar.dashboards', 'Dashboards')}
            isExpanded={isDashboardExpanded}
            onToggle={() => {
                setIsDashboardExpanded(prev => !prev);
                setExpandedDashboardNodes({});
            }}
            onAdd={() => isEditor && onCreateDashboardPage && onCreateDashboardPage(null)}
            addLabel={t('sidebar.add_dashboard')}
        />
        {isDashboardExpanded && (
            <div className="vault-sidebar__navigation-list px-2">
                {dashboardRootPages.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-[var(--text-secondary)]/60">{t('sidebar.no_dashboard_pages')}</div>
                ) : (
                    dashboardRootPages.map(page => (
                        <PageTreeItem
                            key={page.id}
                            page={page}
                            depth={0}
                            childrenMap={dashboardChildrenMap}
                            expandedNodes={expandedDashboardNodes}
                            onToggleExpand={handleToggleDashboardExpand}
                            activePageId={activePageId}
                            onPageSelect={onPageSelect}
                            onOpenParallel={onOpenParallel}
                            onCreatePage={onCreateDashboardPage || onCreatePage}
                            onRenamePage={onRenamePage}
                            onDuplicatePage={onDuplicatePage}
                            onDeletePage={onDeletePage}
                            onToggleFavorite={onToggleFavorite}
                            role={role}
                            menuState={menuState}
                            setMenuState={setMenuState}
                        />
                    ))
                )}
            </div>
        )}
    </>);
}
