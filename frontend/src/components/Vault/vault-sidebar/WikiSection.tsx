import { ChevronDown, ChevronRight, Lock, Plus, Unlock } from 'lucide-react';
import { PageTreeItem } from './PageTreeItem';
import type { SidebarController } from './useSidebarController';
export function WikiSection({ view }: { view: SidebarController; }) {
    const { isWorkspaceExpanded, t, setIsWikiDragLocked, isWikiDragLocked, isEditor, onCreatePage, isRegistryLoading, rootPages, wikiVirtualizationEnabled, wikiTopSpacerHeight, virtualWikiRootPages, visibleRootPages, childrenMap, expandedWikiNodes, handleToggleWikiExpand, activePageId, onPageSelect, onOpenParallel, onRenamePage, onDuplicatePage, onDeletePage, onToggleFavorite, onMovePage, role, menuState, setMenuState, wikiBottomSpacerHeight, visibleWikiCount, setVisibleWikiCount, WIKI_BATCH_SIZE, toggleWorkspace } = view;
    return (<>
        <div className="group relative flex items-center px-3 mt-6 mb-1">
            <button
                onClick={toggleWorkspace}
                aria-expanded={isWorkspaceExpanded}
                className="gnosi-sidebar-section-title flex-1 min-w-0 flex items-center gap-1 transition-colors text-left"
            >
                {isWorkspaceExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {t('sidebar.wiki', 'Wiki')}
            </button>
            <div className="flex items-center gap-0.5">
                <button
                    onClick={() => { setIsWikiDragLocked((v) => !v); }}
                    className={`vault-sidebar-icon-action p-0.5 rounded transition-all ${isWikiDragLocked
                            ? 'opacity-60 hover:opacity-100 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                            : 'opacity-100 text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 hover:bg-[var(--gnosi-primary)]/20'
                        }`}
                    title={isWikiDragLocked ? t('sidebar.wiki_unlock', "Unlock to reorder (drag&drop)") : t('sidebar.wiki_lock', "Lock dragging")}
                    aria-label={isWikiDragLocked ? t('sidebar.wiki_unlock', "Unlock to reorder (drag&drop)") : t('sidebar.wiki_lock', "Lock dragging")}
                >
                    {isWikiDragLocked ? <Lock size={12} /> : <Unlock size={12} />}
                </button>
                {isEditor && (
                    <button
                        onClick={() => onCreatePage(null)}
                        className="vault-sidebar-icon-action opacity-0 group-hover:opacity-100 p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] rounded transition-all"
                        title={t('sidebar.add_wiki_page')}
                        aria-label={t('sidebar.add_wiki_page')}
                    >
                        <Plus size={14} />
                    </button>
                )}
            </div>
        </div>
        {isWorkspaceExpanded && (
            <div
                className="vault-sidebar__navigation-list px-2"
            >
                {isRegistryLoading ? (
                    <div className="px-3 py-2 text-xs text-[var(--text-secondary)]/60">{t('common.loading')}</div>
                ) : rootPages.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-[var(--text-secondary)]/60">{t('sidebar.no_wiki_pages')}</div>
                ) : (
                    <>
                        {wikiVirtualizationEnabled && wikiTopSpacerHeight > 0 && (
                            <div style={{ height: `${String(wikiTopSpacerHeight)}px` }} aria-hidden="true" />
                        )}

                        {(wikiVirtualizationEnabled ? virtualWikiRootPages : visibleRootPages).map(page => (
                            <PageTreeItem
                                key={page.id}
                                page={page}
                                depth={0}
                                childrenMap={childrenMap}
                                expandedNodes={expandedWikiNodes}
                                onToggleExpand={handleToggleWikiExpand}
                                activePageId={activePageId}
                                onPageSelect={onPageSelect}
                                onOpenParallel={onOpenParallel}
                                onCreatePage={onCreatePage}
                                onRenamePage={onRenamePage}
                                onDuplicatePage={onDuplicatePage}
                                onDeletePage={onDeletePage}
                                onToggleFavorite={onToggleFavorite}
                                onMovePage={onMovePage}
                                role={role}
                                menuState={menuState}
                                setMenuState={setMenuState}
                                isDragLocked={isWikiDragLocked}
                            />
                        ))}

                        {wikiVirtualizationEnabled && wikiBottomSpacerHeight > 0 && (
                            <div style={{ height: `${String(wikiBottomSpacerHeight)}px` }} aria-hidden="true" />
                        )}

                        {!wikiVirtualizationEnabled && rootPages.length > visibleWikiCount && (
                            <button
                                onClick={() => { setVisibleWikiCount(prev => Math.min(prev + WIKI_BATCH_SIZE, rootPages.length)); }}
                                className="btn-gnosi btn-gnosi-primary !text-[10px] !py-1 w-full mt-1"
                            >
                                {t('sidebar.show_more', { count: Math.min(WIKI_BATCH_SIZE, rootPages.length - visibleWikiCount) })}
                            </button>
                        )}
                    </>
                )}
            </div>
        )}
    </>);
}
