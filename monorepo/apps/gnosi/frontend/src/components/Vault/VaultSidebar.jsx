import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search, Star, FileText, Plus, ChevronRight, ChevronDown, Clock, Inbox, Settings, MoreHorizontal, Edit2, Copy, Trash2, Database, LayoutPanelLeft, Palette, Hash, Columns2 } from 'lucide-react';
import { IconRenderer } from './IconRenderer';
import { ConfirmModal } from '../ConfirmModal';

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
    menuState,
    setMenuState,
    canCreateChild = true
}) => {
    const hasChildren = childrenMap[page.id] && childrenMap[page.id].length > 0;
    const isExpanded = Boolean(expandedNodes?.[page.id]);
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(page.title);
    const isActive = activePageId === page.id;
    const isFavorite = page.metadata?.favorite === true || page.metadata?.favorite === 'true';
    const menuRef = useRef(null);

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

        if (isMenuOpen) {
            setTimeout(() => {
                document.addEventListener('click', handleClickOutside);
                document.addEventListener('keydown', handleKeyDown);
            }, 10);
        }
        return () => {
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
                className={`group flex items-center gap-1 py-1 text-sm rounded-md transition-colors cursor-pointer ${isActive ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]/50'}`}
                style={{ paddingLeft: `${depth * 12 + 8}px`, paddingRight: '8px' }}
                onClick={() => {
                    if (!isRenaming) onPageSelect(page.id);
                }}
                draggable={!isRenaming}
                onDragStart={(e) => {
                    e.dataTransfer.setData('application/gnosi-note', JSON.stringify({
                        id: page.id,
                        title: page.title
                    }));
                    // Optional: Set drag image or effect
                    e.dataTransfer.effectAllowed = 'copy';
                }}
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

                {/* Accions hover per afegir Pàgines filles o menú de context */}
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
                                
                                // Si no cap per sota, el desplacem el mínim cap amunt
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
                        title="Opcions"
                    >
                        <MoreHorizontal size={14} />
                    </button>
                    {canCreateChild && (
                        <button
                            className="p-0.5 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-secondary)]/60"
                            onClick={(e) => { e.stopPropagation(); onCreatePage(page.id); }}
                            title="Afegeix Pàgina Filla"
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
                    {onRenamePage && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setMenuState(null);
                                setIsRenaming(true);
                            }}
                            className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                        >
                            <Edit2 size={14} className="text-[var(--text-secondary)]/60" />
                            <span>Renomenar</span>
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
                            <span>{isFavorite ? "Treure de Favorits" : "Afegir a Favorits"}</span>
                        </button>
                    )}
                    {onDuplicatePage && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setMenuState(null);
                                onDuplicatePage(page.id);
                            }}
                            className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                        >
                            <Copy size={14} className="text-[var(--text-secondary)]/60" />
                            <span>Duplicar</span>
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
                            <span>Obrir en paral·lel</span>
                        </button>
                    )}
                    <div className="h-px bg-[var(--border-primary)] my-1 mx-2"></div>
                    {onDeletePage && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setMenuState(null);
                            setTimeout(() => onDeletePage(page.id, page.title), 10);
                        }}
                        className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--status-error)] hover:bg-[var(--bg-secondary)] transition-colors font-medium"
                    >
                        <Trash2 size={14} className="text-[var(--status-error)]" />
                        <span>Eliminar</span>
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
                            menuState={menuState}
                            setMenuState={setMenuState}
                            canCreateChild={canCreateChild}
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
    onOpenTable,
    onOpenTableParallel,
    onCreateDatabaseGroup,
    onRenameDatabase,
    onDeleteDatabase,
    onCreateTable,
    onCreateTableRecord,
    onCreateDashworksPage,
    onOpenRecent,
    onCreateDrawing,
    currentView = 'editor'
}) => {
    const WIKI_BATCH_SIZE = 150;
    const DATABASES_BATCH_SIZE = 40;
    const TABLES_BATCH_SIZE = 60;
    const WIKI_ITEM_HEIGHT = 30;
    const WIKI_OVERSCAN = 10;
    const [isWorkspaceExpanded, setIsWorkspaceExpanded] = useState(true);
    const [isDashworksExpanded, setIsDashworksExpanded] = useState(true);
    const [isFavoritesExpanded, setIsFavoritesExpanded] = useState(true);
    const [isDatabasesExpanded, setIsDatabasesExpanded] = useState(true);
    const [expandedDatabases, setExpandedDatabases] = useState({});
    const [menuState, setMenuState] = useState(null);
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, type: '', id: '', name: '' });
    const [visibleWikiCount, setVisibleWikiCount] = useState(WIKI_BATCH_SIZE);
    const [visibleDatabasesCount, setVisibleDatabasesCount] = useState(DATABASES_BATCH_SIZE);
    const [visibleTablesByDb, setVisibleTablesByDb] = useState({});
    const [expandedWikiNodes, setExpandedWikiNodes] = useState({});
    const [expandedDashworksNodes, setExpandedDashworksNodes] = useState({});
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

        if (menuState && (menuState.type === 'database' || menuState.type === 'table')) {
            setTimeout(() => {
                document.addEventListener('click', handleClickOutside);
                document.addEventListener('keydown', handleKeyDown);
            }, 10);
        }
        return () => {
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

    const { childrenMap, rootPages, dataChildrenMap, dashworksChildrenMap, dashworksRootPages } = useMemo(() => {
        const computedChildrenMap = {};
        const computedRootPages = [];
        const computedDataChildrenMap = {};
        const computedDashworksChildrenMap = {};
        const computedDashworksRootPages = [];

        // Mapeig ràpid per trobar pàgines per ID
        const pagesById = {};
        (pages || []).forEach(p => { pagesById[p.id] = p; });

        const isDashworksPage = (page) => {
            if (!page) return false;
            const folder = String(page.folder || '');
            return page.metadata?.is_dashworks === true
                || folder === 'Dashworks'
                || folder.startsWith('Dashworks/')
                || folder === '.Dashworks'
                || folder.startsWith('.Dashworks/');
        };

        (pages || []).forEach(p => {
            if (p.metadata?.is_template) return;

            if (isDashworksPage(p)) {
                const parent = p.parent_id ? pagesById[p.parent_id] : null;
                const parentIsDashworks = isDashworksPage(parent);

                if (parentIsDashworks) {
                    if (!computedDashworksChildrenMap[p.parent_id]) computedDashworksChildrenMap[p.parent_id] = [];
                    computedDashworksChildrenMap[p.parent_id].push(p);
                } else {
                    computedDashworksRootPages.push(p);
                }
                return;
            }

            // Determinar si la pàgina pertany a la secció de dades (BD)
            const tableId = p.resolved_table_id || p.metadata?.table_id || p.metadata?.database_table_id;
            const isData = p.is_database || (!!tableId && tableId !== 'wiki') || p.folder?.startsWith('BD/');

            if (isData) {
                let finalTableId = tableId;
                
                // Si no tenim tableId però és a BD/, provem si el pare en té
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
            dashworksChildrenMap: computedDashworksChildrenMap,
            dashworksRootPages: computedDashworksRootPages,
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

    const handleToggleDashworksExpand = (pageId) => {
        setExpandedDashworksNodes(prev => ({ ...prev, [pageId]: !prev[pageId] }));
    };

    useEffect(() => {
        setVisibleDatabasesCount(DATABASES_BATCH_SIZE);
    }, [databases.length]);

    return (
        <div className="flex flex-col h-full select-none overflow-y-auto custom-scrollbar pb-8 bg-[var(--bg-primary)]">
            <div className="px-3 pt-4 mb-2 flex items-center justify-between group cursor-pointer hover:bg-[var(--bg-secondary)] rounded mx-2 py-1.5 transition-colors">
                <div className="flex items-center gap-2">
                    <div className="w-5 h-5 bg-gnosi/10 rounded flex items-center justify-center text-gnosi font-bold text-[10px]">G</div>
                    <span className="text-sm font-semibold text-[var(--text-primary)]">El meu Vault</span>
                </div>

            </div>

            <div className="px-2 space-y-0.5">
                <NavItem
                    icon={Search}
                    label="Cerca"
                    onClick={onSearch}
                    rightElement={<span className="text-[10px] font-semibold text-[var(--text-secondary)]/60 border border-[var(--border-primary)] bg-[var(--bg-secondary)] rounded px-1.5 py-0.5">Cmd K</span>}
                />
                <NavItem icon={Clock} label="Recent" onClick={onOpenRecent} />
                <div
                    className={`group relative w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors ${currentView === 'drawing' ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                    onClick={() => onNavigate('drawing')}
                >
                    <Palette size={16} className={currentView === 'drawing' ? 'text-gnosi' : 'text-amber-500'} />
                    <span className="truncate flex-1 text-left text-[var(--text-primary)]">Dibuixos</span>
                    {onCreateDrawing && (
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
                    <SectionHeader
                        label="Favorites"
                        isExpanded={isFavoritesExpanded}
                        onToggle={() => setIsFavoritesExpanded(!isFavoritesExpanded)}
                    />
                    {isFavoritesExpanded && (
                        <div className="px-2 space-y-0.5">
                            {favoritePages.map(page => (
                                <NavItem
                                    key={page.id}
                                    icon={FileText}
                                    label={page.title}
                                    onClick={() => onPageSelect(page.id)}
                                    colorClass="text-[var(--text-secondary)]/60"
                                    emoji={page.metadata?.icon}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}

            <SectionHeader
                label="Taulells"
                isExpanded={isDashworksExpanded}
                onToggle={() => {
                    setIsDashworksExpanded(prev => !prev);
                    setExpandedDashworksNodes({});
                }}
                onAdd={() => onCreateDashworksPage && onCreateDashworksPage(null)}
            />
            {isDashworksExpanded && (
                <div className="px-2 space-y-0.5">
                    {dashworksRootPages.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-[var(--text-secondary)]/60">No hi ha pàgines a Dashworks</div>
                    ) : (
                        dashworksRootPages.map(page => (
                            <PageTreeItem
                                key={page.id}
                                page={page}
                                depth={0}
                                childrenMap={dashworksChildrenMap}
                                expandedNodes={expandedDashworksNodes}
                                onToggleExpand={handleToggleDashworksExpand}
                                activePageId={activePageId}
                                onPageSelect={onPageSelect}
                                onOpenParallel={onOpenParallel}
                                onCreatePage={onCreateDashworksPage || onCreatePage}
                                onRenamePage={onRenamePage}
                                onDuplicatePage={onDuplicatePage}
                                onDeletePage={onDeletePage}
                                onToggleFavorite={onToggleFavorite}
                                menuState={menuState}
                                setMenuState={setMenuState}
                            />
                        ))
                    )}
                </div>
            )}

            <SectionHeader
                label="Dades"
                isExpanded={isDatabasesExpanded}
                onToggle={() => setIsDatabasesExpanded(!isDatabasesExpanded)}
                onAdd={() => onCreateDatabaseGroup && onCreateDatabaseGroup()}
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
                                        <button
                                            className="p-0.5 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-secondary)]/60 hover:text-gnosi"
                                            onClick={(e) => { e.stopPropagation(); onCreateTable && onCreateTable(db.id); }}
                                            title="Nova Taula"
                                        >
                                            <Plus size={14} />
                                        </button>
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
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (onCreateTableRecord) onCreateTableRecord(table.id);
                                                            }}
                                                            className="opacity-0 group-hover/tableItem:opacity-100 p-0.5 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-secondary)] hover:text-gnosi"
                                                            title="Nou registre"
                                                        >
                                                            <Plus size={12} />
                                                        </button>
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
                                                Mostrar {Math.min(TABLES_BATCH_SIZE, dbTables.length - visibleTableCount)} taules més
                                            </button>
                                        )}
                                        {dbTables.length === 0 && (
                                            <div className="px-2 py-1 text-[11px] text-[var(--text-secondary)]/60 italic">Sense taules</div>
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
                            Mostrar {Math.min(DATABASES_BATCH_SIZE, databases.length - visibleDatabasesCount)} bases de dades més
                        </button>
                    )}
                    {isRegistryLoading && (
                        <div className="px-4 py-2 text-[11px] text-[var(--text-secondary)]/60 italic">
                            Carregant bases de dades...
                        </div>
                    )}
                    {!isRegistryLoading && databases.length === 0 && (
                        <div className="px-4 py-2 text-[11px] text-[var(--text-secondary)]/60 italic">
                            No hi ha bases de dades creades.
                        </div>
                    )}
                </div>
            )}

            <SectionHeader
                label="Wiki"
                isExpanded={isWorkspaceExpanded}
                onToggle={() => {
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
                onAdd={() => onCreatePage(null)}
            />
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
                        <div className="px-3 py-2 text-xs text-[var(--text-secondary)]/60">Carregant...</div>
                    ) : rootPages.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-[var(--text-secondary)]/60">No hi ha pàgines sense taula</div>
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
                                    menuState={menuState}
                                    setMenuState={setMenuState}
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
                                    Mostrar {Math.min(WIKI_BATCH_SIZE, rootPages.length - visibleWikiCount)} més
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
                                <span>Obrir taula</span>
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
                                    <span>Obrir en pestanya nova</span>
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
                                    <span>Obrir en paral·lel</span>
                                </button>
                            )}
                            <div className="h-px bg-[var(--border-primary)] my-1 mx-2"></div>
                        </>
                    )}
                    <button
                        onClick={() => {
                            const newName = prompt(`Nou nom per ${menuState.type === 'database' ? 'la Database' : 'la Taula'}?`, menuState.name);
                            if (newName && newName !== menuState.name) {
                                if (menuState.type === 'database') onRenameDatabase(menuState.id, newName);
                                else onRenameTable(menuState.id, newName);
                            }
                            setMenuState(null);
                        }}
                        className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                        <Edit2 size={14} className="text-[var(--text-secondary)]/60" />
                        <span>Renomenar</span>
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
                        <span>Eliminar</span>
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
                    title={`Eliminar ${confirmModal.type === 'database' ? 'Database' : 'Taula'}`}
                    message={`Estàs segur que vols eliminar ${confirmModal.type === 'database' ? 'la Database (i totes les seves taules)' : 'la Taula'}? Aquesta acció no es pot desfer.`}
                    confirmText="Eliminar"
                    isDestructive={true}
                />
            )}
        </div>
    );
};
