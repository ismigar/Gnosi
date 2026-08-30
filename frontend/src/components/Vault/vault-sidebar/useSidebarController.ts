import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../../hooks/use-api';
import { useActiveVaultName } from '../../../hooks/useActiveVaultName';
import { subscribeAppSignal } from '../../../shared/platform/app-events';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { buildVaultSidebarTrees } from '../vaultSidebarTree';
import { allowsSubitems, groupTables, groupViews } from './model';
import type { ExpandedNodes, MenuState, RegistryModalState, VaultSidebarProps } from './types';
import { useSidebarPreferences } from './useSidebarPreferences';
declare module '../../../shared/platform/app-events' {
    interface AppEventMap { readonly 'gnosi:locate-active-page': null; }
}
export function useSidebarController(props: VaultSidebarProps) {
    const {
        pages = [],
        databases = [],
        tables = [],
        views = [],
        isRegistryLoading = false,
        activePageId,
        favoritePages = [],
        showTagsView = true,
    } = props;
    const { t } = useTranslation();
    const activeVaultName = useActiveVaultName();
    // Preserve the legacy platform test without substituting a different user-agent policy.
    const platform: unknown = typeof navigator === 'undefined' ? '' : Reflect.get(navigator, 'platform');
    const isMac = typeof platform === 'string' && /Mac|iPhone|iPad|iPod/.test(platform);
    const globalSearchShortcut = isMac ? '⌥ K' : 'Alt K';

    const { role } = useApi();
    const isAdmin = role === 'admin' || role === 'owner';
    const isEditor = role === 'editor' || isAdmin;
    const WIKI_BATCH_SIZE = 150;
    const DATABASES_BATCH_SIZE = 40;
    const TABLES_BATCH_SIZE = 60;
    const WIKI_ITEM_HEIGHT = 30;
    const WIKI_OVERSCAN = 10;
    const preferences = useSidebarPreferences();
    const { isWorkspaceExpanded, setIsFavoritesExpanded, setIsWorkspaceExpanded } = preferences;
    const [expandedDatabases, setExpandedDatabases] = useState<ExpandedNodes>({});
    const [menuState, setMenuState] = useState<MenuState | null>(null);
    const [confirmModal, setConfirmModal] = useState<RegistryModalState>({ isOpen: false, type: '', id: '', name: '' });
    const [renameModal, setRenameModal] = useState<RegistryModalState>({ isOpen: false, type: '', id: '', name: '' });
    const [visibleWikiCount, setVisibleWikiCount] = useState(WIKI_BATCH_SIZE);
    const [visibleDatabasesCount, setVisibleDatabasesCount] = useState(DATABASES_BATCH_SIZE);
    const [visibleTablesByDb, setVisibleTablesByDb] = useState<Record<string, number>>({});
    const [expandedWikiNodes, setExpandedWikiNodes] = useState<ExpandedNodes>({});
    const [expandedDashboardNodes, setExpandedDashboardNodes] = useState<ExpandedNodes>({});
    const [expandedTables, setExpandedTables] = useState<ExpandedNodes>({});
    const [expandedTableSections, setExpandedTableSections] = useState<ExpandedNodes>({});
    const [wikiScrollTop, setWikiScrollTop] = useState(0);
    const [wikiViewportHeight, setWikiViewportHeight] = useState(380);
    const wikiViewportRef = useRef<HTMLDivElement>(null);
    const toggleDatabase = (id: string) => {
        setExpandedDatabases(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const toggleTableExpand = (id: string) => {
        setExpandedTables(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const toggleTableSection = (tableId: string, section: 'content' | 'views') => {
        const key = `${tableId}:${section}`;
        setExpandedTableSections(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const { childrenMap, rootPages, dataChildrenMap, dashboardChildrenMap, dashboardRootPages } = useMemo(
        () => buildVaultSidebarTrees(pages),
        [pages]
    );
    const tablesByDatabase = useMemo(() => groupTables(tables), [tables]);
    const viewsByTable = useMemo(() => groupViews(views), [views]);
    const tableAllowsSubitems = useMemo(() => allowsSubitems(viewsByTable), [viewsByTable]);
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
        return () => { window.cancelAnimationFrame(frame); };
    }, [rootPages.length]);

    useEffect(() => {
        const updateHeight = () => {
            if (wikiViewportRef.current) {
                setWikiViewportHeight(wikiViewportRef.current.clientHeight || 380);
            }
        };
        queueMicrotask(updateHeight);
        return subscribeWindowEvent('resize', updateHeight);
    }, [isWorkspaceExpanded]);

    useEffect(() => {
        if (!wikiVirtualizationEnabled) return undefined;
        const frame = window.requestAnimationFrame(() => {
            setVisibleWikiCount(WIKI_BATCH_SIZE);
        });
        return () => { window.cancelAnimationFrame(frame); };
    }, [wikiVirtualizationEnabled]);
    const handleToggleWikiExpand = (pageId: string) => {
        setExpandedWikiNodes(prev => ({ ...prev, [pageId]: !prev[pageId] }));
    };

    const handleToggleDashboardExpand = (pageId: string) => {
        setExpandedDashboardNodes(prev => ({ ...prev, [pageId]: !prev[pageId] }));
    };

    const locateActivePage = useCallback(() => {
        if (!activePageId) return;
        const byId = Object.fromEntries((pages).map((page) => [page.id, page]));
        const ancestors: ExpandedNodes = {};
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
                [...document.querySelectorAll<HTMLElement>('[data-vault-page-id]')]
                    .find((element) => element.dataset.vaultPageId === activePageId)
                    ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            });
        });
    }, [activePageId, pages, setIsFavoritesExpanded, setIsWorkspaceExpanded]);
    useEffect(() => subscribeAppSignal('gnosi:locate-active-page', locateActivePage), [locateActivePage]);
    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            setVisibleDatabasesCount(DATABASES_BATCH_SIZE);
        });
        return () => { window.cancelAnimationFrame(frame); };
    }, [databases.length]);
    const toggleWorkspace = () => {
        setIsWorkspaceExpanded(prev => {
            const next = !prev;
            if (next) {
                setWikiScrollTop(0);
                requestAnimationFrame(() => { if (wikiViewportRef.current) wikiViewportRef.current.scrollTop = 0; });
            }
            return next;
        });
        setExpandedWikiNodes({});
    };
    return {
        ...props, pages, databases, tables, views, favoritePages, isRegistryLoading, showTagsView,
        ...preferences, t, activeVaultName, globalSearchShortcut, role, isAdmin, isEditor,
        WIKI_BATCH_SIZE, DATABASES_BATCH_SIZE, TABLES_BATCH_SIZE,
        expandedDatabases, menuState, setMenuState, confirmModal, setConfirmModal, renameModal, setRenameModal,
        visibleWikiCount, setVisibleWikiCount, visibleDatabasesCount, setVisibleDatabasesCount, visibleTablesByDb, setVisibleTablesByDb,
        expandedWikiNodes, setExpandedWikiNodes, expandedDashboardNodes, setExpandedDashboardNodes,
        expandedTables, expandedTableSections, setWikiScrollTop, wikiViewportRef,
        toggleDatabase, toggleTableExpand, toggleTableSection, childrenMap, rootPages, dataChildrenMap, dashboardChildrenMap, dashboardRootPages,
        tablesByDatabase, viewsByTable, tableAllowsSubitems, visibleRootPages, visibleDatabases,
        wikiVirtualizationEnabled, virtualWikiRootPages, wikiTopSpacerHeight, wikiBottomSpacerHeight,
        handleToggleWikiExpand, handleToggleDashboardExpand, locateActivePage, toggleWorkspace
    };
}
export type SidebarController = Omit<ReturnType<typeof useSidebarController>, 'wikiViewportRef'>;
