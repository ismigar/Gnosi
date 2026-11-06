import { pageReferenceTitle } from '../../../../shared/records/pageReferenceTitle';
import { Columns2, ExternalLink, Link as LinkIcon, Trash2 } from 'lucide-react';
import { PageActionsBar } from '../../editor/PageActionsBar';
import { buildRecordActions } from './recordActions';
import type { TableNote } from './types';
import type { TableController } from './useTableController';

export function RowActions({ model, note, isChild }: { model: TableController, note: TableNote; isChild: boolean; }) {
  const {
    isListView,
    isSelected,
    onNoteSelect,
    selectedIds,
    toggleSelect,
    t,
    hasOpenableResource,
    handleOpenExternalResource,
    openingResourceId,
    onOpenParallel,
    tableFunctionalities,
    schema,
    actionRules,
    executingButtonKey,
    executeTableFunctionality,
    setPendingAction,
    isLlmWikiTable,
    llmWikiJobs,
    llmWikiTableId,
    llmWikiConfig,
    i18n,
    onDeletePage,
  } = model;
  return (<td className={`w-10 px-2 sticky left-0 z-20 hover:z-50 text-center align-top pt-2.5 ${isSelected(note.id) ? 'bg-indigo-50 dark:bg-indigo-950' : isChild ? 'bg-[var(--bg-secondary)]' : 'bg-[var(--bg-primary)]'}`}>
    {!isListView && <span className="block text-[10px] tabular-nums text-[var(--text-tertiary)]" data-row-number>{(model.navRowIndexById.get(note.id) ?? 0) + 1}</span>}
    <div className="flex items-center justify-center gap-1.5" onClick={event => { event.stopPropagation(); }}>
      {/* Selection checkbox */}
      <label
        className={`cursor-pointer inline-flex items-center shrink-0 ${isSelected(note.id) || selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100'}`}
        onClick={(e) => { e.stopPropagation(); }}
      >
        <input
          type="checkbox"
          aria-label={t('table.select_row', { title: pageReferenceTitle(note.id, {}, note.title) })}
          checked={isSelected(note.id)}
          onChange={(e) => { toggleSelect(note.id, { shiftKey: 'shiftKey' in e && Boolean(e.shiftKey) }); }}
          className="w-3.5 h-3.5 rounded border-[var(--border-primary)] text-indigo-600 focus:ring-indigo-500 cursor-pointer"
        />
      </label>
      <button
        onClick={(e) => { e.stopPropagation(); onNoteSelect(note.id, { returnFocusId: note.id }); }}
        className={`relative p-1 text-[var(--text-tertiary)] hover:text-indigo-600 transition-colors ${selectedIds.size > 0 ? 'hidden' : 'block'}`}
        aria-label={t('common.open')}
      >
        <ExternalLink size={14} />
        <span className="row-action-tooltip">{t('common.open')}<kbd>⌥O</kbd></span>
      </button>
      <PageActionsBar compactHeader compactOverflowItems={[
        ...(hasOpenableResource(note) ? [{ key: 'open-resource', Icon: LinkIcon, label: t('table.open_resource_tooltip'), disabled: openingResourceId === note.id, onClick: () => { void handleOpenExternalResource(note); } }] : []),
        ...(onOpenParallel ? [{ key: 'open-parallel', Icon: Columns2, label: t('table.open_parallel'), onClick: () => { onOpenParallel(note.id); } }] : []),
        ...buildRecordActions({ note, schema, functionalities: tableFunctionalities, actionRules,
          tableId: llmWikiTableId, isPluginEnabled: model.isPluginEnabled,
          processingConfigured: isLlmWikiTable, job: llmWikiJobs[llmWikiTableId]?.[note.id],
          processed: llmWikiConfig?.processed_resources[llmWikiTableId]?.[note.id],
          executingButtonKey, t, language: i18n.language,
          execute: functionality => { void executeTableFunctionality(null, note, functionality); }, setPendingAction,
        }),
      ]} />
      {onDeletePage && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDeletePage(note.id, note.title);
          }}
          className="relative p-1 text-[var(--text-tertiary)] hover:text-red-500 transition-colors opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
          aria-label={t('table.delete')}
        >
          <Trash2 size={14} />
          <span className="row-action-tooltip">{t('table.delete')}<kbd>⌘⌫</kbd></span>
        </button>
      )}
    </div>
  </td>);
}
