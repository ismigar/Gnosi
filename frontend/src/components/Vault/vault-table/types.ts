import type { CSSProperties } from 'react';
import type { BulkActionTemplate } from '../VaultBulkActionsBar';
import type { InsertFileField, InsertImageMetadata } from '../insert-content/insertContentTypes';
import type { SchemaView, VaultSchema } from '../schemaTypes';
import type { TableGroupSort, TableRowDescriptor } from './rowTypes';

export interface TableMetadata extends Readonly<Record<string, unknown>> {
  readonly parent_id?: string;
  readonly table_id?: string;
  readonly database_table_id?: string;
  readonly database_id?: string;
  readonly icon?: string;
  readonly translation_lang?: string;
  readonly translation_stale?: boolean;
}
export interface TableNote extends Record<string, unknown> {
  readonly id: string;
  readonly title?: string;
  readonly parent_id?: string;
  readonly resolved_table_id?: string;
  readonly last_modified?: string;
  readonly metadata?: TableMetadata | null;
}
export interface TableView extends SchemaView, TableGroupSort {
  readonly id?: string;
  readonly table_id?: string;
  readonly rowHeight?: string;
  readonly groupBy?: string;
  readonly enableSubitems?: boolean;
  readonly columnWidths?: Readonly<Record<string, number>>;
  readonly visibleProperties?: readonly string[];
}
export interface TableNavApi {
  readonly focusFirstCell: () => boolean;
  readonly focusLastCell: () => boolean;
}
export interface VaultTableProps {
  readonly notes?: readonly TableNote[];
  readonly onNoteSelect: (id: string, options?: { returnFocusId: string; }) => void;
  readonly schema?: VaultSchema;
  readonly idToTitle?: Readonly<Record<string, string>>;
  readonly allNotes?: readonly TableNote[];
  readonly activeView?: TableView;
  readonly onUpdateView?: (view: TableView | undefined) => unknown;
  readonly isEmbedded?: boolean;
  readonly isListView?: boolean;
  readonly onCreateRecord?: () => void;
  readonly onDeletePage?: (id: string, title?: string) => void;
  readonly onDeleteSelected?: (ids: Set<string>) => void;
  readonly onApplyTemplate?: (ids: Set<string>, templateId: string) => void;
  readonly onCreateNotebook?: (ids: Set<string>) => void;
  readonly templates?: readonly BulkActionTemplate[];
  readonly onCellSaved?: () => unknown;
  readonly onUpdateFieldOptions?: (tableId: string, fieldId: string, options: readonly unknown[]) => void;
  readonly onOpenParallel?: (id: string) => void;
  readonly onTranslated?: (data: unknown) => void;
  readonly searchTerm?: string;
  readonly actionRules?: unknown;
  readonly functionalities?: unknown;
  readonly maxHeight?: CSSProperties['maxHeight'] | null;
  readonly registerNavApi?: ((api: TableNavApi | null) => void) | null;
  readonly onExitTop?: (() => void) | null;
  readonly onExitBottom?: (() => void) | null;
  readonly onEscape?: (() => void) | null;
  readonly restoreRecordFocus?: { readonly recordId: string; readonly requestId: string | number; } | null;
  readonly onRecordFocusRestored?: ((requestId: string | number) => void) | null;
}
export interface TableCell { readonly rowId: string; readonly field: string; }
export interface EditingCell extends TableCell { readonly originalMetaKey: string; }
export interface GridColumn { readonly key: string; readonly type: string; }
export interface NavigationRow { readonly id: string; readonly descriptorIndex: number; }
export interface SelectionRect { readonly r0: number; readonly r1: number; readonly c0: number; readonly c1: number; }
export interface CellUpdate { readonly id: string; readonly key: string; readonly field: string; readonly newValue: unknown; }
export interface MediaPickerCell extends EditingCell {
  readonly tableId: string | null;
  readonly fileField: InsertFileField | null;
  readonly imageField: boolean;
  readonly imageMeta: InsertImageMetadata | null;
  readonly rowMetadata: Readonly<Record<string, unknown>>;
}
export interface FileDeletePrompt extends EditingCell {
  readonly idx: number;
  readonly arr: readonly string[];
  readonly target: string;
  readonly fileName: string;
}
export interface PendingTableAction {
  readonly noteId: string;
  readonly action: string;
  readonly field?: string;
  readonly fieldConfig?: Readonly<Record<string, unknown>>;
  readonly sourceTableId?: string;
  readonly force?: boolean;
}
export type RowDescriptor = TableRowDescriptor<TableNote>;
export type MetadataPatch = Record<string, unknown>;
export type CellSave = (noteId: string, field: string, newValue: unknown, originalMetaKey: string, skipPropagation?: boolean, additionalMetaUpdates?: MetadataPatch) => Promise<boolean>;
