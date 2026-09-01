import { ChevronRight, Database, MoreHorizontal, Plus } from 'lucide-react';
import type { SidebarController } from './useSidebarController';

import { TableBranch } from './TableBranch';
import type { SidebarDatabase } from './types';
export function DatabaseBranch({ view, db }: { view: SidebarController; db: SidebarDatabase ;}) {
    const { t, isEditor, tablesByDatabase, expandedDatabases, visibleTablesByDb, TABLES_BATCH_SIZE, toggleDatabase, setMenuState, onCreateTable, setVisibleTablesByDb } = view;

    const dbTables = tablesByDatabase[db.id] || [];
    const isExpanded = expandedDatabases[db.id];
    const visibleTableCount = visibleTablesByDb[db.id] || TABLES_BATCH_SIZE;
    const renderedTables = dbTables.slice(0, visibleTableCount);

    return (
        <div key={db.id} className="vault-sidebar__navigation-list">
            <div className={`vault-sidebar__navigation-row w-full flex items-center gap-2 px-2 rounded-md transition-colors group ${isExpanded ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}>
                <button onClick={() => { toggleDatabase(db.id); }} className="flex items-center gap-2 flex-1 min-w-0">
                    <ChevronRight
                        size={14}
                        className={`shrink-0 transition-transform ${isExpanded ? 'rotate-90 text-[var(--text-secondary)]/60' : 'text-[var(--text-secondary)]/40'}`}
                    />
                    <Database size={14} className="text-primary shrink-0" />
                    <span className="truncate flex-1 text-left text-[var(--text-primary)]">{db.name}</span>
                </button>

                <div className="ml-auto flex items-center justify-end w-12 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            const menuHeight = 160;
                            const windowHeight = window.innerHeight;
                            const x = Math.min(e.clientX, window.innerWidth - 170);
                            let y = e.clientY;

                            if (y + menuHeight > windowHeight) {
                                y = Math.max(10, windowHeight - menuHeight - 10);
                            }

                            setMenuState({
                                id: db.id,
                                type: 'database',
                                name: db.name,
                                x,
                                y
                            });
                        }}
                        className="vault-sidebar-icon-action p-0.5 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-secondary)]/60"
                        title={t('sidebar.options')}
                        aria-label={t('sidebar.options')}
                    >
                        <MoreHorizontal size={14} />
                    </button>
                    {isEditor && (
                        <button
                            className="vault-sidebar-icon-action p-0.5 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-secondary)]/60 hover:text-gnosi"
                            onClick={(e) => { e.stopPropagation(); if (onCreateTable) onCreateTable(db.id); }}
                            title={t('sidebar.new_table')}
                            aria-label={t('sidebar.new_table')}
                        >
                            <Plus size={14} />
                        </button>
                    )}
                </div>
            </div>

            {isExpanded && (
                <div className="vault-sidebar__navigation-list ml-4 border-l border-[var(--border-primary)] pl-1">
                    {renderedTables.map(table => <TableBranch key={table.id} table={table} view={view} />)}
                    {dbTables.length > visibleTableCount && (
                        <button
                            onClick={() => { setVisibleTablesByDb(prev => ({
                                ...prev,
                                [db.id]: Math.min((prev[db.id] || TABLES_BATCH_SIZE) + TABLES_BATCH_SIZE, dbTables.length)
                            })); }}
                            className="ml-2 mt-1 px-2 py-1 text-[11px] text-[var(--text-secondary)] border border-[var(--border-primary)] rounded hover:bg-[var(--bg-secondary)] transition-colors"
                        >
                            {t('sidebar.show_more_tables', { count: Math.min(TABLES_BATCH_SIZE, dbTables.length - visibleTableCount) })}
                        </button>
                    )}
                    {dbTables.length === 0 && (
                        <div className="px-2 py-1 text-[11px] text-[var(--text-secondary)]/60 italic">{t('sidebar.no_tables')}</div>
                    )}
                </div>
            )}
        </div>
    );

}
