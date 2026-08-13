import React, { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../hooks/use-api';
import { useActiveVaultName } from '../../hooks/useActiveVaultName';
import { createPortal } from 'react-dom';
import {
    DndContext, closestCenter, PointerSensor, KeyboardSensor,
    useSensor, useSensors
} from '@dnd-kit/core';
import {
    SortableContext, verticalListSortingStrategy,
    useSortable, arrayMove, sortableKeyboardCoordinates
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Search, Star, FileText, Plus, ChevronRight, ChevronDown, Clock, Inbox, Settings, MoreHorizontal, Edit2, Copy, Trash2, Database, LayoutPanelLeft, Palette, Hash, Columns2, ArrowUpDown, ArrowDownAZ, ArrowUpAZ, Check, GripVertical, Lock, Unlock, CalendarDays, LocateFixed } from 'lucide-react';
import { IconRenderer } from './IconRenderer';
import { ConfirmModal } from '../ConfirmModal';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { sortKey } from '../../utils/vaultFilters';
import { buildVaultSidebarTrees } from './vaultSidebarTree';

// Alphabetical favorites keep titles beginning with a number or underscore in
// a dedicated priority group: first in A → Z and last in Z → A.
const compareFavoriteTitles = (aTitle, bTitle, direction) => {
    const a = String(aTitle ?? '').trim();
    const b = String(bTitle ?? '').trim();
    const aPriority = /^[\d_]/u.test(a);
    const bPriority = /^[\d_]/u.test(b);

    if (aPriority !== bPriority) {
        const priorityFirst = direction === 'asc';
        return aPriority === priorityFirst ? -1 : 1;
    }

    const comparison = sortKey(a).localeCompare(sortKey(b), 'en', { sensitivity: 'base' });
    return direction === 'asc' ? comparison : -comparison;
};

const RenamePromptModal = ({ isOpen, type, defaultValue, onClose, onConfirm }) => {
    const { t } = useTranslation();
    const modalRef = useRef(null);
    const inputRef = useRef(null);
    const [value, setValue] = useState(defaultValue || '');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setValue(defaultValue || '');
            setIsSubmitting(false);
            const id = setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 30);
            return () => clearTimeout(id);
        }
    }, [isOpen, defaultValue]);

    const submit = async () => {
        const trimmed = value.trim();
        if (!trimmed || isSubmitting) return;
        if (trimmed === (defaultValue || '')) { onClose(); return; }
        try {
            setIsSubmitting(true);
            await onConfirm(trimmed);
        } finally {
            setIsSubmitting(false);
        }
    };

    useModalKeyboard({
        isOpen,
        onClose: () => { if (!isSubmitting) onClose(); },
        onConfirm: submit,
        confirmDisabled: isSubmitting || !value.trim(),
        containerRef: modalRef,
        trapFocus: true,
    });

    if (!isOpen) return null;

    const title = type === 'database'
        ? t('sidebar.rename_db_title', "Rename database")
        : t('sidebar.rename_table_title', "Rename table");
    const label = type === 'database'
        ? t('sidebar.prompt_new_name_db', "New name for the database")
        : t('sidebar.prompt_new_name_table', "New name for the table");

    return createPortal(
        <div
            className="fixed inset-0 flex items-center justify-center"
            style={{ zIndex: 'var(--z-confirm-modal)' }}
            onClick={() => { if (!isSubmitting) onClose(); }}
            role="dialog"
            aria-modal="true"
        >
            <div className="absolute inset-0 bg-[var(--bg-primary)]/40 backdrop-blur-sm transition-opacity" />
            <div
                ref={modalRef}
                onClick={(e) => e.stopPropagation()}
                className="relative bg-[var(--bg-primary)] rounded-2xl shadow-xl w-full max-w-sm overflow-hidden transform transition-all animate-in fade-in zoom-in-95 duration-200 p-6 border border-[var(--border-primary)]"
            >
                <div className="flex justify-between items-start mb-4">
                    <div className="p-3 rounded-full flex-shrink-0 bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)]">
                        <Edit2 size={20} />
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="gnosi-close-btn"
                        aria-label={t('common.cancel', "Cancel")}
                    >
                        <span aria-hidden>×</span>
                    </button>
                </div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">{title}</h3>
                <label className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                    {label}
                </label>
                <input
                    ref={inputRef}
                    data-autofocus="true"
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-blue)]/30 mb-6"
                />
                <div className="flex items-center justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="px-4 py-2 font-medium text-[var(--text-secondary)] border border-[var(--border-primary)] rounded-lg hover:bg-[var(--bg-secondary)] transition-colors focus:ring-2 focus:ring-[var(--border-primary)] outline-none"
                    >
                        {t('common.cancel', "Cancel")}
                    </button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={isSubmitting || !value.trim()}
                        className="px-4 py-2 font-medium rounded-lg text-white shadow-sm transition-colors focus:ring-2 focus:ring-offset-1 outline-none bg-[var(--gnosi-blue)] hover:opacity-90 focus:ring-[var(--gnosi-blue)]/50 disabled:opacity-50"
                    >
                        {isSubmitting ? '...' : t('common.save', "Save")}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

const NavItem = ({ icon: Icon, label, onClick, isActive, colorClass = "text-[var(--text-secondary)]", emoji, rightElement, indented = false }) => (
    <button
        onClick={onClick}
        className={`vault-sidebar__navigation-row group w-full flex items-center gap-2 ${indented ? 'vault-sidebar__navigation-row--tree-leaf' : 'px-3'} rounded-md transition-colors ${isActive ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
    >
        {emoji ? (
            <IconRenderer icon={emoji} size={16} />
        ) : (
            <Icon size={16} className={isActive ? 'text-gnosi' : colorClass} />
        )}
        <span className="truncate flex-1 text-left">{label}</span>
        {rightElement && <div>{rightElement}</div>}
    </button>
);

// A favorite row: the whole row is the drag handle (same pattern as the
// document tabs) — the PointerSensor distance constraint lets plain clicks
// through to select the page. Sorting is disabled outside 'manual' mode, and
// attributes/listeners are only spread while draggable so the row doesn't
// keep a phantom tab stop in the other sort modes.
const SortableFavoriteItem = ({ page, draggable, onPageSelect }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id, disabled: !draggable });
    return (
        <div
            ref={setNodeRef}
            data-vault-page-id={page.id}
            {...(draggable ? attributes : {})}
            {...(draggable ? listeners : {})}
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
                opacity: isDragging ? 0.4 : 1,
                zIndex: isDragging ? 50 : 1,
            }}
            className={`relative ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
        >
            <NavItem
                icon={FileText}
                label={page.title}
                onClick={() => onPageSelect(page.id)}
                colorClass="text-[var(--text-secondary)]/60"
                emoji={page.metadata?.icon}
                indented
            />
        </div>
    );
};

const SectionHeader = ({ label, isExpanded, onToggle, onAdd, addLabel }) => (
    <div className="group relative flex items-center px-3 mt-6 mb-1">
        <button
            onClick={onToggle}
            aria-expanded={isExpanded}
            className="gnosi-sidebar-section-title flex-1 min-w-0 flex items-center gap-1 transition-colors text-left"
        >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {label}
        </button>
        {onAdd && (
            <button
                onClick={onAdd}
                className="vault-sidebar-icon-action absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] rounded transition-all"
                title={addLabel}
                aria-label={addLabel}
            >
                <Plus size={14} />
            </button>
        )}
    </div>
);

const sidebarSectionStateKey = () => (
    `gnosi.sidebar.sections.${window.matchMedia('(max-width: 768px)').matches ? 'mobile' : 'desktop'}`
);

const loadSidebarSectionState = () => {
    try {
        return {
            favorites: false,
            dashboards: false,
            data: false,
            wiki: false,
            ...JSON.parse(localStorage.getItem(sidebarSectionStateKey()) || '{}'),
        };
    } catch {
        return { favorites: false, dashboards: false, data: false, wiki: false };
    }
};

const PageTreeItem = ({
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
}) => {
    const { t } = useTranslation();
    const isViewer = role === 'viewer';
    const isAdmin = role === 'admin' || role === 'owner';
    const isEditor = role === 'editor' || isAdmin;
    const hasChildren = childrenMap[page.id] && childrenMap[page.id].length > 0;
    const isExpanded = Boolean(expandedNodes?.[page.id]);
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(page.title);
    const [isDropTarget, setIsDropTarget] = useState(false);
    const isActive = activePageId === page.id;
    const isFavorite = page.metadata?.favorite === true || page.metadata?.favorite === 'true';
    const menuRef = useRef(null);
    const canReorder = !isDragLocked && !isViewer && typeof onMovePage === 'function';

    const isMenuOpen = menuState?.id === page.id;

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                if (menuState?.id === page.id) setMenuState(null);
            }
        };
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (menuState?.id === page.id) setMenuState(null);
            }
        };

        // Without `tid`, the cleanup ran before the timeout fired, so
        // `removeEventListener` had nothing to remove and the listeners
        // accumulated forever — every menu open added two more global
        // listeners. After enough toggles the page got sluggish and old
        // handlers fired on unrelated components.
        let tid;
        if (isMenuOpen) {
            tid = setTimeout(() => {
                document.addEventListener('click', handleClickOutside);
                document.addEventListener('keydown', handleKeyDown);
            }, 10);
        }
        return () => {
            if (tid) clearTimeout(tid);
            document.removeEventListener('click', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isMenuOpen, page.id, menuState, setMenuState]);

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
                style={{ paddingLeft: `${depth * 12 + 8}px`, paddingRight: '8px' }}
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
                        const payload = JSON.parse(raw);
                        const sourceId = payload?.id;
                        if (!sourceId || sourceId === page.id) return;
                        // We prevent a page from becoming a child of one of its
                        // own descendants (cycle in the tree).
                        const isDescendant = (() => {
                            const queue = [page.id];
                            const seen = new Set();
                            while (queue.length) {
                                const cur = queue.shift();
                                if (seen.has(cur)) continue;
                                seen.add(cur);
                                if (cur === sourceId) return true;
                                const kids = childrenMap[cur] || [];
                                for (const k of kids) queue.push(k.id);
                            }
                            return false;
                        })();
                        if (isDescendant) return;
                        onMovePage(sourceId, page.id);
                    } catch { /* noop */ }
                } : undefined}
                onDragEnd={() => setIsDropTarget(false)}
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
                        onChange={(e) => setRenameValue(e.target.value)}
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
                        onClick={(e) => e.stopPropagation()}
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

            {/* Context menu dropdown (Portal) */}
            {isMenuOpen && typeof document !== 'undefined' && createPortal(
                <div
                    ref={menuRef}
                    className="vault-sidebar__menu fixed w-40 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[var(--z-popover)] py-1 animate-in fade-in zoom-in-95 duration-100 max-h-[calc(100vh-20px)] overflow-y-auto"
                    style={{ top: menuState.y, left: menuState.x }}
                >
                    {onRenamePage && isEditor && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setMenuState(null);
                                setIsRenaming(true);
                            }}
                            className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                        >
                            <Edit2 size={14} className="text-[var(--text-secondary)]/60" />
                            <span>{t('sidebar.rename')}</span>
                        </button>
                    )}
                    {onToggleFavorite && (
                        <button
                            onPointerDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setMenuState(null);
                                onToggleFavorite(page.id);
                            }}
                            className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                        >
                            <Star size={14} className={isFavorite ? "text-amber-400" : "text-[var(--text-secondary)]/60"} fill={isFavorite ? "currentColor" : "none"} />
                            <span>{isFavorite ? t('sidebar.remove_favorites') : t('sidebar.add_favorites')}</span>
                        </button>
                    )}
                    {onDuplicatePage && isEditor && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setMenuState(null);
                                onDuplicatePage(page.id);
                            }}
                            className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                        >
                            <Copy size={14} className="text-[var(--text-secondary)]/60" />
                            <span>{t('sidebar.duplicate')}</span>
                        </button>
                    )}
                    {onOpenParallel && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setMenuState(null);
                                onOpenParallel(page.id);
                            }}
                            className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                        >
                            <Columns2 size={14} className="text-[var(--text-secondary)]/60" />
                            <span>{t('sidebar.open_parallel')}</span>
                        </button>
                    )}
                    <div className="h-px bg-[var(--border-primary)] my-1 mx-2"></div>
                    {onDeletePage && isAdmin && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setMenuState(null);
                            setTimeout(() => onDeletePage(page.id, page.title), 10);
                        }}
                        className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--status-error)] hover:bg-[var(--bg-secondary)] transition-colors font-medium"
                    >
                        <Trash2 size={14} className="text-[var(--status-error)]" />
                        <span>{t('sidebar.delete')}</span>
                    </button>
                    )}
                </div>,
                document.body
            )}

            {isExpanded && hasChildren && (
                <div className="vault-sidebar__navigation-list mt-0.5">
                    {childrenMap[page.id].map(child => (
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


export const VaultSidebar = ({
    pages = [],
    databases = [],
    tables = [],
    views = [],
    isRegistryLoading = false,
    activePageId,
    activeTableId,
    favoritePages = [],
    onPageSelect,
    onOpenParallel,
    onSearch,
    onCreatePage,
    onNavigate,
    onDeletePage,
    onDuplicatePage,
    onRenamePage,
    onDeleteTable,
    onRenameTable,
    onMovePage,
    onToggleFavorite,
    onTableSelect,
    onCreateDatabaseGroup,
    onCreateTable,
    onCreateTableRecord,
    onRenameDatabase,
    onDeleteDatabase,
    onOpenRecent,
    onOpenDaily,
    showTagsView = true,
    onCreateDashboardPage,
    currentView,
    onCreateDrawing,
    onOpenTable,
    onOpenTableParallel
}) => {
    const { t } = useTranslation();
    const activeVaultName = useActiveVaultName();
    const isMac = typeof navigator !== 'undefined'
        && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const globalSearchShortcut = isMac ? '⌥ K' : 'Alt K';

    const { role } = useApi();
    const isAdmin = role === 'admin' || role === 'owner';
    const isEditor = role === 'editor' || isAdmin;
    const WIKI_BATCH_SIZE = 150;
    const DATABASES_BATCH_SIZE = 40;
    const TABLES_BATCH_SIZE = 60;
    const WIKI_ITEM_HEIGHT = 30;
    const WIKI_OVERSCAN = 10;
    const [sidebarSectionState, setSidebarSectionState] = useState(loadSidebarSectionState);
    const [sidebarPreferenceProfile, setSidebarPreferenceProfile] = useState(() => (
        window.matchMedia('(max-width: 768px)').matches ? 'mobile' : 'desktop'
    ));
    useEffect(() => {
        const query = window.matchMedia('(max-width: 768px)');
        const update = () => setSidebarPreferenceProfile(query.matches ? 'mobile' : 'desktop');
        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update);
    }, []);
    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            setSidebarSectionState(loadSidebarSectionState());
        });
        return () => window.cancelAnimationFrame(frame);
    }, [sidebarPreferenceProfile]);
    const {
        favorites: isFavoritesExpanded,
        dashboards: isDashboardExpanded,
        data: isDatabasesExpanded,
        wiki: isWorkspaceExpanded,
    } = sidebarSectionState;
    const setSidebarSectionExpanded = useCallback((section, nextValue) => {
        setSidebarSectionState((current) => ({
            ...current,
            [section]: typeof nextValue === 'function' ? nextValue(current[section]) : nextValue,
        }));
    }, []);
    const setIsFavoritesExpanded = useCallback(
        (nextValue) => setSidebarSectionExpanded('favorites', nextValue),
        [setSidebarSectionExpanded],
    );
    const setIsDashboardExpanded = useCallback(
        (nextValue) => setSidebarSectionExpanded('dashboards', nextValue),
        [setSidebarSectionExpanded],
    );
    const setIsDatabasesExpanded = useCallback(
        (nextValue) => setSidebarSectionExpanded('data', nextValue),
        [setSidebarSectionExpanded],
    );
    const setIsWorkspaceExpanded = useCallback(
        (nextValue) => setSidebarSectionExpanded('wiki', nextValue),
        [setSidebarSectionExpanded],
    );
    useEffect(() => {
        try {
            localStorage.setItem(sidebarSectionStateKey(), JSON.stringify(sidebarSectionState));
        } catch { /* noop */ }
    }, [sidebarSectionState]);
    // Wiki lock: when it's closed (true), pages cannot be dragged
    // for reordering/nesting. Persisted in localStorage. Closed by default for
    // avoid accidental moves (the user has to "unlock" first).
    const [isWikiDragLocked, setIsWikiDragLocked] = useState(() => {
        try {
            const raw = localStorage.getItem('gnosi.sidebar.wikiDragLocked');
            if (raw !== null) return raw === 'true';
        } catch { /* noop */ }
        return true;
    });
    useEffect(() => {
        try { localStorage.setItem('gnosi.sidebar.wikiDragLocked', String(isWikiDragLocked)); }
        catch { /* noop */ }
    }, [isWikiDragLocked]);
    // Favorites ordering: {mode, manualOrder}. Persisted in localStorage.
    // mode can be 'manual' | 'alpha-asc' | 'alpha-desc' | 'recent' | 'oldest'.
    const [favoritesSort, setFavoritesSort] = useState(() => {
        try {
            const raw = localStorage.getItem('gnosi.sidebar.favoritesSort');
            if (raw) return { mode: 'manual', manualOrder: [], ...JSON.parse(raw) };
        } catch { /* noop */ }
        return { mode: 'manual', manualOrder: [] };
    });
    const [isFavoritesSortOpen, setIsFavoritesSortOpen] = useState(false);
    const favoritesSortMenuRef = useRef(null);

    useEffect(() => {
        try {
            localStorage.setItem('gnosi.sidebar.favoritesSort', JSON.stringify(favoritesSort));
        } catch { /* noop */ }
    }, [favoritesSort]);

    useEffect(() => {
        if (!isFavoritesSortOpen) return;
        const handleClickOutside = (e) => {
            if (favoritesSortMenuRef.current && !favoritesSortMenuRef.current.contains(e.target)) {
                setIsFavoritesSortOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isFavoritesSortOpen]);

    const sortedFavoritePages = useMemo(() => {
        const list = Array.isArray(favoritePages) ? [...favoritePages] : [];
        const { mode, manualOrder } = favoritesSort;
        if (mode === 'alpha-asc') {
            return list.sort((a, b) => compareFavoriteTitles(a.title, b.title, 'asc'));
        }
        if (mode === 'alpha-desc') {
            return list.sort((a, b) => compareFavoriteTitles(a.title, b.title, 'desc'));
        }
        if (mode === 'recent') {
            return list.sort((a, b) => String(b.last_modified || '').localeCompare(String(a.last_modified || '')));
        }
        if (mode === 'oldest') {
            return list.sort((a, b) => String(a.last_modified || '').localeCompare(String(b.last_modified || '')));
        }
        // mode === 'manual': respect explicit order, then add new favorites at the end
        const order = Array.isArray(manualOrder) ? manualOrder : [];
        const orderedIds = new Set(order);
        const byId = new Map(list.map((p) => [p.id, p]));
        const ordered = order.map((id) => byId.get(id)).filter(Boolean);
        const newcomers = list.filter((p) => !orderedIds.has(p.id));
        return [...ordered, ...newcomers];
    }, [favoritePages, favoritesSort]);

    const setFavoritesSortMode = (nextMode) => {
        setFavoritesSort((prev) => ({ ...prev, mode: nextMode }));
        setIsFavoritesSortOpen(false);
    };

    // dnd-kit reordering for the favorites list (only in 'manual' sort mode)
    const favoriteSensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    const handleFavoriteDragEnd = ({ active, over }) => {
        if (!over || active.id === over.id) return;
        const currentIds = sortedFavoritePages.map((p) => p.id);
        const oldIndex = currentIds.indexOf(active.id);
        const newIndex = currentIds.indexOf(over.id);
        if (oldIndex === -1 || newIndex === -1) return;
        setFavoritesSort({ mode: 'manual', manualOrder: arrayMove(currentIds, oldIndex, newIndex) });
    };
    const [expandedDatabases, setExpandedDatabases] = useState({});
    const [menuState, setMenuState] = useState(null);
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, type: '', id: '', name: '' });
    const [renameModal, setRenameModal] = useState({ isOpen: false, type: '', id: '', name: '' });
    const [visibleWikiCount, setVisibleWikiCount] = useState(WIKI_BATCH_SIZE);
    const [visibleDatabasesCount, setVisibleDatabasesCount] = useState(DATABASES_BATCH_SIZE);
    const [visibleTablesByDb, setVisibleTablesByDb] = useState({});
    const [expandedWikiNodes, setExpandedWikiNodes] = useState({});
    const [expandedDashboardNodes, setExpandedDashboardNodes] = useState({});
    const [expandedTables, setExpandedTables] = useState({});
    const [expandedTableSections, setExpandedTableSections] = useState({});
    const [wikiScrollTop, setWikiScrollTop] = useState(0);
    const [wikiViewportHeight, setWikiViewportHeight] = useState(380);
    const wikiViewportRef = useRef(null);
    const sidebarMenuRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (sidebarMenuRef.current && !sidebarMenuRef.current.contains(e.target)) {
                setMenuState(null);
            }
        };
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                setMenuState(null);
            }
        };

        // Same listener-leak pattern as in the page-row menu above: track the
        // timeout id and clear it in the cleanup so we never end up with
        // listeners attached after the menu has already closed.
        let tid;
        if (menuState && (menuState.type === 'database' || menuState.type === 'table')) {
            tid = setTimeout(() => {
                document.addEventListener('click', handleClickOutside);
                document.addEventListener('keydown', handleKeyDown);
            }, 10);
        }
        return () => {
            if (tid) clearTimeout(tid);
            document.removeEventListener('click', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [menuState]);

    const toggleDatabase = (id) => {
        setExpandedDatabases(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const toggleTableExpand = (id) => {
        setExpandedTables(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const toggleTableSection = (tableId, section) => {
        const key = `${tableId}:${section}`;
        setExpandedTableSections(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const { childrenMap, rootPages, dataChildrenMap, dashboardChildrenMap, dashboardRootPages } = useMemo(
        () => buildVaultSidebarTrees(pages || []),
        [pages]
    );

    const tablesByDatabase = useMemo(() => {
        const mapping = {};
        (tables || []).forEach((table) => {
            const dbId = table.database_id;
            if (!mapping[dbId]) mapping[dbId] = [];
            mapping[dbId].push(table);
        });
        return mapping;
    }, [tables]);

    const viewsByTable = useMemo(() => {
        const mapping = {};
        (views || []).forEach((view) => {
            // A view belongs to its base table AND to every table it joins
            // (multi-table views). This way the view appears in the list of
            // each involved table, matching the backend's `/views?table_id=`.
            const ids = new Set([
                view.table_id,
                ...((Array.isArray(view.joins) ? view.joins : [])
                    .map(j => j && j.tableId).filter(Boolean)),
            ].filter(Boolean));
            ids.forEach(tableId => {
                if (!mapping[tableId]) mapping[tableId] = [];
                mapping[tableId].push(view);
            });
        });
        return mapping;
    }, [views]);

    const tableAllowsSubitems = useMemo(() => {
        const mapping = {};
        Object.entries(viewsByTable).forEach(([tableId, tableViews]) => {
            const normalizedViews = Array.isArray(tableViews) ? tableViews : [];
            const mainTableView = normalizedViews.find((v) => (v?.type || 'table') === 'table') || normalizedViews[0];
            mapping[tableId] = Boolean(mainTableView?.enableSubitems);
        });
        return mapping;
    }, [viewsByTable]);

    const visibleRootPages = useMemo(() => rootPages.slice(0, visibleWikiCount), [rootPages, visibleWikiCount]);
    const visibleDatabases = useMemo(() => databases.slice(0, visibleDatabasesCount), [databases, visibleDatabasesCount]);
    const hasExpandedWikiNodes = useMemo(() => Object.values(expandedWikiNodes).some(Boolean), [expandedWikiNodes]);
    const wikiVirtualizationEnabled = isWorkspaceExpanded && rootPages.length > 300 && !hasExpandedWikiNodes;

    const wikiRawStartIndex = Math.max(0, Math.floor(wikiScrollTop / WIKI_ITEM_HEIGHT) - WIKI_OVERSCAN);
    const wikiStartIndex = Math.min(wikiRawStartIndex, Math.max(0, rootPages.length - 1));
    const wikiVisibleCount = Math.max(1, Math.ceil(wikiViewportHeight / WIKI_ITEM_HEIGHT) + WIKI_OVERSCAN * 2);
    const wikiEndIndex = Math.min(rootPages.length, wikiStartIndex + wikiVisibleCount);
    const virtualWikiRootPages = useMemo(
        () => rootPages.slice(wikiStartIndex, wikiEndIndex),
        [rootPages, wikiStartIndex, wikiEndIndex]
    );
    const wikiTopSpacerHeight = wikiStartIndex * WIKI_ITEM_HEIGHT;
    const wikiBottomSpacerHeight = Math.max(0, (rootPages.length - wikiEndIndex) * WIKI_ITEM_HEIGHT);

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            setVisibleWikiCount(WIKI_BATCH_SIZE);
        });
        return () => window.cancelAnimationFrame(frame);
    }, [rootPages.length]);

    useEffect(() => {
        const updateHeight = () => {
            if (wikiViewportRef.current) {
                setWikiViewportHeight(wikiViewportRef.current.clientHeight || 380);
            }
        };
        updateHeight();
        window.addEventListener('resize', updateHeight);
        return () => window.removeEventListener('resize', updateHeight);
    }, [isWorkspaceExpanded]);

    useEffect(() => {
        if (!wikiVirtualizationEnabled) return undefined;
        const frame = window.requestAnimationFrame(() => {
            setVisibleWikiCount(WIKI_BATCH_SIZE);
        });
        return () => window.cancelAnimationFrame(frame);
    }, [wikiVirtualizationEnabled]);

    const handleToggleWikiExpand = (pageId) => {
        setExpandedWikiNodes(prev => ({ ...prev, [pageId]: !prev[pageId] }));
    };

    const handleToggleDashboardExpand = (pageId) => {
        setExpandedDashboardNodes(prev => ({ ...prev, [pageId]: !prev[pageId] }));
    };

    const locateActivePage = useCallback(() => {
        if (!activePageId) return;
        const byId = Object.fromEntries((pages || []).map((page) => [page.id, page]));
        const ancestors = {};
        let current = byId[activePageId];
        while (current?.parent_id && byId[current.parent_id]) {
            ancestors[current.parent_id] = true;
            current = byId[current.parent_id];
        }
        setIsFavoritesExpanded(true);
        setIsWorkspaceExpanded(true);
        setExpandedWikiNodes((existing) => ({ ...existing, ...ancestors }));
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                [...document.querySelectorAll('[data-vault-page-id]')]
                    .find((element) => element.dataset.vaultPageId === String(activePageId))
                    ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            });
        });
    }, [activePageId, pages, setIsFavoritesExpanded, setIsWorkspaceExpanded]);

    useEffect(() => {
        window.addEventListener('gnosi:locate-active-page', locateActivePage);
        return () => window.removeEventListener('gnosi:locate-active-page', locateActivePage);
    }, [locateActivePage]);

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            setVisibleDatabasesCount(DATABASES_BATCH_SIZE);
        });
        return () => window.cancelAnimationFrame(frame);
    }, [databases.length]);

    return (
        <div
            ref={wikiViewportRef}
            onScroll={(e) => {
                if (wikiVirtualizationEnabled) {
                    setWikiScrollTop(e.currentTarget.scrollTop);
                }
            }}
            className="vault-sidebar flex flex-col h-full select-none overflow-y-auto custom-scrollbar pb-8 bg-[var(--bg-primary)]"
        >
            <div className="vault-sidebar__identity px-3 pt-4 mb-2 flex items-center justify-between group cursor-pointer hover:bg-[var(--bg-secondary)] rounded mx-2 py-1.5 transition-colors">
                <div className="flex min-w-0 items-center gap-2">
                    <div className="w-5 h-5 bg-gnosi/10 rounded flex items-center justify-center text-gnosi font-bold text-[10px]">G</div>
                    <span className="vault-sidebar__navigation-row truncate font-semibold text-[var(--text-primary)]">{t('common.vault_label', 'Vault')}: {activeVaultName || '…'}</span>
                </div>
                <button
                    type="button"
                    onClick={locateActivePage}
                    disabled={!activePageId}
                    className="vault-sidebar-icon-action rounded-md text-[var(--text-secondary)] disabled:opacity-30"
                    title={t('sidebar.locate_active_page')}
                    aria-label={t('sidebar.locate_active_page')}
                >
                    <LocateFixed size={14} />
                </button>
            </div>

            <div className="vault-sidebar__navigation-list px-2">
                <NavItem
                    icon={Search}
                    label={t('sidebar.search')}
                    onClick={onSearch}
                    rightElement={<span className="text-[10px] font-semibold text-[var(--text-secondary)]/60 border border-[var(--border-primary)] bg-[var(--bg-secondary)] rounded px-1.5 py-0.5">{t('sidebar.search_shortcut', { shortcut: globalSearchShortcut })}</span>}
                />
                <NavItem icon={Clock} label={t('sidebar.recent')} onClick={onOpenRecent} />
                {onOpenDaily && (
                    <NavItem
                        icon={CalendarDays}
                        label={t('sidebar.daily_note', "Daily note")}
                        onClick={() => onOpenDaily()}
                        colorClass="text-emerald-500"
                    />
                )}
                <div
                    className={`vault-sidebar__navigation-row group relative w-full flex items-center gap-2 px-3 rounded-md transition-colors ${currentView === 'drawing' ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                    onClick={() => onNavigate('drawing')}
                >
                    <Palette size={16} className={currentView === 'drawing' ? 'text-gnosi' : 'text-amber-500'} />
                    <span className="truncate flex-1 text-left text-[var(--text-primary)]">{t('sidebar.drawings')}</span>
                    {onCreateDrawing && isEditor && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onCreateDrawing(); }}
                            className="vault-sidebar-icon-action absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] rounded transition-all"
                            title={t('sidebar.add_drawing')}
                            aria-label={t('sidebar.add_drawing')}
                        >
                            <Plus size={14} />
                        </button>
                    )}
                </div>
                {showTagsView && (
                    <NavItem
                        icon={Hash}
                        label={t('sidebar.tags', "Tags")}
                        onClick={() => onNavigate('tags')}
                        isActive={currentView === 'tags'}
                        colorClass="text-amber-500"
                    />
                )}
                {isAdmin && (
                    <NavItem
                        icon={Trash2}
                        label={t('sidebar.trash', "Trash")}
                        onClick={() => onNavigate('trash')}
                        isActive={currentView === 'trash'}
                        colorClass="text-[var(--text-secondary)]"
                    />
                )}
            </div>

            {favoritePages.length > 0 && (
                <>
                    <div className="group relative flex items-center px-3 mt-6 mb-1">
                        <button
                            onClick={() => setIsFavoritesExpanded(!isFavoritesExpanded)}
                            aria-expanded={isFavoritesExpanded}
                            className="gnosi-sidebar-section-title flex-1 min-w-0 flex items-center gap-1 transition-colors text-left"
                        >
                            {isFavoritesExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            {t('sidebar.favorites', 'Favorites')}
                        </button>
                        <div className="relative" ref={favoritesSortMenuRef}>
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsFavoritesSortOpen((v) => !v); }}
                                className="vault-sidebar-icon-action opacity-0 group-hover:opacity-100 p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] rounded transition-all"
                                title={t('sidebar.favorites_sort', "Sort favorites")}
                                aria-label={t('sidebar.favorites_sort', "Sort favorites")}
                            >
                                <ArrowUpDown size={12} />
                            </button>
                            {isFavoritesSortOpen && (
                                <div className="absolute right-0 top-full mt-1 z-30 min-w-[180px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl py-1 text-xs">
                                    {[
                                        { id: 'manual', label: t('sidebar.sort_manual', 'Manual (drag)'), icon: GripVertical },
                                        { id: 'alpha-asc', label: t('sidebar.sort_alpha_asc', 'A → Z'), icon: ArrowDownAZ },
                                        { id: 'alpha-desc', label: t('sidebar.sort_alpha_desc', 'Z → A'), icon: ArrowUpAZ },
                                        { id: 'recent', label: t('sidebar.sort_recent', "Most recent"), icon: Clock },
                                        { id: 'oldest', label: t('sidebar.sort_oldest', "Oldest"), icon: Clock },
                                    ].map(({ id, label, icon: Icon }) => (
                                        <button
                                            key={id}
                                            onClick={() => setFavoritesSortMode(id)}
                                            className={`w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--bg-secondary)] text-left ${favoritesSort.mode === id ? 'text-[var(--gnosi-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}
                                        >
                                            <Icon size={12} className="shrink-0" />
                                            <span className="flex-1">{label}</span>
                                            {favoritesSort.mode === id && <Check size={12} />}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    {isFavoritesExpanded && (
                        <DndContext sensors={favoriteSensors} collisionDetection={closestCenter} onDragEnd={handleFavoriteDragEnd}>
                            <SortableContext items={sortedFavoritePages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                                <div className="vault-sidebar__navigation-list px-2">
                                    {sortedFavoritePages.map((page) => (
                                        <SortableFavoriteItem
                                            key={page.id}
                                            page={page}
                                            draggable={favoritesSort.mode === 'manual'}
                                            onPageSelect={onPageSelect}
                                        />
                                    ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    )}
                </>
            )}

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

            <SectionHeader
                label={t('sidebar.data', 'Data')}
                isExpanded={isDatabasesExpanded}
                onToggle={() => setIsDatabasesExpanded(!isDatabasesExpanded)}
                onAdd={() => isEditor && onCreateDatabaseGroup && onCreateDatabaseGroup()}
                addLabel={t('sidebar.add_database')}
            />
            {isDatabasesExpanded && (
                <div className="vault-sidebar__navigation-list px-2">
                    {visibleDatabases.map(db => {
                        const dbTables = tablesByDatabase[db.id] || [];
                        const isExpanded = expandedDatabases[db.id];
                        const visibleTableCount = visibleTablesByDb[db.id] || TABLES_BATCH_SIZE;
                        const renderedTables = dbTables.slice(0, visibleTableCount);

                        return (
                            <div key={db.id} className="vault-sidebar__navigation-list">
                                <div className={`vault-sidebar__navigation-row w-full flex items-center gap-2 px-2 rounded-md transition-colors group ${isExpanded ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}>
                                    <button onClick={() => toggleDatabase(db.id)} className="flex items-center gap-2 flex-1 min-w-0">
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
                                                onClick={(e) => { e.stopPropagation(); onCreateTable && onCreateTable(db.id); }}
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
                                        {renderedTables.map(table => {
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
                                                                        onClick={() => toggleTableSection(table.id, 'content')}
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
                                                                                    childrenMap={dataChildrenMap[table.id].children}
                                                                                    role={role}
                                                                                    expandedNodes={expandedWikiNodes}
                                                                                    onToggleExpand={(id) => setExpandedWikiNodes(prev => ({ ...prev, [id]: !prev[id] }))}
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
                                                                        onClick={() => toggleTableSection(table.id, 'views')}
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
                                                                                        onTableSelect && onTableSelect(table.id, view.id);
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
                                        })}
                                        {dbTables.length > visibleTableCount && (
                                            <button
                                                onClick={() => setVisibleTablesByDb(prev => ({
                                                    ...prev,
                                                    [db.id]: Math.min((prev[db.id] || TABLES_BATCH_SIZE) + TABLES_BATCH_SIZE, dbTables.length)
                                                }))}
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
                    })}
                    {databases.length > visibleDatabasesCount && (
                        <button
                            onClick={() => setVisibleDatabasesCount(prev => Math.min(prev + DATABASES_BATCH_SIZE, databases.length))}
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

            <div className="group relative flex items-center px-3 mt-6 mb-1">
                <button
                    onClick={() => {
                        setIsWorkspaceExpanded((prev) => {
                            const next = !prev;
                            if (next) {
                                setWikiScrollTop(0);
                                requestAnimationFrame(() => {
                                    if (wikiViewportRef.current) wikiViewportRef.current.scrollTop = 0;
                                });
                            }
                            return next;
                        });
                        setExpandedWikiNodes({});
                    }}
                    aria-expanded={isWorkspaceExpanded}
                    className="gnosi-sidebar-section-title flex-1 min-w-0 flex items-center gap-1 transition-colors text-left"
                >
                    {isWorkspaceExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {t('sidebar.wiki', 'Wiki')}
                </button>
                <div className="flex items-center gap-0.5">
                    <button
                        onClick={() => setIsWikiDragLocked((v) => !v)}
                        className={`vault-sidebar-icon-action p-0.5 rounded transition-all ${
                            isWikiDragLocked
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
                                <div style={{ height: `${wikiTopSpacerHeight}px` }} aria-hidden="true" />
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
                                <div style={{ height: `${wikiBottomSpacerHeight}px` }} aria-hidden="true" />
                            )}

                            {!wikiVirtualizationEnabled && rootPages.length > visibleWikiCount && (
                                <button
                                    onClick={() => setVisibleWikiCount(prev => Math.min(prev + WIKI_BATCH_SIZE, rootPages.length))}
                                    className="btn-gnosi btn-gnosi-primary !text-[10px] !py-1 w-full mt-1"
                                >
                                    {t('sidebar.show_more', { count: Math.min(WIKI_BATCH_SIZE, rootPages.length - visibleWikiCount) })}
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}

            {menuState && (menuState.type === 'database' || menuState.type === 'table') && createPortal(
                <div
                    ref={sidebarMenuRef}
                    className="vault-sidebar__menu fixed w-40 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[var(--z-popover)] py-1 animate-in fade-in zoom-in-95 duration-100 max-h-[calc(100vh-20px)] overflow-y-auto"
                    style={{ top: menuState.y, left: menuState.x }}
                >
                    {menuState.type === 'table' && (
                        <>
                            <button
                                onClick={() => {
                                    if (onTableSelect) onTableSelect(menuState.id);
                                    setMenuState(null);
                                }}
                                className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                            >
                                <LayoutPanelLeft size={14} className="text-[var(--text-secondary)]/60" />
                                <span>{t('sidebar.open_table')}</span>
                            </button>
                            {onOpenTable && (
                                <button
                                    onClick={() => {
                                        onOpenTable(menuState.id);
                                        setMenuState(null);
                                    }}
                                    className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                                >
                                    <Plus size={14} className="text-[var(--text-secondary)]/60" />
                                    <span>{t('sidebar.open_new_tab')}</span>
                                </button>
                            )}
                            {onOpenTableParallel && (
                                <button
                                    onClick={() => {
                                        onOpenTableParallel(menuState.id);
                                        setMenuState(null);
                                    }}
                                    className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                                >
                                    <Columns2 size={14} className="text-[var(--text-secondary)]/60" />
                                    <span>{t('sidebar.open_parallel')}</span>
                                </button>
                            )}
                            <div className="h-px bg-[var(--border-primary)] my-1 mx-2"></div>
                        </>
                    )}
                    <button
                        onClick={() => {
                            setRenameModal({ isOpen: true, type: menuState.type, id: menuState.id, name: menuState.name });
                            setMenuState(null);
                        }}
                        className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                        <Edit2 size={14} className="text-[var(--text-secondary)]/60" />
                        <span>{t('sidebar.rename')}</span>
                    </button>
                    <div className="h-px bg-[var(--border-primary)] my-1 mx-2"></div>
                    <button
                        onClick={() => {
                            setConfirmModal({
                                isOpen: true,
                                type: menuState.type,
                                id: menuState.id,
                                name: menuState.name
                            });
                            setMenuState(null);
                        }}
                        className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--status-error)] hover:bg-[var(--bg-secondary)] transition-colors font-medium"
                    >
                        <Trash2 size={14} className="text-[var(--status-error)]" />
                        <span>{t('common.delete')}</span>
                    </button>
                </div>,
                document.body
            )}
            {confirmModal.isOpen && (
                <ConfirmModal
                    isOpen={confirmModal.isOpen}
                    onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
                    onConfirm={async () => {
                        if (confirmModal.type === 'database') {
                            await onDeleteDatabase(confirmModal.id);
                        } else {
                            await onDeleteTable(confirmModal.id);
                        }
                        setConfirmModal({ ...confirmModal, isOpen: false });
                    }}
                    title={confirmModal.type === 'database' ? t('sidebar.confirm_delete_db_title') : t('sidebar.confirm_delete_table_title')}
                    message={confirmModal.type === 'database' ? t('sidebar.confirm_delete_db_msg') : t('sidebar.confirm_delete_table_msg')}
                    confirmText={t('common.delete')}
                    isDestructive={true}
                />
            )}
            <RenamePromptModal
                isOpen={renameModal.isOpen}
                type={renameModal.type}
                defaultValue={renameModal.name}
                onClose={() => setRenameModal({ isOpen: false, type: '', id: '', name: '' })}
                onConfirm={async (newName) => {
                    if (renameModal.type === 'database') await onRenameDatabase(renameModal.id, newName);
                    else await onRenameTable(renameModal.id, newName);
                    setRenameModal({ isOpen: false, type: '', id: '', name: '' });
                }}
            />
        </div>
    );
};
