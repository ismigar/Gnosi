import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../hooks/use-api';
import { toast } from 'react-hot-toast';
import { createPortal } from 'react-dom';
import { Search, Star, FileText, Plus, ChevronRight, ChevronDown, Clock, Inbox, Settings, MoreHorizontal, Edit2, Copy, Trash2, Database, LayoutPanelLeft, Palette, Hash, Columns2, ArrowUpDown, ArrowDownAZ, ArrowUpAZ, Check, GripVertical, Lock, Unlock } from 'lucide-react';
import { IconRenderer } from './IconRenderer';
import { ConfirmModal } from '../ConfirmModal';
import { isCalendarPage, isAppContent } from './schemaUtils';

const NavItem = ({ icon: Icon, label, onClick, isActive, colorClass = "text-[var(--text-secondary)]", emoji, rightElement }) => (
    <button
        onClick={onClick}
        className={`group w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors ${isActive ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
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
                draggable={!isRenaming && canReorder}
                onDragStart={(e) => {
                    // Doble protocol al dataTransfer:
                    //   - 'application/gnosi-note': format antic (insertem l'ID
                    //     com a wikilink dins l'editor en deixar anar a una nota)
                    //   - 'application/gnosi-page-move': nou, indica que estem
                    //     reordenant l'arbre de la sidebar (canvi de parent_id)
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
                    // Només acceptem drops del mateix sidebar (no de l'editor)
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
                        // Evitem que una pàgina es converteixi en filla d'una
                        // pròpia descendent (cicle a l'arbre).
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

            {/* Dropdown de context menu (Portal) */}
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
    onCreateDashboardPage,
    currentView,
    onCreateDrawing,
    onOpenTable,
    onOpenTableParallel
}) => {
    const { t } = useTranslation();
    const [openMenus, setOpenMenus] = useState({});
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
    // Candau del Wiki: quan està tancat (true), no es poden arrossegar pàgines
    // per reordenar/anidar. Persistit a localStorage. Per defecte tancat per
    // evitar moviments accidentals (l'usuari ha de "desbloquejar" abans).
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
    // Ordenació de favorits: {mode, manualOrder}. Persistit a localStorage.
    // mode pot ser 'manual' | 'alpha-asc' | 'alpha-desc' | 'recent' | 'oldest'.
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
            return list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
        }
        if (mode === 'alpha-desc') {
            return list.sort((a, b) => String(b.title || '').localeCompare(String(a.title || '')));
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

    // Drag handler per ordre manual
    const [draggingFavoriteId, setDraggingFavoriteId] = useState(null);
    const handleFavoriteDragStart = (id) => (e) => {
        setDraggingFavoriteId(id);
        try { e.dataTransfer.effectAllowed = 'move'; } catch { /* noop */ }
    };
    const handleFavoriteDragOver = (id) => (e) => {
        if (!draggingFavoriteId || draggingFavoriteId === id) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch { /* noop */ }
    };
    const handleFavoriteDrop = (targetId) => (e) => {
        e.preventDefault();
        if (!draggingFavoriteId || draggingFavoriteId === targetId) {
            setDraggingFavoriteId(null);
            return;
        }
        // Switching to manual mode if the user drops while in another sort
        const currentIds = sortedFavoritePages.map((p) => p.id);
        const fromIdx = currentIds.indexOf(draggingFavoriteId);
        const toIdx = currentIds.indexOf(targetId);
        if (fromIdx === -1 || toIdx === -1) {
            setDraggingFavoriteId(null);
            return;
        }
        const next = [...currentIds];
        next.splice(fromIdx, 1);
        next.splice(toIdx, 0, draggingFavoriteId);
        setFavoritesSort({ mode: 'manual', manualOrder: next });
        setDraggingFavoriteId(null);
    };
    const handleFavoriteDragEnd = () => setDraggingFavoriteId(null);
    const [isDatabasesExpanded, setIsDatabasesExpanded] = useState(true);
    const [expandedDatabases, setExpandedDatabases] = useState({});
    const [menuState, setMenuState] = useState(null);
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, type: '', id: '', name: '' });
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


        (pages || []).forEach(p => {
            if (p.metadata?.is_template || isCalendarPage(p) || isAppContent(p)) return;

            if (isDashboardPage(p)) {
                const parent = p.parent_id ? pagesById[p.parent_id] : null;
                const parentIsDashboard = isDashboardPage(parent);

                if (parentIsDashboard) {
                    if (!computedDashboardChildrenMap[p.parent_id]) computedDashboardChildrenMap[p.parent_id] = [];
                    computedDashboardChildrenMap[p.parent_id].push(p);
                } else {
                    computedDashboardRootPages.push(p);
                }
                return;
            }

            // Determine if the page belongs to the data section (DB)
            const tableId = p.resolved_table_id || p.metadata?.table_id || p.metadata?.database_table_id;
            const isData = p.is_database || (!!tableId && tableId !== 'wiki') || p.folder?.startsWith('BD/');

            if (isData) {
                let finalTableId = tableId;
                
                // If we don't have tableId but it's in BD/, check if the parent has one
                if (!finalTableId && p.parent_id && pagesById[p.parent_id]) {
                    finalTableId = pagesById[p.parent_id].resolved_table_id || pagesById[p.parent_id].metadata?.table_id;
                }

                if (finalTableId) {
                    if (!computedDataChildrenMap[finalTableId]) {
                        computedDataChildrenMap[finalTableId] = { roots: [], children: {} };
                    }
                    
                    const tableTree = computedDataChildrenMap[finalTableId];
                    const parentIsInData = p.parent_id && pagesById[p.parent_id] && 
                                         (pagesById[p.parent_id].resolved_table_id === finalTableId || 
                                          pagesById[p.parent_id].metadata?.table_id === finalTableId);

                    if (parentIsInData) {
                        if (!tableTree.children[p.parent_id]) tableTree.children[p.parent_id] = [];
                        tableTree.children[p.parent_id].push(p);
                    } else {
                        tableTree.roots.push(p);
                    }
                }
                return;
            }

            if (p.parent_id) {
                if (!computedChildrenMap[p.parent_id]) computedChildrenMap[p.parent_id] = [];
                computedChildrenMap[p.parent_id].push(p);
            } else {
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
        <div className="flex flex-col h-full select-none overflow-y-auto custom-scrollbar pb-8 bg-[var(--bg-primary)]">
            <div className="px-3 pt-4 mb-2 flex items-center justify-between group cursor-pointer hover:bg-[var(--bg-secondary)] rounded mx-2 py-1.5 transition-colors">
                <div className="flex items-center gap-2">
                    <div className="w-5 h-5 bg-gnosi/10 rounded flex items-center justify-center text-gnosi font-bold text-[10px]">G</div>
                    <span className="text-sm font-semibold text-[var(--text-primary)]">{t('sidebar.my_vault')}</span>
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
                                title={t('sidebar.favorites_sort', 'Ordena favorits')}
                            >
                                <ArrowUpDown size={12} />
                            </button>
                            {isFavoritesSortOpen && (
                                <div className="absolute right-0 top-full mt-1 z-30 min-w-[180px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl py-1 text-xs">
                                    {[
                                        { id: 'manual', label: t('sidebar.sort_manual', 'Manual (drag)'), icon: GripVertical },
                                        { id: 'alpha-asc', label: t('sidebar.sort_alpha_asc', 'A → Z'), icon: ArrowDownAZ },
                                        { id: 'alpha-desc', label: t('sidebar.sort_alpha_desc', 'Z → A'), icon: ArrowUpAZ },
                                        { id: 'recent', label: t('sidebar.sort_recent', 'Més recents'), icon: Clock },
                                        { id: 'oldest', label: t('sidebar.sort_oldest', 'Més antics'), icon: Clock },
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
                        <div className="px-2 space-y-0.5">
                            {sortedFavoritePages.map((page) => {
                                const isDragging = draggingFavoriteId === page.id;
                                const draggable = favoritesSort.mode === 'manual';
                                return (
                                    <div
                                        key={page.id}
                                        draggable={draggable}
                                        onDragStart={draggable ? handleFavoriteDragStart(page.id) : undefined}
                                        onDragOver={draggable ? handleFavoriteDragOver(page.id) : undefined}
                                        onDrop={draggable ? handleFavoriteDrop(page.id) : undefined}
                                        onDragEnd={draggable ? handleFavoriteDragEnd : undefined}
                                        className={`relative ${isDragging ? 'opacity-40' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
                                    >
                                        <NavItem
                                            icon={FileText}
                                            label={page.title}
                                            onClick={() => onPageSelect(page.id)}
                                            colorClass="text-[var(--text-secondary)]/60"
                                            emoji={page.metadata?.icon}
                                        />
                                    </div>
                                );
                            })}
                        </div>
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
                                        <Database size={14} className="text-purple-500 shrink-0" />
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
                        title={isWikiDragLocked ? t('sidebar.wiki_unlock', 'Desbloqueja per reordenar (drag&drop)') : t('sidebar.wiki_lock', 'Bloqueja l\'arrossegament')}
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
                    ref={wikiViewportRef}
                    onScroll={(e) => {
                        if (wikiVirtualizationEnabled) {
                            setWikiScrollTop(e.currentTarget.scrollTop);
                        }
                    }}
                    className="px-2 space-y-0.5 max-h-[42vh] overflow-y-auto custom-scrollbar"
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
                                    <span>{t('sidebar.open_in_new_tab')}</span>
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
                            const newName = prompt(t('sidebar.prompt_new_name_type', { type: menuState.type === 'database' ? 'Database' : 'Table' }), menuState.name);
                            if (newName && newName !== menuState.name) {
                                if (menuState.type === 'database') onRenameDatabase(menuState.id, newName);
                                else onRenameTable(menuState.id, newName);
                            }
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
                    title={t('sidebar.confirm_delete_type_title', { type: confirmModal.type === 'database' ? 'Database' : 'Table', defaultValue: `Delete ${confirmModal.type === 'database' ? 'Database' : 'Table'}` })}
                    message={confirmModal.type === 'database' ? t('sidebar.confirm_delete_db_msg') : t('sidebar.confirm_delete_table_msg')}
                    confirmText={t('common.delete')}
                    isDestructive={true}
                />
            )}
        </div>
    );
};
