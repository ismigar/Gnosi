import { Languages, Loader2, Sparkles, Zap } from 'lucide-react';
import type React from 'react';
import { toast } from '../../../lib/toast';
import { apiErrorDetail } from '../../../shared/api/errors';
import { executeVaultTableButtonAction } from '../../../shared/api/vault-table';
import { getTableFieldConfig } from './fieldConfig';
import { evaluateTableFormula } from './sharedCompatibility';
import type { TableController } from './useTableController';

export function CellButton({ model, noteId, field }: { model: TableController, value: unknown; type: string; noteId: string; field: string; originalMetaKey: string; }) {
  const {
    noteById,
    schema,
    t,
    executingButtonKey,
    setPendingAction,
    handleCellSave,
    setExecutingButtonKey,
    onTranslated,
  } = model;

  const cfg = getTableFieldConfig(schema, field);
  const action = cfg.button_action || 'translate_row';
  const label = cfg.button_label?.trim() || (action === 'translate_row'
    ? t('schema.button_label_translate', "Translate")
    : field);
  const btnKey = `${noteId}_${field}`;
  const isExecuting = executingButtonKey === btnKey;
  const Icon = isExecuting ? Loader2 : (action === 'translate_row' ? Languages : (action === 'ai_prompt' ? Sparkles : Zap));

  const handleButtonClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isExecuting) return;

    if (action === 'translate_row' || action === 'sync_drupal' || action === 'publish_social' || action === 'process_resource') {
      setPendingAction({ noteId, field, fieldConfig: cfg, action });
      return;
    }

    if (action === 'set_fields') {
      const assignments = cfg.button_config?.assignments || [];
      if (assignments.length === 0) {
        toast.error(t('schema.no_assignments_error', "No field assignments configured for this button"));
        return;
      }
      const note = noteById.get(noteId);
      const metadata = note?.metadata || {};
      const title = note?.title || '';
      for (const assign of assignments) {
        if (!assign.field) continue;
        let val = assign.value || '';
        if (typeof val === 'string' && (val.includes('(') || val.includes('{') || val.includes('+'))) {
          const evaluated = evaluateTableFormula(val, metadata, title);
          if (evaluated !== null && evaluated !== undefined) val = evaluated;
        }
        await handleCellSave(noteId, assign.field, val, assign.field);
      }
      toast.success(t('schema.button_executed_success', "Acció executada correctament"));
      return;
    }

    if (action === 'ai_prompt' || action === 'run_skill') {
      setExecutingButtonKey(btnKey);
      try {
        const res = await executeVaultTableButtonAction({
          note_id: noteId,
          button_action: action,
          button_config: cfg.button_config || {},
        });
        if (res.status === 'ok') {
          toast.success(t('schema.button_executed_success', "Acció executada correctament"));
          onTranslated?.({});
        }
      } catch (err) {
        toast.error(apiErrorDetail(err, "Error executing action"));
      } finally {
        setExecutingButtonKey(null);
      }
    }
  };

  return (
    <button
      type="button"
      disabled={isExecuting}
      onClick={event => { void handleButtonClick(event); }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] border border-[var(--gnosi-primary)]/30 hover:bg-[var(--gnosi-primary)]/20 transition-colors disabled:opacity-50"
      title={label}
    >
      <Icon size={12} className={isExecuting ? "animate-spin" : ""} />
      {isExecuting ? t('schema.button_executing', "Executant...") : label}
    </button>
  );

}
