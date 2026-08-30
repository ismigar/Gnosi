import type { TFunction } from 'i18next';
import type { VaultViewInput, ViewUsage } from '../../../shared/api/vault-views';
import type { PAGE_VIEW_MODAL_API } from './api';

export interface Field {
    name: string;
    type?: string;
    relation_database_id?: string;
    options?: unknown;
    config?: { options?: unknown };
    label?: string;
    displayName?: string;
}
export interface ViewTable {
    id: string;
    name?: string;
    properties?: readonly Field[];
}
export interface ViewColumn {
    tableId?: string | null;
    fieldKey: string;
    label?: unknown;
}
export type VisibleProperty = string | ViewColumn;
export interface ViewJoin {
    tableId: string;
    type: string;
    leftTableId?: string;
    leftField: string;
    rightField: string;
}
export interface ViewSort { field: string; direction?: string }
export type FilterValue = string | number | boolean | null | string[] | Record<string, unknown>;
export interface FilterRule {
    [key: string]: unknown;
    field: string;
    operator: string;
    value?: FilterValue;
    periodPart?: string;
}
export interface FilterGroup { conjunction: string; rules: FilterNode[] }
export type FilterNode = FilterGroup | FilterRule;
export interface RelationOption { value: string; label: string }
export interface FilterContext {
    tableFields: Field[];
    fieldMeta: Record<string, Field | undefined>;
    fieldLabel: (name: string) => string;
    relationCache: Record<string, RelationOption[] | undefined>;
    defaultFilterValue: (name: string) => FilterValue;
    t: TFunction;
}
export interface ViewAppearance {
    cardSize?: string | null;
    galleryPreview?: string | null;
    coverField?: string; cover_field?: string;
    imageFit?: string; image_fit?: string;
    groupBy?: string; group_by?: string;
    groupSort?: string; group_sort?: string;
    groupSortDir?: string; group_sort_dir?: string;
    dateField?: string; date_field?: string;
    endDateField?: string; end_date_field?: string;
    calendarView?: string; calendar_view?: string;
    colorField?: string; color_field?: string;
    rowHeight?: string; row_height?: string;
    pillLimit?: unknown; pill_limit?: unknown; feedPillLimit?: number;
    excerptLines?: unknown; excerpt_lines?: unknown; feedExcerptLines?: number;
    feedFocus?: unknown; feed_focus?: unknown;
    summaryModel?: string; summary_model?: string;
    chartType?: string; chart_type?: string;
    xField?: string; x_field?: string;
    yField?: string; y_field?: string;
    aggregation?: string;
}
export interface ViewConfig extends ViewAppearance {
    [key: string]: unknown;
    id?: string | null;
    name?: string | null;
    table_id?: string | null;
    source_table_id?: string;
    type?: string | null;
    is_main?: boolean | null;
    is_default?: boolean;
    visibleProperties?: VisibleProperty[];
    joins?: ViewJoin[];
    filterTree?: FilterGroup | null;
    filters?: FilterRule[];
    sorts?: ViewSort[];
    sort?: ViewSort | null;
    resultSnapshot?: unknown;
    resultSnapshotLimit?: unknown;
}
export type RegistryView = ViewConfig & { id: string };
export type Usage = Pick<ViewUsage, 'count' | 'pages'>;
export type SavedView = Record<string, unknown>;
export type PersistView = (options?: { closeAfter?: boolean }) => Promise<SavedView | null>;
export interface EditingBlock {
    props?: { heading?: string; heading_level?: number; view_id?: string; section?: string };
}
export interface PageViewModalProps {
    isOpen: boolean;
    onClose: (saved?: boolean, result?: SavedView) => void;
    pageId: string;
    allTables?: readonly ViewTable[];
    api?: PageViewApi;
    preselectedTableId?: string;
    editingBlock?: EditingBlock | null;
    mode?: string;
    editingView?: VaultViewInput | null;
    initialTab?: string | null;
}
// The injectable API retains legacy list envelopes and nullable lookup results.
// All actual requests are still made by the generated shared clients.
export type PageViewApi = Omit<typeof PAGE_VIEW_MODAL_API,
    'fetchVaultViews' | 'fetchVaultView' | 'fetchVaultPages' | 'fetchVaultSummarySettings'> & {
        fetchVaultViews: (tableId?: string) => Promise<unknown>;
        fetchVaultView: (id: string) => Promise<unknown>;
        fetchVaultPages: typeof PAGE_VIEW_MODAL_API.fetchVaultPages | ((query: { table_id: string; limit: number }) => Promise<unknown>);
        fetchVaultSummarySettings: () => Promise<{ settings?: Record<string, unknown> }>;
    };
