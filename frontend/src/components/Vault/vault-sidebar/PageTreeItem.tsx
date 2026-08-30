import { ChevronDown, ChevronRight, FileText, MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRenderer } from '../IconRenderer';
import { PageContextMenu } from './PageContextMenu';
import { blocksMove, decodePageMove } from './model';
import type { PageTreeItemProps } from './types';
export const PageTreeItem = (props: PageTreeItemProps) => {
    const {
        page,
        depth = 0,
        role,
        childrenMap,
        expandedNodes,
        onToggleExpand,
        activePageId,
        onPageSelect,
        onOpenParallel,
        onCreatePage,
        onRenamePage,
        onDuplicatePage,
        onDeletePage,
        onToggleFavorite,
        onMovePage,
        menuState,
        setMenuState,
        canCreateChild = true,
        isDragLocked = false,
    } = props;
    const { t } = useTranslation();
    const isViewer = role === 'viewer';
    const isAdmin = role === 'admin' || role === 'owner';
    const isEditor = role === 'editor' || isAdmin;
    const children = childrenMap[page.id] || [];
    const hasChildren = children.length > 0;
    const isExpanded = Boolean(expandedNodes[page.id]);
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(page.title);
    const [isDropTarget, setIsDropTarget] = useState(false);
    const isActive = activePageId === page.id;
    const canReorder = !isDragLocked && !isViewer && typeof onMovePage === 'function';

    const isMenuOpen = menuState?.id === page.id;

    const handleRenameSubmit = () => {
        if (renameValue.trim() && renameValue !== page.title && onRenamePage) {
            onRenamePage(page.id, renameValue.trim());
        } else {
            setRenameValue(page.title);
        }
        setIsRenaming(false);
    };

    return (
        <div className="select-none relative">
            <div
                data-vault-page-id={page.id}
                title={page.title}
                className={`vault-sidebar__navigation-row group flex items-center gap-1 rounded-md transition-colors cursor-pointer ${isActive ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]/50'} ${isDropTarget ? 'ring-2 ring-[var(--gnosi-primary)]/50 bg-[var(--gnosi-primary)]/10' : ''}`}
                style={{ paddingLeft: `${String(depth * 12 + 8)}px`, paddingRight: '8px' }}
                onClick={() => {
                    if (!isRenaming) onPageSelect(page.id);
                }}
                // Intentional exception to the app-wide @dnd-kit pattern: the
                // page tree keeps native HTML5 drag & drop because dropping
                // ONTO a row re-parents the page (nested hierarchy by
                // parent_id, not a flat reorder), and the same drag must stay
                // droppable into the editor as a wikilink via dataTransfer.
                // Neither fits dnd-kit's flat sortable model. The favorites
                // list (flat) does use dnd-kit — see SortableFavoriteItem.
                draggable={!isRenaming && canReorder}
                onDragStart={(e) => {
                    // Double protocol in the dataTransfer:
                    //   - 'application/gnosi-note': legacy format (we insert the ID
                    //     as a wikilink inside the editor when dropped on a note)
                    //   - 'application/gnosi-page-move': new, indicates that we are
                    //     reordering the sidebar tree (parent_id change)
                    e.dataTransfer.setData('application/gnosi-note', JSON.stringify({
                        id: page.id,
                        title: page.title
                    }));
                    if (canReorder) {
                        e.dataTransfer.setData('application/gnosi-page-move', JSON.stringify({
                            id: page.id,
                            currentParentId: page.parent_id || null,
                        }));
                    }
                    e.dataTransfer.effectAllowed = canReorder ? 'copyMove' : 'copy';
                }}
                onDragOver={canReorder ? (e) => {
                    // We only accept drops from the same sidebar (not from the editor)
                    if (!Array.from(e.dataTransfer.types).includes('application/gnosi-page-move')) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (!isDropTarget) setIsDropTarget(true);
                } : undefined}
                onDragLeave={canReorder ? () => {
                    if (isDropTarget) setIsDropTarget(false);
                } : undefined}
                onDrop={canReorder ? (e) => {
                    if (!Array.from(e.dataTransfer.types).includes('application/gnosi-page-move')) return;
                    e.preventDefault();
                    setIsDropTarget(false);
                    try {
                        const raw = e.dataTransfer.getData('application/gnosi-page-move');
                        if (!raw) return;
                        const sourceId = decodePageMove(raw);
                        if (!sourceId || sourceId === page.id || blocksMove(sourceId, page.id, childrenMap)) return;
                        onMovePage(sourceId, page.id);
                    } catch { /* malformed external drag data is ignored */ }
                } : undefined}
                onDragEnd={() => { setIsDropTarget(false); }}
            >
                <button
                    className="vault-sidebar-icon-action p-0.5 hover:bg-[var(--bg-secondary)] rounded shrink-0 mr-1 text-[var(--text-secondary)]/60"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (onToggleExpand) onToggleExpand(page.id);
                    }}
                    style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
                    title={t(isExpanded ? 'sidebar.collapse_children' : 'sidebar.expand_children', {
                        name: page.title,
                    })}
                    aria-label={t(isExpanded ? 'sidebar.collapse_children' : 'sidebar.expand_children', {
                        name: page.title,
                    })}
                >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>

                {page.metadata?.icon ? (
                    <IconRenderer icon={page.metadata.icon} size={16} className="mr-1 mt-0.5" />
                ) : (
                    <FileText size={14} className={`shrink-0 mr-1 mt-0.5 ${isActive ? 'text-gnosi' : 'text-[var(--text-secondary)]/60'}`} />
                )}

                {isRenaming ? (
                    <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => { setRenameValue(e.target.value); }}
                        onBlur={handleRenameSubmit}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                handleRenameSubmit();
                            } else if (e.key === 'Escape') {
                                setRenameValue(page.title);
                                setIsRenaming(false);
                            }
                        }}
                        className="flex-1 bg-[var(--bg-primary)] border border-gnosi rounded px-1 text-sm outline-none text-[var(--text-primary)] w-full min-w-0"
                        onClick={(e) => { e.stopPropagation(); }}
                    />
                ) : (
                    <span className="truncate flex-1">{page.title}</span>
                )}

                {/* Hover actions to add child pages or context menu */}
                <div className={`ml-auto flex items-center justify-end w-12 shrink-0 transition-opacity ${isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} bg-transparent pl-1`}>
                    <button
                        className="vault-sidebar-icon-action p-0.5 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-secondary)]/60"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (isMenuOpen) {
                                setMenuState(null);
                            } else {
                                const menuHeight = 240;
                                const windowHeight = window.innerHeight;
                                const x = Math.min(e.clientX, window.innerWidth - 170);
                                let y = e.clientY;

                                // If it doesn't fit below, move it up slightly
                                if (y + menuHeight > windowHeight) {
                                    y = Math.max(10, windowHeight - menuHeight - 10);
                                }

                                setMenuState({
                                    id: page.id,
                                    x,
                                    y
                                });
                            }
                        }}
                        title={t('sidebar.options')}
                    >
                        <MoreHorizontal size={14} />
                    </button>
                    {canCreateChild && isEditor && (
                        <button
                            className="vault-sidebar-icon-action p-0.5 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-secondary)]/60"
                            onClick={(e) => { e.stopPropagation(); onCreatePage(page.id); }}
                            title={t('sidebar.add_child_page')}
                        >
                            <Plus size={14} />
                        </button>
                    )}
                </div>
            </div>

            <PageContextMenu {...props} onRename={() => { setIsRenaming(true); }} />

            {isExpanded && hasChildren && (
                <div className="vault-sidebar__navigation-list mt-0.5">
                    {children.map(child => (
                        <PageTreeItem
                            key={child.id}
                            page={child}
                            depth={depth + 1}
                            role={role}
                            childrenMap={childrenMap}
                            expandedNodes={expandedNodes}
                            onToggleExpand={onToggleExpand}
                            activePageId={activePageId}
                            onPageSelect={onPageSelect}
                            onOpenParallel={onOpenParallel}
                            onCreatePage={onCreatePage}
                            onRenamePage={onRenamePage}
                            onDuplicatePage={onDuplicatePage}
                            onDeletePage={onDeletePage}
                            onToggleFavorite={onToggleFavorite}
                            onMovePage={onMovePage}
                            menuState={menuState}
                            setMenuState={setMenuState}
                            canCreateChild={canCreateChild}
                            isDragLocked={isDragLocked}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
