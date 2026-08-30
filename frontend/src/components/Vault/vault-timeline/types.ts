import type { TitlePreviewController } from '../useTitlePreview';
import type { BulkActionTemplate } from '../VaultBulkActionsBar';
import type {
    VaultSortInput,
    VaultViewConfig,
    VaultViewPage,
} from '../../../hooks/useVaultViewData';
import type { FilterNode } from '../../../utils/vaultFilters';
import type { FieldFormatConfig } from '../formatUtils';


export type TimelineSchema = Readonly<Record<string, unknown>>;
export type TimelineZoom = 'day' | 'week' | 'month';
export type TimelineUnit = 'hours' | 'days' | 'years';


export type TimelineRecord = VaultViewPage;


export type TimelineNote = VaultViewPage;


export type TimelineView = VaultViewConfig;


export interface TimelineFieldConfig extends FieldFormatConfig {
    readonly options?: unknown;
    readonly period_unit?: unknown;
    readonly skip_non_working_days?: unknown;
}


export interface TimelinePatch {
    readonly metadata: Readonly<Record<string, unknown>>;
}


export interface VaultTimelineProps {
    readonly activeView?: TimelineView;
    readonly idToTitle?: Readonly<Record<string, string>>;
    readonly notes?: readonly TimelineNote[];
    readonly onApplyTemplate?: (
        selectedIds: Set<string>,
        templateId: string,
    ) => void;
    readonly onCreateRecord?: () => void;
    readonly onDeletePage?: (noteId: string, title?: TimelineNote['title']) => void;
    readonly onDeleteSelected?: (selectedIds: Set<string>) => void;
    readonly onEditSchema?: (section: string) => void;
    readonly onNoteSelect?: (noteId: string) => void;
    readonly onUpdateNote?: (
        noteId: string,
        patch: TimelinePatch,
    ) => unknown;
    readonly schema?: TimelineSchema;
    readonly searchTerm?: string;
    readonly templates?: readonly TimelineTemplate[];
}


export type TimelineTemplate = BulkActionTemplate;


export interface TimelineTick {
    readonly at: Date;
    readonly label: string;
}


export interface TimelineScale {
    readonly end: Date;
    readonly start: Date;
    readonly ticks: readonly TimelineTick[];
}


export interface TimelineChartNote extends TimelineRecord {
    readonly depth: number;
    readonly end: Date;
    readonly isParent?: boolean;
    readonly start: Date;
    readonly summaryEnd?: Date;
    readonly summaryStart?: Date;
}


export interface TimelineChartModel {
    readonly chartData: readonly TimelineChartNote[];
    readonly timeScale: TimelineScale | null;
}


export interface TimelineSchemaReaders {
    readonly fieldConfig: (
        schema: TimelineSchema,
        field: string | undefined,
    ) => TimelineFieldConfig;
    readonly fieldEntries: (
        schema: TimelineSchema,
    ) => readonly (readonly [string, string])[];
    readonly fieldNames: (schema: TimelineSchema) => readonly string[];
    readonly fieldType: (
        schema: TimelineSchema,
        field: string | undefined,
    ) => string;
    readonly filters: (view: TimelineView) => readonly FilterNode[];
    readonly sorts: (
        view: TimelineView,
        fallback?: VaultSortInput | null,
    ) => VaultSortInput[];
}


export interface TimelineController {
    readonly activeFiltersCount: number;
    readonly activeSortsCount: number;
    readonly calculatePosition: (date: Date) => number;
    readonly chartData: readonly TimelineChartNote[];
    readonly clearSelection: () => void;
    readonly externalSearch: boolean;
    readonly formatTimelineDate: (date: Date) => string;
    readonly getBarColor: (note: TimelineChartNote) => string;
    readonly getPredecessors: (note: TimelineRecord) => readonly string[];
    readonly handleAddPredecessor: (
        noteId: string,
        predecessorId: string,
    ) => Promise<void>;
    readonly handleBulkDelete: () => void;
    readonly isSelected: (noteId: string) => boolean;
    readonly predecessorCandidates: readonly TimelineChartNote[];
    readonly scaleMinWidth: string;
    readonly scroll: (direction: 'left' | 'right') => void;
    readonly scrollContainerId: string;
    readonly searchTerm: string;
    readonly selectAll: (ids?: readonly string[] | null) => void;
    readonly selectedIds: ReadonlySet<string>;
    readonly selectingPredecessorFor: string | null;
    readonly setSearchTerm: (value: string) => void;
    readonly setSelectingPredecessorFor: (noteId: string | null) => void;
    readonly setZoomLevel: (zoom: TimelineZoom) => void;
    readonly sortedNotes: readonly TimelineNote[];
    readonly timeScale: TimelineScale | null;
    readonly titlePreview: TitlePreviewController;
    readonly toggleSelect: (
        noteId: string,
        isShift: boolean,
    ) => void;
    readonly zoomLevel: TimelineZoom;
}
