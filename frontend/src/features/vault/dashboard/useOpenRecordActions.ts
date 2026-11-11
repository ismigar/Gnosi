import { useRecordWebsiteDestinations } from '../../websites';
import { useState } from 'react';
import { buildRecordActions } from '../views/vault-table/recordActions';
import { useFunctionalityActions } from '../views/vault-table/useTableActions';
import type { PendingTableAction, TableNote } from '../views/vault-table/types';
import type { DashboardActions } from './useDashboardActions';
import type { Page } from './types';

export function useOpenRecordActions(context: DashboardActions, page: Page | null | undefined, tableId: string | null, enabled: boolean) {
  const { websiteDestinations, refreshWebsiteDestinations } = useRecordWebsiteDestinations({ table_id: tableId ?? undefined }, enabled && context.isPluginEnabled('web-publishing'));
  const [pendingAction, setPendingAction] = useState<PendingTableAction | null>(null);
  const [executingButtonKey, setExecutingButtonKey] = useState<string | null>(null);
  const table = context.registry.tables.find(item => item.id === tableId);
  // Pin the dialog to its original record even if the active tab changes.
  const dialogPage = pendingAction ? context.pages.find(item => item.id === pendingAction.noteId) : undefined;
  const dialogTableId = pendingAction ? context.resolvePageTableId(dialogPage) : tableId;
  const onTranslated = (data: unknown) => { void context.refreshTableAfterTranslate(dialogTableId, typeof data === 'object' && data !== null ? data : {}); };
  const { executeTableFunctionality } = useFunctionalityActions({ executingButtonKey, setExecutingButtonKey, setPendingAction, t: context.t, onTranslated });
  const schema = context.getSchemaFromTableId(tableId);
  const note = page ? { ...page, parent_id: page.parent_id ?? undefined, last_modified: page.last_modified ?? undefined, resolved_table_id: page.resolved_table_id ?? undefined } : null;
  const recordActions = enabled && note && tableId && table ? buildRecordActions({
    note, schema, tableId, websiteDestinations, functionalities: table.functionalities, actionRules: table.action_rules,
    isPluginEnabled: context.isPluginEnabled,
    processingConfigured: Boolean(context.llmWikiConfig?.source_tables?.some(source => source.table_id === tableId)),
    job: context.llmWikiJobs[tableId]?.[note.id], processed: context.llmWikiConfig?.processed_resources?.[tableId]?.[note.id],
    executingButtonKey, t: context.t, language: context.i18n.language,
    execute: functionality => { void executeTableFunctionality(null, note, functionality); }, setPendingAction,
  }) : [];
  const noteById = new Map<string, TableNote>(dialogPage ? [[dialogPage.id, { ...dialogPage, parent_id: dialogPage.parent_id ?? undefined, last_modified: dialogPage.last_modified ?? undefined, resolved_table_id: dialogPage.resolved_table_id ?? undefined }]] : []);
  return { recordActions, recordActionDialogs: {
    refreshWebsiteDestinations, pendingAction, setPendingAction, schema: context.getSchemaFromTableId(dialogTableId), noteById,
    onTranslated, setLlmWikiJobs: context.setLlmWikiJobs,
    bulkTranslateIds: null, setBulkTranslateIds: () => {}, clearSelection: () => {},
  } };
}
