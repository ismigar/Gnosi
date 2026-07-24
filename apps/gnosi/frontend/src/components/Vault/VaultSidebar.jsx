import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { useApi } from '../../hooks/use-api';
import { useActiveVaultName } from '../../hooks/useActiveVaultName';
import { toast } from '../../lib/toast';
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
import { Search, Star, FileText, Plus, ChevronRight, ChevronDown, Clock, Inbox, Settings, MoreHorizontal, Edit2, Copy, Trash2, Database, LayoutPanelLeft, Palette, Hash, Columns2, ArrowUpDown, ArrowDownAZ, ArrowUpAZ, Check, GripVertical, Lock, Unlock, CalendarDays } from 'lucide-react';
import { IconRenderer } from './IconRenderer';
import { ConfirmModal } from '../ConfirmModal';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { isCalendarPage, isAppContent } from './schemaUtils';
import { sortKey } from '../../utils/vaultFilters';

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
            style={{ zIndex: 99999 }}
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
        className={`group w-full flex items-center gap-2 ${indented ? 'pl-[34px] pr-3' : 'px-3'} py-1.5 text-sm rounded-md transition-colors ${isActive ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
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

const SectionHeader = ({ label, isExpanded, onToggle, onAdd }) => (
    <div className="group relative flex items-center px-3 mt-6 mb-1">
        <button
            onClick={onToggle}
            className="flex-1 min-w-0 flex items-center gap-1 text-[11px] font-bold text-[var(--text-secondary)]/60 uppercase tracking-wider hover:text-[var(--text-primary)] transition-colors text-left"
        >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {label}
        </button>
        {onAdd && (
            <button
                onClick={onAdd}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] rounded transition-all"
            >
                <Plus size={14} />
            </button>
        )}
    </div>
);

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
    onRankPage,
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
                title={page.title}
                className={`group flex items-center gap-1 py-1 text-sm rounded-md transition-colors cursor-pointer ${isActive ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]/50'} ${isDropTarget ? 'ring-2 ring-[var(--gnosi-primary)]/50 bg-[var(--gnosi-primary)]/10' : ''}`}
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
                    className="p-0.5 hover:bg-[var(--bg-secondary)] rounded shrink-0 mr-1 text-[var(--text-secondary)]/60"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (onToggleExpand) onToggleExpand(page.id);
                    }}
                    style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
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
                        className="p-0.5 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-secondary)]/60"
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
                            className="p-0.5 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-secondary)]/60"
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
                    className="fixed w-40 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[9999] py-1 animate-in fade-in zoom-in-95 duration-100 max-h-[calc(100vh-20px)] overflow-y-auto"
                    style={{ top: menuState.y, left: menuState.x }}
                >
                    {onRenamePage && isEditor && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setMenuState(null);
                                setIsRenaming(true);
                            }}
                            className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
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
                            className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
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
                            className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
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
                            className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
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
                        className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--status-error)] hover:bg-[var(--bg-secondary)] transition-colors font-medium"
                    >
                        <Trash2 size={14} className="text-[var(--status-error)]" />
                        <span>{t('sidebar.delete')}</span>
                    </button>
                    )}
                </div>,
                document.body
            )}

            {isExpanded && hasChildren && (
                <div className="mt-0.5">
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
    onOpenSettings,
    onNavigate,
    onDeletePage,
    onDuplicatePage,
    onRenamePage,
    onDuplicateTable,
    onDeleteTable,
    onRenameTable,
    onMovePage,
    onMoveTable,
    onToggleFavorite,
    onTableSelect,
    isReadOnly = false,
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

    const { role } = useApi();
    const isViewer = role === 'viewer';
    const isAdmin = role === 'admin' || role === 'owner';
    const isEditor = role === 'editor' || isAdmin;
    const WIKI_BATCH_SIZE = 150;
    const DATABASES_BATCH_SIZE = 40;
    const TABLES_BATCH_SIZE = 60;
    const WIKI_ITEM_HEIGHT = 30;
    const WIKI_OVERSCAN = 10;
    const [isWorkspaceExpanded, setIsWorkspaceExpanded] = useState(true);
    const [isDashboardExpanded, setIsDashboardExpanded] = useState(true);
    const [isFavoritesExpanded, setIsFavoritesExpanded] = useState(true);
    // Wiki lock: when it's closed (true), pages cannot be dragged
    // for reordering/nesting. Persisted in localStorage. Closed by default for
    // avoid accidental moves (the user has to "unlock" first).
    const [isWikiDragLocked, setIsWikiDragLocked] = useState(() => {
        try {
            const raw = localStorage.getItem('gnosi.sidebar.wikiDragLocked');
            if (raw !== null) return raw === 'true';
        } catch (e) { /* noop */ }
        return true;
    });
    useEffect(() => {
        try { localStorage.setItem('gnosi.sidebar.wikiDragLocked', String(isWikiDragLocked)); }
        catch (e) { /* noop */ }
    }, [isWikiDragLocked]);
    // Favorites ordering: {mode, manualOrder}. Persisted in localStorage.
    // mode can be 'manual' | 'alpha-asc' | 'alpha-desc' | 'recent' | 'oldest'.
    const [favoritesSort, setFavoritesSort] = useState(() => {
        try {
            const raw = localStorage.getItem('gnosi.sidebar.favoritesSort');
            if (raw) return { mode: 'manual', manualOrder: [], ...JSON.parse(raw) };
        } catch (e) { /* noop */ }
        return { mode: 'manual', manualOrder: [] };
    });
    const [isFavoritesSortOpen, setIsFavoritesSortOpen] = useState(false);
    const favoritesSortMenuRef = useRef(null);

    useEffect(() => {
        try {
            localStorage.setItem('gnosi.sidebar.favoritesSort', JSON.stringify(favoritesSort));
        } catch (e) { /* noop */ }
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
            return list.sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title), 'en', { sensitivity: 'base' }));
        }
        if (mode === 'alpha-desc') {
            return list.sort((a, b) => sortKey(b.title).localeCompare(sortKey(a.title), 'en', { sensitivity: 'base' }));
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
    const [isDatabasesExpanded, setIsDatabasesExpanded] = useState(true);
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

    const { childrenMap, rootPages, dataChildrenMap, dashboardChildrenMap, dashboardRootPages } = useMemo(() => {
        const computedChildrenMap = {};
        const computedRootPages = [];
        const computedDataChildrenMap = {};
        const computedDashboardChildrenMap = {};
        const computedDashboardRootPages = [];

        // Fast mapping to find pages by ID
        const pagesById = {};
        (pages || []).forEach(p => { pagesById[p.id] = p; });

        const isDashboardPage = (page) => {
            if (!page) return false;
            const folder = String(page.folder || '');
            return page.metadata?.is_dashboard === true
                || folder === 'Dashboard'
                || folder.startsWith('Dashboard/')
                || folder === '.Dashboards'
                || folder.startsWith('.Dashboards/');
        };


        const ownTableId = (page) =>
            page.resolved_table_id || page.metadata?.table_id || page.metadata?.database_table_id;
        const hasOwnDataMarkers = (page) => {
            const t = ownTableId(page);
            return page.is_database || (!!t && t !== 'wiki') || page.folder?.startsWith('BD/');
        };

        // Section where a page lives: its OWN markers decide (dashboard / data).
        // DB membership is a property of the page itself (table_id / BD/ folder),
        // NEVER inherited from the parent: a page without properties that hangs
        // off a DB row is still a WIKI page (cf. directive
        // vault_subpages_hierarchy.md — the row links it, but only real table
        // members belong to DATA). Dashboard subpages do inherit (parent_id
        // chain, memoized and cycle-proof): a dashboard's subpage renders in
        // the dashboard tree, not as loose wiki.
        const sectionCache = {};
        const sectionOf = (page, visiting) => {
            if (!page) return { kind: 'wiki' };
            const hit = sectionCache[page.id];
            if (hit) return hit;
            const seen = visiting || new Set();
            if (seen.has(page.id)) return { kind: 'wiki' };   // parent_id cycle: cuts
            seen.add(page.id);
            let sec;
            if (isDashboardPage(page)) {
                sec = { kind: 'dashboard' };
            } else if (hasOwnDataMarkers(page)) {
                let tableId = ownTableId(page);
                if (!tableId && page.parent_id && pagesById[page.parent_id]) {
                    const psec = sectionOf(pagesById[page.parent_id], seen);
                    if (psec.kind === 'data') tableId = psec.tableId;
                }
                // Without a resolvable table, the previous behavior is kept: it's shown nowhere.
                sec = { kind: 'data', tableId: tableId || null };
            } else if (page.parent_id && pagesById[page.parent_id]) {
                const psec = sectionOf(pagesById[page.parent_id], seen);
                sec = psec.kind === 'data' ? { kind: 'wiki' } : psec;
            } else {
                sec = { kind: 'wiki' };
            }
            sectionCache[page.id] = sec;
            return sec;
        };

        (pages || []).forEach(p => {
            // `isAppContent` treats the entire BD/ folder as app content: without
            // the exception below, NO row ever entered the maps and the data tree
            // (rows under the table, expand chevron, row subpages) was code
            // dormant. Pages with their own data markers enter their own tree;
            // Mail/Assets/Calendar/… remain outside.
            if (p.metadata?.is_template || isCalendarPage(p) || (isAppContent(p) && !hasOwnDataMarkers(p))) return;

            const parent = p.parent_id ? pagesById[p.parent_id] : null;
            const sec = sectionOf(p);

            if (sec.kind === 'dashboard') {
                if (parent && sectionOf(parent).kind === 'dashboard') {
                    if (!computedDashboardChildrenMap[p.parent_id]) computedDashboardChildrenMap[p.parent_id] = [];
                    computedDashboardChildrenMap[p.parent_id].push(p);
                } else {
                    computedDashboardRootPages.push(p);
                }
                return;
            }

            if (sec.kind === 'data') {
                if (!sec.tableId) return;   // BD/ with no resolvable table: as before, outside
                const psec = parent ? sectionOf(parent) : null;
                if (psec?.kind === 'data' && psec.tableId === sec.tableId) {
                    if (!computedDataChildrenMap[sec.tableId]) {
                        computedDataChildrenMap[sec.tableId] = { roots: [], children: {} };
                    }
                    const tableTree = computedDataChildrenMap[sec.tableId];
                    if (!tableTree.children[p.parent_id]) tableTree.children[p.parent_id] = [];
                    tableTree.children[p.parent_id].push(p);
                } else if (hasOwnDataMarkers(p)) {
                    if (!computedDataChildrenMap[sec.tableId]) {
                        computedDataChildrenMap[sec.tableId] = { roots: [], children: {} };
                    }
                    computedDataChildrenMap[sec.tableId].roots.push(p);
                } else {
                    // Subpage whose parent has disappeared (row deleted): visible in the wiki,
                    // never as the table's root pseudo-row.
                    computedRootPages.push(p);
                }
                return;
            }

            if (parent && sectionOf(parent).kind === 'wiki') {
                if (!computedChildrenMap[p.parent_id]) computedChildrenMap[p.parent_id] = [];
                computedChildrenMap[p.parent_id].push(p);
            } else {
                // Wiki root: no parent_id, a nonexistent parent (an orphaned
                // parent_id used to hide the page forever in the childrenMap of
                // a parent that doesn't render), or a parent that lives in
                // another section (a DB row): the page is wiki but its parent
                // never renders in the wiki tree, so it surfaces at the root.
                computedRootPages.push(p);
            }
        });

        return {
            childrenMap: computedChildrenMap,
            rootPages: computedRootPages,
            dataChildrenMap: computedDataChildrenMap,
            dashboardChildrenMap: computedDashboardChildrenMap,
            dashboardRootPages: computedDashboardRootPages,
        };
    }, [pages]);

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
            const tableId = view.table_id;
            if (!mapping[tableId]) mapping[tableId] = [];
            mapping[tableId].push(view);
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
        setVisibleWikiCount(WIKI_BATCH_SIZE);
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
        if (wikiVirtualizationEnabled) {
            setVisibleWikiCount(WIKI_BATCH_SIZE);
        }
    }, [wikiVirtualizationEnabled]);

    const handleToggleWikiExpand = (pageId) => {
        setExpandedWikiNodes(prev => ({ ...prev, [pageId]: !prev[pageId] }));
    };

    const handleToggleDashboardExpand = (pageId) => {
        setExpandedDashboardNodes(prev => ({ ...prev, [pageId]: !prev[pageId] }));
    };

    useEffect(() => {
        setVisibleDatabasesCount(DATABASES_BATCH_SIZE);
    }, [databases.length]);

    return (
        <div
            ref={wikiViewportRef}
            onScroll={(e) => {
                if (wikiVirtualizationEnabled) {
                    setWikiScrollTop(e.currentTarget.scrollTop);
                }
            }}
            className="flex flex-col h-full select-none overflow-y-auto custom-scrollbar pb-8 bg-[var(--bg-primary)]"
        >
            <div className="px-3 pt-4 mb-2 flex items-center justify-between group cursor-pointer hover:bg-[var(--bg-secondary)] rounded mx-2 py-1.5 transition-colors">
                <div className="flex items-center gap-2">
                    <div className="w-5 h-5 bg-gnosi/10 rounded flex items-center justify-center text-gnosi font-bold text-[10px]">G</div>
                    <span className="text-sm font-semibold text-[var(--text-primary)]">{activeVaultName ? `Vault: ${activeVaultName}` : 'Vault: …'}</span>
                </div>

            </div>

            <div className="px-2 space-y-0.5">
                <NavItem
                    icon={Search}
                    label={t('sidebar.search')}
                    onClick={onSearch}
                    rightElement={<span className="text-[10px] font-semibold text-[var(--text-secondary)]/60 border border-[var(--border-primary)] bg-[var(--bg-secondary)] rounded px-1.5 py-0.5">Cmd K</span>}
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
                    className={`group relative w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors ${currentView === 'drawing' ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                    onClick={() => onNavigate('drawing')}
                >
                    <Palette size={16} className={currentView === 'drawing' ? 'text-gnosi' : 'text-amber-500'} />
                    <span className="truncate flex-1 text-left text-[var(--text-primary)]">{t('sidebar.drawings')}</span>
                    {onCreateDrawing && isEditor && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onCreateDrawing(); }}
                            className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] rounded transition-all"
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
                            className="flex-1 min-w-0 flex items-center gap-1 text-[11px] font-bold text-[var(--text-secondary)]/60 uppercase tracking-wider hover:text-[var(--text-primary)] transition-colors text-left"
                        >
                            {isFavoritesExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            {t('sidebar.favorites', 'Favorites')}
                        </button>
                        <div className="relative" ref={favoritesSortMenuRef}>
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsFavoritesSortOpen((v) => !v); }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] rounded transition-all"
                                title={t('sidebar.favorites_sort', "Sort favorites")}
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
                                <div className="px-2 space-y-0.5">
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
            />
            {isDashboardExpanded && (
                <div className="px-2 space-y-0.5">
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
            />
            {isDatabasesExpanded && (
                <div className="px-2 space-y-0.5">
                    {visibleDatabases.map(db => {
                        const dbTables = tablesByDatabase[db.id] || [];
                        const isExpanded = expandedDatabases[db.id];
                        const isMenuOpen = menuState?.id === db.id;
                        const visibleTableCount = visibleTablesByDb[db.id] || TABLES_BATCH_SIZE;
                        const renderedTables = dbTables.slice(0, visibleTableCount);

                        return (
                            <div key={db.id} className="space-y-0.5">
                                <div className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-sm transition-colors group ${isExpanded ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}>
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
                                            className="p-0.5 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-secondary)]/60"
                                        >
                                            <MoreHorizontal size={14} />
                                        </button>
                                        {isEditor && (
                                            <button
                                                className="p-0.5 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-secondary)]/60 hover:text-gnosi"
                                                onClick={(e) => { e.stopPropagation(); onCreateTable && onCreateTable(db.id); }}
                                                title={t('sidebar.new_table')}
                                            >
                                                <Plus size={14} />
                                            </button>
                                         )}
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div className="ml-4 space-y-0.5 border-l border-[var(--border-primary)] pl-1">
                                        {renderedTables.map(table => {
                                            const tableViews = viewsByTable[table.id] || [];
                                            return (
                                                <div key={table.id} className="w-full flex flex-col gap-0.5">
                                                     <div className="w-full flex items-center gap-1 px-2 py-1 rounded-md text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors group/tableItem">
                                                        <button
                                                            className="p-0.5 hover:bg-[var(--bg-secondary)] rounded shrink-0 text-[var(--text-secondary)]/60"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                toggleTableExpand(table.id);
                                                            }}
                                                            style={{ visibility: dataChildrenMap[table.id]?.roots?.length > 0 ? 'visible' : 'hidden' }}
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
                                                            className="opacity-0 group-hover/tableItem:opacity-100 p-0.5 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-secondary)]"
                                                        >
                                                            <MoreHorizontal size={12} />
                                                        </button>
                                                         {isEditor && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (onCreateTableRecord) onCreateTableRecord(table.id);
                                                                }}
                                                                className="opacity-0 group-hover/tableItem:opacity-100 p-0.5 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-secondary)] hover:text-gnosi"
                                                                title={t('sidebar.new_record')}
                                                            >
                                                                <Plus size={12} />
                                                            </button>
                                                         )}
                                                    </div>

                                                    {/* Nested Pages (Records) within the Table */}
                                                    {expandedTables[table.id] && dataChildrenMap[table.id]?.roots?.length > 0 && (
                                                        <div className="ml-2 border-l border-[var(--border-primary)] pl-1 mt-0.5">
                                                            {dataChildrenMap[table.id].roots.map(p => (
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

                                                    {/* Nested Views */}
                                                    {tableViews.length > 0 && (
                                                        <div className="ml-4 border-l border-[var(--border-primary)] pl-2 flex flex-col gap-0.5 mt-0.5 mb-1">
                                                            {tableViews.map(view => (
                                                                <button
                                                                    key={view.id}
                                                                    onClick={() => {
                                                                        onTableSelect && onTableSelect(table.id, view.id);
                                                                    }}
                                                                    className="flex items-center gap-2 px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:text-gnosi hover:bg-[var(--bg-secondary)] rounded transition-colors text-left"
                                                                >
                                                                    <Hash size={10} className="shrink-0" />
                                                                    <span className="truncate">{view.name}</span>
                                                                </button>
                                                            ))}
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
                    className="flex-1 min-w-0 flex items-center gap-1 text-[11px] font-bold text-[var(--text-secondary)]/60 uppercase tracking-wider hover:text-[var(--text-primary)] transition-colors text-left"
                >
                    {isWorkspaceExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    Wiki
                </button>
                <div className="flex items-center gap-0.5">
                    <button
                        onClick={() => setIsWikiDragLocked((v) => !v)}
                        className={`p-0.5 rounded transition-all ${
                            isWikiDragLocked
                                ? 'opacity-60 hover:opacity-100 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                                : 'opacity-100 text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 hover:bg-[var(--gnosi-primary)]/20'
                        }`}
                        title={isWikiDragLocked ? t('sidebar.wiki_unlock', "Unlock to reorder (drag&drop)") : t('sidebar.wiki_lock', "Lock dragging")}
                    >
                        {isWikiDragLocked ? <Lock size={12} /> : <Unlock size={12} />}
                    </button>
                    {isEditor && (
                        <button
                            onClick={() => onCreatePage(null)}
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] rounded transition-all"
                        >
                            <Plus size={14} />
                        </button>
                    )}
                </div>
            </div>
            {isWorkspaceExpanded && (
                <div
                    className="px-2 space-y-0.5"
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
                    className="fixed w-40 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[9999] py-1 animate-in fade-in zoom-in-95 duration-100 max-h-[calc(100vh-20px)] overflow-y-auto"
                    style={{ top: menuState.y, left: menuState.x }}
                >
                    {menuState.type === 'table' && (
                        <>
                            <button
                                onClick={() => {
                                    if (onTableSelect) onTableSelect(menuState.id);
                                    setMenuState(null);
                                }}
                                className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
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
                                    className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
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
                                    className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
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
                        className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
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
                        className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--status-error)] hover:bg-[var(--bg-secondary)] transition-colors font-medium"
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
