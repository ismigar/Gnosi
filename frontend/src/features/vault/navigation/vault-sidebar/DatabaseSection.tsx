import { DatabaseBranch } from './DatabaseBranch';
import { SectionHeader } from './NavigationRows';
import type { SidebarController } from './useSidebarController';
export function DatabaseSection({ view }: { view: SidebarController; }) {
    const { t, isDatabasesExpanded, setIsDatabasesExpanded, isEditor, onCreateDatabaseGroup, visibleDatabases, databases, visibleDatabasesCount, setVisibleDatabasesCount, DATABASES_BATCH_SIZE, isRegistryLoading } = view;
    return (<>
        <SectionHeader
            label={t('sidebar.data', 'Data')}
            isExpanded={isDatabasesExpanded}
            onToggle={() => { setIsDatabasesExpanded(!isDatabasesExpanded); }}
            onAdd={() => isEditor && onCreateDatabaseGroup && onCreateDatabaseGroup()}
            addLabel={t('sidebar.add_database')}
        />
        {isDatabasesExpanded && (
            <div className="vault-sidebar__navigation-list px-2">
                {visibleDatabases.map(db => <DatabaseBranch key={db.id} db={db} view={view} />)}
                {databases.length > visibleDatabasesCount && (
                    <button
                        onClick={() => { setVisibleDatabasesCount(prev => Math.min(prev + DATABASES_BATCH_SIZE, databases.length)); }}
                        className="w-full mt-1 px-2 py-1 text-xs text-[var(--text-secondary)] border border-[var(--border-primary)] rounded hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                        {t('sidebar.show_more_databases', { count: Math.min(DATABASES_BATCH_SIZE, databases.length - visibleDatabasesCount), defaultValue: `Show more databases` })}
                    </button>
                )}
                {isRegistryLoading && (
                    <div className="px-4 py-2 text-[11px] text-[var(--text-secondary)]/60 italic">
                        {t('sidebar.loading_databases')}
                    </div>
                )}
                {!isRegistryLoading && databases.length === 0 && (
                    <div className="px-4 py-2 text-[11px] text-[var(--text-secondary)]/60 italic">
                        {t('sidebar.no_databases')}
                    </div>
                )}
            </div>
        )}
    </>);
}
