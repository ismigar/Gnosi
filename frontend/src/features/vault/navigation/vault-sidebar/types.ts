import type { Dispatch, SetStateAction } from 'react';

export interface SidebarPage {
    id: string;
    title: string;
    parent_id?: string | null;
    folder?: string | null;
    is_database?: boolean;
    resolved_table_id?: string | null;
    last_modified?: string | null;
    metadata?: {
        icon?: string | null;
        favorite?: boolean | string;
        is_dashboard?: boolean;
        is_template?: boolean;
        database_table_id?: string | null;
        table_id?: string | null;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface SidebarDatabase { id: string; name: string; }
export interface SidebarTable { id: string; name: string; database_id: string; }
export interface SidebarView {
    id: string;
    name: string;
    table_id?: string | null;
    type?: string | null;
    joins?: readonly ({ tableId?: string | null; } | null)[] | null;
    enableSubitems?: boolean | null;
}

export interface PageActions {
    onPageSelect: (id: string) => unknown;
    onOpenParallel?: (id: string) => unknown;
    onCreatePage: (parentId: string | null) => unknown;
    onRenamePage?: (id: string, name: string) => unknown;
    onDuplicatePage?: (id: string) => unknown;
    onDeletePage?: (id: string, name: string) => unknown;
    onToggleFavorite?: (id: string) => unknown;
    onMovePage?: (id: string, parentId: string) => unknown;
}

export interface VaultSidebarProps extends PageActions {
    pages?: readonly SidebarPage[];
    databases?: readonly SidebarDatabase[];
    tables?: readonly SidebarTable[];
    views?: readonly SidebarView[];
    favoritePages?: readonly SidebarPage[];
    isRegistryLoading?: boolean;
    activePageId?: string | null;
    activeTableId?: string | null;
    onSearch?: () => void;
    onNavigate: (view: 'drawing' | 'tags' | 'trash') => unknown;
    onDeleteTable: (id: string) => unknown;
    onRenameTable: (id: string, name: string) => unknown;
    onTableSelect?: (tableId: string, viewId?: string) => unknown;
    onCreateDatabaseGroup?: () => unknown;
    onCreateTable?: (databaseId: string) => unknown;
    onCreateTableRecord?: (tableId: string) => unknown;
    onRenameDatabase: (id: string, name: string) => unknown;
    onDeleteDatabase: (id: string) => unknown;
    onOpenRecent?: () => void;
    onOpenDaily?: () => unknown;
    showTagsView?: boolean;
    onCreateDashboardPage?: (parentId: string | null) => unknown;
    currentView?: string;
    onCreateDrawing?: () => unknown;
    onOpenTable?: (id: string) => unknown;
    onOpenTableParallel?: (id: string) => unknown;
}

interface MenuPosition {
    id: string;
    x: number;
    y: number;
}
export type MenuState = MenuPosition & (
    | { type?: undefined; name?: undefined; }
    | { type: 'database' | 'table'; name: string; }
);
export interface RegistryModalState {
    isOpen: boolean;
    type: '' | 'database' | 'table';
    id: string;
    name: string;
}
export type ExpandedNodes = Record<string, boolean>;
export type PageChildren = Record<string, SidebarPage[]>;
export interface PageTreeItemProps extends PageActions {
    page: SidebarPage;
    depth?: number;
    role: string;
    childrenMap: PageChildren;
    expandedNodes: ExpandedNodes;
    onToggleExpand?: (id: string) => void;
    activePageId?: string | null;
    menuState: MenuState | null;
    setMenuState: Dispatch<SetStateAction<MenuState | null>>;
    canCreateChild?: boolean;
    isDragLocked?: boolean;
}

export type SidebarSections = Record<'favorites' | 'dashboards' | 'data' | 'wiki', boolean>;
export type FavoritesMode = 'manual' | 'alpha-asc' | 'alpha-desc' | 'recent' | 'oldest';
export interface FavoritesSort { mode: FavoritesMode; manualOrder: string[]; }
