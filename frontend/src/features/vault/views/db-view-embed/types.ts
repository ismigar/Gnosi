import type { ReactNode } from 'react';
import type { VaultViewPage } from '../../../../shared/records/hooks/useVaultViewData';
import type { FilterGroup, FilterNode, FilterRule, FilterValue } from '../../../../shared/filtering/vaultFilters';
import type { TableProperty } from '../../../../shared/records/model/schemaTypes';
import type { ViewAppearance, ViewColumn, ViewSort } from '../../view-config/page-view-modal/types';
import type { VaultEditorContextValue } from '../../../../shared/editor/VaultEditorContext';

export type Metadata = Record<string, FilterValue>;
export interface EmbedRow extends VaultViewPage { title: string; metadata: Metadata; content?: string; }
export interface EmbedJoin {
    tableId?: string;
    leftField?: string;
    rightField?: string;
    type?: string;
    [key: string]: unknown;
}
export type Column = string | ViewColumn;
export interface QuickPreset {
    id: string;
    label: string;
    searchTerm?: string;
    density?: string;
    groupMode?: string;
    activeViewId?: string;
    [key: string]: unknown;
}
export interface EmbedView extends Omit<ViewAppearance, 'groupBy' | 'group_by'> {
    groupBy?: string | null;
    group_by?: string | null;
    [key: string]: unknown;
    id?: string | null;
    view_id?: string;
    heading?: string;
    heading_level?: number;
    name?: string | null;
    table_id?: string | null;
    source_table_id?: string;
    type?: string | null;
    view_type?: string;
    visibleProperties?: Column[];
    visible_properties?: Column[];
    columns?: Column[];
    filterTree?: FilterGroup;
    filters?: FilterNode[];
    filter?: FilterRule;
    sorts?: ViewSort[];
    sort?: ViewSort | null;
    joins?: EmbedJoin[];
    quickPresets?: QuickPreset[];
    tabs?: string[];
    enableSubitems?: boolean;
    enable_subitems?: boolean;
    columnWidths?: Record<string, number>;
    column_widths?: Record<string, number>;
    is_main?: boolean | null;
    is_default?: boolean;
}
export interface EmbedTable { id: string; properties?: TableProperty[]; action_rules?: unknown; functionalities?: unknown; }
export interface EmbedBlock {
    id?: string;
    props?: { view_id?: string; heading?: string; heading_level?: number | string; section?: string; };
}
export interface DbViewEmbedProps { block?: EmbedBlock; }
export interface NavApi { focusFirstCell?: () => unknown; focusLastCell?: () => unknown; }
export type EmbedContext = Pick<VaultEditorContextValue, 'pageId' | 'idToTitle' | 'onOpenPage' | 'onOpenPageViewModal' | 'onOpenViewConfig' | 'onOpenParallel' | 'onDeletePage' | 'onEditSchema'> & {
    registry: { tables: EmbedTable[]; views: EmbedView[]; };
    allTables: EmbedTable[];
    exitEmbedToEditor?: (blockId: string | undefined, direction: 'up' | 'down' | 'escape') => unknown;
    registerEmbedNav?: (blockId: string, api: NavApi | null) => unknown;
    viewSectionNonce?: number;
    referenceTableId?: string;
    onAddSchemaOption?: (...args: readonly unknown[]) => unknown;
    onCreateTemplate?: (tableId: string) => unknown;
    onCreateFromSource?: (tableId: string | null | undefined) => unknown;
};
export interface BoxProps { children: ReactNode; }
export interface ViewActionsProps {
    onCreate?: ((extra?: Metadata, template?: EmbedRow | null) => unknown) | null;
    onCreateTemplate?: (() => unknown) | null;
    onCreateFromSource?: (() => unknown) | null;
    onAddView?: (() => unknown) | null;
    templates?: readonly EmbedRow[];
    onOpenConfig?: (() => void) | null;
    searchTerm: string;
    setSearchTerm?: (term: string) => void;
    showSearch: boolean;
    setShowSearch?: (value: boolean) => void;
    density: string;
    onToggleDensity?: (() => void) | null;
    activeFilterCount?: number;
    resultCount?: number;
    totalCount?: number;
    presets?: readonly QuickPreset[];
    onSavePreset?: () => void;
    onApplyPreset?: (id: string) => void;
    onRenamePreset?: (id: string) => void;
    onDeletePreset?: (id: string) => void;
    onExportPresets?: () => unknown;
    onImportPresets?: () => void;
    groupMode?: string;
    onToggleGroup?: (() => void) | null;
    loadDuration?: number | null;
}
