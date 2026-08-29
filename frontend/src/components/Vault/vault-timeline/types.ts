import type { ComponentType, ReactNode } from 'react';

import type { TitlePreviewController } from '../useTitlePreview';
import type {
    VaultSortInput,
    VaultViewConfig,
    VaultViewPage,
} from '../../../hooks/useVaultViewData';
import type { FilterNode, FilterValue } from '../../../utils/vaultFilters';
import type { FieldFormatConfig } from '../formatUtils';


export type TimelineSchema = Readonly<Record<string, unknown>>;
export type TimelineZoom = 'day' | 'week' | 'month';
export type TimelineUnit = 'hours' | 'days' | 'years';


export interface TimelineRecord {
    readonly id: string;
    readonly last_modified?: string;
    readonly metadata?: Readonly<Record<string, FilterValue>>;
    readonly parent_id?: FilterValue;
    readonly title?: string;
}


export type TimelineNote = VaultViewPage & TimelineRecord;


export interface TimelineView extends VaultViewConfig {
    readonly colorField?: string;
    readonly dateField?: string;
    readonly endDateField?: string;
    readonly id?: string;
}


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
    readonly onDeletePage?: (noteId: string, title?: string) => void;
    readonly onDeleteSelected?: (selectedIds: Set<string>) => void;
    readonly onEditSchema?: (section: string) => void;
    readonly onNoteSelect: (noteId: string) => void;
    readonly onUpdateNote?: (
        noteId: string,
        patch: TimelinePatch,
    ) => unknown;
    readonly schema?: TimelineSchema;
    readonly searchTerm?: string;
    readonly templates?: readonly TimelineTemplate[];
}


export interface TimelineTemplate {
    readonly id: string;
    readonly [key: string]: unknown;
}


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
    readonly filters: (view: TimelineView) => FilterNode[];
    readonly sorts: (
        view: TimelineView,
        fallback?: VaultSortInput | null,
    ) => VaultSortInput[];
}


export interface TimelineBulkActionsProps {
    readonly onApplyTemplate: ((templateId: string) => void) | null;
    readonly onClearSelection: () => void;
    readonly onDeleteSelected: (() => void) | null;
    readonly onSelectAll: () => void;
    readonly selectedIds: ReadonlySet<string>;
    readonly templates: readonly TimelineTemplate[];
    readonly totalCount: number;
}


export interface TimelineToolbarProps {
    readonly activeFiltersCount: number;
    readonly activeSortsCount: number;
    readonly extraActions: ReactNode;
    readonly isEmbedded: boolean;
    readonly onAddNew?: () => void;
    readonly onSearchChange: (value: string) => void;
    readonly onToggleFilters: () => void;
    readonly onToggleSorts: () => void;
    readonly search: string;
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


export type LegacyTimelineToolbar = ComponentType<TimelineToolbarProps>;
export type LegacyTimelineBulkActions = ComponentType<TimelineBulkActionsProps>;
