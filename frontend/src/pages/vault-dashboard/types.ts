import type { ResourceProcessingJob } from '../../shared/api/resource-processing';
import type { RelationUnlinkedEventDetail, DocumentLocationEventDetail } from '../../shared/platform/app-events';
import type { TableProperty } from '../../components/Vault/schemaTypes';
import type { FilterNode } from '../../utils/vaultFilters';
export type Metadata = Record<string, unknown>;
export interface Page extends Metadata {
    id: string;
    title: string;
    content?: string;
    metadata?: Metadata;
    parent_id?: string | null;
    resolved_table_id?: string | null;
    last_modified?: string | null;
    folder?: string | null;
}
export interface Tab extends Page {
    isTable?: boolean;
    isDrawing?: boolean;
    isPdf?: boolean;
    tableId?: string;
    src?: string;
    kind?: 'pdf' | 'epub' | 'snapshot';
    location?: DocumentLocationEventDetail | null;
    origin?: {
        tableId: string | null;
        tabId: string | null;
        viewId: string | null;
    };
}
export interface Join extends Metadata {
    tableId?: string;
    leftField?: string;
    field?: string;
    rightField?: string;
    _indexByField?: string;
    type?: string;
}
export type VisibleProperty = string | {
    fieldKey?: string;
    tableId?: string | null;
};
export interface View extends Metadata {
    id: string;
    name: string;
    type: string;
    table_id?: string | null;
    order?: number;
    is_main?: boolean;
    embedded?: boolean;
    hidden?: boolean;
    enableSubitems?: boolean;
    visibleProperties?: VisibleProperty[];
    visible_properties?: VisibleProperty[];
    columns?: VisibleProperty[];
    joins?: Join[];
    filters?: readonly FilterNode[];
    filterTree?: FilterNode;
}
export type ViewDraft = Partial<View>;
export interface Table extends Metadata {
    id: string;
    name: string;
    database_id: string;
    title?: string;
    properties?: TableProperty[];
    translation_enabled?: boolean;
    drupal_sync_enabled?: boolean;
    drupal_bundle?: string;
    drupal_field_mapping?: Record<string, string>;
}
export interface Database extends Metadata {
    id: string;
    name: string;
}
export interface Registry {
    databases: Database[];
    tables: Table[];
    views: View[];
}
export type ViewMode = 'editor' | 'table' | 'drawing' | 'trash' | 'tags';
export interface HistoryOrigin {
    type: 'editor' | 'table' | 'drawing';
    id: string;
    subId?: string | null;
}
export interface HistoryEntry extends HistoryOrigin {
    is_dashboard?: unknown;
    metadata?: Metadata;
    from?: HistoryOrigin | null;
    resourceType?: 'page' | 'dashboard';
}
export interface RecordReturnFocus {
    recordId: string;
    tableId: string;
    viewId: string | null;
    requestId: number;
    isArmed: boolean;
}
export interface OpenRecordContext {
    returnFocusId?: string;
}
export interface PromptState {
    isOpen: boolean;
    defaultTitle: string;
    inputValue: string;
    isLoading: boolean;
    parentId?: string | null;
    isDatabase?: boolean;
    isDrawing?: boolean;
    isDashboard?: boolean;
    isView?: boolean;
    isRename?: boolean;
    isTemplate?: boolean;
    isApp?: boolean;
    templateTableId?: string | null;
    databaseId?: string;
    targetView?: ViewDraft | null;
    viewType?: string | null;
}
export interface ResourceTarget {
    noteId: string;
    title: string;
    sourceTableId: string;
    force: boolean;
}
export interface WikiConfig extends Metadata {
    source_tables?: {
        table_id: string;
    }[];
    processed_resources?: Record<string, Record<string, unknown>>;
}
export type ResourceJobs = Record<string, Record<string, ResourceProcessingJob>>;
export type RelationOperation = RelationUnlinkedEventDetail & {
    type: 'relation_unlink';
};
export type HistoryOperation = {
    type: 'delete';
    ids: string[];
} | RelationOperation;
export interface EditorUpdate {
    title?: string;
    metadata?: Metadata;
}
export interface Breadcrumb {
    label: string;
    onClick: () => unknown;
}
export interface TranslatedResult {
    created?: {
        id?: string;
    }[];
    updated?: {
        id?: string;
    }[];
    results?: {
        created?: {
            id?: string;
        }[];
        updated?: {
            id?: string;
        }[];
    }[];
}
export interface PageResponse {
    data: Page;
}
