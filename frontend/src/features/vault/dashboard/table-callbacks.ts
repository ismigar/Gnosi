import { emitAppEvent } from '../../../shared/platform/app-events';
import { canCreateNotebookFromTable } from '../../notebooks/model/notebookTableActions';
import { readViewDraft, record, text } from './readers';
import type { OpenRecordContext, TranslatedResult } from './types';
import type { DashboardController } from './useDashboardController';
/** Keep the runtime callback results: view renderers can await refreshes and mutations. */
export function tableBodyCallbacks(d: DashboardController, tableId: string, viewId: string, split: boolean) {
    return {
        onNoteSelect: (id: string, context: OpenRecordContext | null = null) => d.openRecordFromView(id, tableId, viewId, context),
        onRecordFocusRestored: d.handleRecordFocusRestored,
        onSearchChange: d.setSearchTerm,
        onUpdateView: (value?: unknown) => d.handleUpdateView(readViewDraft(value)),
        onDeletePage: d.handleDeletePage,
        onDeleteSelected: d.handleDeleteSelected,
        onApplyTemplate: (ids: Set<string>, templateId: string) => d.handleApplyTemplate(ids, templateId, tableId),
        onCreateNotebook: !split && canCreateNotebookFromTable(d.refTableId, tableId)
            ? (ids: readonly string[]) => { emitAppEvent('gnosi:create-notebook', { resourceIds: [...ids].map(String) }); }
            : undefined,
        onOpenParallel: d.handleOpenParallel,
        onUpdateFieldOptions: (tableValue?: unknown, fieldValue?: unknown, options?: unknown) => d.handleAddSchemaOption(text(tableValue), text(fieldValue), Array.isArray(options) ? options : []),
        onUpdateNote: (id?: unknown, data?: unknown) => d.handleUpdateNote(text(id), record(data)),
        onCellSaved: async () => { await d.fetchPagesByTable(tableId); },
        onTranslated: (data: TranslatedResult = {}) => d.refreshTableAfterTranslate(tableId, data),
        onCreateRecord: (templateId: string | null = null) => d.handleAddNewNote(tableId, templateId),
    };
}
