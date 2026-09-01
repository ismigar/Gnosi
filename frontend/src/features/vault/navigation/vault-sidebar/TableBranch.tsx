import { ChevronDown, ChevronRight, FileText, Hash, LayoutPanelLeft, MoreHorizontal, Plus } from 'lucide-react';
import { PageTreeItem } from './PageTreeItem';
import type { SidebarController } from './useSidebarController';

import type { SidebarTable } from './types';

export function TableBranch({ view, table }: { view: SidebarController; table: SidebarTable ;}) {
    const { t, isEditor, setMenuState, viewsByTable, dataChildrenMap, expandedTableSections, toggleTableExpand, expandedTables, onOpenTable, onTableSelect, activeTableId, onCreateTableRecord, toggleTableSection, role, expandedWikiNodes, setExpandedWikiNodes, activePageId, onPageSelect, onOpenParallel, onCreatePage, onRenamePage, onDuplicatePage, onDeletePage, onToggleFavorite, menuState, tableAllowsSubitems } = view;

    const tableViews = viewsByTable[table.id] || [];
    const tableRecords = dataChildrenMap[table.id]?.roots || [];
    const hasContent = tableRecords.length > 0;
    const hasViews = tableViews.length > 0;
    const hasTableSections = hasContent || hasViews;
    const contentKey = `${table.id}:content`;
    const viewsKey = `${table.id}:views`;
    const isContentExpanded = Boolean(expandedTableSections[contentKey]);
    const isViewsExpanded = Boolean(expandedTableSections[viewsKey]);
    return (
        <div key={table.id} className="w-full flex flex-col gap-0.5">
            <div className="vault-sidebar__navigation-row vault-sidebar__navigation-row--compact w-full flex items-center gap-1 px-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors group/tableItem">
                <button
                    className="vault-sidebar-icon-action p-0.5 hover:bg-[var(--bg-secondary)] rounded shrink-0 text-[var(--text-secondary)]/60"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (hasTableSections) toggleTableExpand(table.id);
                    }}
                    style={{ visibility: hasTableSections ? 'visible' : 'hidden' }}
                    title={t(expandedTables[table.id] ? 'sidebar.collapse_children' : 'sidebar.expand_children', {
                        name: table.name,
                    })}
                    aria-label={t(expandedTables[table.id] ? 'sidebar.collapse_children' : 'sidebar.expand_children', {
                        name: table.name,
                    })}
                >
                    {expandedTables[table.id] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <button
                    onClick={() => {
                        if (onOpenTable) onOpenTable(table.id);
                        else if (onTableSelect) onTableSelect(table.id);
                    }}
                    className={`flex items-center gap-2 flex-1 min-w-0 ${activeTableId === table.id ? 'text-gnosi font-medium' : ''}`}
                >
                    <LayoutPanelLeft size={13} className="text-gnosi-accent shrink-0" />
                    <span className="truncate">{table.name}</span>
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        const menuHeight = 280;
                        const windowHeight = window.innerHeight;
                        const x = Math.min(e.clientX, window.innerWidth - 170);
                        let y = e.clientY;

                        if (y + menuHeight > windowHeight) {
                            y = Math.max(10, windowHeight - menuHeight - 10);
                        }

                        setMenuState({
                            id: table.id,
                            type: 'table',
                            name: table.name,
                            x,
                            y
                        });
                    }}
                    className="vault-sidebar-icon-action opacity-0 group-hover/tableItem:opacity-100 p-0.5 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-secondary)]"
                    title={t('sidebar.options')}
                    aria-label={t('sidebar.options')}
                >
                    <MoreHorizontal size={12} />
                </button>
                {isEditor && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (onCreateTableRecord) onCreateTableRecord(table.id);
                        }}
                        className="vault-sidebar-icon-action opacity-0 group-hover/tableItem:opacity-100 p-0.5 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-secondary)] hover:text-gnosi"
                        title={t('sidebar.new_record')}
                        aria-label={t('sidebar.new_record')}
                    >
                        <Plus size={12} />
                    </button>
                )}
            </div>

            {expandedTables[table.id] && hasTableSections && (
                <div className="ml-5 border-l border-[var(--border-primary)] pl-2 flex flex-col gap-0.5 mt-0.5 mb-1">
                    {hasContent && (
                        <div>
                            <button
                                type="button"
                                onClick={() => { toggleTableSection(table.id, 'content'); }}
                                aria-expanded={isContentExpanded}
                                className="vault-sidebar__navigation-row vault-sidebar__navigation-row--detail w-full flex items-center gap-1.5 px-2 font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded transition-colors text-left"
                            >
                                {isContentExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                <FileText size={11} className="shrink-0" />
                                <span>{t('sidebar.content')}</span>
                            </button>
                            {isContentExpanded && (
                                <div className="ml-3 border-l border-[var(--border-primary)] pl-1 mt-0.5">
                                    {tableRecords.map(p => (
                                        <PageTreeItem
                                            key={p.id}
                                            page={p}
                                            depth={1}
                                            childrenMap={dataChildrenMap[table.id]?.children || {}}
                                            role={role}
                                            expandedNodes={expandedWikiNodes}
                                            onToggleExpand={(id) => { setExpandedWikiNodes(prev => ({ ...prev, [id]: !prev[id] })); }}
                                            activePageId={activePageId}
                                            onPageSelect={onPageSelect}
                                            onOpenParallel={onOpenParallel}
                                            onCreatePage={onCreatePage}
                                            onRenamePage={onRenamePage}
                                            onDuplicatePage={onDuplicatePage}
                                            onDeletePage={onDeletePage}
                                            onToggleFavorite={onToggleFavorite}
                                            menuState={menuState}
                                            setMenuState={setMenuState}
                                            canCreateChild={Boolean(tableAllowsSubitems[table.id])}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {hasViews && (
                        <div>
                            <button
                                type="button"
                                onClick={() => { toggleTableSection(table.id, 'views'); }}
                                aria-expanded={isViewsExpanded}
                                className="vault-sidebar__navigation-row vault-sidebar__navigation-row--detail w-full flex items-center gap-1.5 px-2 font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded transition-colors text-left"
                            >
                                {isViewsExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                <LayoutPanelLeft size={11} className="shrink-0" />
                                <span>{t('sidebar.views')}</span>
                            </button>
                            {isViewsExpanded && (
                                <div className="ml-3 border-l border-[var(--border-primary)] pl-1 mt-0.5">
                                    {tableViews.map(view => (
                                        <button
                                            key={view.id}
                                            onClick={() => {
                                                if (onTableSelect) onTableSelect(table.id, view.id);
                                            }}
                                            className="vault-sidebar__navigation-row vault-sidebar__navigation-row--detail flex items-center gap-2 px-2 text-[var(--text-secondary)] hover:text-gnosi hover:bg-[var(--bg-secondary)] rounded transition-colors text-left w-full"
                                        >
                                            <Hash size={10} className="shrink-0" />
                                            <span className="truncate">{view.name}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );

}
