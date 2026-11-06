import type { TFunction } from 'i18next';
import { BrainCircuit, Languages, Loader2, Send, Sparkles, Zap } from 'lucide-react';
import { checkActionRequires } from '../../../../shared/records/model/optionCatalogUtils';
import { getSchemaFieldNames } from '../../../../shared/records/model/schemaUtils';
import { normalizeTableFunctionalities, isRetiredTableAction } from '../../properties/tableFunctionalityUtils';
import type { PageActionItem } from '../../editor/page-actions-bar/pageActionsBarModel';
import { assignmentConfig, getTableFieldConfig } from './fieldConfig';
import type { TableFunctionality } from './fieldConfig';
import type { ResourceProcessingJob } from '../../../../shared/api/resource-processing';
import type { TableNote, PendingTableAction } from './types';

interface RecordActionsInput {
  note: TableNote;
  schema: Record<string, unknown>;
  functionalities?: unknown;
  actionRules?: unknown;
  tableId: string;
  isPluginEnabled: (id: string) => boolean;
  processingConfigured: boolean;
  processed?: unknown;
  job?: ResourceProcessingJob | null;
  executingButtonKey: string | null;
  t: TFunction;
  language: string;
  execute: (functionality: TableFunctionality) => void;
  setPendingAction: (action: PendingTableAction) => void;
}

export function buildRecordActions(input: RecordActionsInput): PageActionItem[] {
  const { note, schema, tableId, isPluginEnabled, t, job, setPendingAction } = input;
  const translated = Boolean(note.metadata?.translation_lang);
  const supports = (action: string) => {
    if (isRetiredTableAction(action)) return false;
    if (action === 'translate_row') return !translated && isPluginEnabled('translation');
    if (action === 'publish_social') return !translated && isPluginEnabled('social-publishing');
    if (action === 'process_resource') return !translated && isPluginEnabled('llm-wiki') && input.processingConfigured;
    return true;
  };
  const configured = normalizeTableFunctionalities(input.functionalities, schema)
    .filter(item => item.enabled && supports(item.action))
    .map(item => ({ ...item, config: assignmentConfig(item.config) }));
  const actions: PageActionItem[] = [];
  const processed = note.metadata?.['Processat pel Cervell'] || note.metadata?.['processat pel cervell'] || input.processed;
  const retryable = ['partial', 'error'].includes(job?.phase ?? '');
  const pending = (action: string, functionality?: TableFunctionality): PendingTableAction => ({
    noteId: note.id, action,
    ...(functionality ? { fieldConfig: { button_action: action, button_config: functionality.config } } : {}),
    ...(action === 'process_resource' ? { sourceTableId: tableId, force: Boolean(processed) && !retryable } : {}),
  });
  const add = (action: string, label: string, functionality?: TableFunctionality) => {
    const gate = checkActionRequires(schema, note.metadata || {}, action, input.actionRules);
    const running = action === 'process_resource' && Boolean(job?.running);
    const executing = Boolean(functionality && input.executingButtonKey === `${note.id}_${functionality.id}`);
    const disabled = !gate.ok || running || executing;
    actions.push({
      key: functionality ? `functionality:${functionality.id}` : action,
      Icon: running || executing ? Loader2 : action === 'translate_row' ? Languages : action === 'publish_social' ? Send : action === 'process_resource' ? BrainCircuit : action === 'ai_prompt' ? Sparkles : Zap,
      label: running ? t('table.process_resource_running', 'Processing…') : label,
      disabled, disabledReason: gate.ok ? undefined : gate.reason ?? undefined,
      overflowOnly: true,
      onClick: () => {
        if (disabled) return;
        if (['translate_row', 'publish_social', 'process_resource'].includes(action)) setPendingAction(pending(action, functionality));
        else if (functionality) input.execute(functionality);
      },
    });
  };
  configured.forEach(item => { add(item.action, item.label || t('schema.functionality_default_label', 'Functionality'), item); });
  const fields = getSchemaFieldNames(schema);
  const has = (action: string) => configured.some(item => item.action === action);
  if (!has('translate_row') && supports('translate_row') && fields.some(name => getTableFieldConfig(schema, name).translatable === true)) {
    add('translate_row', t('table.translate_row', 'Translate'));
  }
  if (!has('publish_social') && supports('publish_social') && fields.some(name => {
    const config = getTableFieldConfig(schema, name);
    return config.system === true && /xxss|social/i.test(name);
  })) add('publish_social', t('table.publish_social', 'Publish to social'));
  if (!has('process_resource') && supports('process_resource')) {
    const date = typeof processed === 'number' ? new Date(processed * 1000).toLocaleDateString(input.language) : processed;
    add('process_resource', retryable ? t('table.reprocess_resource_error', 'Resume interrupted processing')
      : processed ? t('table.reprocess_resource', 'Reprocess resource (processed on {{date}})', { date })
      : t('table.process_resource', 'Process resource (Brain)'));
  }
  return actions;
}
