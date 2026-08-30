import { BrainCircuit, Columns2, ExternalLink, Globe, Languages, Link as LinkIcon, Loader2, Send, Sparkles, Trash2, Zap } from 'lucide-react';
import { checkActionRequires } from '../../../../shared/records/model/optionCatalogUtils';
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
    hasTranslateFunctionality,
    isTranslatableTable,
    setPendingAction,
    isDrupalSyncTable,
    isSocialPublishTable,
    isLlmWikiTable,
    llmWikiJobs,
    llmWikiTableId,
    llmWikiConfig,
    i18n,
    onDeletePage,
  } = model;
  return (<td className={`w-10 px-2 sticky left-0 z-20 hover:z-50 text-center align-top pt-2.5 ${isSelected(note.id) ? 'bg-indigo-50 dark:bg-indigo-950' : isChild ? 'bg-[var(--bg-secondary)]' : 'bg-[var(--bg-primary)]'}`}>
    <div className="flex items-center justify-center gap-0.5">
      {/* Selection checkbox */}
      <label
        className={`cursor-pointer inline-flex items-center shrink-0 ${isSelected(note.id) || selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'}`}
        onClick={(e) => { e.stopPropagation(); }}
      >
        <input
          type="checkbox"
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
      {hasOpenableResource(note) && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void handleOpenExternalResource(note);
          }}
          disabled={openingResourceId === note.id}
          className="relative p-1 text-[var(--text-tertiary)] hover:text-emerald-600 transition-colors"
          aria-label={t('table.open_resource_tooltip')}
        >
          <LinkIcon size={14} />
          <span className="row-action-tooltip">{t('table.open_resource_tooltip')}<kbd>⌥R</kbd></span>
        </button>
      )}
      {onOpenParallel && (
        <button
          onClick={(e) => { e.stopPropagation(); onOpenParallel(note.id); }}
          className="relative p-1 text-[var(--text-tertiary)] hover:text-purple-600 transition-colors opacity-60 hover:opacity-100"
          aria-label={t('table.open_parallel')}
        >
          <Columns2 size={14} />
          <span className="row-action-tooltip">{t('table.open_parallel')}<kbd>⌥P</kbd></span>
        </button>
      )}
      {!isListView && tableFunctionalities.map((functionality) => {
        const action = functionality.action || 'set_fields';
        const gate = checkActionRequires(schema, note.metadata || {}, action, actionRules);
        const buttonKey = `${note.id}_${functionality.id}`;
        const isExecuting = executingButtonKey === buttonKey;
        const Icon = isExecuting ? Loader2 : action === 'translate_row' ? Languages : action === 'ai_prompt' ? Sparkles : Zap;
        const label = functionality.label || t('schema.functionality_default_label', 'Functionality');
        return (
          <button
            key={functionality.id}
            type="button"
            onClick={(event) => {
              if (!gate.ok || isExecuting) return;
              void executeTableFunctionality(event, note, functionality);
            }}
            disabled={!gate.ok || isExecuting}
            className={`relative p-1 transition-colors opacity-0 group-hover/row:opacity-100 ${gate.ok ? 'text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]/40 cursor-not-allowed'}`}
            aria-label={gate.ok ? label : (gate.reason ?? undefined)}
          >
            <Icon size={14} className={isExecuting ? 'animate-spin' : ''} />
            <span className="row-action-tooltip">{gate.ok ? label : (gate.reason ?? undefined)}</span>
          </button>
        );
      })}
      {!hasTranslateFunctionality && isTranslatableTable && !isListView && !note.metadata?.translation_lang && (() => {
        const gate = checkActionRequires(schema, note.metadata || {}, 'translate_row', actionRules);
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!gate.ok) return;
              setPendingAction({
                noteId: note.id,
                fieldConfig: { button_action: 'translate_row' },
                action: 'translate_row',
              });
            }}
            disabled={!gate.ok}
            className={`relative p-1 transition-colors opacity-0 group-hover/row:opacity-100 ${gate.ok ? 'text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]/40 cursor-not-allowed'}`}
            aria-label={gate.ok ? t('table.translate_row', "Translate") : (gate.reason ?? undefined)}
          >
            <Languages size={14} />
            <span className="row-action-tooltip">{gate.ok ? t('table.translate_row', "Translate") : (gate.reason ?? undefined)}</span>
          </button>
        );
      })()}
      {isDrupalSyncTable && !isListView && !note.metadata?.translation_lang && (() => {
        const gate = checkActionRequires(schema, note.metadata || {}, 'sync_drupal', actionRules);
        const label = note.metadata?.drupal_uuid ? t('table.sync_drupal_update', "Update on Drupal") : t('table.sync_drupal', "Sync with Drupal");
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!gate.ok) return;
              setPendingAction({
                noteId: note.id,
                fieldConfig: { button_action: 'sync_drupal' },
                action: 'sync_drupal',
              });
            }}
            disabled={!gate.ok}
            className={`relative p-1 transition-colors opacity-0 group-hover/row:opacity-100 ${gate.ok ? 'text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]/40 cursor-not-allowed'}`}
            aria-label={gate.ok ? label : (gate.reason ?? undefined)}
          >
            <Globe size={14} className={note.metadata?.drupal_uuid && gate.ok ? 'text-[var(--gnosi-primary)]' : ''} />
            <span className="row-action-tooltip">{gate.ok ? label : (gate.reason ?? undefined)}</span>
          </button>
        );
      })()}
      {isSocialPublishTable && !isListView && !note.metadata?.translation_lang && (() => {
        const gate = checkActionRequires(schema, note.metadata || {}, 'publish_social', actionRules);
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!gate.ok) return;
              setPendingAction({
                noteId: note.id,
                action: 'publish_social',
              });
            }}
            disabled={!gate.ok}
            className={`relative p-1 transition-colors opacity-0 group-hover/row:opacity-100 ${gate.ok ? 'text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]/40 cursor-not-allowed'}`}
            aria-label={gate.ok ? t('table.publish_social', "Publish to social") : (gate.reason ?? undefined)}
          >
            <Send size={14} />
            <span className="row-action-tooltip">{gate.ok ? t('table.publish_social', "Publish to social") : (gate.reason ?? undefined)}</span>
          </button>
        );
      })()}
      {isLlmWikiTable && !note.metadata?.translation_lang && (() => {
        const persistedJob = llmWikiJobs[llmWikiTableId]?.[note.id] || null;
        const manifestTimestamp = llmWikiConfig?.processed_resources[llmWikiTableId]?.[note.id];
        const processed = note.metadata?.['Processat pel Cervell']
          || note.metadata?.['processat pel cervell']
          || manifestTimestamp;
        const running = Boolean(persistedJob?.running);
        const retryable = ['partial', 'error'].includes(persistedJob?.phase ?? '');
        const ok = !running;
        const processedLabel = typeof processed === 'number'
          ? new Date(processed * 1000).toLocaleDateString(i18n.language)
          : processed;
        const label = running
          ? t('table.process_resource_running', "Processing…")
          : !ok
            ? t('table.process_resource_no_source', "This resource has no configured attachment or URL")
            : retryable
              ? t('table.reprocess_resource_error', "Resume interrupted processing")
              : !processed
                ? t('table.process_resource', "Process resource (Brain)")
                : t('table.reprocess_resource', "Reprocess resource (processed on {{date}})", { date: processedLabel });
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!ok) return;
              setPendingAction({
                noteId: note.id,
                action: 'process_resource',
                sourceTableId: llmWikiTableId,
                force: Boolean(processed) || retryable,
              });
            }}
            disabled={!ok}
            className={`relative p-1 transition-colors opacity-0 group-hover/row:opacity-100 ${ok ? 'text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]/40 cursor-not-allowed'}`}
            aria-label={label}
          >
            <BrainCircuit size={14} />
            <span className="row-action-tooltip">{label}</span>
          </button>
        );
      })()}
      {!isListView && onDeletePage && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDeletePage(note.id, note.title);
          }}
          className="relative p-1 text-[var(--text-tertiary)] hover:text-red-500 transition-colors opacity-0 group-hover/row:opacity-100"
          aria-label={t('table.delete')}
        >
          <Trash2 size={14} />
          <span className="row-action-tooltip">{t('table.delete')}<kbd>⌘⌫</kbd></span>
        </button>
      )}
    </div>
  </td>);
}
